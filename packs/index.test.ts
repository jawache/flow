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

  // THE PACK TAKES NO PARAMETER: it protects four named files, and a repo that keeps its own packs
  // in a folder adds a `protectedPath` rule of its own. Looked at the way the rule is asked at a
  // commit: a deletion is refused, a change is not.
  it("binds with no parameter, and refuses the deletion of the four guard files and nothing else", async () => {
    const entries = loaded(loadConfig(defineConfig([pack(packs.flow)])));
    expect(entries.map((entry) => entry.id).sort()).toEqual(["flow.noDeleteGuardrails", "flow.noUninstall", "flow.orientation"]);
    const check = (entries.find((entry) => entry.id === "flow.noDeleteGuardrails")?.spec as { check: Check }).check;
    const refuses = async (deleted: string): Promise<boolean> => !(await check(commitOf([], [deleted]))).ok;
    for (const file of ["flow.config.ts", ".githooks/commit-msg", ".claude/settings.json", ".codex/hooks.json"]) expect(await refuses(file), file).toBe(true);
    expect(await refuses("src/a.ts")).toBe(false);
    expect(await refuses("guards/a.ts")).toBe(false);
    // Changing the config is what a repo does all day: only a deletion is refused.
    expect((await check(commitOf(["flow.config.ts"], []))).ok).toBe(true);
  });

});
