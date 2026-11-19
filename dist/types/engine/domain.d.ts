import { inScope, type Scope, type BreadcrumbMoment, type CaseWorld, type Category, type Ctx, type EntrySpec, type GuardrailMoment, type LoadResult, type LoadedEntry, type Moment, type SessionFacts, type ShellStart, type Settings, type TurnAction, type Unanswered, type World } from "../language/domain.ts";
import type { CommitFileFacts } from "../checks/domain.ts";
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
     * Host-sent agent types that ARE this category, decisively. Brief text is never consulted for a
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
     * True for the top-level session only — not spawned, no agent type. Structural, and exclusive: a
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
export declare function spawnedAs(recipe: SpawnRecipe): (facts: SessionFacts) => boolean;
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
export declare function categoriesIn(entries: readonly LoadedEntry[]): Category[];
/**
 * Who this session × agent is — the stored verdict if there is one, otherwise a fresh reading.
 *
 * STICKY, and that is a decision rather than a cache. A session's identity is settled by evidence
 * written when it was spawned, so re-deriving it every hook could only ever change the answer by
 * accident — a transcript since compacted, a brief scrolled away — and a rule that fired for the
 * first half of a session and not the second is worse than either outcome alone. The unit is
 * session × agent because that is what the evidence is about: each subagent has its own transcript
 * and its own agent id.
 */
export declare function identify(stored: readonly string[] | undefined, facts: SessionFacts, categories: readonly Category[]): Identity;
/**
 * One event the guardrail rails carry. Facts only — who it happened to is `wearing`.
 *
 * commit: `added`, `deleted` and `message` are the commit's facts (`CommitFileFacts`), the same a
 * case lists.
 */
export interface GuardEvent extends CommitFileFacts {
    readonly moment: GuardrailMoment;
    /** command: the line about to run. */
    readonly command?: string | undefined;
    /** command: the line's parse, when the caller already made it. Absent, the engine parses the line. */
    readonly commands?: Ctx["commands"];
    /** commit: the staged paths. Under `whole`, every file git lists. */
    readonly staged?: readonly string[] | undefined;
    /**
     * commit: the whole repo, with no commit — `flow hook commit --all`. Only a rule with `.on(…)` is
     * called, once for each file its globs match; `ctx.staged`, `ctx.added` and `ctx.deleted` are
     * empty and `ctx.message` is null. `added` still says which files the last commit lacks, for
     * each file's `existed`.
     */
    readonly whole?: boolean | undefined;
    /** turn-end: what the actor did this turn, in order. */
    readonly turn?: readonly TurnAction[] | undefined;
    /** Every category this session × agent wears. Empty means it wears none, not "all of them". */
    readonly wearing: readonly string[];
    /**
     * Where this event works outside the repository (`outsideOf`), by the name it already uses: a
     * command's `folder`. Absent, everything is inside, as in a case.
     */
    readonly outside?: readonly string[] | undefined;
}
/** One event the breadcrumb rails carry. A note has no rail to block, so it has no world either. */
export interface BriefEvent {
    readonly moment: BreadcrumbMoment;
    /** file-change: one file the tool call changed, relative to the working folder it changed in. Every other moment carries none, and narrows nothing. */
    readonly path?: string | undefined;
    /** command: the line about to run — what a command note's `on` is matched against. */
    readonly command?: string | undefined;
    readonly wearing: readonly string[];
    /** How far this session has drifted, in context tokens. The adapter measures it. */
    readonly tokens: number;
}
/** Does this entry fire at this moment at all? A disabled entry is inert and never does. */
export declare function fires(spec: EntrySpec, moment: Moment): boolean;
/**
 * Does this session wear what the entry binds to? An entry with no `.for(…)` binds to everyone.
 *
 * Absence means EVERY category, exactly as an absent `on` means every path — scoping is opt-in.
 * `.for(a, b)` ORs, so a rule for two rungs fires for a session wearing either of them.
 */
export declare function bindsTo(entry: LoadedEntry, wearing: readonly string[]): boolean;
export { inScope, type Scope };
/**
 * Does this entry's scope REACH this path — the coverage question, which is not the matching one.
 *
 * `inScope` answers "may this entry run here", and an entry with no `on` at all answers yes to
 * every path in the repo. That is right for matching and catastrophic for coverage: a commit gate
 * or a command ban would claim the whole tree, and every gap in it would disappear. Coverage is
 * only ever claimed by an entry that NAMES paths.
 */
export declare function covers(scope: Scope, path: string): boolean;
/**
 * The entries that can claim coverage of anything — live, and naming paths.
 *
 * ONE spelling, because three surfaces ask it and they must agree: the gap list, the terrain's
 * per-node answer, and the transcript-side reading of areas nobody watches. They were spelled
 * three ways for one commit, and a set that differs by a disabled entry is a folder that reads as
 * guarded on one page and abandoned on the next.
 */
export declare function watching(entries: readonly Bound[]): Bound[];
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
/**
 * Why a breadcrumb is showing. Closed, and every recorded row carries one of these words: `session`
 * at a session's start, `first` the first time its moment happened for the agent, `drift` once the
 * context has grown by `driftTokens` since, and `fault` for the load error.
 */
export declare const CAUSES: readonly ["session", "first", "drift", "fault"];
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
    /** The moment that showed it. Absent on the load error, which no moment showed. */
    readonly moment?: BreadcrumbMoment | undefined;
    /**
     * What the event that showed it was about: the repo-relative path, or the command line, as a
     * guardrail row's subject is. Absent when the event carries no file or command, such as a
     * session note or a fault.
     */
    readonly subject: string | undefined;
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
/**
 * One block from the guard itself rather than from any rule. `entry: null` is how a reader tells
 * this from a rule refusing. The adapter raises the same shape for a broken config, so this is the
 * one home the canonical block wears — a field added here reaches both callers.
 */
export declare function fault(message: string): Block;
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
export declare function guard({ load, event, world, faults, off }: GuardArgs): Promise<Outcome>;
/** Entry id → the context size, in tokens, at which it was last shown. */
export type Marks = Readonly<Record<string, number>>;
/** How far a session drifts before a note is worth showing again. The old engine's number, kept. */
export declare const DEFAULT_DRIFT_TOKENS = 200000;
/** The threshold in force: the config's dial, or the default. */
export declare function driftTokens(settings: Settings): number;
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
 * A breadcrumb shows once, and is MARKED where it showed: a `session` one at the session moment,
 * so a resume that keeps the session does not say it again, and any other at its own moment.
 */
export declare function brief({ load, event, marks, settings, off }: BriefArgs): Briefing;
/**
 * One block, as the hook prints it.
 *
 * The entry's id is the WHOLE address — there is no second naming scheme to print beside it, which
 * is the visible half of the old string routes dying. A reader who sees `core.noTodo` can open the
 * config, find that property, and be looking at the sentence that refused them.
 */
export declare function formatBlock(block: Block): string;
/** Every block in one outcome, as one message. Empty when nothing refused. */
export declare function formatBlocks(effects: readonly Effect[]): string;
/** flow's state directory, relative to a repo root. The one spelling. */
export declare const FLOW_DIR = ".flow";
/** What makes the directory invisible to git — `*` covers the ignore file itself. */
export declare const FLOW_GITIGNORE = "# flow's own state \u2014 telemetry and session marks, never committed.\n*\n";
/** The log schema this build writes, stamped into every session file's first row. */
export declare const LOG_VERSION = 2;
/**
 * Every kind a log row may be. Closed — a reader that meets another word has met corruption.
 *
 * `read` is what went ROUND the tool rows: a file a shell command read by name. A `tool` row says a
 * call happened; this says what it touched, so the coverage numbers count work done through the
 * shell as well as through Read. `change` is the files a call changed, from git's list of changed
 * paths, whichever tool changed them.
 */
export declare const ROW_KINDS: readonly ["meta", "tool", "breadcrumb", "guardrail", "compaction", "run", "read", "change"];
export type RowKind = (typeof ROW_KINDS)[number];
export declare function flowDir(root: string): string;
/** A session id becomes a filename, so it is held to a filename's charset. */
export declare function sanitise(session: string): string;
/** One session's event stream. */
export declare function logFile(root: string, session: string): string;
/** One session × agent's own state: the categories it wears, its breadcrumb marks, and the paths git last listed as changed in each working folder. */
export declare function statePath(root: string, session: string, agent: string): string;
/**
 * What git lists as changed in one working folder, at one moment: the commit it has out, and a hash
 * of the content of each listed path. A path git ignores is not listed, and a deleted one holds
 * `DELETED`. Nothing else of a file is kept.
 */
export interface Tree {
    /** The commit the folder has out, or null before the first commit. */
    readonly head: string | null;
    /** Repo-relative path → hash of its content. */
    readonly files: Readonly<Record<string, string>>;
}
/** What a listed path holds when the file is gone. */
export declare const DELETED = "-";
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
    /**
     * What git listed as changed in each working folder the last time this agent looked, by the
     * folder's absolute path: the "before" of its next call. No file content is kept, only a hash.
     * Absent means no folder has been looked at yet.
     */
    readonly trees?: Readonly<Record<string, Tree>> | undefined;
    /**
     * A subagent's session notes, held at its start until its brief can be read, and judged at its
     * first tool call that runs. Absent means nothing is held.
     */
    readonly heldForBrief?: true | undefined;
}
/**
 * A state file's text → the state. Corrupt, empty or absent all mean the same thing: nothing known.
 *
 * FAILING SAFE HERE IS CORRECT, and it is the one place in flow where that is true. State is a
 * de-duplication convenience: losing it re-shows a breadcrumb and re-reads a classification, which
 * is the harmless direction. A guard that refused to run because a marks file had a stray byte
 * would be failing loud about the one thing that does not matter.
 */
export declare function readState(text: string | null | undefined): SessionState;
/**
 * How long a state file's lock may be held before it is taken for a dead hook's. A hook holds it for
 * the milliseconds it takes to read and write one small file, so ten seconds is a process that was
 * killed between taking it and letting go.
 */
export declare const LOCK_STALE_MS = 10000;
/** Is a lock this old a dead hook's? `ageMs` is an argument because a clock inside a decision cannot be tested. */
export declare function lockIsStale(ageMs: number): boolean;
/** The lock beside one state file: a folder, because making one is atomic and fails when it exists. */
export declare function lockPath(root: string, session: string, agent: string): string;
/**
 * The marker that tells the commit gate which live session this worktree's commit belongs to.
 *
 * The BRANCH is in the name, and it has to be: the gate runs inside git's commit-msg hook, outside
 * any session, and two worktrees committing at once must not clobber each other's answer and
 * mis-attribute a commit. A worktree IS a branch — git refuses to check one out twice — so the
 * branch is a safe key. It also keeps the scheme working the day a repo points several checkouts at
 * one shared state directory, which is why it survived the move out of the journal.
 */
export declare function markerPath(root: string, branch: string | null): string;
/**
 * The kill switch: an existence-file, unchanged from the old engine.
 *
 * Its whole value is that turning the guard off needs no settings surgery, so an A/B run is one
 * `touch` and one `rm`. It sits beside the state rather than in the repo, which makes it
 * project-wide rather than per-worktree — "is the guard on here" is a question about the project.
 */
export declare function offPath(root: string): string;
/**
 * The RECORDING switch, and it is an existence-file for the same reason the kill switch is.
 *
 * Turning capture on is one `touch` and turning it off is one `rm`, with no settings surgery and
 * no flag to remember on a hook the harness invokes rather than you. That matters more here than
 * for `off`: recording is what you reach for the moment something misbehaves, and a mechanism that
 * needs a config edit is one nobody arms in time to catch the bug they were looking at.
 */
export declare function recordPath(root: string): string;
/** One session's recording — the canonical event stream, beside the log it should agree with. */
export declare function recordingFile(root: string, session: string): string;
/**
 * Where a repo remembers which conversations the archival side has already read.
 *
 * One empty file per conversation, so EXISTENCE is the whole fact and there is nothing to keep in
 * step. It lives here with every other `.flow/` path for the reason this section exists at all:
 * the old engine spelled one state path two ways and the disagreement was invisible in exactly the
 * direction that hurts — a reader looking in the wrong place reports "nothing read yet" rather
 * than an error, and silently re-offers a year of history.
 */
export declare function readDir(root: string): string;
/** The marker for one conversation. Sanitised, because a stray id must never escape the folder. */
export declare function readMarkPath(root: string, session: string): string;
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
    /** The type that agent was started as, for the commit gate's log rows. Absent on `main`. */
    readonly agentType?: unknown;
    readonly ts?: unknown;
}
/**
 * The agent one row, marker or call came from: the key its state is stored under, and its type.
 *
 * One value rather than two loose ones, because the type means nothing without the id it belongs to.
 */
export interface AgentOf {
    /** `main` for the session itself, a subagent's `agent_id`, or `commit`: see `UNNAMED_COMMIT`. */
    readonly agent: string;
    /** The type the subagent was started as, when the host said. Never beside `main` or `commit`. */
    readonly agentType?: string;
}
/**
 * The agent a commit-gate run's rows name when no agent can be named: no marker, a stale one, or
 * one written before markers held the agent. `commit` is also the stream such a commit's rows land
 * in when no session claims it.
 */
export declare const UNNAMED_COMMIT: AgentOf;
/**
 * An agent named by an id and, maybe, a type — the one reading of the pair, wherever it is read
 * from: a hook message's `agent_id` and `agent_type`, or a marker's `agent` and `agentType`.
 *
 * Null when the id is not a non-empty string, and the type counts only beside such an id, because a
 * type means nothing without the agent it belongs to.
 */
export declare function namedAgent(id: unknown, type: unknown): AgentOf | null;
/** A commit long after the last edit is not this session's. */
export declare const MARKER_MAX_AGE_MS: number;
/** Who a commit-gate run belongs to: the live session, and which of its agents was working. */
export interface Attribution {
    readonly session: string;
    /** Null when the marker named no agent — an old marker, or a run with nobody to attribute to. */
    readonly who: AgentOf | null;
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
export declare function attribution(marker: SessionMarker | null | undefined, fallback: string, nowMs: number, maxAgeMs?: number): Attribution;
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
export declare function nextSeq(tail: string): number;
/** One line of the log. Loose by necessity: it is read off disk, from a file a human can open. */
export interface Row {
    readonly kind: RowKind;
    readonly [key: string]: unknown;
}
/** The first row of every session file: who this stream is, and which build wrote it. */
export declare function metaRow(session: string, branch: string | null, worktree: string, startedAt: string, harness?: string): Row;
/**
 * One summary row per engine invocation, and one row per rail that spoke.
 *
 * A block is a `guardrail` row with `out: "deny"` and never a row of its own. Two rows for one
 * event meant every reader had to know which of them to count, and every block was in the log
 * twice — the old engine's mistake, not repeated here.
 */
export declare function runRows(moment: Moment, outcome: Outcome, subjects: number): Row[];
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
export declare function universe(entries: readonly LoadedEntry[]): Bound[];
/** The lead distribution's buckets, coarse on purpose — the shape matters, the exact number does not. */
export declare const LEAD_BUCKETS: readonly ["0", "1-5", "6-19", "20+"];
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
    readonly lastBlock: {
        readonly ts: string | null;
        readonly subject: string | null;
    } | null;
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
export declare function insideRepo(path: string): boolean;
/**
 * What a row was about, in the order the row kinds spell it.
 *
 * A mechanism row (`runRows`) states its `subject` — the path or the command line the entry was
 * run against — and a tool row states the call's own `path` or `command`. One reader over both,
 * because "what was this row about" is one question and the metrics ask it of every kind.
 */
export declare function subjectOf(row: Row): string | null;
/**
 * Did this row record a file being CHANGED by an edit tool? `change` rows say it for every tool; this
 * is how a log written before them says it.
 *
 * It reads a flag the ROW carries rather than a set of tool names, and that is the seam holding:
 * which of a harness's tools change a file is harness knowledge, so the adapter decides it once
 * when it writes the row and the engine — which may never know what a `MultiEdit` is — reads the
 * answer. The old engine kept a tool-name set in its metrics layer, and a second, already-drifted
 * copy in a rule; a fact about somebody else's tool names belongs on the far side of the seam.
 */
export declare function isEdit(row: Row): boolean;
/**
 * The whole reading, from the rows and the bindings they are judged against.
 *
 * `entries` is the universe as it stands today; `sessions` is every stream being read. The two
 * together are the only inputs, and there is no clock inside — `nowMs` is an argument, because a
 * judgement about how long something has been quiet is a decision and a decision must be testable.
 */
export declare function metrics({ sessions, entries, nowMs, minSessions, minDays }: MetricsArgs): Metrics;
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
export declare function terrain({ paths, heat: recorded, entries }: TerrainArgs): TerrainNode[];
/** The moments, in the order the moments page lists them: the two a guardrail refuses at, then the breadcrumb's. */
export declare const MOMENT_ORDER: readonly Moment[];
/** One entry as a moments view draws it: the binding, plus what it has done. */
export interface MomentEntry extends Bound {
    readonly record: BreadcrumbRecord | GuardrailRecord | null;
}
export interface MomentsView {
    readonly moments: readonly {
        readonly moment: Moment;
        readonly entries: readonly MomentEntry[];
    }[];
    readonly totals: {
        readonly breadcrumbs: number;
        readonly guardrails: number;
        readonly disabled: number;
    };
}
/** The universe arranged by moment, each entry carrying whatever the record says about it. */
export declare function momentsView(entries: readonly Bound[], recorded?: Metrics | null): MomentsView;
/** The recording format this build writes and reads. */
export declare const RECORDING_VERSION = 1;
/**
 * One engine invocation, as it happened.
 *
 * `world` is what the checks reached for during that step, and its absence is not an empty world —
 * it is a step whose checks reached for nothing. An unanswered reach at replay time is REPORTED
 * rather than guessed at, which is `cannedWorld`'s own rule and the reason it is the one builder.
 */
export type RecordedStep = {
    readonly rail: "guard";
    readonly moment: GuardrailMoment;
    readonly command?: string | undefined;
    readonly staged?: readonly string[] | undefined;
    readonly added?: GuardEvent["added"];
    readonly deleted?: GuardEvent["deleted"];
    readonly whole?: GuardEvent["whole"];
    readonly message?: GuardEvent["message"];
    readonly turn?: readonly TurnAction[] | undefined;
    readonly wearing: readonly string[];
    readonly world?: CaseWorld | undefined;
    /** Where the step worked outside the repository; with it, where a command line started, which its folders are followed from. */
    readonly outside?: GuardEvent["outside"];
    readonly start?: ShellStart | undefined;
} | {
    readonly rail: "brief";
    readonly moment: BreadcrumbMoment;
    readonly path?: string | undefined;
    readonly command?: string | undefined;
    readonly wearing: readonly string[];
    readonly tokens: number;
}
/** The host compacted: every mark is cleared. */
 | {
    readonly rail: "compaction";
};
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
export declare function readRecording(text: string, fallback?: string): Recording;
/** The header line a recording opens with — who this stream is, and which build wrote it. */
export declare function recordingHeader(session: string): Record<string, unknown>;
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
 * It calls the SAME `guard`, `brief` and `runRows` the live path calls — there
 * is no replay engine, only a replay caller, and that is the property being proved. A second
 * implementation here would make a green replay evidence about the replay rather than about the
 * guard.
 */
export declare function replay({ load, recording, settings, marks }: ReplayArgs): Promise<ReplayResult>;
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
 * that the same rules refuse the same subjects and the same notes show for the same causes and
 * files, and those are exactly the rows named here.
 */
export declare function diffRows(replayed: readonly Row[], live: readonly Row[]): RowDiff[];
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
export declare function recorder(world: World): {
    readonly world: World;
    readonly taken: () => CaseWorld;
};
