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

import { isBreadcrumbMoment, isGuardrailMoment, parseCommandLine, programName, type BreadcrumbMoment, type Ctx, type EntrySpec, type ExecResult, type GuardrailMoment, type LoadResult, type Moment, type Refusal, type ShellCommand, type ShellStart, type TurnAction } from "../language/domain.ts";
import { covers, FLOW_DIR, formatBlock, insideRepo, momentsView, universe, watching, type Block, type Bound, type Metrics, type MomentsView, type Row, type TerrainNode } from "../engine/domain.ts";
import { gitCommands, missingGrammarText, quoteArg } from "../checks/domain.ts";
import type {
  Delivered,
  HarnessFacts,
  HookCost,
  HookResult,
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
      readonly path?: string | undefined;
      readonly command?: string | undefined;
    };

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
 * High-signal pushback — where the human corrected the agent. A HEURISTIC, and the report says so.
 *
 * It is deliberately generous: the cost of a false positive is a coach reading one line that turns
 * out to be fine, and the cost of a false negative is the session's most informative moment going
 * unnoticed.
 */
// THE ANCHORING IS OUTSIDE THE CLASSES, and that is a fix rather than a transcription. The ported
// regex wrapped every alternative in one `\b(…)\b`, so the two that end in punctuation — `wait[, ]`
// and `no[, ]` — were then asked for a word boundary immediately after a comma or a space, which
// neither can ever be followed by. `no, that's wrong` and `wait, stop` are the two commonest
// spellings of pushback there are, and both alternatives were dead: a detector that reads as armed
// and matches nothing is the spec's own P2 shape, inside the code meant to find it.
const CORRECTION = new RegExp(
  [
    String.raw`\b(actually|hold on|nope|revert|undo|instead|hmm)\b`,
    String.raw`\b(wait|no)[,!.](\s|$)`,
    String.raw`\b(stop|don'?t|do not)\s`,
    String.raw`\bthat'?s (wrong|not right|not what|not)\b`,
    String.raw`\byou (broke|shouldn'?t|missed|forgot|didn'?t)\b`,
    String.raw`\bwhy (did|are) you\b`,
    String.raw`\b(rather than|let'?s not)\b`,
  ].join("|"),
  "i",
);

/** Does this prompt read as the human pushing back? */
export function isCorrection(prose: string): boolean {
  return CORRECTION.test(prose);
}

// ── the justfile's own tools, so a bypass is derived rather than guessed ──
//
// Each recipe's body is parsed, and each command's program, or the tool `npx` runs, is a tool that
// "should go through just". Shell noise is dropped; with no justfile, bypass detection is switched
// off entirely rather than falling back to a hardcoded list that would be wrong for every other repo.

const NOISE = new Set([
  "set", "node", "npx", "just", "cd", "export", "echo", "then", "fi", "do", "done", "if", "for", "while", "source",
]);

/** Is this top-level line a recipe header — `name:`, `name arg:`, `[attr]` and all? */
function isRecipeHeader(line: string): boolean {
  if (line.startsWith("[")) return false;
  const colon = line.indexOf(":");
  if (colon < 0) return false;
  const head = line.slice(0, colon).trim();
  return head !== "" && /^[@A-Za-z_][\w-]*(\s|$)/.test(head) && !head.includes("=");
}

/**
 * The tools a repo's justfile actually drives — what a direct invocation would be bypassing.
 *
 * Each recipe's body is read through the parse as one script, so a loop or an `if` that spans its
 * lines is read whole; a body that does not parse whole is read line by line, and a line that does
 * not parse names nothing. Just's own `@` and `-` line prefixes are dropped first.
 */
export function recipeTools(justfile: string): string[] {
  const bodies: string[][] = [];
  let body: string[] | null = null;
  for (const raw of justfile.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (!/^\s/.test(raw)) {
      // A top-level line opens a recipe, or ends one; the header itself is not a command.
      body = isRecipeHeader(line) ? [] : null;
      if (body !== null) bodies.push(body);
    } else if (body !== null && !line.startsWith("#")) body.push(line.replace(/^[@-]+/, ""));
  }
  const tools = new Set<string>();
  for (const lines of bodies) {
    const commands = parseCommandLine(lines.join("\n")) ?? lines.flatMap((line) => parseCommandLine(line) ?? []);
    for (const command of commands) {
      // A LAUNCHER names the tool in its next word, and dropping the line at the launcher is how
      // the ported reader came back empty on this very repo: every recipe here is `npx tsc`,
      // `npx vitest`, `npx eslint`, so `npx` matched the noise list and no tool was ever
      // collected — leaving the bypass section switched off and looking like a clean record.
      const tool = toolOf(command);
      if (command.nested || command.program.includes("/") || !/^[A-Za-z]/.test(tool) || NOISE.has(tool)) continue;
      tools.add(tool);
    }
  }
  return [...tools];
}

/** What one Bash line was: the recipes it drove, the tools it went round, and whether it committed. */
export interface BashClass {
  readonly recipes: readonly string[];
  readonly bypasses: readonly string[];
  readonly commits: boolean;
}

/** The tool a command runs: its program, or the tool `npx` is asked to run. */
function toolOf(command: ShellCommand): string {
  const program = programName(command.program);
  return program === "npx" ? programName(command.args.find((arg) => !arg.startsWith("-")) ?? "") : program;
}

/**
 * Read one command line against the repo's own recipe tools, from its parse. A heredoc's body is
 * text the command is fed, so a file being written that names a tool is not a run of it — while
 * the line around the heredoc is judged like any other, and so is a body a shell runs. A line that
 * does not parse is nothing: no recipe, no bypass, no commit.
 */
export function classifyBash(command: unknown, tools: readonly string[]): BashClass {
  const commands = parseCommandLine(strip(command)) ?? [];
  const recipes = commands.flatMap((c) => {
    const recipe = programName(c.program) === "just" ? c.args[0] : undefined;
    return recipe !== undefined && /^[a-z][\w-]*$/.test(recipe) ? [recipe] : [];
  });
  const ran = new Set(commands.map(toolOf));
  return {
    recipes,
    bypasses: tools.filter((tool) => ran.has(tool)),
    commits: gitCommands({ commands }).some((git) => git.subcommand === "commit"),
  };
}

// ── the reading ────────────────────────────────────────────────────────────

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
  readonly shell: { readonly reads: Readonly<Record<string, number>> };
  /** Every in-repo file the session touched, with how often. The facts layer scores coverage. */
  readonly touched: Readonly<Record<string, number>>;
}

/** How many times one file is edited in a row before it reads as a loop. */
const LOOP = 5;

/** How many times one command line is repeated before it reads as a retry. */
const RETRY = 3;

// `insideRepo` is the engine's, imported rather than re-spelled: whether a path is a file of this
// repo decides what the narrative counts as touched AND what the record counts as an uncovered
// edit, and those two must never be able to disagree.

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
export function narrative(events: readonly TranscriptEvent[], tools: readonly string[] = []): Narrative {
  let edits = 0;
  let writes = 0;
  let shellReads = 0;
  const shell = { reads: {} as Record<string, number> };
  let commits = 0;
  const recipes: Record<string, number> = {};
  const bypasses: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const prompts: Pointer[] = [];
  const corrections: Pointer[] = [];
  const bypassSites: Bypass[] = [];
  const loops: EditLoop[] = [];
  const retries: Retry[] = [];
  const byCommand: Record<string, number[]> = {};

  let loopPath: string | null = null;
  let loopFrom = 0;
  let loopTo = 0;
  let loopCount = 0;
  const closeLoop = (): void => {
    if (loopCount >= LOOP && loopPath !== null) loops.push({ path: loopPath, count: loopCount, from: loopFrom, to: loopTo });
  };

  for (const event of events) {
    if (event.kind === "prompt") {
      prompts.push({ line: event.line, text: snip(event.text, 120) });
      if (isCorrection(event.text)) corrections.push({ line: event.line, text: snip(event.text, 140) });
      continue;
    }
    if (event.kind !== "use") continue;

    // THE one edit-tool set, the same one the flight recorder stamps a row with. There were two
    // in the old engine and they had already drifted; a fact about the host's tool names is
    // spelled once in this file and read everywhere.
    if (event.action === "edit" || event.action === "write") {
      if (event.action === "write") writes += 1;
      else edits += 1;
      const here = insideRepo(event.path);
      if (here && event.path === loopPath) {
        loopCount += 1;
        loopTo = event.line;
      } else {
        closeLoop();
        loopPath = here ? event.path : null;
        loopFrom = event.line;
        loopTo = event.line;
        loopCount = here ? 1 : 0;
      }
      if (here) touched[event.path] = (touched[event.path] ?? 0) + 1;
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
    const command = text(event.input["command"]);
    const read = classifyBash(command, tools);
    for (const recipe of read.recipes) recipes[recipe] = (recipes[recipe] ?? 0) + 1;
    for (const tool of read.bypasses) {
      bypasses[tool] = (bypasses[tool] ?? 0) + 1;
      bypassSites.push({ line: event.line, tool, text: snip(command, 120) });
    }
    if (read.commits) commits += 1;
    const normalised = snip(command, 400);
    (byCommand[normalised] ??= []).push(event.line);
  }
  closeLoop();
  for (const [command, lines] of Object.entries(byCommand))
    if (lines.length >= RETRY) retries.push({ command, count: lines.length, lines });

  return {
    stats: { edits, writes, shellReads, commits, recipes, bypasses },
    prompts,
    corrections,
    bypassSites,
    loops,
    retries,
    shell,
    touched,
  };
}

/**
 * Every narrative reading merged into one, each pointer tagged with the transcript it came from.
 *
 * The report is ONE aggregate whether it read one conversation or a hundred — the flags only
 * re-scope which sessions it covers, never its shape — so this is where the per-session readings
 * stop being chapters and become one list somebody can work down.
 */
export function mergeNarratives(each: readonly { session: string; read: Narrative }[]): Narrative {
  const tag = <T extends object>(rows: readonly T[], session: string): (T & { session: string })[] =>
    rows.map((row) => ({ ...row, session }));
  const recipes: Record<string, number> = {};
  const bypasses: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const out = {
    prompts: [] as Pointer[],
    corrections: [] as Pointer[],
    bypassSites: [] as Bypass[],
    loops: [] as EditLoop[],
    retries: [] as Retry[],
  };
  let edits = 0;
  let writes = 0;
  let shellReads = 0;
  let commits = 0;
  const shell = { reads: {} as Record<string, number> };
  const add = (into: Record<string, number>, from: Readonly<Record<string, number>>): void => {
    for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
  };

  for (const { session, read } of each) {
    out.prompts.push(...tag(read.prompts, session));
    out.corrections.push(...tag(read.corrections, session));
    out.bypassSites.push(...tag(read.bypassSites, session));
    out.loops.push(...tag(read.loops, session));
    out.retries.push(...tag(read.retries, session));
    edits += read.stats.edits;
    writes += read.stats.writes;
    shellReads += read.stats.shellReads;
    commits += read.stats.commits;
    add(recipes, read.stats.recipes);
    add(bypasses, read.stats.bypasses);
    add(touched, read.touched);
    add(shell.reads, read.shell.reads);
  }
  return { stats: { edits, writes, shellReads, commits, recipes, bypasses }, ...out, shell, touched };
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
}

/** What a reader must know before believing anything under it. */
export function health({ armed, rows, withRecord, analysed }: HealthArgs): Health {
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

export interface Facts {
  /** What the harness is called in a sentence. */
  readonly host: string;
  readonly root: string;
  readonly store: { readonly dir: string; readonly exists: boolean; readonly ignored: readonly string[] };
  /** Which conversations this run covers, and which it deliberately deferred. */
  readonly selection: Selection;
  readonly coverage: { readonly analysed: number; readonly withRecord: number; readonly narrativeOnly: number };
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
  if (headline.dead.length > 0) lines.push(`  dead      ${headline.dead.join(" · ")}`);
  if (headline.retire.length > 0) lines.push(`  retire    ${headline.retire.join(" · ")} — bound, never once reached`);
  if (headline.quiet.length > 0)
    lines.push(`  quiet     ${headline.quiet.map((q) => `${q.id} (${q.daysSince}d)`).join(" · ")}`);

  const { stats, corrections, loops, retries, bypassSites, shell } = facts.narrative;
  lines.push(
    `  session   ${stats.edits} edits · ${stats.writes} writes · ` +
      `${stats.shellReads} shell reads · ${stats.commits} commits · ` +
      `${corrections.length} corrections · ${loops.length} edit loops · ${retries.length} retries · ` +
      `${bypassSites.length} bypasses`,
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

/** Harness names typed by a person — `claude-code,codex` or `claude-code codex` — read: the ids, or the first name no harness has. */
export function parseHarnesses(typed: string, found: readonly Found[]): { readonly ok: true; readonly ids: string[] } | { readonly ok: false; readonly unknown: string } {
  const ids = typed.split(/[\s,]+/).filter((name) => name !== "");
  const unknown = ids.find((id) => !found.some(({ harness }) => harness.id === id));
  return unknown === undefined ? { ok: true, ids: [...new Set(ids)] } : { ok: false, unknown };
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

/** The config `flow init --empty` leaves: the wiring, with no opinions. */
const EMPTY_CONFIG = String.raw`// flow.config.ts — this repo's whole guard.
//
// A rule not reachable from this file does not run. Bind a pack with ` + "`pack(x)`" + String.raw`, refine one of
// its entries with ` + "`override(x.entry)`" + String.raw`, and ask ` + "`flow status`" + String.raw` what is live.

import { defineConfig } from "@jawache/flow";

export default defineConfig([]);
`;

/**
 * THE DEMO — the config `flow init` leaves behind, and the whole of J6.1.
 *
 * TWO IMPORTS AND THE SPLIT IS THE LESSON. `@jawache/flow` is the grammar a rule is written in;
 * `@jawache/flow/packs` is the content the package ships, bound one `pack(…)` line each. `flow` is
 * bound by default because it is flow's own self-protection — the note saying what is steering you,
 * the nudge when you edit the steering itself, and the refusal when a command would delete it — and
 * every repo running flow wants all three whether or not it wants anything else. `--empty` leaves
 * it out, along with everything else.
 *
 * Its one parameter is `packs`, and the scaffold passes EXACTLY WHAT IT SCAFFOLDS: an empty list,
 * because everything it writes is in the config file itself. That is a real answer rather than a
 * missing one, and the comment beside it says what to add on the day the rules move to a folder —
 * a repo that grows one and forgets to say so has a nudge and a delete refusal watching nothing.
 *
 * Then three entries of this repo's own on one screen: a command ban, a commit gate over staged
 * content, and one rule bound to an ACTOR rather than to a path. It is a worked example of J1.2 as
 * much as a starting guard — a pack written here is written exactly as a published one is, and
 * promoting it would change the import line and nothing else.
 *
 * Written with `String.raw` so the regex inside it is the regex a reader will see: this is source
 * code that generates source code, and a scaffold whose backslashes were eaten on the way out is a
 * config that loads and matches nothing.
 */
const DEMO_CONFIG = String.raw`// flow.config.ts — this repo's whole guard, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Everything below is ordinary code: a pack is a
// module, a check is a function of its ctx, and a category is a name with its recognizer aboard.
// Nothing defaults — an absent key is absent — so a mistake fails in your editor, not at 3am.
//
//   flow status   what is bound, at which moments, and what is not wired yet
//   flow test     every rule's own cases, run

import { banCommands, command, commit, defineCategory, defineConfig, definePack, guardrail, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

// A category is a name and the HOST-WRITTEN evidence that recognises it — never a claim a session
// made about itself. This one is "the harness sent an agent id with your call", which is what a
// spawned subagent is and a chat is not.
const subagent = defineCategory("subagent", (facts) => facts.subagent);

// Spelled in pieces on purpose. Written whole it would appear in this very file, and the gate below
// greps staged content — so the demo would refuse the commit that added it.
const MARKER = ["DO", "NOT", "COMMIT"].join("-");

export const demo = definePack("demo", {
  noForcePush: guardrail()
    .at(command)
    .check(banCommands({ ban: ["git push --force", "git push -f", "git push --force-with-lease"] }))
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main", "git push --force-with-lease origin main"] }),

  // No .on() here, and that is the sentence rather than an omission: an entry that names no paths is
  // about THE COMMIT, so it is asked once and handed the whole staged set. (Name paths with .on()
  // and the gate asks it once per staged file in scope instead, handing over each file.)
  noMarkedFiles: guardrail()
    .at(commit)
    .check(async (ctx) => {
      for (const path of ctx.staged ?? [])
        if ((await ctx.fs.read(path)).includes(MARKER)) return ctx.fail(path + " carries the marker");
      return ctx.ok();
    })
    .message("A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.")
    .test({
      pass: [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
      block: [{ staged: ["a.txt"], world: { fs: { "a.txt": MARKER } } }],
    }),

  // The same act, a different wearer, a different answer — a rule bound to WHO rather than to what.
  chatCommits: guardrail()
    .at(commit)
    .for(subagent)
    .check((ctx) => ctx.fail((ctx.staged ?? []).length + " staged file(s)"))
    .message("A subagent does not commit — hand the change back to the chat that spawned it.")
    .test({ pass: [], block: [{ staged: ["a.txt"] }] }),
});

export default defineConfig([
  // flow's own self-protection: what is steering you, a nudge when you edit it, and no deleting it.
  // Its packs list is where YOUR OWN packs live. Everything here is in this file, so it is empty —
  // move a pack out to a folder of its own and add that folder's glob, or the nudge and the delete
  // refusal stop covering it.
  pack(flow, { packs: [] }),
  pack(demo),
]);
`;

/** The config file init writes: the demo, or the bare one `--empty` asks for. */
export function scaffold(empty: boolean): string {
  return empty ? EMPTY_CONFIG : DEMO_CONFIG;
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
  /** `--empty`: the wiring, with no demo. */
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
    ? `registered · ${ran}`
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

function fittingsOf(facts: StatusFacts): Fitting[] {
  const armed = armsFlow(facts.gateText);
  const old = !armed && armsOldFlow(facts.gateText);
  const olderGate = armsFlow(facts.oldGateText) || armsOldFlow(facts.oldGateText);
  return [
    {
      id: "config",
      ok: facts.hasConfig,
      detail: facts.hasConfig
        ? facts.configPath
        : `no ${CONFIG_FILE} in ${facts.root} — \`flow init\` writes one, with a demo you can read in a minute.`,
    },
    {
      id: "commit-gate",
      ok: armed && !olderGate,
      detail: olderGate
        ? `${OLD_GATE_PATH} still runs flow, without the commit message — \`flow init\` replaces it with ${GATE_PATH}.`
        : armed
        ? `${GATE_PATH} runs \`flow hook commit\` over the staged changes`
        : old
          ? `${GATE_PATH} calls the old \`flow commit\`, which leaves every deleted file unchecked — ${UPDATE_THE_GATE_LINE}.`
          : facts.gateText === null
            ? `no ${GATE_PATH} — \`flow init\` arms it. Until then nothing runs at the commit.`
            : `${GATE_PATH} is here but does not call flow — ${ADD_THE_GATE_LINE}.`,
    },
    hooksPathFitting(facts),
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
    binaryFitting(facts),
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
      id: "hooks-path",
      ok: false,
      detail: HOOKS_UNKNOWN,
    };
  if (folder.dir === HOOKS_DIR) return { id: "hooks-path", ok: true, detail: `core.hooksPath = ${HOOKS_DIR}` };
  const other = otherHooks(facts.hooksPath, folder);
  if (other === null)
    return {
      id: "hooks-path",
      ok: false,
      detail: `core.hooksPath is ${facts.hooksPath ?? "unset"} — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    };
  return unwired(other)
    ? { id: "hooks-path", ok: false, detail: notInstalledLines(other).join("\n") }
    : { id: "hooks-path", ok: true, detail: wiredLine(other) };
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
function binaryFitting(facts: Pick<StatusFacts, "binary" | "gateText" | "harnesses">): Fitting {
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
          ? `the hooks and the gate run the flow ${byHooks}`
          : `the hooks run the flow ${byHooks}, and the gate the flow ${byGate}`,
    };
  const install = `install it for this repo with \`npm i -D @jawache/flow\`, or for every repo with \`npm i -g @jawache/flow\`.`;
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
      `so ${stranded.map((s) => s.fails).join(" and ")} — ${stranded.map((s) => s.fix).join("; ")}; or install it for every repo with \`npm i -g @jawache/flow\`.`,
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
  else if (entry.says !== null) lines.push(`        ${snip(entry.says, 100)}`);
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
    `  session    ` +
      (s.session === null
        ? "no live session has marked this worktree yet"
        : `${s.session.id}${s.session.agent === null ? "" : ` · ${s.session.agent}`}, wearing ${s.session.wearing.length === 0 ? "no category" : s.session.wearing.join(" · ")}`),
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
