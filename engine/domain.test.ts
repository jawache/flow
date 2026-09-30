// flow/engine/domain.test.ts — the engine, proved over fixture configs.
//
// Three matrices carry this file, and each is a promise the spec makes:
//
//   THE CATEGORY MATRIX  a scoped rule × {wearing it, not wearing it, the parent, a builder hidden
//                        inside a generic spawn} — J4.1 and J4.2, and the reason the classification
//                        order is read the way the probe said and not the way it reads nicer.
//   THE FAIL-LOUD MATRIX one case per way the guard can be wrong, each ending in a block that says
//                        so — J3.1 and J3.2. A green rail over a broken guard is the failure the
//                        whole package exists to delete, so every class of it is pinned here.
//   THE DRIFT ARITHMETIC a simulated session: first touch, quiet, drift, and a compaction — the
//                        old engine's behaviour, carried over and now testable without a
//                        transcript, because how far a session has drifted is an argument.
//
// Everything else is the ordinary matching underneath them.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  defineCategory,
  defineConfig,
  definePack,
  guardrail,
  loadConfig,
  oneWriter,
  pack,
  override,
  write,
  type LoadResult,
  type Refusal,
  type SessionFacts,
  type World,
} from "../index.ts";
// Straight from the language layer, not through the public door: `cannedWorld` is how flow drives a
// recorded world, not something a config or a pack imports, so it has no business on that surface.
import {
  cannedWorld,
  GUARDRAIL_MOMENTS,
  isPathMoment,
  type CaseWorld,
  type Unanswered,
} from "../language/domain.ts";
import { builder, parent, rails, verifier } from "../__fixtures__/engine-pack.ts";
import {
  CAUSES,
  DEFAULT_DRIFT_TOKENS,
  FLOW_DIR,
  FLOW_GITIGNORE,
  LEAD_BUCKETS,
  LOG_VERSION,
  MARKER_MAX_AGE_MS,
  MOMENT_ORDER,
  RECORDING_VERSION,
  ROW_KINDS,
  readDir,
  readMarkPath,
  readRecording,
  recordPath,
  recordingFile,
  recordingHeader,
  afterCompaction,
  covers,
  diffRows,
  insideRepo,
  isEdit,
  metrics,
  momentsView,
  recorder,
  replay,
  subjectOf,
  terrain,
  universe,
  watching,
  bindsTo,
  brief,
  categoriesIn,
  driftTokens,
  fires,
  flowDir,
  formatBlock,
  formatBlocks,
  guard,
  identify,
  inScope,
  logFile,
  markerPath,
  metaRow,
  nextSeq,
  offPath,
  readState,
  runRows,
  attribution,
  sanitise,
  spawnedAs,
  statePath,
  type Block,
  type BriefEvent,
  type Effect,
  type GuardArgs,
  type GuardEvent,
  type Identity,
  type Marks,
  type Notice,
  type Outcome,
  type RowKind,
  type Attribution,
  type Row,
  type SessionMarker,
  type SessionState,
  type SpawnRecipe,
  type Tally,
  type Briefing,
  type BriefArgs,
  type Bound,
  type BreadcrumbRecord,
  type Cause,
  type ClassifierFault,
  type GuardrailRecord,
  type MomentEntry,
  type RecordedStep,
  type Recording,
  type ReplayedStep,
  type TerrainNode,
} from "./domain.ts";

// ── the fixtures every case shares ───────────────────────────────────────────

/** The regime the fixture pack becomes. Loaded once — the load itself is proved next door. */
const regime: LoadResult = loadConfig(defineConfig([pack(rails)]));

/**
 * A recorded world — `cannedWorld`, the SAME builder `flow test` drives a case through.
 *
 * It was a second implementation for one commit, and the two had already drifted: this one answered
 * an unrecorded file read with `""` while the real one records the reach. That difference is the
 * difference between a test that proves something and a test that passes on a fiction, so there is
 * one builder, and the `afterEach` below makes every unrecorded reach in this suite a failure.
 */
function world(recorded: CaseWorld = {}, staged?: readonly string[]): World {
  return cannedWorld(recorded, staged, missed);
}

let missed: Unanswered[] = [];

beforeEach(() => {
  missed = [];
});

afterEach(() => {
  expect(missed, "a check reached for something this test never recorded").toEqual([]);
});

/** A write event, with whoever it happened to. */
function wrote(path: string, content: string, wearing: readonly string[] = []): GuardEvent {
  return { moment: "write", file: { path, content }, wearing };
}

const blocks = (outcome: Outcome): Block[] => outcome.effects.filter((e): e is Block => e.do === "block");
const blockedIds = (outcome: Outcome): (string | null)[] => blocks(outcome).map((b) => b.entry);
const tallyFor = (outcome: Outcome, id: string): Tally | undefined => outcome.tallies.find((t) => t.id === id);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHO A SESSION IS
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Host-written evidence, as the adapter will hand it over. */
function facts(over: Partial<SessionFacts> = {}): SessionFacts {
  return { head: "", subagent: true, ...over };
}

describe("spawnedAs — the settled classification order", () => {
  const recipe: SpawnRecipe = {
    types: ["builder"],
    generic: ["general-purpose", "claude"],
    brief: ["Follow `/work build`"],
  };

  it("keys on the host's own agent type first — the sidecar is evidence, not a claim", () => {
    expect(spawnedAs(recipe)(facts({ agentType: "builder", head: "anything at all" }))).toBe(true);
  });

  it("recovers a builder hidden inside a generic spawn, from its brief", () => {
    const hidden = facts({ agentType: "general-purpose", head: "Follow `/work build`. The repo is …" });
    expect(spawnedAs(recipe)(hidden)).toBe(true);
  });

  it("NEVER reads the brief of a specifically-typed spawn — a verifier's brief quotes a builder's", () => {
    // Four verifier briefs in the 335-transcript probe matched builder patterns for exactly this
    // reason: a verifier is briefed with what the builder claimed to have done. Text-first
    // classification calls every one of them a builder.
    const quoting = facts({ agentType: "verifier", head: "Follow `/work build` — the phase the builder claims" });
    expect(spawnedAs(recipe)(quoting)).toBe(false);
  });

  it("says no to a generic spawn whose brief says nothing", () => {
    expect(spawnedAs(recipe)(facts({ agentType: "claude", head: "summarise this file" }))).toBe(false);
  });

  it("says no to a spawn recipe when there is no agent type at all — that is the parent", () => {
    expect(spawnedAs(recipe)(facts({ subagent: false }))).toBe(false);
  });

  it("recognises the parent by ABSENCE, and never by what it is doing", () => {
    const isParent = spawnedAs({ parent: true });
    expect(isParent(facts({ subagent: false, head: "/work start … then /work complete" }))).toBe(true);
    expect(isParent(facts({ subagent: true, agentType: "builder" }))).toBe(false);
    expect(isParent(facts({ subagent: true }))).toBe(false);
  });

  it("takes an empty recipe as a recipe that recognises nobody", () => {
    expect(spawnedAs({})(facts({ agentType: "builder" }))).toBe(false);
  });
});

describe("categoriesIn — referenced is registered", () => {
  it("collects every category a bound entry names, and nothing else", () => {
    const named = categoriesIn(regime.ok ? regime.entries : []).map((c) => c.name);
    expect(named.sort()).toEqual(["builder", "verifier"]);
  });

  it("dedupes by NAME, so two copies of one package are still one category", () => {
    const twin = defineCategory("builder", () => true);
    const two = loadConfig(defineConfig([pack(rails), override(rails.everyone).for(twin)]));
    expect(categoriesIn(two.ok ? two.entries : []).map((c) => c.name).sort()).toEqual(["builder", "verifier"]);
  });
});

describe("identify — the verdict, and it sticks", () => {
  const categories = [builder, parent];

  it("reads host-written evidence when there is nothing stored, and says it is fresh", () => {
    const seen: Identity = identify(undefined, facts({ agentType: "builder" }), categories);
    expect(seen).toEqual({ wearing: ["builder"], faults: [], fresh: true });
  });

  it("has a session wear EVERY category that says yes, not the first", () => {
    const both = defineCategory("spawned", (f) => f.subagent);
    expect(identify(undefined, facts({ agentType: "builder" }), [builder, both]).wearing).toEqual([
      "builder",
      "spawned",
    ]);
  });

  it("takes the stored verdict as final — identity cannot change under a session mid-flight", () => {
    const stored = identify(["builder"], facts({ subagent: false }), categories);
    expect(stored).toEqual({ wearing: ["builder"], faults: [], fresh: false });
  });

  it("records a classifier that threw rather than reading it as a no", () => {
    const broken = defineCategory("broken", () => {
      throw new Error("no transcript");
    });
    const seen = identify(undefined, facts(), [broken]);
    expect(seen.wearing).toEqual([]);
    const fault: ClassifierFault | undefined = seen.faults[0];
    expect(fault).toEqual({ category: "broken", error: "no transcript" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MATCHING
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the three filters", () => {
  const entries = regime.ok ? regime.entries : [];
  const entry = (id: string) => entries.find((e) => e.id === id)!;

  it("fires only at the moments the entry named", () => {
    expect(fires(entry("rails.everyone").spec, "write")).toBe(true);
    expect(fires(entry("rails.everyone").spec, "commit")).toBe(false);
  });

  it("never fires a disabled entry, at any moment it named", () => {
    expect(fires(entry("rails.retired").spec, "write")).toBe(false);
  });

  it("binds to everyone when the entry named no category", () => {
    expect(bindsTo(entry("rails.everyone"), [])).toBe(true);
  });

  it("binds only to the categories it named, and ORs when it named several", () => {
    expect(bindsTo(entry("rails.buildersOnly"), ["builder"])).toBe(true);
    expect(bindsTo(entry("rails.buildersOnly"), ["parent"])).toBe(false);
    expect(bindsTo(entry("rails.eitherRung"), ["verifier"])).toBe(true);
    expect(bindsTo(entry("rails.eitherRung"), ["parent"])).toBe(false);
  });

  it("scopes by path, with ignore beating on", () => {
    const spec = entry("rails.stagedFiles").spec;
    expect(inScope(spec, "src/a.ts")).toBe(true);
    expect(inScope(spec, "src/a.test.ts")).toBe(false);
    expect(inScope(spec, "docs/a.md")).toBe(false);
    expect(inScope(entry("rails.everyone").spec, "anywhere/at/all.md")).toBe(true);
  });

  // The grammar refuses a scope that would narrow nothing, and it decides that from PATH_MOMENTS
  // (flow/language/domain.ts). This is the other spelling of the same fact — which moments actually
  // consult `on` when the engine runs them. Two spellings that drift is how a legitimate scope
  // starts being refused, or a dead one starts loading, so they are pinned against each other here.
  it("consults a path scope at exactly the moments PATH_MOMENTS names, and no others", async () => {
    const base = entry("rails.everyone");
    if (base.spec.kind !== "guardrail") throw new Error("rails.everyone is a guardrail — the fixture moved");
    const spec = base.spec;
    for (const moment of GUARDRAIL_MOMENTS) {
      // One entry, scoped to a glob nothing here matches, asked at each moment in turn. If the
      // moment carries a path the scope keeps it out (`evaluated: 0`); if it does not, the entry
      // runs and the scope was read by nobody.
      const load: LoadResult = {
        ok: true,
        entries: [{ ...base, spec: { ...spec, at: [moment], on: ["nothing/**"] } }],
      };
      const outcome = await guard({
        load,
        event: {
          moment,
          file: { path: "src/a.ts", content: "ok" },
          command: "ok",
          staged: ["src/a.ts"],
          turn: [],
          wearing: [],
        },
        world: world({ fs: { "src/a.ts": "ok" } }),
      });
      expect(outcome.tallies[0]?.evaluated === 0, `at ${moment}`).toBe(isPathMoment(moment));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATEGORY MATRIX — J4.2, the whole of it
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("a rule bound to a category", () => {
  const offending = (wearing: readonly string[]) => guard({ load: regime, event: wrote("plan/a.yml", "TODO", wearing), world: world() });

  it("fires for a session wearing that category", async () => {
    expect(blockedIds(await offending(["builder"]))).toContain("rails.buildersOnly");
  });

  it("stays silent for a session wearing a different one", async () => {
    expect(blockedIds(await offending(["verifier"]))).not.toContain("rails.buildersOnly");
  });

  it("stays silent for the parent, which wears nothing the rule named", async () => {
    expect(blockedIds(await offending(["parent"]))).not.toContain("rails.buildersOnly");
  });

  it("fires for a builder the host filed under a generic bucket", async () => {
    // The evidence route, end to end: a `general-purpose` spawn whose brief recovers it, classified
    // once, and the scoped rule then meets it exactly as it meets a host-typed builder.
    const hidden = identify(undefined, facts({ agentType: "general-purpose", head: "Follow `/work build`" }), [
      builder,
      verifier,
      parent,
    ]);
    expect(hidden.wearing).toEqual(["builder"]);
    expect(blockedIds(await offending(hidden.wearing))).toContain("rails.buildersOnly");
  });

  it("records the silence as a tally, so a scoped rule never reads as a dead one", async () => {
    const outcome = await offending(["parent"]);
    expect(tallyFor(outcome, "rails.buildersOnly")).toEqual({
      id: "rails.buildersOnly",
      evaluated: 0,
      hits: 0,
      silenced: 1,
    });
  });

  it("leaves an unscoped rule reaching every session", async () => {
    for (const wearing of [[], ["builder"], ["parent"]])
      expect(blockedIds(await offending(wearing))).toContain("rails.everyone");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MOMENTS, AND WHAT EACH HANDS A CHECK
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("what an entry is run against", () => {
  it("hands a write rail the would-be file, and scopes it by path", async () => {
    const inside = await guard({ load: regime, event: wrote("plan/x.yml", "TODO", ["builder"]), world: world() });
    expect(blockedIds(inside)).toContain("rails.buildersOnly");
    const outside = await guard({ load: regime, event: wrote("docs/x.md", "TODO", ["builder"]), world: world() });
    expect(blockedIds(outside)).not.toContain("rails.buildersOnly");
    expect(tallyFor(outside, "rails.buildersOnly")).toEqual({
      id: "rails.buildersOnly",
      evaluated: 0,
      hits: 0,
      silenced: 0,
    });
  });

  it("hands every check the categories of the session acting, as ctx.actor", async () => {
    const seen: (readonly string[])[] = [];
    const spy = definePack("spy", {
      actor: guardrail()
        .at(write)
        .check((ctx) => {
          seen.push(ctx.actor);
          return ctx.ok();
        })
        .message("x")
        .test({ pass: [{ path: "a", content: "" }] }),
      builderWrites: guardrail()
        .at(write)
        .check(oneWriter({ writers: ["builder"] }))
        .message("Only the builder writes.")
        .test({ block: [{ path: "a", content: "", actor: ["checker"] }] }),
    });
    const load = loadConfig(defineConfig([pack(spy)]));
    expect(blockedIds(await guard({ load, event: wrote("a.ts", "x", ["builder"]), world: world() }))).toEqual([]);
    const refused = await guard({ load, event: wrote("a.ts", "x", ["checker"]), world: world() });
    expect(blockedIds(refused)).toEqual(["spy.builderWrites"]);
    expect(blocks(refused)[0]?.detail).toContain("an actor wearing checker");
    expect(seen).toEqual([["builder"], ["checker"]]);
  });

  it("hands a command rail the line about to run, and consults no path scope", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "command", command: "git push --force", wearing: [] },
      world: world(),
    });
    expect(blockedIds(outcome)).toEqual(["rails.noForce"]);
    expect(blocks(outcome)[0]?.subject).toBe("git push --force");
  });

  it("hands turn-end the turn's actions, in order", async () => {
    const quiet = await guard({ load: regime, event: { moment: "turn-end", turn: [], wearing: [] }, world: world() });
    expect(blockedIds(quiet)).toEqual(["rails.ranTests"]);
    const ran = await guard({
      load: regime,
      event: { moment: "turn-end", turn: [{ did: "run", command: "just test" }], wearing: [] },
      world: world(),
    });
    expect(blockedIds(ran)).toEqual([]);
  });

  it("fans a path-scoped commit entry out over the staged files in its scope", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "commit", staged: ["src/a.ts", "src/b.ts", "src/b.test.ts", "docs/c.md"], wearing: [] },
      world: world({
        fs: { "src/a.ts": "TODO", "src/b.ts": "ok", "src/b.test.ts": "TODO", "docs/c.md": "TODO" },
        exec: { "just test-commit": { code: 0 } },
      }),
    });
    // Two subjects in scope, one of them offending — the ignored test file and the out-of-scope doc
    // are never read, let alone judged.
    expect(tallyFor(outcome, "rails.stagedFiles")).toEqual({
      id: "rails.stagedFiles",
      evaluated: 2,
      hits: 1,
      silenced: 0,
    });
    expect(blocks(outcome).find((b) => b.entry === "rails.stagedFiles")?.subject).toBe("src/a.ts");
  });

  it("skips a staged path that is not there — a deletion has no would-be file to judge", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "commit", staged: ["src/gone.ts"], wearing: [] },
      world: world({ exec: { "just test-commit": { code: 0 } } }),
    });
    expect(tallyFor(outcome, "rails.stagedFiles")?.evaluated).toBe(0);
  });

  it("asks a commit entry that named no path ONCE, with the whole staged set", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "commit", staged: ["package.json"], wearing: [] },
      world: world({ exec: { "just test-commit": { code: 0 } } }),
    });
    expect(tallyFor(outcome, "rails.wholeCommit")).toEqual({
      id: "rails.wholeCommit",
      evaluated: 1,
      hits: 1,
      silenced: 0,
    });
    expect(blocks(outcome).find((b) => b.entry === "rails.wholeCommit")?.subject).toBeNull();
  });

  it("reaches the world only through the world it was handed", async () => {
    const green = await guard({
      load: regime,
      event: { moment: "commit", staged: ["a.ts"], wearing: [] },
      world: world({ exec: { "just test-commit": { code: 0 } } }),
    });
    expect(blockedIds(green)).not.toContain("rails.suitePasses");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FAIL-LOUD MATRIX — J3.1 and J3.2
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A config that really will not load, through the real loader — not a hand-built refusal. */
const broken: LoadResult = loadConfig(defineConfig([pack({} as never)]));

describe("a broken config blocks until it is fixed", () => {
  it("is genuinely a load failure, and says which class", () => {
    expect(broken.ok).toBe(false);
    const refusal: Refusal | undefined = broken.ok ? undefined : broken.refusals[0];
    expect(refusal?.code).toBe("not-a-pack");
  });

  it("refuses EVERY gated moment, with the load error", async () => {
    for (const event of [
      wrote("a.ts", "x"),
      { moment: "command", command: "ls", wearing: [] },
      { moment: "commit", staged: ["a.ts"], wearing: [] },
      { moment: "delete", file: { path: "a.ts", content: "" }, wearing: [] },
      { moment: "turn-end", turn: [], wearing: [] },
    ] as GuardEvent[]) {
      const outcome = await guard({ load: broken, event, world: world() });
      expect(outcome.effects).toHaveLength(1);
      expect(blocks(outcome)[0]?.entry).toBeNull();
      expect(blocks(outcome)[0]?.message).toContain("the config will not load");
      expect(outcome.tallies).toEqual([]);
    }
  });
});

describe("everything else that can be wrong is also a block", () => {
  it("turns a crashing check into a failing one, naming the entry and the error", async () => {
    const outcome = await guard({ load: regime, event: wrote("a.ts", "fine"), world: world() });
    const crash = blocks(outcome).find((b) => b.entry === "rails.explodes");
    expect(crash?.detail).toBe("the check threw: cannot read properties of undefined");
  });

  it("blocks on a bound command that does not exist, naming the entry and the command", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "commit", staged: ["a.ts"], wearing: [] },
      world: world({ exec: { "just test-commit": { code: 127, stderr: "just: command not found" } } }),
    });
    const missing = blocks(outcome).find((b) => b.entry === "rails.suitePasses");
    expect(missing?.detail).toContain("just test-commit");
    expect(missing?.detail).toContain("command not found");
  });

  it("blocks an entry that carries no check at all, rather than passing it", async () => {
    // Not reachable through the compiler — `definePack` refuses a checkless guardrail at the line
    // you type — so it is built by hand, which is exactly the config the load exists to catch and
    // the shape a generated or hand-edited file can still arrive in.
    const checkless: LoadResult = {
      ok: true,
      entries: [
        {
          id: "hand.written",
          pack: "hand",
          key: "written",
          spec: { kind: "guardrail", at: ["write"], message: "…" },
          source: {},
          categories: [],
          phases: ["edit"],
        },
      ],
    };
    const outcome = await guard({ load: checkless, event: wrote("a.ts", "x"), world: world() });
    expect(blocks(outcome)[0]?.message).toContain("carries no check");
  });

  it("refuses every rail when a classifier could not say who this is", async () => {
    const faults: ClassifierFault[] = [{ category: "builder", error: "no transcript" }];
    const outcome = await guard({ load: regime, event: wrote("a.ts", "fine"), world: world(), faults });
    expect(outcome.effects).toHaveLength(1);
    expect(blocks(outcome)[0]?.message).toContain("could not classify this session");
    expect(blocks(outcome)[0]?.message).toContain("no transcript");
  });

  it("never runs a disabled entry, however loudly it would have failed", async () => {
    const outcome = await guard({ load: regime, event: wrote("a.ts", "TODO"), world: world() });
    expect(outcome.tallies.map((t) => t.id)).not.toContain("rails.retired");
  });
});

describe("the off switch", () => {
  it("short-circuits the gated rails entirely — no effects, no tallies", async () => {
    const args: GuardArgs = { load: regime, event: wrote("a.ts", "TODO"), world: world(), off: true };
    expect(await guard(args)).toEqual({ effects: [], tallies: [] });
  });

  it("short-circuits a broken config too, so an A/B run needs no settings surgery", async () => {
    expect(await guard({ load: broken, event: wrote("a.ts", "x"), world: world(), off: true })).toEqual({
      effects: [],
      tallies: [],
    });
  });

  it("short-circuits the breadcrumb rails, and leaves the marks alone", () => {
    const marks: Marks = { "rails.notes.area": 10 };
    expect(briefing({ event: touched("src/a.ts", 999_999), marks, off: true })).toEqual({
      notices: [],
      marks,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BRIEFING — the drift arithmetic, across a simulated session
// ════════════════════════════════════════════════════════════════════════════════════════════════

function touched(path: string, tokens: number, wearing: readonly string[] = []): BriefEvent {
  return { moment: "touch", path, tokens, wearing };
}

/** Brief over the fixture regime. `settings` is required by the type, which is fix 1's whole point. */
const briefing = (over: Omit<BriefArgs, "load" | "settings"> & Partial<BriefArgs>): Briefing =>
  brief({ load: regime, settings: {}, ...over });

const noticeIds = (b: Briefing): (string | null)[] => b.notices.map((n) => n.entry);

describe("a breadcrumb across one session", () => {
  it("shows on first touch of its area, and records where it showed", () => {
    const first = briefing({ event: touched("src/a.ts", 40_000), marks: {} });
    expect(noticeIds(first)).toEqual(["rails.notes.area"]);
    expect(first.notices[0]?.cause).toBe("first-touch");
    expect(first.marks).toEqual({ "rails.notes.area": 40_000 });
  });

  it("stays quiet while the session has not drifted far enough", () => {
    const quiet = briefing({ event: touched("src/b.ts", 90_000), marks: { "rails.notes.area": 40_000 } });
    expect(quiet.notices).toEqual([]);
    expect(quiet.marks).toEqual({ "rails.notes.area": 40_000 });
  });

  it("shows again once the context has moved on past the threshold", () => {
    const drifted = briefing({ event: touched("src/b.ts", 250_000), marks: { "rails.notes.area": 40_000 } });
    expect(noticeIds(drifted)).toEqual(["rails.notes.area"]);
    expect(drifted.notices[0]?.cause).toBe("drift");
    expect(drifted.marks).toEqual({ "rails.notes.area": 250_000 });
  });

  it("takes the repo's own dial, straight off the config it was declared in", () => {
    // The dial's ONE route: defineConfig carries it, brief() reads it through driftTokens, and the
    // type makes the caller hand it over. A wired adapter cannot forget the call and quietly run
    // on the default while the repo's number sits in the config doing nothing.
    const settings = defineConfig([pack(rails)], { driftTokens: 10_000 }).settings;
    const tight = briefing({ event: touched("src/b.ts", 60_000), marks: { "rails.notes.area": 40_000 }, settings });
    expect(noticeIds(tight)).toEqual(["rails.notes.area"]);
  });

  // ── a note about a COMMAND ───────────────────────────────────────────────────
  //
  // The other subject a note can be narrowed by, and the reason the scope is not optional in
  // practice: an unscoped command note would show on every shell call in the session.
  it("shows a command note only for the commands its scope names", () => {
    const ran = (line: string, marks: Marks = {}): (string | null)[] =>
      noticeIds(briefing({ event: { moment: "command", command: line, tokens: 10, wearing: [] }, marks }));
    expect(ran("npm install lodash")).toEqual(["rails.notes.installing"]);
    expect(ran("npm i -D vitest")).toEqual(["rails.notes.installing"]);
    expect(ran("npm run build")).toEqual([]);
    expect(ran("git status")).toEqual([]);
  });

  it("marks a command note as shown, so it does not repeat on the next install", () => {
    const first = briefing({ event: { moment: "command", command: "npm install lodash", tokens: 10, wearing: [] }, marks: {} });
    expect(noticeIds(first)).toEqual(["rails.notes.installing"]);
    const again = briefing({
      event: { moment: "command", command: "npm install zod", tokens: 200, wearing: [] },
      marks: first.marks,
    });
    expect(again.notices).toEqual([]);
  });

  it("never shows a note for an area this touch is not in", () => {
    expect(briefing({ event: touched("docs/a.md", 10), marks: {} }).notices).toEqual([]);
  });

  it("shows a scoped note only to the actor it binds to, and carries a file's prose unresolved", () => {
    const toAnyone = briefing({ event: touched("src/a.ts", 10), marks: {} });
    expect(noticeIds(toAnyone)).toEqual(["rails.notes.area"]);
    const toBuilder = briefing({ event: touched("src/a.ts", 10, ["builder"]), marks: {} });
    expect(noticeIds(toBuilder)).toEqual(["rails.notes.area", "rails.notes.forBuilders"]);
    const scoped: Notice | undefined = toBuilder.notices[1];
    expect(scoped?.file).toBe("docs/builder.md");
    expect(scoped?.text).toBeUndefined();
  });

  it("greets at the session moment, and the greeting does not repeat at the first touch", () => {
    const opened = briefing({ event: { moment: "session", tokens: 0, wearing: [] }, marks: {} });
    expect(noticeIds(opened)).toEqual(["rails.notes.orientation"]);
    expect(opened.notices[0]?.cause).toBe("session");
    const again = briefing({ event: { moment: "session", tokens: 100, wearing: [] }, marks: opened.marks });
    expect(again.notices).toEqual([]);
  });

  it("degrades to a NOTICE when the config will not load — the one exception to fail-loud", () => {
    const args: BriefArgs = { load: broken, event: touched("src/a.ts", 10), marks: {}, settings: {} };
    const degraded = brief(args);
    expect(degraded.notices).toHaveLength(1);
    const only = degraded.notices[0];
    expect(only?.do).toBe("notice");
    expect(only?.cause).toBe("fault");
    expect(only?.text).toContain("the config will not load");
    expect(degraded.marks).toEqual({});
  });
});

describe("a compaction", () => {
  const entries = regime.ok ? regime.entries : [];

  it("clears the area marks so they re-brief, and keeps the session's", () => {
    const before: Marks = { "rails.notes.area": 120_000, "rails.notes.orientation": 0, "rails.notes.forBuilders": 90 };
    expect(afterCompaction(before, entries)).toEqual({ "rails.notes.orientation": 0 });
  });

  it("re-shows the area note at the next touch, as the first touch it now is", () => {
    const after = afterCompaction({ "rails.notes.area": 120_000 }, entries);
    const shown = briefing({ event: touched("src/a.ts", 130_000), marks: after });
    expect(shown.notices[0]?.cause).toBe("first-touch");
  });

  it("leaves a mark for an entry the regime no longer has — nothing to keep is nothing kept", () => {
    expect(afterCompaction({ "gone.note": 1 }, entries)).toEqual({});
  });
});

describe("the drift threshold", () => {
  it("is the old engine's number when a config says nothing", () => {
    expect(driftTokens({})).toBe(DEFAULT_DRIFT_TOKENS);
    expect(DEFAULT_DRIFT_TOKENS).toBe(200_000);
  });

  it("is the config's dial when it set one — the trailing settings argument F1 left room for", () => {
    const config = defineConfig([pack(rails)], { driftTokens: 50_000 });
    expect(driftTokens(config.settings)).toBe(50_000);
  });

  it("names its causes in one closed vocabulary", () => {
    const cause: Cause = "drift";
    expect([...CAUSES]).toEqual(["session", "first-touch", "drift", "fault"]);
    expect(CAUSES).toContain(cause);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT A PERSON READS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("formatting a refusal", () => {
  it("leads with the entry's own id — the address you can open the config at", () => {
    const block: Block = {
      do: "block",
      entry: "rails.buildersOnly",
      message: "The plan's shape is the parent's.",
      subject: "plan/a.yml",
      detail: "says TODO",
    };
    expect(formatBlock(block)).toBe(
      ["✗ rails.buildersOnly · plan/a.yml", "  The plan's shape is the parent's.", "    says TODO"].join("\n"),
    );
  });

  it("drops the subject when the event was not about any one thing", () => {
    expect(formatBlock({ do: "block", entry: "rails.wholeCommit", message: "m", subject: null, detail: "" })).toBe(
      "✗ rails.wholeCommit\n  m",
    );
  });

  it("indents every line of a multi-line detail, so a tool's output stays under its entry", () => {
    const block: Block = { do: "block", entry: "x.y", message: "m", subject: null, detail: "one\ntwo" };
    expect(formatBlock(block)).toBe("✗ x.y\n  m\n    one\n    two");
  });

  it("prints the guard's own fault as itself, with no rule to attribute it to", () => {
    expect(formatBlock({ do: "block", entry: null, message: "flow: broken", subject: null, detail: "" })).toBe(
      "flow: broken",
    );
  });

  it("gathers every block into one message, and ignores the notices beside them", () => {
    const effects: Effect[] = [
      { do: "block", entry: "a.b", message: "m", subject: null, detail: "" },
      { do: "notice", entry: "a.note", text: "hi", file: undefined, cause: "first-touch" },
      { do: "block", entry: "c.d", message: "n", subject: null, detail: "" },
    ];
    expect(formatBlocks(effects)).toBe("✗ a.b\n  m\n✗ c.d\n  n");
    expect(formatBlocks([])).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE HOME
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe(".flow — spelled once", () => {
  it("puts every path under the one constant", () => {
    expect(FLOW_DIR).toBe(".flow");
    expect(flowDir("/repo")).toBe("/repo/.flow");
    expect(logFile("/repo", "abc")).toBe("/repo/.flow/log/abc.jsonl");
    expect(statePath("/repo", "abc", "agent1")).toBe("/repo/.flow/state/abc-agent1.json");
    expect(offPath("/repo")).toBe("/repo/.flow/off");
  });

  it("ignores itself, and the ignore file too", () => {
    expect(FLOW_GITIGNORE.trim().endsWith("*")).toBe(true);
  });

  it("keeps the branch in the session marker's name, so two worktrees cannot collide", () => {
    expect(markerPath("/repo", "workflow/flow")).toBe("/repo/.flow/.session-workflow-flow");
    expect(markerPath("/repo", null)).toBe("/repo/.flow/.session");
  });

  it("holds a session id to a filename's charset, with a fallback for no id at all", () => {
    expect(sanitise("a/b c:d")).toBe("a-b-c-d");
    expect(sanitise("")).toBe("nosession");
  });
});

describe("a session × agent's own state", () => {
  it("carries the sticky verdict and the marks in one file, because they are one session's facts", () => {
    const state: SessionState = readState('{"categories":["builder"],"marks":{"a.b":42}}');
    expect(state).toEqual({ categories: ["builder"], marks: { "a.b": 42 } });
  });

  it("reads nothing-known from an absent, empty or corrupt file — losing it is the harmless way", () => {
    for (const text of [null, undefined, "", "   ", "{oh dear", "[]", "null", "7"])
      expect(readState(text)).toEqual({ marks: {} });
  });

  it("drops what is not the shape it claims, rather than trusting a hand-edited file", () => {
    expect(readState('{"categories":["ok",7],"marks":{"a":"soon","b":3}}')).toEqual({ marks: { b: 3 } });
    expect(readState('{"marks":null}')).toEqual({ marks: {} });
  });

  it("tells an unclassified session from one that wears nothing", () => {
    expect(readState('{"marks":{}}').categories).toBeUndefined();
    expect(readState('{"categories":[],"marks":{}}').categories).toEqual([]);
  });
});

describe("the commit gate's session marker", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const fresh: SessionMarker = { session: "live", agent: "agent-7", ts: "2026-09-04T11:59:00.000Z" };
  const none: Attribution = { session: "commit", agent: null };

  it("attributes a commit to the session AND the agent that was just editing", () => {
    // The agent is what makes an actor-scoped commit rule possible: identity is stored per
    // session × agent, so the session id alone cannot find who was working.
    expect(attribution(fresh, "commit", now)).toStrictEqual({ session: "live", agent: "agent-7" });
  });

  it("falls back rather than mis-pinning a commit to a session that ended hours ago", () => {
    expect(attribution({ session: "old", ts: "2026-09-04T02:00:00.000Z" }, "commit", now)).toStrictEqual(none);
    expect(attribution({ session: "future", ts: "2027-01-01T00:00:00.000Z" }, "commit", now)).toStrictEqual(none);
    expect(attribution({ session: "live", ts: "not a date" }, "commit", now)).toStrictEqual(none);
    expect(attribution({ ts: fresh.ts }, "commit", now)).toStrictEqual(none);
    expect(attribution(null, "commit", now)).toStrictEqual(none);
  });

  it("reads a marker written before the agent field as an unknown actor, not a wrong one", () => {
    expect(attribution({ session: "live", ts: fresh.ts }, "commit", now)).toStrictEqual({
      session: "live",
      agent: null,
    });
    expect(attribution({ session: "live", agent: 7, ts: fresh.ts }, "commit", now).agent).toBeNull();
  });

  it("takes the age as an argument, because a clock inside a decision cannot be tested", () => {
    expect(attribution(fresh, "commit", now, 30_000)).toStrictEqual(none);
    expect(MARKER_MAX_AGE_MS).toBe(4 * 60 * 60 * 1000);
  });
});

describe("the log's layout", () => {
  it("stamps the first row with who the stream is and which build wrote it", () => {
    const row: Row = metaRow("a/b", "main", "/repo", "2026-09-04T12:00:00.000Z");
    expect(row).toEqual({
      kind: "meta",
      v: LOG_VERSION,
      session: "a-b",
      started: "2026-09-04T12:00:00.000Z",
      branch: "main",
      worktree: "/repo",
    });
  });

  it("names its row kinds in one closed vocabulary", () => {
    const kind: RowKind = "run";
    expect([...ROW_KINDS]).toEqual(["meta", "tool", "breadcrumb", "guardrail", "compaction", "run"]);
    expect(ROW_KINDS).toContain(kind);
  });

  it("writes one run summary, and one row per rail that spoke — never two rows for one block", () => {
    const outcome: Outcome = {
      effects: [
        { do: "block", entry: "a.b", message: "m", subject: "x.ts", detail: "d" },
        { do: "notice", entry: "a.note", text: "hi", file: undefined, cause: "drift" },
      ],
      tallies: [{ id: "a.b", evaluated: 1, hits: 1, silenced: 0 }],
    };
    expect(runRows("write", outcome, 1)).toEqual([
      { kind: "run", moment: "write", subjects: 1, rules: outcome.tallies },
      {
        kind: "guardrail",
        moment: "write",
        id: "a.b",
        subject: "x.ts",
        out: "deny",
        message: "m",
        detail: "d",
      },
      { kind: "breadcrumb", moment: "write", id: "a.note", cause: "drift" },
    ]);
  });

  it("reads the next event index off the log's own tail", () => {
    expect(nextSeq('{"seq":4}\n{"seq":5}\n')).toBe(6);
    expect(nextSeq("")).toBe(1);
    expect(nextSeq('{"seq":2}\n{"kind":"run"\n')).toBe(3);
    expect(nextSeq('{"kind":"meta"}\n')).toBe(1);
    expect(nextSeq('{"seq":-1}\n')).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE, THE RECORD AND REPLAY
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Three things are being proved down here and they build on each other:
//
//   THE UNIVERSE  what a log row's id MEANS today — the scope every later question is asked
//                 against, read off the same load the guard runs on.
//   THE RECORD    the rows read back as the settled numbers: blocks, lead, gaps, dead. The dead
//                 reading is the delicate one — a wrong DEAD retires a rule that was working.
//   REPLAY        J5.2. A recording is events plus recorded answers, and running it back through
//                 the SAME `guard`/`brief` lands the same effects with no repo and no harness.

const bound = universe(regime.ok ? regime.entries : []);
const boundOf = (id: string): Bound => bound.find((e) => e.id === id) as Bound;

/** A log row, stamped — the shape `appendRows` writes, without the file. */
function row(kind: RowKind, fields: Record<string, unknown> = {}, ts = "2026-01-01T00:00:00.000Z"): Row {
  return { kind, ts, ...fields };
}

const toolRowFor = (path: string, edit = false): Row => row("tool", { tool: edit ? "Edit" : "Read", path, edit });

describe("the universe — what an id means today", () => {
  it("carries each entry's scope, actors, pack and the sentence it speaks", () => {
    const scoped = boundOf("rails.buildersOnly");
    expect(scoped).toMatchObject({
      kind: "guardrail",
      pack: "rails",
      at: ["write"],
      on: ["plan/**"],
      for: ["builder"],
      disabled: null,
    });
    expect(scoped.says).toContain("the plan's shape is the parent's");
    expect(boundOf("rails.notes.orientation").says).toBe("This repo is guarded by flow.");
    // A `file:` breadcrumb says its file — the prose is the shell's to resolve, and a universe
    // that showed an empty sentence would look like a note with nothing to say.
    expect(boundOf("rails.notes.forBuilders").says).toBe("docs/builder.md");
  });

  it("keeps a DISABLED entry, carrying its reason — invisible is worse than off", () => {
    expect(boundOf("rails.retired").disabled).toBe("superseded by everyone");
  });
});

describe("covers — coverage is only ever claimed by an entry that names paths", () => {
  it("an unscoped entry reaches nowhere, though it matches everywhere", () => {
    const unscoped = boundOf("rails.everyone");
    expect(inScope(unscoped, "anything.ts")).toBe(true);
    expect(covers(unscoped, "anything.ts")).toBe(false);
  });

  it("one set of entries can claim coverage — live, and naming paths", () => {
    // Three surfaces ask this (the gap list, the tree, and the transcript-side reading) and they
    // must agree: a set that differs by a disabled entry is a folder that reads as guarded on one
    // page and abandoned on the next.
    const ids = watching(bound).map((e) => e.id);
    expect(ids).toContain("rails.stagedFiles");
    expect(ids, "unscoped — it matches everywhere and reaches nowhere").not.toContain("rails.everyone");
    expect(ids, "turned off — it fires at nothing, so it watches nothing").not.toContain("rails.retired");
  });

  it("a scoped entry reaches its globs and stops at its ignores", () => {
    const staged = boundOf("rails.stagedFiles");
    expect(covers(staged, "src/a.ts")).toBe(true);
    expect(covers(staged, "src/a.test.ts")).toBe(false);
    expect(covers(staged, "docs/a.ts")).toBe(false);
  });
});

describe("reading a row", () => {
  it("subjectOf prefers the path, falls back to the command, else nothing", () => {
    expect(subjectOf(row("guardrail", { subject: "a.ts", path: "b.ts" }))).toBe("a.ts");
    expect(subjectOf(row("tool", { path: "a.ts", command: "ls" }))).toBe("a.ts");
    expect(subjectOf(row("tool", { command: "ls" }))).toBe("ls");
    expect(subjectOf(row("run", {}))).toBe(null);
  });

  it("isEdit reads the ROW's own flag, never a set of tool names", () => {
    expect(isEdit(row("tool", { tool: "Edit", path: "a.ts", edit: true }))).toBe(true);
    // The same tool name with no flag is not an edit here: which names change a file is the
    // adapter's knowledge, and the engine may not hold a second copy of it.
    expect(isEdit(row("tool", { tool: "Edit", path: "a.ts" }))).toBe(false);
    expect(isEdit(row("tool", { tool: "Edit", edit: true }))).toBe(false);
    expect(isEdit(row("guardrail", { edit: true, path: "a.ts" }))).toBe(false);
  });
});

describe("the record — blocks, lead, gaps", () => {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");

  it("counts blocks, and reads the lead from the calls between a show and the edit it steered", () => {
    const rows: Row[] = [
      row("breadcrumb", { moment: "touch", id: "rails.notes.area", cause: "first-touch" }),
      toolRowFor("src/a.ts"),
      toolRowFor("src/a.ts", true),
      row("guardrail", { moment: "write", id: "rails.everyone", out: "deny", subject: "src/a.ts" }),
    ];
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.headline.blocks).toBe(1);
    const area = read.breadcrumbs.find((b) => b.id === "rails.notes.area");
    expect(area?.shown).toBe(1);
    expect(area?.byCause["first-touch"]).toBe(1);
    // The show rode on tool call 0; the first in-scope edit is call 2. A lead of 2.
    expect(area?.lead.median).toBe(2);
    expect(area?.lead.buckets["1-5"]).toBe(1);
    expect(read.span.tools).toBe(2);
  });

  it("a show with no in-scope edit after it is counted, never scored as a lead of zero", () => {
    const rows: Row[] = [row("breadcrumb", { moment: "touch", id: "rails.notes.area", cause: "drift" }), toolRowFor("docs/a.md", true)];
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    const area = read.breadcrumbs.find((b) => b.id === "rails.notes.area");
    expect(area?.lead).toEqual({ median: null, buckets: { "0": 0, "1-5": 0, "6-19": 0, "20+": 0 }, noEdit: 1 });
    expect(area?.byCause["drift"]).toBe(1);
    expect(LEAD_BUCKETS).toEqual(["0", "1-5", "6-19", "20+"]);
  });

  it("an edit no entry's globs reach is a GAP, ranked by its folder's edit count", () => {
    const rows: Row[] = [toolRowFor("docs/a.md", true), toolRowFor("docs/b.md", true), toolRowFor("src/a.ts", true)];
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.gaps).toEqual([{ area: "docs", edits: 2 }]);
  });

  it("the same rule blocking the same subject twice in one chat is a REPEAT — unless a compaction sat between", () => {
    const deny = row("guardrail", { moment: "write", id: "rails.everyone", out: "deny", subject: "a.ts" });
    const once = metrics({ sessions: [{ session: "s1", rows: [deny, deny] }], entries: bound, nowMs });
    expect(once.guardrails.find((g) => g.id === "rails.everyone")?.repeats).toBe(1);

    const across = metrics({
      sessions: [{ session: "s1", rows: [deny, row("compaction"), deny] }],
      entries: bound,
      nowMs,
    });
    expect(across.guardrails.find((g) => g.id === "rails.everyone")?.repeats).toBe(0);
  });

  it("a run tally becomes the rail's runs · evaluated · silenced", () => {
    const rows: Row[] = [
      row("run", {
        moment: "write",
        subjects: 1,
        rules: [
          { id: "rails.everyone", evaluated: 1, hits: 0, silenced: 0 },
          { id: "rails.buildersOnly", evaluated: 0, hits: 0, silenced: 1 },
        ],
      }),
    ];
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.guardrails.find((g) => g.id === "rails.everyone")).toMatchObject({ runs: 1, evaluated: 1, silenced: 0 });
    expect(read.guardrails.find((g) => g.id === "rails.buildersOnly")).toMatchObject({ runs: 1, evaluated: 0, silenced: 1 });
  });

  it("a DISABLED entry earns no record at all — it fires at nothing, so it can neither work nor be dead", () => {
    const read = metrics({ sessions: [], entries: bound, nowMs });
    expect(read.guardrails.map((g) => g.id)).not.toContain("rails.retired");
  });
});

describe("the record — the DEAD reading, which retires a rule if it is wrong", () => {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  /** Enough opportunity that silence is a verdict. One session, thirty-one days of it. */
  const ampleRows = (extra: readonly Row[]): Row[] => [
    row("run", { moment: "write", subjects: 1, rules: [] }, "2026-01-01T00:00:00.000Z"),
    ...extra,
    row("run", { moment: "write", subjects: 1, rules: [] }, "2026-02-05T00:00:00.000Z"),
  ];

  it("a scoped guardrail that stood on the rail and never once ran is DEAD", () => {
    const rows = ampleRows([
      row("run", { moment: "commit", subjects: 3, rules: [{ id: "rails.stagedFiles", evaluated: 0, hits: 0, silenced: 0 }] }),
    ]);
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.span.ample).toBe(true);
    expect(read.headline.dead).toContain("rails.stagedFiles");
  });

  it("an UNSCOPED guardrail is never dead — its scope is not a claim about paths", () => {
    const rows = ampleRows([
      row("run", { moment: "commit", subjects: 1, rules: [{ id: "rails.wholeCommit", evaluated: 0, hits: 0, silenced: 0 }] }),
    ]);
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.headline.dead).not.toContain("rails.wholeCommit");
  });

  it("a guardrail with NOTHING to its name is not judged — bound-after-the-history looks the same", () => {
    const read = metrics({ sessions: [{ session: "s1", rows: ampleRows([]) }], entries: bound, nowMs });
    expect(read.headline.dead).not.toContain("rails.stagedFiles");
    // …but it is named as something nobody has evidence about, which is a different sentence.
    expect(read.headline.retire).toContain("rails.stagedFiles");
  });

  it("a breadcrumb is judged only once its PACK has spoken — the bound-this-morning exemption", () => {
    const silent = metrics({ sessions: [{ session: "s1", rows: ampleRows([]) }], entries: bound, nowMs });
    expect(silent.headline.dead).not.toContain("rails.notes.area");

    const spoke = metrics({
      sessions: [
        {
          session: "s1",
          rows: ampleRows([row("breadcrumb", { moment: "session", id: "rails.notes.orientation", cause: "session" })]),
        },
      ],
      entries: bound,
      nowMs,
    });
    expect(spoke.headline.dead).toContain("rails.notes.area");
    // The session note itself is never dead: it shows by construction, so silence there would be
    // an engine fault rather than a fiction in the config.
    expect(spoke.headline.dead).not.toContain("rails.notes.orientation");
  });

  it("a thin history says UNPROVEN rather than retire, and neither claims anything dead", () => {
    const read = metrics({ sessions: [{ session: "s1", rows: [toolRowFor("src/a.ts")] }], entries: bound, nowMs });
    expect(read.span.ample).toBe(false);
    expect(read.headline.dead).toEqual([]);
    expect(read.headline.retire).toEqual([]);
    expect(read.headline.unproven).toContain("rails.stagedFiles");
  });

  it("an entry that used to catch things and stopped goes QUIET, with the days since", () => {
    const rows = ampleRows([
      row("run", { moment: "write", subjects: 1, rules: [{ id: "rails.everyone", evaluated: 1, hits: 1, silenced: 0 }] }, "2026-01-02T00:00:00.000Z"),
      row("guardrail", { moment: "write", id: "rails.everyone", out: "deny", subject: "a.ts" }, "2026-01-02T00:00:00.000Z"),
    ]);
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.headline.quiet).toEqual([{ id: "rails.everyone", lastHit: "2026-01-02T00:00:00.000Z", daysSince: 58 }]);
  });

  it("the `commit` stream is not a chat, so it never counts toward an ample session span", () => {
    const rows = [row("run", { moment: "commit", subjects: 1, rules: [] })];
    const read = metrics({ sessions: [{ session: "commit", rows }], entries: bound, nowMs, minSessions: 1, minDays: 9999 });
    expect(read.span.sessions).toBe(0);
    expect(read.span.ample).toBe(false);
  });

  it("an empty history has an honest span rather than an invented one", () => {
    const read = metrics({ sessions: [], entries: [], nowMs });
    expect(read.span).toEqual({ sessions: 0, days: 0, first: null, last: null, ample: false, tools: 0 });
    expect(read.headline.lead.median).toBe(null);
  });

  it("ignores rows it cannot read rather than counting them as something", () => {
    const rows: Row[] = [
      row("breadcrumb", { moment: "touch", cause: "first-touch" }), // no id
      row("guardrail", { moment: "write", out: "deny" }), // no id
      row("breadcrumb", { moment: "touch", id: "rails.notes.area", cause: "not-a-cause" }),
      row("run", { moment: "write", rules: [{ evaluated: 3 }, null] }),
    ];
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs });
    expect(read.headline.blocks).toBe(0);
    const area = read.breadcrumbs.find((b) => b.id === "rails.notes.area");
    expect(area?.shown).toBe(1);
    expect(Object.values(area?.byCause ?? {}).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("an even number of leads averages the two middles — 1.5 is a real answer", () => {
    const shown = (): Row[] => [row("breadcrumb", { moment: "touch", id: "rails.notes.area", cause: "first-touch" })];
    const read = metrics({
      sessions: [
        { session: "a", rows: [...shown(), toolRowFor("src/a.ts", true)] },
        { session: "b", rows: [...shown(), toolRowFor("x.md"), toolRowFor("src/a.ts", true)] },
      ],
      entries: bound,
      nowMs,
    });
    expect(read.breadcrumbs.find((b) => b.id === "rails.notes.area")?.lead.median).toBe(1.5);
  });
});

describe("the terrain — the real tree, with coverage laid over it", () => {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");

  it("rolls touches, edits and gaps up every ancestor, and lists who reaches where", () => {
    const rows: Row[] = [toolRowFor("src/a.ts", true), toolRowFor("src/a.ts"), toolRowFor("docs/x.md", true)];
    // The heat comes out of the metrics walk — ONE pass over the rows, and one decision about
    // whether anything was watching. The tree reads that answer rather than making it again.
    const recorded = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs }).heat;
    expect(recorded).toEqual({
      touches: { "src/a.ts": 2, "docs/x.md": 1 },
      edits: { "src/a.ts": 1, "docs/x.md": 1 },
      uncovered: { "docs/x.md": 1 },
    });

    const tree = terrain({ paths: ["src/a.ts", "README.md"], heat: recorded, entries: bound });
    const at = (path: string): TerrainNode => tree.find((n) => n.path === path) as TerrainNode;
    expect(at("src")).toMatchObject({ dir: true, touches: 2, edits: 1, uncovered: 0, depth: 0 });
    expect(at("src/a.ts").entries).toContain("rails.notes.area");
    // Nothing watches docs/, so its edit is a gap and the folder carries it.
    expect(at("docs")).toMatchObject({ uncovered: 1 });
    expect(at("README.md")).toMatchObject({ touches: 0, edits: 0, entries: [] });
  });

  it("draws folders before files, and a node always follows its parent", () => {
    const tree = terrain({
      paths: ["z.md", "src/b.ts", "src/a.ts", "docs/x.md"],
      heat: { touches: {}, edits: {}, uncovered: {} },
      entries: [],
    });
    expect(tree.map((n) => n.path)).toEqual(["docs", "docs/x.md", "src", "src/a.ts", "src/b.ts", "z.md"]);
  });

  it("an absolute path, or one climbing out of the repo, is not a node of this tree", () => {
    const rows: Row[] = [toolRowFor("/etc/passwd"), toolRowFor("../elsewhere/a.ts", true)];
    expect(insideRepo("src/a.ts")).toBe(true);
    expect([insideRepo("/etc/passwd"), insideRepo("../up.ts"), insideRepo("")]).toEqual([false, false, false]);
    const read = metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs: 0 });
    expect(read.heat).toEqual({ touches: {}, edits: {}, uncovered: {} });
    expect(read.gaps, "and an edit outside the repo is not a gap in it either").toEqual([]);
    expect(terrain({ paths: [], heat: read.heat, entries: bound })).toEqual([]);
  });
});

describe("the moments lens", () => {
  it("arranges the universe by moment, in the order a session meets them", () => {
    const view = momentsView(bound, null);
    expect(view.moments.map((m) => m.moment)).toEqual(MOMENT_ORDER.filter((m) => m !== "delete"));
    expect(view.totals).toEqual({ breadcrumbs: 4, guardrails: 10, disabled: 1 });
  });

  it("an entry stands in EVERY moment it fires at, carrying whatever the record says about it", () => {
    const read = metrics({
      sessions: [{ session: "s1", rows: [row("guardrail", { moment: "write", id: "rails.everyone", out: "deny", subject: "a.ts" })] }],
      entries: bound,
      nowMs: Date.parse("2026-03-01T00:00:00.000Z"),
    });
    const view = momentsView(bound, read);
    const writes = view.moments.find((m) => m.moment === "write");
    const everyone = writes?.entries.find((e) => e.id === "rails.everyone") as MomentEntry;
    expect((everyone.record as GuardrailRecord).hits).toBe(1);
    // An entry the record has never seen still carries a record, zeroed — the reading is "bound,
    // never fired", which is a fact. `null` is reserved for a view drawn with no record at all.
    const session = view.moments.find((m) => m.moment === "session");
    expect((session?.entries[0]?.record as BreadcrumbRecord).shown).toBe(0);
    expect(momentsView(bound, null).moments[0]?.entries[0]?.record).toBe(null);
  });
});

// ── replay ──────────────────────────────────────────────────────────────────

describe("replay — a recorded session, run again with no repo and no harness", () => {
  const recording = (steps: readonly RecordedStep[], session = "s1"): Recording => ({
    v: RECORDING_VERSION,
    session,
    steps,
  });

  it("lands the same block the live rail landed, from recorded answers alone", async () => {
    const result = await replay({
      load: regime,
      settings: {},
      recording: recording([
        { rail: "guard", moment: "write", file: { path: "a.ts", content: "TODO" }, wearing: [] },
        { rail: "guard", moment: "command", command: "git push --force", wearing: [] },
      ]),
    });
    const denied = result.rows.filter((r) => r.kind === "guardrail");
    expect(denied.map((r) => r["id"])).toEqual(["rails.everyone", "rails.explodes", "rails.noForce"]);
    expect(result.unanswered).toEqual([]);
  });

  it("drives a check that shells out through the recorded answer — no command is ever run", async () => {
    const passing = await replay({
      load: regime,
      settings: {},
      recording: recording([
        {
          rail: "guard",
          moment: "commit",
          staged: ["src/a.ts"],
          wearing: [],
          world: { exec: { "just test-commit": { code: 0 } }, fs: { "src/a.ts": "ok" } },
        },
      ]),
    });
    expect(passing.rows.filter((r) => r.kind === "guardrail")).toEqual([]);

    const failing = await replay({
      load: regime,
      settings: {},
      recording: recording([
        {
          rail: "guard",
          moment: "commit",
          staged: ["src/a.ts"],
          wearing: [],
          world: { exec: { "just test-commit": { code: 1, stderr: "red" } }, fs: { "src/a.ts": "ok" } },
        },
      ]),
    });
    expect(failing.rows.filter((r) => r.kind === "guardrail").map((r) => r["id"])).toEqual(["rails.suitePasses"]);
  });

  it("a reach the recording never answered is REPORTED — a replay carrying one is not evidence", async () => {
    const result = await replay({
      load: regime,
      settings: {},
      recording: recording([{ rail: "guard", moment: "commit", staged: ["src/a.ts"], wearing: [] }]),
    });
    expect(result.unanswered).toContainEqual({ kind: "exec", asked: "just test-commit" });
  });

  it("replays who the session WAS — a scoped rule fires for the actor that wore it", async () => {
    const step = (wearing: readonly string[]): RecordedStep => ({
      rail: "guard",
      moment: "write",
      file: { path: "plan/a.yml", content: "TODO" },
      wearing,
    });
    const asBuilder = await replay({ load: regime, settings: {}, recording: recording([step(["builder"])]) });
    expect(asBuilder.rows.filter((r) => r.kind === "guardrail").map((r) => r["id"])).toContain("rails.buildersOnly");

    const asNobody = await replay({ load: regime, settings: {}, recording: recording([step([])]) });
    expect(asNobody.rows.filter((r) => r.kind === "guardrail").map((r) => r["id"])).not.toContain("rails.buildersOnly");
  });

  it("threads the marks, so first touch · drift · compaction all replay — not just the blocks", async () => {
    const touch = (tokens: number): RecordedStep => ({ rail: "brief", moment: "touch", path: "src/a.ts", wearing: [], tokens });
    const result = await replay({
      load: regime,
      settings: { driftTokens: 100 },
      recording: recording([
        { rail: "brief", moment: "session", wearing: [], tokens: 0 },
        touch(10), // first touch of the area
        touch(20), // quiet — the context has barely moved
        touch(500), // drifted past the threshold
        { rail: "compaction" }, // the area mark is cleared; the session mark holds
        touch(600), // first touch again, because the agent no longer knows
      ]),
    });
    const shows = result.rows.filter((r) => r.kind === "breadcrumb").map((r) => `${r["id"] as string} ${r["cause"] as string}`);
    expect(shows).toEqual([
      "rails.notes.orientation session",
      "rails.notes.area first-touch",
      "rails.notes.area drift",
      "rails.notes.area first-touch",
    ]);
    // The session note is NOT re-shown after the compaction: the host re-delivers orientation at
    // exactly that moment, and clearing its mark would print the greeting twice.
    expect(result.marks["rails.notes.orientation"]).toBe(0);
    expect(result.steps.filter((s) => s.step.rail === "compaction")[0]?.rows).toEqual([{ kind: "compaction" }]);
  });

  it("a config that will not load refuses every replayed rail, exactly as it does live", async () => {
    const broken = loadConfig(defineConfig([pack(rails), override(rails.everyone).at()]));
    const result = await replay({
      load: broken,
      settings: {},
      recording: recording([
        { rail: "guard", moment: "write", file: { path: "a.ts", content: "ok" }, wearing: [] },
        { rail: "compaction" },
        { rail: "brief", moment: "session", wearing: [], tokens: 0 },
      ]),
    });
    expect(result.rows.filter((r) => r.kind === "guardrail")).toHaveLength(1);
    expect(result.rows.filter((r) => r.kind === "breadcrumb")).toHaveLength(1);
  });

  it("the replayed steps carry their own effects and rows, step by step", async () => {
    const result = await replay({
      load: regime,
      settings: {},
      recording: recording([{ rail: "guard", moment: "command", command: "git push --force", wearing: [] }]),
    });
    const first = result.steps[0] as ReplayedStep;
    expect(first.step.rail).toBe("guard");
    expect(first.effects.filter((e) => e.do === "block").map((e) => e.entry)).toEqual(["rails.noForce"]);
    expect(first.rows[0]).toMatchObject({ kind: "run", moment: "command" });
  });
});

describe("diffRows — the proof is an EMPTY diff", () => {
  const live: Row[] = [
    row("meta", { session: "s1" }),
    row("tool", { tool: "Bash", command: "git push --force" }),
    row("run", { moment: "command", subjects: 1, rules: [] }),
    row("guardrail", { moment: "command", id: "rails.noForce", out: "deny", subject: "git push --force" }),
  ];

  it("agrees when the same rules refused the same subjects, ignoring what only a live run has", async () => {
    const result = await replay({
      load: regime,
      settings: {},
      recording: { v: RECORDING_VERSION, session: "s1", steps: [{ rail: "guard", moment: "command", command: "git push --force", wearing: [] }] },
    });
    expect(diffRows(result.rows, live)).toEqual([]);
  });

  it("names both sides when they disagree, so a lost block reads differently from an invented one", () => {
    const invented = [...live, row("guardrail", { moment: "write", id: "rails.everyone", out: "deny", subject: "a.ts" })];
    expect(diffRows(invented, live)).toEqual([
      { side: "replay", at: 1, row: "guardrail write rails.everyone deny a.ts" },
    ]);
    expect(diffRows(live, invented)).toEqual([{ side: "live", at: 1, row: "guardrail write rails.everyone deny a.ts" }]);
    expect(diffRows([row("breadcrumb", { moment: "touch", id: "x", cause: "drift" })], [])).toEqual([
      { side: "replay", at: 0, row: "breadcrumb touch x drift" },
    ]);
  });
});

describe("the recording seam — the live world's answers, written down", () => {
  it("keeps every answer the checks reached for, in the shape a case is written in", async () => {
    const live: World = {
      exec: (cmd) => Promise.resolve({ stdout: `ran ${cmd}`, stderr: "", code: 0 }),
      fs: { read: (path) => Promise.resolve(`body of ${path}`), exists: (path) => Promise.resolve(path !== "gone.ts") },
      git: { diff: () => Promise.resolve("@@ -1"), stagedFiles: () => Promise.resolve(["a.ts"]) },
    };
    const taping = recorder(live);
    expect(await taping.world.exec("just test")).toEqual({ stdout: "ran just test", stderr: "", code: 0 });
    expect(await taping.world.fs.read("a.ts")).toBe("body of a.ts");
    expect(await taping.world.fs.exists("b.ts")).toBe(true);
    expect(await taping.world.fs.exists("gone.ts")).toBe(false);
    expect(await taping.world.git.diff("a.ts")).toBe("@@ -1");
    expect(await taping.world.git.stagedFiles()).toEqual(["a.ts"]);

    expect(taping.taken()).toEqual({
      exec: { "just test": { stdout: "ran just test", stderr: "", code: 0 } },
      // `b.ts` exists and nothing read it, so it is present with no content; `gone.ts` is absent,
      // which is what a canned world reads as "not there".
      fs: { "a.ts": "body of a.ts", "b.ts": "" },
      gitDiff: "@@ -1",
      staged: ["a.ts"],
    });
  });

  it("a world nothing reached for records nothing — an empty answer set, not an empty world", () => {
    const taping = recorder(world());
    expect(taping.taken()).toEqual({});
  });

  it("what it records replays: the same check, the same verdict, no repo", async () => {
    const live: World = {
      exec: () => Promise.resolve({ stdout: "", stderr: "red", code: 1 }),
      fs: { read: () => Promise.resolve("ok"), exists: () => Promise.resolve(true) },
      git: { diff: () => Promise.resolve(""), stagedFiles: () => Promise.resolve([]) },
    };
    const taping = recorder(live);
    const event: GuardEvent = { moment: "commit", staged: ["src/a.ts"], wearing: [] };
    const outcome = await guard({ load: regime, event, world: taping.world });

    const replayed = await replay({
      load: regime,
      settings: {},
      recording: {
        v: RECORDING_VERSION,
        session: "s1",
        steps: [{ rail: "guard", moment: "commit", staged: ["src/a.ts"], wearing: [], world: taping.taken() }],
      },
    });
    expect(replayed.unanswered).toEqual([]);
    expect(blockedIds(outcome)).toEqual(replayed.steps[0]?.effects.map((e) => (e as Block).entry));
    expect(blockedIds(outcome)).toEqual(["rails.suitePasses"]);
  });
});

describe("the recording file — appended live, read back whole", () => {
  it("names the switch and the stream, both under the one state home", () => {
    expect(recordPath("/repo")).toBe("/repo/.flow/record");
    expect(recordingFile("/repo", "a/b")).toBe("/repo/.flow/replay/a-b.jsonl");
    // The archival side's backlog marker is a `.flow` path like every other, spelled here rather
    // than by the layer that happens to write it — a reader looking in the wrong place reports
    // "nothing read yet" rather than an error, and silently re-offers a year of history.
    expect(readDir("/repo")).toBe("/repo/.flow/read");
    expect(readMarkPath("/repo", "a/b")).toBe("/repo/.flow/read/a-b");
  });

  it("reads a header, then every step, and drops a line it cannot read rather than failing", () => {
    const text = [
      JSON.stringify(recordingHeader("s1")),
      JSON.stringify({ rail: "guard", moment: "write", file: { path: "a.ts", content: "x" }, wearing: [] }),
      "{ this is not json",
      JSON.stringify({ rail: "compaction" }),
      JSON.stringify({ rail: "brief", moment: "touch", path: "a.ts", wearing: [], tokens: 5 }),
      JSON.stringify({ kind: "not-a-step" }),
      "[1,2]",
      "",
    ].join("\n");
    const read = readRecording(text);
    expect(read.v).toBe(RECORDING_VERSION);
    expect(read.session).toBe("s1");
    expect(read.steps.map((s) => s.rail)).toEqual(["guard", "compaction", "brief"]);
  });

  it("a headerless file is still a recording — a hand-written fixture has no header to write", () => {
    const read = readRecording(JSON.stringify({ rail: "compaction" }), "from-the-filename");
    expect(read).toEqual({ v: RECORDING_VERSION, session: "from-the-filename", steps: [{ rail: "compaction" }] });
    expect(readRecording("").steps).toEqual([]);
  });
});
