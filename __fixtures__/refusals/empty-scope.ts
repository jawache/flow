// AN EMPTY SCOPE — `.on()` or `.ignore()` with no globs.
//
// `.on()` matches no path and `.ignore()` carves out nothing, so either reads as a decision and
// decides nothing. The verb takes at least one glob, on every chain that has it: a guardrail, a
// breadcrumb and an override.
//
// What the compiler can see is a LITERAL empty call. A spread list that turns out empty at run time
// — `.on(...repo.files)` — is the load's `empty-scope` refusal to catch. Both halves, always.

import { definePack, defineConfig, pack, override, guardrail, breadcrumb, write, touch, type Check } from "../../index.ts";
import { house } from "../demo-pack.ts";

const passes: Check = (ctx) => ctx.ok();

export const rogue = definePack("rogue", {
  emptyOn: guardrail()
    .at(write)
    // @refusal Expected 1 arguments, but got 0
    .on()
    .check(passes)
    .message("m")
    .test({ block: [{ path: "src/a.ts", content: "x" }] }),

  emptyIgnore: guardrail()
    .at(write)
    .on("src/**")
    // @refusal Expected 1 arguments, but got 0
    .ignore()
    .check(passes)
    .message("m")
    .test({ block: [{ path: "src/a.ts", content: "x" }] }),

  // @refusal Expected 1 arguments, but got 0
  noteOn: breadcrumb().at(touch).on().text("t"),

  // @refusal Expected 1 arguments, but got 0
  noteIgnore: breadcrumb().at(touch).on("docs/**").ignore().text("t"),
});

export default defineConfig([
  pack(house),
  // @refusal Expected 1 arguments, but got 0
  override(house.noTodo).on(),
  // @refusal Expected 1 arguments, but got 0
  override(house.ssr).ignore(),
]);
