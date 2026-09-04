import { describe, it, expect } from "vitest";
import {
  definePack,
  pack,
  override,
  defineConfig,
  packDefinition,
  refTarget,
  overlay,
} from "./packs.ts";
import { guardrail, breadcrumb, isSentence } from "./entries.ts";
import { write, commit, command, session } from "./moments.ts";
import { verdict, type Check } from "./checks.ts";
import { defineCategory } from "./categories.ts";

const passes: Check = () => verdict.ok();
const cases = { pass: ["ok"], block: ["no"] };
const builderCategory = defineCategory("builder", () => true);

const prose = definePack("prose", {
  noEmDash: guardrail()
    .at(write, commit)
    .on("src/**/*.md")
    .check(passes)
    .message("No em dashes in prose.")
    .test(cases),
  house: breadcrumb().at(session).text("The house style."),
});

const git = definePack("git", {
  node: {
    versionIsSemver: guardrail().at(commit).check(passes).message("SemVer only.").test(cases),
  },
});

const tdd = definePack("tdd", (params: { run: string }) => ({
  commitRunsTests: guardrail()
    .at(commit)
    .check(passes)
    .message(`Tests failed (${params.run}) — the commit is refused.`)
    .test(cases),
}));

describe("definePack", () => {
  it("carries its name and the tree it builds", () => {
    const def = packDefinition(prose);
    expect(def?.name).toBe("prose");
    expect(def?.takesParams).toBe(false);
    expect(Object.keys(def?.build(undefined) ?? {})).toEqual(["noEmDash", "house"]);
  });

  it("says when its entries are a closure over parameters, and closes over them on binding", () => {
    const def = packDefinition(tdd);
    expect(def?.takesParams).toBe(true);
    const entry = def?.build({ run: "just test-commit" })["commitRunsTests"];
    const spec = isSentence(entry) ? entry.spec : undefined;
    expect(spec?.kind === "guardrail" && spec.message).toBe(
      "Tests failed (just test-commit) — the commit is refused.",
    );
  });

  it("is not a pack when it was never made by definePack", () => {
    expect(packDefinition({ name: "prose" })).toBeUndefined();
    expect(packDefinition(null)).toBeUndefined();
  });
});

describe("entry references", () => {
  it("are typed properties, so an id is one spelling from definition to log line", () => {
    expect(refTarget(prose.noEmDash)).toEqual({ pack: "prose", id: "noEmDash" });
  });

  it("nest, because a pack may group", () => {
    expect(refTarget(git.node.versionIsSemver)).toEqual({ pack: "git", id: "node.versionIsSemver" });
  });

  it("work on a parameterised pack without anyone supplying parameters to name one", () => {
    expect(refTarget(tdd.commitRunsTests)).toEqual({ pack: "tdd", id: "commitRunsTests" });
  });

  it("are not made by anything else", () => {
    expect(refTarget({ pack: "prose", id: "noEmDash" })).toBeUndefined();
    expect(refTarget("prose.noEmDash")).toBeUndefined();
  });
});

describe("pack() and override() — the whole binding surface", () => {
  it("records a pack binding, with no parameters when the pack takes none", () => {
    const config = defineConfig([pack(prose)]);
    expect(config.bindings).toHaveLength(1);
    const [binding] = config.bindings;
    expect(binding?.kind).toBe("pack");
    expect(binding?.kind === "pack" && binding.pack?.name).toBe("prose");
    expect(binding?.kind === "pack" && binding.hasParams).toBe(false);
  });

  it("records the parameters a parameterised pack was bound with", () => {
    const [binding] = defineConfig([pack(tdd, { run: "just test-commit" })]).bindings;
    expect(binding?.kind === "pack" && binding.hasParams).toBe(true);
    expect(binding?.kind === "pack" && binding.params).toEqual({ run: "just test-commit" });
  });

  it("records an override as the ref plus ONLY the keys it spoke", () => {
    const [binding] = defineConfig([override(prose.noEmDash).on("src/content/**")]).bindings;
    expect(binding?.kind).toBe("override");
    expect(binding?.kind === "override" && binding.ref).toEqual({ pack: "prose", id: "noEmDash" });
    expect(binding?.kind === "override" && binding.spoken).toEqual({ on: ["src/content/**"] });
  });

  it("records a disable and its reason", () => {
    const [binding] = defineConfig([override(prose.noEmDash).disabled("nothing publishes prose")]).bindings;
    expect(binding?.kind === "override" && binding.spoken).toEqual({
      disabled: { reason: "nothing publishes prose" },
    });
  });

  it("speaks every override verb, and records exactly the ones it spoke", () => {
    const [binding] = defineConfig([
      override(prose.noEmDash)
        .at(commit)
        .for(builderCategory)
        .on("src/**")
        .ignore("**/*.test.md")
        .message("Reworded for this repo.")
        .description("Why it is scoped this narrowly here."),
    ]).bindings;
    expect(binding?.kind === "override" && Object.keys(binding.spoken)).toEqual([
      "at",
      "for",
      "on",
      "ignore",
      "message",
      "description",
    ]);
    expect(binding?.kind === "override" && binding.spoken["for"]).toEqual([builderCategory]);
  });

  it("speaks the breadcrumb prose verbs, which a guardrail override cannot", () => {
    const inline = defineConfig([override(prose.house).text("A shorter house note.")]).bindings[0];
    expect(inline?.kind === "override" && inline.spoken).toEqual({ text: "A shorter house note." });

    const external = defineConfig([override(prose.house).file("guards/notes/house.md")]).bindings[0];
    expect(external?.kind === "override" && external.spoken).toEqual({ file: "guards/notes/house.md" });
  });

  it("keeps the sentences in the order they were spoken", () => {
    const config = defineConfig([pack(prose), override(prose.noEmDash).on("x/**"), pack(git)]);
    expect(config.bindings.map((b) => b.kind)).toEqual(["pack", "override", "pack"]);
  });
});

describe("overlay — a spoken key replaces the pack's WHOLE key, nothing merges", () => {
  const packSpec = guardrail()
    .at(write, commit)
    .on("src/**/*.md", "docs/**/*.md")
    .check(passes)
    .message("No em dashes in prose.")
    .test(cases).spec;

  it("passes the definition straight through when nothing was spoken", () => {
    const { spec, source } = overlay(packSpec, {});
    expect(spec).toEqual(packSpec);
    expect(source["on"]).toBe("pack");
  });

  it("replaces a list rather than adding to it — two merge semantics is two bugs", () => {
    const { spec, source } = overlay(packSpec, { on: ["src/content/**"] });
    expect(spec.on).toEqual(["src/content/**"]);
    expect(source["on"]).toBe("override");
  });

  it("leaves every unspoken key coming from the pack", () => {
    const { spec, source } = overlay(packSpec, { on: ["src/content/**"] });
    expect(spec.at).toEqual(["write", "commit"]);
    expect(spec.kind === "guardrail" && spec.message).toBe("No em dashes in prose.");
    expect(source["at"]).toBe("pack");
    expect(source["message"]).toBe("pack");
  });

  it("carries a disable through as an ordinary key — the entry still exists and is still listed", () => {
    const { spec, source } = overlay(packSpec, { disabled: { reason: "covered elsewhere" } });
    expect(spec.disabled).toEqual({ reason: "covered elsewhere" });
    expect(spec.kind === "guardrail" && spec.check).toBe(passes);
    expect(source["disabled"]).toBe("override");
  });

  it("keeps an earlier override's provenance when a second one lands on the same entry", () => {
    const first = overlay(packSpec, { on: ["src/content/**"] });
    const second = overlay(first.spec, { ignore: ["**/*.draft.md"] }, first.source);
    expect(second.source["on"]).toBe("override");
    expect(second.source["ignore"]).toBe("override");
    expect(second.source["at"]).toBe("pack");
  });

  it("moves a rule's moments wholesale", () => {
    const { spec } = overlay(packSpec, { at: [command] });
    expect(spec.at).toEqual(["command"]);
  });
});
