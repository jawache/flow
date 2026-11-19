// flow/e2e/guard-files.test.ts — the files `flow init` writes are the files `flow.noDeleteGuardrails` guards.
//
// Fast, and in e2e/ only because the fences let this folder reach the pack, the product's names and
// each harness's own constants at once, which no other folder may.

import { describe, it, expect } from "vitest";
import { CONFIG_FILE } from "../adapter/domain.ts";
import { claudeCode } from "../adapter/claude/claude.ts";
import { codex } from "../adapter/codex/codex.ts";
import { defineConfig, loadConfig, pack, type Ctx } from "../index.ts";
import { flow as flowPack } from "../packs/index.ts";

describe("the files flow writes", () => {
  // `flow.noDeleteGuardrails` names its files in the pack; init writes them under the adapter's own
  // names. A rename on one side alone would leave a file flow writes with no refusal behind it.
  it("are each one the flow pack refuses a commit to delete", async () => {
    const loaded = loadConfig(defineConfig([pack(flowPack)]));
    const entry = loaded.ok ? loaded.entries.find((e) => e.id === "flow.noDeleteGuardrails") : undefined;
    const check = (entry?.spec as { check: (ctx: Ctx) => Promise<{ ok: boolean }> }).check;
    const files = [CONFIG_FILE, ...[claudeCode, codex].map((harness) => harness.registering.repoFile)];
    for (const file of files) {
      const verdict = await check({ staged: [], deleted: [file], ok: () => ({ ok: true }), fail: () => ({ ok: false }) } as unknown as Ctx);
      expect(verdict.ok, `${file} is deleted by a commit`).toBe(false);
    }
  });
});

