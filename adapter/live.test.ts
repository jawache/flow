// flow/adapter/live.test.ts — the live rails, end to end, through the BUILT BINARY.
//
// Everything else in flow's suite proves a decision. This proves the wiring: a real payload on the
// real binary's stdin, in a real git repo, with a real `flow.config.ts` — and the answer read off
// the three edges a harness actually reads (stdout, stderr, the exit code). It is the only place
// the whole column is exercised at once, which is exactly what a seam of this size is worth.
//
// It is a SHELL suite and is written like one: over a temp repo, asserting the bytes that land
// rather than the calls that were made. The config it drives is a small honest one — a write rule,
// a command ban, a commit gate, a turn-end rule and a breadcrumb — because the claim is that the
// rails carry a rule, not that any particular rule is clever.
//
// One thing to know if this file ever surprises you: the config is loaded by node's own type
// stripping, from source, while the judgement runs inside the bundle. So there are two copies of
// flow's language module in the process, and everything still recognises everything else — which is
// the `Symbol.for` decision (flow/language/domain.ts) being paid off rather than a coincidence.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** The package root, from this file rather than from the runner's cwd. */
const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const BINARY = join(PACKAGE, "dist", "flow.mjs");

let repo: string;

/** What the temp repo's own guard says. Five entries, one per rail this suite drives. */
const CONFIG = (packageRoot: string): string => `
import { breadcrumb, command, commit, definePack, defineConfig, guardrail, pack, session, touch, turnEnd, write } from ${JSON.stringify(
  join(packageRoot, "index.ts"),
)};

const demo = definePack("demo", {
  noTodo: guardrail()
    .at(write)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/ — write the code or write the issue.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "TODO" }] }),

  noForce: guardrail()
    .at(command)
    .check((ctx) => ((ctx.command ?? "").includes("--force") ? ctx.fail("--force") : ctx.ok()))
    .message("Never force-push — the history is shared.")
    .test({ pass: ["git push"], block: ["git push --force"] }),

  noSecrets: guardrail()
    .at(commit)
    .on("**/*.ts")
    .check((ctx) => (ctx.file?.content.includes("DO-NOT-COMMIT") ? ctx.fail("marked DO-NOT-COMMIT") : ctx.ok()))
    .message("A file marked DO-NOT-COMMIT is staged.")
    .test({
      pass: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "ok" } } }],
      block: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "DO-NOT-COMMIT" } } }],
    }),

  ranSomething: guardrail()
    .at(turnEnd)
    .check((ctx) => ((ctx.turn ?? []).every((a) => a.did === "edit") && (ctx.turn ?? []).length > 3 ? ctx.fail("nothing ran") : ctx.ok()))
    .message("You edited all turn and ran nothing.")
    .test({ pass: [{ actions: [] }], block: [{ actions: [{ did: "edit", path: "a" }, { did: "edit", path: "b" }, { did: "edit", path: "c" }, { did: "edit", path: "d" }] }] }),

  orientation: breadcrumb().at(session).text("This repo is guarded by flow."),

  area: breadcrumb().at(touch).on("src/**").text("src/ is the product — its tests sit beside it."),
});

export default defineConfig([pack(demo)]);
`;

/** Run the built binary in the temp repo, with a payload on stdin exactly as the host sends it. */
function run(args: readonly string[], stdin: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("node", [BINARY, ...args], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

const hook = (event: string, payload: unknown): ReturnType<typeof run> => run(["hook", event], JSON.stringify(payload));

/** Every row `.flow/` recorded for one session. */
function rows(session: string): Record<string, unknown>[] {
  const file = join(repo, ".flow", "log", `${session}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(() => {
  // The BUILT binary, deliberately — the bundle is what a repo runs, and bundling is where an
  // import that only resolves in source would show up.
  const built = spawnSync("node", [join(PACKAGE, "esbuild.mjs")], { encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);

  repo = mkdtempSync(join(tmpdir(), "flow-live-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "t"], { cwd: repo });
  writeFileSync(join(repo, "flow.config.ts"), CONFIG(PACKAGE));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const pre = (tool: string, input: Record<string, unknown>): Record<string, unknown> => ({
  session_id: "live-1",
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: input,
});

describe("the write rail", () => {
  it("blocks the write before it lands, with the message on stderr and exit 2", () => {
    const answer = hook("pre-tool-use", pre("Write", { file_path: join(repo, "src/b.ts"), content: "// TODO: later\n" }));
    expect(answer.code).toBe(2);
    expect(answer.stdout).toBe("");
    expect(answer.stderr).toContain("flow — blocked before the write landed");
    expect(answer.stderr).toContain("demo.noTodo · src/b.ts");
    expect(answer.stderr).toContain("No TODOs in src/");
    expect(answer.stderr, "the check's own detail, under the sentence's message").toContain("line says TODO");
    expect(existsSync(join(repo, "src/b.ts")), "the whole point: disk is untouched").toBe(false);
  });

  it("judges the file as the EDIT would leave it, not as it is", () => {
    // The would-be file, rebuilt in memory. The base is clean; the edit is what introduces the TODO.
    const edit = pre("Edit", { file_path: join(repo, "src/a.ts"), old_string: "1", new_string: "1 // TODO" });
    expect(hook("pre-tool-use", edit).code).toBe(2);
    const innocent = pre("Edit", { file_path: join(repo, "src/a.ts"), old_string: "1", new_string: "2" });
    expect(hook("pre-tool-use", innocent).code).toBe(0);
  });

  it("leaves the session marker the commit gate reads, and records the call", () => {
    // The handshake: the PreToolUse rail writes which session is live, and the gate — spawned by
    // git, outside any session — reads it back. Both ends are flow's or commits misattribute.
    const marked = readFileSync(join(repo, ".flow", ".session-main"), "utf8");
    expect(JSON.parse(marked).session).toBe("live-1");
    expect(rows("live-1").some((row) => row["kind"] === "tool" && row["path"] === "src/b.ts")).toBe(true);
    expect(rows("live-1").some((row) => row["kind"] === "guardrail" && row["out"] === "deny")).toBe(true);
  });
});

describe("the command rail", () => {
  it("blocks the command before it runs", () => {
    const answer = hook("pre-tool-use", pre("Bash", { command: "git push --force" }));
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — command blocked before it ran");
    expect(answer.stderr).toContain("demo.noForce");
  });

  it("lets an ordinary command through", () => {
    expect(hook("pre-tool-use", pre("Bash", { command: "git status" })).code).toBe(0);
  });
});

describe("the session and turn rails", () => {
  it("answers session start with the decision object the host injects", () => {
    const answer = hook("session-start", { session_id: "live-2", source: "startup", hook_event_name: "SessionStart" });
    expect(answer.code).toBe(0);
    expect(answer.stderr).toBe("");
    const decision = JSON.parse(answer.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(decision.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(decision.hookSpecificOutput.additionalContext).toBe(
      "# breadcrumb: demo.orientation (session)\nThis repo is guarded by flow.",
    );
  });

  it("shows a session note once — the second start of the same session is quiet", () => {
    expect(hook("session-start", { session_id: "live-2", source: "startup" }).stdout).toBe("");
  });

  it("briefs the area on first touch, and stays quiet on the next one", () => {
    const first = hook("post-tool-use", { session_id: "live-4", tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } });
    expect(first.code).toBe(0);
    const decision = JSON.parse(first.stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(decision.hookSpecificOutput.additionalContext).toBe(
      "# breadcrumb: demo.area (first-touch)\nsrc/ is the product — its tests sit beside it.",
    );
    const again = hook("post-tool-use", { session_id: "live-4", tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } });
    expect(again.stdout, "shown once, until the session drifts past the threshold").toBe("");
    expect(
      rows("live-4").filter((row) => row["kind"] === "run").length,
      "a touch where nothing showed is not a run row — the tool row already said the call happened",
    ).toBe(1);
  });

  it("passes a turn that has nothing to answer for", () => {
    const answer = hook("stop", { session_id: "live-2", hook_event_name: "Stop" });
    expect(answer.code).toBe(0);
    expect(answer.stdout).toBe("");
  });

  it("bows out when the host says it has already held this turn open", () => {
    expect(hook("stop", { session_id: "live-2", stop_hook_active: true }).code).toBe(0);
  });
});

describe("what a broken or empty call does", () => {
  it("passes an empty payload safely, on every rail", () => {
    for (const event of ["session-start", "pre-tool-use", "post-tool-use", "stop", "notification"]) {
      const answer = run(["hook", event], "");
      expect(answer.code, `${event} on an empty payload`).toBe(0);
      expect(answer.stderr, `${event} said something about nothing`).toBe("");
    }
  });

  it("blocks the guarding rail when it cannot read its payload, and warns on the rest", () => {
    // "I could not SEE what I was guarding" must never be spelled like "I looked and it was fine".
    const guarded = run(["hook", "pre-tool-use"], "not json at all");
    expect(guarded.code).toBe(2);
    expect(guarded.stderr).toContain("could not PARSE its payload");
    const annotating = run(["hook", "post-tool-use"], "not json at all");
    expect(annotating.code, "breaking a session over a breadcrumb is the cure killing the patient").toBe(0);
    expect(annotating.stderr).toContain("could not PARSE its payload");
  });

  it("is silent about an event it was never asked for", () => {
    const answer = run(["hook", "user-prompt-submit"], "{}");
    expect(answer.code).toBe(0);
    expect(answer.stdout + answer.stderr).toBe("");
  });
});

describe("the commit gate", () => {
  it("blocks a staged file the gate refuses, naming it", () => {
    writeFileSync(join(repo, "src", "leak.ts"), "// DO-NOT-COMMIT\n");
    spawnSync("git", ["add", "src/leak.ts"], { cwd: repo });
    const answer = run(["commit", "src/leak.ts"], "");
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — commit blocked");
    expect(answer.stderr).toContain("demo.noSecrets · src/leak.ts");
    expect(answer.stderr).toContain("Fix the above, then commit again.");
  });

  it("passes a clean staged set, and says nothing", () => {
    const answer = run(["commit", "src/a.ts"], "");
    expect(answer.code).toBe(0);
    expect(answer.stdout + answer.stderr).toBe("");
  });

  it("attributes its rows to the session the marker names", () => {
    // The gate runs outside any session. Without the handshake its refusals would land in a shared
    // `commit` stream instead of the chat that caused them.
    expect(rows("live-1").some((row) => row["kind"] === "run" && row["moment"] === "commit")).toBe(true);
  });
});

describe("the off switch", () => {
  it("silences every rail, and writes no telemetry while it is off", () => {
    writeFileSync(join(repo, ".flow", "off"), "");
    const before = rows("live-1").length;
    expect(hook("pre-tool-use", pre("Write", { file_path: join(repo, "src/c.ts"), content: "TODO" })).code).toBe(0);
    expect(run(["commit", "src/leak.ts"], "").code).toBe(0);
    expect(rows("live-1").length, "a half-off guard that still logged would make the A/B dishonest").toBe(before);
    rmSync(join(repo, ".flow", "off"));
  });
});

describe("a config that will not load", () => {
  it("refuses the write rail with the reason, and degrades to a notice at a session moment", () => {
    const good = readFileSync(join(repo, "flow.config.ts"), "utf8");
    writeFileSync(join(repo, "flow.config.ts"), `${good}\nthis is not typescript at all(((\n`);
    try {
      const guarded = hook("pre-tool-use", pre("Write", { file_path: join(repo, "src/d.ts"), content: "fine" }));
      expect(guarded.code, "a guard that cannot run must not look like a guard that passed").toBe(2);
      expect(guarded.stderr).toContain("flow.config.ts could not be loaded");
      const greeting = hook("session-start", { session_id: "live-3", source: "startup" });
      expect(greeting.code, "refusing the opening greeting would wedge the session before anyone read why").toBe(0);
      expect(greeting.stdout).toContain("could not be loaded");
    } finally {
      writeFileSync(join(repo, "flow.config.ts"), good);
    }
  });
});

describe("a repo that has never heard of flow", () => {
  it("says nothing at all — the hooks are registered globally and fire everywhere", () => {
    const bare = mkdtempSync(join(tmpdir(), "flow-bare-"));
    try {
      const answer = spawnSync("node", [BINARY, "hook", "pre-tool-use"], {
        cwd: bare,
        input: JSON.stringify(pre("Write", { file_path: join(bare, "src/a.ts"), content: "TODO" })),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: bare },
      });
      expect(answer.status).toBe(0);
      expect(answer.stdout + answer.stderr).toBe("");
      expect(existsSync(join(bare, ".flow")), "and leaves nothing behind").toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
