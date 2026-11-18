// flow/adapter/claude/claude.test.ts — the Claude Code adapter's shell, against a real disk and a real git repo.
//
// The live half of the adapter: it opens files, runs commands and asks git, and what it decides is in
// domain.ts. So it is proved over a temp repo, asserting what actually comes back: the notes a
// subagent is shown, and the path a call is made real as.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHook } from "../hook.ts";
import { claudeCode, projectRoot } from "./claude.ts";

let repo: string;

const git = (...args: string[]): void => {
  spawnSync("git", args, { cwd: repo });
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "flow-world-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("which repo", () => {
  it("prefers the host's own project directory over the hook's cwd", () => {
    process.env["CLAUDE_PROJECT_DIR"] = "/the/project";
    try {
      expect(projectRoot("/somewhere/else")).toBe("/the/project");
    } finally {
      delete process.env["CLAUDE_PROJECT_DIR"];
    }
    expect(projectRoot("/somewhere/else")).toBe("/somewhere/else");
  });
});

describe("a subagent's session notes, when its brief cannot be read at its start", () => {
  // At SubagentStart the host has not written the subagent's own transcript yet, so a note bound to
  // a category its brief recognises waits for its first tool call, which can read the brief.
  const notesConfig = `import { breadcrumb, command, defineCategory, defineConfig, definePack, guardrail, pack, session, spawnedAs } from ${JSON.stringify(new URL("../../index.ts", import.meta.url).pathname)};
const briefed = defineCategory("briefed", spawnedAs({ generic: ["general-purpose"], brief: ["BUILD-MARKER"] }));
const demo = definePack("demo", {
  everyone: breadcrumb().at(session).text("For every agent."),
  briefedOnly: breadcrumb().at(session).for(briefed).text("For the briefed agent."),
  noTodo: guardrail()
    .at(command)
    .check((ctx) => (ctx.command?.includes("TODO") ? ctx.fail("TODO") : ctx.ok()))
    .message("No TODOs.")
    .test({ pass: ["echo ok"], block: ["echo TODO"] }),
});
export default defineConfig([pack(demo)]);
`;
  const parent = (): string => join(repo, ".t", "s1.jsonl");
  const briefOf = (agent: string, brief: string): void => {
    mkdirSync(join(repo, ".t", "s1", "subagents"), { recursive: true });
    writeFileSync(join(repo, ".t", "s1", "subagents", `agent-${agent}.jsonl`), `${JSON.stringify({ type: "user", message: { content: brief } })}\n`);
  };
  const start = (agent: string): Promise<Awaited<ReturnType<typeof runHook>>> =>
    runHook(claudeCode, "subagent-start", { session_id: "s1", transcript_path: parent(), cwd: repo, agent_id: agent, agent_type: "general-purpose", hook_event_name: "SubagentStart" }, repo);
  // A shell command is judged before it runs, and any other tool's call is seen after it ran.
  const call = (agent: string, tool: string, input: Record<string, unknown>): Promise<Awaited<ReturnType<typeof runHook>>> =>
    runHook(claudeCode, tool === "Bash" ? "pre-tool-use" : "post-tool-use", { session_id: "s1", transcript_path: parent(), cwd: repo, agent_id: agent, agent_type: "general-purpose", tool_name: tool, tool_input: input }, repo);

  beforeEach(() => {
    writeFileSync(join(repo, "flow.config.ts"), notesConfig);
  });

  it("holds a note bound to a brief-recognised category at the start, and shows it once at the first tool call", async () => {
    const started = await start("abrief");
    expect(started.stdout).toContain('"hookEventName":"SubagentStart"');
    expect(started.stdout).toContain("demo.everyone");
    expect(started.stdout, "the brief is not there to recognise").not.toContain("demo.briefedOnly");
    briefOf("abrief", "Build the task. BUILD-MARKER");
    const first = await call("abrief", "Read", { file_path: join(repo, "a.ts") });
    expect(first.stdout).toContain('"hookEventName":"PostToolUse"');
    expect(first.stdout).toContain("# breadcrumb: demo.briefedOnly (session)\\nFor the briefed agent.");
    expect(first.stdout, "shown at the start already").not.toContain("demo.everyone");
    const second = await call("abrief", "Read", { file_path: join(repo, "a.ts") });
    expect(second.stdout, "shown once").not.toContain("demo.briefedOnly");
  });

  it("keeps the note held past a first call that is refused, and shows it on the call that runs", async () => {
    await start("arefused");
    briefOf("arefused", "BUILD-MARKER");
    const refused = await call("arefused", "Bash", { command: "echo TODO" });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).not.toContain("demo.briefedOnly");
    const runs = await call("arefused", "Bash", { command: "echo ok" });
    expect(runs.stdout).toContain("demo.briefedOnly");
  });

  it("shows a resumed subagent the note at its start, since its brief is already written, and not again at its first tool call", async () => {
    briefOf("aresumed", "Build the task. BUILD-MARKER");
    const started = await start("aresumed");
    expect(started.stdout).toContain("demo.everyone");
    expect(started.stdout).toContain("# breadcrumb: demo.briefedOnly (session)\\nFor the briefed agent.");
    const first = await call("aresumed", "Read", { file_path: join(repo, "a.ts") });
    expect(first.stdout, "nothing was held").not.toContain("demo.briefedOnly");
  });

  it("does not show the note to a subagent whose brief does not recognise the category", async () => {
    await start("aother");
    briefOf("aother", "Look something up.");
    const first = await call("aother", "Read", { file_path: join(repo, "a.ts") });
    expect(first.stdout).not.toContain("demo.briefedOnly");
  });
});
