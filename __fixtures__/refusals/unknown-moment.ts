// UNKNOWN MOMENT — a word for a rail that does not exist, and a word from the other vocabulary.
//
// `push` was accepted for a year and fired by nothing. Moments are imported values now, so a
// moment that does not exist is a name that does not resolve.

import { definePack, breadcrumb, guardrail, write, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  orientation: breadcrumb()
    // @refusal Argument of type '"write"' is not assignable
    .at(write)
    .text("a breadcrumb has no write rail — it is a note, not a gate"),

  noTodo: guardrail()
    // @refusal Argument of type '"push"' is not assignable
    .at("push")
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),
});
