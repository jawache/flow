// UNDECLARED CATEGORY — a rule scoped to a name nobody defined.
//
// A category is a VALUE with its recognizer aboard, so `.for(…)` takes the imported thing and
// never a string. Referenced-is-registered: there is no separate list to fall out of step with.

import { definePack, guardrail, write, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  planShape: guardrail()
    .at(write)
    // @refusal not assignable to parameter of type 'Category'
    .for("builder")
    .check(passes)
    .message("m")
    .test({ block: [{ path: "a.ts", content: "x" }] }),
});
