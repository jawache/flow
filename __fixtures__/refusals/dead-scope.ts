// A DEAD SCOPE — globs on an entry that fires only where no path exists.
//
// P2's exact shape, and the reason it is worth a fixture: this config reads as a fence over
// `src/**` and narrows nothing at all. A command rail carries the line about to run and never a
// file, so `on` is consulted by nothing — the old engine's silence, now a refusal.
//
// The compiler catches it here because `.at(command)` was said FIRST. Said the other way round the
// load's `dead-scope` refusal is what catches it; both halves exist, always.

import { definePack, guardrail, command, type Check } from "../../index.ts";

const passes: Check = (ctx) => ctx.ok();

export default definePack("rogue", {
  noForcePush: guardrail()
    .at(command)
    // @refusal every moment this entry fires at carries no path
    .on("src/**/*.ts")
    .check(passes)
    .message("m")
    .test({ block: ["git push --force"] }),
});
