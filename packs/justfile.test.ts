// flow/packs/justfile.test.ts — the pure helper this pack's catalogue rule is built from.
//
// The pack's rules carry their own `.test({ pass, block })` cases and `flow test` drives them;
// what a case cannot show is the WALK. `undocumentedRecipes` reads a whole file line by line and
// decides, per line, whether it is looking at a recipe at all — and the answers that matter are
// the NEGATIVE ones: a body line, an assignment, a `set` directive, a recipe already excused by an
// attribute two lines up. A case gives one verdict over one fixture; these give the line-by-line
// judgement that produced it, which is where the recorded fault was.

import { describe, it, expect } from "vitest";
import { undocumentedRecipes } from "./justfile.ts";

/** Just the names, which is what every claim below is about. */
const named = (text: string, exempt: readonly string[] = []): string[] =>
  undocumentedRecipes(text, exempt).map((r) => r.name);

describe("undocumentedRecipes", () => {
  it("names an undocumented recipe and the 1-based line it is on", () => {
    const text = ["# a comment", "test:", "    npx vitest run"].join("\n");
    expect(undocumentedRecipes(text)).toEqual([{ name: "test", line: 2 }]);
  });

  it("says nothing about a recipe carrying a [doc(…)]", () => {
    expect(named(['[doc("Run the suite.")]', "test:", "    npx vitest run"].join("\n"))).toEqual([]);
  });

  // THE RECORDED FAULT. `just --list` hides a [private] recipe, so it is not in the catalogue and
  // cannot owe the catalogue a description. The message promised this exemption from the day it was
  // written and the walk never honoured it — the reader did what they were told and was refused.
  it("excuses a [private] recipe, which is not in the catalogue to begin with", () => {
    expect(named(["[private]", "internal:", "    echo hi"].join("\n"))).toEqual([]);
  });

  it("walks up over a run of attribute lines, so either attribute excuses either way round", () => {
    expect(named(["[private]", '[doc("why")]', "a:", "    x"].join("\n"))).toEqual([]);
    expect(named(['[doc("why")]', "[private]", "b:", "    x"].join("\n"))).toEqual([]);
  });

  it("stops walking up at the first NON-attribute line, so a distant doc excuses nothing", () => {
    const text = ['[doc("belongs to a")]', "a:", "    x", "b:", "    y"].join("\n");
    expect(named(text)).toEqual(["b"]);
  });

  it("ignores indented body lines, however recipe-shaped they look", () => {
    expect(named(['[doc("x")]', "a:", "    test: not a recipe"].join("\n"))).toEqual([]);
  });

  it("ignores an assignment, which is a := and not a recipe", () => {
    expect(named(["mode := 'release'", '[doc("x")]', "a:", "    y"].join("\n"))).toEqual([]);
  });

  it("ignores the words that open a non-recipe construct at column 0", () => {
    const text = ["set shell := ['bash', '-c']", "export FOO := 'x'", "alias t := test", '[doc("x")]', "test:", "    y"].join("\n");
    expect(named(text)).toEqual([]);
  });

  it("reads a recipe with parameters, and one written with a leading @", () => {
    expect(named(["greet name:", "    echo {{name}}"].join("\n"))).toEqual(["greet"]);
    expect(named(["@quiet:", "    echo hi"].join("\n"))).toEqual(["quiet"]);
  });

  it("lets the binding exempt a recipe by name — `default` being the one every justfile has", () => {
    expect(named(["default:", "    @just --list"].join("\n"), ["default"])).toEqual([]);
  });

  it("reports every offender, not the first", () => {
    expect(named(["a:", "    x", "b:", "    y"].join("\n"))).toEqual(["a", "b"]);
  });
});
