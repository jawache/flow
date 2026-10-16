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
import {
  PACKAGE,
  buildBundles,
  cleanBundles,
  fixturePack,
  hookInPieces,
  newRepo,
  pre,
  shimBin,
  BREAKS,
  flow as runFlow,
  git as runGit,
  type Ran,
} from "./harness.ts";
import { FLOW_OFF, PRE_COMMIT, SET_HOOKS_PATH } from "../adapter/domain.ts";

let repo: string;

/**
 * The one pack this repo writes itself, in the folder it chose to write it in.
 *
 * A category and one turn-end rule, shared with `packs/machine.test.ts` as a fixture file rather
 * than kept twice as a string — see flow/__fixtures__/repo-pack.ts. It matters here beyond the
 * rule: a `.for(…)` entry needs a rung to bind to at the commit gate, and a real config binds the
 * repo's own pack beside the package's. The folder name is this fixture's choice and nothing
 * else's — `guards/` is where this repo happens to keep them, and the engine knows no such word.
 */
const HOUSE = (packageRoot: string): string => fixturePack("repo-pack", join(packageRoot, "index.ts"));

/** What the temp repo's own guard says. A few entries, at least one per rail this suite drives. */
const CONFIG = (packageRoot: string): string => `
import { breadcrumb, command, commit, definePack, defineConfig, deletion, guardrail, pack, protectedPath, session, touch, turnEnd, write } from ${JSON.stringify(
  join(packageRoot, "index.ts"),
)};
import { builder, house } from "./guards/house.ts";

const demo = definePack("demo", {
  noTodo: guardrail()
    .at(write)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/ — write the code or write the issue.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "TODO" }] }),

  appendOnly: guardrail()
    .at(write, deletion, commit)
    .on("migrations/**")
    .check(protectedPath({ existingOnly: true }))
    .message("A migration already written is history — add a new one instead.")
    .test({
      pass: [
        { path: "migrations/002.sql", content: "new" },
        { staged: ["migrations/002.sql"], added: ["migrations/002.sql"], world: { fs: { "migrations/002.sql": "new" } } },
      ],
      block: [
        { path: "migrations/001.sql", content: "edited", world: { fs: { "migrations/001.sql": "old" } } },
        { staged: ["migrations/001.sql"], added: [], world: { fs: { "migrations/001.sql": "edited" } } },
        { staged: [], deleted: { "migrations/001.sql": "old" } },
      ],
    }),

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

  area: breadcrumb().at(touch).on("src/**").text("src/ is the product — its tests sit beside it."),
});

// The repo's own pack is bound beside the demo one, which is how a real config reads: the package's
// rules and the repo's, in one list.
export default defineConfig([pack(demo), pack(house)]);
`;

/** Run the built binary in the temp repo, with a payload on stdin exactly as the host sends it. */
const run = (args: readonly string[], stdin: string): Ran => runFlow(repo, args, {}, stdin);

const hook = (event: string, payload: unknown): Ran => run(["hook", event], JSON.stringify(payload));

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

let calls = 0;

/**
 * One tool call as the host brackets it: PreToolUse, the tool, then PostToolUse — both carrying the
 * same `tool_use_id`, which is how the after-call rail finds the snapshot the first one took. The
 * after-call answer is what comes back.
 */
function called(payload: Record<string, unknown>, tool: () => void = () => undefined, event = "post-tool-use"): Ran {
  const keyed = { ...payload, tool_use_id: `toolu_live_${++calls}` };
  const before = hook("pre-tool-use", keyed);
  expect(before.code, `the call was refused before it ran: ${before.stderr}`).toBe(0);
  tool();
  return hook(event, keyed);
}

/** Run a command in the temp repo the way the Bash tool would — the tool, between the two hooks. */
function shell(command: string): number {
  return spawnSync("bash", ["-c", command], { cwd: repo }).status ?? -1;
}

describe("the write rail", () => {
  it("blocks the write before it lands, with the message on stderr and exit 2", () => {
    const answer = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/b.ts"), content: "// TODO: later\n" }));
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
    const edit = inThisSession("Edit", { file_path: join(repo, "src/a.ts"), old_string: "1", new_string: "1 // TODO" });
    expect(hook("pre-tool-use", edit).code).toBe(2);
    const innocent = inThisSession("Edit", { file_path: join(repo, "src/a.ts"), old_string: "1", new_string: "2" });
    expect(hook("pre-tool-use", innocent).code).toBe(0);
  });

  it("leaves the session marker the commit gate reads, and records the call", () => {
    // The handshake: the PreToolUse rail writes which session is live, and the gate — spawned by
    // git, outside any session — reads it back. Both ends are flow's or commits misattribute.
    const marked = JSON.parse(readFileSync(join(repo, ".flow", ".session-main"), "utf8")) as Record<string, unknown>;
    expect(marked["session"]).toBe("live-1");
    // The AGENT too: identity is stored per session x agent, so without this field the gate has no
    // state file to look up and an actor-scoped commit rule is silenced while reading as armed.
    expect(marked["agent"]).toBe("main");
    expect(rows(repo, "live-1").some((row) => row["kind"] === "tool" && row["path"] === "src/b.ts")).toBe(true);
    expect(rows(repo, "live-1").some((row) => row["kind"] === "guardrail" && row["out"] === "deny")).toBe(true);
  });
});

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

describe("what a broken or empty call does", () => {
  it("passes an empty payload safely, on every rail", () => {
    for (const event of ["session-start", "pre-tool-use", "post-tool-use", "post-tool-use-failure", "stop", "subagent-stop", "notification"]) {
      const answer = run(["hook", event], "");
      expect(answer.code, `${event} on an empty payload`).toBe(0);
      expect(answer.stderr, `${event} said something about nothing`).toBe("");
    }
  });

  it("is loud on every rail that judges a call when it cannot read its payload, and warns on the rest", () => {
    // "I could not SEE what I was guarding" must never be spelled like "I looked and it was fine".
    const guarded = run(["hook", "pre-tool-use"], "not json at all");
    expect(guarded.code).toBe(2);
    expect(guarded.stderr).toContain("could not PARSE its payload");
    // The after-call rails judge every change the call made, so a payload they cannot read is a call
    // nobody judged. Exit 2 there blocks nothing — the call has run — and reaches the model.
    for (const event of ["post-tool-use", "post-tool-use-failure"]) {
      const judging = run(["hook", event], "not json at all");
      expect(judging.code, `${event} must not pass an unread call as clean`).toBe(2);
      expect(judging.stderr).toContain("flow — could not see what this call changed");
      expect(judging.stderr).toContain(`[flow hook ${event}] could not PARSE its payload (15 bytes on stdin, and not JSON).`);
    }
    const annotating = run(["hook", "session-start"], "not json at all");
    expect(annotating.code, "breaking a session over a breadcrumb is the cure killing the patient").toBe(0);
    expect(annotating.stderr).toContain("could not PARSE its payload");
  });

  it("reports a stdin it cannot read on an after-call rail, naming the error, rather than retrying it", () => {
    // Only EAGAIN means "wait for the next piece"; any other error is a payload nobody will ever
    // see. A stdin opened for writing fails every read with EBADF. A CLOSED stdin cannot show this:
    // node reopens a closed fd 0 on /dev/null before flow's first line runs, so it reads as empty.
    const dir = mkdtempSync(join(tmpdir(), "flow-stdin-"));
    const writeOnly = openSync(join(dir, "stdin"), "w");
    try {
      const answer = runFlow(repo, ["hook", "post-tool-use"], {}, writeOnly);
      expect(answer.code, "an unread call must not pass as clean").toBe(2);
      expect(answer.stderr).toContain("flow — could not see what this call changed");
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
  // writes it in pieces, and the hook can empty the pipe before the next piece lands. The
  // `tool_use_id` comes after the image, so the after-call rail finds its snapshot only if the
  // second piece was read too.
  const image = (): Record<string, unknown> => {
    const id = `toolu_live_${++calls}`;
    const before = hook("pre-tool-use", { ...inThisSession("Read", { file_path: "shot.png" }), tool_use_id: id });
    expect(before.code, before.stderr).toBe(0);
    return {
      ...inThisSession("Read", { file_path: "shot.png" }),
      hook_event_name: "PostToolUse",
      tool_response: { type: "image", file: { base64: "A".repeat(400_000) } },
      tool_use_id: id,
    };
  };

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

  describe("over a repo with history, under an append-only rule bound at write, deletion and commit", () => {
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
      mkdirSync(join(other, "migrations"));
      writeFileSync(migration("001.sql"), "create table a ();\n");
      writeFileSync(migration("002.sql"), "create table b ();\n");
      runGit(other, ["add", "migrations"]);
      const first = gateHere();
      expect(first.code, `before the first commit every file is new: ${first.stderr}`).toBe(0);
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
        expect(answer.stderr).toContain("✗ demo.appendOnly · migrations/001.sql");
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
        expect(answer.stderr).toContain("✗ demo.appendOnly · migrations/002.sql");
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
        expect(answer.stderr).toContain("✗ demo.appendOnly · migrations/001.sql");
        expect(answer.stderr, "the new path is new, and passes").not.toContain("001_renamed.sql");
        const old = gateHere(["commit", "migrations/001_renamed.sql"]);
        expect(old.code, "the old verb an older hook calls asks git too, whatever list it passes").toBe(2);
        expect(old.stderr).toContain("✗ demo.appendOnly · migrations/001.sql");
      } finally {
        reset();
      }
    });

    it("refuses a file list, which would be a second source of the staged set", () => {
      const answer = gateHere(["hook", "commit", "migrations/001.sql"]);
      expect(answer.code).toBe(2);
      expect(answer.stderr).toContain("takes no files");
    });

    it("judges the commit git is making through the REAL hook — a delete-only commit, and `git commit -a`", () => {
      // `git commit -a` stages into a temporary index that only the hook's own GIT_INDEX_FILE names.
      // A gate that asked git without it would see nothing staged, and pass everything.
      const bin = shimBin();
      try {
        mkdirSync(join(other, ".githooks"), { recursive: true });
        writeFileSync(join(other, ".githooks", "pre-commit"), PRE_COMMIT, { mode: 0o755 });
        runGit(other, SET_HOOKS_PATH.split(" ").slice(1));
        const viaGit = (args: readonly string[]): Ran => runGit(other, args, { bin });

        runGit(other, ["rm", "-q", "migrations/002.sql"]);
        const deleted = viaGit(["commit", "-m", "drop 002"]);
        expect(deleted.code, "git refuses when the gate exits non-zero").not.toBe(0);
        expect(deleted.stderr).toContain("demo.appendOnly · migrations/002.sql");
        reset();

        writeFileSync(migration("001.sql"), "drop table a;\n");
        const all = viaGit(["commit", "-a", "-m", "edit 001"]);
        expect(all.code).not.toBe(0);
        expect(all.stderr).toContain("demo.appendOnly · migrations/001.sql");
        reset();

        writeFileSync(migration("004.sql"), "create table d ();\n");
        runGit(other, ["add", "migrations/004.sql"]);
        const added = viaGit(["commit", "-m", "add 004"]);
        expect(added.code, added.stderr).toBe(0);
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
    mkdirSync(join(repo, ".t", "live-b", "subagents"), { recursive: true });
    const parent = join(repo, ".t", "live-b.jsonl");
    writeFileSync(parent, JSON.stringify({ type: "user", message: { content: "run it" } }) + "\n");
    writeFileSync(
      join(repo, ".t", "live-b", "subagents", "agent-b1.jsonl"),
      JSON.stringify({ type: "user", message: { content: "Follow `/work build`" } }) + "\n",
    );
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
describe("a shell read, briefed", () => {
  it("briefs the area a `cat` reads BEFORE it runs, on the PreToolUse answer, and stays quiet on the second", () => {
    // Under auto mode most contact with an area is a shell read whose payload names no path. The
    // note rides the same answer the command guardrails use, so it arrives ahead of the output.
    // The shell stands in src/, so the relative path is resolved from there.
    const cat = { ...pre("Bash", { command: "cd .. && cat src/a.ts | head -5" }, "live-5"), cwd: join(repo, "src") };
    const first = hook("pre-tool-use", cat);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");
    const decision = JSON.parse(first.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(decision.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(decision.hookSpecificOutput.additionalContext).toBe(
      "# breadcrumb: demo.area (first-touch)\nsrc/ is the product — its tests sit beside it.",
    );
    const again = hook("pre-tool-use", { ...pre("Bash", { command: "cat src/a.ts" }, "live-5"), cwd: repo });
    expect(again.code).toBe(0);
    expect(again.stdout, "shown once, until the session drifts past the threshold").toBe("");
  });

  it("does not spend a note on a refused command — the retry that runs is briefed", () => {
    const refused = hook("pre-tool-use", { ...pre("Bash", { command: "cat src/a.ts && git push --force" }, "live-6"), cwd: repo });
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe("");
    const retried = hook("pre-tool-use", { ...pre("Bash", { command: "cat src/a.ts && git push" }, "live-6"), cwd: repo });
    expect(retried.code).toBe(0);
    expect(retried.stdout).toContain("# breadcrumb: demo.area (first-touch)");
  });
});

// After the commit gate as well, for the same reason: every call here writes the marker.
describe("the delta rail — every change to the tree, judged the moment it has landed", () => {
  // THE PROOF OF F4. A shell edit names no file for a PreToolUse rail to judge: the heredoc below is
  // a command line with no path in it that any rule could see. The change reaches the write rule
  // only through the diff between the tree before the call and the tree after it.
  const session = "live-delta";
  const heredoc = (path: string, line: string): string =>
    `python3 - <<'EOF'\nfrom pathlib import Path\np = Path(${JSON.stringify(path)})\np.write_text((p.read_text() if p.exists() else "") + ${JSON.stringify(line)} + "\\n")\nEOF`;
  const bash = (command: string): Record<string, unknown> => ({ ...pre("Bash", { command }, session), cwd: repo });

  it("puts a heredoc's TODO back, byte for byte, and says so under the reverted-write banner", () => {
    const before = readFileSync(join(repo, "src/a.ts"));
    let landed = Buffer.alloc(0);
    const answer = called(bash(heredoc("src/a.ts", "// TODO: later")), () => {
      expect(shell(heredoc("src/a.ts", "// TODO: later"))).toBe(0);
      landed = readFileSync(join(repo, "src/a.ts"));
    });
    expect(landed.toString(), "the write really landed — nothing stopped it before it ran").toContain("TODO");
    expect(answer.code, "exit 2 on the after-call rail: the host shows stderr to the model").toBe(2);
    expect(answer.stdout).toBe("");
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(answer.stderr).toContain("✗ demo.noTodo · src/a.ts");
    expect(answer.stderr).toContain("No TODOs in src/");
    expect(answer.stderr).toContain("src/a.ts is back to its previous content.");
    expect(readFileSync(join(repo, "src/a.ts")), "byte-identical to before the call").toStrictEqual(before);
    expect(rows(repo, session).some((row) => row["kind"] === "guardrail" && row["out"] === "deny"), "and it is on the record").toBe(true);
  });

  it("keeps a NEW file a command adds to an append-only folder, and puts back the one it edited", () => {
    // Judged after the command, the tree holds the new file too — only the snapshot knows it is new.
    const added = called(bash(heredoc("migrations/002.sql", "create table b ();")), () => {
      expect(shell(heredoc("migrations/002.sql", "create table b ();"))).toBe(0);
    });
    try {
      expect(added.code, added.stderr).toBe(0);
      expect(readFileSync(join(repo, "migrations/002.sql"), "utf8")).toBe("create table b ();\n");
    } finally {
      rmSync(join(repo, "migrations/002.sql"), { force: true });
    }
    const before = readFileSync(join(repo, "migrations/001.sql"));
    const edited = called(bash(heredoc("migrations/001.sql", "drop table a;")), () => {
      expect(shell(heredoc("migrations/001.sql", "drop table a;"))).toBe(0);
    });
    expect(edited.code).toBe(2);
    expect(edited.stderr).toContain("✗ demo.appendOnly · migrations/001.sql");
    expect(readFileSync(join(repo, "migrations/001.sql"))).toStrictEqual(before);
  });

  it("keeps a compliant heredoc's write, and shows the area's breadcrumb at the change", () => {
    const answer = called(bash(heredoc("src/fresh.ts", "export const fresh = 1;")), () => {
      expect(shell(heredoc("src/fresh.ts", "export const fresh = 1;"))).toBe(0);
    });
    try {
      expect(answer.code).toBe(0);
      expect(answer.stderr).toBe("");
      expect(readFileSync(join(repo, "src/fresh.ts"), "utf8")).toBe("export const fresh = 1;\n");
      const decision = JSON.parse(answer.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
      expect(decision.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(decision.hookSpecificOutput.additionalContext).toBe(
        "# breadcrumb: demo.area (first-touch)\nsrc/ is the product — its tests sit beside it.",
      );
    } finally {
      rmSync(join(repo, "src/fresh.ts"), { force: true });
    }
  });

  it("records what went round the tool rows: the files a command read and wrote, the mode, and the host's disagreement", () => {
    const seq = rows(repo, session).length;
    const command = `cat src/a.ts >/dev/null && ${heredoc("src/shelled.ts", "export const shelled = 1;")}`;
    // The host's own list names a file flow's diff never saw, and misses the one it did.
    const payload = { ...bash(command), permission_mode: "auto", tool_response: { stdout: "", bashEditDiff: { changedFiles: [join(repo, "src/other.ts")] } } };
    try {
      const answer = called(payload, () => { expect(shell(command)).toBe(0); });
      expect(answer.code, answer.stderr).toBe(0);
      const logged = rows(repo, session).slice(seq);
      expect(logged.find((row) => row["kind"] === "tool")).toMatchObject({ tool: "Bash", mode: "auto" });
      expect(logged.filter((row) => row["kind"] === "read")).toMatchObject([{ tool: "Bash", path: "src/a.ts" }]);
      expect(logged.filter((row) => row["kind"] === "write")).toMatchObject([{ tool: "Bash", path: "src/shelled.ts", change: "created" }]);
      expect(logged.filter((row) => row["kind"] === "mismatch")).toMatchObject([{ hostOnly: ["src/other.ts"], flowOnly: ["src/shelled.ts"] }]);
    } finally {
      rmSync(join(repo, "src/shelled.ts"), { force: true });
    }
  });

  it("judges a FAILED call's partial write the same way — a command that errors has still written", () => {
    const before = readFileSync(join(repo, "src/a.ts"));
    const command = `${heredoc("src/a.ts", "// TODO: half done")}\nexit 1`;
    const answer = called(bash(command), () => { expect(shell(command)).toBe(1); }, "post-tool-use-failure");
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(readFileSync(join(repo, "src/a.ts"))).toStrictEqual(before);
  });

  it("briefs the area on first touch, and stays quiet on the next one", () => {
    const first = called({ session_id: "live-4", tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } });
    expect(first.code).toBe(0);
    const decision = JSON.parse(first.stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(decision.hookSpecificOutput.additionalContext).toBe(
      "# breadcrumb: demo.area (first-touch)\nsrc/ is the product — its tests sit beside it.",
    );
    const again = called({ session_id: "live-4", tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } });
    expect(again.stdout, "shown once, until the session drifts past the threshold").toBe("");
    expect(
      rows(repo, "live-4").filter((row) => row["kind"] === "run").length,
      "a touch where nothing showed is not a run row — the tool row already said the call happened",
    ).toBe(1);
  });

  it("still refuses an Edit before it lands — the pre-emptive rail is unchanged", () => {
    const answer = hook("pre-tool-use", {
      ...pre("Edit", { file_path: join(repo, "src/a.ts"), old_string: "1", new_string: "1 // TODO" }, session),
      tool_use_id: "toolu_live_edit",
    });
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — blocked before the write landed");
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(existsSync(join(repo, ".flow", "snapshots", "toolu_live_edit.json")), "a refused call never runs, so it takes no snapshot").toBe(false);
  });

  it("reports a call it has no snapshot for, rather than calling it clean", () => {
    const answer = hook("post-tool-use", { ...bash("touch src/x.ts"), tool_use_id: "toolu_never_seen" });
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — could not see what this call changed");
    expect(answer.stderr).toContain("No snapshot was taken before this call");
  });

  it("leaves no snapshot behind once a call is over", () => {
    called(bash("true"), () => { expect(shell("true")).toBe(0); });
    const left = existsSync(join(repo, ".flow", "snapshots"))
      ? readdirSync(join(repo, ".flow", "snapshots")).filter((name) => name.startsWith("toolu_live_") && !name.startsWith("toolu_live_edit"))
      : [];
    expect(left).toStrictEqual([]);
  });
});

describe("several agents in one worktree — overlap, background commands, and one writer", () => {
  // THE PROOF OF F5, in a worktree of its own: a config that sets revert: "all" and binds the work
  // pack with its writers named, so the three things this phase adds meet in one place — a revert
  // narrowed by an overlapping call, a background command's later write judged like any other, and
  // a write by the wrong actor refused whichever tool made it.
  let tree: string;
  let ids = 0;
  const OVERLAP_CONFIG = (packageRoot: string): string => `
import { defineConfig, definePack, guardrail, pack, write } from ${JSON.stringify(join(packageRoot, "index.ts"))};
import { work } from ${JSON.stringify(join(packageRoot, "packs", "index.ts"))};

const demo = definePack("demo", {
  noTodo: guardrail()
    .at(write)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/ — write the code or write the issue.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "TODO" }] }),
});

export default defineConfig([pack(demo), pack(work, { writers: ["builder", "parent"] })], { revert: "all" });
`;
  const sh = (command: string): number => spawnSync("bash", ["-c", command], { cwd: tree }).status ?? -1;
  const at = (path: string): string | null => (existsSync(join(tree, path)) ? readFileSync(join(tree, path), "utf8") : null);
  const send = (event: string, payload: unknown): Ran => runFlow(tree, ["hook", event], {}, JSON.stringify(payload));

  /**
   * A subagent the host spawned as `agentType`, in the message Claude Code really sends for its
   * calls: its `agent_id` and `agent_type`, and the PARENT's `transcript_path`. Its own transcript
   * sits under the parent's, at `<parent>/subagents/agent-<id>.jsonl`.
   */
  function spawned(agent: string, agentType: string, brief = "work on it"): Record<string, unknown> {
    mkdirSync(join(tree, ".t", "f5", "subagents"), { recursive: true });
    const parent = join(tree, ".t", "f5.jsonl");
    writeFileSync(parent, `${JSON.stringify({ type: "user", message: { content: "run it" } })}\n`);
    writeFileSync(join(tree, ".t", "f5", "subagents", `agent-${agent}.jsonl`), `${JSON.stringify({ type: "user", message: { content: brief } })}\n`);
    return { session_id: "f5", agent_id: agent, agent_type: agentType, transcript_path: parent };
  }
  const PARENT = { session_id: "f5" };

  /** One Bash call's two hook halves, keyed alike — the test decides when each one runs. */
  function bash(who: Record<string, unknown>, command: string, input: Record<string, unknown> = {}) {
    const payload = { ...who, tool_name: "Bash", tool_input: { command, ...input }, tool_use_id: `toolu_f5_${++ids}`, cwd: tree };
    return {
      key: payload.tool_use_id,
      before: (): Ran => send("pre-tool-use", payload),
      after: (): Ran => send("post-tool-use", payload),
    };
  }

  beforeAll(() => {
    tree = newRepo("flow-overlap-");
    writeFileSync(join(tree, "flow.config.ts"), OVERLAP_CONFIG(PACKAGE));
    writeFileSync(join(tree, ".gitignore"), ".t/\n");
    mkdirSync(join(tree, "src"), { recursive: true });
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(tree, "src", "b.ts"), "export const b = 1;\n");
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  it("puts back every file a refused call changed when the repo sets revert: all", () => {
    const call = bash(PARENT, "echo '// TODO' >> src/a.ts && echo 'export const d = 1;' > src/d.ts");
    expect(call.before().code).toBe(0);
    expect(sh("echo '// TODO' >> src/a.ts && echo 'export const d = 1;' > src/d.ts")).toBe(0);
    const answer = call.after();
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(answer.stderr).toContain('revert: "all" is set, so every file this call changed was put back');
    expect(at("src/a.ts")).toBe("export const a = 1;\n");
    expect(at("src/d.ts"), "compliant, and gone again with the rest of the call").toBeNull();
  });

  it("reverts only its own refused file while another agent's call is in flight — and names that call", () => {
    const builder = spawned("b1", "builder");
    const parentCall = bash(PARENT, "python3 fix.py");
    const builderCall = bash(builder, "python3 build.py");
    expect(parentCall.before().code).toBe(0);
    expect(builderCall.before().code).toBe(0);
    // The two tools run interleaved: the builder writes b.ts, the parent writes a TODO into a.ts and
    // a compliant e.ts. The parent's diff is taken first, while the builder's call is still open.
    expect(sh("echo 'export const b = 2;' > src/b.ts")).toBe(0);
    expect(sh("echo '// TODO' >> src/a.ts && echo 'export const e = 1;' > src/e.ts")).toBe(0);

    const refused = parentCall.after();
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("✗ demo.noTodo · src/a.ts");
    expect(refused.stderr).toContain("src/a.ts is back to its previous content.");
    expect(refused.stderr).toContain(`Other tool calls overlapped this one: Bash ${builderCall.key} (agent b1 of session f5)`);
    expect(refused.stderr).toContain('revert: "all" is set, and is not applied while calls overlap.');
    expect(at("src/a.ts"), "the refused file is back").toBe("export const a = 1;\n");
    expect(at("src/b.ts"), "the other call's file is untouched").toBe("export const b = 2;\n");
    expect(at("src/e.ts"), "and this call's compliant file stays").toBe("export const e = 1;\n");

    const clean = builderCall.after();
    expect(clean.code, clean.stderr).toBe(0);
    expect(at("src/b.ts")).toBe("export const b = 2;\n");
  });

  it("gives a background command no special treatment: its later write is judged and put back by the call that sees it", () => {
    const started = bash(PARENT, "sleep 1 && echo '// TODO from the build' >> src/b.ts", { run_in_background: true });
    expect(started.before().code).toBe(0);
    expect(existsSync(join(tree, ".flow", "snapshots", `${started.key}.json`)), "snapshotted like any call").toBe(true);
    expect(started.after().code, "diffed like any call: nothing has changed yet when it returns").toBe(0);
    // Later, while some other call is in progress, the process writes — and that call's own
    // compliant write sits in the same diff.
    const later = bash(spawned("b1", "builder"), "echo 'export const f = 1;' > src/f.ts");
    expect(later.before().code).toBe(0);
    expect(sh("echo '// TODO from the build' >> src/b.ts")).toBe(0);
    expect(sh("echo 'export const f = 1;' > src/f.ts")).toBe(0);
    const answer = later.after();
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(answer.stderr).toContain("✗ demo.noTodo · src/b.ts");
    expect(answer.stderr).not.toContain("not reverted");
    expect(at("src/b.ts"), "written back, like any refused write").toBe("export const b = 2;\n");
    expect(at("src/f.ts"), "revert: all — the rest of the call's diff goes back with it").toBeNull();
    expect(existsSync(join(tree, ".flow", "background.json")), "no mark is kept for a background command").toBe(false);
  });

  it("classifies a subagent from the message Claude Code really sends — the parent's transcript_path (#7)", () => {
    // The triage reproduction. Before the fix, flow looked for the subagent's record beside the
    // parent's transcript, found none, and refused this write as one by "an actor with no category".
    const checker = spawned("v7", "verifier", "check it");
    const call = bash(checker, "echo 'export const fixed = 7;' > src/b.ts");
    expect(call.before().code).toBe(0);
    expect(sh("echo 'export const fixed = 7;' > src/b.ts")).toBe(0);
    const answer = call.after();
    expect(answer.stderr).toContain("src/b.ts was written by an actor wearing checker");
    expect(answer.code).toBe(2);
  });

  it("lets a subagent the host started as builder write, from its hook message", () => {
    const named = bash(spawned("b7", "builder"), "echo 'export const g = 7;' > src/g.ts");
    expect(named.before().code).toBe(0);
    expect(sh("echo 'export const g = 7;' > src/g.ts")).toBe(0);
    const allowed = named.after();
    expect(allowed.code, allowed.stderr).toBe(0);
    expect(at("src/g.ts")).toBe("export const g = 7;\n");
  });

  it("recognises a generic spawn by the brief in its own transcript, not the parent's", () => {
    // A `general-purpose` spawn carries no type information: the brief decides, and it is read from
    // the subagent's transcript, not the parent's ("run it").
    const generic = bash(spawned("g7", "general-purpose", "Follow `/work build` for F1"), "echo 'export const h = 7;' > src/h.ts");
    expect(generic.before().code).toBe(0);
    expect(sh("echo 'export const h = 7;' > src/h.ts")).toBe(0);
    const recovered = generic.after();
    expect(recovered.code, recovered.stderr).toBe(0);
    expect(at("src/h.ts")).toBe("export const h = 7;\n");
  });

  it("refuses and reverts a write by an actor that is not a writer, naming who wrote it", () => {
    const checker = spawned("v1", "verifier");
    const call = bash(checker, "echo 'export const fixed = 1;' > src/b.ts");
    expect(call.before().code).toBe(0);
    expect(sh("echo 'export const fixed = 1;' > src/b.ts")).toBe(0);
    const answer = call.after();
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(answer.stderr).toContain("✗ work.builderWrites · src/b.ts");
    expect(answer.stderr).toContain("Only the builder changes files in this worktree — hand your finding back instead of fixing it.");
    expect(answer.stderr).toContain("src/b.ts was written by an actor wearing checker — only builder or parent may change files here");
    expect(at("src/b.ts")).toBe("export const b = 2;\n");
    // The same actor through the Edit tool is refused before anything lands.
    const edit = send("pre-tool-use", {
      ...checker,
      tool_name: "Write",
      tool_input: { file_path: join(tree, "src/b.ts"), content: "export const b = 3;\n" },
      tool_use_id: `toolu_f5_${++ids}`,
    });
    expect(edit.code).toBe(2);
    expect(edit.stderr).toContain("flow — blocked before the write landed");
    expect(edit.stderr).toContain("work.builderWrites");
    expect(at("src/b.ts")).toBe("export const b = 2;\n");
  });
});

describe("files git puts in place — a checkout is neither judged nor written back", () => {
  // THE PROOF OF #8, in a repo of its own with history. `old` holds a file committed before the rule
  // it now breaks, and a migration main has not got yet; main's append-only rule protects that
  // migration once it exists. A file that matches HEAD after the call is git's, so a switch either
  // way leaves the tree equal to HEAD — and anything else the same call changed is still judged.
  let tree: string;
  let ids = 0;
  const session = "checkout";
  const CHECKOUT_CONFIG = (packageRoot: string): string => `
import { definePack, defineConfig, deletion, guardrail, pack, protectedPath, write } from ${JSON.stringify(join(packageRoot, "index.ts"))};

const demo = definePack("demo", {
  noTodo: guardrail()
    .at(write)
    .on("src/**")
    .check((ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("line says TODO") : ctx.ok()))
    .message("No TODOs in src/.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "TODO" }] }),

  appendOnly: guardrail()
    .at(write, deletion)
    .on("migrations/**")
    .check(protectedPath({ existingOnly: true }))
    .message("A migration already written is history.")
    .test({
      pass: [{ path: "migrations/002.sql", content: "new" }],
      block: [{ path: "migrations/001.sql", content: "edited", world: { fs: { "migrations/001.sql": "old" } } }, { staged: [], deleted: { "migrations/001.sql": "old" } }],
    }),

  // The shape of the shipped flow.noDeleteGuardrails, on the one file that runs the commit gate.
  keepHook: guardrail()
    .at(deletion)
    .on(".githooks/pre-commit")
    .check(protectedPath({}))
    .message("The commit gate stays.")
    .test({ block: [{ path: ".githooks/pre-commit", content: "" }] }),
});

export default defineConfig([pack(demo)]);
`;
  /** A commit gate that refuses a staged TODO. It runs only where a test points core.hooksPath at it. */
  const GATE = "#!/bin/sh\nif git diff --cached -U0 | grep -q '^+.*TODO'; then echo 'gate: a TODO is staged' >&2; exit 1; fi\n";
  const at = (path: string): string | null => (existsSync(join(tree, path)) ? readFileSync(join(tree, path), "utf8") : null);
  const inTree = (...args: string[]): string => {
    const ran = runGit(tree, args);
    expect(ran.code, `git ${args.join(" ")}: ${ran.stderr}`).toBe(0);
    return ran.stdout;
  };
  /** The tree against HEAD, as a person reads it — empty is "the worktree is HEAD". */
  const status = (): string => inTree("status", "--porcelain");
  const backToMain = (): void => {
    inTree("switch", "-qf", "main");
    inTree("reset", "-q", "--hard");
    inTree("clean", "-fdq");
  };

  /** One Bash call as the host brackets it: PreToolUse, the command itself, then PostToolUse. */
  function bash(command: string, where = tree, who = session): Ran & { readonly ran: number } {
    const payload = { ...pre("Bash", { command }, who), cwd: where, tool_use_id: `toolu_checkout_${++ids}` };
    const before = runFlow(where, ["hook", "pre-tool-use"], {}, JSON.stringify(payload));
    expect(before.code, `the call was refused before it ran: ${before.stderr}`).toBe(0);
    const ran = spawnSync("bash", ["-c", command], { cwd: where }).status ?? -1;
    return { ...runFlow(where, ["hook", "post-tool-use"], {}, JSON.stringify(payload)), ran };
  }

  beforeAll(() => {
    tree = newRepo("flow-checkout-");
    writeFileSync(join(tree, "flow.config.ts"), CHECKOUT_CONFIG(PACKAGE));
    mkdirSync(join(tree, "src"));
    mkdirSync(join(tree, "migrations"));
    mkdirSync(join(tree, ".githooks"));
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(tree, "migrations", "001.sql"), "create table a ();\n");
    writeFileSync(join(tree, ".githooks", "pre-commit"), GATE, { mode: 0o755 });
    inTree("add", "-A");
    inTree("commit", "-qm", "main");
    inTree("branch", "-M", "main");
    inTree("switch", "-qc", "old");
    writeFileSync(join(tree, "src", "legacy.ts"), "// TODO: from before the rule\n");
    writeFileSync(join(tree, "migrations", "002.sql"), "create table b ();\n");
    inTree("add", "-A");
    inTree("commit", "-qm", "old");
    inTree("switch", "-q", "main");
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  it("switches TO a branch whose files break a current rule: exit 0, nothing put back, the tree equal to HEAD", () => {
    const answer = bash("git switch -q old");
    expect(answer.ran).toBe(0);
    expect(answer.code, answer.stderr).toBe(0);
    expect(answer.stderr).toBe("");
    expect(answer.stdout, "no breadcrumb, no note: nothing reached a rule").toBe("");
    expect(at("src/legacy.ts"), "old's own file, as old committed it").toBe("// TODO: from before the rule\n");
    expect(at("migrations/002.sql")).toBe("create table b ();\n");
    expect(status(), "the worktree is HEAD").toBe("");
  });

  it("switches BACK to a branch without a file an append-only rule protects: exit 0, the tree equal to HEAD", () => {
    inTree("switch", "-qf", "old");
    const answer = bash("git switch -q main");
    expect(answer.ran).toBe(0);
    expect(answer.code, answer.stderr).toBe(0);
    expect(answer.stderr).toBe("");
    expect(at("migrations/002.sql"), "main has no 002.sql, and it was not put back").toBeNull();
    expect(at("src/legacy.ts")).toBeNull();
    expect(status(), "the worktree is HEAD").toBe("");
  });

  it("records no shell write for a checkout's files, so `flow facts` counts none — and still counts the agent's", () => {
    const user = mkdtempSync(join(tmpdir(), "flow-user-"));
    try {
      backToMain();
      const id = "checkout-facts";
      const store = join(user, ".claude", "projects", realpathSync(tree).replace(/[^a-zA-Z0-9]/g, "-"));
      mkdirSync(store, { recursive: true });
      writeFileSync(join(store, `${id}.jsonl`), `${JSON.stringify({ type: "user", message: { role: "user", content: "go" } })}\n`);
      expect(bash("git switch -q old", tree, id).code).toBe(0);
      expect(bash("git switch -q main", tree, id).code).toBe(0);
      expect(bash("echo 'export const b = 1;' > src/b.ts", tree, id).code).toBe(0);
      const read = runFlow(tree, ["facts", "--json", "--session", id], { user, home: join(user, ".claude") });
      expect(read.code, read.stderr).toBe(0);
      const facts = JSON.parse(read.stdout) as { narrative: { stats: { shellWrites: number }; shell: { writes: Record<string, number> } } };
      expect(facts.narrative.stats.shellWrites, "src/b.ts only — not one file of either switch").toBe(1);
      expect(facts.narrative.shell.writes).toStrictEqual({ "src/b.ts": 1 });
    } finally {
      rmSync(user, { recursive: true, force: true });
    }
  });

  it("in `git switch old && sed -i …`, refuses and puts back the sed edit, and keeps the switch's own files", () => {
    backToMain();
    const seq = rows(tree, session).length;
    const answer = bash("git switch -q old && sed -i.orig 's|a = 1;|a = 1; // TODO|' src/a.ts && rm src/a.ts.orig");
    expect(answer.ran).toBe(0);
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed:");
    expect(answer.stderr).toContain("✗ demo.noTodo · src/a.ts");
    expect(answer.stderr, "old's committed TODO is git's, not the agent's").not.toContain("legacy.ts");
    expect(answer.stderr).not.toContain("002.sql");
    expect(at("src/a.ts"), "the sed edit is gone").toBe("export const a = 1;\n");
    expect(inTree("rev-parse", "--abbrev-ref", "HEAD").trim(), "the switch itself stands").toBe("old");
    expect(at("src/legacy.ts")).toBe("// TODO: from before the rule\n");
    expect(status(), "and so the tree is HEAD").toBe("");
    expect(
      rows(tree, session).slice(seq).filter((row) => row["kind"] === "write").map((row) => row["path"]),
      "the one shell write on the record is the sed's",
    ).toStrictEqual(["src/a.ts"]);
  });

  it("refuses and puts back a TODO the same call commits past a real commit gate: with --no-verify, and with the hook removed first", () => {
    backToMain();
    const main = inTree("rev-parse", "HEAD").trim();
    inTree("config", "core.hooksPath", ".githooks");
    try {
      // The gate refuses the TODO when nothing skips it.
      writeFileSync(join(tree, "src", "a.ts"), "export const a = 1; // TODO\n");
      expect(runGit(tree, ["commit", "-qam", "gated"]).code, "the gate refuses a staged TODO").not.toBe(0);
      inTree("reset", "-q", "--hard", main);

      const skipped = bash("echo '// TODO' >> src/a.ts && git commit -qam skipped --no-verify");
      expect(skipped.ran).toBe(0);
      expect(inTree("rev-parse", "HEAD").trim(), "the commit landed").not.toBe(main);
      expect(skipped.code).toBe(2);
      expect(skipped.stderr).toContain("✗ demo.noTodo · src/a.ts");
      expect(at("src/a.ts"), "written back").toBe("export const a = 1;\n");
      inTree("reset", "-q", "--hard", main);

      const unhooked = bash("python3 -c \"import os; os.remove('.githooks/pre-commit')\" && echo '// TODO' >> src/a.ts && git commit -qam unhooked");
      expect(unhooked.ran).toBe(0);
      expect(inTree("rev-parse", "HEAD").trim(), "the commit landed").not.toBe(main);
      expect(unhooked.code).toBe(2);
      expect(unhooked.stderr).toContain("✗ demo.keepHook · .githooks/pre-commit");
      expect(unhooked.stderr).toContain("✗ demo.noTodo · src/a.ts");
      expect(at(".githooks/pre-commit"), "written back").toBe(GATE);
      expect(at("src/a.ts"), "written back").toBe("export const a = 1;\n");
    } finally {
      inTree("config", "--unset", "core.hooksPath");
      inTree("reset", "-q", "--hard", main);
    }
  });

  it("judges what a stash pop, a merge stopped on conflicts and a cherry-pick --no-commit write — they match no commit", () => {
    backToMain();
    // A stash holding a TODO, from a time before the rule, popped back.
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 1; // TODO: stashed\n");
    inTree("stash", "-q");
    const popped = bash("git stash pop -q");
    expect(popped.ran).toBe(0);
    expect(popped.code).toBe(2);
    expect(popped.stderr).toContain("✗ demo.noTodo · src/a.ts");
    expect(at("src/a.ts")).toBe("export const a = 1;\n");
    backToMain();

    // A merge that stops on a conflict leaves the markers, and the other side's TODO, in the file.
    inTree("switch", "-qc", "clash");
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 2; // TODO: theirs\n");
    inTree("commit", "-qam", "clash");
    inTree("switch", "-q", "main");
    writeFileSync(join(tree, "src", "a.ts"), "export const a = 3;\n");
    inTree("commit", "-qam", "ours");
    const merged = bash("git merge -q clash");
    expect(merged.ran, "the merge stopped on its conflict").not.toBe(0);
    expect(merged.code).toBe(2);
    expect(merged.stderr).toContain("✗ demo.noTodo · src/a.ts");
    expect(at("src/a.ts")).toBe("export const a = 3;\n");
    inTree("merge", "--abort");
    backToMain();

    // A cherry-pick that does not commit lands another branch's change with no commit of its own.
    inTree("switch", "-qc", "picked");
    writeFileSync(join(tree, "src", "c.ts"), "// TODO: picked\n");
    inTree("add", "src/c.ts");
    inTree("commit", "-qm", "picked");
    inTree("switch", "-q", "main");
    const picked = bash("git cherry-pick --no-commit picked");
    expect(picked.ran).toBe(0);
    expect(picked.code).toBe(2);
    expect(picked.stderr).toContain("✗ demo.noTodo · src/c.ts");
    expect(at("src/c.ts"), "created by the call, so gone again").toBeNull();
    backToMain();
  });

  it("still refuses and puts back a shell write in a repo with no commit yet — there is no HEAD to match", () => {
    const fresh = newRepo("flow-unborn-");
    try {
      writeFileSync(join(fresh, "flow.config.ts"), CHECKOUT_CONFIG(PACKAGE));
      mkdirSync(join(fresh, "src"));
      writeFileSync(join(fresh, "src", "a.ts"), "export const a = 1;\n");
      expect(runGit(fresh, ["rev-parse", "--verify", "--quiet", "HEAD"]).code, "no commit yet").not.toBe(0);
      const answer = bash("echo '// TODO' >> src/a.ts && echo '// TODO' > src/new.ts", fresh);
      expect(answer.ran).toBe(0);
      expect(answer.code).toBe(2);
      expect(answer.stderr).toContain("flow — write reverted after it landed:");
      expect(answer.stderr).toContain("✗ demo.noTodo · src/a.ts");
      expect(answer.stderr).toContain("✗ demo.noTodo · src/new.ts");
      expect(readFileSync(join(fresh, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
      expect(existsSync(join(fresh, "src", "new.ts"))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
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
  const read = (): Ran => called(asSubagent({ tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } }));

  beforeAll(() => {
    mkdirSync(join(repo, ".t", SESSION, "subagents"), { recursive: true });
    parent = join(repo, ".t", `${SESSION}.jsonl`);
    own = join(repo, ".t", SESSION, "subagents", `agent-${AGENT}.jsonl`);
  });

  it("measures drift on the subagent's own context, so a note comes back when IT has moved on", () => {
    writeFileSync(parent, lines(prompt("go"), usage(400_000)));
    writeFileSync(own, lines(prompt("look at src"), usage(1_000)));
    expect(read().stdout, "first touch").toContain("src/ is the product");

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
  let parent: string;
  let ids = 0;

  const prompt = (content: string): string => JSON.stringify({ type: "user", message: { content } });
  const used = (tool: string, input: Record<string, unknown>): string =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: tool, input }] } });
  const wrote = (name: string): string => used("Write", { file_path: join(repo, name), content: "" });
  /** Four edits and nothing run — what the repo's turn-end rule, bound for everyone, refuses. */
  const untested = (): string[] => ["a", "b", "c", "d"].map((name) => wrote(`src/${name}.ts`));
  const lines = (...each: string[]): string => `${each.join("\n")}\n`;
  const setting = (name: string): string => JSON.stringify({ type: "agent-setting", agentSetting: name, sessionId: SESSION });

  /** Write the parent's transcript and this subagent's own, then hand back as the host would. */
  const handBack = (type: string, own: readonly string[], over: Record<string, unknown> = {}, parentLines: readonly string[] = [prompt("go")]): Ran => {
    const id = `ahb${++ids}`;
    const path = join(repo, ".t", SESSION, "subagents", `agent-${id}.jsonl`);
    writeFileSync(parent, lines(...parentLines));
    writeFileSync(path, lines(prompt("do the phase"), ...own));
    return hook("subagent-stop", {
      session_id: SESSION,
      transcript_path: parent,
      cwd: repo,
      permission_mode: "default",
      hook_event_name: "SubagentStop",
      stop_hook_active: false,
      agent_id: id,
      agent_type: type,
      agent_transcript_path: path,
      last_assistant_message: "done",
      ...over,
    });
  };

  beforeAll(() => {
    mkdirSync(join(repo, ".t", SESSION, "subagents"), { recursive: true });
    parent = join(repo, ".t", `${SESSION}.jsonl`);
  });

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

describe("the off switch", () => {
  it("silences every rail, and writes no telemetry while it is off", () => {
    writeFileSync(join(repo, ".flow", "off"), "");
    const before = rows(repo, "live-1").length;
    expect(hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/c.ts"), content: "TODO" })).code).toBe(0);
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
  it.each(Object.entries(BREAKS))("lets a write, an edit, a delete and a command through, each with the load error — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      throughAndTold(hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/g.ts"), content: "// TODO" })), "a write");
      throughAndTold(
        hook("pre-tool-use", inThisSession("Edit", { file_path: join(repo, "src/a.ts"), old_string: "export const a = 1;", new_string: "// TODO" })),
        "an edit",
      );
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "rm migrations/001.sql" })), "a delete");
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" })), "a command");
      throughAndTold(hook("pre-tool-use", inThisSession("Bash", { command: "npm ci" })), "the install that fixes a missing package");
    });
  });

  it.each(Object.entries(BREAKS))("puts back nothing a command wrote — %s", (_how, breaker) => {
    const before = readFileSync(join(repo, "src/a.ts"), "utf8");
    try {
      withBrokenConfig(breaker, () => {
        // A TODO into src/ is what a working config puts back, byte for byte, on the after-call rail.
        const payload = { ...inThisSession("Bash", { command: "echo '// TODO' >> src/a.ts" }), cwd: repo };
        const after = called(payload, () => {
          expect(shell("echo '// TODO' >> src/a.ts")).toBe(0);
        });
        expect(after.code, `the after-call rail reports no refusal: ${after.stderr}`).toBe(0);
        expect(after.stderr).toBe("");
        expect(readFileSync(join(repo, "src/a.ts"), "utf8"), "what the command wrote stands").toBe(`${before}// TODO\n`);
        // THE CALL IS OVER, with no diff taken: its snapshot goes, as on a healthy config.
        const left = existsSync(join(repo, ".flow", "snapshots"))
          ? readdirSync(join(repo, ".flow", "snapshots")).filter((name) => name.startsWith("toolu_live_") && !name.startsWith("toolu_live_edit"))
          : [];
        expect(left, "a broken config still finishes the call's record").toStrictEqual([]);
      });
    } finally {
      writeFileSync(join(repo, "src/a.ts"), before);
    }
  });

  // NO DIFF AFTER THE CALL. A healthy config reports a call it has no snapshot for (the write rail's
  // own case above); a broken one has nothing to judge the diff with, so it takes none, and so it
  // has no fault to print about one.
  it.each(Object.entries(BREAKS))("takes no diff after a call, so a call it has no snapshot for is not reported — %s", (_how, breaker) => {
    withBrokenConfig(breaker, () => {
      const after = hook("post-tool-use", { ...inThisSession("Bash", { command: "touch src/x.ts" }), tool_use_id: "toolu_broken_never_seen" });
      expect(after.code, `the after-call rail lets it through: ${after.stderr}`).toBe(0);
      expect(after.stderr, "no fault about a diff nothing would judge").toBe("");
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

  it("changes nothing at all when the config is healthy", () => {
    // Letting everything through is keyed on the BROKEN state and nowhere else: with a working
    // config, the same write is judged on its rules and refused.
    const ordinary = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/g.ts"), content: "// TODO" }));
    expect(ordinary.code).toBe(2);
    expect(ordinary.stderr).toContain("No TODOs in src/");
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

  it("drives a whole session: greeting, first touch, drift, compaction, two blocks and a commit", () => {
    // 1 — the greeting. The session breadcrumb shows, and is MARKED there.
    const greeting = hook("session-start", inSession({ source: "startup" }));
    expect(greeting.code).toBe(0);
    expect(greeting.stdout).toContain("This repo is guarded by flow.");

    // 2 — first touch of the area. The area note shows.
    const first = called(inSession({ tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } }));
    expect(first.stdout).toContain("src/ is the product");

    // 3 — the same area again, with the context barely moved. It stays quiet.
    const quiet = called(inSession({ tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } }));
    expect(quiet.stdout).toBe("");

    // 4 — the session has drifted past the threshold. The note is earned again.
    drifted(400_000);
    const again = called(inSession({ tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } }));
    expect(again.stdout).toContain("src/ is the product");

    // 5 — a compaction. Every AREA mark is cleared; the SESSION mark is deliberately kept, so the
    // greeting is not printed a second time in a row — which is why this rail says nothing at all
    // even though it is the moment that re-arms everything else.
    const compacted = hook("session-start", inSession({ source: "compact" }));
    expect(compacted.stdout, "the session note keeps its mark across a compaction").toBe("");

    // 6 — first touch again, because after a compaction it genuinely is one.
    const relearned = called(inSession({ tool_name: "Read", tool_input: { file_path: join(repo, "src/a.ts") } }));
    expect(relearned.stdout).toContain("src/ is the product");

    // 7 and 8 — two rails refuse, which is what the replay has to land again.
    expect(hook("pre-tool-use", inSession({ tool_name: "Write", tool_input: { file_path: join(repo, "src/z.ts"), content: "// TODO\n" } })).code).toBe(2);
    expect(hook("pre-tool-use", inSession({ tool_name: "Bash", tool_input: { command: "git push --force" } })).code).toBe(2);
    // …and a Bash call that runs, so the recording holds both of its rails.
    expect(hook("pre-tool-use", inSession({ tool_name: "Bash", tool_input: { command: "echo done" } })).code).toBe(0);

    // 9 — the commit gate, whose check SHELLS OUT. Its answer is recorded, which is the part no
    // amount of re-running could reproduce later: the working tree has moved on since.
    expect(gate("tool/x.ts").code).toBe(2);
  });

  it("records the canonical event stream, harness-blind — no payload, no hook, no path", () => {
    const text = readFileSync(join(repo, ".flow", "replay", `${SESSION}.jsonl`), "utf8");
    const steps = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { rail?: string; moment?: string; v?: number; session?: string });

    expect(steps[0]).toEqual({ v: 1, session: SESSION });
    expect(steps.slice(1).map((s) => `${s.rail ?? ""} ${s.moment ?? ""}`.trim())).toEqual([
      "brief session",
      "brief touch",
      "brief touch",
      "brief touch",
      "compaction",
      "brief session",
      "brief touch",
      "guard write",
      // The refused push records its guard and nothing else: a refusal carries no notes, so none
      // is judged — or marked shown — behind it.
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
    expect(text).not.toMatch(/hook_event_name|tool_input|PreToolUse|SessionStart|\.claude/);
    // The commit step carries the answer its check got from the missing binary, verbatim.
    const commitStep = steps[steps.length - 1] as { world?: { exec?: Record<string, { code?: number }> } };
    expect(commitStep.world?.exec?.["definitely-not-a-real-binary-xyz --check"]?.code).toBe(127);
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
    expect(answer.stdout).toContain("demo.noTodo");
    expect(answer.stdout).toContain("demo.noForce");
    expect(answer.stdout).toContain("demo.suitePasses");
    expect(answer.stdout).toContain("demo.area · touch · first-touch");
    expect(answer.stdout).toContain("demo.area · touch · drift");
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
      expect(answer.stdout).toContain("demo.noTodo");
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
    expect(read.metrics.guardrails.find((g) => g.id === "demo.noTodo")?.hits).toBeGreaterThan(0);
    expect(read.moments.totals).toMatchObject({ guardrails: 8, breadcrumbs: 2 });
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
