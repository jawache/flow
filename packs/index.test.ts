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
import { defineConfig, loadConfig, pack } from "../index.ts";

/** The entries a config loaded, or an empty list and the refusals in the failure message. */
function loaded(result: ReturnType<typeof loadConfig>): { id: string; spec: unknown }[] {
  expect(result.ok ? [] : result.refusals.map((refusal) => refusal.detail)).toEqual([]);
  return result.ok ? [...result.entries] : [];
}

describe("the packs surface", () => {
  // ONE PACK, and nothing else: flow's own self-protection. The nine others are a project's own
  // rules, kept in that project's `guards/` and shipped to nobody.
  it("is exactly what a config file may bind", () => {
    expect(Object.keys(packs).sort()).toEqual(["flow"]);
  });

  // THE GUARD PACK'S SCOPE, which is a parameter for the same reason the recipes are: one repo's
  // folder name was written into both of its path-scoped entries, so every other repo bound a nudge
  // that never fires and a delete refusal that protects nothing — while `flow status` counted both
  // as armed. A message can be read; a scope has to be looked at, which is what this does.
  it("scopes the flow pack on the folder the repo says its packs are in, and on no other", () => {
    const bound = (homes: readonly string[]): Record<string, readonly string[]> => {
      return Object.fromEntries(
        loaded(loadConfig(defineConfig([pack(packs.flow, { packs: homes })]))).map((entry) => [
          entry.id,
          (entry.spec as { on?: readonly string[] }).on ?? [],
        ]),
      );
    };

    const theirs = bound(["rules/**", "policy/*.ts"]);
    expect(theirs["flow.editingTheGuardrails"]).toContain("rules/**");
    expect(theirs["flow.editingTheGuardrails"]).toContain("policy/*.ts");
    expect(theirs["flow.noDeleteGuardrails"]).toStrictEqual(["flow.config.ts", "rules/**", "policy/*.ts", ".githooks/pre-commit"]);

    // Empty is a real answer — the config IS the whole guard — and the two entries still cover it
    // and the host's registrations, and nothing invented.
    const inline = bound([]);
    expect(inline["flow.noDeleteGuardrails"]).toStrictEqual(["flow.config.ts", ".githooks/pre-commit"]);
    expect(inline["flow.editingTheGuardrails"]).toStrictEqual([
      "flow.config.ts",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/agents/**",
      ".claude/skills/**",
    ]);
    // Whatever a repo passes, the package never puts a folder of its own into either scope.
    for (const scope of Object.values(theirs).concat(Object.values(inline)))
      for (const glob of scope) expect(glob.startsWith("guards/"), glob).toBe(false);
  });

});
