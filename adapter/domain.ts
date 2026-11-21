// flow/adapter/domain.ts — THE PRODUCT'S PURE HOME: what flow's own verbs decide, whichever harness runs the agent.
//
// Last stage of flow's pipeline:
//
//   language → checks → engine → adapter
//
// Everything upstream is harness-blind on purpose, and so is this file. It holds what `flow init`,
// `flow uninstall`, `flow status` and `flow facts` decide, the git gate, what a commit is asked, and
// the reading of a conversation once a harness has turned its transcript into events. It names no
// harness: what is one harness's own comes in as a `Harness` (harness.ts) on the facts a verb is
// handed, and the harness's own dialect — its payloads, its settings, its transcripts — is in its
// own folder, which the import fence in guards/house.ts keeps this file out of.
//
// IT IS STILL A PURE HOME. `flow/**/domain.ts` is flow's pure shape, so there is no node:fs, no
// child_process and no process.env here — the bytes are handed over. The reaching is the shells':
// shell.ts for what every harness shares, product.ts for the verbs, archive.ts for `flow facts`.

import { followSteps, GIT_VALUE_OPTS, gitCommand, inScope, isBreadcrumbMoment, isGuardrailMoment, isOption, parseCommandLine, parseShellSteps, programName, resolveFrom, stepCommands, type BreadcrumbMoment, type Ctx, type EntrySpec, type ExecResult, type GuardrailMoment, type LoadedEntry, type LoadResult, type Moment, type Refusal, type SessionFacts, type Settings, type ShellCommand, type ShellStart, type ShellStep, type TurnAction } from "../language/domain.ts";
import { brief, covers, FLOW_DIR, fires, formatBlock, insideRepo, momentsView, namedAgent, universe, watching, type AgentOf, type Block, type Cause, type Bound, type Marks, type Metrics, type Notice, type MomentsView, type Row, type TerrainNode, type Tree } from "../engine/domain.ts";
import { gitCommands, missingGrammarText, quoteArg } from "../checks/domain.ts";
import type {
  Delivered,
  HarnessFacts,
  HookCost,
  HookPayload,
  Registration,
  HookResult,
  ModelRequest,
  Registering,
  Spawn,
  SpawnMeta,
  Steer,
  TranscriptEvent,
} from "./harness.ts";
import { posix } from "node:path";
import { matchAny } from "../glob.ts";



/**
 * The one file that turns anything on, spelled ONCE.
 *
 * It lives in the pure home rather than in the shell that opens it because three things name it
 * and only one of them is a read: the shell looks for it, the CLI defaults to it, and the list of
 * files that ARE the guard here has to include it. A second spelling in that list would leave a
 * renamed config's old name watched and its new one not.
 */
export const CONFIG_FILE = "flow.config.ts";

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
export function configImports(configText: string): readonly string[] {
  const out: string[] = [];
  for (const [, , specifier] of configText.matchAll(/\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g)) {
    if (specifier === undefined || !specifier.startsWith(".")) continue;
    const path = specifier.replace(/^\.\//, "");
    if (path === "" || path.split("/").includes("..")) continue;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

// `delivers` — the reader of the two lists — lives with `flow status`, its only caller, at the foot
// of this file. It takes the entry's KIND as well as the moment, and it has to: a moment that is a
// word in both vocabularies may be delivered for one kind only, and a reader that took the moment
// alone would answer "delivered" for the other, which is the single lie these two lists prevent.

/**
 * Whatever the host put there, as a string — a payload field is JSON and may be anything.
 *
 * A scalar is stringified and everything else is EMPTY, never `[object Object]`: an object where a
 * path was expected is not a path, and a guard that judged a file called `[object Object]` would be
 * asserting something about a file that cannot exist. Empty is falsy, so every caller's own
 * "nothing to judge" branch catches it.
 */
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVENTS — a payload becomes what the engine understands
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One event in the engine's vocabulary, minus the two things the engine's own event types demand
 * and this file cannot know: who the session is (`wearing`, which needs the transcript and the stored
 * verdict) and how far it has drifted (`tokens`, which needs the transcript). The shell adds both,
 * because both come off disk.
 */
export type AdapterEvent =
  | {
      readonly rail: "guard";
      readonly moment: GuardrailMoment;
      readonly command?: string | undefined;
      /** command: the line's parse, made once here and handed to the engine with the line. */
      readonly commands?: Ctx["commands"];
      /** command: where the line started, which the parse followed each command's folder from. */
      readonly start?: ShellStart | undefined;
      readonly turn?: readonly TurnAction[] | undefined;
    }
  | {
      readonly rail: "brief";
      readonly moment: BreadcrumbMoment;
      /** file-change: one file the call changed, relative to the working folder it changed in. */
      readonly path?: string | undefined;
      readonly command?: string | undefined;
    };

/** An event for the breadcrumb rail. */
export type BriefAdapterEvent = Extract<AdapterEvent, { readonly rail: "brief" }>;

/** An absolute path inside the repo → the repo-relative spelling every glob is written against. */
export function relativise(path: string, root: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/**
 * Git's answer as paths, one per line — the plainest shape git has, and the only one flow parses.
 *
 * ONE reader for it in the adapter: `flow status` asks git what it ignores and the realWorld asks
 * for the staged set, and both used to split, trim and drop blank lines under two names. `null` is
 * a command that never ran, and it is no paths.
 */
export function pathLines(stdout: string | null): string[] {
  return (stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

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

/** NUL-separated paths, as git prints them under `-z` — no quoting, so a path is a path. */
function nulPaths(stdout: string): string[] {
  return stdout.split("\0").filter((path) => path !== "");
}

/**
 * The staged changes, read from `git diff --cached --name-status --no-renames -z`.
 *
 * ONE question to git, and every staged change comes back with what it is: `A` added, `D` deleted,
 * anything else changed in place. `--no-renames` splits a rename into the delete and the add it is.
 */
export function stagedChanges(nameStatus: string): StagedChanges {
  const fields = nameStatus.split("\0");
  const files: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? "";
    const path = fields[i + 1] ?? "";
    if (path === "") continue;
    if (status.startsWith("D")) deleted.push(path);
    else {
      files.push(path);
      if (status.startsWith("A")) added.push(path);
    }
  }
  return { files, added, deleted };
}

/**
 * The whole tree, for `flow hook commit --all`, against the last commit's own list.
 *
 * `present` is every file git lists that is on disk; `tree` is `git ls-tree -r --name-only -z
 * HEAD`. It fails in two ways that answer differently. Before the first commit there is no HEAD, so
 * every file is new. Any other failure is unknown: `added` stays undefined, so a check asks the
 * disk and refuses rather than allows. There is no commit, so nothing is deleted.
 */
export function treeChanges(present: readonly string[], tree: ExecResult, hasHead: () => boolean): StagedChanges {
  if (tree.code !== 0) return { files: [...present], added: hasHead() ? undefined : [...present], deleted: [] };
  const inTree = new Set(nulPaths(tree.stdout));
  return { files: [...present], added: present.filter((path) => !inTree.has(path)), deleted: [] };
}

export const ALLOW: HookResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * The banner and the instruction each rail refuses with.
 *
 * One table rather than a sentence per hook function, because the difference between the rails is
 * exactly two strings and everything else about a refusal is identical. The instruction earns its
 * place: "the guard said no" without "and here is what to do now" is how a blocked agent starts
 * guessing at what would satisfy it.
 */
const RAIL: Record<GuardrailMoment, { readonly head: string; readonly tail: string }> = {
  command: { head: "flow — command blocked before it ran", tail: "Adjust the command, then retry." },
  commit: { head: "flow — commit blocked", tail: "Fix the above, then commit again." },
  "turn-end": { head: "flow — turn held open", tail: "Do the above, then end your turn." },
};

/** One refusal, with the rail that made it — the banner is the moment's, not the hook's. */
export interface Refused {
  readonly moment: GuardrailMoment;
  readonly block: Block;
}

/** `a`, `a and b`, `a, b and c` — a list of paths as a sentence reads them. */
export function listed(paths: readonly string[]): string {
  return paths.length <= 1 ? (paths[0] ?? "") : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1) ?? ""}`;
}

/**
 * Every refusal as the one thing a refusal is, or null when nothing refused.
 *
 * It takes NO hook, and that is the point of it existing beside `toResult`: the commit gate is not
 * a hook at all — git spawns it — so rendering its refusals through a hook-shaped function meant
 * naming an event that never happened. The banner comes off the MOMENT, which every rail has,
 * rather than off the event, which only the harness ones do.
 */
export function refused(refusals: readonly Refused[]): HookResult | null {
  const first = refusals[0];
  if (first === undefined) return null;
  const body = refusals.map((refusal) => formatBlock(refusal.block)).join("\n\n");
  const { head, tail } = RAIL[first.moment];
  return { stdout: "", stderr: `\n${head}:\n\n${body}\n\n${tail}\n`, exitCode: 2 };
}

/**
 * The branch a worktree has out, from the text of its own `HEAD` — the session marker's key.
 *
 * A ref name, or the short sha when HEAD is detached, or null when there is nothing there. It is
 * read as a FILE rather than asked of `git`, and at this frequency that matters: the marker is
 * written on every tool call, and a subprocess per keystroke is a cost this answer does not justify.
 * It is also the only form that answers on an unborn branch, where `git rev-parse HEAD` fails
 * outright — which is every repo's own first commit.
 */
export function branchFromHead(head: string): string | null {
  const text = head.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
  return ref?.[1] ?? (text === "" ? null : text.slice(0, 12));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENVIRONMENT — what a spawned tool must not inherit
// ════════════════════════════════════════════════════════════════════════════════════════════════

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
export const GIT_HOOK_ENV: readonly string[] = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_INDEX_VERSION",
  "GIT_QUARANTINE_PATH",
  "GIT_QUARANTINE_ID",
];

/**
 * Does this command read the index the commit is being made from? Only `git diff --cached` does: it
 * is the one read a check makes of what the commit holds, and under `git commit -a` or `git commit
 * <path>` that index is a temporary one that only `GIT_INDEX_FILE` names. Any other command stays
 * hermetic.
 */
export function readsCommitIndex(command: string): boolean {
  return /^git diff --cached(\s|$)/.test(command);
}

/** The environment a check's command should see: this one, minus git's hook plumbing. */
export function hermeticEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const drop = new Set(GIT_HOOK_ENV);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NARRATIVE — what a conversation says, as opposed to what the guard did
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything above this line is deterministic: a payload means one thing, a usage record is a
// number, a sidecar says what it says. Everything below is HEURISTIC and must be labelled as such
// wherever it surfaces — "the human pushed back here" is a guess about a sentence, and a guess
// presented beside a count reads as a count.
//
// It carries its own citation for exactly that reason: every pointer names the transcript line it
// came from, so the reader judges the spot rather than the label.
//
// It lives HERE because it is transcript CONTENT dialect — an assistant block called `tool_use`, a
// user block called `tool_result`, a bare string meaning a typed prompt. The FILE shape is
// `transcriptLines`' one answer, above; if the content format changes, this function changes, and
// if the file format changes, that one does, once.

const ANSI = /\x1b\[[0-9;]*m/g;

/** Text with terminal colour codes taken out — a recorded command line is full of them. */
export function strip(value: unknown): string {
  return text(value).replace(ANSI, "");
}

/**
 * ONE definition of "make this printable and short": strip ANSI, collapse whitespace, cut to `n`
 * — and MARK the cut, because a truncated command with no ellipsis reads as a whole one, and every
 * surface that shows these strings claims to be showing what really happened.
 */
export function snip(value: unknown, n = 140): string {
  const flat = strip(value).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

/**
 * `snip`, cut at the last whole word: a rule's text in the status page is never cut in the middle of
 * a word, so the page reads "…is text…" and never "…is text s…".
 */
export function snipAtWord(value: unknown, n: number): string {
  const flat = snip(value, Number.MAX_SAFE_INTEGER);
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n - 1);
  const whole = flat[n - 1] === " " ? cut : cut.slice(0, Math.max(cut.lastIndexOf(" "), 0));
  return `${whole.trimEnd()}…`;
}

/** What one Bash line was: the recipes it drove, and whether it committed. */
export interface BashClass {
  readonly recipes: readonly string[];
  readonly commits: boolean;
}

/**
 * Read one command line, from its parse. A heredoc's body is text the command is fed, so a file
 * being written that names a recipe is not a run of it — while the line around the heredoc is
 * judged like any other, and so is a body a shell runs. A line that does not parse is nothing: no
 * recipe, no commit.
 */
export function classifyBash(command: unknown): BashClass {
  const commands = parseCommandLine(strip(command)) ?? [];
  const recipes = commands.flatMap((c) => {
    const recipe = programName(c.program) === "just" ? c.args[0] : undefined;
    return recipe !== undefined && /^[a-z][\w-]*$/.test(recipe) ? [recipe] : [];
  });
  return {
    recipes,
    commits: gitCommands({ commands }).some((git) => git.subcommand === "commit"),
  };
}

// ── test runs, decided from the repo's justfile ──

/** A recipe name that starts with one of these runs a test, a build or a gate. */
const TEST_RECIPE_PREFIXES = ["test", "check", "gate", "e2e", "lint", "typecheck", "build"] as const;

/** The shell utilities, which are never a test run even when a counted recipe runs them. */
const SHELL_UTILITIES: ReadonlySet<string> = new Set([
  "cat", "cd", "cp", "echo", "find", "grep", "head", "ls", "mkdir", "mv", "rm", "sed", "sort", "tail", "test", "touch", "true", "wc",
]);

/** Words a recipe body starts a command with that name no program: a shell keyword, or a launcher whose next word is the program. */
const NOT_PROGRAMS: ReadonlySet<string> = new Set(["set", "exit", "node", "npx", "just", "export", "then", "fi", "do", "done", "if", "for", "while", "source"]);

/** The recipe names that count, and the programs those recipes run: what makes a command a test run. */
export interface TestRunRules {
  readonly recipes: ReadonlySet<string>;
  readonly programs: ReadonlySet<string>;
}

/** The recipe a top-level justfile line opens: its name. A setting, an assignment and an attribute line open none. */
function recipeHeaderName(line: string): string | null {
  if (line.startsWith("[") || /^[A-Za-z_][\w-]*\s*:?=/.test(line) || !line.includes(":")) return null;
  const name = /^@?([A-Za-z_][\w-]*)(?:\s|:)/.exec(line)?.[1];
  return name === undefined || name === "set" ? null : name;
}

/** The tool a command runs: its program, or the tool `npx` is asked to run. */
function toolOf(command: ShellCommand): string {
  const program = programName(command.program);
  return program === "npx" ? programName(command.args.find((arg) => !arg.startsWith("-")) ?? "") : program;
}

/**
 * What counts as a test run in a repo: the recipes of its justfile whose name starts with `test`,
 * `check`, `gate`, `e2e`, `lint`, `typecheck` or `build`, those `testRuns` names whole, and the programs
 * those recipes run. Each recipe's body is read through the one parse, as a script, or line by line
 * when it does not parse whole; just's `@` and `-` line prefixes are dropped first. With no justfile
 * only the `testRuns` names count.
 */
export function testRunRules(justfile: string | null, added: readonly string[] = []): TestRunRules {
  const bodies = new Map<string, string[]>();
  let body: string[] | null = null;
  for (const raw of (justfile ?? "").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (!/^\s/.test(raw)) {
      const name = recipeHeaderName(line);
      body = name === null ? null : (bodies.get(name) ?? []);
      if (name !== null) bodies.set(name, body as string[]);
    } else if (body !== null && !line.startsWith("#")) body.push(line.replace(/^[@-]+/, ""));
  }
  const recipes = new Set([...bodies.keys()].filter((name) => TEST_RECIPE_PREFIXES.some((prefix) => name.startsWith(prefix))));
  for (const name of added) recipes.add(name);
  const programs = new Set<string>();
  for (const name of recipes) {
    const lines = bodies.get(name) ?? [];
    const commands = parseCommandLine(lines.join("\n")) ?? lines.flatMap((line) => parseCommandLine(line) ?? []);
    for (const command of commands) {
      const tool = toolOf(command);
      if (command.nested || command.program.includes("/") || !/^[A-Za-z]/.test(tool) || NOT_PROGRAMS.has(tool) || SHELL_UTILITIES.has(tool)) continue;
      programs.add(tool);
    }
  }
  return { recipes, programs };
}

/** Does this shell command line run a test: a counted recipe through `just`, or a program a counted recipe runs? */
export function isTestRun(command: unknown, rules: TestRunRules): boolean {
  return (parseCommandLine(strip(command)) ?? []).some((one) => {
    const tool = toolOf(one);
    return programName(one.program) === "just" ? rules.recipes.has(one.args[0] ?? "") : rules.programs.has(tool);
  });
}

/**
 * The lines a test runner or a build ends its output with when it failed: vitest's and jest's counts, Go's
 * `--- FAIL` and `FAIL`, a TypeScript error, just's failed recipe, an eslint summary, a failed command, make's
 * error. A count of zero failed is no failure, so each count starts at one.
 */
const RUNNER_FAILURE = /(?:Tests?|Test Files):?\s+[1-9]\d* failed|^--- FAIL|^FAIL(?:\b|\t)|error: Recipe `[^`]+` failed|\berror TS\d+|✖ [1-9]\d* problems?|Command failed with exit code|^make: \*\*\*/m;

/** How much of the end of a result is read for a runner's failure line. */
const RESULT_TAIL = 3000;

/** Does a result's output end with a runner's failure line? */
export function endsWithRunnerFailure(output: string): boolean {
  return RUNNER_FAILURE.test(output.slice(-RESULT_TAIL));
}

/** One test run: the command, the transcript line it was called on, and whether it failed: the harness marked its result an error, or its output ends with a runner's failure line. */
export interface TestRun {
  readonly session: string;
  readonly agent: string | null;
  readonly line: number;
  readonly command: string;
  readonly failed: boolean;
}

/** The test runs of the conversation or of one subagent, counted. */
export interface TestRunTotals {
  readonly session: string;
  readonly agent: string | null;
  readonly agentType: string | null;
  readonly runs: number;
  readonly failed: number;
  /** The model requests from each first failed run to the next run that passed, added up. */
  readonly requestsBetween: number;
}

/**
 * The test runs in one transcript, and their totals. A stretch starts at the first failed run and
 * stops at the next run that passes: the requests made after the failed run's call, up to and
 * including the one that called the pass. A run failed when the harness marked its result an error or its output ends with a runner's failure line. A run that fails again inside a stretch adds nothing,
 * and a stretch no run passes after is not counted.
 */
export function testRunsIn(
  who: Pick<TestRunTotals, "session" | "agent" | "agentType">,
  events: readonly TranscriptEvent[],
  requests: readonly ModelRequest[],
  rules: TestRunRules,
): { readonly runs: readonly TestRun[]; readonly totals: TestRunTotals } {
  const failedIds = new Set(events.flatMap((event) => (event.kind === "result" && (event.failed || endsWithRunnerFailure(event.content)) ? [event.id] : [])));
  const runs: TestRun[] = [];
  let between = 0;
  let since: number | null = null;
  for (const event of events) {
    if (event.kind !== "use" || event.action !== "shell" || !isTestRun(event.input["command"], rules)) continue;
    const failed = failedIds.has(event.id);
    runs.push({ session: who.session, agent: who.agent, line: event.line, command: strip(event.input["command"]), failed });
    if (failed) since ??= event.line;
    else if (since !== null) {
      const from = since;
      between += requests.filter((request) => request.line > from && request.line <= event.line).length;
      since = null;
    }
  }
  return { runs, totals: { ...who, runs: runs.length, failed: runs.filter((run) => run.failed).length, requestsBetween: between } };
}

// ── the reading ────────────────────────────────────────────────────────────

/** A pointer into a transcript: the line something came from, and its text. */
export interface Pointer {
  readonly line: number;
  readonly text: string;
  /** Which transcript, once several are merged into one report. */
  readonly session?: string;
}

/** A prompt a person typed, and what Jev is sent about it: the prompt, and the end of the agent's message before it. */
export interface PromptTurn extends Pointer {
  /** What Jev is sent. Left out of a report. */
  readonly asked?: string;
  readonly before?: string;
}

export interface Narrative {
  readonly stats: {
    readonly edits: number;
    readonly writes: number;
    /** Files a Bash command read by name. */
    readonly shellReads: number;
    readonly commits: number;
    readonly recipes: Readonly<Record<string, number>>;
  };
  readonly prompts: readonly PromptTurn[];
  /** The files a shell command read by name, with how often each. */
  readonly shell: { readonly reads: Readonly<Record<string, number>> };
  /** Every in-repo file the session touched, with how often. The facts layer scores coverage. */
  readonly touched: Readonly<Record<string, number>>;
}

// `insideRepo` is the engine's, imported rather than re-spelled: whether a path is a file of this
// repo decides what the narrative counts as touched AND what the record counts as an uncovered
// edit, and those two must never be able to disagree.

/**
 * The narrative reading of one conversation: what it edited, wrote, read and ran.
 *
 * Shell READS come from the transcript, like every Read does, so they are counted in every
 * conversation. A transcript says what command ran, never what it changed, so a shell write is not
 * counted.
 */
export function narrative(events: readonly TranscriptEvent[]): Narrative {
  let edits = 0;
  let writes = 0;
  let shellReads = 0;
  const shell = { reads: {} as Record<string, number> };
  let commits = 0;
  const recipes: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const prompts: PromptTurn[] = [];

  for (const event of events) {
    if (event.kind === "prompt") {
      prompts.push({ line: event.line, text: snip(event.text, 120), asked: event.text.trim().slice(0, JEV_ASKED), before: (event.before ?? "").slice(-JEV_BEFORE) });
      continue;
    }
    if (event.kind !== "use") continue;

    // THE one edit-tool set, the same one the flight recorder stamps a row with. There were two
    // in the old engine and they had already drifted; a fact about the host's tool names is
    // spelled once in this file and read everywhere.
    if (event.action === "edit" || event.action === "write") {
      if (event.action === "write") writes += 1;
      else edits += 1;
      if (insideRepo(event.path)) touched[event.path] = (touched[event.path] ?? 0) + 1;
      continue;
    }
    if (event.action === "read") {
      if (insideRepo(event.path)) touched[event.path] = (touched[event.path] ?? 0) + 1;
      continue;
    }
    if (event.action !== "shell") continue;
    // A file read through the shell is a touch like a Read is; a searched directory is not a file.
    for (const path of event.reads ?? []) {
      touched[path] = (touched[path] ?? 0) + 1;
      shell.reads[path] = (shell.reads[path] ?? 0) + 1;
      shellReads += 1;
    }
    const read = classifyBash(text(event.input["command"]));
    for (const recipe of read.recipes) recipes[recipe] = (recipes[recipe] ?? 0) + 1;
    if (read.commits) commits += 1;
  }

  return {
    stats: { edits, writes, shellReads, commits, recipes },
    prompts,
    shell,
    touched,
  };
}

// ── the prompts, sorted by Jev ──────────────────────────────────────────────

/** The variable that holds the key Jev needs. */
export const JEV_KEY = "TYPESAFE_API_KEY";
/** How much of a prompt, and of the agent's message before it, Jev is sent. */
const JEV_ASKED = 2500;
const JEV_BEFORE = 700;

/** The seven kinds a prompt is sorted into, and what each one is, as Jev is told. */
const KIND_CRITERIA = {
  correction: "Tells the agent it did something wrong, misunderstood, ignored an instruction, or should not have asked. Includes having to repeat an instruction.",
  confusion: "Says they do not understand what the agent wrote or asked.",
  new_direction: "Changes or widens what is wanted, or adds a requirement the agent could not have known.",
  answer: "Answers the agent's question or chooses between its options, without complaint.",
  go_ahead: "Simply approves: go, yes, continue, merge.",
  question: "Asks the agent for information or an explanation.",
  other: "None of these.",
} as const;

export type PromptKind = keyof typeof KIND_CRITERIA;
const KINDS = Object.keys(KIND_CRITERIA) as PromptKind[];

/** What Jev says of one prompt. */
export interface Sorted {
  readonly kind: PromptKind;
  readonly confidence: number;
  readonly frustrated: number;
}

/** A prompt as `flow facts` reports it: shortened, with what Jev said, or nothing when Jev could not be reached. */
export interface Prompt extends Pointer {
  readonly session: string;
  readonly sorted: Sorted | null;
}

/** The body of the one request Jev gets for a prompt: the words, and what the agent said before them. No code and no command. */
export function jevRequest(asked: string, before: string): Record<string, unknown> {
  return {
    model: "jev-latest",
    state: { the_agent_said_before: before, the_person_then_wrote: asked },
    questions: {
      kind: { type: "choice", instructions: "A person directs an AI coding agent. Classify what the person's message mainly is.", criteria: KIND_CRITERIA },
      frustrated: { type: "noul", instructions: "Is the person annoyed or frustrated with the agent in this message?" },
    },
  };
}

/** Jev's reply as a kind, a confidence and a frustration score, or null when it is not shaped like one. */
export function readJevReply(body: unknown): Sorted | null {
  const answers = (body as { answers?: { kind?: { choice?: unknown; confidence?: unknown }; frustrated?: { noul?: unknown } } } | null)?.answers;
  const kind = answers?.kind?.choice;
  const confidence = answers?.kind?.confidence;
  const frustrated = answers?.frustrated?.noul;
  if (typeof kind !== "string" || !(KINDS as string[]).includes(kind)) return null;
  if (typeof confidence !== "number" || typeof frustrated !== "number") return null;
  return { kind: kind as PromptKind, confidence, frustrated };
}

/** The key a `.env` file's text holds, or null. A line is `NAME=value`, with an optional `export` and quotes around the value. */
export function keyInDotenv(dotenv: string): string | null {
  for (const line of dotenv.split("\n")) {
    const found = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(line);
    if (found?.[1] !== JEV_KEY) continue;
    const value = (found[2] ?? "").replace(/^(["'])(.*)\1$/, "$2").trim();
    if (value !== "") return value;
  }
  return null;
}

/** The facts with each prompt's answer from Jev in place (none when Jev was not asked), and the long text each was sent as left out of the narrative. */
export function withPrompts(facts: Facts, sorted: readonly (Sorted | null)[] | null): Facts {
  const turns = facts.narrative.prompts;
  const prompts = turns.map((turn, at): Prompt => ({ line: turn.line, text: turn.text, session: turn.session ?? "", sorted: sorted?.[at] ?? null }));
  const kept = sorted === null ? {} : { prompts };
  return { ...facts, ...kept, narrative: { ...facts.narrative, prompts: turns.map(({ line, text, session }) => ({ line, text, ...(session === undefined ? {} : { session }) })) } };
}

/** The `prompts` line: how many, how many of the two kinds that cost the person something, and how many were frustrated. Null with no prompts. */
export function promptsLine(prompts: readonly Prompt[] | undefined): string | null {
  if (prompts === undefined || prompts.length === 0) return null;
  const count = (kind: PromptKind): number => prompts.filter((one) => one.sorted?.kind === kind).length;
  const parts = [String(prompts.length)];
  for (const kind of ["correction", "confusion"] as const) if (count(kind) > 0) parts.push(`${count(kind)} ${kind}`);
  const frustrated = prompts.filter((one) => (one.sorted?.frustrated ?? 0) >= 0.5).length;
  if (frustrated > 0) parts.push(`${frustrated} frustrated`);
  const unsorted = prompts.filter((one) => one.sorted === null).length;
  if (unsorted > 0) parts.push(`${unsorted} not sorted`);
  return `prompts   ${parts.join(" · ")}`;
}

/**
 * Every narrative reading merged into one, each pointer tagged with the transcript it came from.
 *
 * The report is ONE aggregate whether it read one conversation or a hundred — the flags only
 * re-scope which sessions it covers, never its shape — so this is where the per-session readings
 * stop being chapters and become one list somebody can work down.
 */
export function mergeNarratives(each: readonly { session: string; read: Narrative }[]): Narrative {
  const recipes: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const prompts: PromptTurn[] = [];
  let edits = 0;
  let writes = 0;
  let shellReads = 0;
  let commits = 0;
  const shell = { reads: {} as Record<string, number> };
  const add = (into: Record<string, number>, from: Readonly<Record<string, number>>): void => {
    for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
  };

  for (const { session, read } of each) {
    prompts.push(...read.prompts.map((prompt) => ({ ...prompt, session })));
    edits += read.stats.edits;
    writes += read.stats.writes;
    shellReads += read.stats.shellReads;
    commits += read.stats.commits;
    add(recipes, read.stats.recipes);
    add(touched, read.touched);
    add(shell.reads, read.shell.reads);
  }
  return { stats: { edits, writes, shellReads, commits, recipes }, prompts, shell, touched };
}

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
export function guardPaths(configText: string | null, hostSurface: readonly string[]): readonly string[] {
  const paths: string[] = [CONFIG_FILE];
  for (const file of configImports(configText ?? "")) {
    if (!paths.includes(file)) paths.push(file);
    const dir = file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/**` : null;
    if (dir !== null && !paths.includes(dir)) paths.push(dir);
  }
  return [...paths, ...hostSurface];
}

/** Is this one of the files that decides what the guard does? */
export function isGuardPath(path: string, paths: readonly string[]): boolean {
  return path !== "" && matchAny(path, paths.flatMap((glob) => [glob, `**/${glob}`]));
}

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
export function weakenedAfterBlock(
  rows: readonly Row[],
  events: readonly TranscriptEvent[],
  paths: readonly string[],
): Weakening[] {
  const blocked = rows
    .filter((row) => row.kind === "guardrail" && row["out"] === "deny" && typeof row["ts"] === "string")
    .map((row) => ({ entry: typeof row["id"] === "string" ? row["id"] : null, ts: row["ts"] as string }));
  const edits = events
    .filter((e): e is Extract<TranscriptEvent, { kind: "use" }> => e.kind === "use")
    .filter((e) => (e.action === "edit" || e.action === "write") && e.ts !== null && isGuardPath(e.path, paths))
    .sort((a, b) => (a.ts as string).localeCompare(b.ts as string));

  const out: Weakening[] = [];
  for (const block of blocked) {
    const after = edits.find((e) => (e.ts as string) > block.ts);
    if (after === undefined) continue;
    out.push({
      entry: block.entry,
      line: after.line,
      path: after.path,
      gapSeconds: Math.round((Date.parse(after.ts as string) - Date.parse(block.ts)) / 1000),
    });
  }
  return out;
}

// ── which conversations a run covers ───────────────────────────────────────
//
// The archival side's scope is the UNREFLECTED BACKLOG: every transcript in the store whose
// session id has not been marked dealt-with. That is deliberately the STORE and not the log —
// history from before flow was installed is exactly what a first reading most wants to see, and a
// scope taken from the log could only ever show the repo what it already knew.
//
// Everything this returns in `analyse` is analysed AND markable. The excluded ones never are, so a
// capped run cannot declare skipped history done and quietly lose it.

/** One transcript, as the selector needs it: enough to order by, and nothing it has to open. */
/**
 * Does a transcript recorded in `cwd` belong to the repo at `root`? Yes when it started in `root` or
 * inside it, and not inside another worktree nested under `root`, such as `.claude/worktrees/x`: that
 * worktree's sessions are its own. A transcript that names no folder is kept, as it always was.
 * `nested` is every other worktree of the repository that lies under `root`.
 */
export function belongsToRepo(cwd: string | null, root: string, nested: readonly string[]): boolean {
  if (cwd === null) return true;
  return within(cwd, root) && !nested.some((folder) => folder !== root && within(cwd, folder));
}

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
  readonly excluded: readonly { readonly id: string; readonly reason: "limit" | "since" }[];
  readonly counts: { readonly backlog: number; readonly analysed: number; readonly excluded: number };
}

/** When a conversation happened: its own first timestamp, falling back to the file's mtime. */
function timeOf(candidate: Candidate): number {
  const started = Date.parse(String(candidate.started));
  return Number.isFinite(started) ? started : candidate.mtimeMs;
}

/** The backlog, ordered and narrowed — and an honest account of what was left out, and why. */
export function selectSessions(
  candidates: readonly Candidate[],
  done: ReadonlySet<string>,
  opts: SelectOpts = {},
): Selection {
  const { limit = null, all = false, largest = false, since = null } = opts;
  const backlog = candidates.filter((c) => !done.has(c.id));

  const byNewest = (a: Candidate, b: Candidate): number => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id);
  const byLargest = (a: Candidate, b: Candidate): number => b.bytes - a.bytes || byNewest(a, b);
  const ordered = [...backlog].sort(largest ? byLargest : byNewest);

  const excluded: { id: string; reason: "limit" | "since" }[] = [];
  let kept = ordered;
  if (since !== null) {
    kept = ordered.filter((c) => timeOf(c) >= since);
    for (const c of ordered) if (timeOf(c) < since) excluded.push({ id: c.id, reason: "since" });
  }

  let analyse = kept;
  if (!all && limit !== null && limit >= 0 && kept.length > limit) {
    analyse = kept.slice(0, limit);
    for (const c of kept.slice(limit)) excluded.push({ id: c.id, reason: "limit" });
  }

  return {
    analyse,
    excluded,
    counts: { backlog: backlog.length, analysed: analyse.length, excluded: excluded.length },
  };
}

// ── the fail-loud header on every number below it ──────────────────────────
//
// A record with nothing in it and a guard that never ran look identical in a table of zeroes, and
// the second reads as "a calm week" to anyone — including a coach recommending which rules to
// retire. So the reading carries its own health line, and the one thing it must never do is
// present an unarmed repo's silence as evidence.

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
  /** How many conversations were found to read, read or not. */
  readonly transcripts: number;
}

/** What a reader must know before believing anything under it. */
export function health({ armed, rows, withRecord, analysed, transcripts }: HealthArgs): Health {
  if (!armed && transcripts > 0)
    return {
      blocked: null,
      warn: [
        "no session log was found, so everything read from the log is missing — the recorded counts, blocks, leads and dead rules. " +
          "Everything read from the transcripts is here.",
      ],
    };
  if (!armed)
    return {
      blocked:
        "the record is NOT ARMED — no stream has ever been written here, so there are no numbers. " +
        'This is not "nothing happened".',
      warn: [],
    };
  const warn: string[] = [];
  if (analysed > 0 && withRecord === 0)
    warn.push(
      "none of the conversations read has a stream of its own — the hooks did not record for them, " +
        "so everything below is narrative only.",
    );
  else if (rows === 0) warn.push("the record is armed and holds no events for what was read.");
  return { blocked: null, warn };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READING — what the record and the conversations add up to, and how it reads
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The SHAPE lives here and the gathering lives in the shell next door, for the reason every other
// split in this package exists: what a reading says is a decision and gets a test; opening the
// files it says it about is not. That includes the prose — `formatFacts` is the whole of what a
// person sees, and thirty lines of branching sentences in a CLI shell is thirty lines nothing can
// assert.

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
export function joinSpawn(args: {
  readonly session: string;
  readonly agent: string;
  readonly meta: SpawnMeta | null;
  readonly spawns: ReadonlyMap<string, Spawn>;
}): SpawnRecord {
  const { session, agent, meta, spawns } = args;
  const from = meta?.toolUseId === undefined || meta.toolUseId === null ? undefined : spawns.get(meta.toolUseId);
  return {
    session,
    agent,
    agentType: meta?.agentType ?? null,
    // The sidecar's description is the human label the spawn was filed under; the parent's block
    // carries the same text, so either answers and the host-written one wins.
    description: meta?.description ?? from?.description ?? null,
    model: meta?.model ?? null,
    asked: from?.asked ?? null,
    at: from?.ts ?? null,
    line: from?.line ?? null,
  };
}

// ── model requests, and the guardrails that refused ──

/** What one conversation, or one of its subagents, asked of a model: how often, how large, and which. */
export interface RequestsEntry {
  readonly session: string;
  /** The harness's id for the subagent; null for the conversation itself. */
  readonly agent: string | null;
  readonly agentType: string | null;
  readonly requests: number;
  /** The most tokens any one request's context held. */
  readonly largestContext: number;
  /** The model that served most of the requests; the first of them on a tie. Null when none was named. */
  readonly model: string | null;
}

/** Requests, largest context and model of one transcript's model requests. */
export function requestsEntry(who: Pick<RequestsEntry, "session" | "agent" | "agentType">, list: readonly ModelRequest[]): RequestsEntry {
  const served = new Map<string, number>();
  let largestContext = 0;
  for (const request of list) {
    largestContext = Math.max(largestContext, request.context);
    if (request.model !== null) served.set(request.model, (served.get(request.model) ?? 0) + 1);
  }
  let model: string | null = null;
  let most = 0;
  for (const [name, n] of served)
    if (n > most) {
      model = name;
      most = n;
    }
  return { ...who, requests: list.length, largestContext, model };
}

/** One refusal found in a transcript: where, and whether the command that came next was another one. */
export interface GuardRefusal {
  readonly session: string;
  readonly agent: string | null;
  readonly line: number;
  readonly differed: boolean;
}

/** Every refusal of one guardrail. */
export interface GuardrailRefusals {
  readonly entry: string;
  readonly refusals: readonly GuardRefusal[];
}

/** A guardrail's refusal as it reaches the agent: `✗ <pack>.<entry>` at the start of a line of a failed call's result. */
const REFUSAL_HEAD = /^✗ ([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/gm;

/**
 * The refusals in one conversation's events, each with the guardrail that refused it and whether the next
 * call differed. A refusal is a failed result that holds `✗ <entry>` at a line start. The next call is the
 * first call after the result; it differed when its tool or its input is not the refused call's, and it did
 * not when it repeated the call or when no call came after.
 */
export function refusalsIn(who: Pick<GuardRefusal, "session" | "agent">, events: readonly TranscriptEvent[]): { readonly entry: string; readonly refusal: GuardRefusal }[] {
  const out: { entry: string; refusal: GuardRefusal }[] = [];
  const same = (a: TranscriptEvent, b: TranscriptEvent): boolean => a.kind === "use" && b.kind === "use" && a.name === b.name && JSON.stringify(a.input) === JSON.stringify(b.input);
  events.forEach((event, at) => {
    if (event.kind !== "result" || !event.failed) return;
    const entries = new Set([...event.content.matchAll(REFUSAL_HEAD)].map((match) => match[1] as string));
    if (entries.size === 0) return;
    const refusedCall = events.find((other) => other.kind === "use" && other.id === event.id);
    const next = events.slice(at + 1).find((other) => other.kind === "use");
    const differed = refusedCall !== undefined && next !== undefined && !same(refusedCall, next);
    for (const entry of entries) out.push({ entry, refusal: { ...who, line: event.line, differed } });
  });
  return out;
}

/** Each guardrail's refusals across conversations, the most refused first. */
export function groupRefusals(found: readonly { readonly entry: string; readonly refusal: GuardRefusal }[]): GuardrailRefusals[] {
  const by = new Map<string, GuardRefusal[]>();
  for (const { entry, refusal } of found) by.set(entry, [...(by.get(entry) ?? []), refusal]);
  return [...by]
    .map(([entry, refusals]) => ({ entry, refusals }))
    .sort((a, b) => b.refusals.length - a.refusals.length || a.entry.localeCompare(b.entry));
}

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
export function uncoveredAreas(touched: Readonly<Record<string, number>>, entries: readonly Bound[]): Uncovered[] {
  const scoped = watching(entries);
  return Object.entries(touched)
    .filter(([path]) => !scoped.some((e) => covers(e, path)))
    .map(([path, touches]) => ({ path, touches }))
    .sort((a, b) => b.touches - a.touches || a.path.localeCompare(b.path));
}

/** The permission mode the last recorded call was made under, or null when no row states one. */
export function lastMode(rows: readonly Row[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as Row;
    if (row.kind === "tool" && typeof row["mode"] === "string" && row["mode"] !== "") return row["mode"];
  }
  return null;
}

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
export function modesOf(each: readonly { readonly rows: readonly Row[]; readonly steer: Steer | null }[]): Modes {
  const calls: Record<string, number> = {};
  const variants: Record<string, number> = {};
  let auto = 0;
  let steered = 0;
  for (const { rows, steer } of each) {
    for (const row of rows) if (row.kind === "tool" && typeof row["mode"] === "string") calls[row["mode"]] = (calls[row["mode"]] ?? 0) + 1;
    if (steer === null) continue;
    auto += 1;
    if (!steer.shellFirst) continue;
    steered += 1;
    if (steer.variant !== null) variants[steer.variant] = (variants[steer.variant] ?? 0) + 1;
  }
  return { calls, auto, steered, variants };
}

/**
 * The recorded sessions that a transcript stands behind, and the ids of those left out.
 *
 * A log with no conversation behind it is not a session someone had: a replay script writes one for
 * every command it feeds the hook. `transcribed` is every conversation of this repo a store holds, or null
 * when there is none to compare with, which keeps every log rather than dropping the lot.
 */
export function backedByTranscript<T extends { readonly session: string }>(
  history: readonly T[],
  transcribed: ReadonlySet<string> | null,
): { readonly kept: readonly T[]; readonly excluded: readonly string[] } {
  if (transcribed === null) return { kept: history, excluded: [] };
  return {
    kept: history.filter((one) => transcribed.has(one.session)),
    excluded: history.filter((one) => !transcribed.has(one.session)).map((one) => one.session),
  };
}

export interface Facts {
  /** What the harness is called in a sentence. */
  readonly host: string;
  readonly root: string;
  readonly store: { readonly dir: string; readonly exists: boolean; readonly ignored: readonly string[] };
  /** Which conversations this run covers, and which it deliberately deferred. */
  readonly selection: Selection;
  readonly coverage: { readonly analysed: number; readonly withRecord: number; readonly narrativeOnly: number };
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
  /** Model requests, largest context and model, for each conversation read and each of its subagents. */
  readonly requests: readonly RequestsEntry[];
  /** Each test run, and the totals for each conversation and each of its subagents. */
  readonly testRuns: { readonly runs: readonly TestRun[]; readonly totals: readonly TestRunTotals[] };
  /** For each guardrail that refused in a transcript: every refusal, and whether the next command differed. */
  readonly refusals: readonly GuardrailRefusals[];
  /** A rail refused, and then somebody edited the guard. A pointer, never an accusation. */
  readonly weakened: readonly Weakening[];
  /** The permission modes the read conversations ran under, and the auto-mode steer. */
  readonly modes: Modes;
  /** How many conversations were marked read, when asked for. Null when not asked. */
  readonly marked: number | null;
  /** Each prompt with its kind, confidence and frustration score from Jev. Absent without Jev. */
  readonly prompts?: readonly Prompt[];
}

/** Text safe inside HTML. */
function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The report's colours: the work + flow tokens, ink first and paper under a light preference. The values are `docs/agent/brand/tokens.json`'s. */
const REPORT_STYLE = `
:root{--bg:#0d0e11;--bg-panel:#15161b;--bg-rule:#2a2c33;--fg:#f3f0e9;--fg-muted:#8b8d98;--flow:#22dfa8;--work:#ff6a3d;--danger:#ff5c5c;
--sans:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:light){:root{--bg:#f3f0e9;--bg-panel:#faf8f3;--bg-rule:#dcd8cf;--fg:#0d0e11;--fg-muted:#5f6170;--flow:#0b7557;--work:#c2491f;--danger:#b3261e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:400 17px/1.6 var(--sans)}
.in{max-width:900px;margin:0 auto;padding:48px 16px 96px}
.wm{font:700 44px/1 var(--sans);letter-spacing:-0.04em;color:var(--flow)}
.wm i{font-style:normal;color:var(--work)}
.kind,h2,th{font:500 12px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted)}
h1{margin:8px 0 0;font:700 32px/1.2 var(--sans);letter-spacing:-0.02em}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;border:1px solid var(--bg-rule);border-radius:14px;background:var(--bg-rule);margin:32px 0 0;overflow:hidden}
.tile{padding:16px 24px;background:var(--bg-panel)}
.tile b{display:block;font:700 26px/1.2 var(--mono);font-variant-numeric:tabular-nums}
.tile span{font-size:15px;color:var(--fg-muted)}
.bad b{color:var(--danger)}
h2{margin:48px 0 12px}
table{width:100%;border-collapse:collapse;background:var(--bg-panel);border:1px solid var(--bg-rule);border-radius:14px;font-size:15px}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--bg-rule)}
td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
code{font:400 .92em var(--mono)}
p{color:var(--fg-muted);font-size:15px}
`;

/** A table of rows, each a list of cells, with the columns after the first set as numbers. */
function reportTable(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const cell = (tag: string, value: string | number, at: number): string => `<${tag}${at === 0 ? "" : ' class="n"'}>${escaped(String(value))}</${tag}>`;
  return `<table><thead><tr>${head.map((one, at) => cell("th", one, at)).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((one, at) => cell("td", one, at)).join("")}</tr>`).join("")}</tbody></table>`;
}

/**
 * The reading as one HTML page in the work + flow colours and type: the totals of requests, failed
 * test runs, refusals and prompts, a row per conversation, the refusals per guardrail, and the
 * prompts by kind. A conversation's row adds its subagents to it. With no prompts in the facts,
 * the page has no prompts.
 */
export function reportPage(facts: Facts): string {
  const sessions = [...new Set([...facts.requests.map((one) => one.session), ...facts.testRuns.totals.map((one) => one.session)])];
  const conversations = sessions.map((session) => {
    const mine = facts.requests.filter((one) => one.session === session);
    return [session, mine.reduce((n, one) => n + one.requests, 0), facts.testRuns.totals.filter((one) => one.session === session).reduce((n, one) => n + one.failed, 0), tokensShort(Math.max(0, ...mine.map((one) => one.largestContext)))];
  });
  const requests = facts.requests.reduce((n, one) => n + one.requests, 0);
  const failed = facts.testRuns.totals.reduce((n, one) => n + one.failed, 0);
  const refusals = facts.refusals.reduce((n, one) => n + one.refusals.length, 0);
  const tile = (value: number, label: string, bad = false): string => `<div class="tile${bad ? " bad" : ""}"><b>${value}</b><span>${label}</span></div>`;
  const tiles = [tile(requests, "model requests"), tile(failed, "failed test runs", failed > 0), tile(refusals, "refusals", refusals > 0), ...(facts.prompts === undefined ? [] : [tile(facts.prompts.length, "prompts")])];
  const kinds = facts.prompts === undefined ? [] : KINDS.map((kind) => [kind, facts.prompts?.filter((one) => one.sorted?.kind === kind).length ?? 0] as const).filter(([, n]) => n > 0);
  const sections = [
    `<h2>Conversations</h2>${conversations.length === 0 ? "<p>No conversation was read.</p>" : reportTable(["Conversation", "Requests", "Failed test runs", "Largest context"], conversations)}`,
    `<h2>Refusals per guardrail</h2>${refusals === 0 ? "<p>No guardrail refused.</p>" : reportTable(["Guardrail", "Refusals", "Next command differed"], facts.refusals.map((one) => [one.entry, one.refusals.length, one.refusals.filter((r) => r.differed).length]))}`,
    ...(facts.prompts === undefined ? [] : [`<h2>Prompts by kind</h2>${kinds.length === 0 ? "<p>No prompt was sorted.</p>" : reportTable(["Kind", "Prompts"], kinds)}`]),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flow facts</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;700&display=swap">
<style>${REPORT_STYLE}</style>
</head>
<body><div class="in">
<div class="wm">flow<i>.</i></div>
<div class="kind">facts</div>
<h1>What the conversations say about this repo</h1>
<div class="tiles">${tiles.join("")}</div>
${sections.join("\n")}
</div></body>
</html>
`;
}

/** A token count as a person reads it: `214k` from a thousand up. */
function tokensShort(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}k`;
}

/** A model's name without its vendor: `claude-opus-5-5` is `opus-5-5`. */
function modelShort(model: string): string {
  return model.replace(/^claude-/, "");
}

/** The `requests` line: every request, and the largest context any one held. Null when nothing was read. */
function requestsLine(entries: readonly RequestsEntry[]): string | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((n, entry) => n + entry.requests, 0);
  return `requests  ${total} · largest context ${tokensShort(Math.max(...entries.map((entry) => entry.largestContext)))}`;
}

/** The `models` line: the conversation, then each kind of subagent with its model, counted when more than one. */
function modelsLine(entries: readonly RequestsEntry[]): string | null {
  const kinds = new Map<string, number>();
  for (const entry of entries) {
    if (entry.model === null) continue;
    const key = `${entry.agent === null ? "conversation" : (entry.agentType ?? "agent")} ${modelShort(entry.model)}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  if (kinds.size === 0) return null;
  return `models    ${[...kinds].map(([key, n]) => (n === 1 ? key : `${key} ×${n}`)).join(" · ")}`;
}

/** The `tests` line: every run, how many failed, and the requests between a failed run and the next pass. Null when nothing ran. */
function testsLine(totals: readonly TestRunTotals[]): string | null {
  const runs = totals.reduce((n, one) => n + one.runs, 0);
  if (runs === 0) return null;
  const sum = (pick: (one: TestRunTotals) => number): number => totals.reduce((n, one) => n + pick(one), 0);
  return `tests     ${runs} runs · ${sum((one) => one.failed)} failed · ${sum((one) => one.requestsBetween)} requests between a failed run and the next pass`;
}

/** The `refused` line: each guardrail with how often it refused, then how often the next command differed. Null when none refused. */
function refusedLine(refusals: readonly GuardrailRefusals[]): string | null {
  if (refusals.length === 0) return null;
  const differed = refusals.reduce((n, one) => n + one.refusals.filter((refusal) => refusal.differed).length, 0);
  return `refused   ${[...refusals.slice(0, HEADLINE).map((one) => `${one.entry} ${one.refusals.length}×`), ...(refusals.length > HEADLINE ? [`…and ${refusals.length - HEADLINE} more`] : []), `the next command differed ${differed}×`].join(" · ")}`;
}

/** How many gaps and how many actors a headline lists before it stops being a headline. */
const HEADLINE = 5;

/** A tally of paths as one line: the most-hit first, a count where it is more than one, then the rest counted. */
function pathList(tally: Readonly<Record<string, number>>): string {
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, HEADLINE).map(([path, n]) => (n === 1 ? path : `${path} ${n}×`));
  return shown.join(" · ") + (ranked.length > HEADLINE ? ` · …and ${ranked.length - HEADLINE} more` : "");
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
export function formatFacts(facts: Facts): string[] {
  const lines: string[] = [];
  if (facts.health.blocked !== null) lines.push(`✗ ${facts.health.blocked}`);
  for (const warn of facts.health.warn) lines.push(`⚠ ${warn}`);

  const { span, headline } = facts.metrics;
  lines.push(
    `flow facts — ${facts.coverage.analysed} of ${facts.selection.counts.backlog} unread conversations · ` +
      `${facts.coverage.withRecord} with a record · ` +
      (facts.store.exists ? facts.store.dir : `no store at ${facts.store.dir}`),
    `  recorded  ${span.tools.toLocaleString()} tool calls · ${span.sessions} chats · ${span.days}d` +
      (span.ample ? "" : " (too thin to call anything dead)"),
    `  blocks    ${headline.blocks}`,
    `  lead      ` +
      (headline.lead.median === null ? "nothing measurable yet" : `median ${headline.lead.median} tool calls`),
  );

  for (const gap of headline.gaps.slice(0, HEADLINE))
    lines.push(`  gap       ${gap.area} — ${gap.edits} edit${gap.edits === 1 ? "" : "s"}, nothing watches it`);
  if (facts.withoutTranscript.length > 0)
    lines.push(`  excluded  ${facts.withoutTranscript.length} recorded session${facts.withoutTranscript.length === 1 ? "" : "s"} with no transcript behind ${facts.withoutTranscript.length === 1 ? "it" : "them"}`);
  if (headline.dead.length > 0) lines.push(`  dead      ${headline.dead.join(" · ")}`);
  if (headline.retire.length > 0) lines.push(`  retire    ${headline.retire.join(" · ")} — bound, never once reached`);
  if (headline.quiet.length > 0)
    lines.push(`  quiet     ${headline.quiet.map((q) => `${q.id} (${q.daysSince}d)`).join(" · ")}`);

  for (const line of [requestsLine(facts.requests), modelsLine(facts.requests), testsLine(facts.testRuns.totals), refusedLine(facts.refusals), promptsLine(facts.prompts)]) if (line !== null) lines.push(`  ${line}`);

  const { stats, shell } = facts.narrative;
  lines.push(
    `  session   ${stats.edits} edits · ${stats.writes} writes · ` +
      `${stats.shellReads} shell reads · ${stats.commits} commits`,
  );
  // THE PATHS BEHIND THE SHELL COUNT, so a number that went round the read tools can be followed.
  if (stats.shellReads > 0) lines.push(`  shell     read ${pathList(shell.reads)}`);
  const modes = Object.entries(facts.modes.calls).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (modes.length > 0 || facts.modes.auto > 0) {
    const variants = Object.entries(facts.modes.variants).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    lines.push(
      `  mode      ${modes.length === 0 ? "no call recorded a mode" : modes.map(([mode, n]) => `${mode} ${n} call${n === 1 ? "" : "s"}`).join(" · ")}` +
        (facts.modes.auto === 0
          ? ""
          : ` — ${facts.modes.steered} of ${facts.modes.auto} auto-mode conversation${facts.modes.auto === 1 ? "" : "s"} steered towards shell edits` +
            (variants.length === 0 ? "" : ` (${variants.map(([variant, n]) => `${variant} ${n}`).join(" · ")})`)),
    );
  }
  // The transcript's own coverage answer, which reaches conversations the record cannot.
  for (const area of facts.uncovered.slice(0, HEADLINE))
    lines.push(`  unwatched ${area.path} — touched ${area.touches}×, no entry reaches it`);
  for (const actor of facts.actors.slice(0, HEADLINE))
    lines.push(
      `  actor     ${actor.agentType ?? "unknown"}${actor.asked !== null && actor.asked !== actor.agentType ? ` (spawned as ${actor.asked})` : ""}` +
        (actor.description === null ? "" : ` — ${actor.description}`),
    );
  if (facts.actors.length > HEADLINE) lines.push(`            …and ${facts.actors.length - HEADLINE} more`);

  for (const weak of facts.weakened)
    lines.push(
      `  ⚠ the guard was edited after ${weak.entry ?? "a block"} refused — ` +
        `${weak.path}:L${weak.line}, ${weak.gapSeconds}s later`,
    );
  if (facts.marked !== null) lines.push(`  marked    ${facts.marked} conversation(s) read`);
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCT SURFACE — `flow init` and `flow status`
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The two verbs a PERSON types at a repo, as against the two the harness invokes. They live in the
// adapter because both are about the host: init writes the harness's own hook registrations and
// git's own commit-msg hook, and status reports whether those wirings are there. Neither could sit
// upstream — the engine is not allowed to know that a settings file exists.
//
// The split with the shell next door (product.ts) is the one this package keeps everywhere: what to
// write given what is already there, and what to SAY given what loaded, are decisions and live
// here; the stat, the write and the subprocess do not.

/**
 * The node version flow's config loader needs, and why it is a floor rather than a preference.
 *
 * A `flow.config.ts` is TypeScript and is loaded by node's own type stripping — there is no
 * transpile step and there will not be one, because a guard that compiles its own config is a guard
 * with a build to go wrong. Stripping is flag-free from node 24 (the Active LTS), so that is the
 * floor `engines` states and the number this sentence names.
 */
export const NODE_FLOOR = 24;

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
export function loadsAsStrippedModule(url: string): boolean {
  if (!url.startsWith("file://")) return false;
  const path = url.split(/[?#]/)[0] ?? url;
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
  return !path.includes("/node_modules/");
}

/**
 * The one sentence for "this config would not load", and the one place a version floor is named.
 *
 * A node too old to strip types fails on the IMPORT, with a syntax error about a colon. That is a
 * machine fact arriving as a parse error — the least actionable shape a true statement can take —
 * so it is rewritten here, once, for both readers: the `flow test` verb and the live hook rail,
 * which would otherwise describe one breakage two ways.
 */
export function configLoadFault(file: string, message: string, nodeVersion: string): string {
  const stripping = /Unexpected token|Unknown file extension|strip|SyntaxError/i.test(message);
  return stripping
    ? `flow: ${file} could not be loaded as TypeScript. flow needs Node >= ${NODE_FLOOR}, where type stripping is on by default; this is node ${nodeVersion}. (${message})`
    : `flow: ${file} could not be loaded — ${message}`;
}

/**
 * The repo's bin folder, relative to the repo root. flow never runs a `flow` from here: any package
 * can install one (Facebook's `flow-bin` does), and nothing guards the folder. `hostPath` drops it
 * from the PATH npm hands one run.
 */
export const LOCAL_BIN = "node_modules/.bin";

/** Where the repo's own `@jawache/flow` is, relative to the repo root: a dev dependency, or init's link. */
export const PACKAGE_DIR = "node_modules/@jawache/flow";

/** That package's own binary — the file its `bin` names. */
export const PACKAGE_BIN = `${PACKAGE_DIR}/dist/flow.mjs`;

/**
 * The repo-first half of a caller of flow: run the repo's own package's binary when it is there.
 * `root` is how the shell names the repo: the variable the harness names for a hook, `$PWD` for git's.
 */
export function repoFirst(root: string, verb: string): string {
  return `f="${root}/${PACKAGE_BIN}"; [ -f "$f" ] && exec node "$f" ${verb}`;
}

// ── the git gate ─────────────────────────────────────────────────────────────

/**
 * WHERE THE GATE LIVES, spelled once for everyone who names it.
 *
 * Four readers say these two paths — the hook `init` writes, the report that names the write, the
 * fitting `status` checks, and the shell next door that stats the file. Spelled four times, a rename
 * would leave one reader writing a path another never looks at, and the failure is the silent kind:
 * a green report over a gate git is not running.
 */
export const HOOKS_DIR = ".githooks";

export const GATE_PATH = `${HOOKS_DIR}/commit-msg`;

/** Where releases before 0.4 wrote the gate: git's pre-commit hook, which runs before git has the message. */
export const OLD_GATE_PATH = `${HOOKS_DIR}/pre-commit`;

/** What arms git, said the way a person types it — the report's line and the fitting's fix. */
export const SET_HOOKS_PATH = `git config core.hooksPath ${HOOKS_DIR}`;

/**
 * The gate's line that runs the repo's own `@jawache/flow` first: git runs the hook from the repo's
 * root, so `$PWD` is the repo. Written by `init`, looked for by `status`, and named in its fixes.
 */
export const GATE_LOCAL_LINE = repoFirst("$PWD", 'hook commit "$1"');

/** The gate's line that runs flow, last, so its exit code is the hook's. `$1` is the file git holds the message in. */
export const GATE_RUN_LINE = 'exec flow hook commit "$1"';

/**
 * How to arm a gate flow will not write over, in the ONE wording both readers use. Both of the
 * gate's lines: the run line alone finds flow on the PATH alone, and a repo with flow only as a dev
 * dependency then fails every commit.
 *
 * `init` says it about the hook it just declined to overwrite; `status` says it about the hook it
 * found unarmed. The same instruction, at the two moments a person can meet it — and two spellings
 * of an instruction are two instructions the day one of them is edited.
 */
export const ADD_THE_GATE_LINE = `add \`${GATE_LOCAL_LINE}\` and then \`${GATE_RUN_LINE}\` to the end of it`;

/**
 * How to bring a gate written for the old verb up to date, in the ONE wording both readers use.
 *
 * The old hook still runs the gate, which is why it is not simply broken: it hands flow a list that
 * leaves out deletions, and exits before calling flow at all when a commit only deletes files.
 * `status` says that much; this is the instruction alone, so it ends `init`'s sentence cleanly.
 */
export const UPDATE_THE_GATE_LINE = `replace its \`flow commit …\` line with \`${GATE_LOCAL_LINE}\` and then \`${GATE_RUN_LINE}\``;

/**
 * The commit-message hook, verbatim.
 *
 * `flow hook commit "$1"` — git's hook under the same verb as the harness's hooks, handed the file
 * git holds the message in. It passes no list of files: flow asks git what the commit adds, changes
 * and deletes, so there is one source of the staged set whoever calls the gate, and nothing in this
 * file to filter it or to skip flow when it is empty.
 */
export const COMMIT_MSG = `#!/bin/sh
# The flow commit gate. Written by \`flow init\`; \`${SET_HOOKS_PATH}\` arms it.
#
# Every commit guardrail runs here, once, over the staged changes and the message, and a block exits
# non-zero, which is how git refuses the commit. It fires for a human's commit as well as an
# agent's, with no session in the room. flow asks git itself what the commit adds, changes and
# deletes.
#
# git runs this from the repo's root, so the repo's own @jawache/flow, a dev dependency's, runs
# before any flow on the PATH.
${GATE_LOCAL_LINE}
${GATE_RUN_LINE}
`;

/** A hook's commands, without its comments — a comment that names the gate does not run it. */
function hookCommands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/** Does this commit-msg hook call flow's gate? Asked by `init` before writing, and by `status` after. */
export function armsFlow(text: string | null): boolean {
  return text !== null && /(^|[\s"'/\\])flow\s+hook\s+commit\b/m.test(hookCommands(text));
}

/** Does it call the gate's OLD verb, `flow commit` — a gate that runs, and misses deletions? */
export function armsOldFlow(text: string | null): boolean {
  return text !== null && /(^|[\s"'/\\])flow\s+commit\b/m.test(hookCommands(text));
}

/**
 * THE GATE'S LINES AS EARLIER RELEASES WROTE THEM, so `flow uninstall` recognises a repo an older
 * flow set up. Up to 0.2.1 the gate listed the staged files and handed them to `flow commit`, and a
 * kept hook was told to add `flow commit $(git diff --cached --name-only)`; 0.2.2 and 0.2.3 wrote
 * `GATE_RUN_LINE` alone, and told a kept hook to add `flow hook commit`.
 */
const OLD_GATE_SETUP = ["staged=$(git diff --cached --name-only --diff-filter=ACMR)", '[ -z "$staged" ] && exit 0'];

const OLD_GATE_RUNS = [
  "exec flow commit $staged",
  "flow commit $(git diff --cached --name-only)",
  "flow hook commit",
  // 0.3's pre-commit hook, which passed no message file.
  repoFirst("$PWD", "hook commit"),
  "exec flow hook commit",
];

/** The lines of a gate that run flow, today's and every older release's: what uninstall takes out of a hook it keeps. */
const GATE_RUNS: ReadonlySet<string> = new Set([GATE_LOCAL_LINE, GATE_RUN_LINE, ...OLD_GATE_RUNS]);

/** Every command line a `flow init` has written into the gate: a hook of these and comments alone is flow's whole file. */
const GATE_WRITTEN: ReadonlySet<string> = new Set([...GATE_RUNS, ...OLD_GATE_SETUP]);

/**
 * A hook with flow taken out: `delete` when every command in it is one a `flow init`
 * wrote, the hook less the lines that run flow when it holds commands of its own, and null when no
 * line of it is flow's. A line is flow's only when it is, trimmed, exactly one flow wrote: a line
 * somebody spelled themselves is theirs to remove.
 */
export function gateWithoutFlow(text: string | null): { readonly delete: true } | { readonly delete: false; readonly body: string } | null {
  if (text === null) return null;
  const lines = text.split("\n");
  const commands = lines.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (!commands.some((line) => GATE_RUNS.has(line))) return null;
  if (commands.every((line) => GATE_WRITTEN.has(line))) return { delete: true };
  const kept = lines.filter((line) => !GATE_RUNS.has(line.trim()));
  while (kept.length > 0 && (kept.at(-1) as string).trim() === "") kept.pop();
  return { delete: false, body: `${kept.join("\n")}\n` };
}

/**
 * The lines of a hook that call flow, trimmed, in order: each line a `flow init` wrote into a gate
 * or told a person to add, today's and every older release's, and any other line that runs
 * `flow hook commit` or `flow commit`. Comments call nothing. What uninstall names for a person to
 * delete from a hook that is not flow's to edit.
 */
export function flowLinesOf(text: string | null): string[] {
  if (text === null) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => GATE_RUNS.has(line) || armsFlow(line) || armsOldFlow(line));
}

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
export function commitArgs(args: readonly string[], legacy: boolean): CommitArgs | null {
  if (legacy) return { scope: "staged", messageFile: null };
  const files = args.filter((arg) => arg !== "--all");
  if (files.length > 1 || files.some((file) => file.startsWith("--"))) return null;
  // Under `--all` there is no commit, so there is no message to read, whatever file came with it.
  return args.includes("--all") ? { scope: "all", messageFile: null } : { scope: "staged", messageFile: files[0] ?? null };
}

/**
 * The comment leader git strips from a message: `core.commentString`, else `core.commentChar`, as
 * `git config` printed it. `#` when it printed nothing. `auto` is `#` too: git chooses its own
 * character while it edits the message, and the file the hook is handed does not say which.
 */
export function commentLeader(configured: string): string {
  const leader = configured.replace(/\r?\n$/, "");
  return leader === "" || leader === "auto" ? "#" : leader;
}

/**
 * A commit message as git records it. When git opened an editor, from the scissors line on is gone,
 * then every comment line: comment lines are what git's editor template adds, and the section after
 * the scissors line is the diff `git commit -v` appends. When it did not (`-m`, `-F`), they are the
 * author's own text and stay. Either way trailing whitespace, runs of blank lines and the blank
 * lines at either end go, as git's own clean-up does. `edited` is false when git set
 * `GIT_EDITOR=:` for the hook, which is how it says no editor ran.
 */
export function cleanMessage(raw: string, leader: string, edited: boolean): string {
  const scissors = `${leader} ------------------------ >8 ------------------------`;
  const kept: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (edited && line === scissors) break;
    if (edited && line.startsWith(leader)) continue;
    const text = line.trimEnd();
    if (text === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
    kept.push(text);
  }
  while (kept.at(-1) === "") kept.pop();
  return kept.join("\n");
}

// ── other hooks ──────────────────────────────────────────────────────────────
//
// Git runs hooks from ONE folder: `core.hooksPath` when it is set, `.git/hooks` when it is not. A
// repo whose git already runs hooks from somewhere else (husky's `.husky/_`, or Git LFS and
// lefthook in `.git/hooks`) would lose every one of them the moment init pointed git at
// `.githooks`, with nothing said. So init never does: it detects the other setup, leaves it alone,
// and says that flow is not installed until the commit-msg hook git runs calls flow.

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
export type UnwiredHooks = OtherHooks & { readonly fix: HookFix };

/** Does git run other hooks without flow's gate among them? */
export function unwired(other: OtherHooks | null): other is UnwiredHooks {
  return other !== null && other.fix !== null;
}

/**
 * The commit-msg hook a person edits for this hooks folder.
 *
 * Usually the folder's own `commit-msg`. Husky is the exception: it points git at `.husky/_`, a
 * folder of stubs it rewrites on every install, and each stub runs the hook of the same name one
 * folder up, so the file a person edits is `.husky/commit-msg`. Any folder named `_` is read that way.
 */
export function commitMsgOf(dir: string): string {
  const folder = dir.replace(/\/+$/, "");
  return posix.basename(folder) === "_" ? posix.join(posix.dirname(folder), "commit-msg") : posix.join(folder, "commit-msg");
}

/**
 * The hooks folder as a person would type it, from git's answer to `git rev-parse --git-path hooks`
 * run at the repo root: repo-relative when it is inside the repo, absolute when it is not, such as
 * a worktree's shared `.git/hooks`. Resolved, so `.githooks/` and `./.githooks` both read `.githooks`.
 */
export function hooksDirOf(root: string, said: string): string {
  return relativise(posix.resolve(root, said), root);
}

/**
 * Does git run hooks other than flow's here? Null when it does not: `core.hooksPath` is flow's own
 * folder, or it is unset and `.git/hooks` holds nothing but git's own `.sample` files. A
 * `core.hooksPath` anywhere else counts whatever is in it, and any other file in `.git/hooks` counts,
 * not only a `commit-msg`: Git LFS installs `pre-push` and `post-checkout` there.
 */
export function otherHooks(hooksPath: string | null, folder: HooksFolder): OtherHooks | null {
  // The folder git resolved, not the setting as typed: `.githooks/`, `./.githooks` and an absolute
  // path to it are all flow's own.
  if (folder.dir === HOOKS_DIR) return null;
  if (hooksPath === null && folder.files.every((name) => name.endsWith(".sample"))) return null;
  const commitMsg = commitMsgOf(folder.dir);
  const calls = armsFlow(folder.commitMsgText);
  // Git runs a hook only when it has the execute bit, and ignores it otherwise with a warning a
  // commit scrolls past. That bites only when git runs the file itself. Husky's stub in `.husky/_`
  // runs `.husky/commit-msg` with `sh`, so that file needs no execute bit, and is never created
  // for husky either: its stub skips a hook that is not there.
  const viaStub = commitMsg !== posix.join(folder.dir, "commit-msg");
  if (viaStub) return { dir: folder.dir, commitMsg, fix: calls ? null : "add" };
  const fix =
    folder.commitMsgText === null ? "create" : folder.commitMsgExecutable ? (calls ? null : "add") : calls ? "chmod" : "add-and-chmod";
  return { dir: folder.dir, commitMsg, fix };
}

/** The words the block opens with, fixed by the docs, for every reader that looks for them. */
export const NOT_INSTALLED = "FLOW IS NOT INSTALLED";

/**
 * Git could not name the folder it runs hooks from, in the ONE wording init's report and status's
 * line share. No advice: telling a husky repo to set `core.hooksPath` is what turns husky off.
 */
export const HOOKS_UNKNOWN =
  "git could not name the folder it runs hooks from, so flow cannot tell whether a commit runs its gate. Run `git rev-parse --git-path hooks` here to see why.";

/** Other hooks whose commit-msg calls flow, in the ONE wording init's note and status's line share. */
export function wiredLine(other: OtherHooks): string {
  return `git runs hooks from ${other.dir}, and ${other.commitMsg} calls flow`;
}

/** Flow's two lines, as the block prints them for a person to copy into a commit-msg hook. */
const GATE_LINES = [`      ${GATE_LOCAL_LINE}`, `      ${GATE_RUN_LINE}`];

/**
 * The message for other hooks that do not run flow, in the ONE wording init's block and status's
 * line share: the folder git runs hooks from, why its commit-msg hook does not run flow's gate, and
 * the two ways to finish. The first fix is whatever that hook lacks: flow's two lines, the hook
 * itself, or the execute bit. Init never takes either fix itself: editing or creating another
 * tool's hook, or moving its hooks, is the person's call.
 */
export function notInstalledLines(other: UnwiredHooks): string[] {
  const [why, first] = firstFix(other);
  return [
    `${NOT_INSTALLED}. Git runs hooks from ${other.dir}, and ${why} no commit runs flow's gate.`,
    "Finish the install in one of two ways, then run `flow init` again:",
    ...first,
    `  - Or move those hooks into ${HOOKS_DIR}/, beside flow's gate, then run \`${SET_HOOKS_PATH}\`.`,
  ];
}

/**
 * A path as a person pastes it into a shell: as it is when nothing in it is special to the shell,
 * and single-quoted when something is, such as the space in a worktree under `~/My Projects/`.
 */
function asTyped(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : quoteArg(path);
}

/** Why the commit-msg hook does not run flow's gate, as the block's first line ends, and the fix. */
function firstFix(other: UnwiredHooks): [string, string[]] {
  const hook = other.commitMsg;
  const chmod = `\`chmod +x ${asTyped(hook)}\``;
  switch (other.fix) {
    case "create":
      return [`there is no ${hook}, so`, [`  - Create ${hook} with these three lines, then run ${chmod} so git runs it:`, "      #!/bin/sh", ...GATE_LINES]];
    case "chmod":
      return [`${hook} calls flow but is not executable, so git ignores it and`, [`  - Make ${hook} executable, so git runs it: ${chmod}`]];
    case "add-and-chmod":
      return [
        `${hook} does not call flow and is not executable, so git ignores it and`,
        [`  - Add these two lines to the end of ${hook}, then run ${chmod} so git runs it:`, ...GATE_LINES],
      ];
    case "add":
      return [`${hook} does not call flow, so`, [`  - Add these two lines to the end of ${hook}:`, ...GATE_LINES]];
  }
}

// ── choosing the harnesses ───────────────────────────────────────────────────

/** Does this `package.json` list `@jawache/flow` as a dependency or a dev dependency? */
export function listsFlow(manifest: string | null): boolean {
  if (manifest === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const { dependencies, devDependencies } = parsed as Record<string, unknown>;
  return [dependencies, devDependencies].some(
    (listed) => typeof listed === "object" && listed !== null && Object.hasOwn(listed, "@jawache/flow"),
  );
}


/** One harness, and what the shell found of it in this repo: its folder, and its program on the `PATH`. */
export interface Found {
  readonly harness: HarnessFacts;
  /** Its folder is in the repo. */
  readonly folder: boolean;
  /** Its program is in a folder on the `PATH`. */
  readonly program: boolean;
}

/** How a harness was detected, as the prompt says it, or null when it was not: its folder first, then its program. */
export function detection({ harness, folder, program }: Found): string | null {
  if (folder) return `${harness.detect.folder}/`;
  return program ? `${harness.detect.program} on the PATH` : null;
}

/** The harnesses to register when nobody chose: each one detected, or every one when none is. */
export function defaultHarnesses(found: readonly Found[]): string[] {
  const seen = found.filter((one) => detection(one) !== null);
  return (seen.length === 0 ? found : seen).map(({ harness }) => harness.id);
}

/** The value of `--harness`, as typed, or null when it is not given. `--harness` with no value is the empty string. */
export function harnessArg(args: readonly string[]): string | null {
  const at = args.indexOf("--harness");
  if (at === -1) return null;
  const next = args[at + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
}

/**
 * The harnesses to register: what `--harness` or the prompt was given, or null when nothing was, which
 * is the default of detection. A name no harness has, and a choice of none, are refused with one message
 * that names the valid harnesses: none would register nothing.
 */
export function chooseHarnesses(found: readonly Found[], typed: string | null): { readonly ok: true; readonly ids: string[] } | { readonly ok: false; readonly refusal: string } {
  if (typed === null) return { ok: true, ids: defaultHarnesses(found) };
  const valid = found.map(({ harness }) => harness.id);
  const ids = typed.split(/[\s,]+/).filter((name) => name !== "");
  const unknown = ids.find((id) => !valid.includes(id));
  const bad = ids.length === 0 ? "no harness" : unknown === undefined ? null : `no harness called \`${unknown}\``;
  return bad === null ? { ok: true, ids: [...new Set(ids)] } : { ok: false, refusal: `flow init — ${bad} was chosen, so nothing was written. The harnesses are ${valid.join(", ")}.` };
}

/** The prompt for the harnesses: each one, ticked when selected, with how it was detected. */
export function harnessPrompt(found: readonly Found[], selected: readonly string[]): string[] {
  const width = Math.max(...found.map(({ harness }) => harness.name.length));
  return [
    "Which harnesses run agents in this repo?",
    ...found.map((one) => {
      const mark = selected.includes(one.harness.id) ? "x" : " ";
      const how = detection(one);
      return `  [${mark}] ${one.harness.name.padEnd(width)}   ${how === null ? "not found" : `detected: ${how}`}`;
    }),
  ];
}

/** The question under that prompt: the names a person may type, and what an empty answer keeps. */
export function harnessQuestion(found: readonly Found[]): string {
  return `Harnesses to register, by name (${found.map(({ harness }) => harness.id).join(", ")}), or enter to keep the ones marked: `;
}

/** The list of what `flow init` is about to write, which the last prompt asks a yes for. */
export function aboutToWrite(plan: InitPlan): string[] {
  return ["flow init will write:", ...writtenLines(plan).map((what) => `  + ${what}`)];
}

/** A yes: an empty answer, `y` or `yes`, in any case. */
export function isYes(answer: string): boolean {
  return ["", "y", "yes"].includes(answer.trim().toLowerCase());
}

// ── the scaffold ─────────────────────────────────────────────────────────────

/** What every config `flow init` writes starts with: what the file is, and how a pack is bound to it. */
const HEADER = `// flow.config.ts — this repo's whole guard, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Bind a pack with \`pack(x)\`, refine one of
// its entries with \`override(x.entry)\`, and ask \`flow status\` what is live.

`;

/** The config `flow init --empty` leaves: the wiring, with no opinions. */
const EMPTY_CONFIG = `${HEADER}import { defineConfig } from "@jawache/flow";

export default defineConfig([]);
`;

/**
 * The config `flow init` leaves behind: the one pack flow ships, bound whole.
 *
 * TWO IMPORTS AND THE SPLIT IS THE LESSON. `@jawache/flow` is the grammar a rule is written in;
 * `@jawache/flow/packs` is the content the package ships, bound one `pack(…)` line each. `flow` is
 * bound by default because it is flow's own self-protection — the note saying what is steering you,
 * the refusal when an agent runs `flow uninstall`, and the refusal when a commit deletes the
 * guard — and every repo running flow wants all three. It takes no parameter. `--empty` binds
 * nothing.
 */
const DEFAULT_CONFIG = `${HEADER}import { defineConfig, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

export default defineConfig([
  // flow's own self-protection: what is steering you, no uninstalling it, and no deleting it.
  pack(flow),
]);
`;

/** The config file init writes: the one that binds `flow`, or the bare one `--empty` asks for. */
export function scaffold(empty: boolean): string {
  return empty ? EMPTY_CONFIG : DEFAULT_CONFIG;
}

// ── init ─────────────────────────────────────────────────────────────────────

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
  readonly machine: { readonly path: string; readonly settings: unknown };
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
  readonly oldGate: { readonly path: string; readonly body: string | null } | null;
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

/** The pre-0.4 gate with flow's lines taken out, as a write: null when the repo has none or none of it is flow's. */
function oldGateOf(text: string | null): InitPlan["oldGate"] {
  const old = gateWithoutFlow(text);
  return old === null ? null : { path: OLD_GATE_PATH, body: old.delete ? null : old.body };
}

/** What init will do to this repo. Pure: every branch reads a fact the shell already gathered. */
export function planInit(facts: InitFacts): InitPlan {
  // A file we could not read is a file we may not write. `withRegistrations` builds a NEW object
  // from whatever it is handed, so handing it the null an unparseable file produces would emit a
  // settings file holding flow's registrations and NOTHING ELSE — permissions, model, theme,
  // every other tool's hooks, gone. There is no safe merge into bytes nobody parsed, so init
  // registers nothing and says which file to fix.
  const settings: InitPlan["settings"][number][] = [];
  const settingsUnreadable: string[] = [];
  for (const { harness, settings: held, settingsUnreadable: unreadable } of facts.harnesses) {
    const { repoFile } = harness.registering;
    if (unreadable) {
      settingsUnreadable.push(repoFile);
      continue;
    }
    const registration = harness.registering.withRegistrations(held);
    if (registration.changed.length > 0) settings.push({ path: repoFile, value: registration.settings, registered: registration.changed });
  }
  // Outside git there are no hooks to keep. A folder git could not name has none to read, and may
  // still hold some, so it is left alone as other hooks are.
  const other = facts.isGit && facts.hooksFolder !== null ? otherHooks(facts.hooksPath, facts.hooksFolder) : null;
  const hooksUnknown = facts.isGit && facts.hooksFolder === null;
  return {
    config: facts.hasConfig ? null : { path: CONFIG_FILE, body: scaffold(facts.empty) },
    // NEVER over a hook that is already there. This is a scaffold, and a repo whose gate runs its
    // own suite must not lose it to a re-run — which is also what makes init safe to run again.
    gate: !facts.isGit || facts.gateText !== null ? null : { path: GATE_PATH, body: COMMIT_MSG, mode: 0o755 },
    oldGate: facts.isGit ? oldGateOf(facts.oldGateText) : null,
    gateKept: facts.isGit && facts.gateText !== null && !armsFlow(facts.gateText),
    gateOld: facts.isGit && !armsFlow(facts.gateText) && armsOldFlow(facts.gateText),
    notGit: !facts.isGit,
    flowDir: !facts.hasFlowDir,
    link: facts.resolves ? null : facts.packageRoot,
    // Per CLONE, not per repo: `core.hooksPath` is not committed, so a fresh clone and every
    // worktree needs it set again. That is why init is the command a new checkout runs. NEVER over
    // other hooks: git runs one folder, and pointing it at ours turns theirs off without a word.
    hooksPath: facts.isGit && facts.hooksPath !== HOOKS_DIR && other === null && !hooksUnknown,
    otherHooks: other,
    hooksUnknown,
    settings,
    settingsUnreadable,
    warnings: initWarnings(facts, other),
  };
}

/**
 * The warnings `flow init` prints before it writes, each only when it applies: git already runs other
 * hooks, flow is not a dev dependency of the repo, flow 0.3's hooks are still in a machine-wide
 * settings file, and a chosen harness needs a person to trust the folder before it runs a hook.
 */
function initWarnings(facts: InitFacts, other: OtherHooks | null): string[] {
  const warnings: string[] = [];
  if (unwired(other))
    warnings.push(`git already runs other hooks, from ${other.dir}, so flow leaves core.hooksPath alone and its commit gate is not installed until you add it to ${other.commitMsg} — the block at the end says how.`);
  if (!facts.listed)
    warnings.push(`flow is not a dev dependency of this repo, so the hooks run whatever flow is on the PATH. ${INSTALL_PIN}`);
  for (const { harness, machine } of facts.harnesses)
    if (harness.registering.registeredEvents(machine.settings).length > 0)
      warnings.push(`${machine.path} also holds flow's hooks, which flow 0.3 wrote, so each hook would run twice. Remove them with \`${MACHINE_RUN}\`, then run \`flow init\` again.`);
  for (const { harness } of facts.harnesses)
    if (harness.trustNote !== null) warnings.push(`${harness.name}: ${harness.trustNote}`);
  return warnings;
}

/** The sentence that says how a repo gets its own copy of flow. */
const INSTALL_PIN = "Install it for this repo as a dev dependency, pinned: docs/user/how-to/install-flow.md.";

/** What `flow init` is about to write, one line each: the list it asks a yes for, and the list it reports back. */
export function writtenLines(plan: InitPlan): string[] {
  const wrote: string[] = [];
  if (plan.config) wrote.push(plan.config.path);
  if (plan.gate) wrote.push(plan.gate.path);
  if (plan.oldGate)
    wrote.push(
      plan.oldGate.body === null
        ? `${plan.oldGate.path} deleted — an older flow wrote it, and ${GATE_PATH} runs the gate now`
        : `flow's lines taken out of ${plan.oldGate.path} — an older flow wrote them, and ${GATE_PATH} runs the gate now`,
    );
  if (plan.flowDir) wrote.push(`${FLOW_DIR}/ — flow's own state, self-ignoring, never committed`);
  // WHY it linked, not what linking is for: the reason for a file in their repo.
  if (plan.link) wrote.push(`node_modules/@jawache/flow → ${plan.link} (a link to the flow that is running — nothing here resolved @jawache/flow)`);
  for (const settings of plan.settings) wrote.push(`${settings.path} — ${settings.registered.join(" · ")}`);
  if (plan.hooksPath) wrote.push(SET_HOOKS_PATH);
  return wrote;
}

/** The warnings, as lines. Empty when none applies. */
export function warningLines(plan: InitPlan): string[] {
  return plan.warnings.map((warning) => `  ! ${warning}`);
}

/**
 * The report — every write named, and everything NOT done said out loud with what to do instead.
 *
 * A setup command that prints "done" is a command nobody can check. Failures are handed in rather
 * than thrown because a PARTIAL init is the interesting case: the config landed, the settings file
 * was read-only, and the person needs to know exactly that. `colour` is `wantsColour`'s answer for
 * the output this is written to.
 */
export function initLines(plan: InitPlan, failures: readonly string[], colour = false): string[] {
  const wrote = writtenLines(plan);

  const lines: string[] =
    wrote.length > 0
      ? ["flow init — created:", ...wrote.map((what) => `  + ${what}`)]
      : unwired(plan.otherHooks) || plan.hooksUnknown
        ? ["flow init — nothing new to write here."]
        : ["flow init — already set up here; nothing to do."];

  if (plan.notGit) lines.push("  · not a git repo, so no commit gate was armed. Run `git init`, then `flow init` again.");
  if (plan.gateKept)
    lines.push(
      `  · kept the ${GATE_PATH} already here — flow never overwrites one, so ${plan.gateOld ? UPDATE_THE_GATE_LINE : ADD_THE_GATE_LINE} yourself.`,
    );
  for (const path of plan.settingsUnreadable)
    lines.push(
      `  ✗ ${path} is not valid JSON, so nothing was registered and NOTHING was written to it — ` +
        `every other key in that file is somebody's, and there is no safe merge into bytes nobody could parse. ` +
        `Fix the JSON (a trailing comma, or a // comment) and run \`flow init\` again. Until then no rail fires.`,
    );
  if (plan.otherHooks !== null && plan.otherHooks.fix === null)
    lines.push(`  · ${wiredLine(plan.otherHooks)}, so core.hooksPath was left as it is.`);
  if (plan.hooksUnknown) lines.push(`  ✗ ${HOOKS_UNKNOWN}`);
  for (const failure of failures) lines.push(`  ✗ ${failure}`);
  lines.push("  next: `flow status` — what is bound, and what is not wired yet.");
  // LAST, so it is what is left on the screen: a muted `·` note is too quiet for a commit gate git
  // will never run. Bold red in a terminal, each line wrapped on its own so a pager or a terminal
  // that cuts a line never leaves the colour on.
  if (unwired(plan.otherHooks)) lines.push("", ...notInstalledLines(plan.otherHooks).map((line) => (colour ? `${BOLD_RED}${line}${RESET}` : line)));
  return lines;
}

const BOLD_RED = "\u001b[1;31m";

const RESET = "\u001b[0m";

/**
 * Does this output get colour? Only in a terminal, and never with `NO_COLOR` set to anything but an
 * empty string, which is the convention at no-color.org. A pipe, a file and a test harness get the
 * plain text, so nothing that reads the output has escape codes to strip.
 */
export function wantsColour(terminal: boolean, noColor: string | undefined): boolean {
  if (!terminal) return false;
  return noColor === undefined || noColor === "";
}

/**
 * Init's exit code. 1 when it could not finish, and 1 when flow is not installed or cannot tell: a
 * script chaining `flow init && …` is asking whether the repo is guarded, and a gate git never runs
 * is not.
 */
export function initCode(plan: InitPlan, failures: readonly string[]): 0 | 1 {
  return failures.length === 0 && !unwired(plan.otherHooks) && !plan.hooksUnknown ? 0 : 1;
}

// ── uninstall ────────────────────────────────────────────────────────────────
//
// THE REVERSE OF INIT, split the same way: the shell stats the repo, `planUninstall` decides what
// goes, the shell removes it, and `uninstallLines` says what went. "Flow's" means exactly what a
// `flow init` writes, read through the same constants it writes with, so the two cannot drift: a
// line, a hook or a registration somebody wrote themselves is never removed. `flow.config.ts` and
// its packs stay, because they are the person's own work and `flow init` wires them again.
//
// The machine-wide settings file is every repo's, so it is written only when `--machine` asks: a
// plain run in one repo must not unguard every other repo on the machine.

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
  readonly machineFile: { readonly path: string; readonly settings: unknown; readonly unreadable: boolean };
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
  readonly gate: { readonly path: string; readonly body: string | null } | null;
  /** The pre-0.4 gate, taken out the same way: it would run `flow hook commit` with flow gone. */
  readonly oldGate: { readonly path: string; readonly body: string | null } | null;
  /**
   * A commit-msg hook that still calls flow after the run, in lines flow did not write there: that
   * hook, as the report names it, and those lines, for a person to delete before `npm uninstall`.
   * The hook git runs from another folder, such as husky's `.husky/commit-msg`, which uninstall
   * never edits, as `flow init` never does; else what is left of `.githooks/commit-msg`. Null when
   * neither calls flow.
   */
  readonly hookCallsFlow: { readonly path: string; readonly lines: readonly string[] } | null;
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
export function planUninstall(facts: UninstallFacts): UninstallPlan {
  const gate = gateWithoutFlow(facts.gateText);
  const gateGone = gate?.delete === true;
  const leftText = gate === null ? facts.gateText : gate.delete ? null : gate.body;
  // A hook left in the folder is a hook git should still run, so `core.hooksPath` stays pointed at it.
  const oldGate = oldGateOf(facts.oldGateText);
  const hooksLeft = (facts.hooksDir ?? []).filter(
    (name) => !(gateGone && name === "commit-msg") && !(oldGate?.body === null && name === "pre-commit"),
  );
  // `core.hooksPath` is the whole repo's, and `.githooks/` is in the repo's top folder, so only a run
  // there unsets it. From a subfolder the run finds no gate, and unsetting the setting would leave
  // the gate in place with nothing pointing git at it.
  const flowsHooksPath = facts.hooksPath === HOOKS_DIR;
  const ownsHooksPath = flowsHooksPath && facts.subfolderOf === null;
  // Bytes nobody parsed are not written, as in `planInit`: the step is reported as failed instead.
  const cleaned = (registering: Registering, path: string, settings: unknown): SettingsWithout | null => {
    const { settings: value, removed } = registering.withoutRegistrations(settings);
    return removed.length === 0 ? null : { path, value, removed };
  };
  const present = <T>(found: readonly (T | null)[]): T[] => found.filter((one): one is T => one !== null);
  const repoCleaned = facts.harnesses.map(({ harness, settings, settingsUnreadable }) =>
    settingsUnreadable ? null : cleaned(harness.registering, harness.registering.repoFile, settings),
  );
  // The one reading of "a machine-wide file holds flow's hooks": what --machine writes, and what a
  // plain run names.
  const machineCleaned = facts.harnesses.map(({ harness, machineFile }) =>
    machineFile.unreadable ? null : cleaned(harness.registering, machineFile.path, machineFile.settings),
  );
  const unreadable = [
    ...facts.harnesses.filter((h) => h.settingsUnreadable).map((h) => h.harness.registering.repoFile),
    ...(facts.machineFlag ? facts.harnesses.filter((h) => h.machineFile.unreadable).map((h) => h.machineFile.path) : []),
  ];
  // The one reading of "git runs other hooks" that init and status use. The folder is read at the
  // top folder, so a run in a subfolder names that hook by its full path.
  // That folder's hook first: when git runs it, it is the one a commit fails in.
  const { hooksFolder, subfolderOf } = facts;
  let hookCallsFlow: UninstallPlan["hookCallsFlow"] = null;
  if (hooksFolder !== null) {
    const other = otherHooks(facts.hooksPath, hooksFolder);
    const lines = flowLinesOf(hooksFolder.commitMsgText);
    if (other !== null && lines.length > 0)
      hookCallsFlow = { path: subfolderOf === null ? other.commitMsg : posix.resolve(subfolderOf, other.commitMsg), lines };
  }
  const gateLines = flowLinesOf(leftText);
  if (hookCallsFlow === null && gateLines.length > 0) hookCallsFlow = { path: GATE_PATH, lines: gateLines };
  return {
    gate: gate === null ? null : { path: GATE_PATH, body: gate.delete ? null : gate.body },
    oldGate,
    hookCallsFlow,
    hooksPath: ownsHooksPath && hooksLeft.length === 0,
    hooksPathFrom: flowsHooksPath ? facts.subfolderOf : null,
    hooksKept: ownsHooksPath ? hooksLeft : [],
    hooksDir: facts.hooksDir !== null && hooksLeft.length === 0,
    flowDir: facts.hasFlowDir,
    link: facts.linked,
    settings: present(repoCleaned),
    machine: facts.machineFlag ? present(machineCleaned) : [],
    unreadable,
    command: facts.machineFlag ? MACHINE_RUN : "flow uninstall",
    keptConfig: facts.hasConfig,
    machineHolds: facts.machineFlag ? [] : present(machineCleaned).map((held) => held.path),
    next: "npm uninstall @jawache/flow",
  };
}

/** The one argument `flow uninstall` takes: clean the machine-wide settings file too. */
export const MACHINE_FLAG = "--machine";

/** `flow uninstall --machine`, as the report tells a person to type it. */
const MACHINE_RUN = `flow uninstall ${MACHINE_FLAG}`;

/** How `flow uninstall` is typed: the usage line a misused verb prints. */
const UNINSTALL_USAGE = `usage: flow uninstall [${MACHINE_FLAG}]`;

/**
 * `flow uninstall`'s arguments, read: null when they are fine, else the refusal to print. An argument
 * it does not know is refused rather than ignored, because this verb deletes files and a `--dry-run`
 * or a `--help` that went ahead would delete them too.
 */
export function uninstallRefusal(args: readonly string[]): string | null {
  const unknown = args.find((arg) => arg !== MACHINE_FLAG);
  return unknown === undefined ? null : `flow uninstall — unknown argument \`${unknown}\`; nothing was removed.\n${UNINSTALL_USAGE}`;
}

/** A step that could not be done answers 1, whether the shell hit it or the plan did. */
export function uninstallCode(plan: UninstallPlan, failures: readonly string[]): 0 | 1 {
  return failures.length === 0 && plan.unreadable.length === 0 ? 0 : 1;
}

/** The report: every removal named, what was kept and why, each failure, and the command to run next. */
export function uninstallLines(plan: UninstallPlan, failures: readonly string[]): string[] {
  const removed: string[] = [];
  for (const gate of [plan.gate, plan.oldGate])
    if (gate) removed.push(gate.body === null ? gate.path : `flow's lines from ${gate.path} — the rest of the hook is kept`);
  if (plan.hooksPath) removed.push(`core.hooksPath (it was ${HOOKS_DIR})`);
  if (plan.hooksDir) removed.push(`${HOOKS_DIR}/`);
  if (plan.flowDir) removed.push(`${FLOW_DIR}/ — flow's state and logs`);
  if (plan.link) removed.push(`${PACKAGE_DIR} — the link \`flow init\` made`);
  for (const settings of [...plan.settings, ...plan.machine]) removed.push(`${settings.path} — ${settings.removed.join(" · ")}`);

  const lines: string[] =
    removed.length > 0
      ? ["flow uninstall — removed:", ...removed.map((what) => `  - ${what}`)]
      : plan.hooksPathFrom === null
        ? ["flow uninstall — nothing of flow's here to remove."]
        : ["flow uninstall — removed nothing from this folder."];

  if (plan.hooksPathFrom !== null)
    lines.push(
      `  · kept core.hooksPath at ${HOOKS_DIR} — git reads it for the whole repo, and this run is in a subfolder. Run \`flow uninstall\` in ${plan.hooksPathFrom} to remove it with the gate.`,
    );
  if (plan.hooksKept.length > 0)
    lines.push(`  · kept core.hooksPath at ${HOOKS_DIR} — git still runs the hooks there: ${plan.hooksKept.join(" · ")}.`);
  const kept = plan.hookCallsFlow;
  if (kept !== null)
    lines.push(
      `  · ${kept.path} still calls flow, and flow takes out only the lines it wrote there itself. ` +
        `Delete ${kept.lines.length === 1 ? "this line" : "these lines"} from it yourself, or every commit fails with \`flow: not found\` once flow is gone:`,
      ...kept.lines.map((line) => `      ${line}`),
    );
  if (plan.keptConfig) lines.push(`  · kept ${CONFIG_FILE} and the packs it imports — \`flow init\` wires this repo again.`);
  for (const held of plan.machineHolds)
    lines.push(`  · ${held} still holds flow's hooks, and every repo on this machine runs them — \`${MACHINE_RUN}\` removes them.`);
  for (const path of plan.unreadable)
    lines.push(
      `  ✗ ${path} is not valid JSON, so flow's hooks were NOT removed from it and nothing was written to it. ` +
        `Fix the JSON (a trailing comma, or a // comment) and run \`${plan.command}\` again.`,
    );
  for (const failure of failures) lines.push(`  ✗ ${failure}`);
  // The hook's lines go first: `npm uninstall` before them leaves every commit failing.
  const first = kept === null ? "" : `delete flow's lines from ${kept.path}, then `;
  lines.push(
    plan.hooksPathFrom !== null
      ? `  next: \`flow uninstall\` in ${plan.hooksPathFrom} — removes the gate and core.hooksPath.`
      : plan.machineHolds.length === 0
        ? `  next: ${first}\`${plan.next}\` — removes the package.`
        : `  next: ${first}\`${MACHINE_RUN}\` once no repo on this machine needs flow, then \`${plan.next}\` — removes the hooks, then the package.`,
  );
  return lines;
}

// ── status ───────────────────────────────────────────────────────────────────
//
// ONE VERB that answers "is flow working here, and what will meet me". Green means guarded: every
// rule loads, every fitting is in place, and no entry is bound at a moment nothing delivers.
//
// It counts what LOADS rather than what parses, and that distinction is the whole reason the old
// engine needed four verbs to answer this badly. A rule that cannot fire no longer loads at all, so
// "every one resolved and able to fire" is a statement the loader already made and this only has to
// report. What is left is the world AROUND the config — the gate, the hooks path, the registrations
// — and putting every red line where the person standing in the repo will see it, each with its fix.

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
  readonly grammars: readonly { readonly name: string; readonly libraryPath: string; readonly present: boolean }[];
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
  readonly binary: { readonly listed: boolean; readonly copy: boolean; readonly path: boolean };
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

/** The line for the events a harness's settings file does not call flow for, and what that costs until `flow init` writes them. */
function unregisteredText(path: string, unregistered: readonly HookCost[]): string {
  const names = unregistered.map((r) => r.event).join(" · ");
  return `${path} does not call flow for ${names} — re-run \`flow init\`. Until it does, ${unregistered.map((r) => r.unregistered).join("; ")}.`;
}

/** The harness's note sits as far in as an entry's message does: four more than a fitting's later lines. */
const NOTE_INDENT = "    ";

/**
 * One harness's line: green when every hook flow registers is in the repo's file in today's shape,
 * and the time one of them last ran here. Its fix, in words, when not.
 */
function harnessFitting({ harness, settings, lastRan }: StatusHarness, now: number): Fitting {
  const { registering } = harness;
  const path = registering.repoFile;
  const registered = registering.registeredEvents(settings);
  const unregistered = registering.hooks.filter(({ event }) => !registered.includes(event));
  const stale = registering.staleRegistrations(settings);
  const ok = unregistered.length === 0 && stale.length === 0;
  const ran = lastRan === null ? "no hook has run here" : `last hook ran ${ago(lastRan, now)}`;
  const detail = ok
    ? `registered · ${ran}${lastRan === null && harness.noHookNote !== null ? `\n${NOTE_INDENT}${harness.noHookNote}` : ""}`
    : [
        unregistered.length === 0 ? "" : unregisteredText(path, unregistered),
        stale.length === 0
          ? ""
          : `${path} calls flow for ${stale.join(" · ")} the way an older flow registered ${stale.length === 1 ? "it" : "them"}, which this flow no longer does. Re-run \`flow init\` to bring ${stale.length === 1 ? "it" : "them"} up to date.`,
      ]
        .filter((line) => line !== "")
        .join("\n");
  return { id: harness.id, ok, detail, lastRan };
}

/** How long ago a time was, in a sentence: `just now`, `3 minutes ago`, `an hour ago`, `2 days ago`. */
export function ago(then: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(then)) / 1000));
  const unit = (n: number, word: string): string => (n === 1 ? `${word === "hour" ? "an" : "a"} ${word} ago` : `${n} ${word}s ago`);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86_400), "day");
}

/**
 * The time of the last hook of a harness that ran in this repo, from the session logs: the latest `ts`
 * of any row of a session of that harness, and null when there is none.
 *
 * A session's harness is its `meta` row's `harness`. A log written before that field existed names
 * none, and only one harness wrote those. The `commit` stream is git's, not a harness's.
 */
export function lastHookRan(history: readonly { readonly session: string; readonly rows: readonly Row[] }[], harness: string): string | null {
  let last: string | null = null;
  for (const { session, rows } of history) {
    if (session === "commit") continue;
    const meta = rows.find((row) => row.kind === "meta");
    const named = typeof meta?.["harness"] === "string" ? meta["harness"] : LOG_BEFORE_HARNESS;
    if (named !== harness) continue;
    for (const row of rows) if (typeof row["ts"] === "string" && (last === null || row["ts"] > last)) last = row["ts"];
  }
  return last;
}

/** The harness every session log written before the log named its harness belongs to: the only one flow had. */
const LOG_BEFORE_HARNESS = "claude-code";

/** Does `.githooks/commit-msg` call flow, as one half of the `git hook` fitting? */
function commitGate(facts: Pick<StatusFacts, "gateText" | "oldGateText">): Fitting {
  const armed = armsFlow(facts.gateText);
  const old = !armed && armsOldFlow(facts.gateText);
  const olderGate = armsFlow(facts.oldGateText) || armsOldFlow(facts.oldGateText);
  return {
    id: "git hook",
    ok: armed && !olderGate,
    detail: olderGate
      ? `${OLD_GATE_PATH} still runs flow, without the commit message — \`flow init\` replaces it with ${GATE_PATH}.`
      : armed
        ? `${GATE_PATH} runs flow`
        : old
          ? `${GATE_PATH} calls the old \`flow commit\`, which leaves every deleted file unchecked — ${UPDATE_THE_GATE_LINE}.`
          : facts.gateText === null
            ? `no ${GATE_PATH} — \`flow init\` arms it. Until then nothing runs at the commit.`
            : `${GATE_PATH} is here but does not call flow — ${ADD_THE_GATE_LINE}.`,
  };
}

/**
 * THE `git hook` FITTING, one line for the two facts git must hold: the commit-msg hook calls flow,
 * and git runs the folder it is in. Green joins them, as the tutorial prints it; red names each
 * half that is not, so the fix of each is on the line.
 */
function gitHookFitting(gate: Fitting, path: Fitting, ownFolder: boolean): Fitting {
  if (gate.ok && path.ok) return { id: "git hook", ok: true, detail: ownFolder ? `${gate.detail}, and ${path.detail}` : path.detail };
  return { id: "git hook", ok: false, detail: [gate, path].filter((f) => !f.ok).map((f) => f.detail).join("\n") };
}

function fittingsOf(facts: StatusFacts): Fitting[] {
  return [
    {
      id: "config",
      ok: facts.hasConfig,
      detail: facts.hasConfig
        ? facts.configPath
        : `no ${CONFIG_FILE} in ${facts.root} — \`flow init\` writes one, that binds flow's own pack.`,
    },
    gitHookFitting(commitGate(facts), hooksPathFitting(facts), facts.hooksFolder?.dir === HOOKS_DIR),
    binaryFitting(facts),
    // NO GRAMMARS, NO ROW. A repo that declares none has nothing to be told, and a fitting saying so
    // would be a green tick about a feature nobody used.
    ...(facts.grammars.length === 0
      ? []
      : [
          {
            id: "grammars",
            ok: facts.grammars.every((grammar) => grammar.present),
            detail: facts.grammars.every((grammar) => grammar.present)
              ? `${facts.grammars.map((grammar) => grammar.name).join(" · ")} — declared in ${CONFIG_FILE}, and their libraries are built`
              : facts.grammars
                  .filter((grammar) => !grammar.present)
                  .map((grammar) => missingGrammarText(grammar.name, grammar.libraryPath))
                  .join("\n"),
          },
        ]),
    ...harnessFittings(facts),
  ];
}

/**
 * ONE LINE FOR EACH REGISTERED HARNESS. A harness whose file has no flow registration in it has no
 * line, and when none has, the one red `hooks` line says what no harness's hooks judge until
 * `flow init` registers them.
 */
function harnessFittings(facts: StatusFacts): Fitting[] {
  const registered = facts.harnesses.filter(({ harness, settings }) => harness.registering.registeredEvents(settings).length > 0);
  if (registered.length > 0) return registered.map((one) => harnessFitting(one, facts.now));
  return [
    {
      id: "hooks",
      ok: false,
      detail: facts.harnesses.map(({ harness }) => unregisteredText(harness.registering.repoFile, harness.registering.hooks)).join("\n"),
    },
  ];
}

/** Where a caller of `flow` looks for it: the repo's own package, then the PATH — or the PATH alone. */
type Reach = "local" | "path";

/**
 * The gate, as written: one with `GATE_LOCAL_LINE` puts the repo's copy first, and one without it —
 * the gate an older `flow init` wrote, which it never rewrites — finds only the PATH. The LINE, not
 * text `node_modules/`: a gate that runs another tool from there still finds flow on the PATH
 * alone. A gate that does not call flow at all is judged as `flow init` writes one; its own
 * fitting is red.
 */
function gateReach(text: string | null): Reach {
  if (text === null || (!armsFlow(text) && !armsOldFlow(text))) return "local";
  return hookCommands(text)
    .split("\n")
    .some((line) => line.trim() === GATE_LOCAL_LINE)
    ? "local"
    : "path";
}

/**
 * The registrations, as written: one in the old shape (`bareHook`) finds only the PATH, and that is
 * every hook it answers. The SAME rule `flow init` rewrites by, so the fix this names is one init
 * can carry out. Any other command is somebody's own, and none at all is judged as init writes them.
 */
function hooksReach(harnesses: StatusFacts["harnesses"]): Reach {
  return harnesses.some(({ harness, settings }) => harness.registering.bareRegistrations(settings).length > 0) ? "path" : "local";
}

/**
 * THE PATH GIT AND THE HOST HAND THEIR HOOKS, read off the PATH this command was run with: every
 * folder of it but a `node_modules/.bin` that npm put there for this one run — the repo's own or an
 * ancestor's, which `npx flow` and `npm run` add, and npx's cache of a package it fetched. Counted,
 * `npx flow status` would find a dev dependency's copy "on the PATH" that git never sees.
 *
 * Another repo's node_modules/.bin stays: it is on the PATH because someone put it there.
 */
export function hostPath(dirs: readonly string[], root: string): string[] {
  const tidy = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const bin = `/${LOCAL_BIN}`;
  const at = tidy(root);
  return dirs.filter((dir) => {
    const path = tidy(dir);
    if (path === "") return false;
    if (!path.endsWith(bin)) return true;
    const owner = path.slice(0, -bin.length);
    return !(at === owner || at.startsWith(`${owner}/`) || path.includes("/_npx/"));
  });
}

/**
 * DOES GIT RUN THE COMMIT GATE? Judged from the folder git resolved, as init judges it, so
 * `.githooks/`, `./.githooks` and an absolute path to it are all flow's own.
 *
 * Git runs ONE folder. Flow's own is green. Another tool's (husky's `.husky/_`, or a hook in
 * `.git/hooks`) is green once the commit-msg hook git runs calls flow, and otherwise red in the
 * words of init's block, because it is the same fact: flow is not installed. With no other hooks,
 * the setting is simply missing, which every fresh clone is.
 */
function hooksPathFitting(facts: Pick<StatusFacts, "hooksPath" | "hooksFolder">): Fitting {
  const folder = facts.hooksFolder;
  // CANNOT JUDGE, so no advice. The setting as typed says nothing about what is in the folder, and
  // telling a husky repo to set `core.hooksPath` is the very advice that turns husky off.
  if (folder === null)
    return {
      id: "git hook",
      ok: false,
      detail: HOOKS_UNKNOWN,
    };
  if (folder.dir === HOOKS_DIR) return { id: "git hook", ok: true, detail: `core.hooksPath = ${HOOKS_DIR}` };
  const other = otherHooks(facts.hooksPath, folder);
  if (other === null)
    return {
      id: "git hook",
      ok: false,
      detail: `core.hooksPath is ${facts.hooksPath ?? "unset"} — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    };
  return unwired(other)
    ? { id: "git hook", ok: false, detail: notInstalledLines(other).join("\n") }
    : { id: "git hook", ok: true, detail: wiredLine(other) };
}

/**
 * CAN THE HOOKS AND THE GATE FIND `flow`? Both call it by name, so a repo can carry every other
 * fitting and still have each hook fail with `flow: not found` and every commit refused.
 *
 * Each is judged AS WRITTEN. Today's gate and registrations run the repo's own package first, so
 * a dev dependency answers them and its copy wins over the PATH's. An older gate, or a
 * registration in the old shape, finds only the PATH — and the repo's own copy is one it never
 * runs, a red line naming which of them is stranded and how to bring it up to date.
 */
function binaryFitting(facts: Pick<StatusFacts, "binary" | "gateText" | "harnesses" | "version">): Fitting {
  const { listed, copy, path } = facts.binary;
  // THE REPO'S OWN COPY is one its package.json lists. In a repo that does not list flow, the copy
  // is the link `flow init` made to the flow that ran it — the PATH's, in the ordinary global
  // install — so it is judged by the PATH, and the tutorial's line names the PATH.
  const modules = listed && copy;
  const hooks = hooksReach(facts.harnesses);
  const gate = gateReach(facts.gateText);
  const runs = (reach: Reach): string | null => (reach === "local" && modules ? `in ${PACKAGE_DIR}` : path ? "on the PATH" : null);
  const [byHooks, byGate] = [runs(hooks), runs(gate)];
  if (byHooks !== null && byGate !== null)
    return {
      id: "binary",
      ok: true,
      detail:
        byHooks === byGate
          ? hooks === "local" && gate === "local" && modules
            ? "the hooks run this repo's own flow"
            : `the hooks and the gate run the flow ${byHooks}`
          : `the hooks run the flow ${byHooks}, and the gate the flow ${byGate}`,
    };
  const install = `install it for this repo with \`npm i -D --allow-git=root github:jawache/flow#v${facts.version}\`.`;
  // LINKED, NOT LISTED, AND NOTHING ON THE PATH: the hooks and the gate run the link while it
  // resolves, so this is red on the safe side, and it says so rather than "no flow".
  if (!modules && copy)
    return {
      id: "binary",
      ok: false,
      detail:
        `this repo's package.json does not list @jawache/flow, so ${PACKAGE_DIR} is the link \`flow init\` made to the flow that ran it, ` +
        `and no flow is on the PATH. The hooks and the gate run that link only while it resolves, and once it breaks every hook fails ` +
        `with \`flow: not found\` and git refuses every commit — ${install}`,
    };
  if (!modules)
    return {
      id: "binary",
      ok: false,
      detail:
        `no flow in ${PACKAGE_DIR} or on the PATH, so every hook fails with \`flow: not found\` and git refuses every commit — ${install}`,
    };
  // A COPY IN THE REPO'S OWN PACKAGE, AND A CALLER THAT NEVER LOOKS THERE: name each stranded one, with
  // the fix that brings it up to date — init for the registrations, a line by hand for the gate,
  // which init never rewrites. Each carries its own verb: "the hooks look", "the gate looks".
  const stranded = [
    ...(byHooks === null
      ? [{ who: "the hooks", looks: "look", fails: "every hook fails with `flow: not found`", fix: "re-run `flow init`, which rewrites flow's registrations to look there first" }]
      : []),
    ...(byGate === null
      ? [{ who: "the gate", looks: "looks", fails: "git refuses every commit", fix: `add \`${GATE_LOCAL_LINE}\` to ${GATE_PATH} above the line that runs flow` }]
      : []),
  ];
  const looks = stranded.length === 1 ? stranded[0]?.looks : "look";
  return {
    id: "binary",
    ok: false,
    detail:
      `the flow in ${PACKAGE_DIR} is not on the PATH, and ${stranded.map((s) => s.who).join(" and ")} ${looks} for flow on the PATH alone, ` +
      `so ${stranded.map((s) => s.fails).join(" and ")} — ${stranded.map((s) => s.fix).join("; ")}; or install it for this repo with \`npm i -D --allow-git=root github:jawache/flow#v${facts.version}\`.`,
  };
}

/**
 * EVERY RED LINE, worked out once — the list status closes on, and the definition of not-green.
 *
 * `green` and the closing count are the same question asked at two moments, and asking it twice is
 * how a page that ends "green" comes to exit 1. One function answers it: the boolean is this list
 * being empty, and the close prints its length.
 */
function redLines(s: Pick<Status, "refusals" | "dark" | "fittings">): string[] {
  return [
    ...s.refusals.map((r) => `${r.code}: ${r.detail}`),
    ...s.dark,
    ...s.fittings.filter((f) => !f.ok).map((f) => `${f.id}: ${f.detail}`),
  ];
}

/** Does this adapter carry that moment, for that KIND of entry? */
export function delivers(kind: EntrySpec["kind"], moment: Moment, carried: Delivered): boolean {
  return kind === "guardrail"
    ? isGuardrailMoment(moment) && carried.guard.includes(moment)
    : isBreadcrumbMoment(moment) && carried.brief.includes(moment);
}

/** The gathered facts, judged. Never throws: a broken config is a red line, not an exception. */
export function status(facts: StatusFacts): Status {
  const entries = facts.load?.ok === true ? facts.load.entries : [];
  const refusals = facts.load?.ok === false ? facts.load.refusals : [];

  // NO MOMENT TABLE WHEN THE CONFIG DID NOT LOAD. A load fault is not partial — the loader refuses
  // the whole document, so every rail is off until it is fixed, and printing "3 guardrails at the
  // commit" under a headline saying nothing is armed would be the old status's exact lie.
  const bound = refusals.length > 0 ? [] : universe(entries);
  // What the harnesses of this repo deliver between them: an entry is dark only when none carries its moment.
  const carried: Delivered = {
    guard: [...new Set(facts.harnesses.flatMap(({ harness }) => harness.delivers.guard))],
    brief: [...new Set(facts.harnesses.flatMap(({ harness }) => harness.delivers.brief))],
  };
  const dark = bound
    .filter((entry) => entry.disabled === null && entry.at.length > 0 && !entry.at.some((m) => delivers(entry.kind, m, carried)))
    .map((entry) => entry.id);
  const fittings = fittingsOf(facts);

  return {
    root: facts.root,
    version: facts.version,
    armed: !facts.off,
    configPath: facts.configPath,
    // NO RECORD NUMBERS HERE, deliberately. What each entry has DONE is a lifetime question over
    // every session's rows, and `flow facts` is the verb that asks it — a second reader of the same
    // rows is how two surfaces come to disagree about which rule is dead. status answers what is
    // BOUND, which needs no history at all.
    moments: momentsView(bound, null),
    categories: [...new Set(entries.flatMap((entry) => entry.categories))].sort(),
    session: facts.session,
    dark,
    delivers: carried,
    fittings,
    refusals,
    green: redLines({ refusals, dark, fittings }).length === 0,
  };
}

/** One entry, as a person reads it: what it says, where it looks, and who it binds to. */
function entryLines(entry: Bound): string[] {
  const scope = [
    (entry.on?.length ?? 0) > 0 ? `on ${entry.on?.join(" ")}` : "",
    (entry.ignore?.length ?? 0) > 0 ? `not ${entry.ignore?.join(" ")}` : "",
    entry.for.length > 0 ? `for ${entry.for.join(" · ")}` : "",
  ].filter((part) => part !== "");
  const mark = entry.disabled !== null ? "○" : entry.kind === "guardrail" ? "✗" : "🍞";
  const lines = [`    ${mark} ${entry.id}${scope.length === 0 ? "" : `  —  ${scope.join(" · ")}`}`];
  if (entry.disabled !== null) lines.push(`        off: ${entry.disabled || "no reason given"}`);
  else if (entry.says !== null) lines.push(`        ${snipAtWord(entry.says, 100)}`);
  return lines;
}

/**
 * The whole answer as lines — the headline, what meets you and when, then everything not true yet.
 *
 * The branching is here rather than in the CLI shell for the reason every report in this package is:
 * which headline, whether a moment table is printable at all, when the close goes red — each of
 * those is a judgement about what a reader most needs to know, and in a shell not one has a test.
 */
export function statusLines(s: Status): string[] {
  if (!s.armed)
    return [`flow is OFF — every rail is silenced (${FLOW_DIR}/off is there). Delete that file to turn it back on.`];

  const { breadcrumbs, guardrails, disabled } = s.moments.totals;
  const lines = [
    s.refusals.length > 0
      ? `flow ${s.version} — the config will not load, so every guardrail and breadcrumb here is OFF.`
      : `flow is ON — ${count(guardrails, "guardrail")} · ${count(breadcrumbs, "breadcrumb")}` +
        (disabled === 0 ? "" : ` · ${disabled} disabled`) +
        ", every one resolved and able to fire",
    `  config     ${s.configPath}`,
    `  state      ${s.root}/${FLOW_DIR}`,
    ...(s.session === null
      ? []
      : [`  session    ${s.session.id}${s.session.agent === null ? "" : ` · ${s.session.agent}`}, wearing ${s.session.wearing.length === 0 ? "no category" : s.session.wearing.join(" · ")}`]),
  ];
  const mode = s.session?.mode ?? null;
  if (mode !== null) lines.push(`  mode       ${modeLine(mode, s.session?.steer ?? null)}`);
  if (s.categories.length > 0) lines.push(`  categories ${s.categories.join(" · ")} — what the entries below bind to`);

  for (const { moment, entries } of s.moments.moments) {
    lines.push(`  ${moment}`);
    for (const entry of entries) lines.push(...entryLines(entry));
  }

  // A detail of several lines keeps its later lines UNDER its row, so they never read as rows of their own.
  for (const fitting of s.fittings)
    lines.push(`  ${fitting.ok ? "✓" : "✗"} ${fitting.id}: ${fitting.detail.split("\n").join(`\n${DETAIL_INDENT}`)}`);
  for (const refusal of s.refusals) lines.push(`  ✗ ${refusal.code}: ${refusal.detail}`);
  for (const id of s.dark)
    lines.push(
      `  ✗ ${id}: bound only at a moment nothing delivers here — it loads, it counts, and it will never fire. ` +
        `This adapter carries ${s.delivers.guard.join(" · ")} for a guardrail and ${s.delivers.brief.join(" · ")} for a breadcrumb.`,
    );
  lines.push(
    s.green
      ? "green — every rule loads, every fitting is in place."
      : `${count(redLines(s).length, "red line")} — flow is NOT fully in force here.`,
  );
  return lines;
}

/** Where a fitting's later lines start: under its id, past the `  ✗ ` of its row. */
const DETAIL_INDENT = "    ";

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The permission mode the live session is under, and — under auto mode only — whether the host is
 * steering it towards shell edits, which is the steer that sends work round Edit and through the
 * diff instead.
 */
function modeLine(mode: string, steer: Steer | null): string {
  if (mode !== "auto") return mode;
  if (steer === null) return "auto — no steer towards shell edits found in its transcript";
  if (!steer.shellFirst) return "auto — not steered towards shell edits";
  return `auto — steered towards shell edits${steer.variant === null ? "" : ` (${steer.variant})`}`;
}


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
export function statusCode(answer: Status): 0 | 1 | 2 {
  if (answer.refusals.length > 0) return 2;
  return answer.green ? 0 : 1;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PAYLOAD — what the harness sends, and what flow answers to
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const HOOK_EVENTS = [
  "session-start",
  "subagent-start",
  "pre-tool-use",
  "post-tool-use",
  "stop",
  "subagent-stop",
  "notification",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(word: string): word is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(word);
}

/** The host's own name for each event — what a decision object has to echo back. */
export const HOST_EVENT: Record<HookEvent, string> = {
  "session-start": "SessionStart",
  "subagent-start": "SubagentStart",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  stop: "Stop",
  "subagent-stop": "SubagentStop",
  notification: "Notification",
};

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
export const DELIVERS = {
  guard: ["command", "commit", "turn-end"] as readonly GuardrailMoment[],
  brief: ["session", "file-change", "command", "turn-end"] as readonly BreadcrumbMoment[],
};

/**
 * Does a note at this moment ride a refusal, rather than wait for the call that runs?
 *
 * Before a call, a refusal means the call never runs, so a note about it is held back until the
 * retry that does — and is not marked shown, or it would stay silent until drift. A held turn is
 * different: the agent is about to act on the refusal anyway, and the note is about that same
 * turn, so both go to it together.
 */
export function ridesRefusal(moment: BreadcrumbMoment): boolean {
  return moment === "turn-end";
}

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BASH READS — the files a shell command reads, for the log's `read` rows
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Under auto mode most contact with an area is a `cat`, a `grep` or a `sed -n` whose payload names
// no path, so a `tool` row alone cannot say which files a session read. This names those paths from
// the command line, BEFORE it runs, and `flow facts` counts them. No breadcrumb is shown for a read.
//
// READ FROM THE PARSE (#45), the one every rule that judges a shell command reads, so a heredoc
// body, a quoted argument or a commit message is never a command here either. The table below
// decides which of a command's arguments are files; the parse's steps decide what the commands are,
// where a `cd` leaves the shell and what a variable the line set holds. Measured against the 150
// hand-labelled commands in `__fixtures__/bash-corpus/` (`just score-bash`), it finds what the
// hand-written lexer it replaced found, mechanism by mechanism and trap by trap: 89% of the
// labelled reads at 100% precision. That lexer had itself won flow F3's bake-off against
// tree-sitter-bash and shell functions shadowing the read commands.
//
// BEST-EFFORT AND FAILING OPEN, on purpose. A word that cannot be settled from the line — a
// `$(…)`, an unknown variable — is left out rather than guessed at, and a line that does not parse
// names nothing.
//
// THE WALK IS THE PARSE'S (`followSteps` in language/), the same one that gives every command in
// `ctx.commands` its `folder`, so where a `cd` leaves the shell is worked out in one place.

/** Which arguments of one read command are files. */
interface ReadSpec {
  /** Options that consume the next argument. */
  readonly valued?: readonly string[];
  /** Options whose value is itself a file read (`grep -f patterns`, `awk -f prog.awk`). */
  readonly fileOpts?: readonly string[];
  /** Positional operands that are not files — a pattern, a script, a filter — … */
  readonly skip?: number;
  /** … unless one of these options supplied it instead. */
  readonly supplied?: readonly string[];
  /** What is searched when no operand is: the working directory, or only when recursive. */
  readonly dflt?: "." | "recursive";
  /** `find`: the first operand of the expression ends the list of paths. */
  readonly stop?: boolean;
  /** `cp`: the last operand is the destination. */
  readonly lastIsDest?: boolean;
  /**
   * A SEARCH: its operands may be directories it lists or walks, so they touch an area but are not
   * a file read. `grep` is one only when recursive.
   */
  readonly searches?: boolean;
}

const GREP_SPEC: ReadSpec = {
  valued: ["-e", "-f", "-A", "-B", "-C", "-m", "-d", "-D", "--regexp", "--file", "--include", "--exclude", "--exclude-dir", "--max-count", "--context", "--after-context", "--before-context", "--color", "--colour", "--label"],
  fileOpts: ["-f", "--file"],
  skip: 1,
  supplied: ["-e", "-f", "--regexp", "--file"],
  dflt: "recursive",
};

/**
 * THE READ COMMANDS, and which of their arguments are files. One table, because which argument of
 * `grep` is the pattern is a fact about `grep`, not about how the line was parsed.
 */
const READERS: Readonly<Record<string, ReadSpec>> = {
  cat: {},
  less: {},
  more: {},
  tac: {},
  wc: {},
  cmp: {},
  file: {},
  md5sum: {},
  sha256sum: {},
  bat: { valued: ["-l", "-r", "--language", "--line-range", "--style", "--theme"] },
  nl: { valued: ["-b", "-w", "-s", "-v", "-i"] },
  head: { valued: ["-n", "-c"] },
  tail: { valued: ["-n", "-c", "-b", "-s"] },
  sed: { valued: ["-e", "-f", "-l", "--expression", "--file"], fileOpts: ["-f", "--file"], skip: 1, supplied: ["-e", "-f", "--expression", "--file"] },
  awk: { valued: ["-F", "-v", "-f"], fileOpts: ["-f"], skip: 1, supplied: ["-f"] },
  jq: { valued: ["-f", "--from-file", "--indent", "--arg", "--argjson", "--slurpfile", "--rawfile"], fileOpts: ["-f", "--from-file"], skip: 1, supplied: ["-f", "--from-file"] },
  grep: GREP_SPEC,
  egrep: GREP_SPEC,
  fgrep: GREP_SPEC,
  rg: {
    valued: ["-e", "-f", "-g", "-t", "-T", "-A", "-B", "-C", "-m", "-M", "-d", "-j", "-r", "-E", "--regexp", "--file", "--glob", "--iglob", "--type", "--type-not", "--type-add", "--max-count", "--max-columns", "--max-depth", "--threads", "--replace", "--encoding", "--sort", "--sortr", "--context", "--after-context", "--before-context", "--ignore-file", "--pre", "--max-filesize", "--colors", "--color"],
    fileOpts: ["-f", "--file", "--ignore-file"],
    skip: 1,
    supplied: ["-e", "-f", "--regexp", "--file", "--files", "--type-list"],
    dflt: ".",
    searches: true,
  },
  find: { stop: true, dflt: ".", searches: true },
  ls: { valued: ["-I", "--ignore", "--hide", "-w", "--width"], dflt: ".", searches: true },
  du: { valued: ["-d", "-B", "--max-depth"], dflt: ".", searches: true },
  tree: { valued: ["-L", "-I", "-P"], dflt: ".", searches: true },
  diff: { valued: ["-U", "-C", "-x", "-X", "-I", "-L", "--label", "--exclude"] },
  cut: { valued: ["-d", "-f", "-c", "-b"] },
  sort: { valued: ["-k", "-t", "-o", "-S", "-T"] },
  uniq: { valued: ["-f", "-s"] },
  column: { valued: ["-s", "-c"] },
  xxd: { valued: ["-l", "-s", "-c", "-g"] },
  od: { valued: ["-N", "-j", "-t", "-A"] },
  hexdump: { valued: ["-n", "-s", "-e"] },
  strings: { valued: ["-n"] },
  md5: { valued: ["-s"] },
  shasum: { valued: ["-a"] },
  cp: { valued: ["-t", "-S"], lastIsDest: true },
};

/** The `git` subcommands whose pathspecs are a reader looking at a path. */
const GIT_LOOKS = new Set(["diff", "log", "show", "status", "add", "blame", "ls-files", "grep"]);

/** An argument after expansion, or null when it could not be known without running the line. */
type Arg = string | null;

/** What one simple command reads, as written: files, and the paths a search walks. */
interface ArgvReads {
  readonly reads: string[];
  readonly searched: string[];
}

/**
 * The paths one simple command reads, as written, relative to the folder it runs in. An unknown
 * argument is skipped, never guessed at.
 */
function argvReads(argv: readonly Arg[]): ArgvReads {
  const reads: string[] = [];
  const searched: string[] = [];
  // The parse has already stepped past the wrappers (`timeout 60 rg …`, `env X=1 cat f`), so the
  // program is at the front.
  const name = argv[0] === undefined || argv[0] === null ? "" : programName(argv[0]);
  const args = argv.slice(1);
  if (name === "git") return gitReads(args, reads);
  if (name === "ffmpeg") {
    args.forEach((arg, i) => {
      const next = args[i + 1];
      if (arg === "-i" && typeof next === "string") reads.push(next);
    });
    return { reads, searched };
  }
  const spec = READERS[name];
  if (spec === undefined) return { reads, searched };

  const operands: Arg[] = [];
  let supplied = false;
  let recursive = false;
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as Arg;
    if (spec.stop === true && word !== null && (word.startsWith("-") || word === "(" || word === "!")) break;
    if (ended || !isOption(word)) {
      operands.push(word);
      continue;
    }
    const arg = word as string;
    if (arg === "--") {
      ended = true;
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (spec.supplied?.includes(flag) === true) supplied = true;
    if (/^-[a-zA-Z]*[rR]/.test(arg) || arg === "--recursive") recursive = true;
    // BSD `sed -i ''` and `sed -i .bak`: the in-place suffix is an argument of its own.
    if (name === "sed" && arg === "-i" && (args[i + 1] === "" || /^\.\w+$/.test(args[i + 1] ?? ""))) i++;
    else if (eq !== -1) {
      if (spec.fileOpts?.includes(flag) === true) reads.push(arg.slice(eq + 1));
    } else if (spec.valued?.includes(flag) === true) {
      const value = args[i + 1];
      if (spec.fileOpts?.includes(flag) === true && typeof value === "string") reads.push(value);
      i++;
    }
  }
  let files = operands.slice(supplied ? 0 : (spec.skip ?? 0));
  if (spec.lastIsDest === true) files = files.slice(0, -1);
  // `grep -r` walks what it is given; `cp -r` still reads its sources.
  const walks = spec.dflt === "recursive" && recursive;
  const into = spec.searches === true || walks ? searched : reads;
  for (const file of files) if (file !== null && file !== "-" && file !== "") into.push(file);
  if (files.length === 0 && (spec.dflt === "." || walks)) into.push(".");
  return { reads, searched };
}

/**
 * `git [options] <look> … [-- paths]` → the pathspecs. A pathspec may name a directory, so it is a
 * search. Where `-C` moved git is the parse's, in the command's `folder`.
 */
function gitReads(args: readonly Arg[], reads: string[]): ArgvReads {
  const searched: string[] = [];
  let i = 0;
  for (let opt = args[0] ?? null; isOption(opt); opt = args[i] ?? null) i += GIT_VALUE_OPTS.has(opt as string) ? 2 : 1;
  const sub = args[i];
  const found = { reads, searched };
  if (typeof sub !== "string" || !GIT_LOOKS.has(sub)) return found;
  const rest = args.slice(i + 1);
  const dash = rest.indexOf("--");
  // Before a `--`, only what LOOKS like a path: a revision (`HEAD~2`, `main..x`, `HEAD:file`) does not.
  const pathish = (arg: Arg): arg is string =>
    arg !== null && !isOption(arg) && !arg.includes("..") && !arg.includes(":") && (arg.includes("/") || /\.\w+$/.test(arg));
  searched.push(...(dash === -1 ? rest.filter(pathish) : rest.slice(dash + 1).filter((arg): arg is string => arg !== null && arg !== "")));
  return found;
}

// ── the walk ────────────────────────────────────────────────────────────────

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
 * The list file `xargs` reads — `-a FILE`, `-aFILE`, `--arg-file FILE` or `--arg-file=FILE` — from
 * the wrappers the parse stepped past. Only xargs's own options count, the words between the last
 * `xargs` and the program: an `exec -a NAME` in front of it names a process, not a file.
 */
function xargsList(wrappers: readonly (string | null)[]): string | null {
  const from = wrappers.findLastIndex((word) => word !== null && programName(word) === "xargs");
  if (from === -1) return null;
  const own = wrappers.slice(from + 1);
  for (const [i, word] of own.entries()) {
    if (word === "-a" || word === "--arg-file") return own[i + 1] ?? null;
    if (word?.startsWith("--arg-file=") === true) return word.slice("--arg-file=".length) || null;
    if (word?.startsWith("-a") === true && !word.startsWith("--")) return word.slice(2);
  }
  return null;
}

/**
 * The repo paths a Bash command reads or searches — the `READERS` table, a `<` redirect, a `git`
 * pathspec — read from the parse's steps, and followed through `cd`, `VAR=`, `for` loops and the
 * commands a `$(…)` runs, by the parse's own walk (`followSteps`). The repo root itself is not an
 * area and is left out. Best-effort, failing open: see the section head. A line that does not
 * parse names nothing. The steps are parsed from where the call ran, `where.cwd` and `where.home`,
 * since a git command's reads are relative to the folder the parse gave it.
 */
export function bashReads(steps: readonly ShellStep[] | null, where: BashWhere): BashReads {
  const reads: string[] = [];
  const searched: string[] = [];
  const add = (list: string[], path: string | null): void => {
    const rel = path !== null && path.startsWith(`${where.root}/`) ? path.slice(where.root.length + 1) : null;
    if (rel !== null && !list.includes(rel)) list.push(rel);
  };
  // The parse's own walk keeps the shell's folder and variables; this reads each command's files from it.
  followSteps(steps ?? [], { cwd: where.cwd, home: where.home }, (step, cwd, expand, moves, fields) => {
    for (const { operator, target } of step.redirects) {
      if (operator !== "<" && operator !== "<>") continue;
      const path = expand(target);
      add(reads, path === null ? null : resolveFrom(path, cwd));
    }
    const list = xargsList(step.words.slice(0, step.at).map(expand));
    if (list !== null) add(reads, resolveFrom(list, cwd));
    if (moves) return;
    // Each word as the arguments the shell passes for it, as `ctx.commands` holds them: `F="a b"; cat $F` reads two files.
    const argv = step.words.slice(step.at).flatMap((word) => fields(word) ?? [null]);
    const found = argvReads(argv);
    // A git command's own `-C` moves it, and the parse has already followed it into its `folder`.
    const from = gitCommand(step.command) === null ? cwd : step.command.folder;
    for (const path of found.reads) add(reads, resolveFrom(path, from));
    for (const path of found.searched) add(searched, resolveFrom(path, from));
  });
  return { reads, searched };
}

/**
 * A payload → every event it carries. ZERO OR MORE, and the plural is not hedging.
 *
 * One Bash call is genuinely several moments — the command about to run, and the command's own
 * note — and the old engine ran two evaluations off that one hook for exactly this reason. A signature returning one event would push the second rail back into the shell, where it
 * could not be tested as a decision.
 *
 * An event flow was not asked for answers with an empty list, never with an invented moment.
 */
export function toEvent(hook: HookEvent, payload: HookPayload, world: EventWorld): AdapterEvent[] {
  switch (hook) {
    case "session-start":
      return [{ rail: "brief", moment: "session" }];

    case "subagent-start":
      // A START NOBODY SPAWNED gets no note, as its hand-back runs no rule.
      return internalAgent(payload, world.sessionAgent ?? (() => null)) ? [] : [{ rail: "brief", moment: "session" }];

    case "pre-tool-use": {
      // THE NOTES HELD FOR THE BRIEF ride the first call the subagent makes, first of its notes:
      // the brief is in its own transcript by now, so a note bound to a category it recognises can
      // match. Every guard event still comes first, so a refused call leaves them held. Only a shell
      // command comes through here, so a subagent that has run none has them with the first call
      // that runs (`post-tool-use`).
      const events = callEvents(payload, world);
      if (world.heldForBrief !== true) return events;
      const at = events.findIndex((event) => event.rail === "brief");
      const held: AdapterEvent = { rail: "brief", moment: "session" };
      return at === -1 ? [...events, held] : [...events.slice(0, at), held, ...events.slice(at)];
    }

    case "post-tool-use":
      // The files the call changed are not in the payload: git says which, and the shell asks it
      // (`changedBy`), then makes an event of each (`changeEvents`). What is here is only the
      // session notes a subagent's start held.
      return world.heldForBrief === true ? [{ rail: "brief", moment: "session" }] : [];

    case "stop":
    case "subagent-stop":
      // The host's OWN loop-breaker, honoured: a stop hook already held this turn open once and the
      // agent carried on, so blocking again is how a session gets wedged inside its own rule.
      if (payload.stop_hook_active === true) return [];
      // A HAND-BACK NOBODY SPAWNED. The host's own agents send SubagentStop too; they run no rule.
      if (hook === "subagent-stop" && internalAgent(payload, world.sessionAgent ?? (() => null))) return [];
      // The turn is the one this agent took: the shell reads it from the agent's own transcript,
      // a subagent's own under its parent's, never the parent's. The guard event comes first, as on
      // every rail, and the note rides the same answer — beside a refusal too (`ridesRefusal`).
      return [
        { rail: "guard", moment: "turn-end", turn: world.turn?.() ?? [] },
        { rail: "brief", moment: "turn-end" },
      ];

    case "notification":
      // Registered, and it carries no flow moment: `Notification` says the human is wanted, which
      // is not something a guardrail or a breadcrumb has a word for. The entry exists so the
      // registration is answered deliberately rather than falling through an unknown-event path.
      return [];
  }
}

/**
 * The events of one PreToolUse: the call about to run, as `toEvent` reads it.
 */
function callEvents(payload: HookPayload, world: EventWorld): AdapterEvent[] {
  const input = payload.tool_input ?? {};
  if (text(payload.tool_name) === "Bash") {
    const command = text(input["command"]);
    if (!command) return [];
    // TWO RAILS OFF ONE BASH CALL, and they are different questions: the guard rail decides
    // whether the command may run, and the brief rail says what the agent should know before it
    // does. The note rides the same PreToolUse answer the block would have used — it is the
    // `additionalContext` channel this hook already carries — so a repo can attach a warning to
    // a command (`npm install …` corrupting a running dev server's cache) without inventing a
    // rule that refuses it.
    //
    // Every guard event comes before every brief event: a refusal carries no notes, and the
    // shell stops judging notes once something has refused, so they are not marked shown.
    // The line is parsed once here, for the command rules. The
    // host's `cwd` is where the shell stands, which is where each command's folder is followed from.
    const cwd = shellCwd(payload, world.root);
    const steps = parseShellSteps(command, { cwd, home: world.home });
    const commands = steps === null ? null : stepCommands(steps);
    const events: AdapterEvent[] = [{ rail: "guard", moment: "command", command, commands, start: { cwd, home: world.home } }];
    events.push({ rail: "brief", moment: "command", command });
    return events;
  }
  return [];
}

/**
 * Is this SubagentStart or SubagentStop an internal agent's — one the host runs for its own features (prompt
 * suggestions, `/btw` side questions) rather than a subagent the session spawned?
 *
 * The host's hooks reference says how to tell: such a payload's `agent_type` is the agent name the
 * session itself runs as, or empty when it runs as none. A subagent the session spawned always
 * carries its own type (`general-purpose` when none was asked for), so an empty one is never a
 * spawn. A payload with no `agent_id` is treated the same way: it names no agent whose own
 * transcript could be read, and the one it would fall back to is the parent's.
 *
 * `sessionAgent` is a function because it costs the parent's transcript, and it is asked only when
 * the payload names a type. A spawned subagent of the very type the session runs as is
 * indistinguishable from an internal agent by this rule, and is let through with them.
 */
function internalAgent(payload: HookPayload, sessionAgent: () => string | null): boolean {
  if (text(payload.agent_id) === "") return true;
  const type = text(payload.agent_type);
  if (type === "") return true;
  return type === sessionAgent();
}

/**
 * Is this a subagent starting before its brief can be read?
 *
 * At `SubagentStart` the host has not yet written the subagent's own transcript, so the brief at its
 * head is not there: a category recognised by it cannot match yet. A resumed subagent's is there.
 * Its classification is then read without being remembered, or the sticky verdict would be one
 * reached without the brief.
 */
export function awaitsBrief(hook: HookEvent, transcript: string | null): boolean {
  return hook === "subagent-start" && transcript === null;
}

/**
 * Does this config hold a subagent's session notes for its brief, when the brief cannot be read at
 * its start (`awaitsBrief`)?
 *
 * Only a note bound with `.for(…)` can wait on a category, so a config with none holds nothing. One
 * shown at the start is marked there, and judged again at the first tool call shows nothing.
 */
export function holdsForBrief(entries: readonly LoadedEntry[]): boolean {
  return entries.some((entry) => entry.spec.kind === "breadcrumb" && fires(entry.spec, "session") && (entry.spec.for ?? []).length > 0);
}

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
export function nothingBound(hook: HookEvent, entries: readonly LoadedEntry[], recording: boolean): boolean {
  return !recording && hook === "subagent-stop" && !entries.some((entry) => fires(entry.spec, "turn-end"));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHERE A CALL WORKED — the working folders of the repository, even a nested one
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A call may work in another worktree of the same repository: an Edit or Write of a file there, or a
// command that runs there. The rules are those of the config in the folder the session started in,
// and git's list of changed paths is read in each worktree the call worked in
// (docs/user/reference/moments.md § The file-change moment).

/** Is `path` the folder `dir`, or inside it? Both absolute. */
function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** Where the shell stood when a call started: the payload's `cwd`, against the guarded folder, which it is when absent. */
function shellCwd(payload: HookPayload, root: string): string {
  return posix.resolve(root, text(payload["cwd"]));
}

/**
 * The folders a shell command runs in, absolute: where the shell stood when the call started, and
 * each command's `folder` from the one parse, `git -C` included, each once. A folder only running
 * the line could tell is left out. None for any other call.
 */
export function commandFolders(payload: HookPayload, root: string, home: string | undefined): string[] {
  if (text(payload.tool_name) !== "Bash") return [];
  const cwd = shellCwd(payload, root);
  const commands = parseCommandLine(text((payload.tool_input ?? {})["command"]), { cwd, home });
  return [...new Set([cwd, ...knownFolders(commands)])];
}

/** The folders the parse settled for these commands, each once; a command with none adds nothing. */
function knownFolders(commands: readonly ShellCommand[] | null): string[] {
  return [...new Set((commands ?? []).flatMap((c) => (c.folder === null ? [] : [c.folder])))];
}

/**
 * Every place a call worked, absolute: the file an edit tool wrote (`written`, which the harness
 * names), or the folders a shell command ran in (`commandFolders`). What `worktreesWorkedIn` places in a worktree.
 */
export function workedPaths(payload: HookPayload, root: string, home: string | undefined, written: string | null): string[] {
  return written === null ? commandFolders(payload, root, home) : [posix.resolve(root, written)];
}

/** The folders between a path and the guarded folder that holds it, nearest first; neither end. */
export function foldersBetween(path: string, root: string): string[] {
  const out: string[] = [];
  if (!within(path, root)) return out;
  for (let dir = posix.dirname(path); dir !== root && within(dir, root); dir = posix.dirname(dir)) out.push(dir);
  return out;
}

/**
 * May any of these paths be in another worktree? Only then is git asked for the worktree list, so
 * an ordinary call costs nothing more. A path outside the guarded folder may be. So may one inside
 * it under a folder holding a `.git`: a linked worktree marks its own folder with a `.git` file, and
 * Claude Code puts a subagent's worktree there, under `.claude/worktrees/`. A repository made inside
 * it holds a `.git` folder, and costs the same one question. `gitIn` answers whether a folder holds
 * either.
 */
export function reachesAnotherWorktree(paths: readonly string[], root: string, gitIn: (dir: string) => boolean): boolean {
  return paths.some((path) => beyondRoot(path, root, gitIn));
}

/**
 * May this path belong to a repository other than the guarded folder's own? Only when it is outside
 * the guarded folder, or under a folder inside it that `marked` answers yes for: one holding a
 * `.git`. Anything else is in the guarded folder's repository, and git is not asked.
 */
function beyondRoot(path: string, root: string, marked: (dir: string) => boolean): boolean {
  // A path may itself be a folder a command ran in, so it is asked too; the guarded folder never
  // is, since a session started in a worktree holds a `.git` file there on every call.
  return !within(path, root) || [path, ...foldersBetween(path, root)].some((dir) => dir !== root && marked(dir));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OUTSIDE THE REPOSITORY — work a rule not marked `.everywhere()` is not passed
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A folder is inside when git names this repository for it, so every worktree of it is inside. The
// engine decides which rules are passed what; this says where the event works outside.
// docs/user/reference/parse.md § A command outside the repo.

/**
 * Where an event works outside the repository, by the name the engine reads (`GuardEvent.outside`):
 * the `folder` of each command that runs outside. A command with no folder is inside. `gitIn`
 * answers whether a folder holds a `.git`, and `sameRepository` whether git names this repository
 * for a folder; it is asked only of a folder `gitIn` cannot clear. A breadcrumb has no world of
 * its own: the paths of a file-change are git's own, inside a worktree of this repository.
 */
export function outsideOf(
  event: AdapterEvent,
  root: string,
  gitIn: (dir: string) => boolean,
  sameRepository: (folder: string) => boolean,
): string[] {
  const out = (folder: string): boolean => beyondRoot(folder, root, gitIn) && !sameRepository(folder);
  return event.rail === "guard" && event.moment === "command" ? knownFolders(event.commands ?? null).filter(out) : [];
}

/** The working folders `git worktree list --porcelain` lists; a bare repository has none. */
export function worktreeFolders(porcelain: string): string[] {
  return porcelain
    .split(/\n\n+/)
    .map((block) => block.split("\n"))
    .filter((lines) => !lines.includes("bare"))
    .flatMap((lines) => lines.filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length)));
}

/**
 * The other worktrees a call worked in: each path is placed in the worktree that holds it, the
 * deepest when worktrees nest, and the session's own is left out. The session's own worktree is the
 * deepest one holding the guarded folder, so a session started in a nested worktree reads the one
 * around it. Each is named once, in the order the paths came.
 */
export function worktreesWorkedIn(args: {
  readonly paths: readonly string[];
  readonly root: string;
  readonly worktrees: readonly string[];
}): string[] {
  const { paths, root, worktrees } = args;
  const holding = (path: string): string | undefined =>
    worktrees.filter((worktree) => within(path, worktree)).sort((a, b) => b.length - a.length)[0];
  const own = holding(root);
  const out: string[] = [];
  for (const path of paths) {
    const holder = holding(path);
    if (holder === undefined || holder === own || out.includes(holder)) continue;
    out.push(holder);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHANGED PATHS OF A CALL — git's list before and after, compared
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// What a tool call changed is not read from the tool: any tool counts, a shell command and a script
// it ran included. It is found by comparing what git lists as changed in the working folder before
// and after the call (docs/user/explanation/what-flow-reads.md § After a tool call: the changed
// paths). The list holds a hash of each path's content, so a file that was already changed and is
// changed again is told from one that is not. A file git ignores is not in git's list. This section
// is the decision; the shell asks git and hashes the files.

/**
 * The paths `git status --porcelain=v1 -z --untracked-files=all` lists. An entry is `XY path`, and
 * a rename or a copy is followed by the path it came from, which is listed as well: the file is
 * gone from there. A folder, which git lists for a repository nested in this one, is not a file.
 */
export function statusPaths(stdout: string): string[] {
  const fields = stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    if (field.length < 4) continue;
    const moved = field[0] === "R" || field[0] === "C" || field[1] === "R" || field[1] === "C";
    out.push(field.slice(3));
    if (moved && fields[i + 1] !== undefined && fields[i + 1] !== "") out.push(fields[++i] as string);
  }
  return [...new Set(out)].filter((path) => !path.endsWith("/"));
}

/**
 * The commits a call made, as the range git is asked for, or null when it made none or one side has
 * no commit to name. A commit takes its files out of git's list, so a call that changes a file and
 * commits it leaves the file in neither list: the commit's own files are changes of the call.
 */
export function commitRange(before: Tree, after: Tree): string | null {
  return before.head !== null && after.head !== null && before.head !== after.head ? `${before.head}..${after.head}` : null;
}

/**
 * The paths a call changed in one working folder, sorted: a path git lists now and did not before,
 * a path whose content differs, a path git listed before and does not now (it was put back, or
 * committed), and the files of a commit made inside the call (`committed`, from `commitRange`).
 */
export function changedBy(before: Tree, after: Tree, committed: readonly string[]): string[] {
  const out = new Set<string>(committed);
  for (const [path, hash] of Object.entries(after.files)) if (before.files[path] !== hash) out.add(path);
  for (const path of Object.keys(before.files)) if (!(path in after.files)) out.add(path);
  return [...out].sort();
}

/**
 * The file an edit tool's call named, as an absolute path with its links resolved (`absolute`, which
 * the shell makes of the harness's `editedFile`), relative to one working folder; null when there is none or it is
 * outside the folder. It is what a call whose "before" was never taken is left with: a first call,
 * or a call in a worktree this agent has not worked in, has nothing to compare.
 */
export function namedChange(absolute: string | null, folder: string): string | null {
  return absolute !== null && within(absolute, folder) ? relativise(absolute, folder) : null;
}

/** The paths one working folder's call changed: compared with its "before", or what the call named when it has none. */
export function folderChanges(args: {
  readonly before: Tree | null;
  readonly after: Tree;
  readonly committed: readonly string[];
  readonly named: string | null;
}): string[] {
  const { before, after, committed, named } = args;
  if (before === null) return named === null ? [] : [named];
  return changedBy(before, after, committed);
}

/**
 * The working folders to look at for this hook: where the call worked, before a shell command and
 * after any tool; the guarded folder, as a session or a subagent starts; none for the rest. `worked`
 * is asked only when it is needed, since it may cost a call to git.
 */
export function foldersToLook(hook: HookEvent, tool: string, worked: () => readonly string[], root: string): readonly string[] {
  if (hook === "session-start" || hook === "subagent-start") return [root];
  if (hook === "post-tool-use" && tool !== "") return worked();
  return hook === "pre-tool-use" && tool === "Bash" ? worked() : [];
}

/**
 * The events a changed set of paths makes for the breadcrumb rail: one for each path that a
 * breadcrumb bound at `file-change` reaches. A path none reaches shows nothing and writes no row, so
 * it makes no event, and a recording holds none of it either.
 */
export function changeEvents(paths: readonly string[], entries: readonly LoadedEntry[]): BriefAdapterEvent[] {
  const bound = entries.filter((entry) => entry.spec.kind === "breadcrumb" && fires(entry.spec, "file-change"));
  return paths.filter((path) => bound.some((entry) => inScope(entry.spec, path))).map((path) => ({ rail: "brief", moment: "file-change", path }));
}

/**
 * The notices these events could show, whatever the session has drifted to: the breadcrumbs that
 * fire at them, bind to the agent, are in scope, and are unmarked or marked and so due again. The
 * shell reads the transcript for the drift, and the prose files, only when this is not empty — a
 * call that changed no file under a breadcrumb's globs reads neither.
 */
export function noticesThatCouldShow(args: { load: LoadResult; events: readonly BriefAdapterEvent[]; marks: Marks; wearing: readonly string[]; settings: Settings }): Notice[] {
  const { load, events, marks, wearing, settings } = args;
  return events.flatMap((event) => brief({ load, event: { moment: event.moment, path: event.path, command: event.command, wearing, tokens: Number.POSITIVE_INFINITY }, marks, settings }).notices);
}

/** The row that records a call's changed files. Null when it changed none. */
export function changeRow(tool: string, paths: readonly string[]): Row | null {
  return paths.length === 0 ? null : { kind: "change", tool, paths: [...paths] };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A TURN'S SHELL CHANGES — the files a shell command changed, as the turn's own actions
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The harness's transcript says which files an edit tool changed and which commands ran. It cannot
// say which files a command changed, and under Codex every change is one. The log can: the `change`
// row after a shell call. A turn-end rule reads `ctx.turn`, so the two are joined here, once, and
// `ranSinceEdit` counts a file a shell command changed without knowing the shell exists.

/** One shell command, and the files its call changed. */
export interface ShellChange {
  readonly command: string;
  readonly paths: readonly string[];
}

/**
 * The shell calls of one agent that changed files, in order, from its rows: a `Bash` call's `tool`
 * row is followed by its `change` row. A call that changed nothing has no `change` row.
 */
export function shellChangesOf(rows: readonly Row[], agent: string): ShellChange[] {
  const out: ShellChange[] = [];
  let command: string | null = null;
  for (const row of rows) {
    if (row["agent"] !== agent) continue;
    if (row.kind === "tool") command = row["tool"] === "Bash" && typeof row["command"] === "string" ? row["command"] : null;
    else if (row.kind === "change" && command !== null && row["tool"] === "Bash" && Array.isArray(row["paths"])) {
      out.push({ command, paths: (row["paths"] as unknown[]).filter((path): path is string => typeof path === "string") });
      command = null;
    }
  }
  return out;
}

/**
 * The turn's actions with each file a shell command changed put in as an edit, just before the
 * command's own run: a command that changes a file and then runs the tests did not run them after
 * the change, and one that only runs them is not an edit. Each `run` is matched with the latest
 * shell call that has its command and was not matched yet, so a command run twice is told apart.
 */
export function withShellChanges(actions: readonly TurnAction[], changes: readonly ShellChange[]): TurnAction[] {
  const unmatched = [...changes];
  const before = new Map<number, readonly string[]>();
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i] as TurnAction;
    if (action.did !== "run") continue;
    const at = unmatched.map((change) => change.command).lastIndexOf(action.command);
    if (at === -1) continue;
    before.set(i, (unmatched.splice(at, 1)[0] as ShellChange).paths);
  }
  return actions.flatMap((action, i) => [...(before.get(i) ?? []).map((path): TurnAction => ({ did: "edit", path })), action]);
}

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
export const FLOW_OFF = `flow is OFF until ${CONFIG_FILE} loads: every command goes through unchecked, and every commit is refused.`;

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
export function opensCall(hook: HookEvent, tool: string): boolean {
  if (tool === "") return false;
  return hook === "pre-tool-use" ? tool === "Bash" : hook === "post-tool-use" && tool !== "Bash";
}

/**
 * Does this event's answer carry the load error? A session start, and a command not yet run. Not a
 * file change, and not turn-end, on either rail, which is told on stderr instead.
 */
function carriesTheNotice(event: AdapterEvent): boolean {
  return event.moment !== "file-change" && event.moment !== "turn-end";
}

/**
 * What a broken config answers with. `opens` is `opensCall` for this hook: the first hook of a
 * call carries the notice whatever events it made, so a Read, which makes none, is told too.
 */
export function whileBroken(events: readonly AdapterEvent[], message: string, opens = false): Outage {
  const body = `${message}\n\n${FLOW_OFF}`;
  return {
    refused: [],
    shown: opens || events.some(carriesTheNotice) ? [{ entry: null, cause: "fault", body }] : [],
    told: events.some((event) => event.rail === "guard" && event.moment === "turn-end") ? body : null,
  };
}

/**
 * The block of prose a set of notes is injected as.
 *
 * The header says `breadcrumb` because that is the mechanism's name everywhere else — in the
 * config, in the log, in `flow status` — and names the moment that showed it, as the tutorial prints
 * it; the load error, which no moment showed, names its cause. The injected block was the last place the old system spoke
 * one word to the agent and printed another to the human, and a mechanism you hear one name for and
 * read another about is one you cannot look up.
 */
export function briefBlock(shown: readonly Shown[]): string {
  return shown
    .filter((note) => note.body.trim() !== "")
    .map((note) => `# breadcrumb: ${note.entry ?? "flow"} (${note.moment ?? note.cause})\n${note.body}`)
    .join("\n\n");
}

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
export function toResult(hook: HookEvent, answer: Answer): HookResult {
  const refusal = refused(answer.refused);
  const prose = briefBlock(answer.shown);
  if (refusal !== null)
    return prose === "" ? refusal : { ...refusal, stderr: `${refusal.stderr}\n${prose}\n` };
  if (prose === "") return ALLOW;
  return { stdout: decision(hook, prose), stderr: "", exitCode: 0 };
}

/** Hand the agent some context and allow — the one shape every steering rail emits. */
export function decision(hook: HookEvent, additionalContext: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: HOST_EVENT[hook], additionalContext } });
}

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
export function readFault(hook: HookEvent, why: "unreadable" | "unparseable", detail: string): HookResult {
  const what =
    why === "unreadable" ? `could not READ its payload from stdin (${detail})` : `could not PARSE its payload (${detail})`;
  const text = `[flow hook ${hook}] ${what}.`;
  return hook === "pre-tool-use"
    ? { stdout: "", stderr: `\n${text}\n`, exitCode: 2 }
    : { stdout: "", stderr: `${text}\n`, exitCode: 0 };
}

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
export function sessionFactsFrom(args: { readonly payload: HookPayload; readonly head: string }): SessionFacts {
  const { agent, agentType } = agentOf(args.payload);
  return {
    head: args.head,
    subagent: agent !== "main",
    ...(agentType === undefined ? {} : { agentType }),
  };
}

/**
 * Which agent one hook message came from — the one reading of it, for its state, its classification
 * and its log rows alike.
 *
 * The type is read only beside an `agent_id`: the host also sends `agent_type` on a top-level
 * session started with `--agent`, and that session is still the parent.
 */
export function agentOf(payload: HookPayload): AgentOf {
  return namedAgent(payload.agent_id, payload.agent_type) ?? { agent: "main" };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDER — every tool call, as it happens
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The guard used to log only its own opinions — a rule that fired, a note that showed — which made
// every coverage question unanswerable. "Is this area guarded?" needs the calls that nothing
// watched; "did that breadcrumb arrive in time?" needs the call it arrived on and the edit that
// followed. Both are the DENOMINATOR, and it was missing.
//
// One row per call, written from the PreToolUse rail — BEFORE the call, deliberately, because a
// command the guard blocks never reaches PostToolUse, and a recorder blind to exactly the calls the
// guard refused would be blind to the guard's own effect.

/** The tools whose subject is the file they name. */
const PATH_KEYS = ["file_path", "notebook_path"] as const;

/**
 * A tool call → the row that records it, or null when the payload names no tool at all.
 *
 * EVERY call, including the ones no rule watches and no breadcrumb covers. The subject is whatever
 * the call had — a path (repo-relative, so it matches the globs an entry is written with), a
 * command line, a search pattern and its scope — and a call with no subject is still recorded by
 * name, because "the session ran fifty greps here" is a fact about the area. `edit` is the harness's
 * answer: whether this call changed the file it names.
 */
export function toolRow(payload: HookPayload, root = "", edit = false): Row | null {
  const tool = text(payload.tool_name);
  if (!tool) return null;
  const input = payload.tool_input ?? {};
  // The permission mode rides the row of the call it was stated for: `flow status` reads the last
  // one back, and `flow facts` counts the calls made under each.
  const mode = text(payload.permission_mode) === "" ? {} : { mode: text(payload.permission_mode) };
  for (const key of PATH_KEYS) {
    // `edit` is stamped HERE, and that is the seam rather than a convenience. Which of a harness's
    // tools change a file is harness knowledge; the engine reads the record back to answer "how
    // much work happened in this area" and may never import this file to ask. So the answer is
    // decided once, at write time, by the only layer entitled to know it.
    if (input[key]) return { kind: "tool", tool, path: relativise(text(input[key]), root), edit, ...mode };
  }
  if (tool === "Bash" && input["command"]) return { kind: "tool", tool, command: text(input["command"]), ...mode };
  if (!input["pattern"]) return { kind: "tool", tool, ...mode };
  const scope = input["path"] ? { scope: relativise(text(input["path"]), root) } : {};
  return { kind: "tool", tool, pattern: text(input["pattern"]), ...scope, ...mode };
}

/**
 * The files a Bash call reads by name, one `read` row each — written beside its tool row, so the
 * record counts a `cat` of a file as a touch of it the way it counts a Read.
 *
 * Files only. A directory a search walks is an area, not a file anybody read, and counted as one it
 * would name a folder as a node of the tree the rows are drawn into.
 */
export function shellReadRows(payload: HookPayload, root: string, home?: string): Row[] {
  const command = text(payload.tool_input?.["command"]);
  if (text(payload.tool_name) !== "Bash" || command === "") return [];
  const where = { cwd: shellCwd(payload, root), root, home };
  return bashReads(parseShellSteps(command, where), where).reads.map((path) => ({ kind: "read", tool: "Bash", path }));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A HARNESS'S HOOKS FILE — what flow registers in it, read and written
// ════════════════════════════════════════════════════════════════════════════════════════════════

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
export function hooksFileOf(spec: HooksFile): Pick<Registering, "registrations" | "hooks" | "registeredEvents" | "staleRegistrations" | "bareRegistrations" | "withRegistrations" | "withoutRegistrations"> & { readonly ourHookCommand: (command: string) => boolean; readonly bareHook: (command: string) => HookEvent | null } {
  const REGISTERED = spec.registered;
  const RETIRED = spec.retired;
  const HOOK_REGISTRATIONS: readonly Registration[] = REGISTERED.map(({ hook, matcher }) => ({
    event: HOST_EVENT[hook],
    command: spec.command(hook),
    ...(matcher === undefined ? {} : { matcher }),
  }));

  /**
   * What goes unjudged while each registration is missing, by the host's own name for its event — what
   * `flow status` says beside the fix. Derived from `REGISTERED`, so it cannot name an event flow does
   * not register.
   */
  const HOOK_COSTS: readonly HookCost[] = REGISTERED.map(({ hook, unregistered }) => ({ event: HOST_EVENT[hook], unregistered }));

  /**
   * Is this registration OURS?
   *
   * The rule that says "this is ours" is the rule that would say "this may be removed", so it is
   * narrow on purpose: the flow binary — by either name it legitimately goes by, with any path in
   * front — invoking `hook <event>` for an event this build actually answers. A `work hook stop` from
   * the engine flow replaces is NOT ours; sweeping those is the crossing's job, with that engine's own
   * recogniser.
   */
  function ourHookCommand(command: string): boolean {
    const match = /(^|[\s"'/\\])(?:flow|flow\.mjs)["']?\s+hook\s+([a-z-]+)\s*$/.exec(command.trim());
    return match?.[2] !== undefined && (isHookEvent(match[2]) || [...RETIRED.values()].includes(match[2]));
  }

  /** Every hook array in a settings file, by event. Loose: it is somebody's hand-edited JSON. */
  function hookArrays(settings: unknown): Record<string, unknown[]> {
    const held = (settings && typeof settings === "object" ? settings : {}) as { hooks?: unknown };
    const hooks = (held.hooks && typeof held.hooks === "object" ? held.hooks : {}) as Record<string, unknown>;
    const out: Record<string, unknown[]> = {};
    for (const [event, value] of Object.entries(hooks)) if (Array.isArray(value)) out[event] = value;
    return out;
  }

  /** Is this one entry of a hook array a registration of ours? */
  function isOurs(entry: unknown): boolean {
    return commandsOf(entry).some((command) => ourHookCommand(command));
  }

  /** The command of one hook inside an entry, or null when it has none. Loose, like everything read out of the file. */
  function commandOf(held: unknown): string | null {
    const command = (held as { command?: unknown } | null)?.command;
    return typeof command === "string" ? command : null;
  }

  /** The commands of one entry of a hook array. */
  function commandsOf(entry: unknown): string[] {
    const inner = (entry as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(inner)) return [];
    return inner.flatMap((held) => commandOf(held) ?? []);
  }

  /** The events this settings file already calls flow for. What makes init idempotent and status honest. */
  function registeredEvents(settings: unknown): string[] {
    const out: string[] = [];
    for (const [event, entries] of Object.entries(hookArrays(settings))) if (!RETIRED.has(event) && entries.some(isOurs)) out.push(event);
    return out;
  }

  /**
   * The events an older flow registered in a way this build does not: a matcher other than the one
   * this build asks for, such as PreToolUse on every tool where only `Bash` has anything to wait for,
   * and a hook this build no longer registers at all (`RETIRED`). Each is its own red line, rather
   * than disappearing inside "registered", and `flow init` rewrites or removes it.
   */
  function staleRegistrations(settings: unknown): string[] {
    const arrays = hookArrays(settings);
    const matcherChanged = HOOK_REGISTRATIONS.filter((registration) =>
      (arrays[registration.event] ?? []).some(
        (entry) => isOurs(entry) && (entry as { matcher?: unknown }).matcher !== registration.matcher,
      ),
    ).map((registration) => registration.event);
    const retired = [...RETIRED.keys()].filter((event) => (arrays[event] ?? []).some(isOurs));
    return [...matcherChanged, ...retired];
  }

  /**
   * flow's own registration in the OLD shape, the bare `flow hook <event>`: the word it answers to, or
   * null when the command is anything else. It finds flow on the PATH alone, so a repo with flow only
   * as a dev dependency answers none of its hooks. A command with a path to the binary is not this
   * shape: it names the copy it runs, and that is somebody's choice.
   */
  function bareHook(command: string): HookEvent | null {
    const word = /^flow\s+hook\s+([a-z-]+)$/.exec(command.trim())?.[1];
    return word !== undefined && isHookEvent(word) ? word : null;
  }

  /** The events this settings file calls flow for in the old shape — see `bareHook`. */
  function bareRegistrations(settings: unknown): string[] {
    return Object.entries(hookArrays(settings))
      .filter(([, entries]) => entries.some((entry) => commandsOf(entry).some((command) => bareHook(command) !== null)))
      .map(([event]) => event);
  }

  /** An event's entries without flow's own commands: an entry left with no hook goes. */
  function withoutOurs(entries: readonly unknown[]): unknown[] {
    return entries.flatMap((entry) => {
      if (!isOurs(entry)) return [entry];
      const shared = entry as Record<string, unknown> & { hooks: unknown[] };
      const kept = shared.hooks.filter((inner) => {
        const command = commandOf(inner);
        return command === null || !ourHookCommand(command);
      });
      return kept.length === 0 ? [] : [{ ...shared, hooks: kept }];
    });
  }

  /**
   * The settings file's hooks, with flow's own entries on those events rewritten in place: a stale
   * matcher made today's, an old-shape command (`bareHook`) made today's, and an event this build no
   * longer registers (`RETIRED`) taken out. FLOW'S OWN ENTRIES ARE FLOW'S TO REWRITE, and these are
   * the only three changes flow makes. Adding a second entry beside either instead would fire flow
   * twice for every event the old one already answers.
   */
  function rewrittenOurs(settings: unknown, stale: ReadonlySet<string>, bare: ReadonlySet<string>): Record<string, unknown> {
    const held = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
    const arrays = hookArrays(settings);
    const hooks: Record<string, unknown> = { ...(held["hooks"] as Record<string, unknown> | undefined) };
    const matcherOf = new Map(HOOK_REGISTRATIONS.map((r) => [r.event, r.matcher]));
    const emptied = new Set<string>();
    for (const event of new Set([...stale, ...bare])) {
      if (RETIRED.has(event)) {
        const left = withoutOurs(arrays[event] ?? []);
        if (left.length === 0) emptied.add(event);
        else hooks[event] = left;
        continue;
      }
      hooks[event] = (arrays[event] ?? []).map((entry) => {
        if (!isOurs(entry)) return entry;
        const ours = entry as Record<string, unknown> & { hooks: unknown[] };
        return {
          ...ours,
          ...(stale.has(event) ? { matcher: matcherOf.get(event) } : {}),
          hooks: ours.hooks.map((inner) => {
            const command = commandOf(inner);
            const word = command === null ? null : bareHook(command);
            return word === null ? inner : { ...(inner as Record<string, unknown>), command: spec.command(word) };
          }),
        };
      });
    }
    return Object.fromEntries(Object.entries(hooks).filter(([event]) => !emptied.has(event)));
  }

  /**
   * A settings file with flow's registrations in it — a NEW object, added to, and with flow's own
   * entries brought up to date.
   *
   * It is somebody's file and holds far more than us, so nothing of anyone else's is rewritten and
   * nothing is removed: a registration on our event that belongs to another tool keeps its place and
   * flow stands beside it. Adding what is already there is skipped, which is the whole of what makes
   * `flow init` idempotent — a second run has nothing to say.
   */
  function withRegistrations(settings: unknown): { settings: unknown; changed: string[] } {
    const base = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
    const already = new Set(registeredEvents(settings));
    const wanted = HOOK_REGISTRATIONS.filter((r) => !already.has(r.event));
    const stale = new Set(staleRegistrations(settings));
    const bare = new Set(bareRegistrations(settings));
    if (wanted.length === 0 && stale.size === 0 && bare.size === 0) return { settings: base, changed: [] };

    const arrays = hookArrays(settings);
    const hooks = rewrittenOurs(settings, stale, bare);
    for (const registration of wanted) {
      hooks[registration.event] = [
        ...(arrays[registration.event] ?? []),
        {
          ...(registration.matcher === undefined ? {} : { matcher: registration.matcher }),
          hooks: [{ type: "command", command: registration.command }],
        },
      ];
    }
    // THE REPORT, in registration order: each event added, rewritten or removed, once, with why.
    const changed: string[] = [];
    for (const event of new Set([...HOOK_REGISTRATIONS.map((r) => r.event), ...bare, ...RETIRED.keys()])) {
      const why = [
        ...(stale.has(event) && RETIRED.has(event) ? ["removed: flow no longer registers it"] : []),
        ...(stale.has(event) && !RETIRED.has(event) ? ["matcher brought up to date"] : []),
        ...(bare.has(event) ? [`now runs the flow in ${PACKAGE_DIR} first`] : []),
      ];
      if (why.length > 0) changed.push(`${event} (${why.join(", ")})`);
      else if (!already.has(event) && !RETIRED.has(event)) changed.push(event);
    }
    return { settings: { ...base, hooks }, changed };
  }

  /**
   * A settings file with flow's registrations taken out — a NEW object, and the reverse of
   * `withRegistrations`.
   *
   * On the events flow registers, each hook whose command is flow's (`ourHookCommand`, so an older
   * flow's bare `flow hook <event>` goes too) is removed; an entry left with no hook goes, an event left
   * with no entry goes, and a `hooks` key left empty goes. Every other key, event and hook is kept as
   * it was. `removed` names the events, in registration order, empty when there was nothing of flow's.
   */
  function withoutRegistrations(settings: unknown): { settings: unknown; removed: string[] } {
    const arrays = hookArrays(settings);
    const removed = [...HOOK_REGISTRATIONS.map((r) => r.event), ...RETIRED.keys()].filter((event) => (arrays[event] ?? []).some(isOurs));
    if (removed.length === 0) return { settings, removed: [] };

    const held = settings as Record<string, unknown>;
    const ours = new Set(removed);
    const hooks: Record<string, unknown> = {};
    for (const [event, value] of Object.entries(held["hooks"] as Record<string, unknown>)) {
      if (!ours.has(event)) {
        hooks[event] = value;
        continue;
      }
      const left = withoutOurs(value as unknown[]);
      if (left.length > 0) hooks[event] = left;
    }
    const rest = Object.fromEntries(Object.entries(held).filter(([key]) => key !== "hooks"));
    return { settings: Object.keys(hooks).length === 0 ? rest : { ...held, hooks }, removed };
  }

  return { registrations: HOOK_REGISTRATIONS, hooks: HOOK_COSTS, ourHookCommand, bareHook, registeredEvents, staleRegistrations, bareRegistrations, withRegistrations, withoutRegistrations };
}
