// flow/packs/index.test.ts — what `@jawache/flow/packs` means, held still.
//
// The same discipline flow/index.test.ts holds the grammar to, and for the same reason: a
// re-export file fails silently. A pack that quietly stops being exported does not break a build
// here — it breaks somebody else's `flow status` at their next install, which is the worst place
// to find out. So the surface is a LIST: adding to it is a line here, removing from it is a
// deliberate deletion rather than a dropped export.
//
// The pack's RULES are not tested here. Every entry carries its own `.test({ pass, block })` cases
// and `flow test` drives them through the same ctx the live rails build.

import { describe, it, expect } from "vitest";
import * as packs from "./index.ts";

describe("the packs surface", () => {
  // ONE PACK, and nothing else: flow's own self-protection. The nine others are a project's own
  // rules, kept in that project's `guards/` and shipped to nobody.
  it("is exactly what a config file may bind", () => {
    expect(Object.keys(packs).sort()).toEqual(["flow"]);
  });

});
