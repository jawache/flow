// flow/engine/domain.ts — THE ENGINE. Entries in, effects out, and nothing in between that knows
// what a harness is.
//
// Third stage of flow's pipeline:
//
//   language → checks → engine → adapter
//
// It reads the grammar's shapes (an entry, a moment, a category, the Ctx contract) and the load's
// answer; it never reads a hook payload, a transcript or a settings file. That direction is fenced
// in work.yaml rather than remembered, and it is the whole reason a recorded session can be
// replayed with no repo and no harness at all: everything below is a function of its arguments.
//
// SIX SECTIONS, one file, and it is the layer's whole pure home:
//
//   CATEGORIES      who a session is — the settled classification order, and the sticky verdict
//   MATCHING        which entries an event reaches, and what subjects they are run against
//   THE RUN         the guardrail rails: effects, tallies, and fail-loud when anything is wrong
//   BRIEFING        the breadcrumb rails: drift arithmetic, first touch, and compaction
//   RENDERING       what a person reads when a rail refuses
//   THE STATE HOME  `.flow/` — one constant, and the layouts every writer and reader agree on
//
// Nothing here reaches the world. The `World` it is handed is the door, and it is an ARGUMENT: no
// node:fs, no child_process, no process.env, no clock. eslint says so on the line and the commit
// gate says so again.

import { join } from "node:path";
import {
  isCategory,
  makeCtx,
  refusalText,
  verdict,
  type BreadcrumbMoment,
  type Category,
  type Check,
  type Ctx,
  type EntrySpec,
  type GuardrailMoment,
  type LoadResult,
  type LoadedEntry,
  type Moment,
  type SessionFacts,
  type Settings,
  type TurnAction,
  type Verdict,
  type World,
} from "../language/domain.ts";
import { matchAny } from "../glob.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CATEGORIES — who a session is
// ════════════════════════════════════════════════════════════════════════════════════════════════

// THE SETTLED ORDER, and it is not negotiable by taste. It was measured over 335 real subagent
// transcripts, and each rung exists because the rung below it lies:
//
//   1. THE HOST'S OWN AGENT TYPE. The sidecar a harness writes beside every subagent transcript —
//      present 335/335 — is host-written and unforgeable. When it names a specific type, that IS
//      the answer and nothing else is consulted.
//
//   2. THE BRIEF, FOR GENERIC SPAWNS ONLY. A harness has buckets that carry no type information
//      (Claude Code's `general-purpose` and `claude` hid 27 of 61 builders), and the brief text
//      recovers those. It is the SECOND rung and never the first, because a brief quotes: four
//      verifier briefs in the probe matched builder patterns, since a verifier is briefed with
//      what the builder claimed to have done. Text over a specific type is how a checker becomes
//      a builder.
//
//   3. THE PARENT, BY ABSENCE. There is no positive evidence of being the top-level session, only
//      the absence of a sidecar. It is STRUCTURAL and never derived from what the session is
//      doing: one parent transcript legitimately spans several rungs (`/work start` and
//      `/work complete` in one file), so anything read out of its prose would flap mid-session.
//
// flow ships NO category names. What a "builder" is belongs to the platform that spawns one; this
// is the shape of the evidence and the order it must be read in, and nothing more.

/**
 * How a category recognises its members from host-written evidence.
 *
 * The three rungs above, as fields — and their ORDER is enforced by `spawnedAs` rather than by the
 * author remembering it. That is the point of the recipe existing at all: a hand-written classifier
 * that greps the brief first is one line of plausible code, and it silently mislabels every
 * specifically-typed spawn whose brief happens to quote another rung's work.
 */
export interface SpawnRecipe {
  /**
   * Sidecar agent types that ARE this category, decisively. Brief text is never consulted for a
   * session whose type is named here — nor for one whose type is named anywhere but `generic`.
   */
  readonly types?: readonly string[];
  /**
   * The harness's generic spawn buckets — the ONLY types whose brief may be read. Which names
   * these are is harness knowledge, so it is supplied rather than assumed.
   */
  readonly generic?: readonly string[];
  /** Substrings that recover this category from a generic spawn's brief. */
  readonly brief?: readonly string[];
  /**
   * True for the top-level session only — no sidecar, no agent type. Structural, and exclusive: a
   * recipe is either about spawns or about the parent, never both.
   */
  readonly parent?: boolean;
}

/**
 * A classifier built from the settled order — what `defineCategory` is normally handed.
 *
 * A bespoke function remains the escape hatch and always will: a repo that classifies on something
 * nobody anticipated writes `defineCategory("x", facts => …)` and reads whatever it likes. What
 * this buys is that the ORDINARY case cannot be got wrong.
 */
export function spawnedAs(recipe: SpawnRecipe): (facts: SessionFacts) => boolean {
  return (facts: SessionFacts): boolean => {
    const type = facts.agentType;
    // Rung 3 first, because it is the one recipe that is about the ABSENCE of everything else.
    if (recipe.parent === true) return !facts.subagent && type === undefined;
    if (type === undefined) return false;
    // Rung 1 — decisive, and it ends the read.
    if ((recipe.types ?? []).includes(type)) return true;
    // Rung 2 — the brief, and ONLY for a bucket the caller named as carrying no type information.
    if (!(recipe.generic ?? []).includes(type)) return false;
    return (recipe.brief ?? []).some((needle) => facts.head.includes(needle));
  };
}

/** A classifier that threw. Fail-loud: the engine refuses rather than guessing who you are. */
export interface ClassifierFault {
  readonly category: string;
  readonly error: string;
}

/** Who a session is, and every classifier that could not say. */
export interface Identity {
  /** Every category whose classifier said yes. A session wears all of them, not the first. */
  readonly wearing: readonly string[];
  readonly faults: readonly ClassifierFault[];
  /** True when this verdict was read now, and the caller therefore owes it to the state file. */
  readonly fresh: boolean;
}

/**
 * The categories any bound entry names — REFERENCED IS REGISTERED, and this is that sentence.
 *
 * There is no list to register in and none to fall out of step with the code: a category reaches
 * the classifier because some entry scoped itself to it, so an unused category costs nothing and a
 * used one cannot be forgotten. Deduped by NAME rather than by identity, because two copies of one
 * package in a node_modules tree are two objects meaning one category.
 */
export function categoriesIn(entries: readonly LoadedEntry[]): Category[] {
  const out: Category[] = [];
  for (const entry of entries)
    for (const category of entry.spec.for ?? [])
      if (isCategory(category) && !out.some((c) => c.name === category.name)) out.push(category);
  return out;
}

/**
 * Who this session × agent is — the stored verdict if there is one, otherwise a fresh reading.
 *
 * STICKY, and that is a decision rather than a cache. A session's identity is settled by evidence
 * written when it was spawned, so re-deriving it every hook could only ever change the answer by
 * accident — a transcript since compacted, a brief scrolled away — and a rule that fired for the
 * first half of a session and not the second is worse than either outcome alone. The unit is
 * session × agent because that is what the evidence is about: each subagent has its own transcript
 * and its own sidecar.
 */
export function identify(
  stored: readonly string[] | undefined,
  facts: SessionFacts,
  categories: readonly Category[],
): Identity {
  if (stored) return { wearing: stored, faults: [], fresh: false };
  const wearing: string[] = [];
  const faults: ClassifierFault[] = [];
  for (const category of categories) {
    try {
      if (category.classify(facts)) wearing.push(category.name);
    } catch (error) {
      faults.push({ category: category.name, error: (error as Error).message });
    }
  }
  return { wearing, faults, fresh: true };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MATCHING — which entries an event reaches, and what it hands them
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Three filters, in this order, and each answers a different question:
//
//   the MOMENT    did this entry ask to fire here at all
//   the CATEGORY  is this session one of the actors it binds to (absent = every actor)
//   the SCOPE     `on` / `ignore`, which are about PATHS and are consulted exactly when the event
//                 names one
//
// The last one deserves its own sentence. `.on()` scopes an entry to files: a write rail carries
// one path, the commit gate carries the staged set, and a command rail carries none — a command
// guard's patterns ARE its scope, which is why the fixture packs write `.at(command)` with no
// `.on()` beside it. An `.on()` on a command-only entry is therefore consulted by nothing; that is
// the old engine's behaviour, kept deliberately, and making the dead scope VISIBLE is a job for
// `flow status` rather than for a silent difference in matching.

/** One event the guardrail rails carry. Facts only — who it happened to is `wearing`. */
export interface GuardEvent {
  readonly moment: GuardrailMoment;
  /** write/delete: the would-be file, in memory, before disk. */
  readonly file?: { readonly path: string; readonly content: string } | undefined;
  /** command: the line about to run. */
  readonly command?: string | undefined;
  /** commit: the staged paths. */
  readonly staged?: readonly string[] | undefined;
  /** turn-end: what the actor did this turn, in order. */
  readonly turn?: readonly TurnAction[] | undefined;
  /** Every category this session × agent wears. Empty means it wears none, not "all of them". */
  readonly wearing: readonly string[];
}

/** One event the breadcrumb rails carry. A note has no rail to block, so it has no world either. */
export interface BriefEvent {
  readonly moment: BreadcrumbMoment;
  /** touch: the path the tool call is about. A call carrying no path narrows nothing. */
  readonly path?: string | undefined;
  readonly wearing: readonly string[];
  /** How far this session has drifted, in context tokens. The adapter measures it. */
  readonly tokens: number;
}

/** Does this entry fire at this moment at all? A disabled entry is inert and never does. */
export function fires(spec: EntrySpec, moment: Moment): boolean {
  if (spec.disabled) return false;
  return ((spec.at ?? []) as readonly string[]).includes(moment);
}

/**
 * Does this session wear what the entry binds to? An entry with no `.for(…)` binds to everyone.
 *
 * Absence means EVERY category, exactly as an absent `on` means every path — scoping is opt-in.
 * `.for(a, b)` ORs, so a rule for two rungs fires for a session wearing either of them.
 */
export function bindsTo(entry: LoadedEntry, wearing: readonly string[]): boolean {
  if (entry.categories.length === 0) return true;
  return entry.categories.some((c) => wearing.includes(c));
}

/** Is this path inside the entry's `on` / `ignore` scope? No `on` at all is every path. */
export function inScope(spec: EntrySpec, path: string): boolean {
  if (spec.on && !matchAny(path, spec.on)) return false;
  if (spec.ignore && matchAny(path, spec.ignore)) return false;
  return true;
}

/** One thing an entry is run against: what the log row names, and the facts its ctx carries. */
interface Subject {
  /** A path, a command, or null when the event is not about any one thing. */
  readonly name: string | null;
  readonly facts: Partial<Ctx>;
}

/**
 * What one entry is run against for one event — nothing, once, or once per file.
 *
 * The commit gate is the only moment that fans out, and what decides it is the SENTENCE: an entry
 * that named `.on(…)` is about files, so it is asked about each staged file in its scope; an entry
 * that named none is about the commit, so it is asked once and handed the staged set. That is the
 * same split the old engine made with a per-script `kind`, now read off the entry rather than off
 * a registry — which is what lets a repo's own check take either shape with no declaration at all.
 *
 * A staged path that is not there (a deletion, staged) yields no subject: there is no would-be
 * file to hand a content check, and inventing an empty one would let it pass on a fiction.
 */
async function subjectsOf(entry: LoadedEntry, event: GuardEvent, world: World): Promise<Subject[]> {
  const { spec } = entry;
  if (event.moment === "commit") {
    const staged = event.staged ?? [];
    if (!spec.on) return [{ name: null, facts: { staged } }];
    const out: Subject[] = [];
    for (const path of staged) {
      if (!inScope(spec, path)) continue;
      if (!(await world.fs.exists(path))) continue;
      out.push({ name: path, facts: { file: { path, content: await world.fs.read(path) }, staged } });
    }
    return out;
  }
  if (event.moment === "write" || event.moment === "delete") {
    const file = event.file;
    if (!file || !inScope(spec, file.path)) return [];
    return [{ name: file.path, facts: { file } }];
  }
  if (event.moment === "command") {
    const command = event.command ?? "";
    return [{ name: command, facts: { command } }];
  }
  return [{ name: null, facts: { turn: event.turn ?? [] } }];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN — the guardrail rails
// ════════════════════════════════════════════════════════════════════════════════════════════════

// FAIL LOUD. Ruled by the human 2026-08-22, after this repo's own config was broken for a whole day
// and the fault notice fired on every hook without one person seeing it. Every way the guard can be
// wrong ends in a BLOCK carrying the reason:
//
//   the config will not load    every gated moment refuses, with every refusal
//   a classifier throws         who this session is is unknown, so every rail refuses
//   an entry has no check       it blocks; a rail that cannot ask is not a rail that passes
//   a check throws              that entry blocks, naming itself and the error
//   a bound command is missing  the check's own exec answer says so, and it blocks
//
// The one exception is a breadcrumb moment, which carries no rail to block and degrades to a notice
// (see BRIEFING). Everything else refuses, because refusal is the only channel that reaches both
// the agent that hit it and the person who has to fix it.

/** A rail refusing. `entry` is null when it is the guard itself that is broken, not a rule. */
export interface Block {
  readonly do: "block";
  readonly entry: string | null;
  /** The sentence the entry's author wrote, or the fault's own text when there is no entry. */
  readonly message: string;
  /** What it is about: a path, a command, or null. */
  readonly subject: string | null;
  /** What the check said was wrong. Empty when it gave no detail. */
  readonly detail: string;
}

/** Why a breadcrumb is showing. Closed, and every recorded row carries one of these words. */
export const CAUSES = ["session", "first-touch", "drift", "fault"] as const;
export type Cause = (typeof CAUSES)[number];

/** A note being shown. Never a rail — a breadcrumb informs and cannot refuse. */
export interface Notice {
  readonly do: "notice";
  readonly entry: string | null;
  /** The prose, when the entry carried it inline. */
  readonly text: string | undefined;
  /** The file the prose lives in, when it did not. The shell resolves it; a pure home cannot. */
  readonly file: string | undefined;
  readonly cause: Cause;
}

export type Effect = Block | Notice;

/**
 * What one entry did during one run — the tally the log carries and the coach reads.
 *
 * `matched` did not travel from the old engine. It counted subjects that fell inside an entry's
 * scope, and once `on` became mandatory for a file rule it equalled `evaluated` in every row ever
 * written: two names for one number, which is a question two readers can answer differently.
 * `silenced` replaces it with something genuinely new — an entry can now be in force and still not
 * run, because this session is not the actor it binds to, and a rule that looks dead in a parent's
 * log may be doing its job perfectly in every builder's.
 */
export interface Tally {
  readonly id: string;
  /** Subjects it was run against. */
  readonly evaluated: number;
  /** Subjects it blocked. */
  readonly hits: number;
  /** Times its `.for(…)` scope kept it out of this session entirely. */
  readonly silenced: number;
}

/** Everything one rail produced: what happens now, and what the log records. */
export interface Outcome {
  readonly effects: readonly Effect[];
  readonly tallies: readonly Tally[];
}

const NOTHING: Outcome = { effects: [], tallies: [] };

/** One block from the guard itself rather than from any rule. */
function fault(message: string): Block {
  return { do: "block", entry: null, message, subject: null, detail: "" };
}

export interface GuardArgs {
  /** The load's answer. A refusal here refuses the rail — that is J3.1. */
  readonly load: LoadResult;
  readonly event: GuardEvent;
  readonly world: World;
  /** Classifiers that could not answer. Any of them and the rail refuses: identity is a gate. */
  readonly faults?: readonly ClassifierFault[] | undefined;
  /** The kill switch. Set, and nothing runs at all — see `offPath`. */
  readonly off?: boolean | undefined;
}

/**
 * Run one gated moment. THE engine entry point for anything that can refuse.
 *
 * The order of the three short-circuits is the order of the questions: is the guard on, does its
 * config load, and do we know who this is. The last two refuse rather than proceeding, because a
 * guard that runs a subset of its rules while looking healthy is the single failure this whole
 * package exists to delete.
 */
export async function guard({ load, event, world, faults = [], off = false }: GuardArgs): Promise<Outcome> {
  if (off) return NOTHING;
  if (!load.ok) return { effects: [fault(refusalText(load.refusals))], tallies: [] };
  if (faults.length > 0)
    return {
      effects: faults.map((f) =>
        fault(
          `flow: the category \`${f.category}\` could not classify this session, so a rule scoped to it cannot be trusted either way — ${f.error}`,
        ),
      ),
      tallies: [],
    };

  const effects: Effect[] = [];
  const tallies: Tally[] = [];
  for (const entry of load.entries) {
    if (entry.spec.kind !== "guardrail" || !fires(entry.spec, event.moment)) continue;
    if (!bindsTo(entry, event.wearing)) {
      tallies.push({ id: entry.id, evaluated: 0, hits: 0, silenced: 1 });
      continue;
    }
    const check = entry.spec.check;
    if (!check) {
      effects.push(
        fault(
          `flow: \`${entry.id}\` fires at ${event.moment} and carries no check. A rail that cannot ask a question is not a rail that passes.`,
        ),
      );
      continue;
    }
    let evaluated = 0;
    let hits = 0;
    for (const subject of await subjectsOf(entry, event, world)) {
      evaluated += 1;
      const answer = await ask(check, makeCtx(event.moment, subject.facts, world));
      if (answer.ok) continue;
      hits += 1;
      effects.push({
        do: "block",
        entry: entry.id,
        message: entry.spec.message ?? "",
        subject: subject.name,
        detail: answer.detail ?? "",
      });
    }
    tallies.push({ id: entry.id, evaluated, hits, silenced: 0 });
  }
  return { effects, tallies };
}

/**
 * One check, asked. A THROW IS A FAIL — never a skip.
 *
 * The old engine swallowed a stumbling script and carried on, so the loudest possible signal that a
 * rule was broken produced the quietest possible outcome: a green rail. Here the crash becomes the
 * refusal, and the entry's own cases (J5.1) are where it should have died first.
 */
async function ask(check: Check, ctx: Ctx): Promise<Verdict> {
  try {
    return await check(ctx);
  } catch (error) {
    // `verdict.fail`, not a hand-shaped object: a verdict has one constructor and this is a
    // verdict. Two spellings of the same answer is how the two of them come to differ.
    return verdict.fail(`the check threw: ${(error as Error).message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BRIEFING — the breadcrumb rails, and the drift arithmetic behind them
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A breadcrumb is a note. It has no rail, so it cannot refuse, and it is the ONE narrow exception
// to fail-loud: a config that will not load degrades to a notice here rather than blocking, because
// refusing a session's opening greeting would wedge the session before anyone could read why.
//
// The arithmetic is the old engine's, with its transcript reading left behind — how far a session
// has drifted is a NUMBER the adapter measures, not a file this layer opens. What survives is the
// decision it feeds: a note shows on first touch, and again once the context has moved on by more
// than the threshold, and never otherwise.

/** Entry id → the context size, in tokens, at which it was last shown. */
export type Marks = Readonly<Record<string, number>>;

/** How far a session drifts before a note is worth showing again. The old engine's number, kept. */
export const DEFAULT_DRIFT_TOKENS = 200_000;

/** The threshold in force: the config's dial, or the default. */
export function driftTokens(settings: Settings): number {
  return settings.driftTokens ?? DEFAULT_DRIFT_TOKENS;
}

export interface BriefArgs {
  readonly load: LoadResult;
  readonly event: BriefEvent;
  readonly marks: Marks;
  /**
   * The config's own dials, and REQUIRED — `driftTokens` reaches the arithmetic through here and
   * nowhere else.
   *
   * It was an optional `threshold` number, and that is a dead dial waiting to happen: `brief()`
   * defaulted it independently, so a caller that never called `driftTokens(config.settings)` would
   * run on 200k while the repo's `driftTokens:` sat in the config doing nothing, green and silent.
   * That is the class of failure this whole package exists to delete, so the dial has one route and
   * the compiler makes the adapter take it. `defineConfig` always produces a settings object, so
   * passing `config.settings` costs the caller nothing.
   */
  readonly settings: Settings;
  readonly off?: boolean | undefined;
}

/** The notes to show now, and the marks to store once they have been shown. */
export interface Briefing {
  readonly notices: readonly Notice[];
  readonly marks: Marks;
}

/**
 * Which notes show at this moment, and what that leaves the marks looking like.
 *
 * EVERY matching breadcrumb shows — the general and the specific stack, so a file gets its area
 * note and the finer notes layered on top. The old engine scored matches by glob length and then
 * used only the sign of the score, a narrowing rule already abandoned in fact; it is not carried.
 *
 * A `session` breadcrumb shows once at the session moment and is MARKED there, which is why the
 * first touch afterwards does not repeat what the greeting has just said.
 */
export function brief({ load, event, marks, settings, off = false }: BriefArgs): Briefing {
  if (off) return { notices: [], marks };
  if (!load.ok)
    return {
      notices: [{ do: "notice", entry: null, text: refusalText(load.refusals), file: undefined, cause: "fault" }],
      marks,
    };

  const notices: Notice[] = [];
  const next: Record<string, number> = { ...marks };
  const limit = driftTokens(settings);
  for (const entry of load.entries) {
    if (entry.spec.kind !== "breadcrumb" || !fires(entry.spec, event.moment)) continue;
    if (!bindsTo(entry, event.wearing)) continue;
    // A path narrows only when the event carries one: `session` and `turn-end` are about the whole
    // session, so an entry scoped with `on` at those moments is simply not narrowed by it.
    if (event.path !== undefined && !inScope(entry.spec, event.path)) continue;
    const last = next[entry.id];
    const cause: Cause = event.moment === "session" ? "session" : last === undefined ? "first-touch" : "drift";
    if (last !== undefined && (cause !== "drift" || event.tokens - last < limit)) continue;
    notices.push({ do: "notice", entry: entry.id, text: entry.spec.text, file: entry.spec.file, cause });
    next[entry.id] = event.tokens;
  }
  return { notices, marks: next };
}

/**
 * The marks a compaction leaves behind: the session's, and nothing else.
 *
 * A compaction is the boundary where the agent stops knowing what it was told, so every AREA note
 * has to be earned again — clearing their marks re-briefs them at the next touch. The session notes
 * are kept because the host re-delivers orientation at the same moment, and clearing those too
 * would print the greeting twice in a row.
 *
 * Their cause on re-showing is `first-touch`, deliberately and not for want of a fifth word: after
 * a compaction it IS the agent's first touch of that area, and a separate cause would name the
 * mechanism that cleared the mark rather than what the reader is looking at.
 */
export function afterCompaction(marks: Marks, entries: readonly LoadedEntry[]): Marks {
  // `fires`, not a second at-includes-session read: "does this entry show at this moment" is one
  // question with one answer, and asking it here by hand meant a disabled session breadcrumb kept
  // its mark for free while `brief` would never have shown it.
  const keep = new Set(entries.filter((e) => fires(e.spec, "session")).map((e) => e.id));
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(marks)) if (keep.has(id)) out[id] = at;
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RENDERING — what a person reads when a rail refuses
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One block, as the hook prints it.
 *
 * The entry's id is the WHOLE address — there is no second naming scheme to print beside it, which
 * is the visible half of the old string routes dying. A reader who sees `core.noTodo` can open the
 * config, find that property, and be looking at the sentence that refused them.
 */
export function formatBlock(block: Block): string {
  const head = block.entry === null ? block.message : `✗ ${block.entry}${block.subject ? ` · ${block.subject}` : ""}`;
  const lines = [head];
  if (block.entry !== null && block.message) lines.push(`  ${block.message}`);
  if (block.detail) lines.push(...block.detail.split("\n").map((line) => `    ${line}`));
  return lines.join("\n");
}

/** Every block in one outcome, as one message. Empty when nothing refused. */
export function formatBlocks(effects: readonly Effect[]): string {
  return effects
    .filter((e): e is Block => e.do === "block")
    .map(formatBlock)
    .join("\n");
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE HOME — `.flow/`, spelled once
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A REAL DIRECTORY at the repo root, and it is flow's own. The old engine kept its state in
// `.work/guard/`, inside a journal symlink, which bought one thing (every worktree of a repo shared
// one ledger) at the price of standing alone: flow must work in a repo that has never heard of the
// work platform. So `.flow/` is honest and local, self-ignoring so it never shows up in `git
// status`, and sharing returns as configuration for the repos that want it.
//
// SPELLED ONCE. In the old engine the same path was written two ways, and the disagreement was
// invisible in exactly the direction that hurts: a reader looking in the wrong place reports "no
// events" rather than an error. Every path below is built from the one constant.

/** flow's state directory, relative to a repo root. The one spelling. */
export const FLOW_DIR = ".flow";

/** What makes the directory invisible to git — `*` covers the ignore file itself. */
export const FLOW_GITIGNORE = "# flow's own state — telemetry and session marks, never committed.\n*\n";

/** The log schema this build writes, stamped into every session file's first row. */
export const LOG_VERSION = 1;

/** Every kind a log row may be. Closed — a reader that meets another word has met corruption. */
export const ROW_KINDS = ["meta", "tool", "breadcrumb", "guardrail", "compaction", "run"] as const;
export type RowKind = (typeof ROW_KINDS)[number];

export function flowDir(root: string): string {
  return join(root, FLOW_DIR);
}

/** A session id becomes a filename, so it is held to a filename's charset. */
export function sanitise(session: string): string {
  return (session || "nosession").replace(/[^A-Za-z0-9_-]/g, "-");
}

/** One session's event stream. */
export function logFile(root: string, session: string): string {
  return join(flowDir(root), "log", `${sanitise(session)}.jsonl`);
}

/** One session × agent's own state: the categories it wears, and its breadcrumb marks. */
export function statePath(root: string, session: string, agent: string): string {
  return join(flowDir(root), "state", `${sanitise(session)}-${sanitise(agent)}.json`);
}

/**
 * What one session × agent's state file holds.
 *
 * ONE FILE for the identity unit, not two. The categories it wears and the notes it has been shown
 * are both facts about the same session × agent, they are written by the same hooks, and splitting
 * them would double the reads on every tool call to save nothing.
 */
export interface SessionState {
  /** The sticky classification verdict. Absent means it has not been read yet. */
  readonly categories?: readonly string[] | undefined;
  readonly marks: Marks;
}

/**
 * A state file's text → the state. Corrupt, empty or absent all mean the same thing: nothing known.
 *
 * FAILING SAFE HERE IS CORRECT, and it is the one place in flow where that is true. State is a
 * de-duplication convenience: losing it re-shows a breadcrumb and re-reads a classification, which
 * is the harmless direction. A guard that refused to run because a marks file had a stray byte
 * would be failing loud about the one thing that does not matter.
 */
export function readState(text: string | null | undefined): SessionState {
  if (text === null || text === undefined || text.trim() === "") return { marks: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { marks: {} };
  }
  if (typeof raw !== "object" || raw === null) return { marks: {} };
  const held = raw as { categories?: unknown; marks?: unknown };
  const categories =
    Array.isArray(held.categories) && held.categories.every((c) => typeof c === "string")
      ? held.categories
      : undefined;
  const marks: Record<string, number> = {};
  if (typeof held.marks === "object" && held.marks !== null)
    for (const [id, at] of Object.entries(held.marks as Record<string, unknown>))
      if (typeof at === "number" && Number.isFinite(at)) marks[id] = at;
  return categories === undefined ? { marks } : { categories, marks };
}

/**
 * The marker that tells the commit gate which live session this worktree's commit belongs to.
 *
 * The BRANCH is in the name, and it has to be: the gate runs inside git's pre-commit hook, outside
 * any session, and two worktrees committing at once must not clobber each other's answer and
 * mis-attribute a commit. A worktree IS a branch — git refuses to check one out twice — so the
 * branch is a safe key. It also keeps the scheme working the day a repo points several checkouts at
 * one shared state directory, which is why it survived the move out of the journal.
 */
export function markerPath(root: string, branch: string | null): string {
  return join(flowDir(root), branch ? `.session-${sanitise(branch)}` : ".session");
}

/**
 * The kill switch: an existence-file, unchanged from the old engine.
 *
 * Its whole value is that turning the guard off needs no settings surgery, so an A/B run is one
 * `touch` and one `rm`. It sits beside the state rather than in the repo, which makes it
 * project-wide rather than per-worktree — "is the guard on here" is a question about the project.
 */
export function offPath(root: string): string {
  return join(flowDir(root), "off");
}

/** What a session marker holds. Loose, because it is read back off disk. */
export interface SessionMarker {
  readonly session?: unknown;
  /**
   * WHICH AGENT of that session was live — the field that lets a commit wear categories.
   *
   * Identity is stored per session × agent, so the session id alone cannot find it: a parent and
   * three subagents share one session and are four different actors. Without this the commit gate
   * had no honest `wearing` to hand the engine, so a `.for(builder).at(commit)` rule was loaded,
   * counted, and silently silenced — the exact class of quiet failure this package exists to
   * delete. Absent on a marker written before this field existed, which reads as "unknown actor".
   */
  readonly agent?: unknown;
  readonly ts?: unknown;
}

/** A commit long after the last edit is not this session's. */
export const MARKER_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Who a commit-gate run belongs to: the live session, and which of its agents was working. */
export interface Attribution {
  readonly session: string;
  /** Null when the marker named no agent — an old marker, or a run with nobody to attribute to. */
  readonly agent: string | null;
}

/**
 * Which session × agent a commit-gate run belongs to, given the marker it found.
 *
 * A fresh, well-formed marker wins. Stale, missing, malformed or absurdly-future → the fallback,
 * with NO agent, so a human's or CI's commit stays unattributed rather than mis-pinned to a session
 * that ended hours ago. `now` is an argument because a clock inside a decision is a decision nobody
 * can test.
 *
 * The agent rides with the session rather than being read separately, because they are one fact:
 * an agent id paired with the wrong session names a state file that does not exist, and half of a
 * stale marker is not more useful than none of it.
 */
export function attribution(
  marker: SessionMarker | null | undefined,
  fallback: string,
  nowMs: number,
  maxAgeMs: number = MARKER_MAX_AGE_MS,
): Attribution {
  const none: Attribution = { session: fallback, agent: null };
  if (!marker || typeof marker.session !== "string" || !marker.session) return none;
  const at = Date.parse(String(marker.ts));
  if (!Number.isFinite(at) || Math.abs(nowMs - at) > maxAgeMs) return none;
  return { session: marker.session, agent: typeof marker.agent === "string" && marker.agent ? marker.agent : null };
}

/**
 * The next event index, read from the TAIL of the session's own file.
 *
 * `seq` is what makes "before / after" computable without timestamp arithmetic — two rows written
 * in the same millisecond still have an order. It comes from the log rather than from a counter
 * file because a sidecar counter is a second thing that can be lost or disagree, and every writer
 * here is a hook process too short-lived to hold one. A tail with no readable seq starts at 1,
 * which is also where a truncated final line lands: the log is appended by several processes, so
 * the last line can be caught mid-write.
 */
export function nextSeq(tail: string): number {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    try {
      const seq = (JSON.parse(line) as { seq?: unknown }).seq;
      if (typeof seq === "number" && Number.isFinite(seq) && seq >= 0) return Math.floor(seq) + 1;
    } catch {
      continue;
    }
  }
  return 1;
}

/** One line of the log. Loose by necessity: it is read off disk, from a file a human can open. */
export interface Row {
  readonly kind: RowKind;
  readonly [key: string]: unknown;
}

/** The first row of every session file: who this stream is, and which build wrote it. */
export function metaRow(session: string, branch: string | null, worktree: string, startedAt: string): Row {
  return { kind: "meta", v: LOG_VERSION, session: sanitise(session), started: startedAt, branch, worktree };
}

/**
 * One summary row per engine invocation, and one row per rail that spoke.
 *
 * A block is a `guardrail` row with `out: "deny"` and never a row of its own. Two rows for one
 * event meant every reader had to know which of them to count, and every block was in the log
 * twice — the old engine's mistake, not repeated here.
 */
export function runRows(moment: Moment, outcome: Outcome, subjects: number): Row[] {
  const rows: Row[] = [{ kind: "run", moment, subjects, rules: outcome.tallies }];
  for (const effect of outcome.effects) {
    if (effect.do === "block")
      rows.push({
        kind: "guardrail",
        moment,
        id: effect.entry,
        subject: effect.subject,
        out: "deny",
        message: effect.message,
        detail: effect.detail,
      });
    else rows.push({ kind: "breadcrumb", moment, id: effect.entry, cause: effect.cause });
  }
  return rows;
}
