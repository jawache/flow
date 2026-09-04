// NO CASES — a rule that carries nothing proving it is alive.
//
// This is the class of bug that shipped two dead import fences for four days: a matcher that
// matched nothing, in a config that loaded green. A rule whose block-case passes cannot ship, and
// a rule with no block-case cannot be written.

import { definePack, guardrail, commit, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  // @refusal never said .test()
  noTodo: guardrail().at(commit).check(passes).message("No TODOs."),
});
