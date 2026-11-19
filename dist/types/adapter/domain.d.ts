import { type BreadcrumbMoment, type Ctx, type EntrySpec, type ExecResult, type GuardrailMoment, type LoadedEntry, type LoadResult, type Moment, type Refusal, type SessionFacts, type Settings, type ShellStart, type ShellStep, type TurnAction } from "../language/domain.ts";
import { type AgentOf, type Block, type Cause, type Bound, type Marks, type Metrics, type Notice, type MomentsView, type Row, type TerrainNode, type Tree } from "../engine/domain.ts";
import type { Delivered, HarnessFacts, HookPayload, HookResult, Registering, Spawn, SpawnMeta, Steer, TranscriptEvent } from "./harness.ts";
/**
 * The one file that turns anything on, spelled ONCE.
 *
 * It lives in the pure home rather than in the shell that opens it because three things name it
 * and only one of them is a read: the shell looks for it, the CLI defaults to it, and the list of
 * files that ARE the guard here has to include it. A second spelling in that list would leave a
 * renamed config's old name watched and its new one not.
 */
export declare const CONFIG_FILE = "flow.config.ts";
/**
 * Every relative module the config names, READ OUT OF ITS TEXT.
 *
 * A regex over source, deliberately, and it is the only reader that can work here: this is asked
 * about a file that may not import, so anything that had to resolve, parse or evaluate it would
 * be asking the broken thing to answer for itself. A line like `import { house } from
 * "./guards/house.ts";` survives almost every way a config breaks, because what breaks a config is
 * a missing `.message(…)` or a stray brace two hundred lines below its imports.
 *
 * Only `./…` and `../…` count. A bare specifier is a package — `@jawache/flow`, or a pack somebody
 * published — and a package is not this repo's source. A `..` segment climbs out of the root, so
 * those are dropped too: the config sits at the repo root and `guardPaths` is repo-relative or it
 * is nothing. A leading dot in a FOLDER name is ordinary and is kept — `./.guard/house.ts` is a pack
 * like any other.
 *
 * A `from '…'` phrase inside a QUOTED STRING is harvested as well — a rule whose `.message(…)`
 * spells an import line puts that path among the guard's files though no import named it. ACCEPTED, not
 * overlooked: telling a real import from a sentence quoting one takes a parser, and a parser is
 * the one thing a file that will not parse cannot give. The cost is bounded and one-directional —
 * the list only ever WIDENS, so the worst it does is report one extra path as a guard file.
 */
export declare function configImports(configText: string): readonly string[];
/**
 * Whatever the host put there, as a string — a payload field is JSON and may be anything.
 *
 * A scalar is stringified and everything else is EMPTY, never `[object Object]`: an object where a
 * path was expected is not a path, and a guard that judged a file called `[object Object]` would be
 * asserting something about a file that cannot exist. Empty is falsy, so every caller's own
 * "nothing to judge" branch catches it.
 */
export declare function text(value: unknown): string;
/**
 * One event in the engine's vocabulary, minus the two things the engine's own event types demand
 * and this file cannot know: who the session is (`wearing`, which needs the transcript and the stored
 * verdict) and how far it has drifted (`tokens`, which needs the transcript). The shell adds both,
 * because both come off disk.
 */
export type AdapterEvent = {
    readonly rail: "guard";
    readonly moment: GuardrailMoment;
    readonly command?: string | undefined;
    /** command: the line's parse, made once here and handed to the engine with the line. */
    readonly commands?: Ctx["commands"];
    /** command: where the line started, which the parse followed each command's folder from. */
    readonly start?: ShellStart | undefined;
    readonly turn?: readonly TurnAction[] | undefined;
} | {
    readonly rail: "brief";
    readonly moment: BreadcrumbMoment;
    /** file-change: one file the call changed, relative to the working folder it changed in. */
    readonly path?: string | undefined;
    readonly command?: string | undefined;
};
/** An event for the breadcrumb rail. */
export type BriefAdapterEvent = Extract<AdapterEvent, {
    readonly rail: "brief";
}>;
/** An absolute path inside the repo → the repo-relative spelling every glob is written against. */
export declare function relativise(path: string, root: string): string;
/**
 * Git's answer as paths, one per line — the plainest shape git has, and the only one flow parses.
 *
 * ONE reader for it in the adapter: `flow status` asks git what it ignores and the realWorld asks
 * for the staged set, and both used to split, trim and drop blank lines under two names. `null` is
 * a command that never ran, and it is no paths.
 */
export declare function pathLines(stdout: string | null): string[];
/**
 * What a commit changes, in the shape the commit gate judges: the files it will hold, which of
 * those the last commit does not have, and the files it removes. A rename is a removal of the old
 * path plus an add of the new one, so it needs no shape of its own.
 */
export interface StagedChanges {
    /**
     * The subjects of a file rule: every path the commit will hold that it changes, or under `--all`
     * every file git lists.
     */
    readonly files: readonly string[];
    /** The `files` the last commit does not have. Undefined when git could not say. */
    readonly added: readonly string[] | undefined;
    /** The paths the last commit has and this one will not. */
    readonly deleted: readonly string[];
}
/**
 * The staged changes, read from `git diff --cached --name-status --no-renames -z`.
 *
 * ONE question to git, and every staged change comes back with what it is: `A` added, `D` deleted,
 * anything else changed in place. `--no-renames` splits a rename into the delete and the add it is.
 */
export declare function stagedChanges(nameStatus: string): StagedChanges;
/**
 * The whole tree, for `flow hook commit --all`, against the last commit's own list.
 *
 * `present` is every file git lists that is on disk; `tree` is `git ls-tree -r --name-only -z
 * HEAD`. It fails in two ways that answer differently. Before the first commit there is no HEAD, so
 * every file is new. Any other failure is unknown: `added` stays undefined, so a check asks the
 * disk and refuses rather than allows. There is no commit, so nothing is deleted.
 */
export declare function treeChanges(present: readonly string[], tree: ExecResult, hasHead: () => boolean): StagedChanges;
export declare const ALLOW: HookResult;
/** One refusal, with the rail that made it — the banner is the moment's, not the hook's. */
export interface Refused {
    readonly moment: GuardrailMoment;
    readonly block: Block;
}
/** `a`, `a and b`, `a, b and c` — a list of paths as a sentence reads them. */
export declare function listed(paths: readonly string[]): string;
/**
 * Every refusal as the one thing a refusal is, or null when nothing refused.
 *
 * It takes NO hook, and that is the point of it existing beside `toResult`: the commit gate is not
 * a hook at all — git spawns it — so rendering its refusals through a hook-shaped function meant
 * naming an event that never happened. The banner comes off the MOMENT, which every rail has,
 * rather than off the event, which only the harness ones do.
 */
export declare function refused(refusals: readonly Refused[]): HookResult | null;
/**
 * The branch a worktree has out, from the text of its own `HEAD` — the session marker's key.
 *
 * A ref name, or the short sha when HEAD is detached, or null when there is nothing there. It is
 * read as a FILE rather than asked of `git`, and at this frequency that matters: the marker is
 * written on every tool call, and a subprocess per keystroke is a cost this answer does not justify.
 * It is also the only form that answers on an unborn branch, where `git rev-parse HEAD` fails
 * outright — which is every repo's own first commit.
 */
export declare function branchFromHead(head: string): string | null;
/**
 * The variables git exports into a hook's environment, which REDIRECT any nested `git` command back
 * at the parent repo — a `git init` in a temp directory would suddenly write the real index.
 *
 * The commit gate runs inside git's commit-msg hook and inherits every one of them, so a check that
 * shells out (a test suite, a type-checker, dependency-cruiser writing a temp config) would run
 * inside the in-progress commit unless they are stripped. It was one rule script's own business in
 * the old engine; it is the adapter's now, because `ctx.exec` is the one door and this is a fact
 * about the world on the other side of it.
 */
export declare const GIT_HOOK_ENV: readonly string[];
/**
 * Does this command read the index the commit is being made from? Only `git diff --cached` does: it
 * is the one read a check makes of what the commit holds, and under `git commit -a` or `git commit
 * <path>` that index is a temporary one that only `GIT_INDEX_FILE` names. Any other command stays
 * hermetic.
 */
export declare function readsCommitIndex(command: string): boolean;
/** The environment a check's command should see: this one, minus git's hook plumbing. */
export declare function hermeticEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined>;
/** Text with terminal colour codes taken out — a recorded command line is full of them. */
export declare function strip(value: unknown): string;
/**
 * ONE definition of "make this printable and short": strip ANSI, collapse whitespace, cut to `n`
 * — and MARK the cut, because a truncated command with no ellipsis reads as a whole one, and every
 * surface that shows these strings claims to be showing what really happened.
 */
export declare function snip(value: unknown, n?: number): string;
/**
 * `snip`, cut at the last whole word: a rule's text in the status page is never cut in the middle of
 * a word, so the page reads "…is text…" and never "…is text s…".
 */
export declare function snipAtWord(value: unknown, n: number): string;
/** Does this prompt read as the human pushing back? */
export declare function isCorrection(prose: string): boolean;
/**
 * The tools a repo's justfile actually drives — what a direct invocation would be bypassing.
 *
 * Each recipe's body is read through the parse as one script, so a loop or an `if` that spans its
 * lines is read whole; a body that does not parse whole is read line by line, and a line that does
 * not parse names nothing. Just's own `@` and `-` line prefixes are dropped first.
 */
export declare function recipeTools(justfile: string): string[];
/** What one Bash line was: the recipes it drove, the tools it went round, and whether it committed. */
export interface BashClass {
    readonly recipes: readonly string[];
    readonly bypasses: readonly string[];
    readonly commits: boolean;
}
/**
 * Read one command line against the repo's own recipe tools, from its parse. A heredoc's body is
 * text the command is fed, so a file being written that names a tool is not a run of it — while
 * the line around the heredoc is judged like any other, and so is a body a shell runs. A line that
 * does not parse is nothing: no recipe, no bypass, no commit.
 */
export declare function classifyBash(command: unknown, tools: readonly string[]): BashClass;
/** A pointer into a transcript — the shape every heuristic finding takes. */
export interface Pointer {
    readonly line: number;
    readonly text: string;
    /** Which transcript, once several are merged into one report. */
    readonly session?: string;
}
export interface Bypass extends Pointer {
    readonly tool: string;
}
/** The same file edited over and over — a loop somebody was stuck in. */
export interface EditLoop {
    readonly path: string;
    readonly count: number;
    readonly from: number;
    readonly to: number;
    readonly session?: string;
}
/** The same command run again and again — something that would not come right. */
export interface Retry {
    readonly command: string;
    readonly count: number;
    readonly lines: readonly number[];
    readonly session?: string;
}
export interface Narrative {
    readonly stats: {
        readonly edits: number;
        readonly writes: number;
        /** Files a Bash command read by name. */
        readonly shellReads: number;
        readonly commits: number;
        readonly recipes: Readonly<Record<string, number>>;
        readonly bypasses: Readonly<Record<string, number>>;
    };
    readonly prompts: readonly Pointer[];
    readonly corrections: readonly Pointer[];
    readonly bypassSites: readonly Bypass[];
    readonly loops: readonly EditLoop[];
    readonly retries: readonly Retry[];
    /** The files a shell command read by name, with how often each. */
    readonly shell: {
        readonly reads: Readonly<Record<string, number>>;
    };
    /** Every in-repo file the session touched, with how often. The facts layer scores coverage. */
    readonly touched: Readonly<Record<string, number>>;
}
/**
 * The narrative reading of one conversation. Everything here is a guess with a citation.
 *
 * `tools` is INJECTED — the shell reads the justfile — so the same call is reproducible from a
 * fixture, which is the same discipline the guard itself is built on.
 *
 * Shell READS come from the transcript, like every Read does, so they are counted in every
 * conversation. A transcript says what command ran, never what it changed, so a shell write is not
 * counted.
 */
export declare function narrative(events: readonly TranscriptEvent[], tools?: readonly string[]): Narrative;
/**
 * Every narrative reading merged into one, each pointer tagged with the transcript it came from.
 *
 * The report is ONE aggregate whether it read one conversation or a hundred — the flags only
 * re-scope which sessions it covers, never its shape — so this is where the per-session readings
 * stop being chapters and become one list somebody can work down.
 */
export declare function mergeNarratives(each: readonly {
    session: string;
    read: Narrative;
}[]): Narrative;
/**
 * Every file that decides what the guard does here: the config and the packs it imports, then the
 * host's half. `weakenedAfterBlock` reads it — "a rail refused, and then somebody edited the guard".
 *
 * The repo's half is READ OUT OF THE CONFIG'S TEXT (`configImports`) rather than resolved, so it
 * answers the same whether or not the config loads, and it follows whatever a repo called its pack
 * folder — no folder name is spelled into the engine.
 *
 * The FOLDER of each imported pack comes with the file, which is the one deliberate widening. A
 * pack imports its own helpers, and those the config never names. The import graph cannot be
 * walked from text, so the folder is the honest approximation.
 */
export declare function guardPaths(configText: string | null, hostSurface: readonly string[]): readonly string[];
/** Is this one of the files that decides what the guard does? */
export declare function isGuardPath(path: string, paths: readonly string[]): boolean;
/** A block, and the guardrail edit that followed it. A POINTER, never an accusation. */
export interface Weakening {
    readonly entry: string | null;
    readonly line: number;
    readonly path: string;
    readonly gapSeconds: number;
}
/**
 * A rail refused, and then somebody edited the guard — flagged, with both ends cited.
 *
 * The edit may be perfectly legitimate authoring, which is exactly why this reports a POINTER and
 * lets a person read the two spots. What it cannot do is stay quiet: "the rule blocked me, so I
 * changed the rule" is the one failure mode a guard cannot catch itself.
 */
export declare function weakenedAfterBlock(rows: readonly Row[], events: readonly TranscriptEvent[], paths: readonly string[]): Weakening[];
/** One transcript, as the selector needs it: enough to order by, and nothing it has to open. */
/**
 * Does a transcript recorded in `cwd` belong to the repo at `root`? Yes when it started in `root` or
 * inside it, and not inside another worktree nested under `root`, such as `.claude/worktrees/x`: that
 * worktree's sessions are its own. A transcript that names no folder is kept, as it always was.
 * `nested` is every other worktree of the repository that lies under `root`.
 */
export declare function belongsToRepo(cwd: string | null, root: string, nested: readonly string[]): boolean;
export interface Candidate {
    readonly id: string;
    readonly bytes: number;
    readonly mtimeMs: number;
    /** When the conversation began, as the host stamped it. Preferred over the file's mtime. */
    readonly started: string | null;
    readonly branch: string | null;
}
export interface SelectOpts {
    /** Analyse only the first N in order. The rest resurface next time. */
    readonly limit?: number | null | undefined;
    /** Ignore the limit. */
    readonly all?: boolean | undefined;
    /** Order heaviest-first — wasted effort concentrates in the token-heavy conversations. */
    readonly largest?: boolean | undefined;
    /** A date floor, in ms. */
    readonly since?: number | null | undefined;
}
export interface Selection {
    readonly analyse: readonly Candidate[];
    readonly excluded: readonly {
        readonly id: string;
        readonly reason: "limit" | "since";
    }[];
    readonly counts: {
        readonly backlog: number;
        readonly analysed: number;
        readonly excluded: number;
    };
}
/** The backlog, ordered and narrowed — and an honest account of what was left out, and why. */
export declare function selectSessions(candidates: readonly Candidate[], done: ReadonlySet<string>, opts?: SelectOpts): Selection;
export interface Health {
    /** The record cannot be believed at all, and this says why. Nothing below it should be read. */
    readonly blocked: string | null;
    /** It can be believed with a caveat, and here they are. */
    readonly warn: readonly string[];
}
export interface HealthArgs {
    /** Does this repo have a recorded history at all? */
    readonly armed: boolean;
    /** Did the sessions being read record anything? */
    readonly rows: number;
    /** How many of the conversations being read had a stream of their own. */
    readonly withRecord: number;
    readonly analysed: number;
}
/** What a reader must know before believing anything under it. */
export declare function health({ armed, rows, withRecord, analysed }: HealthArgs): Health;
/**
 * One spawned actor, as the two host-written records agree on it — THE join, at its consumer.
 *
 * The sidecar says what a spawn WAS (`agentType`, unforgeable, written by the host) and the
 * parent's own `Agent` block says when it happened and what was asked for. Joining them on
 * `toolUseId` names an actor for cost attribution, after the fact: a builder spawned under a
 * generic bucket is `general-purpose` in the parent's claim and `builder` in the host's record,
 * and only one of those is evidence. A live session is classified from its hook message instead.
 */
export interface SpawnRecord {
    /** The conversation that spawned it. */
    readonly session: string;
    /** The harness's id for the subagent. */
    readonly agent: string;
    /** The host's answer. Null when the sidecar was absent or would not parse: spawned, as what unknown. */
    readonly agentType: string | null;
    readonly description: string | null;
    readonly model: string | null;
    /** What the PARENT asked for. Null when the two records could not be joined. */
    readonly asked: string | null;
    readonly at: string | null;
    /** Where in the parent's transcript to look. Null when unjoined. */
    readonly line: number | null;
}
/** One subagent's two records, joined. An unjoinable sidecar still yields what it alone knows. */
export declare function joinSpawn(args: {
    readonly session: string;
    readonly agent: string;
    readonly meta: SpawnMeta | null;
    readonly spawns: ReadonlyMap<string, Spawn>;
}): SpawnRecord;
/** An area the conversations worked in that no entry's globs reach. */
export interface Uncovered {
    readonly path: string;
    readonly touches: number;
}
/**
 * The files a conversation touched that nothing was watching — coverage read from the TRANSCRIPT.
 *
 * It is not a duplicate of the record's own gap list and the difference is the whole point: the
 * rows can only answer for sessions flow was installed for, and the store holds every conversation
 * this repo has ever had. A session with no record at all still says where the work went, which is
 * exactly the reading a repo wants on the day it adopts flow — and the day after, when it wants to
 * know whether the entries it just bound point anywhere near it.
 */
export declare function uncoveredAreas(touched: Readonly<Record<string, number>>, entries: readonly Bound[]): Uncovered[];
/** The permission mode the last recorded call was made under, or null when no row states one. */
export declare function lastMode(rows: readonly Row[]): string | null;
/** The permission modes the read conversations ran under, and how many of them auto mode steered. */
export interface Modes {
    /** Recorded calls per permission mode. */
    readonly calls: Readonly<Record<string, number>>;
    /** Conversations whose transcript last stood in auto mode. */
    readonly auto: number;
    /** Of those, the ones steered towards shell edits, and by which variant. */
    readonly steered: number;
    readonly variants: Readonly<Record<string, number>>;
}
/** Each conversation's rows and steer, added up. */
export declare function modesOf(each: readonly {
    readonly rows: readonly Row[];
    readonly steer: Steer | null;
}[]): Modes;
/**
 * The recorded sessions that a transcript stands behind, and the ids of those left out.
 *
 * A log with no conversation behind it is not a session someone had: a replay script writes one for
 * every command it feeds the hook. `transcribed` is every conversation of this repo a store holds, or null
 * when there is none to compare with, which keeps every log rather than dropping the lot.
 */
export declare function backedByTranscript<T extends {
    readonly session: string;
}>(history: readonly T[], transcribed: ReadonlySet<string> | null): {
    readonly kept: readonly T[];
    readonly excluded: readonly string[];
};
export interface Facts {
    /** What the harness is called in a sentence. */
    readonly host: string;
    readonly root: string;
    readonly store: {
        readonly dir: string;
        readonly exists: boolean;
        readonly ignored: readonly string[];
    };
    /** Which conversations this run covers, and which it deliberately deferred. */
    readonly selection: Selection;
    readonly coverage: {
        readonly analysed: number;
        readonly withRecord: number;
        readonly narrativeOnly: number;
    };
    /** The ids of recorded sessions left out of every number below because no transcript stands behind them. */
    readonly withoutTranscript: readonly string[];
    /** The fail-loud header. Read it before believing anything else here. */
    readonly health: Health;
    /**
     * The numbers, over the repo's WHOLE recorded history — deliberately not narrowed to the
     * selection. A dead scope and a lead distribution are lifetime questions, and scoping them to
     * one backlog would make a quiet week look like a retirement case.
     */
    readonly metrics: Metrics;
    readonly moments: MomentsView;
    readonly terrain: readonly TerrainNode[];
    /** The heuristic pointers, one list, each row tagged with the conversation it came from. */
    readonly narrative: Narrative;
    /** Where the conversations worked that nothing watches — the transcript's own coverage answer. */
    readonly uncovered: readonly Uncovered[];
    /** Every actor the read conversations spawned, both host-written records joined. */
    readonly actors: readonly SpawnRecord[];
    /** A rail refused, and then somebody edited the guard. A pointer, never an accusation. */
    readonly weakened: readonly Weakening[];
    /** The permission modes the read conversations ran under, and the auto-mode steer. */
    readonly modes: Modes;
    /** How many conversations were marked read, when asked for. Null when not asked. */
    readonly marked: number | null;
}
/**
 * The reading, as the lines a person reads. The whole of what `flow facts` prints.
 *
 * It is here rather than in the CLI shell on this repo's own standing precedent (927ca62, the
 * guard status report): a report's text is a pile of branches — is it armed, is the history ample,
 * did anything go quiet, was the guard edited after it refused — and every one of those branches
 * is a judgement about what a reader most needs to know. In a shell they are untestable, and the
 * one that matters most is the one that fires least.
 */
export declare function formatFacts(facts: Facts): string[];
/**
 * The node version flow's config loader needs, and why it is a floor rather than a preference.
 *
 * A `flow.config.ts` is TypeScript and is loaded by node's own type stripping — there is no
 * transpile step and there will not be one, because a guard that compiles its own config is a guard
 * with a build to go wrong. Stripping is flag-free from node 24 (the Active LTS), so that is the
 * floor `engines` states and the number this sentence names.
 */
export declare const NODE_FLOOR = 24;
/**
 * Is this module one of the GUARDED REPO'S OWN TypeScript files — the config, and whatever it
 * imports — which flow has to evaluate itself?
 *
 * Node decides a `.ts` file's module system from the nearest `package.json`: `type: "module"` makes
 * it ESM, anything else makes it CommonJS, and there is no syntax detection for `.ts` the way there
 * is for an extensionless-type `.js`. A config is written in `import` statements, so in a repo whose
 * package.json says `commonjs` — or says nothing, which is what `npm init` writes, and is the
 * ordinary JS repo — the config flow's own `init` just scaffolded cannot be loaded at all. Measured
 * at 0.1.0's pre-flight over all four shapes: absent green (no package.json, so node falls back to
 * syntax detection), `module` green, NO TYPE FIELD red, `commonjs` red. Every suite had missed it
 * because the harness's throwaway repos carry no package.json.
 *
 * So flow loads its own config the way eslint and vitest load theirs: it reads the file, strips the
 * types and hands node ESM, and the repo's package.json never enters into it. This is the pure half
 * — WHICH urls that treatment is for — and `loadConsumerTypeScript` in the shell is the doing.
 *
 * THREE EXCLUSIONS, each a case that must keep node's own answer:
 *
 * · not a `file:` url — an http or data specifier is nothing flow put there.
 * · `.d.ts` — declarations, which are types all the way down and evaluate to nothing.
 * · anything under `node_modules` — node REFUSES to strip types there
 *   (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), on the grounds that a dependency ships built
 *   files. Stripping them here because a config happened to import one would quietly overrule that,
 *   for every package in the tree, from a guard. flow's own bundles are `.mjs` and never reach here.
 */
export declare function loadsAsStrippedModule(url: string): boolean;
/**
 * The one sentence for "this config would not load", and the one place a version floor is named.
 *
 * A node too old to strip types fails on the IMPORT, with a syntax error about a colon. That is a
 * machine fact arriving as a parse error — the least actionable shape a true statement can take —
 * so it is rewritten here, once, for both readers: the `flow test` verb and the live hook rail,
 * which would otherwise describe one breakage two ways.
 */
export declare function configLoadFault(file: string, message: string, nodeVersion: string): string;
/**
 * The repo's bin folder, relative to the repo root. flow never runs a `flow` from here: any package
 * can install one (Facebook's `flow-bin` does), and nothing guards the folder. `hostPath` drops it
 * from the PATH npm hands one run.
 */
export declare const LOCAL_BIN = "node_modules/.bin";
/** Where the repo's own `@jawache/flow` is, relative to the repo root: a dev dependency, or init's link. */
export declare const PACKAGE_DIR = "node_modules/@jawache/flow";
/** That package's own binary — the file its `bin` names. */
export declare const PACKAGE_BIN = "node_modules/@jawache/flow/dist/flow.mjs";
/**
 * The repo-first half of a caller of flow: run the repo's own package's binary when it is there.
 * `root` is how the shell names the repo: the variable the harness names for a hook, `$PWD` for git's.
 */
export declare function repoFirst(root: string, verb: string): string;
/**
 * WHERE THE GATE LIVES, spelled once for everyone who names it.
 *
 * Four readers say these two paths — the hook `init` writes, the report that names the write, the
 * fitting `status` checks, and the shell next door that stats the file. Spelled four times, a rename
 * would leave one reader writing a path another never looks at, and the failure is the silent kind:
 * a green report over a gate git is not running.
 */
export declare const HOOKS_DIR = ".githooks";
export declare const GATE_PATH = ".githooks/commit-msg";
/** Where releases before 0.4 wrote the gate: git's pre-commit hook, which runs before git has the message. */
export declare const OLD_GATE_PATH = ".githooks/pre-commit";
/** What arms git, said the way a person types it — the report's line and the fitting's fix. */
export declare const SET_HOOKS_PATH = "git config core.hooksPath .githooks";
/**
 * The gate's line that runs the repo's own `@jawache/flow` first: git runs the hook from the repo's
 * root, so `$PWD` is the repo. Written by `init`, looked for by `status`, and named in its fixes.
 */
export declare const GATE_LOCAL_LINE: string;
/** The gate's line that runs flow, last, so its exit code is the hook's. `$1` is the file git holds the message in. */
export declare const GATE_RUN_LINE = "exec flow hook commit \"$1\"";
/**
 * How to arm a gate flow will not write over, in the ONE wording both readers use. Both of the
 * gate's lines: the run line alone finds flow on the PATH alone, and a repo with flow only as a dev
 * dependency then fails every commit.
 *
 * `init` says it about the hook it just declined to overwrite; `status` says it about the hook it
 * found unarmed. The same instruction, at the two moments a person can meet it — and two spellings
 * of an instruction are two instructions the day one of them is edited.
 */
export declare const ADD_THE_GATE_LINE: string;
/**
 * How to bring a gate written for the old verb up to date, in the ONE wording both readers use.
 *
 * The old hook still runs the gate, which is why it is not simply broken: it hands flow a list that
 * leaves out deletions, and exits before calling flow at all when a commit only deletes files.
 * `status` says that much; this is the instruction alone, so it ends `init`'s sentence cleanly.
 */
export declare const UPDATE_THE_GATE_LINE: string;
/**
 * The commit-message hook, verbatim.
 *
 * `flow hook commit "$1"` — git's hook under the same verb as the harness's hooks, handed the file
 * git holds the message in. It passes no list of files: flow asks git what the commit adds, changes
 * and deletes, so there is one source of the staged set whoever calls the gate, and nothing in this
 * file to filter it or to skip flow when it is empty.
 */
export declare const COMMIT_MSG: string;
/** Does this commit-msg hook call flow's gate? Asked by `init` before writing, and by `status` after. */
export declare function armsFlow(text: string | null): boolean;
/** Does it call the gate's OLD verb, `flow commit` — a gate that runs, and misses deletions? */
export declare function armsOldFlow(text: string | null): boolean;
/**
 * A hook with flow taken out: `delete` when every command in it is one a `flow init`
 * wrote, the hook less the lines that run flow when it holds commands of its own, and null when no
 * line of it is flow's. A line is flow's only when it is, trimmed, exactly one flow wrote: a line
 * somebody spelled themselves is theirs to remove.
 */
export declare function gateWithoutFlow(text: string | null): {
    readonly delete: true;
} | {
    readonly delete: false;
    readonly body: string;
} | null;
/**
 * The lines of a hook that call flow, trimmed, in order: each line a `flow init` wrote into a gate
 * or told a person to add, today's and every older release's, and any other line that runs
 * `flow hook commit` or `flow commit`. Comments call nothing. What uninstall names for a person to
 * delete from a hook that is not flow's to edit.
 */
export declare function flowLinesOf(text: string | null): string[];
/** What the gate judges: the staged changes, or the whole tree as if all of it were staged. */
export type CommitScope = "staged" | "all";
/** `flow hook commit [<file>] [--all]`, read: what to judge, and the file git holds the message in. */
export interface CommitArgs {
    readonly scope: CommitScope;
    /** The message file git passed to its commit-message hook. Null under `--all`, and for an older pre-commit hook, which runs before git has a message. */
    readonly messageFile: string | null;
}
/**
 * `flow hook commit [<file>] [--all]`, read. Null is a refusal: a second file here would be a
 * second source of the message, and any other flag is one flow does not have. `legacy` is the old
 * `flow commit <files…>`, whose list an older hook still passes: it is dropped rather than refused
 * so that hook keeps running the gate, and it has no message.
 */
export declare function commitArgs(args: readonly string[], legacy: boolean): CommitArgs | null;
/**
 * The comment leader git strips from a message: `core.commentString`, else `core.commentChar`, as
 * `git config` printed it. `#` when it printed nothing. `auto` is `#` too: git chooses its own
 * character while it edits the message, and the file the hook is handed does not say which.
 */
export declare function commentLeader(configured: string): string;
/**
 * A commit message as git records it. When git opened an editor, from the scissors line on is gone,
 * then every comment line: comment lines are what git's editor template adds, and the section after
 * the scissors line is the diff `git commit -v` appends. When it did not (`-m`, `-F`), they are the
 * author's own text and stay. Either way trailing whitespace, runs of blank lines and the blank
 * lines at either end go, as git's own clean-up does. `edited` is false when git set
 * `GIT_EDITOR=:` for the hook, which is how it says no editor ran.
 */
export declare function cleanMessage(raw: string, leader: string, edited: boolean): string;
/** The folder git runs hooks from, as the shell found it. One reading, for init and status alike. */
export interface HooksFolder {
    /** As git names it (`git rev-parse --git-path hooks`), spelled by `hooksDirOf`. */
    readonly dir: string;
    /** The name of every file in it, `.sample` files included: which of them count is decided here. */
    readonly files: readonly string[];
    /** The text of the commit-msg hook a person edits for that folder (`commitMsgOf(dir)`), or null. */
    readonly commitMsgText: string | null;
    /** That file has the execute bit this user needs to run it. False when there is no file. */
    readonly commitMsgExecutable: boolean;
}
/**
 * What the commit-msg hook git runs lacks before it runs flow's gate: `add` flow's two lines;
 * `create` the hook, which is not there; `chmod` a hook that calls flow but that git ignores,
 * because it lacks the execute bit; or `add-and-chmod`, both.
 */
export type HookFix = "add" | "create" | "chmod" | "add-and-chmod";
/** Git runs other hooks, and whether the commit-msg hook it runs calls flow. */
export interface OtherHooks {
    /** The folder git runs hooks from. */
    readonly dir: string;
    /** The commit-msg hook a person edits to call flow. */
    readonly commitMsg: string;
    /** The first fix, or null when that hook calls flow's gate and git runs it: flow is installed. */
    readonly fix: HookFix | null;
}
/** Other hooks that do not run flow's gate yet, so flow is not installed. */
export type UnwiredHooks = OtherHooks & {
    readonly fix: HookFix;
};
/** Does git run other hooks without flow's gate among them? */
export declare function unwired(other: OtherHooks | null): other is UnwiredHooks;
/**
 * The commit-msg hook a person edits for this hooks folder.
 *
 * Usually the folder's own `commit-msg`. Husky is the exception: it points git at `.husky/_`, a
 * folder of stubs it rewrites on every install, and each stub runs the hook of the same name one
 * folder up, so the file a person edits is `.husky/commit-msg`. Any folder named `_` is read that way.
 */
export declare function commitMsgOf(dir: string): string;
/**
 * The hooks folder as a person would type it, from git's answer to `git rev-parse --git-path hooks`
 * run at the repo root: repo-relative when it is inside the repo, absolute when it is not, such as
 * a worktree's shared `.git/hooks`. Resolved, so `.githooks/` and `./.githooks` both read `.githooks`.
 */
export declare function hooksDirOf(root: string, said: string): string;
/**
 * Does git run hooks other than flow's here? Null when it does not: `core.hooksPath` is flow's own
 * folder, or it is unset and `.git/hooks` holds nothing but git's own `.sample` files. A
 * `core.hooksPath` anywhere else counts whatever is in it, and any other file in `.git/hooks` counts,
 * not only a `commit-msg`: Git LFS installs `pre-push` and `post-checkout` there.
 */
export declare function otherHooks(hooksPath: string | null, folder: HooksFolder): OtherHooks | null;
/** The words the block opens with, fixed by the docs, for every reader that looks for them. */
export declare const NOT_INSTALLED = "FLOW IS NOT INSTALLED";
/**
 * Git could not name the folder it runs hooks from, in the ONE wording init's report and status's
 * line share. No advice: telling a husky repo to set `core.hooksPath` is what turns husky off.
 */
export declare const HOOKS_UNKNOWN = "git could not name the folder it runs hooks from, so flow cannot tell whether a commit runs its gate. Run `git rev-parse --git-path hooks` here to see why.";
/** Other hooks whose commit-msg calls flow, in the ONE wording init's note and status's line share. */
export declare function wiredLine(other: OtherHooks): string;
/**
 * The message for other hooks that do not run flow, in the ONE wording init's block and status's
 * line share: the folder git runs hooks from, why its commit-msg hook does not run flow's gate, and
 * the two ways to finish. The first fix is whatever that hook lacks: flow's two lines, the hook
 * itself, or the execute bit. Init never takes either fix itself: editing or creating another
 * tool's hook, or moving its hooks, is the person's call.
 */
export declare function notInstalledLines(other: UnwiredHooks): string[];
/** Does this `package.json` list `@jawache/flow` as a dependency or a dev dependency? */
export declare function listsFlow(manifest: string | null): boolean;
/** One harness, and what the shell found of it in this repo: its folder, and its program on the `PATH`. */
export interface Found {
    readonly harness: HarnessFacts;
    /** Its folder is in the repo. */
    readonly folder: boolean;
    /** Its program is in a folder on the `PATH`. */
    readonly program: boolean;
}
/** How a harness was detected, as the prompt says it, or null when it was not: its folder first, then its program. */
export declare function detection({ harness, folder, program }: Found): string | null;
/** The harnesses to register when nobody chose: each one detected, or every one when none is. */
export declare function defaultHarnesses(found: readonly Found[]): string[];
/** The value of `--harness`, as typed, or null when it is not given. `--harness` with no value is the empty string. */
export declare function harnessArg(args: readonly string[]): string | null;
/**
 * The harnesses to register: what `--harness` or the prompt was given, or null when nothing was, which
 * is the default of detection. A name no harness has, and a choice of none, are refused with one message
 * that names the valid harnesses: none would register nothing.
 */
export declare function chooseHarnesses(found: readonly Found[], typed: string | null): {
    readonly ok: true;
    readonly ids: string[];
} | {
    readonly ok: false;
    readonly refusal: string;
};
/** The prompt for the harnesses: each one, ticked when selected, with how it was detected. */
export declare function harnessPrompt(found: readonly Found[], selected: readonly string[]): string[];
/** The question under that prompt: the names a person may type, and what an empty answer keeps. */
export declare function harnessQuestion(found: readonly Found[]): string;
/** The list of what `flow init` is about to write, which the last prompt asks a yes for. */
export declare function aboutToWrite(plan: InitPlan): string[];
/** A yes: an empty answer, `y` or `yes`, in any case. */
export declare function isYes(answer: string): boolean;
/** The config file init writes: the one that binds `flow`, or the bare one `--empty` asks for. */
export declare function scaffold(empty: boolean): string;
/** One harness flow is setting up, and what its settings file held. */
export interface InitHarness {
    readonly harness: HarnessFacts;
    /** The repo's own settings file for it, parsed: null when there is none. */
    readonly settings: unknown;
    /**
     * The settings file is THERE and would not parse.
     *
     * Distinct from `settings: null`, which means there is none — and the distinction is the whole
     * reason this field exists. Both read as "no registrations found", so an init that acted on the
     * absence would answer an unreadable file by writing a NEW one over it, taking the reader's
     * permissions, model and every other key with it. Measured at the crossing, against a real
     * settings.json holding JSONC comments: the write was one branch away.
     */
    readonly settingsUnreadable: boolean;
    /**
     * The harness's machine-wide settings file, parsed, where flow 0.3 wrote its hooks: its path, and
     * its JSON, null when there is none or it would not parse. Read for a warning, never written.
     */
    readonly machine: {
        readonly path: string;
        readonly settings: unknown;
    };
}
/** What the shell found before anything was written. Every one is a stat, not a judgement. */
export interface InitFacts {
    /** The harnesses chosen to register, each with the file its hooks go in. */
    readonly harnesses: readonly InitHarness[];
    readonly root: string;
    /** `--empty`: the wiring, with a config that binds nothing. */
    readonly empty: boolean;
    readonly isGit: boolean;
    readonly hasConfig: boolean;
    /** The gate as it stands, or null when there is none. */
    readonly gateText: string | null;
    /** The pre-0.4 gate, `.githooks/pre-commit`, as it stands, or null when there is none. */
    readonly oldGateText: string | null;
    readonly hasFlowDir: boolean;
    /** `git config core.hooksPath` as it stands. */
    readonly hooksPath: string | null;
    /** The folder git runs hooks from, or null outside git or when git could not say. */
    readonly hooksFolder: HooksFolder | null;
    /** Does `@jawache/flow` already resolve from this repo? */
    readonly resolves: boolean;
    /** Does the repo's `package.json` list `@jawache/flow` as a dependency? */
    readonly listed: boolean;
    /**
     * Where the running binary's own package lives — what a link would point at, and NULL when the
     * walk up never found it. Null rather than an empty string on purpose: an empty string is a path
     * as far as the shell is concerned, and it would go on to attempt a symlink to nowhere and report
     * the failure of a step that should never have been planned.
     */
    readonly packageRoot: string | null;
}
/** One file to write, repo-relative so the report reads the way a person would say it. */
export interface Write {
    readonly path: string;
    readonly body: string;
    /** Set on the gate, which git will not run unless it is executable. */
    readonly mode?: number;
}
/** Everything `flow init` will do, decided before a byte is written. A null means "already there". */
export interface InitPlan {
    readonly config: Write | null;
    readonly gate: Write | null;
    /**
     * The hook an older flow wrote before git has the message, `.githooks/pre-commit`, which would run
     * the gate a second time with no message: deleted when it holds only flow's lines, else rewritten
     * without them. Null when no line of it is flow's.
     */
    readonly oldGate: {
        readonly path: string;
        readonly body: string | null;
    } | null;
    /** A commit-msg hook that is somebody else's. Never overwritten — reported, with the line to add. */
    readonly gateKept: boolean;
    /** …and it is flow's own, from before `flow hook commit` — reported with the line to replace. */
    readonly gateOld: boolean;
    readonly notGit: boolean;
    readonly flowDir: boolean;
    /** The package to link into `node_modules/@jawache/flow`, or null when flow already resolves. */
    readonly link: string | null;
    /** Point git at `.githooks`: a git repo whose git runs no other hooks, and not already there. */
    readonly hooksPath: boolean;
    /** Git runs other hooks, so `core.hooksPath` is left alone. Flow is not installed unless it is wired. */
    readonly otherHooks: OtherHooks | null;
    /**
     * A git repo whose git could not name the folder it runs hooks from, so `core.hooksPath` is left
     * alone too: that folder may hold another tool's hooks, and setting it would turn them off.
     */
    readonly hooksUnknown: boolean;
    /** Each harness's rewritten settings file: only those that change. A file that already calls flow, or could not be read, is not here. */
    readonly settings: readonly {
        readonly path: string;
        readonly value: unknown;
        /** The events added, rewritten or removed, for the report. */
        readonly registered: readonly string[];
    }[];
    /** The settings files that were there and would not parse, so nothing was registered in them. Said out loud. */
    readonly settingsUnreadable: readonly string[];
    /** What to know before anything is written, each a sentence. The four warnings of `flow init`. */
    readonly warnings: readonly string[];
}
/** What init will do to this repo. Pure: every branch reads a fact the shell already gathered. */
export declare function planInit(facts: InitFacts): InitPlan;
/** What `flow init` is about to write, one line each: the list it asks a yes for, and the list it reports back. */
export declare function writtenLines(plan: InitPlan): string[];
/** The warnings, as lines. Empty when none applies. */
export declare function warningLines(plan: InitPlan): string[];
/**
 * The report — every write named, and everything NOT done said out loud with what to do instead.
 *
 * A setup command that prints "done" is a command nobody can check. Failures are handed in rather
 * than thrown because a PARTIAL init is the interesting case: the config landed, the settings file
 * was read-only, and the person needs to know exactly that. `colour` is `wantsColour`'s answer for
 * the output this is written to.
 */
export declare function initLines(plan: InitPlan, failures: readonly string[], colour?: boolean): string[];
/**
 * Does this output get colour? Only in a terminal, and never with `NO_COLOR` set to anything but an
 * empty string, which is the convention at no-color.org. A pipe, a file and a test harness get the
 * plain text, so nothing that reads the output has escape codes to strip.
 */
export declare function wantsColour(terminal: boolean, noColor: string | undefined): boolean;
/**
 * Init's exit code. 1 when it could not finish, and 1 when flow is not installed or cannot tell: a
 * script chaining `flow init && …` is asking whether the repo is guarded, and a gate git never runs
 * is not.
 */
export declare function initCode(plan: InitPlan, failures: readonly string[]): 0 | 1;
/** What the shell found before anything was removed. Every one is a stat, not a judgement. */
export interface UninstallFacts {
    /** The harnesses flow is taken out of, each with its repo settings file and its machine-wide one. */
    readonly harnesses: readonly UninstallHarness[];
    readonly hasConfig: boolean;
    /** The gate as it stands, or null when there is none. */
    readonly gateText: string | null;
    /** The pre-0.4 gate, `.githooks/pre-commit`, as it stands, or null when there is none. */
    readonly oldGateText: string | null;
    /** `git config core.hooksPath` as it stands. */
    readonly hooksPath: string | null;
    /** The repo's top folder when the run is in a folder below it, else null. */
    readonly subfolderOf: string | null;
    /** The names in `.githooks/`, or null when there is no such folder. */
    readonly hooksDir: readonly string[] | null;
    /**
     * The folder git runs hooks from, read at the repo's top folder as init and status read it, or
     * null outside git or when git could not say.
     */
    readonly hooksFolder: HooksFolder | null;
    readonly hasFlowDir: boolean;
    /** `node_modules/@jawache/flow` is a symlink: the link `flow init` makes. A real folder is an install. */
    readonly linked: boolean;
    /** `--machine` was given: the machine-wide settings files are flow's to clean too. */
    readonly machineFlag: boolean;
}
/** One harness flow is taken out of: what its settings files held. */
export interface UninstallHarness {
    readonly harness: HarnessFacts;
    /** The repo's own settings file for it, parsed; null when there is none. */
    readonly settings: unknown;
    /** …it is there and would not parse. */
    readonly settingsUnreadable: boolean;
    /** The machine-wide settings file: its absolute path, its JSON (null when there is none), and whether it would not parse. */
    readonly machineFile: {
        readonly path: string;
        readonly settings: unknown;
        readonly unreadable: boolean;
    };
}
/** A settings file with flow's registrations taken out: where it is, what to write, and the events that went. */
export interface SettingsWithout {
    readonly path: string;
    readonly value: unknown;
    readonly removed: readonly string[];
}
/** Everything `flow uninstall` will do, decided before a byte is removed. */
export interface UninstallPlan {
    /** The gate: deleted, rewritten without flow's lines, or null when nothing in it is flow's. */
    readonly gate: {
        readonly path: string;
        readonly body: string | null;
    } | null;
    /** The pre-0.4 gate, taken out the same way: it would run `flow hook commit` with flow gone. */
    readonly oldGate: {
        readonly path: string;
        readonly body: string | null;
    } | null;
    /**
     * A commit-msg hook that still calls flow after the run, in lines flow did not write there: that
     * hook, as the report names it, and those lines, for a person to delete before `npm uninstall`.
     * The hook git runs from another folder, such as husky's `.husky/commit-msg`, which uninstall
     * never edits, as `flow init` never does; else what is left of `.githooks/commit-msg`. Null when
     * neither calls flow.
     */
    readonly hookCallsFlow: {
        readonly path: string;
        readonly lines: readonly string[];
    } | null;
    /** Unset `core.hooksPath`: it is `.githooks`, the run is at the repo's top folder, and the folder holds no other hook. */
    readonly hooksPath: boolean;
    /**
     * `core.hooksPath` is `.githooks` but the run is in a subfolder: the repo's top folder, where
     * `flow uninstall` removes it, or null.
     */
    readonly hooksPathFrom: string | null;
    /** The hooks that keep `core.hooksPath` at `.githooks`, named for the report. */
    readonly hooksKept: readonly string[];
    /** Remove `.githooks/`, which nothing else is in. */
    readonly hooksDir: boolean;
    readonly flowDir: boolean;
    readonly link: boolean;
    /** The repo's settings file of each harness without flow's registrations: only those that held some. */
    readonly settings: readonly SettingsWithout[];
    /** With `--machine`: each machine-wide settings file without flow's registrations: only those that held some. */
    readonly machine: readonly SettingsWithout[];
    /** The settings files flow's to clean that would not parse: nothing written to them, each said out loud. */
    readonly unreadable: readonly string[];
    /** How this run was typed, so a failure's report says what to run again. */
    readonly command: string;
    readonly keptConfig: boolean;
    /**
     * The machine-wide files that still hold flow's hooks, because `--machine` was not given: said
     * beside the report and in its last line. Without it, a plain run reports success while every
     * session of the harness on the machine still calls `flow`.
     */
    readonly machineHolds: readonly string[];
    /** The command that removes the package, the report's last line. */
    readonly next: string;
}
/** What uninstall will remove from this repo. Pure: every branch reads a fact the shell already gathered. */
export declare function planUninstall(facts: UninstallFacts): UninstallPlan;
/** The one argument `flow uninstall` takes: clean the machine-wide settings file too. */
export declare const MACHINE_FLAG = "--machine";
/**
 * `flow uninstall`'s arguments, read: null when they are fine, else the refusal to print. An argument
 * it does not know is refused rather than ignored, because this verb deletes files and a `--dry-run`
 * or a `--help` that went ahead would delete them too.
 */
export declare function uninstallRefusal(args: readonly string[]): string | null;
/** A step that could not be done answers 1, whether the shell hit it or the plan did. */
export declare function uninstallCode(plan: UninstallPlan, failures: readonly string[]): 0 | 1;
/** The report: every removal named, what was kept and why, each failure, and the command to run next. */
export declare function uninstallLines(plan: UninstallPlan, failures: readonly string[]): string[];
/** One thing the world around the config has to be, and whether it is. A red line carries its fix. */
export interface Fitting {
    readonly id: string;
    readonly ok: boolean;
    readonly detail: string;
    /** On a harness's line: when one of its hooks last ran here, as the log wrote it, or null when none has. */
    readonly lastRan?: string | null;
}
/** One harness status reports on. */
export interface StatusHarness {
    readonly harness: HarnessFacts;
    /** The repo's own settings file for it, parsed; null when there is none. */
    readonly settings: unknown;
    /** The time of the last hook of this harness that ran here, as the log wrote it, or null when none has. */
    readonly lastRan: string | null;
}
/** Everything status was able to read. Gathering it is the shell's job; judging it is not. */
export interface StatusFacts {
    /** The harnesses flow is reporting on, each with its repo settings file and when one of its hooks last ran. */
    readonly harnesses: readonly StatusHarness[];
    /** The time of the report, in milliseconds: what "ago" is counted from. Injected, because a clock inside a decision is a decision nobody can test. */
    readonly now: number;
    readonly root: string;
    readonly version: string;
    readonly off: boolean;
    readonly configPath: string;
    readonly hasConfig: boolean;
    /** The load, or null when there is no config to load. */
    readonly load: LoadResult | null;
    readonly gateText: string | null;
    /** The pre-0.4 gate, `.githooks/pre-commit`, as it stands, or null when there is none. */
    readonly oldGateText: string | null;
    readonly hooksPath: string | null;
    /** The folder git runs hooks from, read as init reads it, or null outside git or when git could not say. */
    readonly hooksFolder: HooksFolder | null;
    /**
     * The grammars the config declared, each with its library path made absolute and a straight
     * answer about whether that file is there.
     *
     * A grammar is a BUILD ARTEFACT and is not committed, so "declared but not built" is the ordinary
     * state of a fresh clone — and every `astGrep` rule on that language refuses until it is built.
     * That is a repo whose guard is not fully in force, which is exactly what a red line is for.
     */
    readonly grammars: readonly {
        readonly name: string;
        readonly libraryPath: string;
        readonly present: boolean;
    }[];
    /**
     * Who last worked in this worktree, from the marker a tool call leaves. Null when nobody has.
     * `mode` is the permission mode its last recorded call stated, null when none did; `steer` is auto
     * mode's steer as its transcript last stated it, asked only under auto mode.
     */
    readonly session: {
        readonly id: string;
        readonly agent: string | null;
        readonly wearing: readonly string[];
        readonly mode?: string | null | undefined;
        readonly steer?: Steer | null | undefined;
    } | null;
    /**
     * Where the flow the hooks and the gate run is, as three stats. `listed`: the repo's
     * `package.json` lists `@jawache/flow`. `copy`: its package's binary, `PACKAGE_BIN`, is there —
     * a dev dependency's, or the link `flow init` made to the flow that ran it. `path`: a `flow` on
     * the PATH this command was run with, less what npm added for this run (`hostPath`) — the nearest
     * reading there is of the PATH git and the host hand their hooks. `binaryFitting` judges them.
     */
    readonly binary: {
        readonly listed: boolean;
        readonly copy: boolean;
        readonly path: boolean;
    };
}
/** The whole answer. */
export interface Status {
    readonly root: string;
    readonly version: string;
    readonly armed: boolean;
    readonly configPath: string;
    readonly moments: MomentsView;
    /** Every category a bound entry names — the vocabulary this repo actually classifies by. */
    readonly categories: readonly string[];
    readonly session: StatusFacts["session"];
    /** Entries bound only at moments this harness cannot deliver. Loaded, counted, and dark. */
    readonly dark: readonly string[];
    /** The moments the harness delivers: what a dark entry's line says it carries. */
    readonly delivers: Delivered;
    readonly fittings: readonly Fitting[];
    readonly refusals: readonly Refusal[];
    readonly green: boolean;
}
/** How long ago a time was, in a sentence: `just now`, `3 minutes ago`, `an hour ago`, `2 days ago`. */
export declare function ago(then: string, now: number): string;
/**
 * The time of the last hook of a harness that ran in this repo, from the session logs: the latest `ts`
 * of any row of a session of that harness, and null when there is none.
 *
 * A session's harness is its `meta` row's `harness`. A log written before that field existed names
 * none, and only one harness wrote those. The `commit` stream is git's, not a harness's.
 */
export declare function lastHookRan(history: readonly {
    readonly session: string;
    readonly rows: readonly Row[];
}[], harness: string): string | null;
/**
 * THE PATH GIT AND THE HOST HAND THEIR HOOKS, read off the PATH this command was run with: every
 * folder of it but a `node_modules/.bin` that npm put there for this one run — the repo's own or an
 * ancestor's, which `npx flow` and `npm run` add, and npx's cache of a package it fetched. Counted,
 * `npx flow status` would find a dev dependency's copy "on the PATH" that git never sees.
 *
 * Another repo's node_modules/.bin stays: it is on the PATH because someone put it there.
 */
export declare function hostPath(dirs: readonly string[], root: string): string[];
/** Does this adapter carry that moment, for that KIND of entry? */
export declare function delivers(kind: EntrySpec["kind"], moment: Moment, carried: Delivered): boolean;
/** The gathered facts, judged. Never throws: a broken config is a red line, not an exception. */
export declare function status(facts: StatusFacts): Status;
/**
 * The whole answer as lines — the headline, what meets you and when, then everything not true yet.
 *
 * The branching is here rather than in the CLI shell for the reason every report in this package is:
 * which headline, whether a moment table is printable at all, when the close goes red — each of
 * those is a judgement about what a reader most needs to know, and in a shell not one has a test.
 */
export declare function statusLines(s: Status): string[];
/**
 * The one code `flow status` answers with.
 *
 * THE 1/2 SPLIT IS THE WHOLE POINT of there being two non-zero codes: "your guard caught something
 * or is not fully wired" and "your guard cannot run at all" are different facts and a setup script,
 * a hook or a CI step has to tell them apart. Status used to break that itself — a config that would
 * not IMPORT answered 2 while a config the grammar REFUSED answered 1, which is the same fact under
 * two codes. A refusal list means the document was refused whole and every rail is off, so it is 2
 * however it broke; anything else that is not green is 1.
 */
export declare function statusCode(answer: Status): 0 | 1 | 2;
export declare const HOOK_EVENTS: readonly ["session-start", "subagent-start", "pre-tool-use", "post-tool-use", "stop", "subagent-stop", "notification"];
export type HookEvent = (typeof HOOK_EVENTS)[number];
export declare function isHookEvent(word: string): word is HookEvent;
/** The host's own name for each event — what a decision object has to echo back. */
export declare const HOST_EVENT: Record<HookEvent, string>;
/**
 * WHAT THIS HARNESS CAN HONESTLY SUPPLY — the seventh question, and the one that keeps the seam
 * from rotting quietly. An adapter never fakes a moment it cannot deliver.
 *
 * Two facts are stated here rather than discovered by somebody whose rule never fires:
 *
 *   · `commit` is delivered, but not by the harness — git's commit-msg hook calls `flow hook
 *     commit`, which is why every harness gets the gates for free and why it is in this list at all.
 *   · turn-end BRIEFING is delivered, on the `Stop` and `SubagentStop` answers'
 *     `additionalContext`: the host labels it hook feedback rather than an error, and the agent
 *     takes one more turn to read it. A refusal at the same hand-back carries the note beside it
 *     (`toResult`), so the agent is held and told at once rather than held, then told on the next.
 *   · command BRIEFING is delivered, on the same PreToolUse answer the command guardrails use: when
 *     nothing blocks, the hook's `additionalContext` carries the note, and when something does, the
 *     refusal wins — which is the right order, since a blocked command is not about to run.
 *   · file-change BRIEFING is delivered on the PostToolUse answer, after the call has run, for the
 *     files git lists as changed (`changedBy`): the agent reads it before its next call.
 *
 * It is two lists rather than one because a moment is delivered for a KIND of entry: `command` and
 * `turn-end` are words in both vocabularies, and another harness may carry one rail there and not
 * the other — a single flat list could only lie about one of them.
 */
export declare const DELIVERS: {
    guard: readonly GuardrailMoment[];
    brief: readonly BreadcrumbMoment[];
};
/**
 * Does a note at this moment ride a refusal, rather than wait for the call that runs?
 *
 * Before a call, a refusal means the call never runs, so a note about it is held back until the
 * retry that does — and is not marked shown, or it would stay silent until drift. A held turn is
 * different: the agent is about to act on the refusal anyway, and the note is about that same
 * turn, so both go to it together.
 */
export declare function ridesRefusal(moment: BreadcrumbMoment): boolean;
/**
 * What a payload needs from the world before it can become an event. Injected, never reached for.
 *
 * Every answer is a FUNCTION rather than a value, and that is not ceremony: a hook fires on every
 * tool call, and the turn's actions cost a whole transcript to work out. Asking only when the
 * moment needs it means the command rail — by far the most frequent — never opens the file at all.
 */
export interface EventWorld {
    /** The repo root. Event paths are repo-relative, because that is how every `on` glob is written. */
    readonly root: string;
    /** A file as it stands right now, or null when it is not there — an Edit is a diff against it. */
    readonly read: (path: string) => string | null;
    /** What the actor did this turn. Only the two turn-end rails ask, so only they pay for it. */
    readonly turn?: (() => readonly TurnAction[]) | undefined;
    /**
     * The agent the SESSION itself runs as (`--agent`, or the `agent` setting), or null when it runs
     * as none. Only `subagent-start` and `subagent-stop` ask, and only of a payload that names an
     * agent type, because it costs the parent's transcript: it is how an internal agent's start or
     * hand-back is told from a subagent's.
     */
    readonly sessionAgent?: (() => string | null) | undefined;
    /**
     * The session notes this subagent's start held until its brief could be read (`holdsForBrief`).
     * True only on a subagent's tool call before one has judged them; its PreToolUse then judges them.
     */
    readonly heldForBrief?: boolean | undefined;
    /** The home directory, for a Bash read through `~`. Absent, such a path is simply not named. */
    readonly home?: string | undefined;
}
/** Where a Bash call ran, and the two directories its paths are judged against. */
export interface BashWhere {
    /** The shell's working directory when the call started. */
    readonly cwd: string;
    /** The repo root. Paths outside it are not an area of this repo and are dropped. */
    readonly root: string;
    /** What `~` and `$HOME` mean; absent, a path through them is not known. */
    readonly home?: string | undefined;
}
/** What a Bash command reads in the repo, repo-relative, in order, each once. */
export interface BashReads {
    /** Files it reads by name — `cat`, `head`, `sed -n`, `grep` on a file, a `<` redirect. */
    readonly reads: readonly string[];
    /**
     * Paths a search walks or lists — `rg`, `find`, `ls`, `grep -r`, a `git` pathspec — which may be
     * directories. They touch an area; they are not a file the session read.
     */
    readonly searched: readonly string[];
}
/**
 * The repo paths a Bash command reads or searches — the `READERS` table, a `<` redirect, a `git`
 * pathspec — read from the parse's steps, and followed through `cd`, `VAR=`, `for` loops and the
 * commands a `$(…)` runs, by the parse's own walk (`followSteps`). The repo root itself is not an
 * area and is left out. Best-effort, failing open: see the section head. A line that does not
 * parse names nothing. The steps are parsed from where the call ran, `where.cwd` and `where.home`,
 * since a git command's reads are relative to the folder the parse gave it.
 */
export declare function bashReads(steps: readonly ShellStep[] | null, where: BashWhere): BashReads;
/**
 * A payload → every event it carries. ZERO OR MORE, and the plural is not hedging.
 *
 * One Bash call is genuinely several moments — the command about to run, and the command's own
 * note — and the old engine ran two evaluations off that one hook for exactly this reason. A signature returning one event would push the second rail back into the shell, where it
 * could not be tested as a decision.
 *
 * An event flow was not asked for answers with an empty list, never with an invented moment.
 */
export declare function toEvent(hook: HookEvent, payload: HookPayload, world: EventWorld): AdapterEvent[];
/**
 * Is this a subagent starting before its brief can be read?
 *
 * At `SubagentStart` the host has not yet written the subagent's own transcript, so the brief at its
 * head is not there: a category recognised by it cannot match yet. A resumed subagent's is there.
 * Its classification is then read without being remembered, or the sticky verdict would be one
 * reached without the brief.
 */
export declare function awaitsBrief(hook: HookEvent, transcript: string | null): boolean;
/**
 * Does this config hold a subagent's session notes for its brief, when the brief cannot be read at
 * its start (`awaitsBrief`)?
 *
 * Only a note bound with `.for(…)` can wait on a category, so a config with none holds nothing. One
 * shown at the start is marked there, and judged again at the first tool call shows nothing.
 */
export declare function holdsForBrief(entries: readonly LoadedEntry[]): boolean;
/**
 * Does this hook have nothing to run for this config — so the shell can answer before it reads a
 * thing?
 *
 * A subagent's hand-back costs the parent's transcript (whose agent the session runs as) and the
 * subagent's own (its turn), and it comes at every hand-back of every subagent. A config that binds
 * no entry at turn-end, guardrail or breadcrumb, has nothing either read could feed, so neither is
 * made. A disabled entry binds nothing.
 *
 * A repo that is RECORDING never answers early: the tape is for replaying a session against rules
 * written later, so it keeps every hand-back whatever is bound today.
 */
export declare function nothingBound(hook: HookEvent, entries: readonly LoadedEntry[], recording: boolean): boolean;
/**
 * The folders a shell command runs in, absolute: where the shell stood when the call started, and
 * each command's `folder` from the one parse, `git -C` included, each once. A folder only running
 * the line could tell is left out. None for any other call.
 */
export declare function commandFolders(payload: HookPayload, root: string, home: string | undefined): string[];
/**
 * Every place a call worked, absolute: the file an edit tool wrote (`written`, which the harness
 * names), or the folders a shell command ran in (`commandFolders`). What `worktreesWorkedIn` places in a worktree.
 */
export declare function workedPaths(payload: HookPayload, root: string, home: string | undefined, written: string | null): string[];
/** The folders between a path and the guarded folder that holds it, nearest first; neither end. */
export declare function foldersBetween(path: string, root: string): string[];
/**
 * May any of these paths be in another worktree? Only then is git asked for the worktree list, so
 * an ordinary call costs nothing more. A path outside the guarded folder may be. So may one inside
 * it under a folder holding a `.git`: a linked worktree marks its own folder with a `.git` file, and
 * Claude Code puts a subagent's worktree there, under `.claude/worktrees/`. A repository made inside
 * it holds a `.git` folder, and costs the same one question. `gitIn` answers whether a folder holds
 * either.
 */
export declare function reachesAnotherWorktree(paths: readonly string[], root: string, gitIn: (dir: string) => boolean): boolean;
/**
 * Where an event works outside the repository, by the name the engine reads (`GuardEvent.outside`):
 * the `folder` of each command that runs outside. A command with no folder is inside. `gitIn`
 * answers whether a folder holds a `.git`, and `sameRepository` whether git names this repository
 * for a folder; it is asked only of a folder `gitIn` cannot clear. A breadcrumb has no world of
 * its own: the paths of a file-change are git's own, inside a worktree of this repository.
 */
export declare function outsideOf(event: AdapterEvent, root: string, gitIn: (dir: string) => boolean, sameRepository: (folder: string) => boolean): string[];
/** The working folders `git worktree list --porcelain` lists; a bare repository has none. */
export declare function worktreeFolders(porcelain: string): string[];
/**
 * The other worktrees a call worked in: each path is placed in the worktree that holds it, the
 * deepest when worktrees nest, and the session's own is left out. The session's own worktree is the
 * deepest one holding the guarded folder, so a session started in a nested worktree reads the one
 * around it. Each is named once, in the order the paths came.
 */
export declare function worktreesWorkedIn(args: {
    readonly paths: readonly string[];
    readonly root: string;
    readonly worktrees: readonly string[];
}): string[];
/**
 * The paths `git status --porcelain=v1 -z --untracked-files=all` lists. An entry is `XY path`, and
 * a rename or a copy is followed by the path it came from, which is listed as well: the file is
 * gone from there. A folder, which git lists for a repository nested in this one, is not a file.
 */
export declare function statusPaths(stdout: string): string[];
/**
 * The commits a call made, as the range git is asked for, or null when it made none or one side has
 * no commit to name. A commit takes its files out of git's list, so a call that changes a file and
 * commits it leaves the file in neither list: the commit's own files are changes of the call.
 */
export declare function commitRange(before: Tree, after: Tree): string | null;
/**
 * The paths a call changed in one working folder, sorted: a path git lists now and did not before,
 * a path whose content differs, a path git listed before and does not now (it was put back, or
 * committed), and the files of a commit made inside the call (`committed`, from `commitRange`).
 */
export declare function changedBy(before: Tree, after: Tree, committed: readonly string[]): string[];
/**
 * The file an edit tool's call named, as an absolute path with its links resolved (`absolute`, which
 * the shell makes of the harness's `editedFile`), relative to one working folder; null when there is none or it is
 * outside the folder. It is what a call whose "before" was never taken is left with: a first call,
 * or a call in a worktree this agent has not worked in, has nothing to compare.
 */
export declare function namedChange(absolute: string | null, folder: string): string | null;
/** The paths one working folder's call changed: compared with its "before", or what the call named when it has none. */
export declare function folderChanges(args: {
    readonly before: Tree | null;
    readonly after: Tree;
    readonly committed: readonly string[];
    readonly named: string | null;
}): string[];
/**
 * The working folders to look at for this hook: where the call worked, before a shell command and
 * after any tool; the guarded folder, as a session or a subagent starts; none for the rest. `worked`
 * is asked only when it is needed, since it may cost a call to git.
 */
export declare function foldersToLook(hook: HookEvent, tool: string, worked: () => readonly string[], root: string): readonly string[];
/**
 * The events a changed set of paths makes for the breadcrumb rail: one for each path that a
 * breadcrumb bound at `file-change` reaches. A path none reaches shows nothing and writes no row, so
 * it makes no event, and a recording holds none of it either.
 */
export declare function changeEvents(paths: readonly string[], entries: readonly LoadedEntry[]): BriefAdapterEvent[];
/**
 * The notices these events could show, whatever the session has drifted to: the breadcrumbs that
 * fire at them, bind to the agent, are in scope, and are unmarked or marked and so due again. The
 * shell reads the transcript for the drift, and the prose files, only when this is not empty — a
 * call that changed no file under a breadcrumb's globs reads neither.
 */
export declare function noticesThatCouldShow(args: {
    load: LoadResult;
    events: readonly BriefAdapterEvent[];
    marks: Marks;
    wearing: readonly string[];
    settings: Settings;
}): Notice[];
/** The row that records a call's changed files. Null when it changed none. */
export declare function changeRow(tool: string, paths: readonly string[]): Row | null;
/** One shell command, and the files its call changed. */
export interface ShellChange {
    readonly command: string;
    readonly paths: readonly string[];
}
/**
 * The shell calls of one agent that changed files, in order, from its rows: a `Bash` call's `tool`
 * row is followed by its `change` row. A call that changed nothing has no `change` row.
 */
export declare function shellChangesOf(rows: readonly Row[], agent: string): ShellChange[];
/**
 * The turn's actions with each file a shell command changed put in as an edit, just before the
 * command's own run: a command that changes a file and then runs the tests did not run them after
 * the change, and one that only runs them is not an edit. Each `run` is matched with the latest
 * shell call that has its command and was not matched yet, so a command run twice is told apart.
 */
export declare function withShellChanges(actions: readonly TurnAction[], changes: readonly ShellChange[]): TurnAction[];
/** A note with its prose resolved: a `file:` breadcrumb is read by the shell, never here. */
export interface Shown {
    readonly entry: string | null;
    readonly cause: Cause;
    /** The moment that showed it; the header names it. Absent on the load error. */
    readonly moment?: BreadcrumbMoment | undefined;
    readonly body: string;
}
/** Everything one payload produced, ready to become something the host understands. */
export interface Answer {
    readonly refused: readonly Refused[];
    readonly shown: readonly Shown[];
}
/**
 * What the agent is told beside the load error, on every answer it rides: what that error means.
 *
 * The load error says what broke; this says what flow is doing about it. Without it, a call that
 * went through reads like a guard that judged it and passed.
 */
export declare const FLOW_OFF = "flow is OFF until flow.config.ts loads: every command goes through unchecked, and every commit is refused.";
/**
 * WHAT EVERY RAIL ANSWERS WHILE THE CONFIG WILL NOT LOAD — one decision for both ways it can break.
 *
 * A config has two ways of not loading. One will not IMPORT — a missing module, a syntax error —
 * which the shell catches as a thrown error. The other imports fine and the GRAMMAR refuses it: a
 * missing `.message(…)`, an override naming an entry the pack does not have, a mandatory parameter
 * nobody supplied. To everyone who meets them the two are the same fact, "the guard is entirely
 * off", so they get the same answer.
 *
 * NOTHING IS REFUSED HERE (docs/user/explanation/fail-loud.md). A guard that refused every call
 * would refuse the repair too — the fix for a missing package is `npm ci`, a command — and a write
 * made now reaches the commit gate anyway, which stays shut until the config loads and then checks
 * the staged files against every guardrail. The cost is the guardrails on commands, which nothing
 * later can check; the agent is told on every call that they are off.
 *
 * TOLD BEFORE THE CALL, ONCE. The load error rides the answer to a session start and to every
 * command about to run — one notice per answer, however many events the payload carried. A file
 * change never carries it, on either rail: a Bash call is told by its command, not by the files it
 * changed. So the after-call rail, whose events are file changes, stays silent: the agent was told
 * when the call was asked for, and saying it again with the result is the same sentence twice.
 *
 * TURN-END IS TOLD, NOT REFUSED. Holding a turn open on a broken config prevents nothing — the
 * commit gate stays shut — while it does stop the agent handing back to the one person who can fix
 * it. So the fault is reported and the turn ends. Not as a note either: a turn-end note keeps the
 * agent working for one more turn, which is the same hold by a softer name.
 *
 * THE ENGINE HAS ITS OWN PAIR OF `!load.ok` BRANCHES — `guard()` blocks with the fault, `brief()`
 * notices it — and they are NOT this rule written twice. They answer a different question: "there
 * is nothing to run, say so", for the two callers that have no call to let through and no turn to
 * end, namely `replay` and the commit gate. `flow replay` over a config the grammar refuses reaches
 * `brief()`'s branch and emits the fault notice, so that branch is live. What IS shared is the
 * shape — `Outage extends Answer`, so the hook rail's answer and every other answer are one type.
 */
export interface Outage extends Answer {
    /**
     * The sentence turn-end is TOLD with, or null when no turn ended here.
     *
     * It is not `shown`: a note at turn-end keeps the agent working for one more turn, and this
     * sentence is for the human the turn hands back to, so the shell writes it to stderr and answers 0.
     */
    readonly told: string | null;
}
/**
 * Is this the first hook flow is asked about a tool's call? A shell command is asked before it runs
 * (`pre-tool-use`), because one the guard refuses never reaches the hook after; every other tool is
 * asked after it ran (`post-tool-use`), since flow registers nothing before it. The flight
 * recorder writes the call's row at this hook, and a broken config tells the agent at it.
 */
export declare function opensCall(hook: HookEvent, tool: string): boolean;
/**
 * What a broken config answers with. `opens` is `opensCall` for this hook: the first hook of a
 * call carries the notice whatever events it made, so a Read, which makes none, is told too.
 */
export declare function whileBroken(events: readonly AdapterEvent[], message: string, opens?: boolean): Outage;
/**
 * The block of prose a set of notes is injected as.
 *
 * The header says `breadcrumb` because that is the mechanism's name everywhere else — in the
 * config, in the log, in `flow status` — and names the moment that showed it, as the tutorial prints
 * it; the load error, which no moment showed, names its cause. The injected block was the last place the old system spoke
 * one word to the agent and printed another to the human, and a mechanism you hear one name for and
 * read another about is one you cannot look up.
 */
export declare function briefBlock(shown: readonly Shown[]): string;
/**
 * Effects → the three IO edges. The SECOND and THIRD of the seven questions, answered once.
 *
 * BLOCKING IS EXIT 2 WITH THE TEXT ON STDERR, at every rail, and that is a deliberate narrowing of
 * what the old engine did. It had three spellings — a PreToolUse `permissionDecision: "deny"`
 * object for a write, exit 2 for a command, a `decision: "block"` object at Stop — three shapes for
 * one answer, each with its own way of being subtly wrong, and only one of them works at every
 * moment. Exit 2 is the host's documented refusal channel and the model reads stderr on all three
 * rails, so flow has one refusal and one place to look when it fails to arrive.
 *
 * Injection stays the decision object, because there is no other channel for it — with one
 * exception. Notes beside a refusal go on stderr after it: the host reads that stderr as the
 * agent's next instruction, and its hooks reference says no JSON field on stdout can override an
 * exit 2, so stderr is the one place both are sure to arrive. Only a held turn's refusal carries
 * them: the shell judges no notes once something refused (`ridesRefusal`).
 */
export declare function toResult(hook: HookEvent, answer: Answer): HookResult;
/** Hand the agent some context and allow — the one shape every steering rail emits. */
export declare function decision(hook: HookEvent, additionalContext: string): string;
/**
 * The answer a rail gives when it could not read its payload — and which rails must be LOUD.
 *
 * The three outcomes of a read are not one outcome. "There was nothing to guard" is safe and common
 * — a hand-run, an empty stdin — and silence is the right answer to it. "I could not SEE what I was
 * guarding" is the old engine's invisible swallow: both were folded into `{}`, so a PreToolUse rail
 * holding an unreadable payload found no tool call, allowed, and told nobody. So every rail says one
 * fault line, and it keeps READ apart from PARSE: a payload that never arrived and one that arrived
 * and was not JSON are different faults. The line names the hook and the cause, never "the guard",
 * because after a call has run it must not read as refused (#12).
 *
 * One rail judges a tool call: PreToolUse, where an unreadable payload is a call it could not see,
 * and it answers exit 2 and refuses the call. The rest only add a breadcrumb or end a turn, and say
 * it on stderr with exit 0.
 */
export declare function readFault(hook: HookEvent, why: "unreadable" | "unparseable", detail: string): HookResult;
/**
 * Host-written evidence about one session × agent, assembled — the shape a classifier sees.
 *
 * The payload's `agent_id` is what makes a call a subagent's, whether or not any file exists for
 * it, and its `agent_type` is the type that subagent was started as. Both are in the message the
 * host writes, which the session cannot change. A subagent whose message carries no type is
 * spawned as something unknown: `subagent` stays true and `agentType` is left undefined, so a
 * category keyed on a specific type declines rather than the parent category wrongly claiming it.
 * The parent is recognised by ABSENCE — there is no positive marker for being the top-level
 * session, only the absence of having been spawned.
 *
 * `head` is the brief at the top of this agent's own transcript, a subagent's included: the harness reads it.
 */
export declare function sessionFactsFrom(args: {
    readonly payload: HookPayload;
    readonly head: string;
}): SessionFacts;
/**
 * Which agent one hook message came from — the one reading of it, for its state, its classification
 * and its log rows alike.
 *
 * The type is read only beside an `agent_id`: the host also sends `agent_type` on a top-level
 * session started with `--agent`, and that session is still the parent.
 */
export declare function agentOf(payload: HookPayload): AgentOf;
/**
 * A tool call → the row that records it, or null when the payload names no tool at all.
 *
 * EVERY call, including the ones no rule watches and no breadcrumb covers. The subject is whatever
 * the call had — a path (repo-relative, so it matches the globs an entry is written with), a
 * command line, a search pattern and its scope — and a call with no subject is still recorded by
 * name, because "the session ran fifty greps here" is a fact about the area. `edit` is the harness's
 * answer: whether this call changed the file it names.
 */
export declare function toolRow(payload: HookPayload, root?: string, edit?: boolean): Row | null;
/**
 * The files a Bash call reads by name, one `read` row each — written beside its tool row, so the
 * record counts a `cat` of a file as a touch of it the way it counts a Read.
 *
 * Files only. A directory a search walks is an area, not a file anybody read, and counted as one it
 * would name a folder as a node of the tree the rows are drawn into.
 */
export declare function shellReadRows(payload: HookPayload, root: string, home?: string): Row[];
/**
 * One hook flow registers, as `HooksFile.registered` states it: the event, its matcher, and what goes
 * unjudged without it. Not a settings file's entry, which is a `Registration`.
 */
export interface HooksFileHook {
    readonly hook: HookEvent;
    readonly matcher?: string;
    readonly unregistered: string;
}
/** What one harness's settings file asks of flow's registrations: which hooks, what each runs, and which ones an older flow wrote. */
export interface HooksFile {
    /** The hooks flow registers, in order. */
    readonly registered: readonly HooksFileHook[];
    /** The hooks an older flow registered that this one does not: the host's name for each, and the word its command ends in. */
    readonly retired: ReadonlyMap<string, string>;
    /** The command a registration runs for one hook. */
    readonly command: (hook: HookEvent) => string;
}
/**
 * Reading and writing flow's registrations in a harness's hooks file, for a file shaped as `hooks`:
 * an object of arrays of entries, each with a `matcher` and the commands it runs. Claude Code's
 * settings file and Codex's `hooks.json` are both that, so the two share these and differ in what
 * they register and the command it runs.
 *
 * Every function is pure: the file's JSON comes in and the JSON to write comes out.
 */
export declare function hooksFileOf(spec: HooksFile): Pick<Registering, "registrations" | "hooks" | "registeredEvents" | "staleRegistrations" | "bareRegistrations" | "withRegistrations" | "withoutRegistrations"> & {
    readonly ourHookCommand: (command: string) => boolean;
    readonly bareHook: (command: string) => HookEvent | null;
};
