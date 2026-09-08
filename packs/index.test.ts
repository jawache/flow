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

/** The entries a config loaded, or an empty list and the refusals in the failure message. */
function loaded(result: ReturnType<typeof loadConfig>): { id: string; spec: unknown }[] {
  expect(result.ok ? [] : result.refusals.map((refusal) => refusal.detail)).toEqual([]);
  return result.ok ? [...result.entries] : [];
}

/**
 * What an entry SAYS — a guardrail's refusal, a breadcrumb's prose — by id.
 *
 * The one thing a `.test({ pass, block })` case cannot see. A case drives the check and reads the
 * verdict; the sentence the blocked person actually reads is beside it, and every parameter and
 * every computed default that only ever reaches prose is invisible until something asserts on it.
 */
function sentence(entries: readonly { id: string; spec: unknown }[]): (id: string) => string {
  return (id) => {
    const found = entries.find((entry) => entry.id === id);
    expect(found, `no entry ${id}`).toBeDefined();
    const spec = (found as { spec: { message?: string; text?: string } }).spec;
    return spec.message ?? spec.text ?? "";
  };
}

describe("the packs surface", () => {
  // TEN PACKS AND THREE RUNGS, and nothing else. Five configured checks used to sit on this list
  // too, exported from a shared `checks.ts` beside the packs; not one was ever bound outside the
  // pack it was written for, so each folded into that pack and the file went. What a house pack
  // reaches for now is the grammar and the stock checks, and those come through `@jawache/flow`.
  it("is exactly what a config file may bind", () => {
    expect(Object.keys(packs).sort()).toEqual([
      "builder",
      "checker",
      "docs",
      "fcis",
      "flow",
      "git",
      "justfile",
      "node",
      "parent",
      "secrets",
      "tdd",
      "typescript",
      "work",
    ]);
  });

  // "AND ALL TEN BIND CLEAN" USED TO BE HERE, and it is not any more: `packs/machine.test.ts`
  // binds the same ten with a stranger's parameters, in a repo `flow init` scaffolded, and asserts
  // `flow status` green plus the exact list of all fifty-five entries they produce — strictly more
  // than a refusal count over ten prefixes, through the built package rather than the source. Two
  // tests of one claim means the weaker one is what fails first and the stronger one gets read as
  // a duplicate. What stays here is what that road does not cover: the door's export list, the
  // parameters that reach a MESSAGE (no case can see one), and the flow pack's scopes.

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
    const entries = loaded(result);
    const said = sentence(entries);
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

  // THE DEFAULTS, proved in the same place and for the same reason. Two packs now have an arm that
  // exists only when a repo names nothing, and both arms live entirely in prose: `secrets` bound
  // bare falls back to dotenvx's own spelling, and `typescript` with no shared base keeps only the
  // strictness opinion. Nothing else in the suite can reach either sentence — the machine test
  // drives both bindings but asserts on ids and counts, and a case cannot see a message. A default
  // that silently became `undefined <file>` is exactly what this catches, because that is what one
  // of them did before the parameter behind it was deleted.
  it("names dotenvx itself when nothing wraps it, and the strict options when no base is named", () => {
    const entries = loaded(
      loadConfig(defineConfig([pack(packs.secrets), pack(packs.typescript, { typecheck: "make types", lint: "make lint" })])),
    );
    const said = sentence(entries);

    expect(said("secrets.orientation")).toContain("One seam: `dotenvx run -f .env.<env> -- <cmd>`");
    // Built from the pack's own `publicPrefixes`, so the command a refusal hands over is the one
    // that leaves exactly those plaintext — a bare `dotenvx encrypt` would seal them.
    expect(said("secrets.envEncrypted")).toContain("Seal it with `dotenvx encrypt -ek 'PUBLIC_*'`");
    expect(said("secrets.noSecretsInCommits")).toContain("`dotenvx encrypt -ek 'PUBLIC_*'`");

    expect(said("typescript.strictTypesNoInvalidStates")).toContain("`strict` and `noUncheckedIndexedAccess` stay on wherever they are set");
    expect(said("typescript.tsconfigStrict")).toContain("turns off one of strict / noUncheckedIndexedAccess");
    // NO BASE, NO ENTRY: a rule demanding an import of a file the package does not ship would
    // refuse every repo that binds the pack.
    expect(entries.map((entry) => entry.id)).not.toContain("typescript.eslintFromBase");
    // And no sentence names a wrapper the repo never said it had.
    for (const entry of entries) {
      const spec = entry.spec as { message?: string; text?: string };
      expect(`${spec.message ?? ""}\n${spec.text ?? ""}`, entry.id).not.toContain("just ");
    }
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
