// flow/packs/index.test.ts — what `@jawache/flow/packs` means, held still.
//
// The same discipline flow/index.test.ts holds the grammar to, and for the same reason: a
// re-export file fails silently. A pack that quietly stops being exported does not break a build
// here — it breaks somebody else's `flow status` at their next install, which is the worst place
// to find out. So the surface is a LIST: adding to it is a line here, removing from it is a
// deliberate deletion rather than a dropped export.
//
// The packs' RULES are not tested here. Every entry carries its own `.test({ pass, block })` cases
// and `flow test` drives them through the same ctx the live rails build — a second suite over the
// same logic would be a second place for it to be right.

import { describe, it, expect } from "vitest";
import * as packs from "./index.ts";
import { defineConfig, loadConfig, pack } from "../index.ts";

describe("the packs surface", () => {
  it("is exactly what a config file may bind", () => {
    expect(Object.keys(packs).sort()).toEqual([
      "builder",
      "checker",
      "conventionalCommit",
      "docs",
      "fcis",
      "git",
      "guard",
      "justfile",
      "justfileDocs",
      "lockfileInStep",
      "newCommandNeedsCaller",
      "noGitDiscard",
      "noHandEditedVersion",
      "node",
      "parent",
      "secrets",
      "tdd",
      "typescript",
      "work",
    ]);
  });

  // The ten the spec names, spelled out as ten: the list above also carries the checks and the
  // categories, so "how many packs ship" is a question it cannot answer on its own.
  it("ships ten packs, and a config binding all ten loads clean", () => {
    const result = loadConfig(
      defineConfig([
        pack(packs.docs),
        pack(packs.fcis, {
          files: ["src/pure/**/*.ts"],
          homes: ["src/pure/**"],
          coverage: "npm run coverage",
          example: "src/pure/money.ts",
        }),
        pack(packs.git, { release: "npm run release" }),
        pack(packs.guard, { packs: ["rules/**"] }),
        pack(packs.justfile, { exempt: [] }),
        pack(packs.node),
        pack(packs.secrets, { dx: "npm run dx", encrypt: "npm run seal", names: "npm run names" }),
        pack(packs.tdd, { run: "npm test" }),
        pack(packs.typescript, { typecheck: "npm run typecheck", lint: "npm run lint" }),
        pack(packs.work),
      ]),
    );
    expect(result.ok ? [] : result.refusals).toEqual([]);
    const bound = new Set(result.ok ? result.entries.map((e) => e.id.split(".")[0]) : []);
    expect([...bound].sort()).toEqual([
      "docs",
      "fcis",
      "git",
      "guard",
      "justfile",
      "node",
      "secrets",
      "tdd",
      "typescript",
      "work",
    ]);
  });

  // THE PARAMETERS, proved where they are meant to land: in the sentence a blocked person reads.
  //
  // Four packs take a repo fact, and three of them (fcis, justfile, tdd) hand it to a check, where
  // the entry's own `block` case already drives it. `git` and `typescript` hand theirs to a MESSAGE
  // as well — the whole reason they became parameters is that a hard-coded `just release` names the
  // wrong command in every repo that spells it differently, and names it at the worst moment. A
  // case cannot see a message, so this is the one place that can say so.
  it("puts the repo's own recipe names into the sentences that name a command", () => {
    const result = loadConfig(
      defineConfig([
        pack(packs.git, { release: "cargo release" }),
        pack(packs.typescript, { typecheck: "make types", lint: "make lint" }),
      ]),
    );
    const entries = result.ok ? result.entries : [];
    /** What the entry says — a guardrail's refusal, a breadcrumb's prose. */
    const said = (id: string): string => {
      const found = entries.find((entry) => entry.id === id);
      expect(found, `no entry ${id}`).toBeDefined();
      const spec = (found as { spec: { message?: string; text?: string } }).spec;
      return spec.message ?? spec.text ?? "";
    };
    expect(said("git.orientation")).toContain("cargo release");
    expect(said("git.node.noHandEditedVersion")).toContain("cargo release");
    expect(said("typescript.commitRunsTsc")).toContain("make types");
    expect(said("typescript.commitRunsEslint")).toContain("make lint");
    // And nothing carries the fleet's own spelling any more — the point of the extraction.
    for (const entry of entries) {
      const spec = entry.spec as { message?: string; text?: string };
      expect(`${spec.message ?? ""}\n${spec.text ?? ""}`, entry.id).not.toContain("just ");
    }
  });

  // THE GUARD PACK'S SCOPE, which is a parameter for the same reason the recipes are: one repo's
  // folder name was written into both of its path-scoped entries, so every other repo bound a nudge
  // that never fires and a delete refusal that protects nothing — while `flow status` counted both
  // as armed. A message can be read; a scope has to be looked at, which is what this does.
  it("scopes the guard pack on the folder the repo says its packs are in, and on no other", () => {
    const bound = (homes: readonly string[]): Record<string, readonly string[]> => {
      const result = loadConfig(defineConfig([pack(packs.guard, { packs: homes })]));
      expect(result.ok ? [] : result.refusals).toEqual([]);
      return Object.fromEntries(
        (result.ok ? result.entries : []).map((entry) => [entry.id, (entry.spec as { on?: readonly string[] }).on ?? []]),
      );
    };

    const theirs = bound(["rules/**", "policy/*.ts"]);
    expect(theirs["guard.editingTheGuardrails"]).toContain("rules/**");
    expect(theirs["guard.editingTheGuardrails"]).toContain("policy/*.ts");
    expect(theirs["guard.noDeleteGuardrails"]).toStrictEqual(["flow.config.ts", "rules/**", "policy/*.ts", ".githooks/pre-commit"]);

    // Empty is a real answer — the config IS the whole guard — and the two entries still cover it
    // and the host's registrations, and nothing invented.
    const inline = bound([]);
    expect(inline["guard.noDeleteGuardrails"]).toStrictEqual(["flow.config.ts", ".githooks/pre-commit"]);
    expect(inline["guard.editingTheGuardrails"]).toStrictEqual([
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
