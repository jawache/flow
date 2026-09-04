// flow/grammar.test.ts — J1.3, both halves, on the same artefacts.
//
// The claim is that a config mistake cannot load quietly: it fails the typecheck in your editor,
// AND the load re-validates the same rules for a config that got past one. Proving only the
// second half would be the old system's proof — a validator nobody reaches. So this file drives
// the COMPILER, which is the half no unit test can stand in for.
//
// It compiles flow/__fixtures__/ under its own tsconfig (flow's own project excludes the folder,
// or `just typecheck-flow` could never be green) and asserts, per file:
//
//   refusals/*.ts   the compiler refused, on the line the file marks with `// @refusal <text>`,
//                   with `<text>` in the diagnostic. The marker sits on the line ABOVE the
//                   offending call, which is where a reader writes a note about it anyway.
//   valid.config.ts zero diagnostics — the complete config, using every part of the grammar.
//
// Then it LOADS that same valid config and asserts zero refusals. One artefact, both gates.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./pure/validate.ts";
import config from "./__fixtures__/valid.config.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(HERE, "__fixtures__");

interface Diagnostic {
  file: string;
  line: number;
  text: string;
}

/** `tsc` over the fixtures project, as diagnostics. Non-zero exit is expected — that is the point. */
function compileFixtures(): Diagnostic[] {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", join(FIXTURES, "tsconfig.json"), "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8" },
  );
  // A tsc diagnostic is one header line plus any number of INDENTED continuation lines, and the
  // sentence that matters is often in the continuation — an overload failure says "No overload
  // matches this call" first and names the real mismatch underneath. So a diagnostic here is the
  // header and everything indented below it, joined.
  const out = `${result.stdout}${result.stderr}`;
  const diagnostics: Diagnostic[] = [];
  for (const raw of out.split("\n")) {
    const m = /^(.+?)\((\d+),\d+\): error \w+: (.*)$/.exec(raw);
    if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      diagnostics.push({ file: m[1], line: Number(m[2]), text: m[3] });
    } else if (/^\s+\S/.test(raw)) {
      const last = diagnostics[diagnostics.length - 1];
      if (last) last.text += `\n${raw.trim()}`;
    }
  }
  return diagnostics;
}

/** Every `// @refusal <text>` in a file, paired with the line it expects the error on. */
function expectations(path: string): { line: number; text: string }[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((raw, index) => {
      const m = /^\s*\/\/ @refusal (.+?)\s*$/.exec(raw);
      // The marker is on `index` (0-based); the offending line is the next one, 1-based.
      return m?.[1] === undefined ? [] : [{ line: index + 2, text: m[1] }];
    });
}

const diagnostics = compileFixtures();
const fixtureFiles = readdirSync(join(FIXTURES, "refusals")).filter((f) => f.endsWith(".ts")).sort();

describe("the compiler refuses every grammar misuse", () => {
  it("has a fixture per class of misuse, and each one marks what it expects", () => {
    expect(fixtureFiles).toEqual([
      "breadcrumb-no-prose.ts",
      "missing-mandatory.ts",
      "missing-parameter-field.ts",
      "missing-parameter.ts",
      "no-cases.ts",
      "override-reaches-into-check.ts",
      "override-wrong-kind.ts",
      "said-twice.ts",
      "undeclared-category.ts",
      "unknown-key.ts",
      "unknown-moment.ts",
    ]);
  });

  for (const name of fixtureFiles) {
    const path = join(FIXTURES, "refusals", name);
    const rel = relative(ROOT, path);
    const wanted = expectations(path);

    it(`${name} — refused at the marked line`, () => {
      expect(wanted.length).toBeGreaterThan(0);
      const here = diagnostics.filter((d) => d.file === rel);
      for (const { line, text } of wanted) {
        const hit = here.find((d) => d.line === line);
        expect(hit, `${rel}:${line} — expected a compiler error, got: ${JSON.stringify(here)}`).toBeDefined();
        expect(hit?.text).toContain(text);
      }
    });
  }
});

describe("the complete valid config", () => {
  it("compiles with no diagnostics at all", () => {
    const rel = relative(ROOT, join(FIXTURES, "valid.config.ts"));
    expect(diagnostics.filter((d) => d.file === rel)).toEqual([]);
  });

  it("loads with no refusals — packs, overrides, parameters and a category, all bound", () => {
    const result = loadConfig(config);
    expect(result.ok ? [] : result.refusals).toEqual([]);
  });

  it("resolves to the entries the config actually turns on, each with its provenance", () => {
    const result = loadConfig(config);
    const entries = result.ok ? result.entries : [];
    expect(entries.map((e) => e.id)).toEqual([
      "house.orientation",
      "house.ssr",
      "house.noTodo",
      "house.noPushToMain",
      "house.plan.shapeIsParents",
      "tdd.commitRunsTests",
    ]);

    const noTodo = entries.find((e) => e.id === "house.noTodo");
    expect(noTodo?.spec.on).toEqual(["src/content/**"]);
    expect(noTodo?.source["on"]).toBe("override");
    expect(noTodo?.source["message"]).toBe("pack");

    const scoped = entries.find((e) => e.id === "house.plan.shapeIsParents");
    expect(scoped?.categories).toEqual(["builder"]);
    expect(scoped?.spec.disabled).toEqual({ reason: "no supervised runs happen in this repo yet" });

    const tests = entries.find((e) => e.id === "tdd.commitRunsTests");
    expect(tests?.spec.at).toEqual(["write", "commit"]);
    expect(tests?.phases).toEqual(["edit", "commit"]);
  });
});
