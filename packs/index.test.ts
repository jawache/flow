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
import { defineConfig, loadConfig, pack, type Check, type Ctx } from "../index.ts";

/** The little of a commit's ctx a rule about deletions reads: the staged and the deleted paths, and the two answers. */
const commitOf = (staged: readonly string[], deleted: readonly string[]): Ctx =>
  ({ staged, deleted, ok: () => ({ ok: true }), fail: (detail?: string) => ({ ok: false, detail }) }) as unknown as Ctx;

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
  // folder name was written into its path-scoped entry, so every other repo bound a delete refusal
  // that protects nothing — while `flow status` counted it as armed. A message can be read; a
  // scope has to be looked at, which is what this does.
  it("scopes the flow pack on the folder the repo says its packs are in, and on no other", async () => {
    const entries = (homes: readonly string[]) => loaded(loadConfig(defineConfig([pack(packs.flow, { packs: homes })])));
    // The delete refusal is about a commit's deleted paths, which a rule with `.on(…)` is never
    // asked about, so it names its paths in its check. Looked at the same way: the deletion of a
    // file in a folder the repo named is refused, and of one in a folder it did not name is not.
    const refuses = async (homes: readonly string[], deleted: string): Promise<boolean> => {
      const check = (entries(homes).find((entry) => entry.id === "flow.noDeleteGuardrails")?.spec as { check: Check }).check;
      return !(await check(commitOf([], [deleted]))).ok;
    };
    expect(await refuses(["rules/**", "policy/*.ts"], "rules/a.ts")).toBe(true);
    expect(await refuses(["rules/**", "policy/*.ts"], "policy/b.ts")).toBe(true);
    expect(await refuses(["rules/**"], "guards/a.ts"), "a folder the repo did not name").toBe(false);
    expect(await refuses([], "flow.config.ts")).toBe(true);
    expect(await refuses([], ".githooks/commit-msg")).toBe(true);
    expect(await refuses([], "src/a.ts")).toBe(false);
    // Changing the config is what a repo does all day: only a deletion is refused.
    const change = (entries([]).find((entry) => entry.id === "flow.noDeleteGuardrails")?.spec as { check: Check }).check;
    expect((await change(commitOf(["flow.config.ts"], []))).ok).toBe(true);
  });

});
