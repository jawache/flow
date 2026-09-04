// flow.config.ts, as a repo writes it — the whole surface in one file, and the one file that
// turns anything on.
//
// Two verbs: `pack(x, params?)` binds a pack and all its entries, opt-out; `override(x.entry)`
// speaks only what it changes. Everything an override does not say comes from the pack.
//
// This file is a FIXTURE with two jobs, and both are the phase's proof: it must compile with zero
// diagnostics, and it must load with zero refusals. See flow/grammar.test.ts.

import { defineConfig, pack, override, write, commit } from "../index.ts";
import { house, tdd } from "./demo-pack.ts";

export default defineConfig([
  pack(house),

  // Move it: the pack's globs were written for somebody else's tree.
  override(house.noTodo).on("src/content/**"),

  // Reword it: the pack's own moments and check still apply — say only what changes.
  override(house.ssr).text("Marketing pages are whole-page cached — they must render the same for everyone."),

  // Switch it off, with the sentence `flow status` prints beside it.
  override(house.plan.shapeIsParents).disabled("no supervised runs happen in this repo yet"),

  // A pack that needs a repo fact declares it, and the type makes the demand unskippable.
  pack(tdd, { run: "just test-commit" }),
  override(tdd.commitRunsTests).at(write, commit),
]);
