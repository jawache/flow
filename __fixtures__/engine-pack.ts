// The fixture the ENGINE suite drives — a pack written the way a real repo writes one, carrying
// the shapes the engine has to tell apart.
//
// It is deliberately NOT the core-check fixture next door. That one proves every stock check is
// reachable and alive; this one proves the machinery AROUND a check — which entries an event
// reaches, who they bind to, what happens when one of them is broken. So the checks here are
// inline lambdas with obvious answers: a test that fails should point at the engine, never at a
// regex.
//
// Two entries here are deliberately broken (`explodes`, and `misScoped`'s command scope) because
// the fail-loud matrix needs something to fail. They would not survive `flow test`, which is the
// point of that command; nothing in this file is bound by flow.config.ts.

import {
  breadcrumb,
  command,
  commit,
  defineCategory,
  definePack,
  guardrail,
  session,
  touch,
  spawnedAs,
  turnEnd,
  write,
  type Ctx,
} from "../index.ts";

// ── the categories, written the way the crossing will write them ──────────────
//
// The names are local to this fixture. flow ships none, and these are not a preview of work's:
// they exist so the scoping matrix has a scoped rule to be about.

/** A spawned builder — named by the host when it can, recovered from the brief when it cannot. */
export const builder = defineCategory(
  "builder",
  spawnedAs({
    types: ["builder"],
    generic: ["general-purpose", "claude"],
    brief: ["Follow `/work build`", "You are the builder"],
  }),
);

/** A spawned verifier. Its brief QUOTES a builder's work, which is why rung 2 must never see it. */
export const verifier = defineCategory("verifier", spawnedAs({ types: ["verifier"] }));

/** The top-level session, by structural absence and by nothing else. */
export const parent = defineCategory("parent", spawnedAs({ parent: true }));

const banTodo = (ctx: Ctx) => (ctx.file?.content.includes("TODO") ? ctx.fail("says TODO") : ctx.ok());

export const rails = definePack("rails", {
  /** Scoped: it fires for a builder and stays silent for everybody else. */
  buildersOnly: guardrail()
    .at(write)
    .on("plan/**")
    .for(builder)
    .check(banTodo)
    .message("A builder completes its phase — the plan's shape is the parent's.")
    .test({ pass: [{ path: "plan/a.yml", content: "ok" }], block: [{ path: "plan/a.yml", content: "TODO" }] }),

  /** Scoped to two: `.for(a, b)` ORs, so either actor meets it. */
  eitherRung: guardrail()
    .at(write)
    .for(builder, verifier)
    .check(banTodo)
    .message("Neither rung writes a TODO.")
    .test({ pass: [{ path: "a.ts", content: "ok" }], block: [{ path: "a.ts", content: "TODO" }] }),

  /** Unscoped: absence means every category, exactly as an absent `on` means every path. */
  everyone: guardrail()
    .at(write)
    .check(banTodo)
    .message("Nobody writes a TODO.")
    .test({ pass: [{ path: "a.ts", content: "ok" }], block: [{ path: "a.ts", content: "TODO" }] }),

  /** A commit entry that named `.on(…)`, so the gate asks it about each staged file in scope. */
  stagedFiles: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(banTodo)
    .message("A staged file still says TODO.")
    .test({
      pass: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "ok" } } }],
      block: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "TODO" } } }],
    }),

  /** A commit entry that named none, so the gate asks it once and hands it the whole staged set. */
  wholeCommit: guardrail()
    .at(commit)
    .check((ctx) => ((ctx.staged ?? []).includes("package.json") ? ctx.fail("no lockfile") : ctx.ok()))
    .message("A dependency change without its lockfile is a build nobody can reproduce.")
    .test({ pass: [{ staged: ["src/a.ts"] }], block: [{ staged: ["package.json"] }] }),

  /** A command rail: its patterns ARE its scope, so it names no paths. */
  noForce: guardrail()
    .at(command)
    .check((ctx) => ((ctx.command ?? "").includes("--force") ? ctx.fail("force") : ctx.ok()))
    .message("Never force-push — the history is shared.")
    .test({ pass: ["git push"], block: ["git push --force"] }),

  /** A turn-end rail, handed the turn's actions and nothing else. */
  ranTests: guardrail()
    .at(turnEnd)
    .check((ctx) => ((ctx.turn ?? []).some((a) => a.did === "run") ? ctx.ok() : ctx.fail("nothing ran")))
    .message("You changed things and never ran anything.")
    .test({ pass: [{ actions: [{ did: "run", command: "just test" }] }], block: [{ actions: [] }] }),

  /** A gate that shells out — the shape that meets a missing command. */
  suitePasses: guardrail()
    .at(commit)
    .check(async (ctx) => {
      const result = await ctx.exec("just test-commit");
      return result.code === 0 ? ctx.ok() : ctx.fail(`\`just test-commit\` failed (exit ${result.code}): ${result.stderr}`);
    })
    .message("The suite is red — the commit is refused.")
    .test({
      pass: [{ staged: ["a.ts"], world: { exec: { "just test-commit": { code: 0 } } } }],
      block: [{ staged: ["a.ts"], world: { exec: { "just test-commit": { code: 1, stderr: "red" } } } }],
    }),

  /** BROKEN ON PURPOSE: a check that throws. A crash is a failing check, never a skipped one. */
  explodes: guardrail()
    .at(write)
    .check((): never => {
      throw new Error("cannot read properties of undefined");
    })
    .message("This rail is broken.")
    .test({ pass: [], block: [{ path: "a.ts", content: "x" }] }),

  /** Turned off, with its reason. It is inert at every moment and proves nothing. */
  retired: guardrail().at(write).disabled("superseded by everyone"),

  notes: {
    /** An area note: shown on first touch of its area, and again once the session has drifted. */
    area: breadcrumb().at(touch).on("src/**").text("src/ is the product — its tests sit beside it."),
    /** The session greeting. It survives a compaction, because the host re-delivers it. */
    orientation: breadcrumb().at(session).text("This repo is guarded by flow."),
    /** A note scoped to an actor, and one whose prose lives in a file rather than inline. */
    forBuilders: breadcrumb().at(touch).on("src/**").for(builder).file("docs/builder.md"),
  },
});
