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
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  PACKAGE,
  buildBundles,
  cleanBundles,
  fixturePack,
  newRepo,
  pre,
  BREAKS,
  flow as runFlow,
  git as runGit,
  type Ran,
} from "./harness.ts";

let repo: string;

/**
 * The one pack this repo writes itself, in the folder it chose to write it in.
 *
 * A category and one turn-end rule, shared with `packs/machine.test.ts` as a fixture file rather
 * than kept twice as a string — see flow/__fixtures__/repo-pack.ts. It matters here for two
 * reasons beyond the rule: a `.for(…)` entry needs a rung to bind to at the commit gate, and the
 * repair exception is derived from the config's own RELATIVE imports, so a config that imports
 * nothing of its own has no pack half to prove. The folder name is this fixture's choice and
 * nothing else's — `guards/` is where this repo happens to keep them, and the engine no longer
 * knows the word.
 */
const HOUSE = (packageRoot: string): string => fixturePack("repo-pack", join(packageRoot, "index.ts"));

/** What the temp repo's own guard says. Five entries, one per rail this suite drives. */
const CONFIG = (packageRoot: string): string => `
import { breadcrumb, command, commit, definePack, defineConfig, guardrail, pack, session, touch, write } from ${JSON.stringify(
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
  const built = buildBundles();
  expect(built.code, built.stderr).toBe(0);

  repo = newRepo("flow-live-");
  mkdirSync(join(repo, "guards"), { recursive: true });
  writeFileSync(join(repo, "guards", "house.ts"), HOUSE(PACKAGE));
  writeFileSync(join(repo, "flow.config.ts"), CONFIG(PACKAGE));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
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
    expect(rows("live-1").some((row) => row["kind"] === "tool" && row["path"] === "src/b.ts")).toBe(true);
    expect(rows("live-1").some((row) => row["kind"] === "guardrail" && row["out"] === "deny")).toBe(true);
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
    for (const event of ["session-start", "pre-tool-use", "post-tool-use", "post-tool-use-failure", "stop", "notification"]) {
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
      expect(judging.stderr).toContain(`[flow hook ${event}] the guard could not PARSE its payload`);
    }
    const annotating = run(["hook", "session-start"], "not json at all");
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
    runGit(repo, ["add", "src/leak.ts"]);
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

  it("blocks when a gate's own tool is not installed — a missing binary is 127, never a pass", () => {
    // The live World's answer, end to end: the engine turns the non-zero exit into a block naming
    // the entry and the command. A throw here would have been swallowed as "the check threw" and a
    // repo whose tool was missing would have had a silently weaker gate.
    mkdirSync(join(repo, "tool"), { recursive: true });
    writeFileSync(join(repo, "tool", "x.ts"), "export const x = 1;\n");
    runGit(repo, ["add", "tool/x.ts"]);
    const answer = run(["commit", "tool/x.ts"], "");
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("demo.suitePasses");
    expect(answer.stderr).toContain("definitely-not-a-real-binary-xyz");
    expect(answer.stderr.toLowerCase()).toContain("command not found");
    runGit(repo, ["rm", "-q", "--cached", "tool/x.ts"]);
  });

  it("wears the categories of the session x agent the marker names, so .for(…) fires at commit too", () => {
    // The handshake at full stretch. The gate is spawned by git with no session in the room, so an
    // actor-scoped commit rule can only fire if the marker says WHICH agent was working — the field
    // whose absence used to silence such a rule while it read as armed.
    writeFileSync(join(repo, "plan.yaml"), "phases: []\n");
    expect(run(["commit", "plan.yaml"], "").code, "nobody has been classified yet").toBe(0);

    mkdirSync(join(repo, ".t"), { recursive: true });
    const transcript = join(repo, ".t", "agent-b1.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "user", message: { content: "Follow `/work build`" } }) + "\n");
    writeFileSync(join(repo, ".t", "agent-b1.meta.json"), JSON.stringify({ agentType: "builder", description: "F4" }));
    const asBuilder = hook("pre-tool-use", {
      session_id: "live-b",
      agent_id: "agent-b1",
      transcript_path: transcript,
      tool_name: "Write",
      tool_input: { file_path: join(repo, "src/ok.ts"), content: "export const ok = 1;\n" },
    });
    expect(asBuilder.code, "the write itself is fine — this is only how the session gets classified").toBe(0);

    const blocked = run(["commit", "plan.yaml"], "");
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("demo.buildersOnly");
    expect(blocked.stderr).toContain("the plan's shape is the parent's");
  });

  it("attributes its rows to the session the marker names", () => {
    // The gate runs outside any session. Without the handshake its refusals would land in a shared
    // `commit` stream instead of the chat that caused them.
    expect(rows("live-1").some((row) => row["kind"] === "run" && row["moment"] === "commit")).toBe(true);
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
    expect(rows(session).some((row) => row["kind"] === "guardrail" && row["out"] === "deny"), "and it is on the record").toBe(true);
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
      rows("live-4").filter((row) => row["kind"] === "run").length,
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

  /** A subagent the host spawned as `agentType` — its sidecar is the evidence it is classified by. */
  function spawned(agent: string, agentType: string): Record<string, unknown> {
    mkdirSync(join(tree, ".t"), { recursive: true });
    const transcript = join(tree, ".t", `${agent}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { content: "work on it" } })}\n`);
    writeFileSync(join(tree, ".t", `${agent}.meta.json`), JSON.stringify({ agentType, description: agentType }));
    return { session_id: "f5", agent_id: agent, transcript_path: transcript };
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
    const builder = spawned("agent-b1", "builder");
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
    expect(refused.stderr).toContain(`Other tool calls overlapped this one: Bash ${builderCall.key} (agent agent-b1 of session f5)`);
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
    const later = bash(spawned("agent-b1", "builder"), "echo 'export const f = 1;' > src/f.ts");
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

  it("refuses and reverts a write by an actor that is not a writer, naming who wrote it", () => {
    const checker = spawned("agent-v1", "verifier");
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

describe("the off switch", () => {
  it("silences every rail, and writes no telemetry while it is off", () => {
    writeFileSync(join(repo, ".flow", "off"), "");
    const before = rows("live-1").length;
    expect(hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/c.ts"), content: "TODO" })).code).toBe(0);
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
      const guarded = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/d.ts"), content: "fine" }));
      expect(guarded.code, "a guard that cannot run must not look like a guard that passed").toBe(2);
      expect(guarded.stderr).toContain("flow.config.ts could not be loaded");
      const greeting = hook("session-start", { session_id: "live-3", source: "startup" });
      expect(greeting.code, "refusing the opening greeting would wedge the session before anyone read why").toBe(0);
      expect(greeting.stdout).toContain("could not be loaded");
    } finally {
      writeFileSync(join(repo, "flow.config.ts"), good);
    }
  });

  // THE ONE EXCEPTION, and the reason it exists: taken without it, fail-loud refuses the only write
  // that can end the outage, and the doctrine's own instruction — "adjust the change so it passes,
  // then retry" — cannot be obeyed by anything that meets a hook. A human in an editor never hits
  // it. An agent that broke the config is locked out of repairing it.
  describe("the write that can fix it is allowed through, and nothing else is", () => {
    const withBrokenConfig = (drive: () => void, how = "will not import at all"): void => {
      const good = readFileSync(join(repo, "flow.config.ts"), "utf8");
      const breaker = BREAKS[how];
      expect(breaker, `no break called "${how}"`).toBeDefined();
      writeFileSync(join(repo, "flow.config.ts"), (breaker as (good: string) => string)(good));
      try {
        drive();
      } finally {
        writeFileSync(join(repo, "flow.config.ts"), good);
      }
    };

    // EVERY WAY OF BREAKING IT, not just the one the shell happened to catch as a thrown error.
    it.each(Object.keys(BREAKS))("lets the repair through and refuses the rest — %s", (how) => {
      withBrokenConfig(() => {
        const broken = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/g.ts"), content: "fine" }));
        expect(broken.code, "the guard cannot run, so ordinary work is refused").toBe(2);

        const repair = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "flow.config.ts"), content: "// fixed" }));
        expect(repair.code, "the repair is refused, so the repo stays broken until a human arrives").toBe(0);

        const pack = hook("pre-tool-use", inThisSession("Edit", { file_path: join(repo, "guards", "house.ts"), new_string: "// fixed" }));
        expect(pack.code, "a pack the config imports is as much the repair as the config is").toBe(0);

        const command = hook("pre-tool-use", inThisSession("Bash", { command: "git push --force" }));
        expect(command.code, "a command names a string, never a target — the rail stays shut").toBe(2);

        const gate = runFlow(repo, ["commit", "flow.config.ts"]);
        expect(gate.code, "nothing written under the exception lands unguarded").toBe(2);
      }, how);
    });

    // THE TURN ENDS. Holding it prevents nothing — every write, command and commit above is already
    // refused — while it does stop the agent handing back to the one person who can fix the config.
    it.each(Object.keys(BREAKS))("reports the fault at Stop and lets the turn end — %s", (how) => {
      withBrokenConfig(() => {
        const stop = hook("stop", { session_id: "live-stop", hook_event_name: "Stop" });
        expect(stop.code, "a held turn cannot hand back to the human who would fix it").toBe(0);
        expect(stop.stderr, "and it is not silent — the turn ends knowing why").not.toBe("");
      }, how);
    });

    it("lets a write reach the config itself and the packs it imports", () => {
      withBrokenConfig(() => {
        const config = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "flow.config.ts"), content: "// fixed" }));
        expect(config.code, "the repair is refused, so the repo stays broken until a human arrives").toBe(0);
        expect(config.stderr, "and it is allowed silently — a notice here is noise on the way out").toBe("");

        const pack = hook("pre-tool-use", inThisSession("Edit", { file_path: join(repo, "guards", "house.ts"), new_string: "// fixed" }));
        expect(pack.code, "a pack the config imports is as much the repair as the config is").toBe(0);

        // And a pack it does NOT import is not the repair: the surface is read out of the config's
        // own import lines, so a folder nobody named is an ordinary folder.
        const stranger = hook("pre-tool-use", inThisSession("Edit", { file_path: join(repo, "rules", "other.ts"), new_string: "// fixed" }));
        expect(stranger.code, "the exception is exactly as wide as this config's own imports").toBe(2);
      });
    });

    it("still refuses every other write, so the exception is the repair and not an amnesty", () => {
      withBrokenConfig(() => {
        const ordinary = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/e.ts"), content: "fine" }));
        expect(ordinary.code, "a broken guard must not wave ordinary work through").toBe(2);
        expect(ordinary.stderr).toContain("could not be loaded");
      });
    });

    it("keeps the COMMAND rail fully closed — a command names a string, never a target", () => {
      withBrokenConfig(() => {
        // `sed -i` on the config would be a repair by intent, and there is no way to tell it from
        // `rm -rf` before it runs. The route back is the edit tools, which name the file.
        const command = hook("pre-tool-use", inThisSession("Bash", { command: `sed -i "" s/x/y/ ${join(repo, "flow.config.ts")}` }));
        expect(command.code).toBe(2);
        expect(command.stderr).toContain("could not be loaded");
      });
    });

    it("keeps the COMMIT gate closed, so nothing written under the exception lands unguarded", () => {
      withBrokenConfig(() => {
        const gate = runFlow(repo, ["commit", "flow.config.ts"]);
        expect(gate.code, "a commit while the guard cannot run is a commit nothing checked").toBe(2);
        expect(gate.stderr).toContain("could not be loaded");
      });
    });

    it("changes nothing at all when the config is healthy", () => {
      // The exception is keyed on the BROKEN state and nowhere else: with a working config the
      // config surface is guarded exactly like every other path, by whatever rules watch it.
      const config = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "flow.config.ts"), content: "// TODO" }));
      expect(config.code, "a healthy guard judges the config file on its rules, like any other file").toBe(0);
      const ordinary = hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "src/f.ts"), content: "fine" }));
      expect(ordinary.code).toBe(0);
    });
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
    expect(run(["commit", "tool/x.ts"], "").code).toBe(2);
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
    expect(read.moments.totals).toMatchObject({ guardrails: 6, breadcrumbs: 2 });
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
