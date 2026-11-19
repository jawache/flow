// flow/adapter/codex/codex.test.ts — the Codex adapter's shell, against a real disk and a real hook run.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRows } from "../../engine/state.ts";
import { facts } from "../archive.ts";
import { runHook } from "../hook.ts";
import { projectRoot } from "../shell.ts";
import { codex } from "./codex.ts";

describe("a hook run for the harness that sent the payload", () => {
  const config = `import { breadcrumb, command, defineConfig, definePack, guardrail, pack, session } from ${JSON.stringify(new URL("../../index.ts", import.meta.url).pathname)};
const demo = definePack("demo", {
  hello: breadcrumb().at(session).text("Hello."),
  noTodo: guardrail().at(command).check((ctx) => (ctx.command?.includes("TODO") ? ctx.fail("TODO") : ctx.ok())).message("No TODOs.").test({ pass: ["echo ok"], block: ["echo TODO"] }),
});
export default defineConfig([pack(demo)]);
`;

  it("names the harness in the session log's first row, and refuses a command in the dialect of its answers", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "flow-hook-")));
    try {
      writeFileSync(join(repo, "flow.config.ts"), config);
      const sent = { session_id: "s1", transcript_path: "/home/me/.codex/sessions/2026/11/18/rollout-x-s1.jsonl", cwd: repo, turn_id: "t1" };
      const started = await runHook(codex, "session-start", { ...sent, hook_event_name: "SessionStart", source: "startup" }, repo);
      expect(started.stdout).toContain("demo.hello");
      const refused = await runHook(codex, "pre-tool-use", { ...sent, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo TODO" } }, repo);
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain("No TODOs.");
      const [meta, ...rows] = readRows(repo, "s1");
      expect(meta).toMatchObject({ kind: "meta", v: 2, harness: "codex", session: "s1" });
      expect(rows.map((row) => row.kind)).toContain("guardrail");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("which repo", () => {
  it("is the one git finds from the folder the hook ran in, and that folder when git finds none", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "flow-root-")));
    try {
      spawnSync("git", ["init", "-q"], { cwd: repo });
      mkdirSync(join(repo, "src", "deep"), { recursive: true });
      expect(projectRoot(join(repo, "src", "deep"))).toBe(repo);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
    const loose = realpathSync(mkdtempSync(join(tmpdir(), "flow-loose-")));
    try {
      expect(projectRoot(loose), "outside any repository").toBe(loose);
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });
});

describe("flow facts over Codex's store", () => {
  const LEADER = "01a1ef4c-43e9-7973-9f4a-a2e877a30827";
  const SUB = "01a1ef4c-5618-7aa2-a5cb-1e59527b085e";

  it("reads a session started in a folder of the repo, joins a subagent's rollout to it, and leaves another repo's out", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "flow-facts-")));
    const home = realpathSync(mkdtempSync(join(tmpdir(), "flow-home-")));
    try {
      const day = join(home, ".codex", "sessions", "2026", "11", "18");
      mkdirSync(day, { recursive: true });
      const rollout = readFileSync(new URL("../../__fixtures__/codex-rollout.jsonl", import.meta.url), "utf8");
      const first = (id: string, session: string, source: string, cwd: string): string =>
        `${JSON.stringify({ type: "session_meta", payload: { id, session_id: session, thread_source: source, cwd, timestamp: "2026-11-18T15:21:44.452Z" } })}\n`;
      const inRepo = join(repo, "src", "deep");
      writeFileSync(join(day, `rollout-2026-11-18T16-35-15-${LEADER}.jsonl`), first(LEADER, LEADER, "user", inRepo) + rollout.split("\n").slice(1).join("\n"));
      writeFileSync(join(day, `rollout-2026-11-18T16-35-19-${SUB}.jsonl`), first(SUB, LEADER, "subagent", inRepo));
      const other = "01a1ef4c-0000-7aa2-a5cb-1e59527b0000";
      writeFileSync(join(day, `rollout-2026-11-18T16-36-00-${other}.jsonl`), first(other, other, "user", "/somewhere/else"));
      const read = facts(repo, { ok: true, entries: [] }, [codex], { home });
      expect(read.selection.analyse.map((c) => c.id)).toEqual([LEADER]);
      expect(read.narrative.prompts, "the prompt is read from the rollout").toHaveLength(1);
      expect(read.actors).toHaveLength(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
