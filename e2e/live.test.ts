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
import { closeSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { PACKAGE, buildBundles, cleanBundles, fixturePack, hookInPieces, newRepo, pre, shimBin, subagentStopPayload, subagentTranscripts, tapeRecords, tapeSteps, BREAKS, flow as runFlow, git as runGit, type Ran } from "./harness.ts";
import { COMMIT_MSG, FLOW_OFF, SET_HOOKS_PATH } from "../adapter/domain.ts";

let repo: string;

/**
 * The one pack this repo writes itself, in the folder it chose to write it in.
 *
 * A category and one turn-end rule, shared with `e2e/machine.test.ts` as a fixture file rather
 * than kept twice as a string — see flow/__fixtures__/repo-pack.ts. It matters here beyond the
 * rule: a `.for(…)` entry needs a rung to bind to at the commit gate, and a real config binds the
 * repo's own pack beside the package's. The folder name is this fixture's choice and nothing
 * else's — `guards/` is where this repo happens to keep them, and the engine knows no such word.
 */

const HOUSE = (packageRoot: string): string => fixturePack("repo-pack", join(packageRoot, "index.ts"));

/** What the temp repo's own guard says. A few entries, at least one per rail this suite drives. */
const CONFIG = (packageRoot: string): string => `
import { breadcrumb, command, commit, definePack, defineConfig, guardrail, pack, protectedPath, session, fileChange, turnEnd } from ${JSON.stringify(
  join(packageRoot, "index.ts"),
)};
import { builder, house } from "./guards/house.ts";

const demo = definePack("demo", {
  noTodo: guardrail()
    .at(commit)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/ — write the code or write the issue.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "TODO" }] }),

  appendOnly: guardrail()
    .at(commit)
    .check(protectedPath({ paths: ["migrations/**"], existingOnly: true }))
    .message("A migration already written is history — add a new one instead.")
    .test({
      pass: [{ staged: ["migrations/002.sql"], added: ["migrations/002.sql"] }],
      block: [{ staged: ["migrations/001.sql"], added: [] }, { staged: [], deleted: ["migrations/001.sql"] }],
    }),

  keepGenerated: guardrail()
    .at(commit)
    .check(protectedPath({ paths: ["gen/**"] }))
    .message("Machine-written: edit its source, then re-run the build.")
    .test({ block: [{ staged: ["gen/a.ts"] }] }),

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

  suitePasses: guardrail()
    .at(commit)
    .on("tool/**")
    .check(async (ctx) => {
      const ran = await ctx.exec("definitely-not-a-real-binary-xyz --check");
      return ran.code === 0 ? ctx.ok() : ctx.fail(\`\\\`definitely-not-a-real-binary-xyz\\\` failed (exit \${ran.code}): \${ran.stderr.trim()}\`);
    })
    .message("The gate could not run its tool.")
    .test({
      pass: [{ staged: ["tool/x.ts"], world: { fs: { "tool/x.ts": "" }, exec: { "definitely-not-a-real-binary-xyz": { code: 0 } } } }],
      block: [{ staged: ["tool/x.ts"], world: { fs: { "tool/x.ts": "" }, exec: { "definitely-not-a-real-binary-xyz": { code: 127, stderr: "command not found" } } } }],
    }),

  buildersOnly: guardrail()
    .at(commit)
    .for(builder)
    .check((ctx) => ((ctx.staged ?? []).includes("plan.yaml") ? ctx.fail("the plan is the parent's") : ctx.ok()))
    .message("A builder completes its phase — the plan's shape is the parent's.")
    .test({ pass: [{ staged: ["src/a.ts"] }], block: [{ staged: ["plan.yaml"] }] }),

  buildersHandBack: guardrail()
    .at(turnEnd)
    .for(builder)
    .check((ctx) => ((ctx.turn ?? []).some((action) => action.did === "edit" && action.path === "plan.yaml") ? ctx.fail("edited plan.yaml") : ctx.ok()))
    .message("A builder hands back its phase, not a new plan — put plan.yaml back.")
    .test({ pass: [{ actions: [] }], block: [{ actions: [{ did: "edit", path: "plan.yaml" }] }] }),

  orientation: breadcrumb().at(session).text("This repo is guarded by flow."),

  area: breadcrumb().at(fileChange).on("src/**").text("src/ is the product — its tests sit beside it."),
});

// The repo's own pack is bound beside the demo one, which is how a real config reads: the package's
// rules and the repo's, in one list.
export default defineConfig([pack(demo), pack(house)]);
`;

/**
 * A header rule, in a pack of its own that only the repo of the commit journey binds: the repo of
 * every other test here has no rule reading a message. The rule is a check written in the config,
 * as a repo's own would be, and reads `ctx.message` as git records it.
 */
const HEADER_PACK = (packageRoot: string): string => `
import { commit, definePack, guardrail } from ${JSON.stringify(join(packageRoot, "index.ts"))};

export const header = definePack("header", {
  header: guardrail()
    .at(commit)
    .check((ctx) => (ctx.message == null || /^(fix|feat|chore): \\S/.test(ctx.message) ? ctx.ok() : ctx.fail(\`header is "\${ctx.message.split("\\n")[0] ?? ""}"\`)))
    .message("The header is \`type: description\`.")
    .test({ pass: [{ message: "fix: a thing" }], block: [{ message: "wip" }] }),
});
`;

/** Run the built binary in the temp repo, with a payload on stdin exactly as the host sends it. */
const run = (args: readonly string[], stdin: string, cwd = repo): Ran => runFlow(cwd, args, {}, stdin);

const hook = (event: string, payload: unknown, cwd = repo): Ran => run(["hook", event], JSON.stringify(payload), cwd);

/** Every row `.flow/` recorded for one session, in the repo given. */
function rows(where: string, session: string): Record<string, unknown>[] {
  const file = join(where, ".flow", "log", `${session}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(() => {
  // The BUILT binary, deliberately — the bundle is what a repo runs, and bundling is where an
  // import that only resolves in source would show up.
  const built = buildBundles();
  expect(built.code, built.stderr).toBe(0);

  repo = newRepo("flow-live-");
  mkdirSync(join(repo, "guards"), { recursive: true });
  writeFileSync(join(repo, "guards", "house.ts"), HOUSE(PACKAGE));
  writeFileSync(join(repo, "flow.config.ts"), CONFIG(PACKAGE));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  mkdirSync(join(repo, "migrations"), { recursive: true });
  writeFileSync(join(repo, "migrations", "001.sql"), "create table a ();\n");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  cleanBundles();
});

/**
 * The guard, copied somewhere else: the config AND the pack it imports.
 *
 * Both, always, and that is the shape of the thing rather than a fixture detail — the config names
 * `./guards/house.ts`, so a directory holding one without the other holds a config that will not
 * load, which is precisely what these two tests are not about.
 */
function copyGuard(into: string): void {
  mkdirSync(join(into, "guards"), { recursive: true });
  writeFileSync(join(into, "guards", "house.ts"), readFileSync(join(repo, "guards", "house.ts"), "utf8"));
  writeFileSync(join(into, "flow.config.ts"), readFileSync(join(repo, "flow.config.ts"), "utf8"));
}

/** This suite's session, on the harness's payload — every row below is keyed by that id. */
const inThisSession = (tool: string, input: Record<string, unknown>): Record<string, unknown> => pre(tool, input, "live-1");

/**
 * One tool call as the host brackets it: PreToolUse for a shell command only, the tool, then
 * PostToolUse. The after-call answer is what comes back. Both hooks run in `cwd`, the suite's repo
 * unless a test has one of its own.
 */
function called(payload: Record<string, unknown>, tool: () => void = () => undefined, event = "post-tool-use", cwd = repo): Ran {
  if (payload["tool_name"] === "Bash") {
    const before = hook("pre-tool-use", payload, cwd);
    expect(before.code, `the call was refused before it ran: ${before.stderr}`).toBe(0);
  }
  tool();
  return hook(event, payload, cwd);
}

describe("the command rail", () => {
  it("blocks the command before it runs", () => {
    const answer = hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" }));
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — command blocked before it ran");
    expect(answer.stderr).toContain("demo.noForce");
  });

  it("lets an ordinary command through", () => {
    expect(hook("pre-tool-use", inThisSession("Bash", { command: "git status" })).code).toBe(0);
  });

  it("leaves the session marker the commit gate reads, and records the call", () => {
    // The handshake: the PreToolUse rail writes which session is live, and the gate — spawned by
    // git, outside any session — reads it back. Both ends are flow's or commits misattribute.
    const marked = JSON.parse(readFileSync(join(repo, ".flow", ".session-main"), "utf8")) as Record<string, unknown>;
    expect(marked["session"]).toBe("live-1");
    // The AGENT too: identity is stored per session x agent, so without this field the gate has no
    // state file to look up and an actor-scoped commit rule is silenced while reading as armed.
    expect(marked["agent"]).toBe("main");
    expect(rows(repo, "live-1").some((row) => row["kind"] === "tool" && row["command"] === "git push --force")).toBe(true);
    expect(rows(repo, "live-1").some((row) => row["kind"] === "guardrail" && row["out"] === "deny")).toBe(true);
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

  it("passes a turn that has nothing to answer for", () => {
    const answer = hook("stop", { session_id: "live-2", hook_event_name: "Stop" });
    expect(answer.code).toBe(0);
    expect(answer.stdout).toBe("");
  });

  it("bows out when the host says it has already held this turn open", () => {
    expect(hook("stop", { session_id: "live-2", stop_hook_active: true }).code).toBe(0);
  });
});

describe("a subagent's start", () => {
  /** A SubagentStart payload, shaped like the one the host sent (flow-5's artifacts/subagent-start-payload.json). */
  const started = (agent: string, type = "general-purpose"): Record<string, unknown> => ({
    session_id: "live-sub",
    transcript_path: join(repo, ".t", "live-sub.jsonl"),
    cwd: repo,
    prompt_id: "ee479102-7ec4-4b7f-a09f-730b929fbde1",
    agent_id: agent,
    agent_type: type,
    hook_event_name: "SubagentStart",
  });

  it("answers SubagentStart with every session breadcrumb, as the decision object the host injects", () => {
    const answer = hook("subagent-start", started("asub1"));
    expect(answer.code).toBe(0);
    expect(answer.stderr).toBe("");
    const decision = JSON.parse(answer.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(decision.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(decision.hookSpecificOutput.additionalContext).toBe(
      "# breadcrumb: demo.orientation (session)\nThis repo is guarded by flow.",
    );
  });

  it("shows them once per agent — the same agent's second start is quiet, a new agent's is not", () => {
    expect(hook("subagent-start", started("asub2")).stdout).toContain("demo.orientation");
    expect(hook("subagent-start", started("asub2")).stdout, "the same agent, started again").toBe("");
    expect(hook("subagent-start", started("asub3")).stdout, "another agent of the same session").toContain("demo.orientation");
  });

  it("shows no note to an internal agent, which starts with no agent type", () => {
    const answer = hook("subagent-start", started("asub4", ""));
    expect(answer.code).toBe(0);
    expect(answer.stdout + answer.stderr).toBe("");
  });
});

describe("a subagent's note held for its brief", () => {
  // Two runs of the binary with the hold saved on disk between them: the start, before the host has
  // written the subagent's own transcript, and its first tool call, once the brief is there.
  let held: string;
  const session = "live-held";

  beforeAll(() => {
    held = newRepo("flow-held-");
    mkdirSync(join(held, ".t"), { recursive: true });
    writeFileSync(
      join(held, "flow.config.ts"),
      `import { breadcrumb, defineCategory, defineConfig, definePack, pack, session, spawnedAs } from ${JSON.stringify(join(PACKAGE, "index.ts"))};

const briefed = defineCategory("briefed", spawnedAs({ generic: ["general-purpose"], brief: ["BUILD-MARKER"] }));

const notes = definePack("notes", {
  everyone: breadcrumb().at(session).text("For every agent."),
  briefedOnly: breadcrumb().at(session).for(briefed).text("For the briefed agent."),
});

export default defineConfig([pack(notes)]);
`,
    );
  });

  afterAll(() => {
    rmSync(held, { recursive: true, force: true });
  });

  it("is left out of the SubagentStart answer, and shown in the answer to the subagent's first tool call", () => {
    const parent = join(held, ".t", `${session}.jsonl`);
    const who = { session_id: session, transcript_path: parent, cwd: held, agent_id: "aheld", agent_type: "general-purpose" };

    const start = hook("subagent-start", { ...who, hook_event_name: "SubagentStart" }, held);
    expect(start.code, start.stderr).toBe(0);
    const started = JSON.parse(start.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(started.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(started.hookSpecificOutput.additionalContext).toBe("# breadcrumb: notes.everyone (session)\nFor every agent.");

    subagentTranscripts(join(held, ".t"), session, "aheld", { own: [JSON.stringify({ type: "user", message: { content: "Build the task. BUILD-MARKER" } })] });
    // A Read is seen after it ran: flow registers no hook before any tool but Bash.
    const first = hook("post-tool-use", { ...pre("Read", { file_path: join(held, "a.ts") }, session), ...who }, held);
    expect(first.code, first.stderr).toBe(0);
    const called = JSON.parse(first.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(called.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(called.hookSpecificOutput.additionalContext).toBe("# breadcrumb: notes.briefedOnly (session)\nFor the briefed agent.");

    const second = hook("post-tool-use", { ...pre("Read", { file_path: join(held, "a.ts") }, session), ...who }, held);
    expect(second.stdout, "shown once").not.toContain("notes.briefedOnly");
  });
});

describe("what a broken or empty call does", () => {
  it("passes an empty payload safely, on every rail", () => {
    for (const event of ["session-start", "subagent-start", "pre-tool-use", "post-tool-use", "stop", "subagent-stop", "notification"]) {
      const answer = run(["hook", event], "");
      expect(answer.code, `${event} on an empty payload`).toBe(0);
      expect(answer.stderr, `${event} said something about nothing`).toBe("");
    }
  });

  it("is loud on the one rail that judges a call when it cannot read its payload, and warns on the rest", () => {
    // "I could not SEE what I was guarding" must never be spelled like "I looked and it was fine".
    const guarded = run(["hook", "pre-tool-use"], "not json at all");
    expect(guarded.code).toBe(2);
    expect(guarded.stderr).toContain("could not PARSE its payload");
    // After a call there is nothing left to refuse, so the fault is said and the call goes on.
    for (const event of ["post-tool-use", "session-start"]) {
      const annotating = run(["hook", event], "not json at all");
      expect(annotating.code, "breaking a session over a breadcrumb is the cure killing the patient").toBe(0);
      expect(annotating.stderr).toContain(`[flow hook ${event}] could not PARSE its payload (15 bytes on stdin, and not JSON).`);
    }
  });

  it("reports a stdin it cannot read, naming the error, rather than retrying it", () => {
    // Only EAGAIN means "wait for the next piece"; any other error is a payload nobody will ever
    // see. A stdin opened for writing fails every read with EBADF. A CLOSED stdin cannot show this:
    // node reopens a closed fd 0 on /dev/null before flow's first line runs, so it reads as empty.
    const dir = mkdtempSync(join(tmpdir(), "flow-stdin-"));
    const writeOnly = openSync(join(dir, "stdin"), "w");
    try {
      const answer = runFlow(repo, ["hook", "post-tool-use"], {}, writeOnly);
      expect(answer.code, "a call that has run is not refused").toBe(0);
      expect(answer.stderr).toContain("[flow hook post-tool-use] could not READ its payload from stdin (EBADF).");
    } finally {
      closeSync(writeOnly);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is silent about an event it was never asked for", () => {
    const answer = run(["hook", "user-prompt-submit"], "{}");
    expect(answer.code).toBe(0);
    expect(answer.stdout + answer.stderr).toBe("");
  });
});

describe("a payload the host writes in pieces (#12)", () => {
  // A Read of an image hands post-tool-use a payload far larger than a pipe's buffer, so the host
  // writes it in pieces, and the hook can empty the pipe before the next piece lands. A payload read
  // only in part is not JSON, and the hook says so on stderr: so a read that went whole leaves
  // nothing to say.
  const image = (): Record<string, unknown> => ({
    ...inThisSession("Read", { file_path: "shot.png" }),
    hook_event_name: "PostToolUse",
    tool_response: { type: "image", file: { base64: "A".repeat(400_000) } },
  });

  // The preload opens `process.stdin` before flow's first line runs, and that stream sets fd 0
  // non-blocking, as a host may leave it. The read then meets EAGAIN between the pieces, and has to
  // wait the pause out rather than give up. With the wait loop in place, no test here fails if the
  // hand-run check goes back to `process.stdin.isTTY`: `isatty(0)` is now a cheap fast path.
  it.each<[string, readonly string[]]>([
    ["blocking", []],
    ["already non-blocking before flow starts", ["--import", "data:text/javascript,process.stdin"]],
  ])("is read whole when stdin is %s, however long the host pauses between writes", async (_stdin, nodeFlags) => {
    const answer = await hookInPieces(repo, "post-tool-use", image(), nodeFlags);
    expect(answer.code, answer.stderr).toBe(0);
    expect(answer.stderr, "the whole payload was read").toBe("");
  });
});

/**
 * The gate over EXACTLY these paths: stage them, run `flow hook commit`, unstage them.
 *
 * The gate asks git what is staged, so what one test stages is what the next one's gate judges
 * unless it is put back. This repo has no commit, so unstaging is `rm --cached` rather than a reset.
 */
function gate(...paths: string[]): Ran {
  runGit(repo, ["add", "--", ...paths]);
  try {
    return run(["hook", "commit"], "");
  } finally {
    runGit(repo, ["rm", "-q", "--cached", "--", ...paths]);
  }
}

describe("the commit gate", () => {
  it("blocks a staged file the gate refuses, naming it", () => {
    writeFileSync(join(repo, "src", "leak.ts"), "// DO-NOT-COMMIT\n");
    const answer = gate("src/leak.ts");
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — commit blocked");
    expect(answer.stderr).toContain("demo.noSecrets · src/leak.ts");
    expect(answer.stderr).toContain("Fix the above, then commit again.");
  });

  it("passes a clean staged set, and says nothing", () => {
    const answer = gate("src/a.ts");
    expect(answer.code).toBe(0);
    expect(answer.stdout + answer.stderr).toBe("");
  });

  describe("over a repo with history, under an append-only rule bound at commit", () => {
    // A repo of its own, because these need a real commit for the last commit to hold a migration.
    let other: string;
    const migration = (name: string): string => join(other, "migrations", name);
    const gateHere = (args: readonly string[] = ["hook", "commit"]): Ran => runFlow(other, args);
    /** Put the repo back to its one commit: nothing staged, every migration as committed. */
    const reset = (): void => {
      runGit(other, ["reset", "-q", "--hard"]);
      runGit(other, ["clean", "-q", "-f", "--", "migrations"]);
    };

    beforeAll(() => {
      other = newRepo("flow-append-");
      copyGuard(other);
      writeFileSync(join(other, "header.ts"), HEADER_PACK(PACKAGE));
      const config = readFileSync(join(other, "flow.config.ts"), "utf8");
      writeFileSync(
        join(other, "flow.config.ts"),
        `import { header } from "./header.ts";\n${config.replace("defineConfig([pack(demo), pack(house)])", "defineConfig([pack(demo), pack(house), pack(header)])")}`,
      );
      mkdirSync(join(other, "migrations"));
      writeFileSync(migration("001.sql"), "create table a ();\n");
      writeFileSync(migration("002.sql"), "create table b ();\n");
      runGit(other, ["add", "migrations"]);
      const first = gateHere();
      expect(first.code, `before the first commit every file is new: ${first.stderr}`).toBe(0);
      // Committed past the gate, for --all to find as committed: a file only a plain protected-file rule
      // covers, and one holding the marker the content rule noSecrets bans.
      mkdirSync(join(other, "gen"));
      writeFileSync(join(other, "gen", "a.ts"), "export const a = 1;\n");
      mkdirSync(join(other, "src"));
      writeFileSync(join(other, "src", "marked.ts"), "// DO-NOT-COMMIT\n");
      runGit(other, ["add", "gen", "src"]);
      runGit(other, ["commit", "-q", "-m", "one"]);
    });
    afterAll(() => {
      rmSync(other, { recursive: true, force: true });
    });

    it("passes a file the last commit does not have, and blocks an edit of one it does", () => {
      writeFileSync(migration("001.sql"), "drop table a;\n");
      writeFileSync(migration("003.sql"), "create table c ();\n");
      runGit(other, ["add", "migrations"]);
      try {
        const answer = gateHere();
        expect(answer.code).toBe(2);
        expect(answer.stderr).toContain("✗ demo.appendOnly");
        expect(answer.stderr, "003.sql is not in the last commit, so it is new").not.toContain("migrations/003.sql");
      } finally {
        reset();
      }
    });

    it("blocks a commit that only deletes a file — it reaches the gate, and the gate judges the deletion", () => {
      runGit(other, ["rm", "-q", "migrations/002.sql"]);
      try {
        const answer = gateHere();
        expect(answer.code).toBe(2);
        expect(answer.stderr).toContain("✗ demo.appendOnly");
        expect(answer.stderr).toContain("is append-only");
      } finally {
        reset();
      }
    });

    it("blocks a rename by its old path — to git it is that deletion plus a new file", () => {
      runGit(other, ["mv", "migrations/001.sql", "migrations/001_renamed.sql"]);
      try {
        const answer = gateHere();
        expect(answer.code).toBe(2);
        expect(answer.stderr).toContain("✗ demo.appendOnly");
        expect(answer.stderr, "the new path is new, and passes").not.toContain("001_renamed.sql");
        const old = gateHere(["commit", "migrations/001_renamed.sql"]);
        expect(old.code, "the old verb an older hook calls asks git too, whatever list it passes").toBe(2);
        expect(old.stderr).toContain("✗ demo.appendOnly");
      } finally {
        reset();
      }
    });

    it("runs only the rules with .on under --all, once for each file, and none of a commit's own (#142)", () => {
      // This repo's config is untracked and carries the marker noSecrets bans, so --all refuses it
      // whatever happens here: only the lines about the rules without `.on` are this test's business.
      writeFileSync(migration("001.sql"), "drop table a;\n");
      writeFileSync(join(other, "gen", "a.ts"), "export const a = 2;\n");
      try {
        const all = gateHere(["hook", "commit", "--all"]);
        expect(all.code).toBe(2);
        expect(all.stderr, "a content rule reads each file git lists").toContain("✗ demo.noSecrets · src/marked.ts");
        expect(all.stderr, "an edit of a protected file is a commit's business, and --all has no commit").not.toContain("demo.appendOnly");
        expect(all.stderr).not.toContain("demo.keepGenerated");
        expect(all.stderr, "nor is a header, or a rule bound to who").not.toContain("header.header");
        expect(all.stderr).not.toContain("demo.buildersOnly");
      } finally {
        reset();
      }
    });

    it("lets an Edit and a shell write of a file under a content rule through, and refuses the commit that stages it", () => {
      // flow stops no write: the file lands, whatever the rule says, and nothing is kept to put it
      // back. The commit is where the file is judged.
      const marked = "// DO-NOT-COMMIT\n";
      const edit = {
        ...pre("Edit", { file_path: join(other, "src", "edited.ts"), old_string: "x", new_string: "y" }, "journey-1"),
        cwd: other,
      };
      writeFileSync(join(other, "src", "edited.ts"), marked);
      const after = runFlow(other, ["hook", "post-tool-use"], {}, JSON.stringify(edit));
      expect(after.code, after.stderr).toBe(0);
      expect(after.stderr).toBe("");

      const command = "printf '// DO-NOT-COMMIT\\n' > src/shell.ts";
      const bash = { ...pre("Bash", { command }, "journey-1"), cwd: other };
      expect(runFlow(other, ["hook", "pre-tool-use"], {}, JSON.stringify(bash)).code, "the command is judged by its words, not by what it writes").toBe(0);
      spawnSync("bash", ["-c", command], { cwd: other });
      expect(runFlow(other, ["hook", "post-tool-use"], {}, JSON.stringify(bash)).code).toBe(0);

      try {
        expect(readFileSync(join(other, "src", "edited.ts"), "utf8"), "the Edit's file is as written").toBe(marked);
        expect(readFileSync(join(other, "src", "shell.ts"), "utf8"), "the shell's file is as written").toBe(marked);
        expect(existsSync(join(other, ".flow", "snapshots")), "flow keeps no snapshot").toBe(false);

        runGit(other, ["add", "src/edited.ts", "src/shell.ts"]);
        const refused = gateHere();
        expect(refused.code).toBe(2);
        expect(refused.stderr).toContain("✗ demo.noSecrets · src/edited.ts");
        expect(refused.stderr).toContain("✗ demo.noSecrets · src/shell.ts");
      } finally {
        reset();
        rmSync(join(other, "src", "edited.ts"), { force: true });
        rmSync(join(other, "src", "shell.ts"), { force: true });
      }
    });

    it("refuses a list of files, which would be a second source of the staged set", () => {
      const answer = gateHere(["hook", "commit", "migrations/001.sql", "migrations/002.sql"]);
      expect(answer.code).toBe(2);
      expect(answer.stderr).toContain("takes no list of files");
    });

    it("judges the commit git is making through the REAL hook — a bad header, a delete-only commit, `git commit -a`, an amend, and passes a merge", () => {
      // `git commit -a` stages into a temporary index that only the hook's own GIT_INDEX_FILE names.
      // A gate that asked git without it would see nothing staged, and pass everything.
      const bin = shimBin();
      try {
        mkdirSync(join(other, ".githooks"), { recursive: true });
        writeFileSync(join(other, ".githooks", "commit-msg"), COMMIT_MSG, { mode: 0o755 });
        runGit(other, SET_HOOKS_PATH.split(" ").slice(1));
        const viaGit = (args: readonly string[]): Ran => runGit(other, args, { bin });
        const head = (): string => runGit(other, ["rev-parse", "HEAD"]).stdout.trim();

        runGit(other, ["rm", "-q", "migrations/002.sql"]);
        const deleted = viaGit(["commit", "-m", "fix: drop 002"]);
        expect(deleted.code, "git refuses when the gate exits non-zero").not.toBe(0);
        expect(deleted.stderr).toContain("demo.appendOnly");
        reset();

        writeFileSync(migration("001.sql"), "drop table a;\n");
        const all = viaGit(["commit", "-a", "-m", "fix: edit 001"]);
        expect(all.code).not.toBe(0);
        expect(all.stderr).toContain("demo.appendOnly");
        reset();

        // THE HEADER RULE reads the message as git records it, and judges a clean set all the same.
        writeFileSync(migration("004.sql"), "create table d ();\n");
        runGit(other, ["add", "migrations/004.sql"]);
        const before = head();
        const wip = viaGit(["commit", "-m", "wip"]);
        expect(wip.code, "`git commit -m wip` is refused").not.toBe(0);
        expect(wip.stderr).toContain("header.header");
        expect(wip.stderr).toContain('header is "wip"');
        expect(head(), "nothing was committed").toBe(before);
        // …and the same refusal, exit code 2, when flow is handed a message file as git hands it,
        // comment lines and all: a comment line is not the header.
        const messageFile = join(other, "msg.txt");
        writeFileSync(messageFile, "wip\n# Please enter the commit message\n");
        expect(gateHere(["hook", "commit", messageFile]).code).toBe(2);

        const added = viaGit(["commit", "-m", "fix: add 004"]);
        expect(added.code, added.stderr).toBe(0);

        // AN AMEND is judged with its message: the commit it replaces is not the one asked about.
        const amended = viaGit(["commit", "--amend", "-m", "wip"]);
        expect(amended.code).not.toBe(0);
        expect(amended.stderr).toContain("header.header");
        const kept = viaGit(["commit", "--amend", "-m", "fix: add 004, amended"]);
        expect(kept.code, kept.stderr).toBe(0);

        // A MERGE passes, whatever the branch it brings in broke: its header and its content were
        // judged, or not, where they were made. With a conflict, the commit that finishes it passes too.
        const trunk = runGit(other, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
        writeFileSync(join(other, "notes.txt"), "base\n");
        runGit(other, ["add", "notes.txt"]);
        expect(viaGit(["commit", "-m", "fix: notes"]).code).toBe(0);
        runGit(other, ["checkout", "-q", "-b", "topic"]);
        writeFileSync(join(other, "src", "bad.ts"), "// DO-NOT-COMMIT\n");
        writeFileSync(join(other, "notes.txt"), "topic\n");
        runGit(other, ["add", "src/bad.ts", "notes.txt"]);
        expect(viaGit(["commit", "-m", "wip", "--no-verify"]).code, "the branch broke the header and a content rule").toBe(0);
        runGit(other, ["checkout", "-q", trunk]);
        writeFileSync(join(other, "migrations", "005.sql"), "create table e ();\n");
        runGit(other, ["add", "migrations/005.sql"]);
        expect(viaGit(["commit", "-m", "fix: add 005"]).code).toBe(0);
        const clean = viaGit(["merge", "--no-ff", "-m", "Merge topic", "topic"]);
        expect(clean.code, clean.stderr).toBe(0);
        expect(runGit(other, ["rev-parse", "HEAD^2"]).code, "a merge commit, with two parents").toBe(0);
        expect(runGit(other, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("Merge topic");

        runGit(other, ["checkout", "-q", "-b", "clash", "HEAD~1"]);
        writeFileSync(join(other, "notes.txt"), "clash\n");
        runGit(other, ["add", "notes.txt"]);
        expect(viaGit(["commit", "-m", "fix: clash"]).code).toBe(0);
        const conflicted = viaGit(["merge", "--no-ff", "topic"]);
        expect(conflicted.code, "the merge stops on a conflict").not.toBe(0);
        writeFileSync(join(other, "notes.txt"), "resolved\n");
        runGit(other, ["add", "notes.txt"]);
        const finished = viaGit(["commit", "--no-edit"]);
        expect(finished.code, finished.stderr).toBe(0);
        expect(runGit(other, ["rev-parse", "HEAD^2"]).code).toBe(0);
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    });
  });

  it("blocks when a gate's own tool is not installed — a missing binary is 127, never a pass", () => {
    // The live World's answer, end to end: the engine turns the non-zero exit into a block naming
    // the entry and the command. A throw here would have been swallowed as "the check threw" and a
    // repo whose tool was missing would have had a silently weaker gate.
    mkdirSync(join(repo, "tool"), { recursive: true });
    writeFileSync(join(repo, "tool", "x.ts"), "export const x = 1;\n");
    const answer = gate("tool/x.ts");
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("demo.suitePasses");
    expect(answer.stderr).toContain("definitely-not-a-real-binary-xyz");
    expect(answer.stderr.toLowerCase()).toContain("command not found");
  });

  it("wears the categories of the session x agent the marker names, so .for(…) fires at commit too", () => {
    // The handshake at full stretch. The gate is spawned by git with no session in the room, so an
    // actor-scoped commit rule can only fire if the marker says WHICH agent was working — the field
    // whose absence used to silence such a rule while it read as armed.
    writeFileSync(join(repo, "plan.yaml"), "phases: []\n");
    expect(gate("plan.yaml").code, "nobody has been classified yet").toBe(0);

    // The message Claude Code sends for a subagent's call: its id and type, and the parent's path.
    const { parent } = subagentTranscripts(join(repo, ".t"), "live-b", "b1", {
      parent: [JSON.stringify({ type: "user", message: { content: "run it" } })],
      own: [JSON.stringify({ type: "user", message: { content: "Follow `/work build`" } })],
    });
    const asBuilder = hook("pre-tool-use", {
      session_id: "live-b",
      agent_id: "b1",
      agent_type: "builder",
      transcript_path: parent,
      tool_name: "Write",
      tool_input: { file_path: join(repo, "src/ok.ts"), content: "export const ok = 1;\n" },
    });
    expect(asBuilder.code, "the write itself is fine — this is only how the session gets classified").toBe(0);

    const blocked = gate("plan.yaml");
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("demo.buildersOnly");
    expect(blocked.stderr).toContain("the plan's shape is the parent's");
  });

  it("attributes its rows to the session the marker names", () => {
    // The gate runs outside any session. Without the handshake its refusals would land in a shared
    // `commit` stream instead of the chat that caused them.
    expect(rows(repo, "live-1").some((row) => row["kind"] === "run" && row["moment"] === "commit")).toBe(true);
  });
});

// After the commit gate on purpose: these sessions write the marker the gate reads.
/**
 * A repo of its own for the file-change journey: a session breadcrumb, a note about `src/` and one
 * about `docs/`, bound at `fileChange`; a repo with a first commit, a linked worktree of it, and a
 * folder outside it. `src/ignored.log` is ignored by git. The caller removes `parent`.
 */
function repoForChanges(): { parent: string; where: string; worktree: string; outside: string } {
  const parent = mkdtempSync(join(tmpdir(), "flow-change-"));
  const where = join(parent, "app");
  const worktree = join(parent, "app-feature");
  const outside = join(parent, "scratch");
  mkdirSync(join(where, "src"), { recursive: true });
  mkdirSync(join(where, "docs"));
  mkdirSync(outside);
  expect(runGit(where, ["init", "-q"]).code).toBe(0);
  writeFileSync(join(where, ".gitignore"), "*.log\n.flow/\n");
  writeFileSync(join(where, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(where, "flow.config.ts"), `
import { breadcrumb, defineConfig, definePack, fileChange, pack, session } from ${JSON.stringify(join(PACKAGE, "index.ts"))};

export default defineConfig([
  pack(
    definePack("demo", {
      hello: breadcrumb().at(session).text("Guarded."),
      area: breadcrumb().at(fileChange).on("src/**").text("src/ is the product — its tests sit beside it."),
      docs: breadcrumb().at(fileChange).on("docs/**").text("docs/ is for people."),
    }),
  ),
]);
`);
  expect(runGit(where, ["add", "-A"]).code).toBe(0);
  expect(runGit(where, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"]).code).toBe(0);
  expect(runGit(where, ["worktree", "add", "-q", "-b", "feature", worktree]).code).toBe(0);
  return { parent, where, worktree, outside };
}

/** What a hook answered to the agent, or nothing. */
const told = (ran: Ran): string => (ran.stdout === "" ? "" : (JSON.parse(ran.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext);

/** The breadcrumb text, headed as the agent reads it. */
const AREA = "# breadcrumb: demo.area (file-change)\nsrc/ is the product — its tests sit beside it.";
const DOCS = "# breadcrumb: demo.docs (file-change)\ndocs/ is for people.";

describe("a file change, briefed", () => {
  it("shows a breadcrumb after a shell command changes a file under its globs, once; a read shows nothing; after a compaction the next change shows it again", () => {
    const { parent, where } = repoForChanges();
    try {
      const shell = (line: string, effect: () => void): Ran => called({ ...pre("Bash", { command: line }, "change-1"), cwd: where }, effect, "post-tool-use", where);
      const write = (file: string, content: string) => (): void => { writeFileSync(join(where, file), content); };

      const read = shell("cat src/a.ts", () => undefined);
      expect(read.code, read.stderr).toBe(0);
      expect(read.stdout, "a read of a file under the globs shows nothing").toBe("");

      const first = shell("echo 'export const a = 2;' > src/a.ts", write("src/a.ts", "export const a = 2;\n"));
      expect(first.code, first.stderr).toBe(0);
      const decision = JSON.parse(first.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
      expect(decision.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(decision.hookSpecificOutput.additionalContext, "shown after the call, with its result").toBe(AREA);

      const second = shell("echo 'export const a = 3;' > src/a.ts", write("src/a.ts", "export const a = 3;\n"));
      expect(second.stdout, "a second change to the same file shows nothing").toBe("");
      const other = shell("echo 'export const b = 1;' > src/b.ts", write("src/b.ts", "export const b = 1;\n"));
      expect(other.stdout, "nor does another file in the same area: it is shown once").toBe("");

      const ignored = shell("echo x > src/ignored.log", write("src/ignored.log", "x\n"));
      expect(ignored.stdout, "a file git ignores is not in git's list").toBe("");
      const unrelated = shell("echo hi > notes.txt", write("notes.txt", "hi\n"));
      expect(unrelated.stdout, "a file under no breadcrumb's globs").toBe("");

      const kept = hook("session-start", { ...pre("Bash", {}, "change-1"), hook_event_name: "SessionStart", source: "resume", cwd: where }, where);
      expect(kept.stdout, "a resume that keeps the session shows its breadcrumb once, and that was at its start").not.toBe("");
      const resumed = hook("session-start", { ...pre("Bash", {}, "change-1"), hook_event_name: "SessionStart", source: "resume", cwd: where }, where);
      expect(resumed.stdout, "and not again").toBe("");

      const compacted = hook("session-start", { ...pre("Bash", {}, "change-1"), hook_event_name: "SessionStart", source: "compact", cwd: where }, where);
      expect(compacted.stdout, "a compaction shows a session breadcrumb at once").toContain("# breadcrumb: demo.hello (session)\\nGuarded.");
      expect(compacted.stdout, "and the area breadcrumb only at its own moment").not.toContain("demo.area");

      const again = shell("echo 'export const a = 4;' > src/a.ts", write("src/a.ts", "export const a = 4;\n"));
      expect(told(again), "the next change after a compaction").toBe(AREA);

      const log = rows(where, "change-1");
      const changes = log.filter((row) => row["kind"] === "change");
      expect(changes.map((row) => [row["tool"], row["paths"]]), "each call that changed a file is a `change` row, and a read is none").toEqual([
        ["Bash", ["src/a.ts"]],
        ["Bash", ["src/a.ts"]],
        ["Bash", ["src/b.ts"]],
        ["Bash", ["notes.txt"]],
        ["Bash", ["src/a.ts"]],
      ]);
      const shown = log.filter((row) => row["kind"] === "breadcrumb" && row["id"] === "demo.area");
      expect(shown.map((row) => [row["moment"], row["cause"], row["subject"]]), "shown twice, each the first time for the agent").toEqual([
        ["file-change", "first", "src/a.ts"],
        ["file-change", "first", "src/a.ts"],
      ]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("finds the files an edit tool changed, a commit made inside the call, and a file changed again, and shows a breadcrumb for each area once", () => {
    const { parent, where } = repoForChanges();
    try {
      const edit = (file: string, content: string): Ran => {
        const path = join(where, file);
        return called({ ...pre("Write", { file_path: path, content }, "change-2"), cwd: where }, () => { writeFileSync(path, content); }, "post-tool-use", where);
      };
      expect(told(edit("src/a.ts", "export const a = 2;\n")), "an edit tool's change, with no hook before it").toBe(AREA);
      expect(edit("src/a.ts", "export const a = 3;\n").stdout).toBe("");

      // A change AND a commit in one command: the file leaves git's list by being committed, so only
      // the commit's own files say it was changed.
      const line = "echo hi > docs/x.md && git add docs/x.md && git commit -qm 'docs: x'";
      const committed = called({ ...pre("Bash", { command: line }, "change-2"), cwd: where }, () => {
        writeFileSync(join(where, "docs", "x.md"), "hi\n");
        runGit(where, ["add", "docs/x.md"]);
        runGit(where, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "docs: x"]);
      }, "post-tool-use", where);
      expect(told(committed), "a file changed and committed in one call leaves git's list: the commit's files say it").toBe(DOCS);
      expect(rows(where, "change-2").filter((row) => row["kind"] === "change").map((row) => row["paths"])).toEqual([["src/a.ts"], ["src/a.ts"], ["docs/x.md"]]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("reads another worktree of the repo when the call worked in it, by the config of the folder the session started in", () => {
    const { parent, where, worktree, outside } = repoForChanges();
    try {
      // The worktree's own config says something else: it is the session folder's that judges.
      writeFileSync(join(worktree, "flow.config.ts"), readFileSync(join(where, "flow.config.ts"), "utf8").replace("src/ is the product", "THE WORKTREE'S OWN WORDS"));
      const write = (path: string, agent?: string): Ran => {
        const payload = { ...pre("Write", { file_path: path, content: "x\n" }, "worktree"), ...(agent === undefined ? {} : { agent_id: agent, agent_type: "general-purpose" }) };
        return called(payload, () => { writeFileSync(path, "x\n"); }, "post-tool-use", where);
      };
      const shell = (line: string, who: string, cwd = where): Ran =>
        called({ ...pre("Bash", { command: line }, who), cwd }, () => { spawnSync("bash", ["-c", line], { cwd }); }, "post-tool-use", where);
      mkdirSync(join(worktree, "docs"));

      const written = write(join(worktree, "src", "new.ts"));
      expect(written.code, written.stderr).toBe(0);
      expect(told(written), "an edit tool's file in another worktree, judged by the session folder's config").toBe(AREA);
      expect(readFileSync(join(worktree, "src", "new.ts"), "utf8"), "the call went through and nothing was written back").toBe("x\n");
      expect(written.stdout, "and no message that flow does not guard the worktree").not.toContain("does not guard");

      const viaShell = shell(`cd ${worktree} && echo hi > docs/y.md`, "worktree-shell");
      expect(told(viaShell), "a command that ran in the worktree: its before and after are the worktree's").toBe(DOCS);
      const viaSession = shell("echo hi > docs/z.md", "worktree-cwd", worktree);
      expect(told(viaSession), "a command whose session folder is the worktree").toBe(DOCS);

      const subagent = write(join(worktree, "src", "agent.ts"), "agent-1");
      expect(told(subagent), "a subagent is shown it for itself").toBe(AREA);

      const nested = join(where, ".claude", "worktrees", "agent-2");
      expect(runGit(where, ["worktree", "add", "-q", "-b", "agent-2", nested]).code).toBe(0);
      expect(told(write(join(nested, "src", "n.ts"), "agent-2")), "a worktree nested under the session folder").toBe(AREA);

      const elsewhere = shell(`cd ${outside} && echo hi > e.ts`, "worktree-out");
      expect(elsewhere.code, elsewhere.stderr).toBe(0);
      expect(told(elsewhere), "a folder outside the repository is no worktree of it").toBe("");
      const log = rows(where, "worktree-out").filter((row) => row["kind"] === "change");
      expect(log, "and a change there is no change of the repo").toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

/**
 * A throwaway parent folder holding a guarded repo, `app`, with a config; a linked worktree of it,
 * `app-feature`; and `scratch`, a folder outside the repository. The caller removes `parent`.
 */
function repoWithWorktree(): { parent: string; where: string; worktree: string; outside: string } {
  const parent = mkdtempSync(join(tmpdir(), "flow-worktree-"));
  const where = join(parent, "app");
  const worktree = join(parent, "app-feature");
  const outside = join(parent, "scratch");
  mkdirSync(where);
  mkdirSync(outside);
  expect(runGit(where, ["init", "-q"]).code).toBe(0);
  writeFileSync(join(where, "flow.config.ts"), `
import { breadcrumb, defineConfig, definePack, pack, session } from ${JSON.stringify(join(PACKAGE, "index.ts"))};

export default defineConfig([pack(definePack("demo", { hello: breadcrumb().at(session).text("Guarded.") }))]);
`);
  expect(runGit(where, ["add", "-A"]).code).toBe(0);
  expect(runGit(where, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"]).code).toBe(0);
  expect(runGit(where, ["worktree", "add", "-q", "-b", "feature", worktree]).code).toBe(0);
  return { parent, where, worktree, outside };
}

describe("work outside the repository — judged only by a rule marked .everywhere()", () => {
  it("refuses a hard reset from a linked worktree, passes it in a scratch repo outside, and still refuses a force-push there", () => {
    const { parent, where, worktree, outside } = repoWithWorktree();
    try {
      writeFileSync(join(where, "everywhere.ts"), fixturePack("everywhere-pack", join(PACKAGE, "index.ts")));
      writeFileSync(join(where, "flow.config.ts"), `
import { defineConfig, pack } from ${JSON.stringify(join(PACKAGE, "index.ts"))};
import { git } from "./everywhere.ts";

export default defineConfig([pack(git)]);
`);
      const command = (line: string): Ran => hook("pre-tool-use", { ...pre("Bash", { command: line }, "outside"), cwd: where }, where);

      const fromWorktree = command(`cd ${worktree} && git reset --hard HEAD~1`);
      expect(fromWorktree.code, `a worktree of this repository is inside; flow said:\n${fromWorktree.stderr}`).toBe(2);
      expect(fromWorktree.stderr).toContain("git.noHardReset");

      const scratch = command(`cd ${outside} && git init -q && git reset --hard HEAD~1`);
      expect(scratch.code, `a scratch repo outside is not this repository's; flow said:\n${scratch.stderr}`).toBe(0);

      const forced = command(`cd ${outside} && git push --force origin main`);
      expect(forced.code, "git.noForcePush is marked .everywhere()").toBe(2);
      expect(forced.stderr).toContain("git.noForcePush");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("a subagent's drift and turn, read from its own transcript — never its parent's", () => {
  // The hook message for a subagent's call carries the PARENT's transcript_path (#7). Its brief is
  // pinned above; these pin the other two things read from the same file. The two transcripts are
  // made to disagree, so a call judged on the parent's would answer the other way.
  const SESSION = "own-7";
  const AGENT = "s7";
  let parent: string;
  let own: string;

  const usage = (tokens: number): string =>
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens } } });
  const prompt = (content: string): string => JSON.stringify({ type: "user", message: { content } });
  const used = (tool: string, input: Record<string, unknown>): string =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: tool, input }] } });
  /** Four edits and nothing run — what the repo's turn-end rule refuses. */
  const edits = (): string[] => ["a", "b", "c", "d"].map((name) => used("Write", { file_path: join(repo, "src", `${name}.ts`), content: "" }));
  const lines = (...each: string[]): string => `${each.join("\n")}\n`;

  /** The subagent's message, as the host sends it: its id and type, and the parent's transcript. */
  const asSubagent = (payload: Record<string, unknown>): Record<string, unknown> => ({
    session_id: SESSION,
    agent_id: AGENT,
    agent_type: "general-purpose",
    transcript_path: parent,
    ...payload,
  });
  /** The subagent changes a file of its own, new each time: a change in `src/`, which the area note is about. */
  let changed = 0;
  const read = (): Ran => {
    const path = join(repo, "src", `drift-${++changed}.ts`);
    return called(asSubagent({ tool_name: "Write", tool_input: { file_path: path, content: "x\n" } }), () => { writeFileSync(path, "x\n"); });
  };

  beforeAll(() => {
    ({ parent, own } = subagentTranscripts(join(repo, ".t"), SESSION, AGENT));
  });

  it("measures drift on the subagent's own context, so a note comes back when IT has moved on", () => {
    writeFileSync(parent, lines(prompt("go"), usage(400_000)));
    writeFileSync(own, lines(prompt("look at src"), usage(1_000)));
    expect(read().stdout, "the first change").toContain("src/ is the product");

    writeFileSync(parent, lines(prompt("go"), usage(900_000)));
    expect(read().stdout, "the parent has drifted, the subagent has not").toBe("");

    writeFileSync(own, lines(prompt("look at src"), usage(400_000)));
    expect(read().stdout, "the subagent has drifted past the threshold").toContain("src/ is the product");
  });

  it("judges the turn the subagent took, not the one its parent took", () => {
    const stop = (): Ran => hook("stop", asSubagent({ hook_event_name: "Stop" }));

    writeFileSync(parent, lines(prompt("go"), ...edits()));
    writeFileSync(own, lines(prompt("look at src"), used("Bash", { command: "npm test" }), ...edits().slice(0, 1)));
    const ran = stop();
    expect(ran.code, `the subagent ran something this turn: ${ran.stderr}`).toBe(0);

    writeFileSync(parent, lines(prompt("go"), used("Bash", { command: "npm test" })));
    writeFileSync(own, lines(prompt("look at src"), ...edits()));
    const untested = stop();
    expect(untested.code).toBe(2);
    expect(untested.stderr).toContain("You edited all turn and ran nothing.");
  });
});

describe("a subagent's hand-back, at SubagentStop — the turn-end rules, for the subagent", () => {
  // The payload as Claude Code sends it when a subagent hands back: its id and type, the PARENT's
  // transcript_path, and its own beside it. Each case is its own agent id, because who an agent is
  // is remembered per session × agent.
  const SESSION = "hand-back";
  let ids = 0;

  const prompt = (content: string): string => JSON.stringify({ type: "user", message: { content } });
  const used = (tool: string, input: Record<string, unknown>): string =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: tool, input }] } });
  const wrote = (name: string): string => used("Write", { file_path: join(repo, name), content: "" });
  /** Four edits and nothing run — what the repo's turn-end rule, bound for everyone, refuses. */
  const untested = (): string[] => ["a", "b", "c", "d"].map((name) => wrote(`src/${name}.ts`));
  const setting = (name: string): string => JSON.stringify({ type: "agent-setting", agentSetting: name, sessionId: SESSION });

  /** Write the parent's transcript and this subagent's own, then hand back as the host would. */
  const handBack = (type: string, own: readonly string[], over: Record<string, unknown> = {}, parentLines: readonly string[] = [prompt("go")]): Ran => {
    const id = `ahb${++ids}`;
    const at = subagentTranscripts(join(repo, ".t"), SESSION, id, { parent: parentLines, own: [prompt("do the phase"), ...own] });
    return hook("subagent-stop", subagentStopPayload(SESSION, id, type, at, { cwd: repo, permission_mode: "default", last_assistant_message: "done", ...over }));
  };

  it("is refused by a rule with no .for(…): exit 2, its message on stderr", () => {
    const held = handBack("Explore", untested());
    expect(held.code).toBe(2);
    expect(held.stderr).toContain("flow — turn held open");
    expect(held.stderr).toContain("You edited all turn and ran nothing.");
    expect(held.stdout).toBe("");
  });

  it("runs a .for(…) rule only for an agent that has one of its categories", () => {
    const edited = [wrote("plan.yaml")];
    const builder = handBack("builder", edited);
    expect(builder.code, "a builder that edited the plan is held").toBe(2);
    expect(builder.stderr).toContain("A builder hands back its phase, not a new plan");
    const other = handBack("Explore", edited);
    expect(other.code, `a subagent that is not a builder is let through: ${other.stderr}`).toBe(0);
    expect(other.stderr).toBe("");
  });

  it("runs no rule for an internal agent: an empty type, or the type the session itself runs as", () => {
    const unnamed = handBack("", untested());
    expect(unnamed.code, `a session run as no agent: ${unnamed.stderr}`).toBe(0);
    expect(unnamed.stderr).toBe("");
    const own = handBack("leader", untested(), {}, [setting("leader"), prompt("go")]);
    expect(own.code, `a session run --agent leader: ${own.stderr}`).toBe(0);
    expect(own.stderr).toBe("");
    const spawned = handBack("builder", untested(), {}, [setting("leader"), prompt("go")]);
    expect(spawned.code, "a builder that session spawned is still judged").toBe(2);
  });

  it("reads ctx.turn from the subagent's own transcript, and not its parent's", () => {
    const ran = handBack("Explore", [used("Bash", { command: "npm test" }), wrote("src/a.ts")], {}, [prompt("go"), ...untested()]);
    expect(ran.code, `the parent edited all turn, the subagent ran something: ${ran.stderr}`).toBe(0);
    const edited = handBack("Explore", untested(), {}, [prompt("go"), used("Bash", { command: "npm test" })]);
    expect(edited.code, "the subagent edited all turn, its parent ran something").toBe(2);
    expect(edited.stderr).toContain("You edited all turn and ran nothing.");
  });

  it("holds an agent once: a hand-back with stop_hook_active set is let through", () => {
    const again = handBack("Explore", untested(), { stop_hook_active: true });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stderr).toBe("");
  });
});

describe("a turn-end note, shown when an agent hands back — at Stop and SubagentStop", () => {
  // A repo of its own, because a turn-end note in the suite's shared config would ride every other
  // hand-back above. One note, one turn-end rule, and a drift of 50,000 tokens.
  let notes: string;
  let ids = 0;
  const NOTE = "# breadcrumb: notes.recap (turn-end)\nWrite the recap before you hand back.";

  const usage = (tokens: number): string =>
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens } } });
  const prompt = (content: string): string => JSON.stringify({ type: "user", message: { content } });
  const wrote = (name: string): string =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: join(notes, name), content: "" } }] } });
  const lines = (...each: string[]): string => `${each.join("\n")}\n`;

  /** The main chat hands back, its transcript written first: a fresh session unless one is named. */
  const stop = (own: readonly string[], over: Record<string, unknown> = {}, session = `note-${++ids}`): Ran => {
    const path = join(notes, ".t", `${session}.jsonl`);
    writeFileSync(path, lines(prompt("go"), ...own));
    return runFlow(notes, ["hook", "stop"], {}, JSON.stringify({ session_id: session, transcript_path: path, hook_event_name: "Stop", stop_hook_active: false, ...over }));
  };
  /** A subagent of that session hands back, its own transcript written first under the parent's. */
  const subagentStop = (session: string, id: string, own: readonly string[]): Ran => {
    // The parent's turn is kept when the main chat of this session already wrote one.
    const at = subagentTranscripts(join(notes, ".t"), session, id, { own: [prompt("do the phase"), ...own] });
    if (!existsSync(at.parent)) writeFileSync(at.parent, lines(prompt("go")));
    return runFlow(notes, ["hook", "subagent-stop"], {}, JSON.stringify(subagentStopPayload(session, id, "Explore", at)));
  };
  /** The context a note is shown in, the whole JSON answer read back. */
  const context = (ran: Ran): unknown => (ran.stdout === "" ? null : JSON.parse(ran.stdout));
  const told = (event: string, note: string): unknown => ({ hookSpecificOutput: { hookEventName: event, additionalContext: note } });

  beforeAll(() => {
    notes = newRepo("flow-turn-note-");
    mkdirSync(join(notes, ".t"), { recursive: true });
    writeFileSync(
      join(notes, "flow.config.ts"),
      `import { breadcrumb, defineConfig, definePack, guardrail, pack, turnEnd } from ${JSON.stringify(join(PACKAGE, "index.ts"))};

const notes = definePack("notes", {
  recap: breadcrumb().at(turnEnd).text("Write the recap before you hand back."),

  ranSomething: guardrail()
    .at(turnEnd)
    .check((ctx) => ((ctx.turn ?? []).length > 3 ? ctx.fail("four edits, nothing run") : ctx.ok()))
    .message("You edited all turn and ran nothing. Run the suite before you hand back.")
    .test({ pass: [{ actions: [] }], block: [{ actions: ["a", "b", "c", "d"].map((path) => ({ did: "edit" as const, path })) }] }),
});

export default defineConfig([pack(notes)], { driftTokens: 50_000 });
`,
    );
  });

  afterAll(() => {
    rmSync(notes, { recursive: true, force: true });
  });

  it("is shown the first time an agent hands back, as additionalContext on the Stop and SubagentStop answers", () => {
    const session = `note-${++ids}`;
    const sub = subagentStop(session, "asub1", [usage(1_000)]);
    expect(sub.code, sub.stderr).toBe(0);
    expect(sub.stderr).toBe("");
    expect(context(sub), "a subagent").toStrictEqual(told("SubagentStop", NOTE));

    const main = stop([usage(1_000)], {}, session);
    expect(main.code, main.stderr).toBe(0);
    expect(main.stderr).toBe("");
    expect(context(main), "the main chat of the same session: a note is marked per agent").toStrictEqual(told("Stop", NOTE));
  });

  it("is shown again once the context has grown by driftTokens, and not before", () => {
    const session = `note-${++ids}`;
    expect(context(stop([usage(1_000)], {}, session)), "the first showing").toStrictEqual(told("Stop", NOTE));
    const soon = stop([usage(50_999)], {}, session);
    expect(soon.code).toBe(0);
    expect(soon.stdout, "49,999 tokens on: not yet").toBe("");
    expect(context(stop([usage(51_000)], {}, session)), "50,000 tokens on").toStrictEqual(
      told("Stop", "# breadcrumb: notes.recap (turn-end)\nWrite the recap before you hand back."),
    );
  });

  it("shows no note on a hand-back with stop_hook_active set, and so leaves it to show at the next", () => {
    const session = `note-${++ids}`;
    const held = stop([usage(1_000)], { stop_hook_active: true }, session);
    expect(held.code).toBe(0);
    expect(held.stdout).toBe("");
    expect(held.stderr).toBe("");
    expect(context(stop([usage(1_000)], {}, session)), "not marked shown").toStrictEqual(told("Stop", NOTE));
  });

  it("passes a refusal and a note at the same hand-back to the agent together", () => {
    const session = `note-${++ids}`;
    const held = stop([usage(1_000), wrote("a.ts"), wrote("b.ts"), wrote("c.ts"), wrote("d.ts")], {}, session);
    expect(held.code).toBe(2);
    expect(held.stdout).toBe("");
    expect(held.stderr).toContain("flow — turn held open");
    expect(held.stderr).toContain("You edited all turn and ran nothing.");
    expect(held.stderr, "the note rides the refusal").toContain(NOTE);
    expect(stop([usage(1_000)], {}, session).stdout, "and it was shown, so the next hand-back is quiet").toBe("");

    const sub = subagentStop(session, "asub2", [usage(1_000), wrote("a.ts"), wrote("b.ts"), wrote("c.ts"), wrote("d.ts")]);
    expect(sub.code, "a subagent's hand-back is held the same way").toBe(2);
    expect(sub.stdout).toBe("");
    expect(sub.stderr).toContain("flow — turn held open");
    expect(sub.stderr).toContain("You edited all turn and ran nothing.");
    expect(sub.stderr, "with its own first note beside the refusal").toContain(NOTE);
  });
});

describe("a subagent's hand-back, recorded though nothing is bound at turn-end", () => {
  // A repo of its own, whose config binds nothing at turn-end, with the recorder armed. A hand-back
  // with no turn-end entry is answered before a transcript is read, but not while recording: a tape
  // replayed against a turn-end rule added later must still hold every hand-back.
  let taped: string;
  const SESSION = "taped-1";

  beforeAll(() => {
    taped = newRepo("flow-taped-");
    mkdirSync(join(taped, ".flow"), { recursive: true });
    writeFileSync(join(taped, ".flow", "record"), "");
    writeFileSync(
      join(taped, "flow.config.ts"),
      `import { breadcrumb, defineConfig, definePack, pack, session } from ${JSON.stringify(join(PACKAGE, "index.ts"))};

export default defineConfig([pack(definePack("quiet", { hello: breadcrumb().at(session).text("Hello.") }))]);
`,
    );
  });

  afterAll(() => {
    rmSync(taped, { recursive: true, force: true });
  });

  it("puts the hand-back's turn-end steps on the tape, once", () => {
    const prompt = JSON.stringify({ type: "user", message: { content: "do the phase" } });
    const at = subagentTranscripts(join(taped, ".t"), SESSION, "atape1", { parent: [prompt], own: [prompt] });
    const ran = runFlow(taped, ["hook", "subagent-stop"], {}, JSON.stringify(subagentStopPayload(SESSION, "atape1", "Explore", at)));
    expect(ran.code, ran.stderr).toBe(0);

    // Both turn-end rails are canonical events, the guardrails and the notes, so a replay against
    // either kind added later re-runs this hand-back.
    expect(tapeSteps(taped, SESSION)).toEqual(["guard turn-end", "brief turn-end"]);
  });
});

describe("the off switch", () => {
  it("silences every rail, and writes no telemetry while it is off", () => {
    writeFileSync(join(repo, ".flow", "off"), "");
    const before = rows(repo, "live-1").length;
    expect(hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" })).code).toBe(0);
    expect(gate("src/leak.ts").code).toBe(0);
    expect(rows(repo, "live-1").length, "a half-off guard that still logged would make the A/B dishonest").toBe(before);
    rmSync(join(repo, ".flow", "off"));
  });
});

describe("a config that will not load", () => {
  /** Break the config one of the `BREAKS` ways, drive the rails, and put the good config back. */
  const withBrokenConfig = (breaker: (good: string) => string, drive: () => void): void => {
    const good = readFileSync(join(repo, "flow.config.ts"), "utf8");
    writeFileSync(join(repo, "flow.config.ts"), breaker(good));
    try {
      drive();
    } finally {
      writeFileSync(join(repo, "flow.config.ts"), good);
    }
  };

  // The load error, whichever of its two spellings: a module that would not import, or a grammar
  // that refused what it imported.
  const LOAD_ERROR = /flow: (flow\.config\.ts could not be loaded|the config will not load)/;

  /** What an allowed answer hands the agent: the PreToolUse `additionalContext`, or "". */
  const context = (answer: Ran): string => {
    if (answer.stdout.trim() === "") return "";
    const parsed = JSON.parse(answer.stdout) as { hookSpecificOutput?: { additionalContext?: string } };
    return parsed.hookSpecificOutput?.additionalContext ?? "";
  };

  /** A call went through, and the agent was told that flow is off and why. */
  const throughAndTold = (answer: Ran, what: string): void => {
    expect(answer.code, `${what} is let through: ${answer.stderr}`).toBe(0);
    expect(answer.stderr, `${what} is not refused`).toBe("");
    expect(context(answer), `${what} carries the load error`).toMatch(LOAD_ERROR);
    expect(context(answer), `${what} says flow is off`).toContain(FLOW_OFF);
  };

  // EVERY WAY OF BREAKING IT, not just the one the shell happened to catch as a thrown error. Each
  // call below is one a working rule in this config refuses, so "let through" is the broken state
  // and not a rule that happened to pass.
  it.each(Object.entries(BREAKS))("lets a command through before it runs, and an edit after it ran, each with the load error — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "rm migrations/001.sql" })), "a delete");
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" })), "a command");
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "npm ci" })), "the install that fixes a missing package");
      // No hook runs before an Edit or a Write, so the agent is told once the call has run.
      throughAndTold(
        hook("post-tool-use", inThisSession("Edit", { file_path: join(repo, "src/a.ts"), old_string: "export const a = 1;", new_string: "// TODO" })),
        "an edit",
      );
      expect(context(hook("post-tool-use", inThisSession("Bash", { command: "npm ci" }))), "a command was told before it ran").toBe("");
    });
  });

  it.each(Object.entries(BREAKS))("still refuses the commit, with the load error — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const gated = runFlow(repo, ["hook", "commit"]);
      expect(gated.code, "a commit while the guard cannot run is a commit nothing checked").toBe(2);
      expect(gated.stderr).toMatch(LOAD_ERROR);
    });
  });

  // THE TURN ENDS. Holding it prevents nothing — the commit gate stays shut — while it does stop the
  // agent handing back to the one person who can fix the config.
  it.each(Object.entries(BREAKS))("reports the fault at Stop and lets the turn end — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const stop = hook("stop", { session_id: "live-stop", hook_event_name: "Stop" });
      expect(stop.code, "a held turn cannot hand back to the human who would fix it").toBe(0);
      expect(stop.stderr, "and it is not silent — the turn ends knowing why").toMatch(LOAD_ERROR);
      expect(stop.stderr, "the sentence turn-end is told with, not just any stderr").toContain(FLOW_OFF);
    });
  });

  it.each(Object.entries(BREAKS))("reports the fault at SubagentStop and lets the subagent hand back — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const handBack = hook("subagent-stop", {
        session_id: "live-stop",
        hook_event_name: "SubagentStop",
        agent_id: "abroken",
        agent_type: "general-purpose",
        stop_hook_active: false,
      });
      expect(handBack.code, "a held subagent cannot hand back to the agent that would fix it").toBe(0);
      expect(handBack.stderr, "the load error goes to standard error").toMatch(LOAD_ERROR);
      expect(handBack.stderr).toContain(FLOW_OFF);
      expect(handBack.stdout).toBe("");
    });
  });

  it.each(Object.entries(BREAKS))("greets the session with the load error — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const greeting = hook("session-start", { session_id: "live-3", source: "startup" });
      expect(greeting.code, "refusing the opening greeting would wedge the session before anyone read why").toBe(0);
      expect(context(greeting)).toMatch(LOAD_ERROR);
    });
  });

  it.each(Object.entries(BREAKS))("starts a subagent with the load error — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const start = hook("subagent-start", {
        session_id: "live-3",
        hook_event_name: "SubagentStart",
        agent_id: "abroken",
        agent_type: "general-purpose",
      });
      expect(start.code, "a subagent refused at its start would never read why").toBe(0);
      expect((JSON.parse(start.stdout) as { hookSpecificOutput: { hookEventName: string } }).hookSpecificOutput.hookEventName).toBe("SubagentStart");
      expect(context(start)).toMatch(LOAD_ERROR);
    });
  });

  it("changes nothing at all when the config is healthy", () => {
    // Letting everything through is keyed on the BROKEN state and nowhere else: with a working
    // config, the same command is judged on its rules and refused.
    const ordinary = hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" }));
    expect(ordinary.code).toBe(2);
    expect(ordinary.stderr).toContain("Never force-push");
  });
});

describe("a repo that has never heard of flow", () => {
  it("says nothing at all — the hooks are registered globally and fire everywhere", () => {
    const bare = mkdtempSync(join(tmpdir(), "flow-bare-"));
    try {
      const answer = runFlow(bare, ["hook", "pre-tool-use"], {}, JSON.stringify(pre("Write", { file_path: join(bare, "src/a.ts"), content: "TODO" })));
      expect(answer.code).toBe(0);
      expect(answer.stdout + answer.stderr).toBe("");
      expect(existsSync(join(bare, ".flow")), "and leaves nothing behind").toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RECORDING AND REPLAY — J5.2, driven end to end
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A whole session is driven through the real binary with the recorder armed, and then replayed
// with `--against` its own log. THE PROOF IS AN EMPTY DIFF: the same rules refused the same
// subjects and the same notes showed for the same causes, from a file, with no repo state, no
// harness and no commands run.
//
// It is driven rather than hand-written on purpose. A fixture somebody typed proves that replay
// agrees with what they expected; a fixture the guard recorded while it was working proves replay
// agrees with what actually happened, which is the only version of the claim worth anything.

describe("a recorded session, replayed", () => {
  /** The chat this block drives. Its own id, so the log and the recording hold only its steps. */
  const SESSION = "record-1";
  let transcript: string;

  /**
   * The session's own transcript, as the host would have written it so far.
   *
   * It is what makes DRIFT real here rather than simulated: the token count the breadcrumb rail
   * reads comes from the last `usage` record in this file, so growing the file is how the session
   * "moves on" — the same input the live rail takes, from the same place.
   */
  const drifted = (tokens: number): void => {
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", timestamp: "2026-09-04T10:00:00.000Z", cwd: repo, message: { content: "go" } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-09-04T10:00:01.000Z", message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens } } }),
        "",
      ].join("\n"),
    );
  };

  const inSession = (payload: Record<string, unknown>): Record<string, unknown> => ({
    session_id: SESSION,
    transcript_path: transcript,
    ...payload,
  });

  beforeAll(() => {
    mkdirSync(join(repo, ".t"), { recursive: true });
    transcript = join(repo, ".t", `${SESSION}.jsonl`);
    drifted(1000);
    // The recorder is armed by an existence-file, exactly as the kill switch is turned off by one:
    // capture is what you reach for the moment something misbehaves, and a mechanism that needs a
    // config edit is one nobody arms in time to catch the bug they were looking at.
    writeFileSync(join(repo, ".flow", "record"), "");
  });

  afterAll(() => {
    rmSync(join(repo, ".flow", "record"), { force: true });
  });

  it("drives a whole session: greeting, first change, drift, compaction, two blocks and a commit", () => {
    // 1 — the greeting. The session breadcrumb shows, and is MARKED there. Git's list is read here
    // too, so what was changed before the first call is not that call's.
    const greeting = hook("session-start", inSession({ source: "startup" }));
    expect(greeting.code).toBe(0);
    expect(greeting.stdout).toContain("This repo is guarded by flow.");

    // The files this session changes, each one new, so each is a change git's list shows.
    const changes = (file: string): Ran => {
      const path = join(repo, "src", file);
      return called(inSession({ tool_name: "Write", tool_input: { file_path: path, content: "x\n" } }), () => { writeFileSync(path, "x\n"); });
    };

    // 2 — the first change in the area. The area note shows.
    const first = changes("rec-1.ts");
    expect(first.stdout).toContain("src/ is the product");

    // 3 — the same area again, with the context barely moved. It stays quiet.
    const quiet = changes("rec-2.ts");
    expect(quiet.stdout).toBe("");

    // 4 — the session has drifted past the threshold. The note is earned again.
    drifted(400_000);
    const again = changes("rec-3.ts");
    expect(again.stdout).toContain("src/ is the product");

    // 5 — a compaction. Every mark is cleared, so the SESSION breadcrumb is shown again at once.
    const compacted = hook("session-start", inSession({ source: "compact" }));
    expect(compacted.stdout, "the greeting, again, as the compacted session starts").toContain("This repo is guarded by flow.");

    // 6 — the next change in the area, because after a compaction it is one again.
    const relearned = changes("rec-4.ts");
    expect(relearned.stdout).toContain("src/ is the product");

    // 7 and 8 — two rails refuse, which is what the replay has to land again.
    expect(hook("pre-tool-use", inSession({ tool_name: "Bash", tool_input: { command: "git push --force origin main" } })).code).toBe(2);
    expect(hook("pre-tool-use", inSession({ tool_name: "Bash", tool_input: { command: "git push --force" } })).code).toBe(2);
    // …and a Bash call that runs, so the recording holds both of its rails.
    expect(hook("pre-tool-use", inSession({ tool_name: "Bash", tool_input: { command: "echo done" } })).code).toBe(0);

    // 9 — the commit gate, whose check SHELLS OUT. Its answer is recorded, which is the part no
    // amount of re-running could reproduce later: the working tree has moved on since.
    expect(gate("tool/x.ts").code).toBe(2);
  });

  it("records the canonical event stream, harness-blind — no payload, no hook, no path", () => {
    const records = tapeRecords(repo, SESSION);
    expect(records[0]).toEqual({ v: 1, session: SESSION });
    expect(tapeSteps(repo, SESSION)).toEqual([
      "brief session",
      "brief file-change",
      "brief file-change",
      "brief file-change",
      "compaction",
      "brief session",
      "brief file-change",
      // The refused pushes record their guard and nothing else: a refusal carries no notes, so none
      // is judged — or marked shown — behind them.
      "guard command",
      "guard command",
      // A Bash call that runs is two rails, and the recording says so: the command guardrails judge
      // the line and a command NOTE may ride the same answer. Both are canonical events, so a
      // replay of this file re-runs both.
      "guard command",
      "brief command",
      "guard commit",
    ]);
    // Nothing in the file names Claude Code. That is the standing proof of the seam: the engine
    // could not tell which harness recorded this, which is exactly why a second harness is a
    // second column rather than a second engine.
    expect(readFileSync(join(repo, ".flow", "replay", `${SESSION}.jsonl`), "utf8")).not.toMatch(/hook_event_name|tool_input|PreToolUse|SessionStart|\.claude/);
    // The commit step carries the answer its check got from the missing binary, verbatim.
    expect(records.at(-1)?.world?.exec?.["definitely-not-a-real-binary-xyz --check"]?.code).toBe(127);
  });

  it("replays with no repo and no harness, and the diff against the live log is EMPTY", () => {
    const answer = run(
      ["replay", join(".flow", "replay", `${SESSION}.jsonl`), "--against", join(".flow", "log", `${SESSION}.jsonl`)],
      "",
    );
    expect(answer.stderr, "an unanswered reach would mean the verdict rests on a silence").toBe("");
    expect(answer.stdout).toContain("Diff empty.");
    expect(answer.code).toBe(0);

    // …and it really did replay the whole thing rather than agreeing about nothing.
    expect(answer.stdout).toContain("demo.noForce");
    expect(answer.stdout).toContain("demo.suitePasses");
    expect(answer.stdout).toContain("demo.area · file-change · first");
    expect(answer.stdout).toContain("demo.area · file-change · drift");
    expect(answer.stdout).toContain("demo.orientation · session · session");
  });

  it("a replay run somewhere else entirely still lands the same verdicts", () => {
    // The claim is "no repo", so it is proved by taking the repo away: the recording and the config
    // are copied to a bare directory with none of the files the checks judged, no git, and no
    // `.flow` at all. Every answer below came out of the recording.
    const elsewhere = mkdtempSync(join(tmpdir(), "flow-replay-"));
    try {
      copyGuard(elsewhere);
      writeFileSync(join(elsewhere, "recording.jsonl"), readFileSync(join(repo, ".flow", "replay", `${SESSION}.jsonl`), "utf8"));
      const answer = runFlow(elsewhere, ["replay", "recording.jsonl"]);
      expect(answer.stderr).toBe("");
      expect(answer.code).toBe(0);
      expect(answer.stdout).toContain("with no repo and no harness");
      expect(answer.stdout).toContain("demo.noForce");
      expect(answer.stdout).toContain("demo.suitePasses");
      expect(existsSync(join(elsewhere, ".flow")), "replay writes nothing — it is a reading").toBe(false);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("a recording missing an answer a check needs is REPORTED, never quietly believed", () => {
    // The failure this format exists to make impossible: a step whose check reaches for something
    // nobody wrote down. `cannedWorld` records the reach rather than guessing at it, and replay
    // ends non-zero saying which.
    const thin = join(repo, "thin.jsonl");
    // The file is recorded (so the gate finds a subject) and the command's answer is not.
    const step = { rail: "guard", moment: "commit", staged: ["tool/x.ts"], wearing: [], world: { fs: { "tool/x.ts": "" } } };
    writeFileSync(thin, `${JSON.stringify(step)}\n`);
    const answer = run(["replay", "thin.jsonl"], "");
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("the recording never answered a exec of `definitely-not-a-real-binary-xyz --check`");
    rmSync(thin);
  });
});

describe("flow status — the live session's permission mode, and auto mode's steer", () => {
  // The join status makes on disk: the marker the PreToolUse rail leaves names the session, its log
  // names the mode, and the host's store holds the transcript whose auto-mode attachment says the
  // steer. The attachment is shaped like the ones real interactive auto-mode transcripts carry.
  const cases = [
    { name: "strict", attachment: { bashFirst: true, bashFirstSteer: "strict", steerOnly: true }, says: "auto — steered towards shell edits (strict)" },
    { name: "relaxed", attachment: { bashFirst: true, bashFirstSteer: "relaxed", steerOnly: true }, says: "auto — steered towards shell edits (relaxed)" },
    { name: "plain", attachment: { bashFirst: false, steerOnly: false }, says: "auto — not steered towards shell edits" },
  ];

  for (const { name, attachment, says } of cases)
    it(`reads the steer from the session's own transcript in the host store — ${name}`, () => {
      const user = mkdtempSync(join(tmpdir(), "flow-user-"));
      try {
        const session = `steer-${name}`;
        // Named for the repo as status resolves it: macOS's temp folder is a symlink, and a spawned
        // process's working directory is the real path.
        const store = join(user, ".claude", "projects", realpathSync(repo).replace(/[^a-zA-Z0-9]/g, "-"));
        // The host's folder named twice over, so the store agrees with it whatever this machine sets.
        const rig = { user, home: join(user, ".claude") };
        mkdirSync(store, { recursive: true });
        const record = { type: "attachment", attachment: { type: "auto_mode", autoModeConsentFlow: false, bypass: false, ...attachment }, sessionId: session, cwd: repo };
        writeFileSync(join(store, `${session}.jsonl`), `${JSON.stringify({ type: "user", message: { role: "user", content: "go" } })}\n${JSON.stringify(record)}\n`);

        const call = { ...pre("Bash", { command: "ls" }, session), permission_mode: "auto", cwd: repo };
        expect(runFlow(repo, ["hook", "pre-tool-use"], rig, JSON.stringify(call)).code).toBe(0);
        const lines = runFlow(repo, ["status"], rig).stdout.split("\n");
        expect(lines).toContain(`  session    ${session} · main, wearing no category`);
        expect(lines).toContain(`  mode       ${says}`);
      } finally {
        rmSync(user, { recursive: true, force: true });
      }
    });
});

describe("flow facts — the record and the conversations, read back", () => {
  it("reads its own rows, names the areas nothing watches, and says when it is not armed", () => {
    const answer = run(["facts", "--json"], "");
    expect(answer.code).toBe(0);
    const read = JSON.parse(answer.stdout) as {
      health: { blocked: string | null };
      metrics: { headline: { blocks: number }; span: { tools: number }; guardrails: { id: string; hits: number }[] };
      moments: { totals: { guardrails: number; breadcrumbs: number } };
      terrain: { path: string; edits: number }[];
    };
    expect(read.health.blocked).toBe(null);
    expect(read.metrics.headline.blocks).toBeGreaterThan(0);
    expect(read.metrics.span.tools).toBeGreaterThan(0);
    expect(read.metrics.guardrails.find((g) => g.id === "demo.noForce")?.hits).toBeGreaterThan(0);
    expect(read.moments.totals).toMatchObject({ guardrails: 9, breadcrumbs: 2 });
    expect(read.terrain.some((n) => n.path === "src")).toBe(true);
  });

  it("a repo with no record at all BLOCKS the reading rather than reporting a calm week", () => {
    const bare = mkdtempSync(join(tmpdir(), "flow-facts-"));
    try {
      copyGuard(bare);
      const answer = runFlow(bare, ["facts"]);
      expect(answer.code).toBe(1);
      expect(answer.stdout).toContain("NOT ARMED");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("every row names the agent it came from, and a breadcrumb row what showed it (#15)", () => {
  // A worktree of its own, so the marker the commit gate reads is the one these calls leave and
  // nothing the suite above wrote. The config is the least that makes every kind of row: a session
  // note, an area note, a command note, and a rule at the command and at the commit.
  let tree: string;
  const AGENTS_CONFIG = (packageRoot: string): string => `
import { breadcrumb, command, commit, definePack, defineConfig, guardrail, pack, session, fileChange } from ${JSON.stringify(join(packageRoot, "index.ts"))};


const demo = definePack("demo", {
  noTodo: guardrail()
    .at(commit)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/.")
    .test({
      pass: [{ path: "src/a.ts", content: "ok" }],
      block: [{ path: "src/a.ts", content: "TODO" }],
    }),
  noTodoCommand: guardrail()
    .at(command)
    .check((ctx) => ((ctx.command ?? "").includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in a command.")
    .test({ pass: ["echo ok"], block: ["echo TODO"] }),
  orientation: breadcrumb().at(session).text("This repo is guarded by flow."),
  area: breadcrumb().at(fileChange).on("src/**").text("src/ is the product."),
  history: breadcrumb().at(command).on("git log*").text("The journal owns the past."),
});

export default defineConfig([pack(demo)]);
`;
  const send = (event: string, payload: unknown): Ran => runFlow(tree, ["hook", event], {}, JSON.stringify(payload));
  const sh = (command: string): number => spawnSync("bash", ["-c", command], { cwd: tree }).status ?? -1;
  /** One tool call, both halves, with the tool run between them. */
  function call(who: Record<string, unknown>, tool: string, input: Record<string, unknown>, act = ""): Ran {
    const payload = { session_id: "agents", ...who, tool_name: tool, tool_input: input, cwd: tree };
    if (tool === "Bash") {
      const before = send("pre-tool-use", payload);
      if (before.code !== 0) return before;
    }
    if (act !== "") sh(act);
    return send("post-tool-use", payload);
  }
  /** The gate over one staged file, unstaged again after, as `gate` above does. */
  function commitGate(path: string): Ran {
    runGit(tree, ["add", "--", path]);
    try {
      return runFlow(tree, ["hook", "commit"]);
    } finally {
      runGit(tree, ["rm", "-q", "--cached", "--", path]);
    }
  }
  const BUILDER = { agent_id: "a6009b558b4c9155c", agent_type: "builder" };
  const UNTYPED = { agent_id: "a77untyped" };

  beforeAll(() => {
    tree = newRepo("flow-agents-");
    writeFileSync(join(tree, "flow.config.ts"), AGENTS_CONFIG(PACKAGE));
    mkdirSync(join(tree, "src"), { recursive: true });
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 1;\n");

    // The parent: a session start, a Read of the area, and a file written in it.
    expect(send("session-start", { session_id: "agents", source: "startup" }).code).toBe(0);
    call({}, "Read", { file_path: join(tree, "src/a.ts") });
    call({}, "Write", { file_path: join(tree, "src/m.ts"), content: "export const m = 1;\n" }, "echo 'export const m = 1;' > src/m.ts");
    // A subagent whose message carries no type.
    call(UNTYPED, "Read", { file_path: join(tree, "src/a.ts") });
    // A builder: a command a note matches, then one that reads the area by name and has a TODO in it
    // the rule refuses.
    call(BUILDER, "Bash", { command: "git log --oneline -1" });
    const refused = call(BUILDER, "Bash", { command: "cat src/a.ts && echo '// TODO' > src/b.ts" }, "cat src/a.ts && echo '// TODO' > src/b.ts");
    expect(refused.code, "the command is refused, so the builder has a guardrail row").toBe(2);
    // The builder's call was the last one, so the commit is the builder's.
    writeFileSync(join(tree, "src", "c.ts"), "// TODO\n");
    expect(commitGate("src/c.ts").code).toBe(2);
    // No marker at all: the commit is nobody's.
    for (const name of readdirSync(join(tree, ".flow"))) if (name.startsWith(".session")) rmSync(join(tree, ".flow", name));
    expect(commitGate("src/c.ts").code).toBe(2);
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  /** Every row after meta in this suite's session log, whole, that came from one agent. */
  const from = (agent: string): Record<string, unknown>[] =>
    rows(tree, "agents").filter((row) => row["kind"] !== "meta" && row["agent"] === agent);
  const kinds = (list: Record<string, unknown>[]): string[] => [...new Set(list.map((row) => row["kind"] as string))].sort();

  it("names the agent on every row after meta: main for the session, the agent_id for a subagent", () => {
    const all = rows(tree, "agents").slice(1);
    expect(all.length).toBeGreaterThan(0);
    for (const row of all) expect(typeof row["agent"], JSON.stringify(row)).toBe("string");
    expect(new Set(all.map((row) => row["agent"]))).toEqual(new Set(["main", "a77untyped", "a6009b558b4c9155c"]));
    expect(kinds(from("main"))).toEqual(["breadcrumb", "change", "run", "tool"]);
    expect(kinds(from("a6009b558b4c9155c"))).toEqual(["breadcrumb", "guardrail", "read", "run", "tool"]);
  });

  it("puts agentType only on a subagent's rows, and only when its message sent the type", () => {
    for (const row of from("a6009b558b4c9155c")) expect(row["agentType"], JSON.stringify(row)).toBe("builder");
    for (const row of [...from("main"), ...from("a77untyped")]) expect(row, JSON.stringify(row)).not.toHaveProperty("agentType");
    expect(from("a77untyped").length).toBeGreaterThan(0);
  });

  it("names the agent whose call last ran on the commit gate's rows, or commit when there was none", () => {
    const gate = rows(tree, "agents").filter((row) => row["moment"] === "commit");
    expect(gate.map((row) => row["kind"]).sort()).toEqual(["guardrail", "run"]);
    for (const row of gate) expect(row).toMatchObject({ agent: "a6009b558b4c9155c", agentType: "builder" });

    const nobody = rows(tree, "commit");
    expect(nobody[0]).toMatchObject({ kind: "meta", session: "commit" });
    expect(nobody.slice(1).map((row) => row["kind"]).sort()).toEqual(["guardrail", "run"]);
    for (const row of nobody.slice(1)) {
      expect(row["agent"]).toBe("commit");
      expect(row).not.toHaveProperty("agentType");
    }
  });

  /** The breadcrumb row one agent was shown for one entry. */
  const crumb = (agent: string, id: string): Record<string, unknown> | undefined =>
    from(agent).find((row) => row["kind"] === "breadcrumb" && row["id"] === id);

  it("names the file whose first change showed an area note, repo-relative, and the files a call changed on a `change` row", () => {
    expect(crumb("main", "demo.area")).toMatchObject({ moment: "file-change", cause: "first", subject: "src/m.ts" });
    expect(from("main").find((row) => row["kind"] === "change")).toMatchObject({ tool: "Write", paths: ["src/m.ts"] });
  });

  it("names the command line that showed a command note", () => {
    expect(crumb("a6009b558b4c9155c", "demo.history")).toMatchObject({ moment: "command", cause: "first", subject: "git log --oneline -1" });
  });

  it("writes no subject on a session note's row, which fired on no file", () => {
    const greeting = crumb("main", "demo.orientation");
    expect(greeting).toMatchObject({ moment: "session", cause: "session" });
    expect(greeting).not.toHaveProperty("subject");
  });

  it("does not spend a note on a refused command — the retry that runs is briefed", () => {
    const ask = (command: string): Ran => send("pre-tool-use", { session_id: "refused-note", tool_name: "Bash", tool_input: { command }, cwd: tree });
    const refused = ask("git log --oneline && echo TODO");
    expect(refused.code, "the command is refused").toBe(2);
    expect(refused.stdout).toBe("");
    const retried = ask("git log --oneline");
    expect(retried.code).toBe(0);
    expect(told(retried)).toBe("# breadcrumb: demo.history (command)\nThe journal owns the past.");
  });

  it("leaves the meta row as it was: no agent, no agentType, and v 1", () => {
    const [meta] = rows(tree, "agents");
    expect(Object.keys(meta ?? {}).sort()).toEqual(["branch", "harness", "kind", "session", "started", "v", "worktree"]);
    expect(meta).toMatchObject({ kind: "meta", v: 2, harness: "claude-code", session: "agents" });
  });
});
