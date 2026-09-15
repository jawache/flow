// The pack a guarded REPO writes itself — the half no package can ship, in the shape every repo
// writes it: one file, a category and a rule, imported by that repo's flow.config.ts.
//
// It is a fixture with two drivers, and they are why it is a file rather than a string in either
// of them. `live.test.ts` needs the category, so a `.for(…)` rule has a rung to bind to at the
// commit gate. `e2e/machine.test.ts` needs the turn-end rule, because not one of the ten packs
// the package ships carries one — a fact about the packs, not about the moment — so the stranger's
// own pack is what proves that rail. Both used to hold their own copy of the same eight lines.
//
// The import below says `../index.ts` so this typechecks in place, with the rest of the fixtures.
// Each suite repoints it as it writes the file into its temp repo — at an absolute path where
// nothing is linked, at `@jawache/flow` where `flow init` has linked it. See `fixturePack` in
// flow/e2e/harness.ts.

import { defineCategory, definePack, guardrail, spawnedAs, turnEnd } from "../index.ts";

/**
 * What this pack counts as an action, and the ONE TypeScript-only construct in this file — on
 * purpose.
 *
 * A guarded repo's own pack is `.ts`, and node decides a `.ts` file's module system from the
 * nearest `package.json`: flow strips the types and evaluates it as ESM itself, so that a repo
 * which is not `type: "module"` can still be guarded (see the load hook at the top of flow.ts).
 * Written in plain JavaScript syntax, this fixture would prove only that the file was reached —
 * an interface and an annotation are what make it prove the stripping, in every suite that drives
 * it.
 */
interface Action {
  readonly did: string;
}

/** Untested work, as this pack counts it: more than three actions this turn, and every one an edit. */
function nothingRun(actions: readonly Action[]): boolean {
  return actions.length > 3 && actions.every((action) => action.did === "edit");
}

/**
 * A rung, recognised from what the HOST wrote — never from a claim the session made about itself.
 * A rule bound `.for(builder)` fires for a spawned builder and for nobody else.
 */
export const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));

export const house = definePack("house", {
  /**
   * The turn-end rail, and the only rule in this repo that watches it.
   *
   * Four edits and nothing run is the honest shape of the miss: not "you did not test" (a rule
   * that fires on every turn is a rule people learn to close), but "you changed a pile of files
   * this turn and never once found out whether they work".
   */
  ranSomething: guardrail()
    .at(turnEnd)
    .description("A turn that edited all the way through and ran nothing hands back untested work.")
    .check((ctx) => {
      const did = ctx.turn ?? [];
      return nothingRun(did) ? ctx.fail(`${did.length} edits, nothing run`) : ctx.ok();
    })
    .message("You edited all turn and ran nothing. Run the suite before you hand back.")
    .test({
      pass: [{ actions: [] }],
      block: [
        {
          actions: [
            { did: "edit", path: "core/a.ts" },
            { did: "edit", path: "core/b.ts" },
            { did: "edit", path: "core/c.ts" },
            { did: "edit", path: "core/d.ts" },
          ],
        },
      ],
    }),
});
