// SAID TWICE — one verb, spoken again.
//
// A second `.on(…)` is not a silent overwrite and not a merge. It is a call the type system has
// already removed, because the alternative is a sentence whose meaning depends on reading order.

import { definePack, guardrail, commit, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  noTodo: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    // @refusal This expression is not callable
    .on("docs/**/*.md")
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),
});
