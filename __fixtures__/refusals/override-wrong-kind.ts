// A KEY FROM THE OTHER ENTRY TYPE, spoken in an override.
//
// References are typed, so `override(…)` already knows whether it is holding a guardrail or a
// breadcrumb. `.message()` on a note and `.text()` on a gate are refused where you type them.

import { defineConfig, pack, override } from "../../index.ts";
import { house } from "../demo-pack.ts";

export default defineConfig([
  pack(house),
  // @refusal not callable
  override(house.orientation).message("a breadcrumb has no message"),
]);
