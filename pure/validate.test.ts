import { describe, it, expect } from "vitest";
import { loadConfig, REFUSAL_CODES, type Refusal } from "./validate.ts";
import {
  definePack,
  pack,
  override,
  defineConfig,
  type ConfigSentence,
  type EntryRef,
  type Pack,
  type PackBinding,
} from "./packs.ts";
import { guardrail, breadcrumb, type EntryGroup } from "./entries.ts";
import { write, commit, session } from "./moments.ts";
import { defineCategory } from "./categories.ts";
import { verdict, type Check } from "./checks.ts";

const passes: Check = () => verdict.ok();
const cases = { pass: ["ok"], block: ["no"] };

const builder = defineCategory("builder", (s) => s.agentType === "builder");

const house = definePack("house", {
  noTodo: guardrail()
    .at(write, commit)
    .on("src/**/*.ts")
    .check(passes)
    .message("No TODOs.")
    .test(cases),
  orientation: breadcrumb().at(session).text("You are in the house."),
  node: {
    versionIsSemver: guardrail().at(commit).check(passes).message("SemVer only.").test(cases),
  },
});

const tdd = definePack("tdd", (params: { run: string }) => ({
  commitRunsTests: guardrail()
    .at(commit)
    .check(passes)
    .message(`Tests failed (${params.run}).`)
    .test(cases),
}));

/** Refusals are read by code and entry — the wording is the builder's and may be improved. */
const shape = (refusals: readonly Refusal[]) => refusals.map((r) => [r.code, r.entry]);

const loadOrThrow = (sentences: readonly ConfigSentence[]) => {
  const result = loadConfig(defineConfig(sentences));
  if (!result.ok) throw new Error(`expected a clean load, got: ${JSON.stringify(shape(result.refusals))}`);
  return result.entries;
};

const refusalsOf = (sentences: readonly ConfigSentence[]) => {
  const result = loadConfig(defineConfig(sentences));
  return result.ok ? [] : result.refusals;
};

/**
 * A pack binding built from raw specs, with `definePack` and its types stepped around.
 *
 * That is the whole point of the matrix below: the compiler refuses every one of these shapes at
 * the line you type (flow/typecheck.test.ts proves that), so the ONLY way a load ever sees one is
 * the way this helper makes it — a config that reached the loader without an editor in the way.
 */
const rawPack = (name: string, entries: Record<string, unknown>): PackBinding => ({
  kind: "pack",
  pack: { name, build: () => entries as EntryGroup, takesParams: false },
  params: undefined,
  hasParams: false,
});

describe("a complete, valid config", () => {
  const entries = loadOrThrow([
    pack(house),
    override(house.noTodo).on("src/content/**"),
    pack(tdd, { run: "just test-commit" }),
    override(house.node.versionIsSemver).disabled("nothing publishes 0.0.1"),
  ]);

  it("loads clean, with every bound entry present", () => {
    expect(entries.map((e) => e.id)).toEqual([
      "house.noTodo",
      "house.orientation",
      "house.node.versionIsSemver",
      "tdd.commitRunsTests",
    ]);
  });

  it("closes a parameterised pack's sentences over the parameters it was bound with", () => {
    const entry = entries.find((e) => e.id === "tdd.commitRunsTests");
    expect(entry?.spec.kind === "guardrail" && entry.spec.message).toBe("Tests failed (just test-commit).");
  });

  it("applies each override, replacing the pack's whole key and nothing else", () => {
    const entry = entries.find((e) => e.id === "house.noTodo");
    expect(entry?.spec.on).toEqual(["src/content/**"]);
    expect(entry?.spec.at).toEqual(["write", "commit"]);
    expect(entry?.source["on"]).toBe("override");
    expect(entry?.source["at"]).toBe("pack");
  });

  it("keeps a disabled entry — listed, with its reason, and never run", () => {
    const entry = entries.find((e) => e.id === "house.node.versionIsSemver");
    expect(entry?.spec.disabled).toEqual({ reason: "nothing publishes 0.0.1" });
  });

  it("resolves each entry's engine phases from its moments", () => {
    expect(entries.find((e) => e.id === "house.noTodo")?.phases).toEqual(["edit", "commit"]);
    expect(entries.find((e) => e.id === "house.orientation")?.phases).toEqual([]);
  });

  it("names the categories an entry is scoped to, and leaves an unscoped entry unscoped", () => {
    const scoped = definePack("scoped", {
      planShape: guardrail()
        .at(write)
        .for(builder)
        .check(passes)
        .message("The plan's shape is the parent's.")
        .test(cases),
    });
    const [entry] = loadOrThrow([pack(scoped)]);
    expect(entry?.categories).toEqual(["builder"]);
    expect(loadOrThrow([pack(house)])[0]?.categories).toEqual([]);
  });
});

// ── the refusal matrix ───────────────────────────────────────────────────────
//
// Every class the grammar can be misused in, and the named refusal it earns. The compiler catches
// each of these too (see flow/typecheck.test.ts); this is the backstop for a config that reached
// the loader without an editor in the way.

describe("the load refuses", () => {
  it("a value bound as a pack that never was one", () => {
    const notAPack = { noTodo: guardrail().at(commit) } as unknown as Pack<EntryGroup>;
    expect(shape(refusalsOf([pack(notAPack)]))).toEqual([["not-a-pack", ""]]);
  });

  it("a parameterised pack bound with no parameters, naming the pack", () => {
    const bound = pack(tdd as unknown as Pack<EntryGroup>);
    expect(shape(refusalsOf([bound]))).toEqual([["missing-parameter", "tdd"]]);
  });

  it("an override of an entry no bound pack has, naming what was asked for", () => {
    expect(shape(refusalsOf([pack(house), override(house.node.versionIsSemver).on("x/**")]))).toEqual([]);
    const ghost = refusalsOf([pack(house), override(tdd.commitRunsTests).on("x/**")]);
    expect(shape(ghost)).toEqual([["unknown-entry", "tdd.commitRunsTests"]]);
  });

  it("an unknown key on an entry", () => {
    const rogue = rawPack("rogue", {
      noTodo: { spec: { kind: "guardrail", at: [commit], check: passes, message: "m", test: cases, bans: [] } },
    });
    expect(shape(refusalsOf([rogue]))).toEqual([["unknown-key", "rogue.noTodo"]]);
  });

  it("a breadcrumb key spoken on a guardrail — the closed sets are not interchangeable", () => {
    const rogue = rawPack("rogue", {
      noTodo: { spec: { kind: "guardrail", at: [commit], check: passes, message: "m", test: cases, text: "hi" } },
    });
    expect(shape(refusalsOf([rogue]))).toEqual([["unknown-key", "rogue.noTodo"]]);
  });

  it("a guardrail with no `at`, and a guardrail with no `message`", () => {
    const noAt = rawPack("noAt", { x: { spec: { kind: "guardrail", check: passes, message: "m", test: cases } } });
    expect(shape(refusalsOf([noAt]))).toEqual([["missing-mandatory", "noAt.x"]]);

    const noMessage = rawPack("noMessage", { x: { spec: { kind: "guardrail", at: [commit], check: passes, test: cases } } });
    expect(shape(refusalsOf([noMessage]))).toEqual([["missing-mandatory", "noMessage.x"]]);
  });

  it("a breadcrumb carrying neither text nor file", () => {
    const mute = rawPack("mute", { x: { spec: { kind: "breadcrumb", at: [session] } } });
    expect(shape(refusalsOf([mute]))).toEqual([["missing-mandatory", "mute.x"]]);
  });

  it("a moment the entry type has no rail for", () => {
    const wrong = rawPack("wrong", { x: { spec: { kind: "breadcrumb", at: ["write"], text: "hi" } } });
    expect(shape(refusalsOf([wrong]))).toEqual([["unknown-moment", "wrong.x"]]);

    const never = rawPack("never", {
      x: { spec: { kind: "guardrail", at: ["push"], check: passes, message: "m", test: cases } },
    });
    expect(shape(refusalsOf([never]))).toEqual([["unknown-moment", "never.x"]]);
  });

  it("an entry scoped to something that is not a declared category", () => {
    const fake = rawPack("fake", {
      x: {
        spec: {
          kind: "guardrail",
          at: [commit],
          for: [{ name: "builder", classify: () => true }],
          check: passes,
          message: "m",
          test: cases,
        },
      },
    });
    expect(shape(refusalsOf([fake]))).toEqual([["undeclared-category", "fake.x"]]);
  });

  it("a guardrail that carries no cases — the dead-fence class, killed at authoring time", () => {
    const untested = rawPack("untested", { x: { spec: { kind: "guardrail", at: [commit], check: passes, message: "m" } } });
    expect(shape(refusalsOf([untested]))).toEqual([["no-cases", "untested.x"]]);

    const empty = rawPack("empty", {
      x: { spec: { kind: "guardrail", at: [commit], check: passes, message: "m", test: {} } },
    });
    expect(shape(refusalsOf([empty]))).toEqual([["no-cases", "empty.x"]]);
  });

  it("but never asks a disabled entry to prove itself", () => {
    const off = rawPack("off", { x: { spec: { kind: "guardrail", at: [commit], disabled: { reason: "not yet" } } } });
    expect(shape(refusalsOf([off]))).toEqual([]);
  });

  it("two entries claiming one id — the same pack bound twice", () => {
    expect(shape(refusalsOf([pack(house), pack(house)]))).toEqual([
      ["duplicate-id", "house.noTodo"],
      ["duplicate-id", "house.orientation"],
      ["duplicate-id", "house.node.versionIsSemver"],
    ]);
  });

  it("an override that moves an entry to a moment its type has no rail for", () => {
    const asGuardrail = house.orientation as unknown as EntryRef<"guardrail">;
    const refusals = refusalsOf([pack(house), override(asGuardrail).at(write)]);
    expect(shape(refusals)).toEqual([["unknown-moment", "house.orientation"]]);
  });

  it("every fault in one file, not the first — a config with three mistakes reports three", () => {
    const broken = rawPack("broken", {
      a: { spec: { kind: "guardrail", check: passes, message: "m", test: cases } },
      b: { spec: { kind: "guardrail", at: [commit], check: passes, test: cases } },
      c: { spec: { kind: "guardrail", at: [commit], check: passes, message: "m" } },
    });
    expect(shape(refusalsOf([broken]))).toEqual([
      ["missing-mandatory", "broken.a"],
      ["missing-mandatory", "broken.b"],
      ["no-cases", "broken.c"],
    ]);
  });

  it("with a sentence a reader can act on, naming the entry", () => {
    const [refusal] = refusalsOf([pack(house), override(tdd.commitRunsTests).on("x/**")]);
    expect(refusal?.detail).toContain("tdd.commitRunsTests");
    expect(refusal?.detail.length).toBeGreaterThan(20);
  });
});

describe("REFUSAL_CODES", () => {
  it("is the closed vocabulary every refusal draws from", () => {
    expect(REFUSAL_CODES).toEqual([
      "not-a-pack",
      "missing-parameter",
      "unknown-entry",
      "unknown-key",
      "unknown-moment",
      "missing-mandatory",
      "undeclared-category",
      "no-cases",
      "duplicate-id",
    ]);
  });
});
