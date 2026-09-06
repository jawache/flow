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
        pack(packs.fcis, { files: ["src/pure/**/*.ts"], homes: ["src/pure/**"], coverage: "npm run coverage" }),
        pack(packs.git),
        pack(packs.guard),
        pack(packs.justfile, { exempt: [] }),
        pack(packs.node),
        pack(packs.secrets),
        pack(packs.tdd, { run: "npm test" }),
        pack(packs.typescript),
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
});
