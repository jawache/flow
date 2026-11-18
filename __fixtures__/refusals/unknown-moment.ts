// UNKNOWN MOMENT — a word for a rail that does not exist, and a word from the other vocabulary.
//
// `push` was accepted for a year and fired by nothing. Moments are imported values now, so a
// moment that does not exist is a name that does not resolve. A guardrail at `session`, which has
// no rail to refuse at, and a breadcrumb at `commit`, which has no rail to add text at, do not
// compile either, and nor does a guardrail at `fileChange`, which has already happened. `write` and `delete` are no moments at all: flow stops no write and no delete.

import { definePack, breadcrumb, commit, fileChange, guardrail, session, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  orientation: breadcrumb()
    // @refusal Argument of type '"commit"' is not assignable
    .at(commit)
    .text("a breadcrumb has no commit rail — git calls flow there, and no text reaches the agent"),

  startsEarly: guardrail()
    // @refusal Argument of type '"session"' is not assignable
    .at(session)
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),

  noRailAfterTheFact: guardrail()
    // @refusal Argument of type '"file-change"' is not assignable
    .at(fileChange)
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),

  noWrite: guardrail()
    // @refusal Argument of type '"write"' is not assignable
    .at("write")
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),

  noPush: guardrail()
    // @refusal Argument of type '"push"' is not assignable
    .at("push")
    .check(passes)
    .message("m")
    .test({ block: ["x"] }),
});
