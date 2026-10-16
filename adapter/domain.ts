// flow/adapter/domain.ts — THE CLAUDE CODE DIALECT, and the only file in flow that knows what a
// hook payload looks like.
//
// Fourth and last stage of flow's pipeline:
//
//   language → checks → engine → adapter
//
// Everything upstream is harness-blind on purpose: the engine is handed events and answers with
// effects, and it could not name `tool_input`, `stop_hook_active` or a `.jsonl` transcript if it
// wanted to. This file is where those words are allowed, and it is the whole of the contact — the
// seam that makes a recorded session replayable with no harness at all (F5), and the reason a
// second harness is a second column rather than a second engine.
//
// THE SEVEN QUESTIONS (pack-engine guide §7) are what an adapter IS. Six are answered here; the
// one that needs the process environment is answered by the shell next door:
//
//   how does a live moment arrive   JSON on stdin of `flow hook <event>`       → toEvent
//   how do we block                 exit 2, stderr shown to the model          → toResult
//   how do we inject context        stdout decision JSON · additionalContext   → toResult
//   how many tokens so far          parsed from the transcript                 → tokensFromTranscript
//   what moments can it deliver     the honest list, never a faked one         → DELIVERS
//   which repo is this              CLAUDE_PROJECT_DIR, falling back to cwd    → claude.ts
//   where is the session log        transcript_path; a subagent's own under it → ownTranscriptPath
//
// IT IS STILL A PURE HOME. `flow/**/domain.ts` is flow's pure shape, so there is no node:fs, no
// child_process and no process.env here — the bytes are handed over. That split is what lets the
// dialect be proved by ordinary unit tests: a payload is an object, a transcript is a string, and
// what they MEAN is a decision like any other. The reaching is claude.ts's job, and it decides
// nothing.
//
// FOUR of the old engine's dialect leaks come home here, out of pure homes they had no business in:
// the transcript token count, the tool-use parse that a rule script did through an environment
// variable, the edit-tool name set, and the flight recorder's row.

import {
  isBreadcrumbMoment,
  isGuardrailMoment,
  parseCommandLine,
  parseShellSteps,
  programName,
  stepCommands,
  type BreadcrumbMoment,
  type Ctx,
  type EntrySpec,
  type LoadedEntry,
  type ExecResult,
  type GuardrailMoment,
  type LoadResult,
  type Moment,
  type Refusal,
  type SessionFacts,
  type ShellCommand,
  type ShellStep,
  type ShellWord,
  type TurnAction,
} from "../language/domain.ts";
import {
  covers,
  fires,
  FLOW_DIR,
  formatBlock,
  insideRepo,
  momentsView,
  universe,
  watching,
  type Block,
  type Bound,
  type Cause,
  type Metrics,
  type MomentsView,
  type Row,
  type TerrainNode,
} from "../engine/domain.ts";
// Git read from the parse, borrowed rather than copied. Reading `git rm src/x.ts` for the paths it
// would remove is event ASSEMBLY — the adapter's job — but where git's own options stop and its
// subcommand starts is a question the checks layer already answers.
import { GIT_VALUE_OPTS, gitCommand, gitCommands, missingGrammarText } from "../checks/domain.ts";
// String algebra only — a Bash read is resolved against the directory the shell was in.
import { posix } from "node:path";
// The one glob engine. A coverage question asked with a second matcher is a coverage answer about
// files the guard never judged — see flow/glob.ts on why there is exactly one.
import { matchAny } from "../glob.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PAYLOAD — what the harness sends, and what flow answers to
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One hook payload, as Claude Code writes it on stdin.
 *
 * Deliberately loose, every field optional: it is JSON from another program, so a shape this file
 * DEMANDS is a shape that breaks the day the host adds a field or omits one. The index signature is
 * not laziness either — F5's archival side reads keys this phase has no use for, and a payload
 * narrowed on the way in cannot grow them back.
 */
export interface HookPayload {
  readonly session_id?: string;
  /** Present on every call a SUBAGENT makes, and only then: the host's id for that one spawn. */
  readonly agent_id?: string;
  /**
   * The agent type the host started this subagent as, sent beside `agent_id` on its every call.
   * Host-written: the session cannot change the message, which is why a category may key on it.
   */
  readonly agent_type?: string;
  readonly hook_event_name?: string;
  readonly transcript_path?: string;
  readonly stop_hook_active?: boolean;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  /** SessionStart's reason: `startup` · `resume` · `clear` · `compact` — the compaction announcement. */
  readonly source?: string;
  /**
   * The host's id for one tool call, the same on its PreToolUse and its PostToolUse. It is the key
   * the snapshot taken before the call is filed under and looked up by after it.
   */
  readonly tool_use_id?: string;
  /**
   * The permission mode the session runs under (`default` · `acceptEdits` · `plan` · `auto` · …),
   * as the host states it on every call. Recorded and reported; never a category key.
   */
  readonly permission_mode?: string;
  /** What the tool answered, on the after-call rails. Read for the host's own changed-file list. */
  readonly tool_response?: unknown;
  readonly [key: string]: unknown;
}

/**
 * The events flow answers, named by the EVENT and never by the job.
 *
 * Carried from the old engine unchanged, and the naming rule with it: call a hook
 * `flow hook plan-drift` and the day a second concern wants the same host event you register a
 * second hook beside the first, which is the duplicate-firing problem the grammar exists to make
 * impossible. One command per event; a second concern extends the function.
 */
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

export const HOOK_EVENTS = [
  "session-start",
  "pre-tool-use",
  "post-tool-use",
  "post-tool-use-failure",
  "stop",
  "subagent-stop",
  "notification",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(word: string): word is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(word);
}

/** The host's own name for each event — what a decision object has to echo back. */
const HOST_EVENT: Record<HookEvent, string> = {
  "session-start": "SessionStart",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  "post-tool-use-failure": "PostToolUseFailure",
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
 *   · `commit` is delivered, but not by the harness — git's pre-commit hook calls `flow hook
 *     commit`, which is why every harness gets the gates for free and why it is in this list at all.
 *   · turn-end BRIEFING is delivered, on the `Stop` and `SubagentStop` answers'
 *     `additionalContext`: the host labels it hook feedback rather than an error, and the agent
 *     takes one more turn to read it. A refusal at the same hand-back carries the note beside it
 *     (`toResult`), so the agent is held and told at once rather than held, then told on the next.
 *   · command BRIEFING is delivered, on the same PreToolUse answer the command guardrails use: when
 *     nothing blocks, the hook's `additionalContext` carries the note, and when something does, the
 *     refusal wins — which is the right order, since a blocked command is not about to run. The
 *     files a Bash command reads ride that same answer as touches (`bashReads`), so an area's note
 *     arrives before the output does.
 *
 * It is two lists rather than one because a moment is delivered for a KIND of entry: `command` and
 * `turn-end` are words in both vocabularies, and another harness may carry one rail there and not
 * the other — a single flat list could only lie about one of them.
 */
export const DELIVERS = {
  guard: ["write", "delete", "command", "commit", "turn-end"] as readonly GuardrailMoment[],
  brief: ["session", "touch", "command", "turn-end"] as readonly BreadcrumbMoment[],
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
function text(value: unknown): string {
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
      readonly file?: Ctx["file"];
      readonly command?: string | undefined;
      /** command: the line's parse, made once here and handed to the engine with the line. */
      readonly commands?: Ctx["commands"];
      readonly staged?: readonly string[] | undefined;
      readonly turn?: readonly TurnAction[] | undefined;
      /**
       * The change has already LANDED: the file came out of the delta after the call, not out of a
       * tool's input before it. A refusal of an observed write is undone from the snapshot, and it
       * is refused under its own banner.
       */
      readonly observed?: boolean | undefined;
    }
  | {
      readonly rail: "brief";
      readonly moment: BreadcrumbMoment;
      readonly path?: string | undefined;
      readonly command?: string | undefined;
    };

/**
 * What a payload needs from the world before it can become an event. Injected, never reached for.
 *
 * Every answer is a FUNCTION rather than a value, and that is not ceremony: a hook fires on every
 * tool call, and the turn's actions cost a whole transcript to work out. Asking only when the
 * moment needs it means the write rail — by far the most frequent — never opens the file at all.
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
   * as none. Only `subagent-stop` asks, and only of a payload that names an agent type, because it
   * costs the parent's transcript: it is how an internal agent's hand-back is told from a subagent's.
   */
  readonly sessionAgent?: (() => string | null) | undefined;
  /** The home directory, for a Bash read through `~`. Absent, such a path is simply not named. */
  readonly home?: string | undefined;
  /**
   * What the call changed in the tree, from the snapshot taken before it. Only the after-call
   * rails carry it; absent, the call changed nothing flow could see.
   */
  readonly changes?: readonly Change[] | undefined;
}

/** An absolute path inside the repo → the repo-relative spelling every glob is written against. */
export function relativise(path: string, root: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** One edit operation, as the Edit tool states it. */
export interface EditOp {
  readonly old_string?: string;
  readonly new_string?: string;
  readonly replace_all?: boolean;
}

/**
 * Fold one Edit into the text it would produce — the delicate half of the pre-emptive rail.
 *
 * The whole capability rests on reconstructing the would-be file EXACTLY as the Edit tool would
 * write it: get this wrong and the guard judges a file that never existed, which is worse than not
 * guarding at all. Null when the anchor is not in the base text — the caller must then stand aside
 * rather than judge a guess.
 *
 * Lifted from the old engine with its behaviour intact, including the empty-anchor case:
 * `old_string: ""` is a Write wearing an Edit's clothes, and the new text is the whole file.
 */
export function applyEdit(
  base: string,
  { old_string = "", new_string = "", replace_all = false }: EditOp,
): string | null {
  if (old_string === "") return new_string;
  if (replace_all) return base.split(old_string).join(new_string);
  const at = base.indexOf(old_string);
  if (at === -1) return null;
  return base.slice(0, at) + new_string + base.slice(at + old_string.length);
}

/**
 * The file as it WOULD be on disk after this tool call, disk untouched — J2.2, and the whole reason
 * to guard at PreToolUse rather than after the write.
 *
 * Write carries the content outright; Edit is a diff against what is there; MultiEdit is a fold of
 * several, and one unlocatable anchor abandons the whole reconstruction rather than judging a
 * half-applied file. A tool that names no path is not a write at all.
 */
export function wouldBeFile(
  tool: string,
  input: Record<string, unknown>,
  world: EventWorld,
): { path: string; content: string } | null {
  const named = input["file_path"];
  if (!named) return null;
  const path = relativise(text(named), world.root);
  if (tool === "Write") return { path, content: text(input["content"] ?? "") };
  if (tool === "Edit") {
    const next = applyEdit(world.read(path) ?? "", input);
    return next === null ? null : { path, content: next };
  }
  if (tool === "MultiEdit") {
    let content: string | null = world.read(path) ?? "";
    for (const edit of (input["edits"] as readonly EditOp[] | undefined) ?? []) {
      content = applyEdit(content, edit);
      if (content === null) return null;
    }
    return { path, content };
  }
  return null;
}

/** The programs, and the git subcommands, that remove a file — and whether their LAST argument is a destination instead. */
const REMOVERS: ReadonlyMap<string, { readonly renames: boolean }> = new Map([
  ["rm", { renames: false }],
  ["mv", { renames: true }],
]);

/**
 * The paths a Bash line would remove — `rm`, `git rm`, and the SOURCE side of `mv` / `git mv` —
 * read from those commands' arguments in the parse.
 *
 * Deletion has no tool of its own: it is a side effect of a shell command, so the delete moment is
 * assembled here or it does not exist at all. The parse decides what is a command, so a commit
 * message mentioning `rm`, a heredoc body that names a file, or an `echo 'rm a.ts'` is not a
 * removal, while an `rm` inside a `$( … )` or a `bash -c` string, which runs, is.
 *
 * A line that does not parse yields NOTHING, deliberately: the parse's `null` means "I cannot tell",
 * and a guard that guesses at a line it could not parse is worse than one that stands aside. The
 * command rail still sees the raw line either way.
 */
export function deleteTargets(commands: readonly ShellCommand[] | null): string[] {
  const out: string[] = [];
  for (const command of commands ?? []) {
    const git = gitCommand(command);
    const remover = git === null ? REMOVERS.get(programName(command.program)) : git.subcommand === null ? undefined : REMOVERS.get(git.subcommand);
    if (remover === undefined) continue;
    const args = git === null ? command.args : git.args;
    const dash = args.indexOf("--");
    const named = [...(dash === -1 ? args : args.slice(0, dash)).filter((arg) => !arg.startsWith("-")), ...(dash === -1 ? [] : args.slice(dash + 1))];
    out.push(...(remover.renames ? named.slice(0, -1) : named));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BASH READS — the files a shell command reads, for the touch breadcrumb
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Under auto mode most contact with an area is a `cat`, a `grep` or a `sed -n` whose payload names
// no path, so a touch breadcrumb keyed on `file_path` never saw it. This names those paths from the
// command line, BEFORE it runs, so the note rides the PreToolUse answer and arrives ahead of the
// output.
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
// BEST-EFFORT AND FAILING OPEN, on purpose. A breadcrumb is guidance, not a refusal: a word that
// cannot be settled from the line — a `$(…)`, an unknown variable — is left out rather than
// guessed at, and a line that does not parse names nothing. What it misses the working-tree delta
// catches later: a file changed before any read of it was seen gets its note at the change.

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

/** An option word: a dash and something after it. `-` alone is stdin, and an unknown is not one. */
const isOption = (arg: Arg): boolean => arg !== null && arg.startsWith("-") && arg !== "-";

/** What one simple command reads, as written: files, the paths a search walks, and `git -C`'s dir. */
interface ArgvReads {
  readonly reads: string[];
  readonly searched: string[];
  readonly base?: string;
}

/**
 * The paths one simple command reads, as written, and the directory they are relative to when the
 * command moves it (`git -C`). An unknown argument is skipped, never guessed at.
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
 * `git [-C dir] <look> … [-- paths]` → the pathspecs, and the directory `-C` moved it to. A
 * pathspec may name a directory, so it is a search.
 */
function gitReads(args: readonly Arg[], reads: string[]): ArgvReads {
  const searched: string[] = [];
  let base: string | undefined;
  let i = 0;
  for (let opt = args[0] ?? null; isOption(opt); opt = args[i] ?? null) {
    const value = args[i + 1];
    if (opt === "-C" && typeof value === "string") base = value;
    i += GIT_VALUE_OPTS.has(opt as string) ? 2 : 1;
  }
  const sub = args[i];
  const found = base === undefined ? { reads, searched } : { reads, searched, base };
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

interface ShellScope {
  cwd: string | null;
  old: string | null;
  readonly vars: Map<string, string>;
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
 * One word of the parse as the shell would expand it, from what the line itself holds: an unquoted
 * leading `~`, `$HOME`, and a variable the line assigned. Quoted or escaped text is passed as is,
 * so `'$F'` stays `$F`. Null when only running the line could tell — an unknown or special
 * variable, a `${…}` with an operation in it, or a substitution, whose commands are read as steps
 * of their own.
 */
function expandWord(word: ShellWord, vars: ReadonlyMap<string, string>, home: string | undefined): string | null {
  let out = "";
  for (const piece of word) {
    const value =
      piece.kind === "text" ? piece.text : piece.kind === "tilde" ? home : piece.kind === "variable" ? (piece.name === "HOME" ? home : vars.get(piece.name)) : undefined;
    if (value === undefined) return null;
    out += value;
  }
  return out;
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
 * commands a `$(…)` runs. The repo root itself is not an area and is left out. Best-effort, failing
 * open: see the section head. A line that does not parse names nothing.
 */
export function bashReads(steps: readonly ShellStep[] | null, where: BashWhere): BashReads {
  const reads: string[] = [];
  const searched: string[] = [];
  const at = (path: string, base: string | null): string | null =>
    path.startsWith("/") ? posix.resolve(path) : base === null ? null : posix.resolve(base, path);
  const add = (list: string[], path: string | null): void => {
    const rel = path !== null && path.startsWith(`${where.root}/`) ? path.slice(where.root.length + 1) : null;
    if (rel !== null && !list.includes(rel)) list.push(rel);
  };
  const assign = (name: string, value: ShellWord, scope: ShellScope): void => {
    const expanded = expandWord(value, scope.vars, where.home);
    if (expanded === null) scope.vars.delete(name);
    else scope.vars.set(name, expanded);
  };
  const run = (step: Extract<ShellStep, { kind: "command" }>, scope: ShellScope): void => {
    for (const { operator, target } of step.redirects) {
      if (operator !== "<" && operator !== "<>") continue;
      const path = expandWord(target, scope.vars, where.home);
      add(reads, path === null ? null : at(path, scope.cwd));
    }
    const expand = (word: ShellWord): string | null => expandWord(word, scope.vars, where.home);
    const list = xargsList(step.words.slice(0, step.at).map(expand));
    if (list !== null) add(reads, at(list, scope.cwd));
    const name = step.command.program;
    const words = step.words.slice(step.at + 1);
    const argv = [expand(step.words[step.at] ?? []), ...words.map(expand)];
    if (name === "cd" || name === "pushd") {
      const target = argv.slice(1).find((arg) => !isOption(arg));
      const next = target === undefined ? (where.home ?? null) : target === null ? null : target === "-" ? scope.old : at(target, scope.cwd);
      scope.old = scope.cwd;
      scope.cwd = next;
      return;
    }
    const found = argvReads(argv);
    const from = found.base === undefined ? scope.cwd : at(found.base, scope.cwd);
    for (const path of found.reads) add(reads, at(path, from));
    for (const path of found.searched) add(searched, at(path, from));
  };
  const walk = (body: readonly ShellStep[], scope: ShellScope): void => {
    for (const step of body) {
      if (step.kind === "command") {
        // The substitutions that build its words run first, each in a scope of its own.
        walk(step.before, scope);
        run(step, scope);
      }
      else if (step.kind === "assign") assign(step.name, step.value, scope);
      else if (step.kind === "scope") walk(step.body, { cwd: scope.cwd, old: scope.old, vars: new Map(scope.vars) });
      else {
        const values = step.values.map((value) => expandWord(value, scope.vars, where.home));
        for (const value of values.length > 0 ? values : [null]) {
          if (value === null) scope.vars.delete(step.name);
          else scope.vars.set(step.name, value);
          walk(step.body, scope);
        }
      }
    }
  };
  walk(steps ?? [], { cwd: where.cwd, old: null, vars: new Map() });
  return { reads, searched };
}

/**
 * A payload → every event it carries. ZERO OR MORE, and the plural is not hedging.
 *
 * One Bash call is genuinely several moments — the command about to run, each file an `rm` in it
 * would remove, and each file it reads — and the old engine ran two evaluations off that one hook
 * for exactly this reason.
 * A signature returning one event would push the second rail back into the shell, where it could
 * not be tested as a decision.
 *
 * An event flow was not asked for answers with an empty list, never with an invented moment.
 */
export function toEvent(hook: HookEvent, payload: HookPayload, world: EventWorld): AdapterEvent[] {
  switch (hook) {
    case "session-start":
      return [{ rail: "brief", moment: "session" }];

    case "pre-tool-use": {
      const tool = text(payload.tool_name);
      const input = payload.tool_input ?? {};
      if (!tool) return [];
      if (tool === "Bash") {
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
        // The line is parsed once here: the command rules read it, and so do the files it removes
        // and the files it reads.
        const steps = parseShellSteps(command);
        const commands = steps === null ? null : stepCommands(steps);
        const events: AdapterEvent[] = [{ rail: "guard", moment: "command", command, commands }];
        for (const target of deleteTargets(commands)) {
          // The file is still there at PreToolUse, so a content rule can ask what is about to be
          // lost ("this matched X — did you move the code first?"). One that is already gone yields
          // no event: there is nothing to judge, and an invented empty file would let a content
          // check pass on a fiction.
          const path = relativise(target, world.root);
          const content = world.read(path);
          if (content !== null) events.push({ rail: "guard", moment: "delete", file: { path, content } });
        }
        events.push({ rail: "brief", moment: "command", command });
        // THE FILES IT READS, as touches on this same answer — so an area's note arrives with the
        // command briefing, before the output does, rather than never (a Bash payload names no
        // path for the post-tool-use rail to steer on). The host's `cwd` is where the shell stands.
        const cwd = text(payload["cwd"]) || world.root;
        const { reads, searched } = bashReads(steps, { cwd, root: world.root, home: world.home });
        for (const path of new Set([...reads, ...searched])) events.push({ rail: "brief", moment: "touch", path });
        return events;
      }
      const file = wouldBeFile(tool, input, world);
      return file === null ? [] : [{ rail: "guard", moment: "write", file }];
    }

    case "post-tool-use":
    case "post-tool-use-failure": {
      // A FAILED CALL IS JUDGED LIKE ONE THAT SUCCEEDED: a command that errors half way through has
      // still written whatever it wrote before it failed, and that write is as real as any other.
      const changes = world.changes ?? [];
      const judged = preJudged(payload, world.root);
      const events: AdapterEvent[] = [];
      // THE DELTA, as the write and delete rails. Every guard event comes before every brief event,
      // as on the Bash arm above: a refusal carries no notes, and the shell stops judging notes once
      // something has refused. A change the PreToolUse rail already judged is not judged twice — it
      // passed there on the same content, or the call would never have run — but only AS WHAT it was
      // judged: an Edit's file that now holds content was judged as that write, and an `rm` target
      // that is now GONE was judged as that delete. An `rm` target the call wrote again
      // (`rm x && cat > x`) was never judged as a write, so it is judged as one here.
      //
      // A write carries whether the file was there BEFORE the call. The tree it is judged against is
      // the one from after, which holds every file the call created, so `ctx.fs` cannot say.
      for (const change of changes) {
        if (change.after !== null) {
          if (!judged.writes.includes(change.path))
            events.push({
              rail: "guard",
              moment: "write",
              file: { path: change.path, content: change.after, existed: change.before !== null },
              observed: true,
            });
        } else if (change.before !== null && !judged.deletes.includes(change.path))
          events.push({ rail: "guard", moment: "delete", file: { path: change.path, content: change.before }, observed: true });
      }
      // TOUCH IS THE FLOOR. The path the tool named, then every path the call changed: a file whose
      // read nothing detected still has its area note shown at the change — later than a read would
      // have shown it, but not skipped. The engine's marks keep each note to once per session.
      //
      // A pathless call with no changes is SILENCE, not a pathless touch event: the engine narrows a
      // breadcrumb by `on` only when the event names a path, so a touch carrying none would show
      // every area note at once.
      const named = touchedPath(payload, world.root);
      const touched = new Set([...(named === null ? [] : [named]), ...changes.map((change) => change.path)]);
      for (const path of touched) events.push({ rail: "brief", moment: "touch", path });
      return events;
    }

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
 * Is this SubagentStop an internal agent's — one the host runs for its own features (prompt
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

/** What a post-tool-use call was about, repo-relative: a path, or nothing this rail can steer on. */
export function touchedPath(payload: HookPayload, root: string): string | null {
  const input = payload.tool_input ?? {};
  const named = input["file_path"] ?? input["notebook_path"] ?? input["path"] ?? input["glob"];
  return named ? relativise(text(named), root) : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELTA — what a call changed in the tree, judged the same way however it was changed
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Before every tool call the shell records the working tree; after it, the shell compares. What
// comes back is a plain list of paths with their content either side, and everything that DECIDES
// about it is here: which rails it becomes (toEvent), which files are put back (`reversal`), and
// what the model is told (`toResult`). What the agent typed to make the change is never read, so a
// heredoc, `sed -i`, a script, a recipe and an MCP tool all reach the rules by the one route.

/**
 * One path a call changed. `before` is null for a file the call created, `after` for one it
 * removed; a path with both is a file it changed.
 */
export interface Change {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

/**
 * What the shell could see of one call — the changes, or why it could not see them.
 *
 * A FAULT IS NOT AN EMPTY DELTA, and the difference is the guard's whole doctrine: "I looked and
 * nothing changed" and "I could not look" must never be spelled the same way, or a snapshot that
 * failed would let every write through as clean.
 */
export type Delta = { readonly ok: true; readonly changes: readonly Change[] } | { readonly ok: false; readonly fault: string };

/**
 * Where git should look for the ignored paths `snapshotInclude` names: each glob's literal head,
 * so git walks `config/` for `config/*.local.json` and not the whole repo. A glob with no literal
 * head (`**` + `/.env`) has to be looked for everywhere.
 */
export function snapshotPathspecs(include: readonly string[]): string[] {
  const heads = include.map(staticPrefix);
  return heads.includes("") ? ["."] : [...new Set(heads)];
}

/** Of the ignored paths git listed under those heads, the ones a `snapshotInclude` glob matches. */
export function included(listed: readonly string[], include: readonly string[]): string[] {
  return listed.filter((path) => path !== "" && matchAny(path, include));
}

/**
 * Of the paths a call changed, the ones the AGENT changed. The rest are git's — a checkout, a reset
 * or a fast-forward put them there, from a commit the repo already had, and the commit gate judged
 * that content when it was committed — so they leave the diff before anything reads them: no rule,
 * no write-back, no breadcrumb, no shell-write row. CONTENT, never the command line: git run by a
 * recipe is caught the same way, and the `sed` in `git switch x && sed -i … f` is still judged.
 *
 * - A file on disk after the call is git's when it is identical to its copy in HEAD after the call.
 * - A file the call removed is git's when HEAD held it BEFORE the call and does not hold it after:
 *   git removed it by moving HEAD. A file no commit holds — an untracked file, an included `.env` —
 *   is the agent's to answer for when it goes.
 *
 * `nameStatus` is the call's own diff, `git diff-tree -r -z --name-status --no-renames`, in git's
 * order. `differsAfter` and `differsBefore` are every path where HEAD's tree after the call, and
 * before it, disagree with the tree after the call. `differsAfter` is null when HEAD after the call
 * is no commit the repo had before it — none yet, or one the call made, whose content no gate is
 * known to have judged — and then nothing is git's. `differsBefore` is null where there was no HEAD
 * before; for a path gone from disk, being in it is exactly "HEAD held it before".
 */
export function authored(nameStatus: string, differsAfter: readonly string[] | null, differsBefore: readonly string[] | null): string[] {
  const after = differsAfter === null ? null : new Set(differsAfter);
  const before = new Set(differsBefore ?? []);
  const fields = nameStatus.split("\0");
  const out: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? "";
    const path = fields[i + 1] ?? "";
    if (path === "") continue;
    const matchesHead = after !== null && !after.has(path);
    const gits = matchesHead && (!status.startsWith("D") || before.has(path));
    if (!gits) out.push(path);
  }
  return out;
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
  /** Every path the commit will hold that it changes — the subjects of a file rule. */
  readonly files: readonly string[];
  /** The `files` the last commit does not have. Undefined when git could not say. */
  readonly added: readonly string[] | undefined;
  /** The paths the last commit has and this one will not. */
  readonly deleted: readonly string[];
}

/** NUL-separated paths, as git prints them under `-z` — no quoting, so a path is a path. */
export function nulPaths(stdout: string): string[] {
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
 * The whole tree as one commit — `flow hook commit --all` — against the last commit's own list.
 *
 * `present` is every file git can see that is on disk; `tree` is `git ls-tree -r --name-only -z
 * HEAD`. It fails in two ways that answer differently. Before the first commit there is no HEAD, so
 * every file is new and nothing is removed. Any other failure is unknown: `added` stays undefined,
 * so a check asks the disk and refuses rather than allows.
 */
export function treeChanges(present: readonly string[], tree: ExecResult, hasHead: () => boolean): StagedChanges {
  if (tree.code !== 0) return { files: [...present], added: hasHead() ? undefined : [...present], deleted: [] };
  const committed = nulPaths(tree.stdout);
  const inTree = new Set(committed);
  const here = new Set(present);
  return {
    files: [...present],
    added: present.filter((path) => !inTree.has(path)),
    deleted: committed.filter((path) => !here.has(path)),
  };
}

/** The key one call's snapshot is filed under — the host's `tool_use_id` — or null when it sent none. */
export function callKey(payload: HookPayload): string | null {
  const id = text(payload.tool_use_id);
  return id === "" ? null : id;
}

/**
 * The paths the PreToolUse rail already judged for this call, repo-relative, BY RAIL.
 *
 * An Edit, a Write or a MultiEdit was judged as a write, on the file it would produce; an `rm` or
 * an `mv` source was judged as a delete, on the file it was about to remove. Both were allowed there
 * or the call would not have run, and judging them again after it would log every such decision
 * twice. The rail matters: a path judged only as a delete says nothing about content written to it
 * afterwards in the same call.
 */
export function preJudged(payload: HookPayload, root: string): { readonly writes: string[]; readonly deletes: string[] } {
  const tool = text(payload.tool_name);
  const input = payload.tool_input ?? {};
  if (tool === "Bash")
    return { writes: [], deletes: deleteTargets(parseCommandLine(text(input["command"]))).map((target) => relativise(target, root)) };
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
    const named = text(input["file_path"]);
    return { writes: named === "" ? [] : [relativise(named, root)], deletes: [] };
  }
  return { writes: [], deletes: [] };
}

// ── the call log: which calls overlapped this one ────────────────────────────────────────────────
//
// Within one agent the host runs one writing call at a time, so a diff there is that call's own. A
// parent and its subagents are not ordered against each other, and a second agent's write that
// lands between this call's snapshot and its diff shows up in this call's diff. flow cannot tell
// whose a changed file is — git records content, not writers — so what it can do is KNOW that
// calls overlapped, from its own log of snapshots, and narrow what a refusal undoes when they did.

/**
 * One tool call as flow's own log holds it: who made it, when its snapshot was taken, and when its
 * diff was, once it has been. A record with no `done` is a call still in flight.
 */
export interface CallRecord {
  /** The host's `tool_use_id`. */
  readonly key: string;
  readonly session: string;
  readonly agent: string;
  readonly tool: string;
  /** When the snapshot before the call was taken, in epoch milliseconds. */
  readonly at: number;
  /** When the diff after it was taken. Absent while the call is in flight. */
  readonly done?: number | undefined;
}

/** A call record read back off disk, or null when the file is not one. */
export function callRecord(key: string, raw: unknown): CallRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const held = raw as Record<string, unknown>;
  if (typeof held["at"] !== "number") return null;
  return {
    key,
    session: text(held["session"]),
    agent: text(held["agent"]),
    tool: text(held["tool"]),
    at: held["at"],
    ...(typeof held["done"] === "number" ? { done: held["done"] } : {}),
  };
}

/** The same actor: one session × agent, whose writing calls the host never runs side by side. */
function sameActor(a: CallRecord, b: CallRecord): boolean {
  return a.session === b.session && a.agent === b.agent;
}

/**
 * A snapshot whose diff never came, and never will: the host refused the call after flow allowed
 * it (a permission prompt said no), so it never ran. Read as in flight, it would narrow every
 * refusal in the worktree for a day. Its actor has moved on — a later call of the same session and
 * agent has already finished — so it is not waited on. A long read that is genuinely still running
 * beside its own agent's later calls is misread by this, and costs nothing: it writes nothing.
 */
function abandoned(call: CallRecord, log: readonly CallRecord[]): boolean {
  return call.done === undefined && log.some((other) => sameActor(other, call) && other.done !== undefined && other.at > call.at);
}

/**
 * Is this call's diff somebody else's work? A SPAWN — the Agent tool — writes nothing itself: the
 * subagent it started writes, through calls of its own that are in the log under their own agent.
 * Counted as a writer, one foreground builder would read as overlapping its own parent's spawn on
 * every call it made.
 */
function spawns(call: CallRecord): boolean {
  return isSpawn(call.tool);
}

/** The tools that start a subagent rather than doing work of their own. */
function isSpawn(tool: string): boolean {
  return tool === SPAWN_TOOL || tool === "Task";
}

/**
 * The calls of OTHER actors that overlapped this one in time: started before this diff, and
 * finished after this snapshot or not finished at all.
 *
 * A call that finished inside this one's window counts as well as one still in flight: its write
 * landed between this snapshot and this diff just the same. Calls of the same session and agent
 * never count — the host does not run an agent's writing calls side by side.
 */
export function overlapping(me: CallRecord, log: readonly CallRecord[]): CallRecord[] {
  return log.filter(
    (call) =>
      call.key !== me.key &&
      !sameActor(call, me) &&
      !spawns(call) &&
      !abandoned(call, log) &&
      (call.done === undefined || call.done > me.at),
  );
}

/**
 * The finished calls the log can forget: no call still in flight started before one finished, so no
 * diff still to come can overlap it. Keeping every record for a day would make every diff read a
 * day of records.
 */
export function forgettable(log: readonly CallRecord[]): string[] {
  const live = log.filter((call) => call.done === undefined && !abandoned(call, log)).map((call) => call.at);
  const oldest = live.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...live);
  return log.filter((call) => call.done !== undefined && call.done < oldest).map((call) => call.key);
}

/** How a call is named in a message: the tool, the host's id, and whose it was. */
export function callName(call: CallRecord): string {
  return `${call.tool || "a tool"} ${call.key} (${call.agent === "main" ? "main agent" : `agent ${call.agent}`} of session ${call.session.slice(0, 8)})`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESULTS — effects become an exit code, a line on stderr, or a decision object
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What the binary prints and exits with. The three IO edges as data, so a test can read them. */
export interface HookResult {
  /** stdout — a JSON decision the host reads. Empty means nothing to say. */
  readonly stdout: string;
  /** stderr — the refusal, shown to the model on exit 2 and to the human otherwise. */
  readonly stderr: string;
  /** 0 allows; 2 blocks. Never anything else — those are the host's two codes. */
  readonly exitCode: 0 | 2;
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
  write: { head: "flow — blocked before the write landed", tail: "Adjust the change so it passes, then retry." },
  delete: { head: "flow — blocked before the delete", tail: "Keep the file, or change the rule that protects it." },
  command: { head: "flow — command blocked before it ran", tail: "Adjust the command, then retry." },
  commit: { head: "flow — commit blocked", tail: "Fix the above, then commit again." },
  "turn-end": { head: "flow — turn held open", tail: "Do the above, then end your turn." },
};

/**
 * The banner a refusal carries when the change had ALREADY LANDED and has been put back.
 *
 * The moment stays `write` or `delete` — a rule is written once and fires on both routes — so what
 * tells the two routes apart is whether the refusal was pre-emptive or observed, and a reader of the
 * log can see which happened from the first line alone.
 */
const RAIL_OBSERVED: Readonly<Record<"write" | "delete", string>> = {
  write: "flow — write reverted after it landed",
  delete: "flow — delete reverted after it landed",
};

/** One refusal, with the rail that made it — the banner is the moment's, not the hook's. */
export interface Refused {
  readonly moment: GuardrailMoment;
  readonly block: Block;
  /** The path of a change that had already landed when this refused it — the one to put back. */
  readonly observed?: string | undefined;
}

/**
 * What putting refused changes back came to — written by the shell, which did the writing.
 *
 * `failed` is the loud half: a file flow could not write back still holds what the call wrote, and
 * the message must say so rather than claim a revert that did not happen.
 */
export interface Undone {
  /** The changes written back to what they were before the call. */
  readonly restored: readonly Change[];
  /** Paths the call changed that no rule refused — left as the call wrote them. */
  readonly kept: readonly string[];
  readonly failed: readonly { readonly path: string; readonly why: string }[];
  /** What the refusal was allowed to undo — what the message explains when it was not everything. */
  readonly scope?: RevertScope | undefined;
}

/** Which of a call's changes are put back, and which stay as the call left them. */
export interface Reversal {
  readonly revert: readonly Change[];
  readonly kept: readonly string[];
}

/**
 * What a refusal is allowed to undo, beside the refusals themselves: the repo's `revert` setting,
 * and the other calls that overlapped this one.
 *
 * A command started in the background gets nothing here, by ruling: what it writes after its call
 * returns lands in some later call's diff and is judged and put back there like anything else.
 * The harness runs no hook when the process ends, so any mark saying "not this call's" would have
 * to outlive the process by a guess — and a guess that let `sleep 1` buy one unreverted write.
 */
export interface RevertScope {
  /** The config's `revert` setting: the refused files alone, or every file the call changed. */
  readonly revert: "refused" | "all";
  /** Other actors' calls that overlapped this one. Any of them, and `"all"` is not honoured. */
  readonly overlap: readonly CallRecord[];
}

/** The default scope: the refused files, and no overlap. */
export const REFUSED_ONLY: RevertScope = { revert: "refused", overlap: [] };

/**
 * THE REVERT SCOPE: the files a rule refused, or every file the call changed when the repo asked
 * for that, and never more than the refused files while another actor's call overlapped this one
 * — a diff taken then can hold that call's writes, and "all" would put back work that was not this
 * call's to lose.
 *
 * Most writing calls touch one file, and the other files a multi-file command wrote are not wrong
 * because one of them is — they are listed as kept, so the agent knows they stand. A refusal that
 * names no landed path (a fault on a pre-emptive rail) reverts nothing: a revert is only ever of a
 * change flow saw land, never a guess.
 */
export function reversal(changes: readonly Change[], refusals: readonly Refused[], scope: RevertScope = REFUSED_ONLY): Reversal {
  const refused = new Set(refusals.flatMap((refusal) => (refusal.observed === undefined ? [] : [refusal.observed])));
  const whole = scope.revert === "all" && scope.overlap.length === 0 && refused.size > 0;
  const back = (change: Change): boolean => whole || refused.has(change.path);
  return {
    revert: changes.filter(back),
    kept: changes.filter((change) => !back(change)).map((change) => change.path),
  };
}

/** `a`, `a and b`, `a, b and c` — a list of paths as a sentence reads them. */
function listed(paths: readonly string[]): string {
  return paths.length <= 1 ? (paths[0] ?? "") : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1) ?? ""}`;
}

/**
 * What an observed refusal ends with: what was put back, what to do now, what stayed, and what a
 * revert cannot reach.
 *
 * The first line is the docs' own sentence pair (docs/user/explanation/what-the-guard-sees.md) for
 * the common case of one file changed and refused. Everything after it is conditional except the
 * last line: a revert writes file content back and nothing else, so a test run, a commit or a push
 * the same command made has already happened, and the agent is told so every time.
 */
function observedTail(refusals: readonly Refused[], undone: Undone): string {
  const failed = new Set(undone.failed.map((failure) => failure.path));
  const back = undone.restored.filter((change) => !failed.has(change.path));
  const changed = back.filter((change) => change.before !== null && change.after !== null).map((change) => change.path);
  const created = back.filter((change) => change.before === null).map((change) => change.path);
  const deleted = back.filter((change) => change.after === null).map((change) => change.path);
  const said = [
    changed.length === 0 ? "" : `${listed(changed)} ${changed.length === 1 ? "is back to its" : "are back to their"} previous content.`,
    created.length === 0 ? "" : `${listed(created)} ${created.length === 1 ? "is" : "are"} gone again — the call created ${created.length === 1 ? "it" : "them"}.`,
    deleted.length === 0 ? "" : `${listed(deleted)} ${deleted.length === 1 ? "is" : "are"} restored.`,
    refusals.some((refusal) => refusal.moment === "write")
      ? "Adjust the change so it passes and write it again — through Edit, which is judged before it lands."
      : "Keep the file, or change the rule that protects it.",
  ].filter((sentence) => sentence !== "");
  const lines = [said.join(" ")];
  for (const failure of undone.failed)
    lines.push(`flow could not put ${failure.path} back (${failure.why}) — it still holds what the call wrote.`);
  if (undone.kept.length > 0)
    lines.push(`Kept as the call wrote ${undone.kept.length === 1 ? "it" : "them"}: ${undone.kept.join(", ")}.`);
  const scope = undone.scope ?? REFUSED_ONLY;
  if (scope.overlap.length > 0)
    lines.push(
      `Other tool calls overlapped this one: ${callsListed(scope.overlap)}. Their writes can show up in this call's diff, so only the refused files were put back` +
        (scope.revert === "all" ? ` — revert: "all" is set, and is not applied while calls overlap.` : "."),
    );
  else if (scope.revert === "all")
    lines.push(`revert: "all" is set, so every file this call changed was put back, not only the refused ones.`);
  lines.push("Only file content was put back: anything else the call did has already happened.");
  return lines.join("\n");
}

/** How many overlapping calls a message names before it counts the rest. */
const CALLS_NAMED = 5;

/** The overlapping calls, named — the first few, then how many more. */
function callsListed(calls: readonly CallRecord[]): string {
  const named = calls.slice(0, CALLS_NAMED).map(callName);
  return calls.length > CALLS_NAMED ? `${named.join("; ")}; and ${calls.length - CALLS_NAMED} more` : named.join("; ");
}

/** A note with its prose resolved: a `file:` breadcrumb is read by the shell, never here. */
export interface Shown {
  readonly entry: string | null;
  readonly cause: Cause;
  readonly body: string;
}

/** Everything one payload produced, ready to become something the host understands. */
export interface Answer {
  readonly refused: readonly Refused[];
  readonly shown: readonly Shown[];
  /** What was put back, when a refusal was of changes that had already landed. */
  readonly undone?: Undone | undefined;
}

/**
 * What the agent is told beside the load error, on every answer it rides: what that error means.
 *
 * The load error says what broke; this says what flow is doing about it. Without it, a call that
 * went through reads like a guard that judged it and passed.
 */
export const FLOW_OFF = `flow is OFF until ${CONFIG_FILE} loads: every write, delete and command goes through unchecked, and every commit is refused.`;

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
 * write, delete or command about to run — one notice per answer, however many events the payload
 * carried. A touch never carries it, on either rail: a Read is not told, and a Bash call is told by
 * its command, not by the files it reads. So the after-call rail, whose events are observed changes
 * and touches, stays silent: the agent was told when the call was asked for, and saying it again
 * with the result is the same sentence twice.
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
 * Does this event's answer carry the load error? A session start, and a write, delete or command
 * not yet run. Not a touch, not a change the after-call rail observed, and not turn-end, on either
 * rail, which is told on stderr instead.
 */
function carriesTheNotice(event: AdapterEvent): boolean {
  if (event.rail === "brief") return event.moment !== "touch" && event.moment !== "turn-end";
  return event.moment !== "turn-end" && event.observed !== true;
}

export function whileBroken(events: readonly AdapterEvent[], message: string): Outage {
  const body = `${message}\n\n${FLOW_OFF}`;
  return {
    refused: [],
    shown: events.some(carriesTheNotice) ? [{ entry: null, cause: "fault", body }] : [],
    told: events.some((event) => event.rail === "guard" && event.moment === "turn-end") ? body : null,
  };
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

/**
 * The block of prose a set of notes is injected as.
 *
 * The header says `breadcrumb` because that is the mechanism's name everywhere else — in the
 * config, in the log, in `flow status`. The injected block was the last place the old system spoke
 * one word to the agent and printed another to the human, and a mechanism you hear one name for and
 * read another about is one you cannot look up.
 */
export function briefBlock(shown: readonly Shown[]): string {
  return shown
    .filter((note) => note.body.trim() !== "")
    .map((note) => `# breadcrumb: ${note.entry ?? "flow"} (${note.cause})\n${note.body}`)
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
 * exit 2, so stderr is the one place both are sure to arrive. Only a held turn has any: before a
 * call, the shell judges no notes once something refused (`ridesRefusal`).
 */
export function toResult(hook: HookEvent, answer: Answer): HookResult {
  const refusal = refused(answer.refused, answer.undone);
  const prose = briefBlock(answer.shown);
  if (refusal !== null)
    return prose === "" ? refusal : { ...refusal, stderr: `${refusal.stderr}\n${prose}\n` };
  if (prose === "") return ALLOW;
  return { stdout: decision(hook, prose), stderr: "", exitCode: 0 };
}

/**
 * Every refusal as the one thing a refusal is, or null when nothing refused.
 *
 * It takes NO hook, and that is the point of it existing beside `toResult`: the commit gate is not
 * a hook at all — git spawns it — so rendering its refusals through a hook-shaped function meant
 * naming an event that never happened. The banner comes off the MOMENT, which every rail has,
 * rather than off the event, which only the harness ones do.
 */
export function refused(refusals: readonly Refused[], undone?: Undone): HookResult | null {
  const first = refusals[0];
  if (first === undefined) return null;
  const body = refusals.map((refusal) => formatBlock(refusal.block)).join("\n\n");
  // AN OBSERVED REFUSAL arrives on the after-call rail, where exit 2 cannot block — the change has
  // landed — and the host shows stderr to the model beside the tool's result. So it carries its own
  // banner and says what was put back rather than asking for a retry of something already done.
  const landed = first.observed !== undefined && (first.moment === "write" || first.moment === "delete");
  const head = landed ? RAIL_OBSERVED[first.moment] : RAIL[first.moment].head;
  const tail = landed ? observedTail(refusals, undone ?? { restored: [], kept: [], failed: [] }) : RAIL[first.moment].tail;
  return { stdout: "", stderr: `\n${head}:\n\n${body}\n\n${tail}\n`, exitCode: 2 };
}

/**
 * What the after-call rail says when it could not see what the call changed.
 *
 * FAIL LOUD, NEVER FAIL CLEAN. A snapshot that could not be taken, or a diff that could not be
 * read, is not an empty delta: the call is not waved through as having changed nothing, and nothing
 * is put back on a guess. Exit 2 on this rail cannot block — the call has run — so it is a report,
 * and it goes where the model reads the tool's result.
 */
export function deltaFault(fault: string): HookResult {
  return {
    stdout: "",
    stderr:
      `\nflow — could not see what this call changed:\n\n${fault}\n\n` +
      "The call ran, and nothing it changed was checked or put back. Check what the call changed before you go on.\n",
    exitCode: 2,
  };
}

/** Hand the agent some context and allow — the one shape every steering rail emits. */
export function decision(hook: HookEvent, additionalContext: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: HOST_EVENT[hook], additionalContext } });
}

/** The rails that run once a tool call has landed: their exit 2 reports, it cannot block. */
export const AFTER_CALL: ReadonlySet<HookEvent> = new Set(["post-tool-use", "post-tool-use-failure"]);

/**
 * The answer a rail gives when it could not read its payload — and which rails must be LOUD.
 *
 * The three outcomes of a read are not one outcome. "There was nothing to guard" is safe and common
 * — a hand-run, an empty stdin — and silence is the right answer to it. "I could not SEE what I was
 * guarding" is the old engine's invisible swallow: both were folded into `{}`, so a PreToolUse rail
 * holding an unreadable payload found no tool call, allowed, and told nobody. So every rail says one
 * fault line, and it keeps READ apart from PARSE: a payload that never arrived and one that arrived
 * and was not JSON are different faults. The line names the hook and the cause, never "the guard",
 * because on an after-call rail the call has already run and must not read as refused (#12).
 *
 * The three rails that judge a tool call answer exit 2: PreToolUse, where it refuses the call it
 * could not see, and the two after-call rails, where every change the call made is judged — there
 * exit 2 blocks nothing (the call has run) and puts the line in front of the model beside the
 * result, so a call whose changes went unjudged is never passed as clean. The rest only add a
 * breadcrumb or end a turn, and say it on stderr with exit 0.
 *
 * PreToolUse and the annotating rails print the line bare; an after-call rail wraps it in
 * `deltaFault`, the one message for "flow could not see what this call changed", because the host
 * labels its exit 2 a "blocking error" and the bare line read as a refusal of a call that had
 * already landed (#12).
 */
export function readFault(hook: HookEvent, why: "unreadable" | "unparseable", detail: string): HookResult {
  const what =
    why === "unreadable" ? `could not READ its payload from stdin (${detail})` : `could not PARSE its payload (${detail})`;
  const text = `[flow hook ${hook}] ${what}.`;
  if (AFTER_CALL.has(hook)) return deltaFault(text);
  return hook === "pre-tool-use"
    ? { stdout: "", stderr: `\n${text}\n`, exitCode: 2 }
    : { stdout: "", stderr: `${text}\n`, exitCode: 0 };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT — the session log's dialect, and the three questions it answers
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A Claude Code transcript is JSONL, one record per line, and reading it is the deepest harness
// knowledge in the system. It lived in three places in the old engine — a token counter in a pure
// breadcrumb module, a tool-use parser inside a rule script that found its file through an
// environment variable, and an event parser in the report layer — which is exactly why "what does a
// transcript line mean" had three answers free to drift apart.
//
// ONE READER here, and three consumers on top of it: how far the session has drifted, what the
// actor did this turn, and the brief it was started with. F5's archival side extends the same
// reader for the narrative half (prompts, tool results, corrections); none of that shape is decided
// here.

/** One line of a transcript, parsed. `record` is the raw object — this file reads it, nobody else. */
export interface TranscriptLine {
  /** The record's `type`: `user`, `assistant`, or whatever else the host writes. */
  readonly kind: string;
  readonly record: Record<string, unknown>;
  /**
   * 1-based position in the FILE, counting blank and unreadable lines.
   *
   * Ground truth about the file rather than narrative, and the reason it is counted here rather
   * than by a consumer: the facts layer cites a transcript line back to a person, and a number
   * derived from a filtered list points at the wrong line the moment anything is skipped.
   */
  readonly line: number;
  /** ISO-8601 UTC, exactly as the host wrote it. Null when the line carries none. */
  readonly ts: string | null;
}

/**
 * ONE line of a transcript, or null when it is not one — THE reader, and the only place a
 * transcript's file format is decided.
 *
 * A transcript is appended to live by the very session doing the reading, so the last line can be
 * caught mid-write. One unreadable line is not the rest of the history's problem.
 */
function parseLine(raw: string, line = 0): TranscriptLine | null {
  const record = parseObject(raw);
  if (record === null) return null;
  const ts = text(record["timestamp"]);
  return { kind: text(record["type"]), record, line, ts: ts === "" ? null : ts };
}

/**
 * JSON that should be an object, or null — THE reader, and there is one because there is one rule.
 *
 * Two files answer to it: a transcript line and a sidecar. Both are read off disk, both can be
 * hand-edited, half-written or simply not what was expected, and "an array parses fine and is not a
 * record" is the sort of thing two copies of this would eventually disagree about.
 */
function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === "") return null;
  let held: unknown;
  try {
    held = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof held === "object" && held !== null && !Array.isArray(held) ? (held as Record<string, unknown>) : null;
}

/**
 * Every readable line of a transcript, in order.
 *
 * The two questions that can stop early do NOT come through here, and the reason is size: a real
 * transcript is a couple of megabytes and a hook fires on every tool call, so parsing twenty
 * thousand records to read one number is a cost paid on every keystroke. They walk the raw lines
 * from whichever end answers first, through the same `parseLine` — one rule about what a line is,
 * three ways of arriving at it.
 */
export function transcriptLines(jsonl: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const raws = jsonl.split("\n");
  for (let i = 0; i < raws.length; i++) {
    const line = parseLine(raws[i] as string, i + 1);
    if (line !== null) out.push(line);
  }
  return out;
}

/** The token counts one `usage` record carries. */
export interface Usage {
  readonly input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/**
 * The context size a `usage` record represents — input plus BOTH cache buckets.
 *
 * Verified on a real transcript, and the reason the sum is spelled out: `input_tokens` alone is
 * about nil, because the context lives in `cache_read_input_tokens`. A counter that summed the
 * obvious field read ~0 forever, which looks exactly like a session that never drifts.
 */
export function contextTokens(usage: Usage | undefined): number {
  return (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
}

/**
 * How far this session has drifted, in context tokens — the FOURTH question, and drift's one input.
 *
 * The LAST message carrying usage, because that is the current size; an earlier one describes a
 * context that no longer exists. Unreadable or absent is 0, which the engine reads as "no drift
 * yet": a note then shows on first touch and not again, which is the harmless direction.
 */
export function tokensFromTranscript(jsonl: string): number {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const message = parseLine(raw[i] as string)?.record["message"] as { usage?: Usage } | undefined;
    if (message?.usage) return contextTokens(message.usage);
  }
  return 0;
}

/**
 * The tools that CHANGE a file — which names count as an edit is harness knowledge, and this is the
 * one set.
 *
 * There were two in the old engine and they had already drifted: the recorder's knew about
 * `NotebookEdit` and the turn-end rule's did not, so a notebook edit was work for the log and not
 * work for the rule watching for work. A fact about the host's tool names belongs in one place.
 */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Text on a `user` line that the HUMAN did not type — the harness talking to itself.
 *
 * It matters because the turn boundary is "the last thing the human said", and a hook's own
 * injected context arrives wearing a user message's clothes. Reading one as a boundary would empty
 * the turn's actions exactly when a turn-end rule needs them.
 */
const INJECTED = [
  "<system-reminder>",
  "<command-name>",
  "<command-message>",
  "<local-command",
  "<user-prompt-submit-hook",
  "Caveat:",
  "Result of calling",
  "This session is being continued",
  "[Request interrupted",
  "DO NOT respond",
  "<budget:",
  "tool_use_id",
];

export function isInjected(prose: string): boolean {
  const start = prose.trimStart();
  // The `includes` tail is not slack: a reminder is sometimes prefixed by a line of the host's own
  // framing before the tag, and a turn boundary read off that line would empty the turn's actions
  // exactly when a turn-end rule needs them. The window is short enough that prose ABOUT a
  // system-reminder — which a session discussing this file writes constantly — is not caught.
  return INJECTED.some((mark) => start.startsWith(mark)) || start.slice(0, 40).includes("<system-reminder>");
}

/** A user line's prose, when it is one the human typed. Null for tool results and injections. */
function typedPrompt(line: TranscriptLine): string | null {
  if (line.kind !== "user" || line.record["isMeta"] === true) return null;
  const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") return null;
  return isInjected(content) ? null : content;
}

/**
 * What the actor did THIS TURN, in order — the fact a turn-end check is handed.
 *
 * The turn starts at the last thing the human typed. That is a real narrowing of the rule this
 * replaces, which walked the whole file: over one turn the two agree (the check compares the last
 * edit against the last run), but over a resumed session of forty turns the old one was answering
 * about work from hours ago while its message said "this turn".
 *
 * And what comes back is a NARROW, harness-neutral answer — an ordered list of edits and runs —
 * rather than the transcript itself. The rule this replaces read `$WORK_TURN_TRANSCRIPT` from the
 * environment, opened the file and parsed this JSONL inside the check: three reads of the world in
 * the one place the design forbids them, and it made that rule the only core rule no case could
 * drive.
 */
export function turnActions(jsonl: string, root = ""): TurnAction[] {
  const lines = transcriptLines(jsonl);
  let from = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (typedPrompt(lines[i] as TranscriptLine) !== null) {
      from = i;
      break;
    }
  }
  const out: TurnAction[] = [];
  for (const line of lines.slice(from)) {
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use") continue;
      const name = text(block.name);
      const input = block.input ?? {};
      const path = input["file_path"] ?? input["notebook_path"];
      if (EDIT_TOOLS.has(name) && path) out.push({ did: "edit", path: relativise(text(path), root) });
      else if (name === "Bash" && input["command"]) out.push({ did: "run", command: text(input["command"]) });
    }
  }
  return out;
}

/**
 * The brief a session was started with, verbatim — the first thing the human, or the spawning
 * agent, said.
 *
 * It is rung 2 of the settled classification order, and only rung 2: a brief is consulted for
 * generic spawn buckets and never for a specifically-typed one, because a brief QUOTES — four
 * verifier briefs in the 335-transcript probe matched builder patterns, since a verifier is briefed
 * with what the builder claimed to have done. That rule is enforced in the engine's `spawnedAs`;
 * what this owes is the text, honestly and whole, capped only so a runaway paste cannot become the
 * thing every classifier scans.
 */
export function briefHead(jsonl: string, cap = 8000): string {
  for (const raw of jsonl.split("\n")) {
    const line = parseLine(raw);
    const prose = line === null ? null : typedPrompt(line);
    if (prose !== null) return prose.slice(0, cap);
  }
  return "";
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
 * `transcript` is this agent's own transcript, a subagent's included, and its head is the brief.
 */
export function sessionFactsFrom(args: { readonly payload: HookPayload; readonly transcript: string | null }): SessionFacts {
  const spawned = typeof args.payload.agent_id === "string" && args.payload.agent_id !== "";
  // Read only beside an `agent_id`: the host also sends `agent_type` on a top-level session started
  // with `--agent`, and that session is still the parent.
  const type = args.payload.agent_type;
  const agentType = spawned && typeof type === "string" && type !== "" ? type : undefined;
  return {
    head: args.transcript === null ? "" : briefHead(args.transcript),
    subagent: spawned,
    ...(agentType === undefined ? {} : { agentType }),
  };
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
 * name, because "the session ran fifty greps here" is a fact about the area.
 */
export function toolRow(payload: HookPayload, root = ""): Row | null {
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
    if (input[key]) return { kind: "tool", tool, path: relativise(text(input[key]), root), edit: EDIT_TOOLS.has(tool), ...mode };
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
  const cwd = text(payload["cwd"]) || root;
  return bashReads(parseShellSteps(command), { cwd, root, home }).reads.map((path) => ({ kind: "read", tool: "Bash", path }));
}

/** How a path changed across one call. */
function changeOf(change: Change): "created" | "modified" | "deleted" {
  return change.before === null ? "created" : change.after === null ? "deleted" : "modified";
}

/**
 * The files one call changed that its own tool row does not already say, one `write` row each —
 * what a heredoc, a `sed -i`, a script or a recipe wrote, and what an Edit's call changed besides
 * the file it named.
 *
 * A SPAWN writes none of its own. The Agent call's diff holds everything its subagent wrote through
 * calls that are logged under their own rows, and counted again here every edit a builder made would
 * be in the record twice.
 */
export function writeRows(payload: HookPayload, changes: readonly Change[], root: string): Row[] {
  const tool = text(payload.tool_name);
  if (isSpawn(tool)) return [];
  const input = payload.tool_input ?? {};
  const named = EDIT_TOOLS.has(tool) ? relativise(text(input["file_path"] ?? input["notebook_path"]), root) : null;
  return changes
    .filter((change) => change.path !== named)
    .map((change) => ({ kind: "write", tool, path: change.path, change: changeOf(change) }));
}

/**
 * Claude Code's own list of the files a command changed, where the host sent one, set against
 * flow's diff — a `mismatch` row when they disagree, and nothing when they agree or the host said
 * nothing.
 *
 * A CROSS-CHECK, NEVER AN INPUT. The host's list (`bashEditDiff`, a public beta, on by default only
 * in some permission modes) decides nothing here: it is recorded so a reader of `flow facts` can see
 * where the two views of one call differ. A host path outside the repo is not a file flow could
 * have seen, so it is left out rather than reported; and when the host says its list was cut short
 * (`moreFiles`), a file only flow saw is not a disagreement anybody can claim.
 */
export function mismatchRow(payload: HookPayload, changes: readonly Change[], root: string): Row | null {
  const response = payload.tool_response;
  const diff = typeof response === "object" && response !== null ? (response as Record<string, unknown>)["bashEditDiff"] : undefined;
  if (typeof diff !== "object" || diff === null) return null;
  const listed = (diff as Record<string, unknown>)["changedFiles"];
  if (!Array.isArray(listed)) return null;
  const host = [...new Set(listed.map((path) => relativise(text(path), root)).filter(insideRepo))];
  const seen = changes.map((change) => change.path);
  const cut = Number((diff as Record<string, unknown>)["moreFiles"]) > 0;
  const hostOnly = host.filter((path) => !seen.includes(path));
  const flowOnly = cut ? [] : seen.filter((path) => !host.includes(path));
  if (hostOnly.length === 0 && flowOnly.length === 0) return null;
  return { kind: "mismatch", tool: text(payload.tool_name), hostOnly, flowOnly };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENVIRONMENT — what a spawned tool must not inherit
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The variables git exports into a hook's environment, which REDIRECT any nested `git` command back
 * at the parent repo — a `git init` in a temp directory would suddenly write the real index.
 *
 * The commit gate runs inside git's pre-commit hook and inherits every one of them, so a check that
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

/** The environment a check's command should see: this one, minus git's hook plumbing. */
export function hermeticEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const drop = new Set(GIT_HOOK_ENV);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STORE — where the harness keeps its transcripts, and what is in there
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The live rails are handed a transcript path in the payload. The ARCHIVAL side has no payload:
// it is asked about a repo, after the fact, and has to find the conversations itself. That is a
// second piece of harness knowledge and it belongs on this side of the seam with the first.
//
// Claude Code keeps one folder per working directory under `~/.claude/projects/`, holding one
// `<sessionId>.jsonl` per top-level session and, for each, a `<sessionId>/subagents/agent-*.jsonl`
// per child with an `agent-*.meta.json` beside it. Two readers of that layout existed in the old
// platform — the CLI's corpus reader and the guard's backlog reader — and they disagreed about the
// folder-name rule. Here the layout is read in two places: this section, where `classifyStore`
// sorts a listing by it after the fact and `ownTranscriptPath` finds a live subagent's transcript
// by it, and the store listing in archive.ts, which spells the `subagents` folder again to walk it.

/** The folder under a session that holds its subagents' transcripts. */
const SUBAGENTS = "subagents";

/**
 * The folder a working directory's transcripts live in.
 *
 * Every character that is not a letter or a digit becomes a dash — verified against all 63 folders
 * on this machine carrying a readable cwd, with zero mismatches, rather than taken from a summary.
 * A dot is not special: `/Users/x/.work/y` yields a doubled dash, and that doubling is the check
 * that this is the real rule rather than a hand-written approximation (the old signposts spelling
 * was `[/.]` and was wrong for an underscore or a space).
 *
 * THE RULE IS NOT INVERTIBLE, and that matters more here than anywhere else it is used: a folder
 * named `…-workbench-workflow-flow` is `workbench.workflow-flow` and `workbench/workflow/flow` and
 * `workbench_workflow_flow`, all three. Which worktree a transcript belongs to is answered by the
 * `cwd` field the host writes INSIDE the records — see `cwdOf` — never by reading the name back.
 */
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** One transcript file worth reading, and the sidecar beside it. */
export interface TranscriptRef {
  /** Relative to the project folder. */
  readonly path: string;
  /** The sidecar's path, only when the listing actually held it — never a probe. */
  readonly meta: string | null;
  readonly session: string;
  /** Null for a top-level session; the `agent-…` stem for a subagent. */
  readonly agent: string | null;
}

/**
 * A flat listing of a project folder, sorted into the transcripts worth reading.
 *
 * Two shapes count and nothing else does: `<session>.jsonl` at the top (a conversation somebody
 * sat in front of) and `<session>/subagents/<agent>.jsonl` (a child it spawned). A worktree holds
 * several sessions — a chat resumed on another day is a second file — so every one is enumerated
 * rather than a newest being picked.
 *
 * Anything else comes back as IGNORED rather than being silently skipped, because "the folder held
 * something I did not understand" is a fact a reader should be able to see. A `.meta.json` is the
 * one exception: it is read through the transcript it belongs to, so naming it would be noise.
 */
export function classifyStore(paths: readonly string[]): {
  transcripts: TranscriptRef[];
  ignored: string[];
} {
  const present = new Set(paths);
  const sessions: TranscriptRef[] = [];
  const subagents: TranscriptRef[] = [];
  const ignored: string[] = [];

  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length === 1 && path.endsWith(".jsonl")) {
      sessions.push({ path, meta: null, session: path.slice(0, -".jsonl".length), agent: null });
      continue;
    }
    if (parts.length === 3 && parts[1] === SUBAGENTS && path.endsWith(".jsonl")) {
      const meta = `${path.slice(0, -".jsonl".length)}.meta.json`;
      subagents.push({
        path,
        meta: present.has(meta) ? meta : null,
        session: parts[0] ?? "",
        agent: (parts[2] ?? "").slice(0, -".jsonl".length),
      });
      continue;
    }
    if (parts.length === 3 && parts[1] === SUBAGENTS && path.endsWith(".meta.json")) continue;
    ignored.push(path);
  }

  // Sessions first, then their children — a stable order, so the read is reproducible.
  return { transcripts: [...sessions, ...subagents], ignored };
}

/**
 * The path of THIS agent's own transcript, from a live payload — null when the payload names none.
 *
 * On a subagent's call the host sends the PARENT's `transcript_path`, and keeps the subagent's own
 * transcript under it, in the store's layout: `…/<session>.jsonl` →
 * `…/<session>/subagents/agent-<agent_id>.jsonl`. The parent's path is the parent's transcript.
 * Null too when a subagent's half is not what that layout needs — an id that could step out of the
 * folder included, since it becomes part of a path that is then read.
 */
export function ownTranscriptPath(payload: HookPayload): string | null {
  const sent = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (sent === "") return null;
  const id = payload.agent_id;
  if (typeof id !== "string" || id === "") return sent;
  if (!sent.endsWith(".jsonl") || !/^[\w-]+$/.test(id)) return null;
  return `${sent.slice(0, -".jsonl".length)}/${SUBAGENTS}/agent-${id}.jsonl`;
}

/**
 * The sidecar the host writes beside every subagent transcript, read.
 *
 * `toolUseId` is the field that makes this more than a label: it is the id of the parent's own
 * `Agent` tool call, so a sidecar and the block that spawned it join exactly. That join names an
 * actor for cost attribution, after the fact — the sidecar says what a spawn WAS, the parent's
 * block says when it happened and what it was asked for, and neither alone answers both. A live
 * session is not classified from it: that reads the agent type in its hook message.
 */
export interface SpawnMeta {
  readonly agentType: string | null;
  readonly description: string | null;
  /** The parent's tool_use id. Null on a sidecar written before the field existed. */
  readonly toolUseId: string | null;
  /** The model the spawn asked for — an alias like `opus`, never the served model id. */
  readonly model: string | null;
  readonly spawnDepth: number | null;
}

/** A sidecar's text → what it says. Null when it is absent or will not parse. */
export function spawnMeta(raw: string | null): SpawnMeta | null {
  const held = parseObject(raw);
  if (held === null) return null;
  const str = (key: string): string | null => (typeof held[key] === "string" && held[key] !== "" ? held[key] : null);
  return {
    agentType: str("agentType"),
    description: str("description"),
    toolUseId: str("toolUseId"),
    model: str("model"),
    spawnDepth: typeof held["spawnDepth"] === "number" ? held["spawnDepth"] : null,
  };
}

/** The three things knowable about a conversation without reading what was said in it. */
export interface TranscriptHead {
  /**
   * The working directory it was recorded in — THE ONLY HONEST ANSWER to "which worktree is this".
   *
   * `projectFolderName` collapses dots, slashes and underscores into one character, so two
   * worktrees of one repo — `workbench` and `workbench.workflow-flow` — share a folder name and a
   * reader that inverted it would attribute one checkout's conversations to the other.
   */
  readonly cwd: string | null;
  readonly branch: string | null;
  /** When it started, as the host stamped it. */
  readonly started: string | null;
}

/**
 * A conversation's opening facts, in ONE pass, stopping as soon as all three are known.
 *
 * It was three functions and therefore three parses of the same multi-megabyte file, once per
 * conversation in the store — a cost paid on every `flow facts` run for an answer that is in the
 * first few records. The file opens with stub records (last-prompt, mode, permission-mode) that
 * carry no fields at all, so a literal first line is never enough and the walk has to be able to
 * continue; what it must not do is start over twice.
 */
export function transcriptHead(jsonl: string): TranscriptHead {
  let cwd: string | null = null;
  let branch: string | null = null;
  let started: string | null = null;
  for (const line of transcriptLines(jsonl)) {
    cwd ??= text(line.record["cwd"]) || null;
    branch ??= text(line.record["gitBranch"]) || null;
    started ??= line.ts;
    if (cwd !== null && branch !== null && started !== null) break;
  }
  return { cwd, branch, started };
}

/** One spawn as the PARENT recorded it: the tool call, joined to the sidecar by its id. */
export interface Spawn {
  readonly toolUseId: string;
  /** What the parent asked for — its own claim, which the sidecar's `agentType` outranks. */
  readonly asked: string | null;
  readonly description: string | null;
  readonly ts: string | null;
  readonly line: number;
}

/** The subagent-spawning tool, by the name this harness gives it. */
const SPAWN_TOOL = "Agent";

/**
 * Every spawn a parent transcript made, by tool_use id — the parent's half of the join.
 *
 * It is the WEAKER half and is read as such: what the parent asked for is a claim by the session
 * being classified, while the sidecar is host-written and unforgeable, and so outranks it here.
 * Neither decides who a live session is: classification (engine, `spawnedAs`) reads the agent type
 * in the hook message. What this is for is everything the sidecar cannot say — when the spawn
 * happened, and where in the parent's own transcript to look.
 */
export function spawnsIn(jsonl: string): Map<string, Spawn> {
  const out = new Map<string, Spawn>();
  for (const line of transcriptLines(jsonl)) {
    if (line.kind !== "assistant") continue;
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; id?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use" || block.name !== SPAWN_TOOL) continue;
      const id = text(block.id);
      if (id === "") continue;
      const input = block.input ?? {};
      out.set(id, {
        toolUseId: id,
        asked: text(input["subagent_type"]) || null,
        description: text(input["description"]) || null,
        ts: line.ts,
        line: line.line,
      });
    }
  }
  return out;
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

/** One thing that happened in a conversation, with the line it happened on. */
export type TranscriptEvent =
  | { readonly line: number; readonly kind: "prompt"; readonly text: string }
  | { readonly line: number; readonly kind: "result"; readonly id: string; readonly content: string; readonly failed: boolean }
  | {
      readonly line: number;
      readonly kind: "use";
      readonly ts: string | null;
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
      /** The file the call names, repo-relative. Empty when it names none. */
      readonly path: string;
      /** The repo files a Bash call reads by name (`bashReads`), when it reads any. */
      readonly reads?: readonly string[];
    };

/**
 * A transcript → the narrative events in it: typed prompts, tool calls, and their results.
 *
 * The PAIRING is this function's own — a `tool_use` block carries the id its `tool_result` answers
 * to, and matching them is what turns a flat file into "the agent tried X and got back Y". The
 * old engine did this over its own `JSON.parse` and its own type switch, beside the corpus reader
 * doing the same over the same files, so "what is an assistant line" had two answers free to
 * drift. It reads through `transcriptLines` now, and owns only the pairing.
 */
export function parseEvents(jsonl: string, root = "", home?: string): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const line of transcriptLines(jsonl)) {
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;

    if (line.kind === "user") {
      const typed = typedPrompt(line);
      if (typed !== null) {
        out.push({ line: line.line, kind: "prompt", text: typed });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const raw of content) {
        const block = raw as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean } | null;
        if (!block || block.type !== "tool_result") continue;
        out.push({
          line: line.line,
          kind: "result",
          id: text(block.tool_use_id),
          content: resultText(block.content),
          failed: block.is_error === true,
        });
      }
      continue;
    }

    if (line.kind !== "assistant" || !Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; id?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use") continue;
      const input = block.input ?? {};
      const name = text(block.name);
      // A Bash call's reads need a repo to be relative to; with no root there is none to count in.
      const reads =
        name === "Bash" && root !== ""
          ? bashReads(parseShellSteps(text(input["command"])), { cwd: text(line.record["cwd"]) || root, root, home }).reads
          : [];
      out.push({
        line: line.line,
        kind: "use",
        ts: line.ts,
        id: text(block.id),
        name,
        input,
        path: relativise(text(input["file_path"] ?? input["notebook_path"]), root),
        ...(reads.length === 0 ? {} : { reads }),
      });
    }
  }
  return out;
}

/** A tool result's text, whichever of the three shapes the host wrote it in. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as { text?: string }[]).map((part) => part.text ?? "").join("\n");
  return content === undefined ? "" : JSON.stringify(content);
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
    /** Files changed round the edit tools — a heredoc, a `sed -i`, a script — from flow's own diff. */
    readonly shellWrites: number;
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
  /** The paths behind the two shell counts, with how often each. */
  readonly shell: { readonly writes: Readonly<Record<string, number>>; readonly reads: Readonly<Record<string, number>> };
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
 * `rows` is the conversation's own stream, when it has one, and it is where a SHELL WRITE comes
 * from: a transcript says what command ran, never what it changed, and only flow's diff knows that.
 * A conversation with no stream has no shell writes to count, which is why the count reads zero
 * there rather than a guess. Shell READS come from the transcript, like every Read does, so they are
 * counted in every conversation.
 */
export function narrative(events: readonly TranscriptEvent[], tools: readonly string[] = [], rows: readonly Row[] = []): Narrative {
  let edits = 0;
  let writes = 0;
  let shellReads = 0;
  const shell = { writes: {} as Record<string, number>, reads: {} as Record<string, number> };
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
    if (EDIT_TOOLS.has(event.name)) {
      if (event.name === "Write") writes += 1;
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
    if (event.name === "Read") {
      if (insideRepo(event.path)) touched[event.path] = (touched[event.path] ?? 0) + 1;
      continue;
    }
    if (event.name !== "Bash") continue;
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

  let shellWrites = 0;
  for (const row of rows) {
    const path = typeof row["path"] === "string" ? row["path"] : "";
    if (row.kind !== "write" || !insideRepo(path)) continue;
    shellWrites += 1;
    shell.writes[path] = (shell.writes[path] ?? 0) + 1;
    touched[path] = (touched[path] ?? 0) + 1;
  }

  return {
    stats: { edits, writes, shellWrites, shellReads, commits, recipes, bypasses },
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
  let shellWrites = 0;
  let shellReads = 0;
  let commits = 0;
  const shell = { writes: {} as Record<string, number>, reads: {} as Record<string, number> };
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
    shellWrites += read.stats.shellWrites;
    shellReads += read.stats.shellReads;
    commits += read.stats.commits;
    add(recipes, read.stats.recipes);
    add(bypasses, read.stats.bypasses);
    add(touched, read.touched);
    add(shell.writes, read.shell.writes);
    add(shell.reads, read.shell.reads);
  }
  return { stats: { edits, writes, shellWrites, shellReads, commits, recipes, bypasses }, ...out, shell, touched };
}

// ── weaken-after-block ─────────────────────────────────────────────────────

/**
 * The repo's own Claude Code settings file, relative to the repo root: guarded here, and where
 * `settingsFileFor` registers a dev dependency's hooks.
 */
const REPO_SETTINGS = ".claude/settings.json";

/**
 * The HOST's half of the guard: where the hooks that invoke any of it are registered.
 *
 * Fixed, because these are the harness's own file names and not a repo's choice — unlike the
 * repo's half, which `guardPaths` reads out of the config's imports.
 *
 * THE GUARD PACK KEEPS ITS OWN, WIDER LIST, and the difference is deliberate — this is the one
 * place that says so, because two lists that look like copies are read as drift until somebody
 * checks. Two things separate them:
 *
 *   · They answer different questions. This list feeds `weakenedAfterBlock`, which reports "a rail
 *     refused, and then somebody edited the guard" — so it holds only files that can WEAKEN a
 *     rule the engine enforces. The pack's `editingTheGuardrails` is a nudge before you type, and
 *     it adds `.claude/skills/**`: a skill is prose an agent reads, so editing one is worth a
 *     word of caution and is not evidence that a guardrail was loosened. Merged, every skill edit
 *     after any block would be reported as a possible weakening, and the report earns its keep
 *     only while every line in it is worth reading.
 *   · Neither may import the other, and the shared home would be worse than the duplication.
 *     `flow-packs → flow-adapter` is fenced (a pack must not be able to tell which harness is
 *     running it) and so is the way back, so a shared constant could only live in the public
 *     door — which would put one harness's file names into the GRAMMAR every config is written
 *     in, and that is the coupling the fence exists to prevent.
 */
export const HOST_SURFACE: readonly string[] = [REPO_SETTINGS, ".claude/settings.local.json", ".claude/agents/**"];

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
export function guardPaths(configText: string | null): readonly string[] {
  const paths: string[] = [CONFIG_FILE];
  for (const file of configImports(configText ?? "")) {
    if (!paths.includes(file)) paths.push(file);
    const dir = file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/**` : null;
    if (dir !== null && !paths.includes(dir)) paths.push(dir);
  }
  return [...paths, ...HOST_SURFACE];
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
    .filter((e) => (e.name === "Edit" || e.name === "Write") && e.ts !== null && isGuardPath(e.path, paths))
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
  /** The `agent-…` stem — its own transcript's name. */
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

// ── what the session ran under, and where the host's view of a call differed ──

/**
 * Whether Claude Code's auto mode is steering the session towards shell edits — `bashFirst` on the
 * host's auto-mode attachment, which tells the model to read with `cat` and change files with `sed`,
 * heredocs and scripts rather than Read, Edit and Write. `variant` is the host's own word for how hard
 * (`strict` · `relaxed`), when it gave one.
 */
export interface Steer {
  readonly shellFirst: boolean;
  readonly variant: string | null;
}

/**
 * The auto-mode steer a conversation is under, from the LAST auto-mode attachment in its transcript
 * — or null when it has none, or the last one is the host leaving auto mode.
 *
 * Read from the END, and only lines that name the attachment are parsed: a transcript is a couple
 * of megabytes and the answer is one record.
 */
export function steerOf(jsonl: string): Steer | null {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const line = raw[i] as string;
    if (!line.includes('"auto_mode')) continue;
    const attachment = parseLine(line)?.record["attachment"] as Record<string, unknown> | undefined;
    const type = attachment?.["type"];
    if (type === "auto_mode_exit") return null;
    if (type !== "auto_mode" || attachment === undefined) continue;
    const variant = attachment["bashFirstSteer"];
    return { shellFirst: attachment["bashFirst"] === true, variant: typeof variant === "string" && variant !== "" ? variant : null };
  }
  return null;
}

/**
 * The agent a session runs as (`--agent`, or the `agent` setting), from its own transcript — or
 * null when it runs as none.
 *
 * The host writes it as an `agent-setting` record, again as the session goes on. Read from the END,
 * and only lines that name the record are parsed, as `steerOf` does: the answer is one record.
 */
export function agentSettingOf(jsonl: string): string | null {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const line = raw[i] as string;
    if (!line.includes('"agent-setting"')) continue;
    const parsed = parseLine(line);
    if (parsed?.kind !== "agent-setting") continue;
    return text(parsed.record["agentSetting"]) || null;
  }
  return null;
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

/** Where Claude Code's changed-file list and flow's diff disagreed, over the read conversations. */
export interface Mismatches {
  readonly calls: number;
  /** Paths only the host listed, and how often. */
  readonly hostOnly: Readonly<Record<string, number>>;
  /** Paths only flow's diff held, and how often. */
  readonly flowOnly: Readonly<Record<string, number>>;
}

/** The `mismatch` rows, added up. */
export function mismatchesIn(rows: readonly Row[]): Mismatches {
  const hostOnly: Record<string, number> = {};
  const flowOnly: Record<string, number> = {};
  let calls = 0;
  const tally = (into: Record<string, number>, paths: unknown): void => {
    if (Array.isArray(paths)) for (const path of paths) if (typeof path === "string") into[path] = (into[path] ?? 0) + 1;
  };
  for (const row of rows) {
    if (row.kind !== "mismatch") continue;
    calls += 1;
    tally(hostOnly, row["hostOnly"]);
    tally(flowOnly, row["flowOnly"]);
  }
  return { calls, hostOnly, flowOnly };
}

export interface Facts {
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
  /** Where the host's changed-file list disagreed with flow's diff. */
  readonly mismatches: Mismatches;
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
    `  session   ${stats.edits} edits · ${stats.writes} writes · ${stats.shellWrites} shell writes · ` +
      `${stats.shellReads} shell reads · ${stats.commits} commits · ` +
      `${corrections.length} corrections · ${loops.length} edit loops · ${retries.length} retries · ` +
      `${bypassSites.length} bypasses`,
  );
  // THE PATHS BEHIND THE SHELL COUNTS, so a number that went round the edit tools can be followed.
  if (stats.shellWrites > 0) lines.push(`  shell     wrote ${pathList(shell.writes)}`);
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
  const { mismatches } = facts;
  if (mismatches.calls > 0)
    lines.push(
      `  ⚠ Claude Code's changed-file list disagreed with flow's diff on ${mismatches.calls} call${mismatches.calls === 1 ? "" : "s"}` +
        (Object.keys(mismatches.hostOnly).length === 0 ? "" : ` — only Claude Code listed ${pathList(mismatches.hostOnly)}`) +
        (Object.keys(mismatches.flowOnly).length === 0 ? "" : ` — only flow's diff held ${pathList(mismatches.flowOnly)}`),
    );
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
// adapter because both are about the host: init writes Claude Code's own hook registrations and
// git's own pre-commit hook, and status reports whether those wirings are there. Neither could sit
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

// ── what the host is told to call ────────────────────────────────────────────

/** One entry in a settings file's hook array: the command, and what it fires on. */
export interface Registration {
  /** The host's own name for the event — `SessionStart`, `PreToolUse`, … */
  readonly event: string;
  readonly command: string;
  /** The host's `matcher`. Absent means every occurrence of the event. */
  readonly matcher?: string;
}

/**
 * WHAT `flow init` WRITES, verbatim — and it follows DELIVERS, not HOOK_EVENTS.
 *
 * flow answers seven events and registers six. `Notification` is the one difference and it is
 * deliberate (ruled at F4): flow has no notification moment, so a registration there would spawn a
 * process on every banner to answer nothing — cost with no function, and a line contradicting the
 * honest moment list this file publishes. The day a notification moment earns its way into the grammar, the
 * registration arrives with it.
 *
 * ONE PER EVENT. Two registrations on one event fire twice, and when they point at different
 * checkouts they can disagree — so a second concern extends the command it shares an event with
 * rather than standing beside it.
 *
 * The matchers are the host's, each the widest set its command can act on. PreToolUse takes `*`
 * because the flight recorder's whole claim is that the log holds every call, including the ones no
 * rule watches — they are the denominator of every coverage question — and because every call is
 * snapshotted before it runs. PostToolUse and PostToolUseFailure take `*` for the other half of
 * that: any tool can change the tree (an MCP tool, a recipe, a subagent's shell), and the after-call
 * diff is how that change reaches the write and delete rules. A failed call is registered too,
 * because a command that errors half way has still written what it wrote.
 *
 * DERIVED, not re-typed: the host's name for an event and the word this binary answers to are both
 * read off `HOST_EVENT`, the one place that mapping is stated. Written out by hand, this list would
 * be a second spelling of it — and the day an event is renamed, the half that still compiled would
 * register a command nothing answers.
 */
const REGISTERED: readonly { readonly hook: HookEvent; readonly matcher?: string; readonly unregistered: string }[] = [
  { hook: "session-start", matcher: "startup|resume|clear|compact", unregistered: "no note is shown when a session starts" },
  { hook: "pre-tool-use", matcher: "*", unregistered: "no rule judges a tool call before it runs" },
  { hook: "post-tool-use", matcher: "*", unregistered: "no rule judges what a tool call changed" },
  { hook: "post-tool-use-failure", matcher: "*", unregistered: "no rule judges what a failed tool call changed" },
  { hook: "stop", unregistered: "no turn-end rule runs when the main chat hands back" },
  { hook: "subagent-stop", unregistered: "no turn-end rule runs when a subagent hands back" },
];

/**
 * What goes unjudged while one registration is missing, by the host's name for its event — what
 * `flow status` says beside the fix. Each event costs its own rails and no others, so a file
 * missing one names that one's cost, not the whole guard's.
 */
const UNREGISTERED: ReadonlyMap<string, string> = new Map(REGISTERED.map(({ hook, unregistered }) => [HOST_EVENT[hook], unregistered]));

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
 * `root` is how the shell names the repo: `$CLAUDE_PROJECT_DIR` for a hook, `$PWD` for git's.
 */
function repoFirst(root: string, verb: string): string {
  return `f="${root}/${PACKAGE_BIN}"; [ -f "$f" ] && exec node "$f" ${verb}`;
}

/**
 * The command each registration runs: the repo's own `@jawache/flow` first, then the PATH's.
 *
 * The host runs it through a shell with `$CLAUDE_PROJECT_DIR` set to the repo, so a repo with flow
 * only as a dev dependency answers its hooks, and its lockfile's version wins over a global one. It
 * runs the package's own file, by path, never a `flow` in node_modules/.bin, which any package can
 * put there. The same command goes in either settings file, so the host, which merges identical
 * commands, runs it once when it is in both.
 */
export function hookCommand(hook: HookEvent): string {
  return `${repoFirst("$CLAUDE_PROJECT_DIR", `hook ${hook}`)}; exec flow hook ${hook}`;
}

export const HOOK_REGISTRATIONS: readonly Registration[] = REGISTERED.map(({ hook, matcher }) => ({
  event: HOST_EVENT[hook],
  command: hookCommand(hook),
  ...(matcher === undefined ? {} : { matcher }),
}));

/**
 * WHICH SETTINGS FILE holds flow's hooks: the repo's own `.claude/settings.json` when the repo's
 * `package.json` lists `@jawache/flow` as a dependency or a dev dependency, and the machine-wide
 * file otherwise.
 *
 * A dev dependency guards that one repo: the repo's file is committed, so a fresh clone is guarded
 * after `npm install`, and a machine with no global flow is not handed a hook that fails in every
 * other repo it opens. A `package.json` that is missing, or will not parse, lists nothing.
 */
export function settingsFileFor(manifest: string | null, machine: string): string {
  return listsFlow(manifest) ? REPO_SETTINGS : machine;
}

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

/**
 * Is this registration OURS?
 *
 * The rule that says "this is ours" is the rule that would say "this may be removed", so it is
 * narrow on purpose: the flow binary — by either name it legitimately goes by, with any path in
 * front — invoking `hook <event>` for an event this build actually answers. A `work hook stop` from
 * the engine flow replaces is NOT ours; sweeping those is the crossing's job, with that engine's own
 * recogniser.
 */
export function ourHookCommand(command: string): boolean {
  const match = /(^|[\s"'/\\])(?:flow|flow\.mjs)["']?\s+hook\s+([a-z-]+)\s*$/.exec(command.trim());
  return match?.[2] !== undefined && isHookEvent(match[2]);
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
export function registeredEvents(settings: unknown): string[] {
  const out: string[] = [];
  for (const [event, entries] of Object.entries(hookArrays(settings))) if (entries.some(isOurs)) out.push(event);
  return out;
}

/**
 * The events flow IS registered for, but with a matcher narrower than this build asks for.
 *
 * An older flow registered PostToolUse for six tools, because an after-call hook could only show a
 * breadcrumb then. Now it is where every change a tool makes is judged, so a registration on six
 * tools leaves a shell edit through any other tool unjudged — and it LOOKS registered. It is its own
 * red line for that reason, rather than disappearing inside "registered".
 */
export function staleRegistrations(settings: unknown): string[] {
  const arrays = hookArrays(settings);
  return HOOK_REGISTRATIONS.filter((registration) =>
    (arrays[registration.event] ?? []).some(
      (entry) => isOurs(entry) && (entry as { matcher?: unknown }).matcher !== registration.matcher,
    ),
  ).map((registration) => registration.event);
}

/**
 * flow's own registration in the OLD shape, the bare `flow hook <event>`: the word it answers to, or
 * null when the command is anything else. It finds flow on the PATH alone, so a repo with flow only
 * as a dev dependency answers none of its hooks. A command with a path to the binary is not this
 * shape: it names the copy it runs, and that is somebody's choice.
 */
export function bareHook(command: string): HookEvent | null {
  const word = /^flow\s+hook\s+([a-z-]+)$/.exec(command.trim())?.[1];
  return word !== undefined && isHookEvent(word) ? word : null;
}

/** The events this settings file calls flow for in the old shape — see `bareHook`. */
export function bareRegistrations(settings: unknown): string[] {
  return Object.entries(hookArrays(settings))
    .filter(([, entries]) => entries.some((entry) => commandsOf(entry).some((command) => bareHook(command) !== null)))
    .map(([event]) => event);
}

/**
 * The settings file's hooks, with flow's own entries on those events rewritten in place: a stale
 * matcher widened, and an old-shape command (`bareHook`) made today's. FLOW'S OWN ENTRIES ARE
 * FLOW'S TO REWRITE, and these are the only two rewrites flow makes. Adding a second entry beside
 * either instead would fire flow twice for every event the old one already answers.
 */
function rewrittenOurs(settings: unknown, stale: ReadonlySet<string>, bare: ReadonlySet<string>): Record<string, unknown> {
  const held = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const arrays = hookArrays(settings);
  const hooks: Record<string, unknown> = { ...(held["hooks"] as Record<string, unknown> | undefined) };
  const matcherOf = new Map(HOOK_REGISTRATIONS.map((r) => [r.event, r.matcher]));
  for (const event of new Set([...stale, ...bare]))
    hooks[event] = (arrays[event] ?? []).map((entry) => {
      if (!isOurs(entry)) return entry;
      const ours = entry as Record<string, unknown> & { hooks: unknown[] };
      return {
        ...ours,
        ...(stale.has(event) ? { matcher: matcherOf.get(event) } : {}),
        hooks: ours.hooks.map((inner) => {
          const command = commandOf(inner);
          const word = command === null ? null : bareHook(command);
          return word === null ? inner : { ...(inner as Record<string, unknown>), command: hookCommand(word) };
        }),
      };
    });
  return hooks;
}

/**
 * THE MACHINE-WIDE FILE, when a dev dependency's hooks are in the repo's own: flow's old-shape
 * commands there (`bareHook`) rewritten to today's, and nothing else touched — no registration
 * added, no matcher widened, no other key or hook changed. A NEW object; `rewritten` names the
 * events, empty when there was nothing to do.
 *
 * The host merges only IDENTICAL commands across its settings files. An old `flow hook stop` in the
 * machine-wide file beside today's command in the repo's would run flow twice for every event, so
 * every rule would fire twice and every refusal print twice. Made the same command, it runs once.
 */
export function withMachineCommandsUpToDate(settings: unknown): { settings: unknown; rewritten: string[] } {
  const bare = new Set(bareRegistrations(settings));
  if (bare.size === 0) return { settings, rewritten: [] };
  const held = settings as Record<string, unknown>;
  return { settings: { ...held, hooks: rewrittenOurs(settings, new Set(), bare) }, rewritten: [...bare] };
}

/**
 * The events the machine-wide file calls flow for with a command the repo's own file does not use
 * for that event. The host runs both, so each of those hooks fires twice. Split by the fix: `bare`
 * holds only old-shape commands, which `flow init` rewrites; `theirs` holds a command of somebody's
 * own (`FLOW_DEBUG=1 flow hook stop`), which init leaves as it is.
 */
function machineDiffers(repo: unknown, machine: unknown): { bare: string[]; theirs: string[] } {
  const repoArrays = hookArrays(repo);
  const out = { bare: [] as string[], theirs: [] as string[] };
  for (const [event, entries] of Object.entries(hookArrays(machine))) {
    const repoCommands = new Set((repoArrays[event] ?? []).flatMap(commandsOf));
    const differ = entries.flatMap(commandsOf).filter((command) => ourHookCommand(command) && !repoCommands.has(command));
    if (differ.length === 0) continue;
    (differ.every((command) => bareHook(command) !== null) ? out.bare : out.theirs).push(event);
  }
  return out;
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
export function withRegistrations(settings: unknown): { settings: unknown; added: string[] } {
  const base = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const already = new Set(registeredEvents(settings));
  const wanted = HOOK_REGISTRATIONS.filter((r) => !already.has(r.event));
  const stale = new Set(staleRegistrations(settings));
  const bare = new Set(bareRegistrations(settings));
  if (wanted.length === 0 && stale.size === 0 && bare.size === 0) return { settings: base, added: [] };

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
  // THE REPORT, in registration order: each event added, widened or rewritten, once, with why.
  const added: string[] = [];
  for (const event of new Set([...HOOK_REGISTRATIONS.map((r) => r.event), ...bare])) {
    const why = [
      ...(stale.has(event) ? ["widened to every tool"] : []),
      ...(bare.has(event) ? [`now runs the flow in ${PACKAGE_DIR} first`] : []),
    ];
    if (why.length > 0) added.push(`${event} (${why.join(", ")})`);
    else if (!already.has(event)) added.push(event);
  }
  return { settings: { ...base, hooks }, added };
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
export const GATE_PATH = `${HOOKS_DIR}/pre-commit`;

/** What arms git, said the way a person types it — the report's line and the fitting's fix. */
export const SET_HOOKS_PATH = `git config core.hooksPath ${HOOKS_DIR}`;

/**
 * The gate's line that runs the repo's own `@jawache/flow` first: git runs the hook from the repo's
 * root, so `$PWD` is the repo. Written by `init`, looked for by `status`, and named in its fixes.
 */
export const GATE_LOCAL_LINE = repoFirst("$PWD", "hook commit");

/** The gate's line that runs flow, last, so its exit code is the hook's. */
export const GATE_RUN_LINE = "exec flow hook commit";

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
 * The pre-commit hook, verbatim.
 *
 * `flow hook commit` — git's hook under the same verb as the harness's hooks. It passes nothing:
 * flow asks git what the commit adds, changes and deletes, so there is one source of the staged set
 * whoever calls the gate, and nothing in this file to filter it or to skip flow when it is empty.
 */
export const PRE_COMMIT = `#!/bin/sh
# The flow commit gate. Written by \`flow init\`; \`${SET_HOOKS_PATH}\` arms it.
#
# Every at(commit) guardrail runs over the staged changes and a block exits non-zero, which is how
# git refuses the commit. This is the half of the promise the PreToolUse rail cannot make: it fires
# for a human's commit, a merge and CI, with no session in the room. flow asks git itself what the
# commit adds, changes and deletes.
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

/** Does this pre-commit hook call flow's gate? Asked by `init` before writing, and by `status` after. */
export function armsFlow(text: string | null): boolean {
  return text !== null && /(^|[\s"'/\\])flow\s+hook\s+commit\b/m.test(hookCommands(text));
}

/** Does it call the gate's OLD verb, `flow commit` — a gate that runs, and misses deletions? */
export function armsOldFlow(text: string | null): boolean {
  return text !== null && /(^|[\s"'/\\])flow\s+commit\b/m.test(hookCommands(text));
}

/** What the gate judges: the staged changes, or the whole tree as if all of it were staged. */
export type CommitScope = "staged" | "all";

/**
 * `flow hook commit [--all]`, read. Null is a refusal: a file list here would be a second source of
 * the staged set. `legacy` is the old `flow commit <files…>`, whose list an older hook still passes,
 * and it is dropped rather than refused so that hook keeps running the gate.
 */
export function commitScope(args: readonly string[], legacy: boolean): CommitScope | null {
  if (legacy || args.length === 0) return "staged";
  return args.length === 1 && args[0] === "--all" ? "all" : null;
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
    .check(banCommands({ ban: ["git\\s+push\\b[^\\n]*(--force|(^|\\s)-f(\\s|$))"] }))
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),

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

/** What the shell found before anything was written. Every one is a stat, not a judgement. */
export interface InitFacts {
  readonly root: string;
  /** `--empty`: the wiring, with no demo. */
  readonly empty: boolean;
  readonly isGit: boolean;
  readonly hasConfig: boolean;
  /** The gate as it stands, or null when there is none. */
  readonly gateText: string | null;
  readonly hasFlowDir: boolean;
  /** `git config core.hooksPath` as it stands. */
  readonly hooksPath: string | null;
  /** The settings file flow's hooks go in: the repo's own, repo-relative, or the machine-wide one. */
  readonly settingsPath: string;
  /** That file, parsed. */
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
   * The machine-wide settings file, read, when flow's hooks go in the repo's own file — a dev
   * dependency's — and null when they go in the machine-wide file itself.
   */
  readonly machine: { readonly path: string; readonly settings: unknown; readonly unreadable: boolean } | null;
  /** Does `@jawache/flow` already resolve from this repo? */
  readonly resolves: boolean;
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
  /** A pre-commit hook that is somebody else's. Never overwritten — reported, with the line to add. */
  readonly gateKept: boolean;
  /** …and it is flow's own, from before `flow hook commit` — reported with the line to replace. */
  readonly gateOld: boolean;
  readonly notGit: boolean;
  readonly flowDir: boolean;
  /** The package to link into `node_modules/@jawache/flow`, or null when flow already resolves. */
  readonly link: string | null;
  readonly hooksPath: boolean;
  /** The rewritten settings, or null when they already call flow — or could not be read. */
  readonly settings: { readonly path: string; readonly value: unknown } | null;
  readonly registered: readonly string[];
  /**
   * The machine-wide file with flow's old commands brought up to date, for a dev dependency whose
   * hooks are in the repo's own file — or null when it has none, or could not be read.
   */
  readonly machine: { readonly path: string; readonly value: unknown; readonly rewritten: readonly string[] } | null;
  /** The settings file was there and would not parse, so nothing was registered. Said out loud. */
  readonly settingsUnreadable: string | null;
}

/**
 * The machine-wide file's write, with its path: null when there is no such file to bring in line,
 * nothing in it to rewrite, or it would not parse — the same rule as the hooks' own file: bytes
 * nobody parsed are not written.
 */
function machineRewrite(file: InitFacts["machine"]): InitPlan["machine"] {
  if (file === null || file.unreadable) return null;
  const { settings, rewritten } = withMachineCommandsUpToDate(file.settings);
  return rewritten.length === 0 ? null : { path: file.path, value: settings, rewritten };
}

/** What init will do to this repo. Pure: every branch reads a fact the shell already gathered. */
export function planInit(facts: InitFacts): InitPlan {
  // A file we could not read is a file we may not write. `withRegistrations` builds a NEW object
  // from whatever it is handed, so handing it the null an unparseable file produces would emit a
  // settings file holding flow's six registrations and NOTHING ELSE — permissions, model, theme,
  // every other tool's hooks, gone. There is no safe merge into bytes nobody parsed, so init
  // registers nothing and says which file to fix.
  const registration = facts.settingsUnreadable ? { settings: facts.settings, added: [] } : withRegistrations(facts.settings);
  return {
    config: facts.hasConfig ? null : { path: CONFIG_FILE, body: scaffold(facts.empty) },
    // NEVER over a hook that is already there. This is a scaffold, and a repo whose gate runs its
    // own suite must not lose it to a re-run — which is also what makes init safe to run again.
    gate: !facts.isGit || facts.gateText !== null ? null : { path: GATE_PATH, body: PRE_COMMIT, mode: 0o755 },
    gateKept: facts.isGit && facts.gateText !== null && !armsFlow(facts.gateText),
    gateOld: facts.isGit && !armsFlow(facts.gateText) && armsOldFlow(facts.gateText),
    notGit: !facts.isGit,
    flowDir: !facts.hasFlowDir,
    link: facts.resolves ? null : facts.packageRoot,
    // Per CLONE, not per repo: `core.hooksPath` is not committed, so a fresh clone and every
    // worktree needs it set again. That is why init is the command a new checkout runs.
    hooksPath: facts.isGit && facts.hooksPath !== HOOKS_DIR,
    settings: registration.added.length === 0 ? null : { path: facts.settingsPath, value: registration.settings },
    registered: registration.added,
    machine: machineRewrite(facts.machine),
    settingsUnreadable: facts.settingsUnreadable ? facts.settingsPath : null,
  };
}

/**
 * The report — every write named, and everything NOT done said out loud with what to do instead.
 *
 * A setup command that prints "done" is a command nobody can check. Failures are handed in rather
 * than thrown because a PARTIAL init is the interesting case: the config landed, the settings file
 * was read-only, and the person needs to know exactly that.
 */
export function initLines(plan: InitPlan, failures: readonly string[]): string[] {
  const wrote: string[] = [];
  if (plan.config) wrote.push(plan.config.path);
  if (plan.gate) wrote.push(plan.gate.path);
  if (plan.flowDir) wrote.push(`${FLOW_DIR}/ — flow's own state, self-ignoring, never committed`);
  // WHY it linked, not what linking is for. The parenthetical used to read "npm link is flow's
  // distribution until it is published", which stopped being true at 0.1.0 and left the reader
  // with a line about the project's release state where the reason for a file in their repo
  // belongs. `npm i -D @jawache/flow` and this line is simply absent.
  if (plan.link) wrote.push(`node_modules/@jawache/flow → ${plan.link} (a link to the flow that is running — nothing here resolved @jawache/flow)`);
  if (plan.settings) wrote.push(`${plan.settings.path} — ${plan.registered.join(" · ")}`);
  if (plan.machine)
    wrote.push(
      `${plan.machine.path} — ${plan.machine.rewritten.join(" · ")} (an older flow's command, now the same as ${REPO_SETTINGS}'s, so each hook runs once)`,
    );
  if (plan.hooksPath) wrote.push(SET_HOOKS_PATH);

  const lines: string[] =
    wrote.length === 0
      ? ["flow init — already set up here; nothing to do."]
      : ["flow init — created:", ...wrote.map((what) => `  + ${what}`)];

  if (plan.notGit) lines.push("  · not a git repo, so no commit gate was armed. Run `git init`, then `flow init` again.");
  if (plan.gateKept)
    lines.push(
      `  · kept the ${GATE_PATH} already here — flow never overwrites one, so ${plan.gateOld ? UPDATE_THE_GATE_LINE : ADD_THE_GATE_LINE} yourself.`,
    );
  if (plan.settingsUnreadable !== null)
    lines.push(
      `  ✗ ${plan.settingsUnreadable} is not valid JSON, so nothing was registered and NOTHING was written to it — ` +
        `every other key in that file is somebody's, and there is no safe merge into bytes nobody could parse. ` +
        `Fix the JSON (a trailing comma, or a // comment) and run \`flow init\` again. Until then no rail fires.`,
    );
  for (const failure of failures) lines.push(`  ✗ ${failure}`);
  lines.push("  next: `flow status` — what is bound, and what is not wired yet.");
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
}

/** Everything status was able to read. Gathering it is the shell's job; judging it is not. */
export interface StatusFacts {
  readonly root: string;
  readonly version: string;
  readonly off: boolean;
  readonly configPath: string;
  readonly hasConfig: boolean;
  /** The load, or null when there is no config to load. */
  readonly load: LoadResult | null;
  readonly gateText: string | null;
  readonly hooksPath: string | null;
  readonly settingsPath: string;
  readonly settings: unknown;
  /**
   * The machine-wide settings file, parsed, when flow's hooks are in the repo's own file — a dev
   * dependency's — and null when `settingsPath` is the machine-wide file itself.
   */
  readonly machine: { readonly path: string; readonly settings: unknown } | null;
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
   * Who last worked in this worktree, from the marker the write rail leaves. Null when nobody has.
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
   * What git ignores here, one path per entry, a directory with its trailing `/` — plus any literal
   * path a write or delete rule names that git would ignore though it does not exist yet (`.env`).
   */
  readonly ignored: readonly string[];
  /** The config's `snapshotInclude` globs: the ignored paths the snapshot records anyway. */
  readonly snapshotInclude: readonly string[];
  /**
   * Where the flow the hooks and the gate run is, as three stats. `listed`: the repo's
   * `package.json` lists `@jawache/flow`. `copy`: its package's binary, `PACKAGE_BIN`, is there —
   * a dev dependency's, or the link `flow init` made to the flow that ran it. `path`: a `flow` on
   * the PATH this command was run with, less what npm added for this run (`hostPath`) — the nearest
   * reading there is of the PATH git and the host hand their hooks. `binaryFitting` judges them.
   */
  readonly binary: { readonly listed: boolean; readonly copy: boolean; readonly path: boolean };
}

/**
 * The literal head of a glob, cut back to a whole segment: `src/gen/**` → `src/gen/`, `.env` →
 * `.env`, `**` + `/*.ts` → nothing. A glob with no wildcard is all head.
 */
export function staticPrefix(glob: string): string {
  const at = glob.search(/[*?{]/);
  return at === -1 ? glob : glob.slice(0, glob.lastIndexOf("/", at) + 1);
}

/** Does this glob reach everything below `dir/` — a literal head at or above it, then `**`? */
function reachesBelow(glob: string, dir: string): boolean {
  const head = staticPrefix(glob);
  return head !== "" && head !== glob && dir.startsWith(head) && glob.slice(head.length).startsWith("**");
}

/** The write and delete guardrails still live — the rules the snapshot's view decides the reach of. */
function treeRules(entries: readonly Bound[]): Bound[] {
  return entries.filter(
    (entry) =>
      entry.kind === "guardrail" && entry.disabled === null && entry.at.some((moment) => moment === "write" || moment === "delete"),
  );
}

/**
 * The paths those rules name OUTRIGHT — a glob with no wildcard, such as `.env`. A file that does
 * not exist yet is in no listing of ignored files, so status asks git about these by name.
 */
export function literalScopes(load: LoadResult | null): string[] {
  const rules = treeRules(universe(load?.ok === true ? load.entries : []));
  return [...new Set(rules.flatMap((entry) => (entry.on ?? []).filter((glob) => staticPrefix(glob) === glob)))];
}

/**
 * THE SNAPSHOT'S BLIND SPOTS, as red lines: a write or delete rule whose scope reaches a path git
 * ignores, where `snapshotInclude` does not bring it back.
 *
 * The snapshot is git's view, so a shell write to an ignored file is never in the diff and never
 * judged — and a rule guarding `.env` would load green and watch nothing. So the gap is said where a
 * person looks, naming the rule and the setting.
 *
 * WHAT "REACHES" MEANS, and why it is not "the glob could match something in there". An ignored
 * FILE is reached when the rule's globs match it. An ignored DIRECTORY is reached when a glob names
 * it — its literal head lies inside the directory (`dist/**` over an ignored `dist/`), or sits above
 * it and continues with `**` (`src/**` over an ignored `src/gen/`). A glob that is all wildcard,
 * `**` + `/*.ts`, does not reach `node_modules/` by this measure, though strictly it matches files in
 * there: every repo with such a rule would be red over a folder no rule was written about.
 */
export function snapshotGaps(entries: readonly Bound[], ignored: readonly string[], include: readonly string[]): Fitting[] {
  const covered = (path: string): boolean => matchAny(path, include) || include.some((glob) => reachesBelow(glob, path));
  const out: Fitting[] = [];
  for (const entry of treeRules(entries)) {
    const on = entry.on ?? [];
    const reached = new Set<string>();
    for (const path of ignored) {
      if (!path.endsWith("/")) {
        if (matchAny(path, on) && !matchAny(path, entry.ignore ?? []) && !covered(path)) reached.add(path);
        continue;
      }
      for (const glob of on) {
        const head = staticPrefix(glob);
        const at = head.startsWith(path) && head !== "" ? (head === glob ? glob : head) : reachesBelow(glob, path) ? path : null;
        if (at !== null && !covered(at)) reached.add(at);
      }
    }
    for (const path of reached)
      out.push({
        id: "snapshot",
        ok: false,
        detail:
          `${entry.id} guards ${path}, which git ignores, so a change a shell command makes there is never seen or judged. ` +
          `List it in snapshotInclude in ${CONFIG_FILE}, or narrow the rule.`,
      });
  }
  return out;
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
  readonly fittings: readonly Fitting[];
  readonly refusals: readonly Refusal[];
  readonly green: boolean;
}

function fittingsOf(facts: StatusFacts): Fitting[] {
  const registered = registeredEvents(facts.settings);
  const missing = HOOK_REGISTRATIONS.filter((r) => !registered.includes(r.event)).map((r) => r.event);
  const stale = staleRegistrations(facts.settings);
  const twice = facts.machine === null ? { bare: [], theirs: [] } : machineDiffers(facts.settings, facts.machine.settings);
  const once = twice.bare.length === 0 && twice.theirs.length === 0;
  const armed = armsFlow(facts.gateText);
  const old = !armed && armsOldFlow(facts.gateText);
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
      ok: armed,
      detail: armed
        ? `${GATE_PATH} runs \`flow hook commit\` over the staged changes`
        : old
          ? `${GATE_PATH} calls the old \`flow commit\`, which leaves every deleted file unchecked — ${UPDATE_THE_GATE_LINE}.`
          : facts.gateText === null
            ? `no ${GATE_PATH} — \`flow init\` arms it. Until then nothing runs at the commit.`
            : `${GATE_PATH} is here but does not call flow — ${ADD_THE_GATE_LINE}.`,
    },
    {
      id: "hooks-path",
      ok: facts.hooksPath === HOOKS_DIR,
      detail:
        facts.hooksPath === HOOKS_DIR
          ? `core.hooksPath = ${HOOKS_DIR}`
          : `core.hooksPath is ${facts.hooksPath ?? "unset"} — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    },
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
    {
      id: "hooks",
      ok: missing.length === 0 && stale.length === 0 && once,
      detail:
        missing.length === 0 && stale.length === 0 && once
          ? `${facts.settingsPath} — ${registered.join(" · ")}`
          : [
              missing.length === 0
                ? ""
                : `${facts.settingsPath} does not call flow for ${missing.join(" · ")} — re-run \`flow init\`. Until it does, ${missing.map((event) => UNREGISTERED.get(event)).join("; ")}.`,
              stale.length === 0
                ? ""
                : `${facts.settingsPath} calls flow for ${stale.join(" · ")} on some tools only — an older flow registered ${stale.length === 1 ? "it" : "them"} that way, and a change another tool makes is not judged after it lands. Re-run \`flow init\` to widen ${stale.length === 1 ? "it" : "them"}.`,
              twice.bare.length === 0 || facts.machine === null
                ? ""
                : `${facts.machine.path} also calls flow for ${twice.bare.join(" · ")} the old way, as the bare \`flow hook <event>\`, so Claude Code runs it beside ${facts.settingsPath}'s command and each of those hooks fires twice. Re-run \`flow init\`, which rewrites it to the same command.`,
              twice.theirs.length === 0 || facts.machine === null
                ? ""
                : `${facts.machine.path} also calls flow for ${twice.theirs.join(" · ")} with a command of its own, so Claude Code runs it beside ${facts.settingsPath}'s command and each of those hooks fires twice. Make it the same command as ${facts.settingsPath}'s, or remove it from that file.`,
            ]
              .filter((line) => line !== "")
              .join("\n"),
    },
    binaryFitting(facts),
    ...snapshotGaps(universe(facts.load?.ok === true ? facts.load.entries : []), facts.ignored, facts.snapshotInclude),
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
function hooksReach(settings: unknown): Reach {
  return bareRegistrations(settings).length > 0 ? "path" : "local";
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
 * CAN THE HOOKS AND THE GATE FIND `flow`? Both call it by name, so a repo can carry every other
 * fitting and still have each hook fail with `flow: not found` and every commit refused.
 *
 * Each is judged AS WRITTEN. Today's gate and registrations run the repo's own package first, so
 * a dev dependency answers them and its copy wins over the PATH's. An older gate, or a
 * registration in the old shape, finds only the PATH — and the repo's own copy is one it never
 * runs, a red line naming which of them is stranded and how to bring it up to date.
 */
function binaryFitting(facts: Pick<StatusFacts, "binary" | "gateText" | "settings">): Fitting {
  const { listed, copy, path } = facts.binary;
  // THE REPO'S OWN COPY is one its package.json lists. In a repo that does not list flow, the copy
  // is the link `flow init` made to the flow that ran it — the PATH's, in the ordinary global
  // install — so it is judged by the PATH, and the tutorial's line names the PATH.
  const modules = listed && copy;
  const hooks = hooksReach(facts.settings);
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
export function delivers(kind: EntrySpec["kind"], moment: Moment): boolean {
  return kind === "guardrail"
    ? isGuardrailMoment(moment) && DELIVERS.guard.includes(moment)
    : isBreadcrumbMoment(moment) && DELIVERS.brief.includes(moment);
}

/** The gathered facts, judged. Never throws: a broken config is a red line, not an exception. */
export function status(facts: StatusFacts): Status {
  const entries = facts.load?.ok === true ? facts.load.entries : [];
  const refusals = facts.load?.ok === false ? facts.load.refusals : [];

  // NO MOMENT TABLE WHEN THE CONFIG DID NOT LOAD. A load fault is not partial — the loader refuses
  // the whole document, so every rail is off until it is fixed, and printing "3 guardrails at the
  // commit" under a headline saying nothing is armed would be the old status's exact lie.
  const bound = refusals.length > 0 ? [] : universe(entries);
  const dark = bound
    .filter((entry) => entry.disabled === null && entry.at.length > 0 && !entry.at.some((m) => delivers(entry.kind, m)))
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

  for (const fitting of s.fittings) lines.push(`  ${fitting.ok ? "✓" : "✗"} ${fitting.id}: ${fitting.detail}`);
  for (const refusal of s.refusals) lines.push(`  ✗ ${refusal.code}: ${refusal.detail}`);
  for (const id of s.dark)
    lines.push(
      `  ✗ ${id}: bound only at a moment nothing delivers here — it loads, it counts, and it will never fire. ` +
        `This adapter carries ${DELIVERS.guard.join(" · ")} for a guardrail and ${DELIVERS.brief.join(" · ")} for a breadcrumb.`,
    );
  lines.push(
    s.green
      ? "green — every rule loads, every fitting is in place."
      : `${count(redLines(s).length, "red line")} — flow is NOT fully in force here.`,
  );
  return lines;
}

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
