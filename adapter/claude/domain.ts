
import { followSteps, GIT_VALUE_OPTS, gitCommand, isOption, parseCommandLine, parseShellSteps, programName, resolveFrom, stepCommands, type BreadcrumbMoment, type LoadedEntry, type GuardrailMoment, type SessionFacts, type ShellCommand, type ShellStep, type TurnAction } from "../../language/domain.ts";
import { fires, namedAgent, type AgentOf, type Cause, type Row } from "../../engine/domain.ts";
import { posix } from "node:path";
import { ALLOW, CONFIG_FILE, PACKAGE_DIR, refused, relativise, repoFirst, text, type AdapterEvent, type Refused } from "../domain.ts";
import type { HookCost, HookResult, ToolAction, Registration, Spawn, SpawnMeta, Steer, TranscriptEvent, TranscriptHead, TranscriptRef } from "../harness.ts";



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
   * The permission mode the session runs under (`default` · `acceptEdits` · `plan` · `auto` · …),
   * as the host states it on every call. Recorded and reported; never a category key.
   */
  readonly permission_mode?: string;
  readonly [key: string]: unknown;
}

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
const HOST_EVENT: Record<HookEvent, string> = {
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
 *     refusal wins — which is the right order, since a blocked command is not about to run. The
 *     files a Bash command reads ride that same answer as touches (`bashReads`), so an area's note
 *     arrives before the output does.
 *
 * It is two lists rather than one because a moment is delivered for a KIND of entry: `command` and
 * `turn-end` are words in both vocabularies, and another harness may carry one rail there and not
 * the other — a single flat list could only lie about one of them.
 */
export const DELIVERS = {
  guard: ["command", "commit", "turn-end"] as readonly GuardrailMoment[],
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
// guessed at, and a line that does not parse names nothing.
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
 * One Bash call is genuinely several moments — the command about to run, the command's own note,
 * and each file it reads — and the old engine ran two evaluations off that one hook for exactly this
 * reason. A signature returning one event would push the second rail back into the shell, where it
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
      // that names a file (`post-tool-use`).
      const events = callEvents(payload, world);
      if (world.heldForBrief !== true) return events;
      const at = events.findIndex((event) => event.rail === "brief");
      const held: AdapterEvent = { rail: "brief", moment: "session" };
      return at === -1 ? [...events, held] : [...events.slice(0, at), held, ...events.slice(at)];
    }

    case "post-tool-use": {
      // THE PATH THE TOOL NAMED, as a touch. A pathless call is SILENCE, not a pathless touch
      // event: the engine narrows a breadcrumb by `on` only when the event names a path, so a touch
      // carrying none would show every area note at once.
      const named = touchedPath(payload, world.root);
      const touch: AdapterEvent[] = named === null ? [] : [{ rail: "brief", moment: "touch", path: named }];
      return world.heldForBrief === true ? [{ rail: "brief", moment: "session" }, ...touch] : touch;
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
    // The line is parsed once here: the command rules read it, and so do the files it reads. The host's `cwd` is where the shell stands, which is where each
    // command's folder is followed from.
    const cwd = shellCwd(payload, world.root);
    const steps = parseShellSteps(command, { cwd, home: world.home });
    const commands = steps === null ? null : stepCommands(steps);
    const events: AdapterEvent[] = [{ rail: "guard", moment: "command", command, commands, start: { cwd, home: world.home } }];
    events.push({ rail: "brief", moment: "command", command });
    // THE FILES IT READS, as touches on this same answer — so an area's note arrives with the
    // command briefing, before the output does, rather than never (a Bash payload names no
    // path for the post-tool-use rail to steer on).
    const { reads, searched } = bashReads(steps, { cwd, root: world.root, home: world.home });
    for (const path of new Set([...reads, ...searched])) events.push({ rail: "brief", moment: "touch", path });
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

/** What a post-tool-use call was about, repo-relative: a path, or nothing this rail can steer on. */
export function touchedPath(payload: HookPayload, root: string): string | null {
  const input = payload.tool_input ?? {};
  const named = input["file_path"] ?? input["notebook_path"] ?? input["path"] ?? input["glob"];
  return named ? relativise(text(named), root) : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ANOTHER WORKTREE — a call that works in another worktree of the repository, even a nested one
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// flow guards the folder the session started in. A call that writes into another worktree of the
// same repository, or a command that runs in one, works where no guardrail and no breadcrumb
// reaches, so the agent is told, once per worktree, to stop and have a session started there.
// Nothing is refused: the message rides beside the call's result. docs/user/explanation/what-the-guard-sees.md § Another worktree.

/** Is `path` the folder `dir`, or inside it? Both absolute. */
function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** The file an edit tool's call (`EDIT_TOOLS`) names, as named; null for any other call, or none named. */
export function editedFile(payload: HookPayload): string | null {
  if (!EDIT_TOOLS.has(text(payload.tool_name))) return null;
  const input = payload.tool_input ?? {};
  const named = text(input["file_path"] ?? input["notebook_path"]);
  return named === "" ? null : named;
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
 * Every place a call worked, absolute: the file an edit tool wrote, or the folders a shell command
 * ran in (`commandFolders`). What the decision (`untoldWorktrees`) places in a worktree.
 */
export function workedPaths(payload: HookPayload, root: string, home: string | undefined): string[] {
  const written = editedFile(payload);
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
// docs/user/explanation/what-the-guard-sees.md § Work outside the repository.

/**
 * Where an event works outside the repository, by the names the engine reads (`GuardEvent.outside`):
 * the `folder` of each command that runs outside, and the path of a touched file outside. A command with no
 * folder is inside. `gitIn` answers whether a folder holds a `.git`, and `sameRepository` whether git
 * names this repository for a folder; it is asked only of a folder `gitIn` cannot clear.
 */
export function outsideOf(
  event: AdapterEvent,
  root: string,
  gitIn: (dir: string) => boolean,
  sameRepository: (folder: string) => boolean,
): string[] {
  const out = (folder: string): boolean => beyondRoot(folder, root, gitIn) && !sameRepository(folder);
  if (event.rail === "guard") return event.moment === "command" ? knownFolders(event.commands ?? null).filter(out) : [];
  const path = event.path;
  if (path === undefined) return [];
  const absolute = posix.resolve(root, path);
  // The file itself may not exist yet, nor its folder: the folder is what is placed.
  return beyondRoot(absolute, root, gitIn) && !sameRepository(posix.dirname(absolute)) ? [path] : [];
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
 * THE DECISION: the worktrees to tell the agent about now. Each path is placed in the worktree that
 * holds it, the deepest when worktrees nest. The session's own worktree is the deepest one holding
 * the guarded folder, and only that one is skipped: a session started in a nested worktree is told
 * about the one around it. One already in `told` was said before, to this session and agent. Each
 * is named once, in the order the paths came.
 */
export function untoldWorktrees(args: {
  readonly paths: readonly string[];
  readonly root: string;
  readonly worktrees: readonly string[];
  readonly told: readonly string[];
}): string[] {
  const { paths, root, worktrees, told } = args;
  const holding = (path: string): string | undefined =>
    worktrees.filter((worktree) => within(path, worktree)).sort((a, b) => b.length - a.length)[0];
  const own = holding(root);
  const out: string[] = [];
  for (const path of paths) {
    const holder = holding(path);
    if (holder === undefined || holder === own || told.includes(holder) || out.includes(holder)) continue;
    out.push(holder);
  }
  return out;
}

/** What the agent is told about one worktree flow does not guard. */
export function worktreeLine(root: string, worktree: string): string {
  return (
    `flow guards ${root}, the folder this session started in. It does not guard the git worktree ${worktree}: ` +
    `no guardrail judges what you change there and no breadcrumb is shown for it, until the commit gate runs. ` +
    `Stop your work in ${worktree} and tell the user to start a Claude Code session in that folder, ` +
    `because flow guards a worktree only from a session started in it. ` +
    `If you are a subagent, stop and report this to the agent that started you.`
  );
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
  /** The other worktrees the call worked in that the agent is told, now, flow does not guard. */
  readonly unguarded?: { readonly root: string; readonly worktrees: readonly string[] } | undefined;
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
 * command about to run — one notice per answer, however many events the payload carried. A touch
 * never carries it, on either rail: a Read is not told, and a Bash call is told by its command, not
 * by the files it reads. So the after-call rail, whose events are touches, stays silent: the agent
 * was told when the call was asked for, and saying it again with the result is the same sentence
 * twice.
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
 * Does this event's answer carry the load error? A session start, and a command not yet run. Not a
 * touch, and not turn-end, on either rail, which is told on stderr instead.
 */
function carriesTheNotice(event: AdapterEvent): boolean {
  return event.moment !== "touch" && event.moment !== "turn-end";
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
 * exit 2, so stderr is the one place both are sure to arrive. Only a held turn's refusal carries
 * them: the shell judges no notes once something refused (`ridesRefusal`). The line for each other
 * worktree a call worked in (`worktreeLine`) rides whichever channel the answer already uses.
 */
export function toResult(hook: HookEvent, answer: Answer): HookResult {
  const refusal = refused(answer.refused);
  // The worktree lines come first, because they tell the agent to stop.
  const { unguarded: other } = answer;
  const unguarded = other === undefined ? [] : other.worktrees.map((worktree) => worktreeLine(other.root, worktree));
  const prose = [...unguarded, briefBlock(answer.shown)].filter((part) => part !== "").join("\n\n");
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

/**
 * A user line's prose, when it is one that starts a turn: what the human typed, or a background
 * task's notice (`isTaskNotice`). Null for tool results and injections.
 */
function turnStart(line: TranscriptLine): string | null {
  if (line.kind !== "user" || line.record["isMeta"] === true) return null;
  const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") return null;
  return isInjected(content) ? null : content;
}

/**
 * Is this user line the notice the host writes when a background task finishes?
 *
 * It is NOT in `INJECTED`, on purpose. A notice wakes the agent, so it starts a turn, and a turn
 * woken by one holds only what the agent did after it; read as an injection, that turn would reach
 * back to the human's last message, and a turn-end rule would be handed an edit from a turn
 * earlier. It is not the human talking either, so the report's prompts, and the corrections read
 * from them, leave it out. Either mark is enough: the text's opening tag, and the record's own
 * `origin.kind`, which every notice measured on Claude Code 2.1.322 to 2.1.325 carried.
 */
function isTaskNotice(line: TranscriptLine, prose: string): boolean {
  const origin = line.record["origin"] as { kind?: unknown } | undefined;
  return origin?.kind === "task-notification" || prose.trimStart().startsWith("<task-notification>");
}

/**
 * What the actor did THIS TURN, in order — the fact a turn-end check is handed.
 *
 * The turn starts at the last thing the human typed, or at the last background task's notice
 * when one woke the agent after it (`isTaskNotice`). That is a real narrowing of the rule this
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
    if (turnStart(lines[i] as TranscriptLine) !== null) {
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
    const prose = line === null ? null : turnStart(line);
    if (prose !== null) return prose.slice(0, cap);
  }
  return "";
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
  const { agent, agentType } = agentOf(args.payload);
  return {
    head: args.transcript === null ? "" : briefHead(args.transcript),
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
  const where = { cwd: shellCwd(payload, root), root, home };
  return bashReads(parseShellSteps(command, where), where).reads.map((path) => ({ kind: "read", tool: "Bash", path }));
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
 * A dot is not special: `/Users/x/.hidden/y` yields a doubled dash, and that doubling is the check
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
        agent: (parts[2] ?? "").slice("agent-".length, -".jsonl".length),
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
      const start = turnStart(line);
      if (start !== null) {
        // A background task's notice starts a turn, but nobody typed it.
        if (!isTaskNotice(line, start)) out.push({ line: line.line, kind: "prompt", text: start });
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
      const where = { cwd: text(line.record["cwd"]) || root, root, home };
      const reads =
        name === "Bash" && root !== ""
          ? bashReads(parseShellSteps(text(input["command"]), where), where).reads
          : [];
      out.push({
        line: line.line,
        kind: "use",
        ts: line.ts,
        id: text(block.id),
        name,
        action: actionOf(name),
        input,
        path: relativise(text(input["file_path"] ?? input["notebook_path"]), root),
        ...(reads.length === 0 ? {} : { reads }),
      });
    }
  }
  return out;
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

/** What a tool call did, in flow's words: the product's reading of a transcript never sees a tool name. */
function actionOf(tool: string): ToolAction {
  if (tool === "Write") return "write";
  if (EDIT_TOOLS.has(tool)) return "edit";
  if (tool === "Read") return "read";
  return tool === "Bash" ? "shell" : "other";
}

/** A tool result's text, whichever of the three shapes the host wrote it in. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as { text?: string }[]).map((part) => part.text ?? "").join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

// ── weaken-after-block ─────────────────────────────────────────────────────

/**
 * The repo's own Claude Code settings file, relative to the repo root: guarded here, and where
 * `settingsFileFor` registers a dev dependency's hooks, and `flow uninstall` takes them out.
 */
export const REPO_SETTINGS = ".claude/settings.json";

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

/**
 * One hook flow registers, as `REGISTERED` states it: the event, its matcher, and what goes
 * unjudged without it. Not a settings file's entry, which is a `Registration`.
 */
interface FlowHook {
  readonly hook: HookEvent;
  readonly matcher?: string;
  readonly unregistered: string;
}

/**
 * WHAT `flow init` WRITES, verbatim — and it follows DELIVERS, not HOOK_EVENTS.
 *
 * flow answers seven events and registers six: `Notification` is the deliberate difference. flow
 * has no notification moment, so a registration there would spawn a process on every banner to
 * answer nothing — cost with no function, and a line contradicting the honest moment list this file
 * publishes. The day a notification moment earns its way into the grammar, the registration arrives
 * with it.
 *
 * ONE PER EVENT. Two registrations on one event fire twice, and when they point at different
 * checkouts they can disagree — so a second concern extends the command it shares an event with
 * rather than standing beside it.
 *
 * The matchers are the host's. PreToolUse takes `Bash` alone: the one thing flow refuses before it
 * happens is a shell command, so no other tool's call has anything to wait for. PostToolUse takes
 * `*`, because any tool's call can name a file a breadcrumb is about. There is no hook before the
 * Edit and Write tools, and none after a failed call: flow stops no write and no delete.
 *
 * DERIVED, not re-typed: the host's name for an event and the word this binary answers to are both
 * read off `HOST_EVENT`, the one place that mapping is stated. Written out by hand, this list would
 * be a second spelling of it — and the day an event is renamed, the half that still compiled would
 * register a command nothing answers.
 *
 * `unregistered` is what goes unjudged while that one registration is missing — what `flow status`
 * says beside the fix, unless the machine-wide file calls flow for that event in the meantime (see
 * `unregisteredText`). Each event costs its own rails and no others, so a file missing one names
 * that one's cost, not the whole guard's.
 */
const REGISTERED: readonly FlowHook[] = [
  { hook: "session-start", matcher: "startup|resume|clear|compact", unregistered: "no note is shown when a session starts" },
  { hook: "subagent-start", unregistered: "no note is shown when a subagent starts" },
  { hook: "pre-tool-use", matcher: "Bash", unregistered: "no rule judges a command before it runs" },
  { hook: "post-tool-use", matcher: "*", unregistered: "no note is shown for the file a tool call names" },
  { hook: "stop", unregistered: "no turn-end rule runs when the main chat hands back" },
  { hook: "subagent-stop", unregistered: "no turn-end rule runs when a subagent hands back" },
];

/**
 * The hooks an older flow registered that this one does not: the host's name for each, and the word
 * its command ends in. `flow init` removes flow's own entry on each, and `flow uninstall` too, so a
 * registration this build no longer answers does not stay behind as a process that does nothing.
 */
const RETIRED: ReadonlyMap<string, string> = new Map([["PostToolUseFailure", "post-tool-use-failure"]]);

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
 * What goes unjudged while each registration is missing, by the host's own name for its event — what
 * `flow status` says beside the fix. Derived from `REGISTERED`, so it cannot name an event flow does
 * not register.
 */
export const HOOK_COSTS: readonly HookCost[] = REGISTERED.map(({ hook, unregistered }) => ({ event: HOST_EVENT[hook], unregistered }));

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
export function registeredEvents(settings: unknown): string[] {
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
export function staleRegistrations(settings: unknown): string[] {
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
          return word === null ? inner : { ...(inner as Record<string, unknown>), command: hookCommand(word) };
        }),
      };
    });
  }
  return Object.fromEntries(Object.entries(hooks).filter(([event]) => !emptied.has(event)));
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
 *
 * ONLY AN EVENT BOTH FILES CALL FLOW FOR. Where the repo's own file does not call flow yet, the
 * machine-wide command is the only one that runs, so nothing fires twice: that event is the
 * "does not call flow" line's, and `flow init` writes the repo's command for it.
 */
export function machineDiffers(repo: unknown, machine: unknown): { bare: string[]; theirs: string[] } {
  const repoArrays = hookArrays(repo);
  const repoCalls = new Set(registeredEvents(repo));
  const out = { bare: [] as string[], theirs: [] as string[] };
  for (const [event, entries] of Object.entries(hookArrays(machine))) {
    if (!repoCalls.has(event)) continue;
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
  // THE REPORT, in registration order: each event added, rewritten or removed, once, with why.
  const added: string[] = [];
  for (const event of new Set([...HOOK_REGISTRATIONS.map((r) => r.event), ...bare, ...RETIRED.keys()])) {
    const why = [
      ...(stale.has(event) && RETIRED.has(event) ? ["removed: flow no longer registers it"] : []),
      ...(stale.has(event) && !RETIRED.has(event) ? ["matcher brought up to date"] : []),
      ...(bare.has(event) ? [`now runs the flow in ${PACKAGE_DIR} first`] : []),
    ];
    if (why.length > 0) added.push(`${event} (${why.join(", ")})`);
    else if (!already.has(event) && !RETIRED.has(event)) added.push(event);
  }
  return { settings: { ...base, hooks }, added };
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
export function withoutRegistrations(settings: unknown): { settings: unknown; removed: string[] } {
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
