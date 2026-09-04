// UNKNOWN KEY — a verb the grammar does not have.
//
// `bans:` for `ban:` was the shape that made the old format's closure necessary: a key it could
// not judge, so the entry loaded and checked nothing. Here it is not a key at all.

import { definePack, guardrail, commit, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  noTodo: guardrail()
    .at(commit)
    .check(passes)
    // @refusal Property 'text' does not exist
    .text("breadcrumbs carry text; guardrails carry a message")
    .message("m")
    .test({ block: ["x"] }),
});
