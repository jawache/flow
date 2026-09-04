// MISSING MANDATORY — a guardrail that never said what it tells you.
//
// Nothing in this grammar defaults, so an entry that skipped a verb is not an entry with a
// fallback: it is not an entry. The error names the verb, at the property it belongs to.

import { definePack, guardrail, commit, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  // @refusal never said .message()
  noTodo: guardrail().at(commit).check(passes).test({ block: ["x"] }),
});
