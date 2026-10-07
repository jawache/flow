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
// NINE SECTIONS, one file, and it is the layer's whole pure home:
//
//   CATEGORIES      who a session is — the settled classification order, and the sticky verdict
//   MATCHING        which entries an event reaches, and what subjects they are run against
//   THE RUN         the guardrail rails: effects, tallies, and fail-loud when anything is wrong
//   BRIEFING        the breadcrumb rails: drift arithmetic, first touch, and compaction
//   RENDERING       what a person reads when a rail refuses
//   THE STATE HOME  `.flow/` — one constant, and the layouts every writer and reader agree on
//   THE UNIVERSE    what the log's ids mean today — an entry's scope, in the log's own words
//   THE RECORD      the rows read back: blocks, lead, gaps, dead entries, and the terrain
//   REPLAY          a recorded session run again — the same engine, over canned answers
//
// Nothing here reaches the world. The `World` it is handed is the door, and it is an ARGUMENT: no
// node:fs, no child_process, no process.env, no clock. eslint says so on the line and the commit
// gate says so again.

import { join } from "node:path";
import {
  cannedWorld,
  inScope,
  isCategory,
  makeCtx,
  refusalText,
  verdict,
  type Scope,
  type BreadcrumbMoment,
  type CaseWorld,
  type Category,
  type Check,
  type Ctx,
  type EntrySpec,
  type ExecResult,
  type GuardrailMoment,
  type LoadResult,
  type LoadedEntry,
  type Moment,
  type SessionFacts,
  type Settings,
  type TurnAction,
  type Unanswered,
  type Verdict,
  type World,
} from "../language/domain.ts";

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
// `.on()` beside it. An `.on()` on a command-only entry would therefore be consulted by nothing,
// and matching stays silent about it — because that config never reaches here: the grammar refuses
// it (`PATH_MOMENTS` and the `dead-scope` refusal, F6). A silent difference in matching was the old
// engine's answer, and a fence that reads as armed and narrows nothing is the bug flow exists to
// delete rather than to report.

/** One event the guardrail rails carry. Facts only — who it happened to is `wearing`. */
export interface GuardEvent {
  readonly moment: GuardrailMoment;
  /** write/delete: the would-be file, in memory, before disk. */
  readonly file?: Ctx["file"];
  /** command: the line about to run. */
  readonly command?: string | undefined;
  /** commit: the staged paths. */
  readonly staged?: readonly string[] | undefined;
  /**
   * commit: the staged paths the last commit does not have, which become each file's `existed`.
   * Absent when the shell could not ask git, and then `existed` is left unset.
   */
  readonly added?: readonly string[] | undefined;
  /**
   * commit: the staged deletions an entry will judge (`judgedDeletions`), each with its content as
   * the last commit has it. A rename is a deletion of its old path plus an add of its new one.
   */
  readonly deleted?: readonly { readonly path: string; readonly content: string }[] | undefined;
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
  /** command: the line about to run — what a command note's `on` is matched against. */
  readonly command?: string | undefined;
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

// `Scope` and `inScope` moved DOWN to the language layer, where the two keys they read are
// declared, and are re-exported here because this layer's readers have always addressed them here.
// The move is what lets the case runner drive the commit fan-out below through the identical scope
// test the live rail uses — one reader, three callers, no chance of a green case that is not
// evidence about the rail.
export { inScope, type Scope };

/**
 * Does this entry's scope REACH this path — the coverage question, which is not the matching one.
 *
 * `inScope` answers "may this entry run here", and an entry with no `on` at all answers yes to
 * every path in the repo. That is right for matching and catastrophic for coverage: a commit gate
 * or a command ban would claim the whole tree, and every gap in it would disappear. Coverage is
 * only ever claimed by an entry that NAMES paths.
 */
export function covers(scope: Scope, path: string): boolean {
  return (scope.on?.length ?? 0) > 0 && inScope(scope, path);
}

/**
 * The entries that can claim coverage of anything — live, and naming paths.
 *
 * ONE spelling, because three surfaces ask it and they must agree: the gap list, the terrain's
 * per-node answer, and the transcript-side reading of areas nobody watches. They were spelled
 * three ways for one commit, and a set that differs by a disabled entry is a folder that reads as
 * guarded on one page and abandoned on the next.
 */
export function watching(entries: readonly Bound[]): Bound[] {
  return entries.filter((entry) => entry.disabled === null && (entry.on?.length ?? 0) > 0);
}

/**
 * Does this entry judge a staged deletion of this path at the commit gate? Only one that fires at
 * both `commit` and `delete` and names paths — see `subjectsOf` for why `commit` alone is not enough.
 */
function judgesDeletion(entry: LoadedEntry, path: string): boolean {
  const { spec } = entry;
  return spec.kind === "guardrail" && !!spec.on && fires(spec, "commit") && fires(spec, "delete") && inScope(spec, path);
}

/**
 * The staged deletions some entry will judge — the ones whose content is worth reading from the
 * last commit. A commit that removes a vendored folder is thousands of deletions, and none of them
 * costs a read unless a rule is about it.
 */
export function judgedDeletions(entries: readonly LoadedEntry[], deleted: readonly string[]): string[] {
  return deleted.filter((path) => entries.some((entry) => judgesDeletion(entry, path)));
}

/** One thing an entry is run against: what the log row names, and the facts its ctx carries. */
interface Subject {
  /** A path, a command, or null when the event is not about any one thing. */
  readonly name: string | null;
  readonly facts: Partial<Ctx>;
  /** The moment the check is asked at, when it is not the event's: a staged deletion is a delete. */
  readonly moment?: GuardrailMoment;
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
 * A staged path that is not there yields no subject: there is no would-be file to hand a content
 * check, and inventing an empty one would let it pass on a fiction.
 *
 * A staged DELETION is asked only of an entry that fires at `delete` as well as `commit`, and it is
 * asked as the delete it is — the same ctx the live delete rail builds, with the file as the last
 * commit has it. An entry bound at `commit` alone judges what the commit will contain, and a deleted
 * file is not in it: a content check would block the removal of the very text it bans.
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
      const existed = event.added === undefined ? {} : { existed: !event.added.includes(path) };
      out.push({ name: path, facts: { file: { path, content: await world.fs.read(path), ...existed }, staged } });
    }
    for (const gone of event.deleted ?? []) {
      if (!judgesDeletion(entry, gone.path)) continue;
      out.push({ name: gone.path, facts: { file: { ...gone, existed: true }, staged }, moment: "delete" });
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

/**
 * One block from the guard itself rather than from any rule. `entry: null` is how a reader tells
 * this from a rule refusing. The adapter raises the same shape for a broken config, so this is the
 * one home the canonical block wears — a field added here reaches both callers.
 */
export function fault(message: string): Block {
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
      const answer = await ask(check, makeCtx(subject.moment ?? event.moment, { ...subject.facts, actor: event.wearing }, world));
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
    // AT `command`, THE SUBJECT IS THE COMMAND LINE, and the scope is not optional in practice: a
    // command note without one would show on every shell call in the session. An unscoped one is
    // still legal and still shows — the grammar refuses a scope that narrows nothing, never a
    // missing one — so the test is the scope's, not the event's.
    if (event.command !== undefined && !inScope(entry.spec, event.command)) continue;
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

/**
 * Every kind a log row may be. Closed — a reader that meets another word has met corruption.
 *
 * `read` and `write` are what went ROUND the tool rows: a file a shell command read by name, and a
 * file a call changed that the call did not name — a heredoc, a `sed -i`, a script. A `tool` row
 * says a call happened; these say what it did to the tree, so the coverage and lead numbers count
 * work done through the shell as well as through Edit. `mismatch` is the host's own list of the
 * files a command changed disagreeing with flow's diff: a fact to read, never an input to a rule.
 */
export const ROW_KINDS = ["meta", "tool", "breadcrumb", "guardrail", "compaction", "run", "read", "write", "mismatch"] as const;
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

/**
 * The RECORDING switch, and it is an existence-file for the same reason the kill switch is.
 *
 * Turning capture on is one `touch` and turning it off is one `rm`, with no settings surgery and
 * no flag to remember on a hook the harness invokes rather than you. That matters more here than
 * for `off`: recording is what you reach for the moment something misbehaves, and a mechanism that
 * needs a config edit is one nobody arms in time to catch the bug they were looking at.
 */
export function recordPath(root: string): string {
  return join(flowDir(root), "record");
}

/** One session's recording — the canonical event stream, beside the log it should agree with. */
export function recordingFile(root: string, session: string): string {
  return join(flowDir(root), "replay", `${sanitise(session)}.jsonl`);
}

/**
 * Where a repo remembers which conversations the archival side has already read.
 *
 * One empty file per conversation, so EXISTENCE is the whole fact and there is nothing to keep in
 * step. It lives here with every other `.flow/` path for the reason this section exists at all:
 * the old engine spelled one state path two ways and the disagreement was invisible in exactly the
 * direction that hurts — a reader looking in the wrong place reports "nothing read yet" rather
 * than an error, and silently re-offers a year of history.
 */
export function readDir(root: string): string {
  return join(flowDir(root), "read");
}

/** The marker for one conversation. Sanitised, because a stray id must never escape the folder. */
export function readMarkPath(root: string, session: string): string {
  return join(readDir(root), sanitise(session));
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE — what the log's ids mean TODAY
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A log row names an entry and says what happened to it. It cannot say what that entry WATCHES,
// and it must not: an entry re-scoped yesterday would then be read against the scope it had a
// month ago. So every question the record answers is asked against the universe as it stands now
// — which is also the only way a DEAD entry is findable at all, because an entry with nothing to
// its name is invisible in a log by definition and only the binding says it should have had rows.

/** One bound entry, in the words the recorded rows can be matched against. */
export interface Bound extends Scope {
  readonly kind: EntrySpec["kind"];
  readonly id: string;
  /** The pack it came from — the group a reader finds it in. */
  readonly pack: string;
  readonly at: readonly Moment[];
  /** The categories it binds to. Empty means every actor. */
  readonly for: readonly string[];
  readonly description: string | null;
  /** The sentence a guardrail refuses with, or a breadcrumb's own prose. */
  readonly says: string | null;
  /** The reason it is turned off, when it is. An absent value means it is live. */
  readonly disabled: string | null;
}

/**
 * Every bound entry as the record reads it — one reader, so "what does this entry watch" cannot
 * be answered two ways by two surfaces.
 *
 * A DISABLED entry is included, carrying its reason. It fires at nothing, so it earns no verdict
 * and claims no coverage; but leaving it out would make it invisible on every surface that lists
 * the regime, and "turned off, here is why" is the one thing a reader most needs to see.
 */
export function universe(entries: readonly LoadedEntry[]): Bound[] {
  return entries.map((entry) => {
    const spec = entry.spec;
    const says = spec.kind === "guardrail" ? (spec.message ?? null) : (spec.text ?? spec.file ?? null);
    return {
      kind: spec.kind,
      id: entry.id,
      pack: entry.pack,
      at: [...((spec.at ?? []) as readonly Moment[])],
      on: spec.on,
      ignore: spec.ignore,
      for: [...entry.categories],
      description: spec.description ?? null,
      says,
      disabled: spec.disabled ? (spec.disabled.reason ?? "") : null,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORD — the rows read back
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything below is COMPUTED AT READ TIME from the rows. Nothing is ever stored: a stored metric
// is a second source of truth that goes stale the moment the definition changes, and these
// definitions are young.
//
// The settled vocabulary, one word per thing, everywhere:
//
//   Blocks   how many times a guardrail refused something. A news count, no target.
//   Lead     per SHOW of a touch breadcrumb: the distance, in TOOL CALLS, to the first edit of a
//            file its globs cover, within one chat. 0 = it arrived with the edit; 1 = shown on the
//            read immediately before it, the ideal; large = shown so far ahead it may be buried.
//   Gaps     edits in areas no entry's globs reach, ranked by edit count. The list IS the finding.
//   Dead     an entry whose scope has matched nothing over an ample lifetime — config that is
//            fiction. Named individually, because "3 dead" is not actionable and a name is.
//
// ONE WALK, and that is a consolidation rather than a port. The old engine read the same rows
// twice: a metrics pass for the per-entry numbers and a separate ledger pass for the retirement
// verdicts, each computing its own span and its own "is this history ample" from the same
// timestamps. Two answers to one question is how they come to differ on the same repo, so the
// lifetime facts and the verdicts drawn from them are the same read.

const DAY_MS = 86_400_000;

/** The lead distribution's buckets, coarse on purpose — the shape matters, the exact number does not. */
export const LEAD_BUCKETS = ["0", "1-5", "6-19", "20+"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

export interface Lead {
  /** The middle of the measured leads, or null when nothing could be measured. */
  readonly median: number | null;
  readonly buckets: Readonly<Record<LeadBucket, number>>;
  /** Shows with no in-scope edit after them in the same chat. Counted, never scored as zero. */
  readonly noEdit: number;
}

/** What one breadcrumb has done, and whether its scope has ever spoken. */
export interface BreadcrumbRecord {
  readonly id: string;
  readonly pack: string;
  readonly shown: number;
  readonly byCause: Readonly<Record<Cause, number>>;
  readonly lead: Lead;
  readonly last: string | null;
  readonly dead: boolean;
}

/**
 * What one guardrail has done — and the four numbers are the tally's own, not a second vocabulary.
 *
 * `evaluated` is subjects it was actually run against, which is already scope-filtered by the
 * engine, so it IS the old `matched` under a truer name. `silenced` is the count the old engine
 * could not have had: an entry in force that never ran because this session was not the actor it
 * binds to, which is a rule doing its job rather than a rule doing nothing.
 */
export interface GuardrailRecord {
  readonly id: string;
  readonly pack: string;
  /** Rails it stood on — engine invocations where it was in force at the moment that fired. */
  readonly runs: number;
  readonly evaluated: number;
  readonly hits: number;
  readonly silenced: number;
  readonly lastBlock: { readonly ts: string | null; readonly subject: string | null } | null;
  /** Same entry, same subject, same chat, no compaction between: the message did not teach. */
  readonly repeats: number;
  readonly dead: boolean;
}

/** An area nothing watches, and how much work happened there. */
export interface Gap {
  readonly area: string;
  readonly edits: number;
}

/** An entry that has caught nothing for long enough that somebody owes it a decision. */
export interface Quiet {
  readonly id: string;
  readonly lastHit: string | null;
  readonly daysSince: number;
}

/** How much history this reading stands on, and whether it is enough to call anything dead. */
export interface Span {
  readonly sessions: number;
  readonly days: number;
  readonly first: string | null;
  readonly last: string | null;
  /** Enough opportunity that "never matched" is a verdict rather than a wait. */
  readonly ample: boolean;
  readonly tools: number;
}

export interface Metrics {
  readonly headline: {
    readonly blocks: number;
    readonly lead: Lead;
    readonly gaps: readonly Gap[];
    readonly dead: readonly string[];
    /** Bound, never once evaluated, over an ample history — nothing has ever reached it. */
    readonly retire: readonly string[];
    /** The same silence, over a history too thin to read anything into. */
    readonly unproven: readonly string[];
    /** It used to catch things and has not for a long time. */
    readonly quiet: readonly Quiet[];
  };
  readonly breadcrumbs: readonly BreadcrumbRecord[];
  readonly guardrails: readonly GuardrailRecord[];
  readonly gaps: readonly Gap[];
  readonly span: Span;
  /**
   * The per-path tally the terrain is drawn from — and it comes out of THIS walk rather than a
   * second one over the same rows.
   *
   * The two readings had drifted before they were even finished: `gaps` decided "no entry reaches
   * this edit" against one scoped set and the terrain decided it against another, spelled
   * separately. There is one decision now, made here, and the tree reads its answer.
   */
  readonly heat: Heat;
}

/** One session's rows, as every reader of the record takes them. */
export interface SessionRows {
  readonly session: string;
  readonly rows: readonly Row[];
}

export interface MetricsArgs {
  readonly sessions: readonly SessionRows[];
  readonly entries: readonly Bound[];
  readonly nowMs: number;
  /** How much opportunity a scope needs before "never matched" is a verdict rather than a wait. */
  readonly minSessions?: number | undefined;
  readonly minDays?: number | undefined;
}

const emptyLead = (): Lead => ({ median: null, buckets: { "0": 0, "1-5": 0, "6-19": 0, "20+": 0 }, noEdit: 0 });

function bucketOf(lead: number): LeadBucket {
  if (lead <= 0) return "0";
  if (lead <= 5) return "1-5";
  return lead <= 19 ? "6-19" : "20+";
}

/** The middle value. Even counts average the two middles — a lead of 1.5 is a real answer. */
function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function leadFrom(samples: readonly number[], noEdit: number): Lead {
  const buckets: Record<LeadBucket, number> = { "0": 0, "1-5": 0, "6-19": 0, "20+": 0 };
  for (const s of samples) buckets[bucketOf(s)] += 1;
  return { median: median(samples), buckets, noEdit };
}

const dirOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");

/**
 * Is this a path inside the repo — the ONE predicate, and it is exported because two layers need
 * the same answer.
 *
 * Every path flow reasons about is repo-relative, because that is how an `on` glob is written. An
 * absolute path or one that climbs out is a real thing an agent touched and is simply not a node
 * of this tree, not a file any glob could reach, and not an area anybody could have been watching.
 * There were two spellings of that sentence and an inline third; a predicate that disagrees with
 * itself decides that an edit was uncovered in one reading and out of scope in another.
 */
export function insideRepo(path: string): boolean {
  return path !== "" && !path.startsWith("/") && !path.startsWith("..");
}

/** A row's string field, or null — every row is read off disk and may hold anything. */
function field(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * What a row was about, in the order the row kinds spell it.
 *
 * A mechanism row (`runRows`) states its `subject` — the path or the command line the entry was
 * run against — and a tool row states the call's own `path` or `command`. One reader over both,
 * because "what was this row about" is one question and the metrics ask it of every kind.
 */
export function subjectOf(row: Row): string | null {
  return field(row, "subject") ?? field(row, "path") ?? field(row, "command");
}

/**
 * Did this row record a file being CHANGED?
 *
 * It reads a flag the ROW carries rather than a set of tool names, and that is the seam holding:
 * which of a harness's tools change a file is harness knowledge, so the adapter decides it once
 * when it writes the row and the engine — which may never know what a `MultiEdit` is — reads the
 * answer. The old engine kept a tool-name set in its metrics layer, and a second, already-drifted
 * copy in a rule; a fact about somebody else's tool names belongs on the far side of the seam.
 */
export function isEdit(row: Row): boolean {
  return row.kind === "tool" && row["edit"] === true && subjectOf(row) !== null && field(row, "path") !== null;
}

interface Shows {
  count: number;
  byCause: Record<Cause, number>;
  last: string | null;
  samples: number[];
  noEdit: number;
}

interface Rail {
  runs: number;
  evaluated: number;
  hits: number;
  silenced: number;
  sessions: Set<string>;
  lastBlock: { ts: string | null; subject: string | null } | null;
  lastHit: string | null;
  repeats: number;
}

/**
 * The whole reading, from the rows and the bindings they are judged against.
 *
 * `entries` is the universe as it stands today; `sessions` is every stream being read. The two
 * together are the only inputs, and there is no clock inside — `nowMs` is an argument, because a
 * judgement about how long something has been quiet is a decision and a decision must be testable.
 */
export function metrics({ sessions, entries, nowMs, minSessions = 15, minDays = 30 }: MetricsArgs): Metrics {
  const live = entries.filter((e) => e.disabled === null);
  const byId = new Map(live.map((e) => [e.id, e]));
  const scoped = watching(entries);

  const shows = new Map<string, Shows>();
  const rails = new Map<string, Rail>();
  const touches: Record<string, number> = {};
  const edited: Record<string, number> = {};
  const uncovered: Record<string, number> = {};
  const stamps: string[] = [];

  const showsOf = (id: string): Shows => {
    let held = shows.get(id);
    if (held === undefined) {
      held = {
        count: 0,
        byCause: Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<Cause, number>,
        last: null,
        samples: [],
        noEdit: 0,
      };
      shows.set(id, held);
    }
    return held;
  };
  const railOf = (id: string): Rail => {
    let held = rails.get(id);
    if (held === undefined) {
      held = { runs: 0, evaluated: 0, hits: 0, silenced: 0, sessions: new Set(), lastBlock: null, lastHit: null, repeats: 0 };
      rails.set(id, held);
    }
    return held;
  };

  let blocks = 0;
  let tools = 0;

  for (const { session, rows } of sessions) {
    // Per chat, because both lead and repeats are chat-scoped: a new chat has none of the last
    // one's context, so it legitimately shows again and legitimately blocks again.
    const edits: { at: number; path: string }[] = [];
    const pending: { id: string; at: number }[] = [];
    const taught = new Set<string>();
    let toolIndex = 0;

    for (const row of rows) {
      const ts = field(row, "ts");
      if (ts !== null) stamps.push(ts);

      // WHAT A CALL DID BEYOND WHAT IT NAMED. A file a shell command read is a touch, and a file a
      // call changed without naming it is an edit, both placed at the call they rode on — they are
      // not calls of their own, so the tool count and the lead's distance do not move for them.
      const tool = row.kind === "tool";
      if (tool || row.kind === "read" || row.kind === "write") {
        if (tool) {
          toolIndex += 1;
          tools += 1;
        }
        const path = field(row, "path");
        // Everything the lead, the gap list and the tree need — ONE walk over the rows, and one
        // decision about whether anything was watching. A path outside the repo is not a file any
        // glob could reach, so it is neither a node of the tree nor a gap in it nor an edit a
        // breadcrumb could have steered.
        if (path === null || !insideRepo(path)) continue;
        touches[path] = (touches[path] ?? 0) + 1;
        if (tool ? !isEdit(row) : row.kind === "read") continue;
        edited[path] = (edited[path] ?? 0) + 1;
        edits.push({ at: toolIndex, path });
        if (!scoped.some((e) => covers(e, path))) uncovered[path] = (uncovered[path] ?? 0) + 1;
        continue;
      }
      // Past a compaction the message is gone, so a block after it teaches anew rather than repeating.
      if (row.kind === "compaction") {
        taught.clear();
        continue;
      }
      if (row.kind === "breadcrumb") {
        const id = field(row, "id");
        if (id === null) continue;
        const held = showsOf(id);
        held.count += 1;
        const cause = field(row, "cause");
        if (cause !== null && (CAUSES as readonly string[]).includes(cause)) held.byCause[cause as Cause] += 1;
        if (ts !== null && (held.last === null || ts > held.last)) held.last = ts;
        // Only a TOUCH show has a lead to measure. A session show arrives by construction at the
        // moment it is wanted, so scoring it would dilute the one number that can be wrong.
        if (field(row, "moment") === "touch" && (byId.get(id)?.on?.length ?? 0) > 0) pending.push({ id, at: toolIndex });
        continue;
      }
      if (row.kind === "run") {
        // Read off disk, so a hand-edited line may hold anything — including a null in the list.
        const tallies = (row["rules"] as readonly (Partial<Tally> | null)[] | undefined) ?? [];
        for (const tally of tallies) {
          if (typeof tally?.id !== "string") continue;
          const held = railOf(tally.id);
          held.runs += 1;
          held.evaluated += tally.evaluated ?? 0;
          held.silenced += tally.silenced ?? 0;
          held.sessions.add(session);
        }
        continue;
      }
      if (row.kind === "guardrail" && row["out"] === "deny") {
        const id = field(row, "id");
        if (id === null) continue;
        const held = railOf(id);
        held.hits += 1;
        blocks += 1;
        const subject = subjectOf(row);
        held.lastBlock = { ts, subject };
        if (ts !== null && (held.lastHit === null || ts > held.lastHit)) held.lastHit = ts;
        const key = `${id} ${subject ?? ""}`;
        if (taught.has(key)) held.repeats += 1;
        else taught.add(key);
      }
    }

    // Lead, once the chat is whole: the first in-scope edit at or after the call the breadcrumb
    // rode on. "At" is what makes 0 mean late — the edit that triggered the show IS the work
    // arriving, and a breadcrumb delivered then had nothing left to steer.
    for (const p of pending) {
      const entry = byId.get(p.id);
      const hit = entry === undefined ? undefined : edits.find((e) => e.at >= p.at && covers(entry, e.path));
      const held = showsOf(p.id);
      if (hit === undefined) held.noEdit += 1;
      else held.samples.push(hit.at - p.at);
    }
  }

  const sorted = [...stamps].sort();
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const sessionCount = sessions.filter((s) => s.session !== "commit" && s.rows.length > 0).length;
  const days = first !== null && last !== null ? Math.round((Date.parse(last) - Date.parse(first)) / DAY_MS) : 0;
  const ample = sessionCount >= minSessions || days >= minDays;

  // BOUND AFTER THE HISTORY, told apart from fiction. A guardrail with no rows at all is spared:
  // "bound yesterday" and "watching nothing" look identical in a log that predates it. A
  // breadcrumb has no such witness — its only rows ARE its shows — so the witness is its PACK. A
  // pack that was in force during the window produced shows; one that never spoke was not there
  // to speak, so nothing in it is judged, and the moment any of its breadcrumbs shows, every
  // other becomes judgeable again. Self-healing, and it costs no new input.
  const spoke = new Set<string>();
  for (const e of live) if (e.kind === "breadcrumb" && (shows.get(e.id)?.count ?? 0) > 0) spoke.add(e.pack);

  const breadcrumbs: BreadcrumbRecord[] = live
    .filter((e) => e.kind === "breadcrumb")
    .map((e) => {
      const held = shows.get(e.id);
      return {
        id: e.id,
        pack: e.pack,
        shown: held?.count ?? 0,
        byCause: held?.byCause ?? (Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<Cause, number>),
        lead: held === undefined ? emptyLead() : leadFrom(held.samples, held.noEdit),
        last: held?.last ?? null,
        // A session breadcrumb shows on every session by construction, so silence there is an
        // engine fault rather than a fiction in the config. DEAD only ever means "its SCOPE never
        // matched", which is a claim about globs.
        dead: ample && (e.on?.length ?? 0) > 0 && (held?.count ?? 0) === 0 && spoke.has(e.pack),
      };
    });

  const guardrails: GuardrailRecord[] = live
    .filter((e) => e.kind === "guardrail")
    .map((e) => {
      const held = rails.get(e.id);
      const runs = held?.runs ?? 0;
      const evaluated = held?.evaluated ?? 0;
      return {
        id: e.id,
        pack: e.pack,
        runs,
        evaluated,
        hits: held?.hits ?? 0,
        silenced: held?.silenced ?? 0,
        lastBlock: held?.lastBlock ?? null,
        repeats: held?.repeats ?? 0,
        // DEAD is a claim about a SCOPE, so only an entry that declares one can earn it: it stood
        // on the rail, and not one subject was ever inside its globs. An unscoped guardrail — a
        // commit gate, a command ban — cannot have a dead scope. Nor can one with nothing at all
        // to its name: the commonest cause of that is an entry bound after the history it is being
        // judged against, and silence with no evidence is not a verdict.
        dead: ample && (e.on?.length ?? 0) > 0 && runs > 0 && evaluated === 0,
      };
    });

  // The gap list is the SAME per-path answer, rolled up to the folder somebody would act on.
  const byArea = new Map<string, number>();
  for (const [path, n] of Object.entries(uncovered)) byArea.set(dirOf(path), (byArea.get(dirOf(path)) ?? 0) + n);
  const gaps: Gap[] = [...byArea.entries()]
    .map(([area, edits]) => ({ area, edits }))
    .sort((a, b) => b.edits - a.edits || a.area.localeCompare(b.area));

  const retire: string[] = [];
  const unproven: string[] = [];
  const quiet: Quiet[] = [];
  for (const e of live) {
    const rail = rails.get(e.id);
    const shown = shows.get(e.id);
    const ran = (rail?.evaluated ?? 0) + (shown?.count ?? 0);
    if (ran === 0) {
      (ample ? retire : unproven).push(e.id);
      continue;
    }
    // It ran and never caught anything: a working deterrent, kept. Only something that USED to
    // catch things and stopped is a question worth putting in front of a person.
    const lastHit = rail?.lastHit ?? null;
    if (lastHit === null) continue;
    const daysSince = Math.round((nowMs - Date.parse(lastHit)) / DAY_MS);
    if (ample && Number.isFinite(daysSince) && daysSince > minDays) quiet.push({ id: e.id, lastHit, daysSince });
  }

  const allSamples = [...shows.values()].flatMap((s) => s.samples);
  const noEdit = [...shows.values()].reduce((n, s) => n + s.noEdit, 0);
  const dead = [...breadcrumbs, ...guardrails]
    .filter((e) => e.dead)
    .map((e) => e.id)
    .sort();

  return {
    headline: {
      blocks,
      lead: leadFrom(allSamples, noEdit),
      gaps,
      dead,
      retire: retire.sort(),
      unproven: unproven.sort(),
      quiet: quiet.sort((a, b) => b.daysSince - a.daysSince),
    },
    breadcrumbs,
    guardrails,
    gaps,
    span: { sessions: sessionCount, days, first, last, ample, tools },
    heat: { touches, edits: edited, uncovered },
  };
}

// ── the terrain: the repo as a tree, with the guard's coverage laid over it ──
//
// The lens answers the question a config file cannot: not "what rules do I have" but "who is
// watching where I actually work". So the tree is the REAL one — every tracked path plus every
// path the recorder saw touched, hidden folders included — and each node carries the three numbers
// only the flight recorder can supply. The rollup is the point: a gap one folder deep is invisible
// in a flat list and obvious on a tree.

export interface TerrainNode {
  /** Repo-relative path. A folder carries no trailing slash. */
  readonly path: string;
  /** The last segment — what a tree draws. */
  readonly name: string;
  readonly dir: boolean;
  readonly depth: number;
  /** Tool calls recorded against this path (a folder: everything under it). */
  touches: number;
  /** Of those, the ones that CHANGED a file. */
  edits: number;
  /** Ids of the entries whose globs reach here (a folder: anything inside it). */
  entries: string[];
  /** Edits here that no entry's globs reach. A folder's gap is the sum of its children's. */
  uncovered: number;
}

/**
 * What the recorded rows say about each path: how often it was touched at all, how often it was
 * CHANGED, and how many of those changes nothing was watching.
 *
 * Three numbers rather than one because they answer different questions — reading an area is how
 * an agent learns it, editing it is how the area changes (and a breadcrumb that arrives on the
 * read is doing its job while one that arrives on the edit is not), and the third is the gap.
 *
 * It is produced by `metrics` and by nothing else. Coverage is a judgement about an entry's scope,
 * so a second producer would be a second answer to "was anybody watching here" — which the gap
 * list and the terrain briefly had.
 */
export interface Heat {
  readonly touches: Readonly<Record<string, number>>;
  readonly edits: Readonly<Record<string, number>>;
  readonly uncovered: Readonly<Record<string, number>>;
}

export interface TerrainArgs {
  /** The tracked tree — what the repo HAS. */
  readonly paths: readonly string[];
  /** `metrics(…).heat` — the rows, already read. This function walks no rows of its own. */
  readonly heat: Heat;
  readonly entries: readonly Bound[];
}

/** The tree, flattened into display order: folders before files, alphabetical within each. */
export function terrain({ paths, heat: recorded, entries }: TerrainArgs): TerrainNode[] {
  // The union, because the two sources answer different questions: `paths` is what the repo HAS,
  // and the recorder's keys are what was WORKED ON — including a file since deleted, which is
  // exactly the history a tree built from the tracked set alone would quietly lose.
  const files = new Set<string>([...paths, ...Object.keys(recorded.touches), ...Object.keys(recorded.edits)]);
  // The same set `metrics` judged coverage with, asked a DIFFERENT question: not "was this edit
  // watched" — that is already answered, per path, in the heat — but "which entries reach this
  // node", which is what a folder is opened to find out.
  const scoped = watching(entries);
  const nodes = new Map<string, TerrainNode>();

  const node = (path: string, dir: boolean): TerrainNode => {
    let held = nodes.get(path);
    if (held === undefined) {
      held = {
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        dir,
        depth: path.split("/").length - 1,
        touches: 0,
        edits: 0,
        entries: [],
        uncovered: 0,
      };
      nodes.set(path, held);
    }
    return held;
  };

  for (const file of files) {
    const parts = file.split("/");
    const covering = scoped.filter((e) => covers(e, file)).map((e) => e.id);
    const touched = recorded.touches[file] ?? 0;
    const changed = recorded.edits[file] ?? 0;
    const uncovered = recorded.uncovered[file] ?? 0;

    // Walk the path from the root down, so every ancestor folder exists and accumulates. A
    // folder's coverage is the UNION of what answers inside it: "does anything watch here" is the
    // question a folder is opened to ask.
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      const held = node(path, i < parts.length - 1);
      held.touches += touched;
      held.edits += changed;
      held.uncovered += uncovered;
      for (const id of covering) if (!held.entries.includes(id)) held.entries.push(id);
    }
  }

  for (const held of nodes.values()) held.entries.sort();
  return [...nodes.values()].sort(treeOrder);
}

/**
 * Display order: siblings compare folder-before-file then by name, and a node always follows its
 * parent. Comparing the paths segment by segment does both at once — no recursive assembly, and no
 * second definition of "which comes first" hiding in a renderer.
 */
function treeOrder(a: TerrainNode, b: TerrainNode): number {
  const as = a.path.split("/");
  const bs = b.path.split("/");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i] as string;
    const y = bs[i] as string;
    if (x === y) continue;
    const xLeaf = i === as.length - 1 && !a.dir;
    const yLeaf = i === bs.length - 1 && !b.dir;
    if (xLeaf !== yLeaf) return xLeaf ? 1 : -1;
    return x.localeCompare(y);
  }
  return as.length - bs.length; // an ancestor comes before its own child
}

// ── the moments lens: what meets you, and when ──
//
// The question this arrangement answers is the agent's own — "what will happen to me at moment
// X?" — so entries are grouped by MOMENT rather than by pack. An entry appears in every moment it
// fires at; that is not duplication, it is the answer: standing at the commit, a rule that also
// fires at write is still about to run.
//
// There is no vocabulary translation here and there must never be one. The old engine kept a table
// mapping its internal phase names to human words, because `edit` and `write` were two spellings
// of one moment and no reader could be expected to know which. flow's moments are the words the
// config is written in, so the word on the page IS the word in the sentence.

/** The moments, in the order a session meets them. */
export const MOMENT_ORDER: readonly Moment[] = [
  "session",
  "touch",
  "write",
  "delete",
  "command",
  "commit",
  "turn-end",
];

/** One entry as a moments view draws it: the binding, plus what it has done. */
export interface MomentEntry extends Bound {
  readonly record: BreadcrumbRecord | GuardrailRecord | null;
}

export interface MomentsView {
  readonly moments: readonly { readonly moment: Moment; readonly entries: readonly MomentEntry[] }[];
  readonly totals: { readonly breadcrumbs: number; readonly guardrails: number; readonly disabled: number };
}

/** The universe arranged by moment, each entry carrying whatever the record says about it. */
export function momentsView(entries: readonly Bound[], recorded?: Metrics | null): MomentsView {
  const crumbs = new Map((recorded?.breadcrumbs ?? []).map((b) => [b.id, b]));
  const rails = new Map((recorded?.guardrails ?? []).map((g) => [g.id, g]));
  const all: MomentEntry[] = entries.map((e) => ({
    ...e,
    record: (e.kind === "breadcrumb" ? crumbs.get(e.id) : rails.get(e.id)) ?? null,
  }));
  return {
    moments: MOMENT_ORDER.map((moment) => ({ moment, entries: all.filter((e) => e.at.includes(moment)) })).filter(
      (m) => m.entries.length > 0,
    ),
    totals: {
      breadcrumbs: all.filter((e) => e.kind === "breadcrumb").length,
      guardrails: all.filter((e) => e.kind === "guardrail").length,
      disabled: all.filter((e) => e.disabled !== null).length,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REPLAY — a recorded session, run again
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// J5.2, and the standing proof that the adapter seam holds. A recording is the CANONICAL EVENT
// STREAM plus the answers the checks reached for while it was live — nothing else, and in
// particular nothing that says which harness produced it. Replay hands those events back to the
// same `guard` and `brief` this file exports, through the same `cannedWorld` a `.test()` case runs
// through, and the effects come out where they came out live.
//
// THREE PROPERTIES, and each is load-bearing:
//
//   HARNESS-BLIND   a step names a moment and its facts, never a hook or a payload. The engine
//                   could not tell a Claude Code recording from a Codex one, which is the whole
//                   reason a second harness is a second column.
//   REPO-BLIND      every reach a check made is written down beside the event, so replay opens no
//                   file, runs no command and asks git nothing. That is what makes a bug a FIXTURE
//                   before it is a fix: the recording travels, the repo does not.
//   DETERMINISTIC   marks thread through the steps exactly as they did live, so the drift
//                   arithmetic and the compaction boundary replay too — not just the blocks.

/** The recording format this build writes and reads. */
export const RECORDING_VERSION = 1;

/**
 * One engine invocation, as it happened.
 *
 * `world` is what the checks reached for during that step, and its absence is not an empty world —
 * it is a step whose checks reached for nothing. An unanswered reach at replay time is REPORTED
 * rather than guessed at, which is `cannedWorld`'s own rule and the reason it is the one builder.
 */
export type RecordedStep =
  | {
      readonly rail: "guard";
      readonly moment: GuardrailMoment;
      readonly file?: Ctx["file"];
      readonly command?: string | undefined;
      readonly staged?: readonly string[] | undefined;
      readonly added?: readonly string[] | undefined;
      readonly deleted?: GuardEvent["deleted"];
      readonly turn?: readonly TurnAction[] | undefined;
      readonly wearing: readonly string[];
      readonly world?: CaseWorld | undefined;
    }
  | {
      readonly rail: "brief";
      readonly moment: BreadcrumbMoment;
      readonly path?: string | undefined;
      readonly command?: string | undefined;
      readonly wearing: readonly string[];
      readonly tokens: number;
    }
  /** The host compacted: every area mark is cleared, the session marks hold. */
  | { readonly rail: "compaction" };

export interface Recording {
  readonly v: number;
  readonly session: string;
  readonly steps: readonly RecordedStep[];
}

/**
 * A recording file's text → the steps in it. JSONL, one step per line, appended live.
 *
 * It is JSONL rather than one JSON document for the reason the log is: the writer is a hook
 * process that lives for one tool call, so it can only ever append, and a document would have to
 * be read, parsed and rewritten on every keystroke. An unreadable line is dropped rather than
 * failing the read — the file is appended to by processes that can be killed mid-write, and one
 * lost step is a smaller lie than no recording at all.
 *
 * The first line is a header carrying the session and the format version. A file with none is
 * still read: what it holds is steps, and refusing a recording for want of a header would refuse
 * exactly the hand-written fixture this format exists to make writable.
 */
export function readRecording(text: string, fallback = ""): Recording {
  let session = fallback;
  let v = RECORDING_VERSION;
  const steps: RecordedStep[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let held: unknown;
    try {
      held = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof held !== "object" || held === null || Array.isArray(held)) continue;
    const record = held as Record<string, unknown>;
    if (typeof record["v"] === "number") {
      v = record["v"];
      if (typeof record["session"] === "string") session = record["session"];
      continue;
    }
    if (record["rail"] === "guard" || record["rail"] === "brief" || record["rail"] === "compaction")
      steps.push(record as unknown as RecordedStep);
  }
  return { v, session, steps };
}

/** The header line a recording opens with — who this stream is, and which build wrote it. */
export function recordingHeader(session: string): Record<string, unknown> {
  return { v: RECORDING_VERSION, session };
}

/** One replayed step: what the engine said, and the rows it would have written. */
export interface ReplayedStep {
  readonly step: RecordedStep;
  readonly effects: readonly Effect[];
  readonly rows: readonly Row[];
}

export interface ReplayResult {
  readonly steps: readonly ReplayedStep[];
  /** Every row the replay produced, in order — what the live log is diffed against. */
  readonly rows: readonly Row[];
  /** Reaches the recording could not answer. A replay with any of these is not evidence. */
  readonly unanswered: readonly Unanswered[];
  readonly marks: Marks;
}

export interface ReplayArgs {
  readonly load: LoadResult;
  readonly recording: Recording;
  readonly settings: Settings;
  /** Where the marks stood when the recording began. Empty is a session opening cold. */
  readonly marks?: Marks | undefined;
}

/**
 * Run a recording through the engine.
 *
 * It calls the SAME `guard`, `brief`, `afterCompaction` and `runRows` the live path calls — there
 * is no replay engine, only a replay caller, and that is the property being proved. A second
 * implementation here would make a green replay evidence about the replay rather than about the
 * guard.
 */
export async function replay({ load, recording, settings, marks = {} }: ReplayArgs): Promise<ReplayResult> {
  const steps: ReplayedStep[] = [];
  const rows: Row[] = [];
  const unanswered: Unanswered[] = [];
  let held: Marks = marks;

  for (const step of recording.steps) {
    if (step.rail === "compaction") {
      held = load.ok ? afterCompaction(held, load.entries) : held;
      const row: Row = { kind: "compaction" };
      rows.push(row);
      steps.push({ step, effects: [], rows: [row] });
      continue;
    }
    if (step.rail === "guard") {
      const outcome = await guard({
        load,
        event: {
          moment: step.moment,
          file: step.file,
          command: step.command,
          staged: step.staged,
          added: step.added,
          deleted: step.deleted,
          turn: step.turn,
          wearing: step.wearing,
        },
        world: cannedWorld(step.world ?? {}, step.staged, unanswered),
      });
      const made = runRows(step.moment, outcome, step.moment === "commit" ? (step.staged?.length ?? 0) : 1);
      rows.push(...made);
      steps.push({ step, effects: outcome.effects, rows: made });
      continue;
    }
    const briefing = brief({
      load,
      event: { moment: step.moment, path: step.path, command: step.command, wearing: step.wearing, tokens: step.tokens },
      marks: held,
      settings,
    });
    held = briefing.marks;
    const made = briefing.notices.length === 0 ? [] : runRows(step.moment, { effects: briefing.notices, tallies: [] }, 1);
    rows.push(...made);
    steps.push({ step, effects: briefing.notices, rows: made });
  }

  return { steps, rows, unanswered, marks: held };
}

/**
 * One difference between what a replay said and what the live log recorded.
 *
 * `side` is which stream the row is missing FROM, so a reader can tell "the replay invented a
 * block" from "the replay lost one" without holding both files open.
 */
export interface RowDiff {
  readonly side: "replay" | "live";
  readonly at: number;
  readonly row: string;
}

/**
 * The rows a replay and a live log disagree about — EMPTY is the proof.
 *
 * Only the two MECHANISM rows are compared, and that is not a softening: a replay has no tool
 * calls to record and no session to stamp a meta row for, so `tool`, `run` and `meta` are facts
 * about the live process rather than about the guard's judgement. What the recording claims is
 * that the same rules refuse the same subjects and the same notes show for the same causes, and
 * those are exactly the rows named here.
 */
export function diffRows(replayed: readonly Row[], live: readonly Row[]): RowDiff[] {
  const judgements = (rows: readonly Row[]): string[] =>
    rows
      .filter((row) => row.kind === "guardrail" || row.kind === "breadcrumb")
      .map((row) =>
        row.kind === "guardrail"
          ? `guardrail ${field(row, "moment") ?? ""} ${field(row, "id") ?? "—"} ${row["out"] as string} ${subjectOf(row) ?? ""}`.trim()
          : `breadcrumb ${field(row, "moment") ?? ""} ${field(row, "id") ?? "—"} ${field(row, "cause") ?? ""}`.trim(),
      );
  const mine = judgements(replayed);
  const theirs = judgements(live);
  const out: RowDiff[] = [];
  for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
    const a = mine[i];
    const b = theirs[i];
    if (a === b) continue;
    if (a !== undefined) out.push({ side: "replay", at: i, row: a });
    if (b !== undefined) out.push({ side: "live", at: i, row: b });
  }
  return out;
}

/**
 * A world that answers exactly as the one it wraps, and writes down every answer — the RECORDING
 * SEAM, and the reason a bug becomes a fixture before it becomes a fix.
 *
 * It is the live world's own answers that are kept, not a re-derivation: the file as it was at
 * that instant, the command's real exit code, the staged set git really had. Re-running the check
 * tomorrow against today's repo would answer differently, and a fixture that cannot reproduce
 * yesterday's block is not a fixture.
 *
 * `exec` answers are keyed by the EXACT command, because `cannedWorld` matches exactly before it
 * matches by containment: a recording is machine-written and has no reason to be approximate.
 */
export function recorder(world: World): { readonly world: World; readonly taken: () => CaseWorld } {
  const exec: Record<string, { stdout: string; stderr: string; code: number }> = {};
  const files: Record<string, string> = {};
  let gitDiff: string | undefined;
  let staged: string[] | undefined;
  return {
    world: {
      exec: async (command: string): Promise<ExecResult> => {
        const answer = await world.exec(command);
        exec[command] = { stdout: answer.stdout, stderr: answer.stderr, code: answer.code };
        return answer;
      },
      fs: {
        read: async (path: string): Promise<string> => {
          const text = await world.fs.read(path);
          files[path] = text;
          return text;
        },
        exists: async (path: string): Promise<boolean> => {
          const there = await world.fs.exists(path);
          // A path that IS there has to appear in the recorded map or the canned world will
          // answer "not there" on replay — and `exists` carries no content, so an empty string is
          // the honest placeholder until something reads it and overwrites this.
          if (there) files[path] ??= "";
          return there;
        },
      },
      git: {
        diff: async (path?: string): Promise<string> => {
          const text = await world.git.diff(path);
          gitDiff ??= text;
          return text;
        },
        stagedFiles: async (): Promise<string[]> => {
          const paths = await world.git.stagedFiles();
          staged = [...paths];
          return paths;
        },
      },
    },
    taken: (): CaseWorld => ({
      ...(Object.keys(exec).length > 0 ? { exec } : {}),
      ...(Object.keys(files).length > 0 ? { fs: files } : {}),
      ...(gitDiff === undefined ? {} : { gitDiff }),
      ...(staged === undefined ? {} : { staged }),
    }),
  };
}
