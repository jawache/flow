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

import { describe, it, expect } from "vitest";
import {
  defineCategory,
  defineConfig,
  loadConfig,
  pack,
  override,
  type ExecResult,
  type LoadResult,
  type Refusal,
  type SessionFacts,
  type World,
} from "../index.ts";
import { builder, parent, rails, verifier } from "../__fixtures__/engine-pack.ts";
import {
  CAUSES,
  DEFAULT_DRIFT_TOKENS,
  FLOW_DIR,
  FLOW_GITIGNORE,
  LOG_VERSION,
  MARKER_MAX_AGE_MS,
  ROW_KINDS,
  afterCompaction,
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
  sanitise,
  sessionFrom,
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
  type Row,
  type SessionMarker,
  type SessionState,
  type SpawnRecipe,
  type Tally,
  type Briefing,
  type BriefArgs,
  type Cause,
  type ClassifierFault,
} from "./domain.ts";

// ── the fixtures every case shares ───────────────────────────────────────────

/** The regime the fixture pack becomes. Loaded once — the load itself is proved next door. */
const regime: LoadResult = loadConfig(defineConfig([pack(rails)]));

/** A recorded world. Anything the case did not record answers empty, which every test asserts on. */
function world(
  recorded: {
    fs?: Record<string, string>;
    exec?: Record<string, Partial<ExecResult>>;
    diff?: string;
    staged?: readonly string[];
  } = {},
): World {
  const files = recorded.fs ?? {};
  return {
    exec: (cmd: string) => Promise.resolve({ stdout: "", stderr: "", code: 0, ...(recorded.exec?.[cmd] ?? {}) }),
    fs: {
      read: (path: string) => Promise.resolve(files[path] ?? ""),
      exists: (path: string) => Promise.resolve(Object.hasOwn(files, path)),
    },
    git: {
      diff: () => Promise.resolve(recorded.diff ?? ""),
      stagedFiles: () => Promise.resolve([...(recorded.staged ?? [])]),
    },
  };
}

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
      world: world({ fs: { "src/a.ts": "TODO", "src/b.ts": "ok", "src/b.test.ts": "TODO", "docs/c.md": "TODO" } }),
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
      world: world({ fs: {} }),
    });
    expect(tallyFor(outcome, "rails.stagedFiles")?.evaluated).toBe(0);
  });

  it("asks a commit entry that named no path ONCE, with the whole staged set", async () => {
    const outcome = await guard({
      load: regime,
      event: { moment: "commit", staged: ["package.json"], wearing: [] },
      world: world({ fs: {} }),
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
    expect(brief({ load: regime, event: touched("src/a.ts", 999_999), marks, off: true })).toEqual({
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

const noticeIds = (b: Briefing): (string | null)[] => b.notices.map((n) => n.entry);

describe("a breadcrumb across one session", () => {
  it("shows on first touch of its area, and records where it showed", () => {
    const first = brief({ load: regime, event: touched("src/a.ts", 40_000), marks: {} });
    expect(noticeIds(first)).toEqual(["rails.notes.area"]);
    expect(first.notices[0]?.cause).toBe("first-touch");
    expect(first.marks).toEqual({ "rails.notes.area": 40_000 });
  });

  it("stays quiet while the session has not drifted far enough", () => {
    const quiet = brief({ load: regime, event: touched("src/b.ts", 90_000), marks: { "rails.notes.area": 40_000 } });
    expect(quiet.notices).toEqual([]);
    expect(quiet.marks).toEqual({ "rails.notes.area": 40_000 });
  });

  it("shows again once the context has moved on past the threshold", () => {
    const drifted = brief({ load: regime, event: touched("src/b.ts", 250_000), marks: { "rails.notes.area": 40_000 } });
    expect(noticeIds(drifted)).toEqual(["rails.notes.area"]);
    expect(drifted.notices[0]?.cause).toBe("drift");
    expect(drifted.marks).toEqual({ "rails.notes.area": 250_000 });
  });

  it("takes the repo's own threshold when its config set one", () => {
    const tight = brief({
      load: regime,
      event: touched("src/b.ts", 60_000),
      marks: { "rails.notes.area": 40_000 },
      threshold: 10_000,
    });
    expect(noticeIds(tight)).toEqual(["rails.notes.area"]);
  });

  it("never shows a note for an area this touch is not in", () => {
    expect(brief({ load: regime, event: touched("docs/a.md", 10), marks: {} }).notices).toEqual([]);
  });

  it("shows a scoped note only to the actor it binds to, and carries a file's prose unresolved", () => {
    const toAnyone = brief({ load: regime, event: touched("src/a.ts", 10), marks: {} });
    expect(noticeIds(toAnyone)).toEqual(["rails.notes.area"]);
    const toBuilder = brief({ load: regime, event: touched("src/a.ts", 10, ["builder"]), marks: {} });
    expect(noticeIds(toBuilder)).toEqual(["rails.notes.area", "rails.notes.forBuilders"]);
    const scoped: Notice | undefined = toBuilder.notices[1];
    expect(scoped?.file).toBe("docs/builder.md");
    expect(scoped?.text).toBeUndefined();
  });

  it("greets at the session moment, and the greeting does not repeat at the first touch", () => {
    const opened = brief({ load: regime, event: { moment: "session", tokens: 0, wearing: [] }, marks: {} });
    expect(noticeIds(opened)).toEqual(["rails.notes.orientation"]);
    expect(opened.notices[0]?.cause).toBe("session");
    const again = brief({ load: regime, event: { moment: "session", tokens: 100, wearing: [] }, marks: opened.marks });
    expect(again.notices).toEqual([]);
  });

  it("degrades to a NOTICE when the config will not load — the one exception to fail-loud", () => {
    const args: BriefArgs = { load: broken, event: touched("src/a.ts", 10), marks: {} };
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
    const shown = brief({ load: regime, event: touched("src/a.ts", 130_000), marks: after });
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
  const fresh: SessionMarker = { session: "live", ts: "2026-09-04T11:59:00.000Z" };

  it("attributes a commit to the session that was just editing", () => {
    expect(sessionFrom(fresh, "commit", now)).toBe("live");
  });

  it("falls back rather than mis-pinning a commit to a session that ended hours ago", () => {
    expect(sessionFrom({ session: "old", ts: "2026-09-04T02:00:00.000Z" }, "commit", now)).toBe("commit");
    expect(sessionFrom({ session: "future", ts: "2027-01-01T00:00:00.000Z" }, "commit", now)).toBe("commit");
    expect(sessionFrom({ session: "live", ts: "not a date" }, "commit", now)).toBe("commit");
    expect(sessionFrom({ ts: fresh.ts }, "commit", now)).toBe("commit");
    expect(sessionFrom(null, "commit", now)).toBe("commit");
  });

  it("takes the age as an argument, because a clock inside a decision cannot be tested", () => {
    expect(sessionFrom(fresh, "commit", now, 30_000)).toBe("commit");
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
