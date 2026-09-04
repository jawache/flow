// MISSING PARAMETER — a pack that needs a repo fact, bound without it.
//
// `tdd` cannot guess your test command. The parameter's type makes the demand visible and
// unskippable, and the error lands on the `pack(…)` line rather than at a load nobody watches.

import { defineConfig, pack } from "../../index.ts";
import { tdd } from "../demo-pack.ts";

export default defineConfig([
  // @refusal Expected 2 arguments, but got 1
  pack(tdd),
]);
