// flow/language/domain.test.ts — the grammar, proved.
//
// One file per layer, tests included: these were six sibling tests at F1 and they merged with the
// six modules they cover. The sections below are in the same order as domain.ts, so a reader
// walking the file has the proof of each part beside it.
//
// Two fixtures are shared rather than restated — `passes` (a check that always says yes) and
// `cases` (the smallest cases block an entry can carry) — because a fixture written three ways is
// three chances for one of them to stop meaning what the other two mean.

import { describe, it, expect } from "vitest";
import {
  breadcrumb,
  BREADCRUMB_KEYS,
  BREADCRUMB_MOMENTS,
  type BreadcrumbSpec,
  cannedWorld,
  type Cases,
  chain,
  type Check,
  command,
  commit,
  type ConfigSentence,
  type Ctx,
  defineCategory,
  defineCheck,
  defineConfig,
  definePack,
  deletion,
  type EntryGroup,
  type EntryRef,
  type ExecResult,
  guardrail,
  GUARDRAIL_KEYS,
  GUARDRAIL_MOMENTS,
  type GuardrailSpec,
  hasCases,
  isBreadcrumbMoment,
  isCategory,
  isGuardrailMoment,
  isSentence,
  loadConfig,
  makeCtx,
  overlay,
  override,
  pack,
  type Pack,
  type PackBinding,
  packDefinition,
  phasesOf,
  refTarget,
  type Refusal,
  REFUSAL_CODES,
  session,
  type SessionFacts,
  touch,
  turnEnd,
  type Unanswered,
  verdict,
  type World,
  write,
} from "./domain.ts";

const passes: Check = () => verdict.ok();
const cases = { pass: ["ok"], block: ["no"] };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MOMENTS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the moment vocabulary", () => {
  it("is the five guardrail words the engine has rails for", () => {
    expect(GUARDRAIL_MOMENTS).toEqual(["write", "command", "commit", "delete", "turn-end"]);
  });

  it("is the three breadcrumb words, which are not the same list", () => {
    expect(BREADCRUMB_MOMENTS).toEqual(["session", "touch", "turn-end"]);
  });

  it("exports each word as a value, so a config imports it rather than spelling it", () => {
    expect([write, command, commit, deletion, turnEnd]).toEqual([
      "write",
      "command",
      "commit",
      "delete",
      "turn-end",
    ]);
    expect([session, touch]).toEqual(["session", "touch"]);
  });

  it("names the delete moment `deletion` in the export, because `delete` cannot be a binding", () => {
    expect(deletion).toBe("delete");
    expect(GUARDRAIL_MOMENTS).toContain(deletion);
  });
});

describe("phasesOf — the table, lifted", () => {
  it("maps each moment to the engine phases it fires at", () => {
    expect(phasesOf([write])).toEqual(["edit"]);
    expect(phasesOf([command])).toEqual(["edit", "commit"]);
    expect(phasesOf([commit])).toEqual(["commit"]);
    expect(phasesOf([deletion])).toEqual(["delete"]);
    expect(phasesOf([turnEnd])).toEqual(["turn"]);
  });

  it("dedupes across moments, in declaration order", () => {
    expect(phasesOf([command, commit])).toEqual(["edit", "commit"]);
    expect(phasesOf([commit, command])).toEqual(["commit", "edit"]);
  });

  it("answers nothing for no moments", () => {
    expect(phasesOf([])).toEqual([]);
  });
});

describe("the moment guards", () => {
  it("recognise their own vocabulary and refuse the other's", () => {
    expect(isGuardrailMoment("write")).toBe(true);
    expect(isGuardrailMoment("session")).toBe(false);
    expect(isBreadcrumbMoment("session")).toBe(true);
    expect(isBreadcrumbMoment("write")).toBe(false);
  });

  it("share exactly one word — turn-end", () => {
    expect(isGuardrailMoment("turn-end")).toBe(true);
    expect(isBreadcrumbMoment("turn-end")).toBe(true);
  });

  it("refuse a word that is in neither", () => {
    expect(isGuardrailMoment("push")).toBe(false);
    expect(isBreadcrumbMoment("push")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════════════════════════════════════════

const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  head: "",
  subagent: false,
  ...over,
});

describe("defineCategory", () => {
  it("makes a value that carries its own recognizer", () => {
    const builder = defineCategory("builder", (s) => s.head.includes("/work build"));
    expect(builder.name).toBe("builder");
    expect(builder.classify(facts({ head: "Follow `/work build` in the work skill." }))).toBe(true);
    expect(builder.classify(facts({ head: "You are the parent." }))).toBe(false);
  });

  it("hands the classifier the host-written record, not a claim the session made", () => {
    const verifier = defineCategory("verifier", (s) => s.agentType === "verifier");
    expect(verifier.classify(facts({ subagent: true, agentType: "verifier" }))).toBe(true);
    // The same brief text, but the host says this spawn was something else.
    expect(
      verifier.classify(facts({ subagent: true, agentType: "builder", head: "verify the phase" })),
    ).toBe(false);
  });

  it("can classify the parent by absence — no sidecar, no agent type", () => {
    const parent = defineCategory("parent", (s) => !s.subagent);
    expect(parent.classify(facts())).toBe(true);
    expect(parent.classify(facts({ subagent: true, agentType: "builder" }))).toBe(false);
  });
});

describe("isCategory", () => {
  it("recognises a defined category", () => {
    expect(isCategory(defineCategory("demo", () => true))).toBe(true);
  });

  it("refuses anything that only looks like one — the undeclared-category refusal's basis", () => {
    expect(isCategory({ name: "builder", classify: () => true })).toBe(false);
    expect(isCategory("builder")).toBe(false);
    expect(isCategory(null)).toBe(false);
    expect(isCategory(undefined)).toBe(false);
    expect(isCategory(42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CHECKS — the contract
// ════════════════════════════════════════════════════════════════════════════════════════════════

const ok = { ok: true } as const;

/** A ctx with nothing but the verdict verbs — enough to drive a check that reads only facts. */
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
    moment: "commit",
    exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
    fs: { read: () => Promise.resolve(""), exists: () => Promise.resolve(false) },
    git: { diff: () => Promise.resolve(""), stagedFiles: () => Promise.resolve([]) },
    ok: verdict.ok,
    fail: verdict.fail,
  ...over,
});

describe("verdict", () => {
  it("says pass with nothing else", () => {
    expect(verdict.ok()).toEqual(ok);
  });

  it("says fail, carrying the detail that rides under the sentence's message", () => {
    expect(verdict.fail("package.json changed outside a release")).toEqual({
      ok: false,
      detail: "package.json changed outside a release",
    });
  });

  it("allows a fail with no detail — the message alone is the whole answer", () => {
    expect(verdict.fail()).toEqual({ ok: false });
  });
});

describe("makeCtx — the ONE assembler", () => {
  /** A world that records what it was asked, so the ctx's wiring is visible rather than assumed. */
  const spy = (): { world: World; asked: string[] } => {
    const asked: string[] = [];
    const world: World = {
      exec(cmd: string) {
        asked.push(`exec:${cmd}`);
        return Promise.resolve({ stdout: "out", stderr: "", code: 0 });
      },
      fs: {
        read(path: string) {
          asked.push(`read:${path}`);
          return Promise.resolve("body");
        },
        exists: () => Promise.resolve(true),
      },
      git: { diff: () => Promise.resolve("diff"), stagedFiles: () => Promise.resolve(["a.ts"]) },
    };
    return { world, asked };
  };

  it("carries the moment, the event's facts, and the three capabilities — and nothing else", async () => {
    const { world, asked } = spy();
    const built = makeCtx("write", { file: { path: "a.ts", content: "x" } }, world);
    expect(built.moment).toBe("write");
    expect(built.file).toEqual({ path: "a.ts", content: "x" });
    expect((await built.exec("ls")).stdout).toBe("out");
    expect(await built.fs.read("a.ts")).toBe("body");
    expect(await built.git.stagedFiles()).toEqual(["a.ts"]);
    expect(asked).toEqual(["exec:ls", "read:a.ts"]);
  });

  it("answers through ctx.ok / ctx.fail, which is a check's only spelling", () => {
    const built = makeCtx("commit", {}, spy().world);
    expect(built.ok()).toEqual(ok);
    expect(built.fail("why")).toEqual({ ok: false, detail: "why" });
  });

  it("keeps a world's own receiver, so an adapter that closes over itself still works", async () => {
    // The failure this pins: `exec: world.exec` detaches the method and calls it with the ctx as
    // `this`. A world implemented as a class — which a live adapter reasonably is — then reads its
    // own fields off the wrong object and answers nonsense.
    class Adapter {
      readonly label = "live";
      exec(cmd: string): Promise<ExecResult> {
        return Promise.resolve({ stdout: `${this.label}:${cmd}`, stderr: "", code: 0 });
      }
      readonly fs = { read: () => Promise.resolve(""), exists: () => Promise.resolve(false) };
      readonly git = { diff: () => Promise.resolve(""), stagedFiles: () => Promise.resolve([]) };
    }
    const built = makeCtx("command", { command: "ls" }, new Adapter());
    expect((await built.exec("ls")).stdout).toBe("live:ls");
  });
});

describe("cannedWorld — the ONE recorded world", () => {
  const reaches = (): Unanswered[] => [];

  it("answers exec exactly first, then by containment — a case cannot be asked to retype a heredoc", async () => {
    const missed = reaches();
    const w = cannedWorld({ exec: { depcruise: { stdout: "wide" }, "npx depcruise --config x": { stdout: "exact" } } }, undefined, missed);
    expect((await w.exec("npx depcruise --config x")).stdout).toBe("exact");
    expect((await w.exec("npx depcruise <<'CFG'\n{}\nCFG")).stdout).toBe("wide");
    expect(missed).toEqual([]);
  });

  it("RECORDS a reach it cannot answer instead of guessing — a fiction is how a case passes wrongly", async () => {
    const missed = reaches();
    const w = cannedWorld({ fs: { "a.ts": "body" } }, undefined, missed);
    expect(await w.fs.read("a.ts")).toBe("body");
    expect(await w.fs.read("b.ts")).toBe("");
    expect(await w.exec("just test")).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(missed).toEqual([
      { kind: "read", asked: "b.ts" },
      { kind: "exec", asked: "just test" },
    ]);
  });

  it("answers `exists` from the map alone — silence about a path means it is not there", async () => {
    const missed = reaches();
    const w = cannedWorld({ fs: { "a.ts": "" } }, undefined, missed);
    expect(await w.fs.exists("a.ts")).toBe(true);
    expect(await w.fs.exists("b.ts")).toBe(false);
    expect(missed).toEqual([]);
  });

  it("lets the event's own staged set win over the recording's, and defaults both to empty", async () => {
    expect(await cannedWorld({ staged: ["recorded.ts"] }, ["event.ts"], reaches()).git.stagedFiles()).toEqual([
      "event.ts",
    ]);
    expect(await cannedWorld({ staged: ["recorded.ts"] }, undefined, reaches()).git.stagedFiles()).toEqual([
      "recorded.ts",
    ]);
    expect(await cannedWorld({}, undefined, reaches()).git.stagedFiles()).toEqual([]);
    expect(await cannedWorld({ gitDiff: "@@ -1" }, undefined, reaches()).git.diff()).toBe("@@ -1");
    expect(await cannedWorld({}, undefined, reaches()).git.diff()).toBe("");
  });

  it("fills the exec answer's absent fields, so a case may record only the part it cares about", async () => {
    const w = cannedWorld({ exec: { "just test": { code: 1 } } }, undefined, reaches());
    expect(await w.exec("just test")).toEqual({ stdout: "", stderr: "", code: 1 });
  });
});

describe("defineCheck", () => {
  it("hands back the factory, so options close over into a plain check", async () => {
    const bansWord = defineCheck((opts: { word: string }): Check => {
      return (c) => (c.file?.content.includes(opts.word) ? c.fail(`found ${opts.word}`) : c.ok());
    });

    const noTodo = bansWord({ word: "TODO" });
    expect(await noTodo(ctx({ file: { path: "a.ts", content: "// TODO later" } }))).toEqual({
      ok: false,
      detail: "found TODO",
    });
    expect(await noTodo(ctx({ file: { path: "a.ts", content: "// done" } }))).toEqual(ok);
  });

  it("lets a check reach the world only through the injected capabilities", async () => {
    const suitePasses = defineCheck((opts: { run: string }): Check => {
      return async (c) => ((await c.exec(opts.run)).code === 0 ? c.ok() : c.fail(`${opts.run} failed`));
    });

    const red = ctx({ exec: () => Promise.resolve({ stdout: "", stderr: "boom", code: 1 }) });
    expect(await suitePasses({ run: "just test" })(red)).toEqual({ ok: false, detail: "just test failed" });
    expect(await suitePasses({ run: "just test" })(ctx())).toEqual(ok);
  });
});

describe("hasCases", () => {
  it("is true when either arm carries a case", () => {
    expect(hasCases({ block: ["git push origin main"] })).toBe(true);
    expect(hasCases({ pass: [{ path: "a.ts", content: "" }] })).toBe(true);
    expect(hasCases({ pass: [{ staged: ["package.json"] }] })).toBe(true);
  });

  it("is false for a cases block that proves nothing", () => {
    const empty: Cases = {};
    expect(hasCases(empty)).toBe(false);
    expect(hasCases({ pass: [], block: [] })).toBe(false);
    expect(hasCases(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTRIES — the sentence
// ════════════════════════════════════════════════════════════════════════════════════════════════

const pushCases = { pass: ["git push origin feature/x"], block: ["git push origin main"] };

describe("guardrail()", () => {
  it("says every key it was given, and nothing it was not", () => {
    const spec = guardrail()
      .at(write, commit)
      .on("src/**/*.ts")
      .ignore("**/*.test.ts")
      .check(passes)
      .message("No TODOs — open a journal entry or do it now.")
      .test(pushCases).spec;

    expect(spec).toEqual({
      kind: "guardrail",
      at: ["write", "commit"],
      on: ["src/**/*.ts"],
      ignore: ["**/*.test.ts"],
      check: passes,
      message: "No TODOs — open a journal entry or do it now.",
      test: pushCases,
    } satisfies GuardrailSpec);
  });

  it("leaves an unspoken key ABSENT — an absent `on` is absent, never `**/*`", () => {
    const spec = guardrail().at(commit).check(passes).message("m").test(pushCases).spec;
    expect("on" in spec).toBe(false);
    expect("ignore" in spec).toBe(false);
    expect("for" in spec).toBe(false);
    expect("description" in spec).toBe(false);
  });

  it("does not care what order the chain was spoken in", () => {
    const a = guardrail().at(commit).check(passes).message("m").test(pushCases).spec;
    const b = guardrail().test(pushCases).message("m").check(passes).at(commit).spec;
    expect(a).toEqual(b);
  });

  it("never mutates the sentence it was chained from", () => {
    const base = guardrail().at(commit);
    const withMessage = base.message("m");
    expect("message" in base.spec).toBe(false);
    expect(withMessage.spec.message).toBe("m");
  });

  it("carries the categories it binds to, in the order spoken", () => {
    const builder = defineCategory("builder", () => true);
    const verifier = defineCategory("verifier", () => false);
    const spec = guardrail()
      .at(write)
      .for(builder, verifier)
      .check(passes)
      .message("m")
      .test(pushCases).spec;
    expect(spec.for?.map((c) => c.name)).toEqual(["builder", "verifier"]);
  });

  it("records a disabled entry AND its reason — the sentence flow status prints", () => {
    const spec = guardrail().at(commit).disabled("fcis.pureHasTest covers the proved set").spec;
    expect(spec.disabled).toEqual({ reason: "fcis.pureHasTest covers the proved set" });
  });

  it("allows the reason to be left out, and still records that it is off", () => {
    expect(guardrail().at(commit).disabled().spec.disabled).toEqual({});
  });

  it("takes every guardrail moment, including the one whose export is not its word", () => {
    expect(guardrail().at(command, turnEnd).spec.at).toEqual(["command", "turn-end"]);
  });
});

describe("breadcrumb()", () => {
  it("is a note — text, where it shows, and nothing that could block", () => {
    const spec = breadcrumb()
      .at(session)
      .text("You are in the work platform.")
      .description("The project map.").spec;

    expect(spec).toEqual({
      kind: "breadcrumb",
      at: ["session"],
      text: "You are in the work platform.",
      description: "The project map.",
    } satisfies BreadcrumbSpec);
  });

  it("can point at a file instead, for prose too long to sit in the sentence", () => {
    const spec = breadcrumb().at(touch).on("src/pages/**").file("guards/notes/ssr.md").spec;
    expect(spec.file).toBe("guards/notes/ssr.md");
    expect("text" in spec).toBe(false);
  });
});

describe("the closed key sets", () => {
  it("are the spec's grammar and no more", () => {
    expect(GUARDRAIL_KEYS).toEqual([
      "at",
      "for",
      "on",
      "ignore",
      "check",
      "message",
      "disabled",
      "test",
      "description",
    ]);
    expect(BREADCRUMB_KEYS).toEqual(["at", "for", "on", "ignore", "text", "file", "disabled", "description"]);
  });

  it("differ only where the two entry types genuinely do", () => {
    const g = new Set<string>(GUARDRAIL_KEYS);
    const b = new Set<string>(BREADCRUMB_KEYS);
    expect(GUARDRAIL_KEYS.filter((k) => !b.has(k))).toEqual(["check", "message", "test"]);
    expect(BREADCRUMB_KEYS.filter((k) => !g.has(k))).toEqual(["text", "file"]);
  });
});

describe("chain — the one builder behind all three chains", () => {
  it("accumulates spoken keys and hands them to whatever the caller exposes them as", () => {
    const built = chain({ kind: "guardrail" }, (spoken) => ({ seen: spoken })) as unknown as {
      at: (...m: string[]) => { on: (...g: string[]) => { seen: Record<string, unknown> } };
    };
    expect(built.at("commit").on("src/**").seen).toEqual({
      kind: "guardrail",
      at: ["commit"],
      on: ["src/**"],
    });
  });

  it("is what both a sentence and an override are made of — same verbs, same replacement", () => {
    // The sentence exposes its keys as `.spec`; the override wraps them in a binding. Nothing
    // else differs, which is why there is one builder and not two.
    expect(guardrail().at(commit).on("a/**").spec).toEqual({
      kind: "guardrail",
      at: ["commit"],
      on: ["a/**"],
    });
  });
});

describe("isSentence", () => {
  it("recognises both entry types", () => {
    expect(isSentence(guardrail().at(commit))).toBe(true);
    expect(isSentence(breadcrumb().at(session))).toBe(true);
  });

  it("refuses a group, a bare spec and anything else", () => {
    expect(isSentence({ noTodo: guardrail().at(commit) })).toBe(false);
    expect(isSentence({ spec: { kind: "guardrail" } })).toBe(true);
    expect(isSentence({ spec: { kind: "wat" } })).toBe(false);
    expect(isSentence({ spec: "guardrail" })).toBe(false);
    expect(isSentence(null)).toBe(false);
    expect(isSentence("guardrail")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PACKS — define and bind
// ════════════════════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LOAD
// ════════════════════════════════════════════════════════════════════════════════════════════════


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

const tddPack = definePack("tddPack", (params: { run: string }) => ({
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
    pack(tddPack, { run: "just test-commit" }),
    override(house.node.versionIsSemver).disabled("nothing publishes 0.0.1"),
  ]);

  it("loads clean, with every bound entry present", () => {
    expect(entries.map((e) => e.id)).toEqual([
      "house.noTodo",
      "house.orientation",
      "house.node.versionIsSemver",
      "tddPack.commitRunsTests",
    ]);
  });

  it("closes a parameterised pack's sentences over the parameters it was bound with", () => {
    const entry = entries.find((e) => e.id === "tddPack.commitRunsTests");
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
    const bound = pack(tddPack as unknown as Pack<EntryGroup>);
    expect(shape(refusalsOf([bound]))).toEqual([["missing-parameter", "tddPack"]]);
  });

  it("an override of an entry no bound pack has, naming what was asked for", () => {
    expect(shape(refusalsOf([pack(house), override(house.node.versionIsSemver).on("x/**")]))).toEqual([]);
    const ghost = refusalsOf([pack(house), override(tddPack.commitRunsTests).on("x/**")]);
    expect(shape(ghost)).toEqual([["unknown-entry", "tddPack.commitRunsTests"]]);
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
    const [refusal] = refusalsOf([pack(house), override(tddPack.commitRunsTests).on("x/**")]);
    expect(refusal?.detail).toContain("tddPack.commitRunsTests");
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
