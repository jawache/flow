// flow/language/domain.ts — THE GRAMMAR. Everything a flow.config.ts and a pack are written in,
// and the load that re-checks it.
//
// This is the language layer's whole pure core, and the first stage of flow's pipeline:
//
//   language → checks → engine → adapter
//
// It knows nothing of the four core checks written in it, nothing of the engine that will match
// its entries against events, and nothing of the harness that will feed that engine — the fences
// in work.yaml say so, and the direction is why a recorded session replays without either.
//
// SIX SECTIONS, one file, and the file is the point. They were six modules at F1 and the
// boundaries between them were fiction: every one imported the one above it, the whole set had a
// single consumer (index.ts), and the last round of that phase was spent deleting five facts each
// stated in two of them. What is genuinely shared is now visible rather than re-derived —
// `chain` builds every chain there is, `Once` says "may be said once" once, `overlay` is the only
// place a source map is built, and `Symbol.for` is the only brand.
//
//   MOMENTS      the WHEN vocabulary and its mapping to engine phases
//   CATEGORIES   the WHO — a value with its recognizer aboard
//   CHECKS       the WHAT — the Ctx contract a check reads the world through
//   ENTRIES      the sentence: one entry, spoken as a chain, and the data it becomes
//   PACKS        the two binding verbs — packs define, the config binds — and the overlay
//   THE LOAD     bindings in, the effective regime out, or every reason it cannot be one
//
// Nothing here reaches the world. No node:fs, no child_process, no process.env: this file is a
// pure home under the fcis rails, `flow/**/domain.ts` is what those rails now name, and eslint
// says so on the line before the commit gate ever does.
//
// The PUBLIC surface is ../index.ts, not this file. A pack or a config imports from there — which
// is what leaves this layout free to move again.

// TWO imports. `../glob.ts`, the package's single shared file, because a scope's `on` / `ignore`
// keys are glob-shaped and the dialect they speak has exactly one parser. And `unbash`, a bash
// parser with no dependencies and no I/O, because `ctx.commands` is a shell line read as code and
// shell has exactly one parser here too — see THE PARSE.
import { parse as parseBash } from "unbash";
import type {
  ArithmeticExpression,
  CommandNode,
  ParameterExpansionPart,
  ParameterOperation,
  ParsedScript,
  PipelineNode,
  Redirection,
  SimpleExpansionPart,
  Statement,
  TestExpression,
  Word,
  WordPart,
  Command as BashCommand,
  AndOr,
  CompoundList,
} from "unbash";
import { matchAny } from "../glob.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MOMENTS — when a rule fires. The vocabulary and the mapping to engine phases,
// and nothing else.
// ════════════════════════════════════════════════════════════════════════════════════════════════

//
// The PHASES table below is lifted verbatim from cli/guard/pure/bindings.ts:56 — it is the one
// thing worth carrying out of the old 785-line format file, and its comment is carried with it
// because the reasoning is still load-bearing:
//
//   These are the format's words, not the engine's phase names — `edit` and `turn` are internals
//   and are as unknown here as any typo. `write` is the human word for the pre-emptive PreToolUse
//   block, which the engine calls `edit`; `command` rides both the Bash rail and the commit gate
//   the rule-tester drives it on.
//
//   `push` is not among them. It was accepted for a year and fired by nothing (no pre-push hook
//   is written), which in a no-defaults format is a word promising a rail that does not exist.
//
//   The vocabulary and the mapping used to be two lists. They cannot be: a moment in one and not
//   the other is either a word the format accepts and nothing ever fires, or a rail no word can
//   reach. Adding a moment is one line HERE and it reaches both.
//
// What changed in the move is only who reads it. In YAML a moment was a string the format had to
// judge; here it is an imported value, so `.at(wrte)` is a missing binding at the line you typed
// and never reaches a validator at all. The table stays because the ENGINE still needs the
// mapping, and because the load re-validates data that may have been built outside an editor.

const PHASES = {
  write: ["edit"],
  command: ["edit", "commit"],
  commit: ["commit"],
  delete: ["delete"],
  "turn-end": ["turn"],
} as const satisfies Record<string, readonly string[]>;

/** The moments a guardrail may fire at — the keys of the one table above. */
export type GuardrailMoment = keyof typeof PHASES;

/** The moments a breadcrumb may show at. A breadcrumb is a note; it has no rail to block. */
export type BreadcrumbMoment = (typeof BREADCRUMB_MOMENTS)[number];

/** Either vocabulary. `turn-end` is the one word in both. */
export type Moment = GuardrailMoment | BreadcrumbMoment;

export const GUARDRAIL_MOMENTS: readonly GuardrailMoment[] = Object.keys(PHASES) as GuardrailMoment[];
export const BREADCRUMB_MOMENTS = ["session", "touch", "command", "turn-end"] as const;

// ── the words, as values ─────────────────────────────────────────────────────
//
// A config imports these rather than spelling them: `.at(write)` is a binding the editor
// resolves, so the whole class of "moment typo loads green and fires never" is gone before the
// grammar has to have an opinion about it.
//
// `deletion` is the one export whose name is not its word, and it cannot be otherwise: `delete`
// is a reserved word and `const delete = …` is a syntax error. The MOMENT is still "delete" —
// the value's contents, the table's key, and what a log line prints.

export const write = "write" as const;
export const command = "command" as const;
export const commit = "commit" as const;
export const deletion = "delete" as const;
export const turnEnd = "turn-end" as const;
export const session = "session" as const;
export const touch = "touch" as const;

/** The engine phases a moment list fires at — deduped, in declaration order. */
export function phasesOf(at: readonly GuardrailMoment[]): string[] {
  const out: string[] = [];
  for (const m of at) for (const p of PHASES[m]) if (!out.includes(p)) out.push(p);
  return out;
}

/** Is this string one of the guardrail words? The load's backstop, not the editor's job. */
export function isGuardrailMoment(m: string): m is GuardrailMoment {
  return (GUARDRAIL_MOMENTS as readonly string[]).includes(m);
}

/** Is this string one of the breadcrumb words? */
export function isBreadcrumbMoment(m: string): m is BreadcrumbMoment {
  return (BREADCRUMB_MOMENTS as readonly string[]).includes(m);
}

/**
 * The moments whose events NAME A PATH — and therefore the only ones `.on()` / `.ignore()` narrow.
 *
 * A write and a delete carry the would-be file; the commit gate carries the staged set; a touch
 * carries the file the tool call was about. The other three carry no path at all: a command guard's
 * patterns ARE its scope, a turn-end is about what the actor did, and a session start is about the
 * session. The engine expresses the same fact at run time — `subjectsOf` consults `inScope` for
 * exactly these moments, and `brief` narrows a note only when the event names a path — and stating
 * it here is what lets a scope that would narrow NOTHING be refused rather than quietly ignored.
 */
export const PATH_MOMENTS = ["write", "delete", "commit", "touch"] as const;
export type PathMoment = (typeof PATH_MOMENTS)[number];

/** Does this moment carry a path for `on` / `ignore` to narrow? */
export function isPathMoment(m: string): m is PathMoment {
  return (PATH_MOMENTS as readonly string[]).includes(m);
}

/**
 * THE SUBJECT A NOTE'S SCOPE IS MATCHED AGAINST — a path at the path moments, and the COMMAND LINE
 * at `command`, which is the one moment where the two kinds of entry are scoped differently.
 *
 * A command GUARDRAIL needs no scope and must not have one: its patterns are its scope, and a rule
 * that could be narrowed one way and match another is a rule whose halves can disagree in silence.
 * A command NOTE is the opposite case — it has no patterns at all, so without `.on(…)` it would show
 * on every shell call in the session, which is the same as showing on none. `.on("npm install*")` is
 * how it says which commands it is about, matched as a glob over the line about to run.
 */
export const BRIEF_SCOPE_MOMENTS = [...PATH_MOMENTS, "command"] as const;
export type BriefScopeMoment = (typeof BRIEF_SCOPE_MOMENTS)[number];

/** Does a scope narrow anything for this KIND of entry at this moment? */
export function isScopable(kind: EntrySpec["kind"], m: string): boolean {
  return kind === "breadcrumb" ? (BRIEF_SCOPE_MOMENTS as readonly string[]).includes(m) : isPathMoment(m);
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// CATEGORIES — who a rule binds to
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A category is a value with its recognizer aboard: the thing that defines "builder" is the thing
// that knows how to spot one. That is the whole design, and the alternatives it rules out are why
// — a free match-function per rule gives every entry too much power and kills static reporting; a
// config-level classifier separate from the names splits definition from recognition; and a
// framework that SHIPS the names bakes one platform's vocabulary into the engine. Ruled 2026-09-04.
//
// Referenced-is-registered: a category any bound entry names is live, and nothing registers
// separately. There is no list to fall out of step with the code.
//
// flow ships NO category names. "builder", "parent", "checker" are the work platform's vocabulary,
// exported by work's own flow library; any repo defines bespoke ones the same one-line way.
//
// WHAT THE CLASSIFIER SEES is host-written evidence and never a claim the session made about
// itself — a session could lie, and permissions would then rest on the lie. Filling these facts
// from a real transcript is the adapter's job (F4/F5) and classifying with them is the engine's
// (F3); this file is the contract those two meet on.

/**
 * The host-written record of one session × agent, as a classifier sees it.
 *
 * Every field is something a HARNESS wrote, not something the session said. `agentType` is the
 * strongest of them — the agent type the host puts in the hook message for every call a subagent
 * makes — and it is what a classifier should key on when it exists.
 */
export interface SessionFacts {
  /** The head of this session's own transcript: the brief it was started with, verbatim. */
  head: string;
  /** True when this is a spawned subagent rather than the parent session. */
  subagent: boolean;
  /** The agent type the host started this spawn as, from its hook message. Absent on a parent. */
  agentType?: string | undefined;
  /**
   * @deprecated Always undefined: a category that reads it never matches. It came from the sidecar
   * file, which is no longer read, and the hook message carries no description. Kept so a config
   * that names it still compiles.
   */
  description?: string | undefined;
}

/** A category's recognizer: host-written facts in, a yes or no out. */
export type Classifier = (facts: SessionFacts) => boolean;

/**
 * A declared category. Only `defineCategory` makes one — the brand is what lets the load refuse
 * an entry that scoped itself to something that merely looks like a category.
 */
export interface Category {
  readonly [CATEGORY]: true;
  readonly name: string;
  readonly classify: Classifier;
}

// `Symbol.for`, not `Symbol()`: a config and a pack can end up importing two copies of flow (npm
// hoisting is not a guarantee), and a per-module symbol would make each copy's categories
// unrecognisable to the other — a refusal with no cause a reader could see.
const CATEGORY = Symbol.for("flow.category");

/** Declare a category: a name, and the recognizer that travels with it. */
export function defineCategory(name: string, classify: Classifier): Category {
  return { [CATEGORY]: true, name, classify };
}

/**
 * What `value` holds under `key`, or undefined when it is not an object at all.
 *
 * ONE reader for every brand in this file. There were four — the category symbol, the pack symbol,
 * the ref symbol and the sentence's `spec` — each re-typing the same `typeof value === "object" &&
 * value !== null` guard before reaching in. Four copies of a null check is four chances to write
 * the one that reads a property off `null` and throws inside a loader whose whole promise is that
 * it collects faults instead of stopping at one.
 */
function held(value: unknown, key: symbol | string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<symbol | string, unknown>)[key];
}

/** Was this made by `defineCategory`? The load's backstop behind `.for()`'s typing. */
export function isCategory(value: unknown): value is Category {
  return held(value, CATEGORY) === true;
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// CHECKS — what a rule asks, and the contract it asks it through
// ════════════════════════════════════════════════════════════════════════════════════════════════

// SCOPE, honestly: this phase builds the config grammar, and a grammar cannot type `.check(…)`
// without saying what a check IS. So the Ctx contract is stated here, as spec'd, and nothing
// implements it yet — the real exec/fs/git wiring is the adapter's (F4), and the core check
// library that fills this shape is F2's. What lands now is the shape both of them must fit.
//
// The contract is weaker than purity and is exactly what the system needs: a check reads the
// world ONLY through ctx, and speaks only through its verdict. Two properties follow, and they
// are the whole point —
//
//   Deterministic given ctx. No ambient imports: no node:fs, no child_process. The same ctx
//   answers always produce the same verdict, which is what lets `.test()` cases and
//   recorded-session replay drive any check, core or bespoke, with a stubbed ctx. It is
//   mechanically enforced here rather than promised: this file is in a pure home, and the repo's
//   own guard blocks the import.
//
//   No actions, only verdicts. A check never writes, deletes or blocks anything itself. Its fail
//   becomes a block effect; the engine assembles effects; the adapter performs them. The chain of
//   custody from judgement to action stays one-directional.


/** What `ctx.exec` answers. A diagnostic command's whole result, as data. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** A check's answer. Never an action — the engine turns a fail into an effect. */
export type Verdict = { readonly ok: true } | { readonly ok: false; readonly detail?: string };

/**
 * One thing the actor did during a turn: it changed a file, or it ran a command.
 *
 * TWO KINDS AND NO MORE, and the narrowness is the contract. A harness records a turn in its own
 * vocabulary — Claude Code writes JSONL naming tools like `Edit`, `Write` and `Bash` — and which
 * of those names counts as an edit is exactly the kind of dialect the adapter exists to absorb.
 * What the engine and a check are handed is the answer, not the transcript: an ordered list of
 * edits and runs that any harness can produce and a `.test()` case can simply write out.
 *
 * The rule this replaces read `$WORK_TURN_TRANSCRIPT` from the environment, opened the file and
 * parsed it, inside the check — three reads of the world in the one place the design forbids
 * them, and it made that rule the only core rule no case could drive.
 */
export type TurnAction =
  | { readonly did: "edit"; readonly path: string }
  | { readonly did: "run"; readonly command: string };

/**
 * Everything a check may know and everything it may do.
 *
 * The facts are already in memory when the check runs — a write rail sees the file as it WOULD be
 * written, disk untouched; a command rail sees the line about to run; the commit gate sees the
 * staged paths. That is what lets a repo's own check name the file at fault instead of
 * re-deriving the tree, and it makes the work scale with the change rather than with the repo.
 */
export interface Ctx {
  // ── WHAT HAPPENED — the event's facts. Plain data, already in memory. ──
  readonly moment: Moment;
  /**
   * write/touch: the would-be file.
   *
   * `existed` says whether a file was at `path` before this change, and it is set only where the
   * tree can no longer say so. A shell command's change is judged AFTER it has landed, when
   * `ctx.fs.exists(path)` answers yes to every file it created; at commit every staged file is on
   * disk, and "before" is the last commit. Absent, ask `ctx.fs`: at write the tree is still the
   * one from before the change.
   *
   * `unchanged` is `true` on a file identical to the last commit's copy, which only `flow hook
   * commit --all` hands a check: it judges the whole tree, and most of it is as committed. A check
   * about content reads it all the same; a check about edits has nothing to judge. Absent everywhere
   * else, because every other event is a change.
   */
  readonly file?:
    | {
        readonly path: string;
        readonly content: string;
        readonly existed?: boolean | undefined;
        readonly unchanged?: boolean | undefined;
      }
    | undefined;
  /** command: the line about to run. */
  readonly command?: string | undefined;
  /**
   * command: that line parsed as bash — one entry per simple command, nested ones included, in
   * the order they appear. `null` when the line does not parse: read it as "cannot tell".
   */
  readonly commands?: readonly ShellCommand[] | null | undefined;
  /** commit: the staged paths. Under `flow hook commit --all`, every file in the tree. */
  readonly staged?: readonly string[] | undefined;
  /** turn-end: what the actor did this turn, in order. */
  readonly turn?: readonly TurnAction[] | undefined;
  /**
   * Every moment: the category names that match the session making this change — the categories
   * some bound entry names, whose recognizer said yes to the host-written evidence about it. Empty
   * when it matches none, which is not "every category".
   */
  readonly actor: readonly string[];

  // ── THE DOOR TO THE WORLD — capabilities, injected. The only way out. ──
  exec(cmd: string): Promise<ExecResult>;
  readonly fs: {
    read(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
  };
  readonly git: {
    diff(path?: string): Promise<string>;
    stagedFiles(): Promise<string[]>;
  };

  // ── THE ANSWER — a verdict, never an action. ──
  ok(): Verdict;
  /** `detail` rides under the sentence's message, saying which thing broke. */
  fail(detail?: string): Verdict;
}

/** A check: ctx in, a verdict out. Sync or async — the engine awaits either. */
export type Check = (ctx: Ctx) => Verdict | Promise<Verdict>;

/**
 * The two verdict constructors — INTERNAL to flow, and deliberately not part of its public surface.
 *
 * A check has exactly one way to answer and it is `ctx.ok()` / `ctx.fail(detail)`. That is the
 * spelling the fifteen core checks are written in, the spelling a repo's own check is written in,
 * and the only one flow/index.ts exports. These exist because something has to BUILD the ctx that
 * carries them — the canned one a `.test()` case runs through, and the live one the adapter makes
 * — and that is flow's own job, not a config author's. Exporting both would put two spellings of
 * one answer in front of every check writer, and half of them would pick the wrong one.
 */
export const verdict = {
  ok: (): Verdict => ({ ok: true }),
  fail: (detail?: string): Verdict => (detail === undefined ? { ok: false } : { ok: false, detail }),
};

/**
 * Everything a check may reach for beyond the event's own facts — the three capabilities, alone.
 *
 * Derived from `Ctx` rather than restated, so there is one description of what flow can reach and
 * no way to grow a fourth capability that a `.test()` case has no means of recording.
 */
export type World = Pick<Ctx, "exec" | "fs" | "git">;

// ── THE PARSE — a shell line read as code, once, and handed to every check as `ctx.commands` ──
//
// A regex over the raw line cannot tell one command from the next, or a command from the same
// words inside a quoted argument, so nothing in flow decides what a command does by matching the
// line. `unbash` reads it as bash; this section reduces its tree to the one shape a check needs:
// the simple commands, each with the program that actually runs. docs/user/reference/ctx.md
// states the fields, and docs/user/explanation/what-the-guard-sees.md § The parse is the why.
//
// What cost time to find in unbash: a word's `parts` is a lazy getter, so the walk below reads it
// by name and never by `Object.keys`; a parse error inside a nested script sits on THAT script's
// `errors`, not the root's, so every script the walk enters is asked; and a quoted heredoc's body
// carries no parts at all, which is the shell running nothing in it.

/** One heredoc a command is fed. `quoted` is a delimiter in quotes or after a backslash. */
export interface ShellHeredoc {
  readonly body: string;
  readonly quoted: boolean;
}

/** One `$( … )` or backtick substitution the shell runs: the command inside, and which spelling. */
export interface ShellSubstitution {
  readonly text: string;
  readonly backtick: boolean;
  /** The commands it runs, nested ones included, as `ctx.commands` lists them. */
  readonly commands: readonly ShellCommand[];
  /**
   * The index in its command's `args` of the argument this substitution ends, when only plain text
   * comes before it there — `-m "$( … )"`, `-m"$( … )"`, `--message="$( … )"` — or null.
   */
  readonly argument: number | null;
  /** That plain text: `""` for an argument that is the substitution alone, `-m` for `-m"$( … )"`. Null with `argument`. */
  readonly prefix: string | null;
}

/** One redirect on a command: its operator (`>`, `>>`, `<`, `2>&1`'s `>&` …) and its target word. */
export interface ShellRedirect {
  readonly operator: string;
  readonly target: string;
}

/** One simple command in a parsed line — the fields docs/user/reference/ctx.md promises. */
export interface ShellCommand {
  /** The program that runs, after any `FOO=1` assignment and any wrapper. */
  readonly program: string;
  /** Its arguments as the program receives them, quotes removed. */
  readonly args: readonly string[];
  /** `program` and `args` joined by single spaces. */
  readonly text: string;
  readonly heredocs: readonly ShellHeredoc[];
  /** What the shell runs while building this command's arguments and unquoted heredocs. */
  readonly substitutions: readonly ShellSubstitution[];
  /** Its redirects, and those of every group or loop it sits in. A heredoc or here-string is not one. */
  readonly redirects: readonly ShellRedirect[];
  /** Inside a substitution, a `<( … )`, a `bash -c` or `eval` string, or a heredoc or here-string fed to a shell. */
  readonly nested: boolean;
}

/**
 * One piece of a word as the line writes it: text the shell passes as is (quoted, escaped or plain),
 * a variable it expands (`$NAME`, `${NAME}`), a leading unquoted `~`, or something only running
 * the line could tell — a substitution, a special parameter, a `${…}` with an operation in it.
 */
export type ShellWordPiece =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "tilde" }
  | { readonly kind: "unknown" };

/** A word as the line writes it, piece by piece, so a reader expands `$F` and leaves `'$F'` alone. */
export type ShellWord = readonly ShellWordPiece[];

/**
 * THE SAME PARSE, IN THE ORDER IT RUNS — for a reader that follows the line the way the shell does:
 * where a `cd` leaves it, what a variable the line set holds, what a `for` loop's body is given.
 * Not on ctx, and not public: `ctx.commands` is exactly these steps' commands (`stepCommands`), so
 * the two can never disagree about what a line runs.
 */
export type ShellStep =
  | {
      readonly kind: "command";
      readonly command: ShellCommand;
      /**
       * Its words as written — wrappers first, no here-string — and where the program starts among
       * them: `words.slice(0, at)` are the wrappers stepped past (`xargs -a list …`), and the rest
       * are the program and the arguments it is given. A here-string's text is stdin, not a word.
       */
      readonly words: readonly ShellWord[];
      readonly at: number;
      /** Whether a `NAME=value` assignment stands in front of it, as its env: `FOO=1 rm`. Not one of its words. */
      readonly assigned: boolean;
      /** `command.redirects` with each target as written, so a reader expands `< $F` and leaves `< '$F'` alone. */
      readonly redirects: readonly StepRedirect[];
      /** The substitutions that build its words, which run before it does. */
      readonly before: readonly ShellStep[];
    }
  /**
   * `NAME=value` on its own, or as an argument of `export`, `declare`, `local`, `readonly` or
   * `typeset`, which sets a shell variable. In front of a command it is that command's env, and not a step.
   */
  | { readonly kind: "assign"; readonly name: string; readonly value: ShellWord }
  /** A subshell, a substitution, or a script handed to another shell: a `cd` or a variable set inside stays inside. */
  | { readonly kind: "scope"; readonly body: readonly ShellStep[] }
  /** `for name in values; do body; done`: the body runs once per value. `values` is empty when the line lists none. */
  | { readonly kind: "for"; readonly name: string; readonly values: readonly ShellWord[]; readonly body: readonly ShellStep[] };

/**
 * Every command in the steps, nested ones included, in the order they appear in the line: a
 * command before the commands its own substitutions run, which is the order `ctx.commands` keeps.
 */
export function stepCommands(steps: readonly ShellStep[]): ShellCommand[] {
  return steps.flatMap((step) =>
    step.kind === "command" ? [step.command, ...stepCommands(step.before)] : step.kind === "assign" ? [] : stepCommands(step.body),
  );
}

/** A redirect on a step: its operator, and its target as written. A redirect with no target has one unknown piece. */
export interface StepRedirect {
  readonly operator: string;
  readonly target: ShellWord;
}

/** One redirect as it is gathered, from which both its public form and its step form are built. */
interface Gathered {
  readonly operator: string;
  /** The target with quotes removed, as `ShellRedirect.target` gives it. */
  readonly value: string;
  readonly written: ShellWord;
}

/** The public form, for `ctx.commands`. */
const publicRedirect = (r: Gathered): ShellRedirect => ({ operator: r.operator, target: r.value });

/** The step's form, for a reader that expands the target. */
const stepRedirect = (r: Gathered): StepRedirect => ({ operator: r.operator, target: r.written });

/** The steps with a group's or a loop's redirects added to each command at its own level, however deep in a subshell or a loop. */
function withRedirects(steps: readonly ShellStep[], nested: boolean, gathered: readonly Gathered[]): ShellStep[] {
  return steps.map((step): ShellStep => {
    if (step.kind === "assign") return step;
    if (step.kind === "command") {
      const c = step.command;
      const before = withRedirects(step.before, nested, gathered);
      if (c.nested !== nested) return { ...step, before };
      return {
        ...step,
        before,
        command: { ...c, redirects: [...c.redirects, ...gathered.map(publicRedirect)] },
        redirects: [...step.redirects, ...gathered.map(stepRedirect)],
      };
    }
    return { ...step, body: withRedirects(step.body, nested, gathered) };
  });
}

/**
 * The wrappers stepped past to the program that runs, each with the options that take a value —
 * the word after one of those is the value, not the program. `assignments` is env's `NAME=value`
 * list, `operands` the words a wrapper takes before the program (timeout's duration), and `lookup`
 * the flags that make it run nothing at all: `command -v rm` asks where rm is.
 */
const WRAPPERS: Readonly<
  Record<string, { readonly valued: readonly string[]; readonly assignments?: true; readonly operands?: number; readonly lookup?: readonly string[] }>
> = {
  sudo: { valued: ["-u", "-g", "-p", "-C", "-D", "-r", "-t", "-T", "-U", "--user", "--group", "--prompt", "--chdir", "--role", "--type"] },
  env: { valued: ["-u", "-C", "--unset", "--chdir"], assignments: true },
  nohup: { valued: [] },
  nice: { valued: ["-n", "--adjustment"] },
  time: { valued: ["-o", "-f", "--output", "--format"] },
  timeout: { valued: ["-s", "-k", "--signal", "--kill-after"], operands: 1 },
  command: { valued: [], lookup: ["-v", "-V"] },
  exec: { valued: ["-a"] },
  xargs: {
    valued: ["-I", "-L", "-n", "-P", "-s", "-d", "-E", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-chars", "--eof", "--max-lines", "--process-slot-var"],
  },
};

/** Whether the program, without its path, is a wrapper the parse steps past to the program that runs. */
export function isWrapper(program: string): boolean {
  return Object.hasOwn(WRAPPERS, programName(program));
}

/** The shells whose `-c` string, or whose stdin heredoc or here-string, is itself a script the parse reads. */
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A program's name without its path, the ONE way flow reads it: `/usr/bin/git` and `git` are both
 * `git`. A word ending in `/` names a directory, and gives "".
 */
export function programName(program: string): string {
  return program.slice(program.lastIndexOf("/") + 1);
}

/**
 * How many words at the head of an argv are wrappers, their options and their operands — where the
 * program that runs starts. A wrapper with nothing after it stays the program.
 */
function wrapperWords(argv: readonly string[]): number {
  let rest = argv;
  for (;;) {
    const spec = WRAPPERS[programName(rest[0] ?? "")];
    if (spec === undefined) return argv.length - rest.length;
    const flags: string[] = [];
    let at = rest.length; // where the program is: past every flag, value and assignment
    let value = false; // the word before was a flag that takes this one as its value
    for (const [n, word] of rest.slice(1).entries()) {
      if (value) value = false;
      else if (word === "--") {
        at = n + 2;
        break;
      } else if (spec.assignments && ASSIGNMENT.test(word)) continue;
      else if (word.startsWith("-") && word !== "-") {
        flags.push(word);
        value = spec.valued.includes(word);
      } else {
        at = n + 1;
        break;
      }
    }
    at += spec.operands ?? 0;
    if (spec.lookup?.some((flag) => flags.includes(flag)) || at >= rest.length) return argv.length - rest.length;
    rest = rest.slice(at);
  }
}

/**
 * What a shell is told to run: its `-c` string, or its stdin (a heredoc it is fed) when it has no
 * script file to read, or nothing. `-o` and `-O` take the next word; any other flag word is flags.
 */
function shellInput(args: readonly string[]): { readonly string: string } | "stdin" | null {
  let c = false;
  let s = false;
  let value = false; // the word before was `-o` or `-O`, which takes this one
  for (const arg of args) {
    if (value) value = false;
    else if (/^[-+][oO]$/.test(arg)) value = true;
    else if (/^[-+][A-Za-z]+$/.test(arg)) {
      c ||= arg.startsWith("-") && arg.includes("c");
      s ||= arg.startsWith("-") && arg.includes("s");
    } else if (arg === "-" || arg.startsWith("--")) continue;
    else return c ? { string: arg } : s ? "stdin" : null;
  }
  return c ? null : "stdin";
}

/** A shell variable's name, as `NAME=` sets it: not a special parameter such as `$1`, `$@` or `$?`. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * One expansion as a piece: a plain `$NAME` or `${NAME}` is a variable, anything else unknown. A
 * `${…}` is read from unbash's own fields — no `!` or `#` prefix, no index, no operation — and a
 * bare `$NAME`, which unbash gives as text alone, from its text.
 */
function expansionPiece(part: SimpleExpansionPart | ParameterExpansionPart): ShellWordPiece {
  const name =
    part.type === "ParameterExpansion"
      ? part.prefix === undefined && part.index === undefined && part.operation === undefined
        ? part.parameter
        : ""
      : part.text.slice(1);
  return VARIABLE_NAME.test(name) ? { kind: "variable", name } : { kind: "unknown" };
}

/** A part of a word, or of a double-quoted run, as pieces. */
function wordPieces(part: WordPart): ShellWordPiece[] {
  switch (part.type) {
    case "Literal":
    case "SingleQuoted":
    case "AnsiCQuoted":
      return [{ kind: "text", text: part.value }];
    case "DoubleQuoted":
    case "LocaleString":
      return part.parts.flatMap(wordPieces);
    case "SimpleExpansion":
    case "ParameterExpansion":
      return [expansionPiece(part)];
    case "ExtendedGlob":
    case "BraceExpansion":
      return [{ kind: "text", text: part.text }];
    default:
      return [{ kind: "unknown" }];
  }
}

/** A word as pieces. A leading `~` is the home directory only when it is unquoted, and only as `~` or `~/…`. */
function shellWord(w: Word): ShellWord {
  const pieces: ShellWordPiece[] = w.parts === undefined ? [{ kind: "text", text: w.value }] : w.parts.flatMap(wordPieces);
  const [first] = pieces;
  const unquoted = w.parts === undefined || w.parts[0]?.type === "Literal";
  if (unquoted && first?.kind === "text" && (first.text === "~" || first.text.startsWith("~/")) && w.text.startsWith("~")) {
    return [{ kind: "tilde" }, { kind: "text", text: first.text.slice(1) }, ...pieces.slice(1)];
  }
  return pieces;
}

/**
 * One substitution: the command inside its text, without its `$( … )` or backticks, and the
 * commands the walk read from it. Its argument is set by the command it builds, once that command
 * knows where its arguments start.
 */
function substitution(text: string, body: readonly ShellStep[]): ShellSubstitution {
  const backtick = text.startsWith("`");
  return { text: (backtick ? text.slice(1, -1) : text.slice(2, -1)).trim(), backtick, commands: stepCommands(body), argument: null, prefix: null };
}

/**
 * The plain text in front of the substitution a word ends with — `""` when the word is the
 * substitution alone, bare or in double quotes — or null when the word ends with something else, or
 * anything but plain text comes before it.
 */
function textBefore(w: Word): string | null {
  const pieces = (w.parts ?? []).flatMap((part): readonly WordPart[] => (part.type === "DoubleQuoted" ? part.parts : [part]));
  const last = pieces.pop();
  if (last?.type !== "CommandExpansion") return null;
  let text = "";
  for (const piece of pieces) {
    if (piece.type !== "Literal" && piece.type !== "SingleQuoted" && piece.type !== "AnsiCQuoted") return null;
    text += piece.value;
  }
  return text;
}

/**
 * Parse one shell command line as bash: every simple command in it, nested ones included, in the
 * order they appear — or `null` when the line, or any script nested inside it, does not parse.
 */
export function parseCommandLine(line: string): ShellCommand[] | null {
  const walked = walkLine(line);
  return walked === null ? null : stepCommands(walked.steps);
}

/** The same parse as its steps, in the order the shell runs them — or `null` when it does not parse. */
export function parseShellSteps(line: string): readonly ShellStep[] | null {
  return walkLine(line)?.steps ?? null;
}

/**
 * The line as written, less the body of every heredoc in it — the subject a `banCommands` rule
 * with `wholeLine` matches. The opener and the terminator line stay, and so does everything else,
 * newlines included. A heredoc a shell reads, directly or through a pipeline, holds commands, and
 * its body stays; so does a body inside a string the parse reads again (`bash -c`, `eval`), which
 * is part of that string. `null` when the line does not parse.
 */
export function elideHeredocBodies(line: string): string | null {
  const walked = walkLine(line);
  if (walked === null) return null;
  let out = "";
  let copied = 0;
  for (const [from, to] of [...walked.bodies].sort((a, b) => a[0] - b[0])) {
    if (from < copied) continue; // inside a body already cut: a heredoc in an unquoted heredoc's `$( … )`
    out += line.slice(copied, from);
    copied = to;
  }
  return out + line.slice(copied);
}

/**
 * THE walk: the line's steps, and where each heredoc body sits in it — one parse, read by
 * `parseCommandLine`, `parseShellSteps` and `elideHeredocBodies` alike.
 */
function walkLine(line: string): { readonly steps: ShellStep[]; readonly bodies: readonly (readonly [number, number])[] } | null {
  // Objects, not `let`s: the walk below sets them from inside closures, which narrowing cannot see.
  const fault = { found: false };
  // How deep the walk is in text the parse read on its own — a `bash -c` string, an `eval`, a
  // heredoc fed to a shell, an escaped-backtick script — whose positions are not the line's.
  const foreign = { depth: 0 };
  // Where each heredoc body sits in the line, and the ones a shell reads as its script: those are
  // commands, so they stay in the line `elideHeredocBodies` returns.
  const spans = new Map<ShellHeredoc, readonly [number, number]>();
  const shellRead = new Set<ShellHeredoc>();
  const readAsScript = (h: ShellHeredoc, out: ShellStep[]): void => {
    shellRead.add(h);
    source(h.body, out);
  };

  // A script the walk enters: the line itself, a substitution's body, a `bash -c` string.
  const script = (s: ParsedScript | undefined, nested: boolean, out: ShellStep[]): void => {
    if (s === undefined || (s.errors?.length ?? 0) > 0) {
      fault.found = true;
      return;
    }
    const own = s.source !== undefined;
    if (own) foreign.depth += 1;
    for (const statement of s.commands) node(statement, nested, out);
    if (own) foreign.depth -= 1;
  };
  // A script that runs apart from the line's own shell — a substitution, a `bash -c` string — is
  // one scope: what it changes stays in it. The steps it read are returned.
  const scope = (fill: (body: ShellStep[]) => void, out: ShellStep[]): readonly ShellStep[] => {
    const body: ShellStep[] = [];
    fill(body);
    out.push({ kind: "scope", body });
    return body;
  };
  const source = (text: string, out: ShellStep[]): void => {
    foreign.depth += 1;
    scope((body) => { script(parseBash(text), true, body); }, out);
    foreign.depth -= 1;
  };

  // A word's parts: every substitution in it is recorded for the command it belongs to (`subs`,
  // null where it belongs to none) and the commands inside it are read as nested ones.
  const word = (w: Word | undefined, subs: ShellSubstitution[] | null, out: ShellStep[]): void => {
    for (const part of w?.parts ?? []) wordPart(part, subs, out);
  };
  const wordPart = (part: WordPart, subs: ShellSubstitution[] | null, out: ShellStep[]): void => {
    switch (part.type) {
      case "CommandExpansion": {
        // Read whether or not a command takes the substitution: `[[ $(rm a) == b ]]` runs it too.
        const body = scope((steps) => { script(part.script, true, steps); }, out);
        subs?.push(substitution(part.text, body));
        return;
      }
      case "ProcessSubstitution":
        scope((body) => { script(part.script, true, body); }, out);
        return;
      case "DoubleQuoted":
      case "LocaleString":
        for (const child of part.parts) wordPart(child, subs, out);
        return;
      case "ExtendedGlob":
      case "BraceExpansion":
        for (const child of part.parts ?? []) wordPart(child, subs, out);
        return;
      case "ParameterExpansion":
        word(part.index, subs, out);
        if (part.operation !== undefined) operation(part.operation, subs, out);
        return;
      case "ArithmeticExpansion":
        arithmetic(part.expression, subs, out);
        return;
      default:
        return;
    }
  };
  const operation = (op: ParameterOperation, subs: ShellSubstitution[] | null, out: ShellStep[]): void => {
    switch (op.type) {
      case "Default":
      case "Remove":
      case "Transform":
      case "CaseModification":
        word(op.operand, subs, out);
        return;
      case "Replace":
        word(op.pattern, subs, out);
        word(op.replacement, subs, out);
        return;
      case "Slice":
        word(op.offset, subs, out);
        word(op.length, subs, out);
        return;
      default:
        return;
    }
  };
  const arithmetic = (e: ArithmeticExpression | undefined, subs: ShellSubstitution[] | null, out: ShellStep[]): void => {
    if (e === undefined) return;
    switch (e.type) {
      case "ArithmeticBinary":
        arithmetic(e.left, subs, out);
        arithmetic(e.right, subs, out);
        return;
      case "ArithmeticUnary":
        arithmetic(e.operand, subs, out);
        return;
      case "ArithmeticTernary":
        arithmetic(e.test, subs, out);
        arithmetic(e.consequent, subs, out);
        arithmetic(e.alternate, subs, out);
        return;
      case "ArithmeticGroup":
        arithmetic(e.expression, subs, out);
        return;
      case "ArithmeticWord":
        for (const part of e.parts ?? []) wordPart(part, subs, out);
        return;
      case "ArithmeticCommandExpansion": {
        const body = scope((steps) => { script(e.script, true, steps); }, out);
        subs?.push(substitution(e.text, body));
        return;
      }
    }
  };
  const test = (e: TestExpression, out: ShellStep[]): void => {
    switch (e.type) {
      case "TestUnary":
        word(e.operand, null, out);
        return;
      case "TestBinary":
        word(e.left, null, out);
        word(e.right, null, out);
        return;
      case "TestLogical":
        test(e.left, out);
        test(e.right, out);
        return;
      case "TestNot":
        test(e.operand, out);
        return;
      case "TestGroup":
        test(e.expression, out);
        return;
    }
  };
  // A redirection's target or body. A redirect is recorded for its command, and a heredoc too; an
  // unquoted heredoc's body is expanded by the shell, so its substitutions are that command's too.
  const redirection = (
    r: Redirection,
    heredocs: ShellHeredoc[] | null,
    redirects: Gathered[],
    subs: ShellSubstitution[] | null,
    out: ShellStep[],
  ): void => {
    if (r.type !== "HereDoc") {
      if (r.type === "Redirect")
        redirects.push({ operator: r.operator, value: r.target?.value ?? "", written: r.target === undefined ? [{ kind: "unknown" }] : shellWord(r.target) });
      word(r.target, subs, out);
      return;
    }
    const quoted = r.delimiter?.quoted === true;
    const heredoc: ShellHeredoc = { body: r.body.text, quoted };
    heredocs?.push(heredoc);
    if (foreign.depth === 0) spans.set(heredoc, [r.body.pos, r.body.end]);
    if (!quoted) for (const part of r.body.parts ?? []) wordPart(part, subs, out);
  };

  const node = (n: Statement | AndOr | PipelineNode | CommandNode | CompoundList, nested: boolean, out: ShellStep[]): void => {
    switch (n.type) {
      case "Statement":
        node(n.command, nested, out);
        return;
      case "AndOr":
        for (const c of n.commands) node(c, nested, out);
        return;
      case "Pipeline":
        pipeline(n.commands, nested, out);
        return;
      case "Time":
      case "Negation":
        if (n.command !== undefined) node(n.command, nested, out);
        return;
      case "Command":
        simple(n, nested, out);
        return;
      case "Redirected": {
        // A group's or a loop's redirects apply to every command inside it, so each one lists them.
        const inside: ShellStep[] = [];
        const redirects: Gathered[] = [];
        node(n.command, nested, inside);
        for (const r of n.redirects) redirection(r, null, redirects, null, inside);
        out.push(...withRedirects(inside, nested, redirects));
        return;
      }
      case "CompoundList":
        for (const statement of n.commands) node(statement, nested, out);
        return;
      case "ArithmeticFor":
        arithmetic(n.initialize, null, out);
        arithmetic(n.test, null, out);
        arithmetic(n.update, null, out);
        node(n.body, nested, out);
        return;
      case "Subshell":
      case "Coproc":
        scope((body) => { node(n.body, nested, body); }, out);
        return;
      case "BraceGroup":
      case "Function":
        node(n.body, nested, out);
        return;
      case "If":
        node(n.clause, nested, out);
        node(n.then, nested, out);
        if (n.else !== undefined) node(n.else, nested, out);
        return;
      case "For": {
        for (const w of n.wordlist ?? []) word(w, null, out);
        const body: ShellStep[] = [];
        node(n.body, nested, body);
        out.push({ kind: "for", name: n.name.value, values: (n.wordlist ?? []).map(shellWord), body });
        return;
      }
      case "Select":
        for (const w of n.wordlist ?? []) word(w, null, out);
        node(n.body, nested, out);
        return;
      case "While":
        node(n.clause, nested, out);
        node(n.body, nested, out);
        return;
      case "Case":
        word(n.word, null, out);
        for (const item of n.items) node(item.body, nested, out);
        return;
      case "TestCommand":
        test(n.expression, out);
        return;
      case "ArithmeticCommand":
        arithmetic(n.expression, null, out);
        return;
    }
  };

  // A pipeline: each stage in order, then — when a later stage is a shell reading its stdin, or
  // eval — the heredocs an earlier stage is fed are that shell's script, and are read as nested
  // commands after the pipeline: `cat <<'EOF' | sh` runs the body. A stage that is itself a shell
  // reading its own heredoc has already had it read, by `simple`.
  const pipeline = (stages: readonly CommandNode[], nested: boolean, out: ShellStep[]): void => {
    const outs = stages.map((stage) => {
      const own: ShellStep[] = [];
      node(stage, nested, own);
      out.push(...own);
      return stepCommands(own).filter((c) => c.nested === nested);
    });
    const readsStdin = (c: ShellCommand | undefined): boolean =>
      c !== undefined && (programName(c.program) === "eval" || (SHELLS.has(programName(c.program)) && shellInput(c.args) === "stdin"));
    outs.forEach((own, i) => {
      if (readsStdin(own[0]) || !outs.slice(i + 1).some((later) => readsStdin(later[0]))) return;
      for (const c of own) for (const h of c.heredocs) readAsScript(h, out);
    });
  };

  // ONE simple command: its argv with quotes removed, its heredocs, the substitutions that build
  // it, and — after it, in the order they appear — every command nested inside it.
  const simple = (c: BashCommand, nested: boolean, out: ShellStep[]): void => {
    const argv: string[] = [];
    const words: ShellWord[] = [];
    const heredocs: ShellHeredoc[] = [];
    const redirects: Gathered[] = [];
    const subs: ShellSubstitution[] = [];
    // The substitutions that end a word with only plain text before them: the word's place in
    // argv, and that text.
    const ending = new Map<ShellSubstitution, { readonly index: number; readonly prefix: string }>();
    const argWord = (w: Word): void => {
      const from = subs.length;
      word(w, subs, inner);
      const [only] = subs.slice(from);
      const prefix = textBefore(w);
      if (only !== undefined && subs.length === from + 1 && prefix !== null) ending.set(only, { index: argv.length - 1, prefix });
    };
    const inner: ShellStep[] = [];
    for (const p of c.prefix) {
      if (p.type === "Assignment") assignment(p.value, subs, inner);
      else redirection(p, heredocs, redirects, subs, inner);
    }
    if (c.name !== undefined) {
      argv.push(c.name.value);
      words.push(shellWord(c.name));
      argWord(c.name);
    }
    for (const s of c.suffix) {
      if (s.type === "Word") {
        argv.push(s.value);
        words.push(shellWord(s));
        argWord(s);
      } else if (s.type === "Assignment") {
        const value = s.value.type === "Word" ? s.value.value : `(${s.value.elements.map((e) => e.value).join(" ")})`;
        const head = `${s.name}${s.index === undefined ? "" : `[${s.index.value}]`}${s.append ? "+=" : "="}`;
        argv.push(`${head}${value}`);
        words.push([{ kind: "text", text: head }, ...(s.value.type === "Word" ? shellWord(s.value) : [{ kind: "unknown" } as const])]);
        assignment(s.value, subs, inner);
      } else redirection(s, heredocs, redirects, subs, inner);
    }
    // A `<<<` here-string's text is the command's last argument, after every word.
    const herestrings = argv.length === 0 ? [] : [...c.prefix, ...c.suffix].flatMap((r) => (r.type === "HereString" && r.target !== undefined ? [r.target.value] : []));
    argv.push(...herestrings);
    const at = wrapperWords(argv);
    const [program, ...args] = argv.slice(at);
    if (program !== undefined) {
      // Counted from the program's first argument, past the wrappers; the program's own word is none.
      const placed = (sub: ShellSubstitution): ShellSubstitution => {
        const end = ending.get(sub);
        const argument = end === undefined ? -1 : end.index - at - 1;
        return argument < 0 || end === undefined ? sub : { ...sub, argument, prefix: end.prefix };
      };
      const substitutions = subs.map(placed);
      const command = { program, args, text: [program, ...args].join(" "), heredocs, substitutions, redirects: redirects.map(publicRedirect), nested };
      const assigned = c.prefix.some((p) => p.type === "Assignment");
      out.push({ kind: "command", command, words, at, assigned, redirects: redirects.map(stepRedirect), before: inner });
      // `export A=b`: the parse gives a declaration's arguments as assignments, which set the
      // shell's variables once it has run. One that appends or sets an element is not followed.
      for (const s of c.suffix)
        if (s.type === "Assignment" && s.value.type === "Word" && s.index === undefined && !s.append)
          out.push({ kind: "assign", name: s.name, value: shellWord(s.value) });
    } else {
      // Assignments alone set the shell's variables, once the substitutions in their values have run.
      out.push(...inner);
      for (const p of c.prefix) if (p.type === "Assignment" && p.value.type === "Word") out.push({ kind: "assign", name: p.name, value: shellWord(p.value) });
      return;
    }
    const name = programName(program);
    if (name === "eval") source(args.join(" "), out);
    if (!SHELLS.has(name)) return;
    // A shell's input is its own words; a here-string is its stdin, and a script when stdin is read.
    const input = shellInput(args.slice(0, args.length - herestrings.length));
    if (input === "stdin") {
      for (const h of heredocs) readAsScript(h, out);
      for (const text of herestrings) source(text, out);
    } else if (input !== null) source(input.string, out);
  };
  const assignment = (value: Word | { readonly elements: readonly Word[] }, subs: ShellSubstitution[], out: ShellStep[]): void => {
    if ("elements" in value) for (const e of value.elements) word(e, subs, out);
    else word(value, subs, out);
  };

  const out: ShellStep[] = [];
  script(parseBash(line), false, out);
  const bodies = [...spans].filter(([h]) => !shellRead.has(h)).map(([, span]) => span);
  return fault.found ? null : { steps: out, bodies };
}

/**
 * THE ctx builder — the one place a check's world is assembled, and there must only ever be one.
 *
 * Three callers, and the whole promise of this package rests on their agreeing: the engine builds
 * one from a live event and a real world; `flow test` builds one from a case and a recorded world;
 * replay builds one from a transcript. If those three assembled a ctx even slightly differently,
 * a green case would stop being evidence about the live rail — which is the entire value of cases
 * existing. They were two assemblers for one commit, and that was one commit too many.
 *
 * `exec` is wrapped while `fs` and `git` are passed whole, which looks inconsistent and is not: a
 * method called off `ctx.fs` still has `world.fs` as its receiver, whereas a bare `exec: world.exec`
 * would be called with `ctx` as its receiver and break any world that closes over itself.
 */
export function makeCtx(moment: Moment, facts: Partial<Ctx>, world: World): Ctx {
  // `ctx.commands` is filled wherever `ctx.command` is, BY CONSTRUCTION: all three callers come
  // through here. A caller that already parsed the line hands the parse in, and it is not redone.
  const parsed = facts.command === undefined || facts.commands !== undefined ? {} : { commands: parseCommandLine(facts.command) };
  return {
    moment,
    ...facts,
    ...parsed,
    actor: facts.actor ?? [],
    exec: (cmd: string) => world.exec(cmd),
    fs: world.fs,
    git: world.git,
    ok: verdict.ok,
    fail: verdict.fail,
  };
}

/** The options a configured check was built with, riding on the check itself. Never enumerable. */
const SETTINGS = Symbol.for("flow.settings");

/** Why a configured check's OPTIONS are unusable — the same trick, and refused at load. */
const FAULTS = Symbol.for("flow.faults");

/**
 * Mark a configured check as built with options it cannot work with, and say why.
 *
 * WHY IT IS A VALUE AND NOT A THROW: a check factory runs while the config module is evaluating, so
 * a throw there is a module that will not import, and the reader gets one fault with a stack trace
 * instead of every fault with its entry named. Marked instead, the load collects it beside the
 * grammar's own refusals, and the same text answers every gated moment — the engine's `guard`
 * refuses with it, and the live hook rail passes it to the agent with each call — which is the
 * shape every other load failure already has.
 *
 * WHY IT EXISTS AT ALL: an option can be well-TYPED and still be nonsense — the class that bit here
 * was a depcruise layer written as a regex where the dialect takes globs, which compiled to a
 * pattern matching nothing. The fence loaded, `flow status` called it armed, and it walked no graph
 * for as long as nobody planted a probe. A rule that cannot do its job must refuse to load, never
 * report green.
 */
export function withFaults<C extends Check>(check: C, faults: readonly string[]): C {
  if (faults.length > 0) Object.defineProperty(check, FAULTS, { value: faults, enumerable: false, configurable: true });
  return check;
}

/** What a configured check said is wrong with its own options. Empty for every healthy check. */
export function faultsOf(check: Check | undefined): readonly string[] {
  if (check === undefined) return [];
  const found = (check as unknown as Record<symbol, unknown>)[FAULTS];
  return Array.isArray(found) ? (found as string[]) : [];
}

/**
 * Declare a CONFIGURED check: a function that takes options and returns a check.
 *
 * Its whole job is to give `ctx` its type inside the closure, so the body is written against the
 * contract with no annotation. The other two forms need nothing at all: an inline check is a
 * lambda in the sentence, and a named one is `export const x: Check = …`.
 *
 * IT DOES ONE THING BESIDES, and it was a plain identity function until it did: the options a
 * check was configured with are kept ON the returned check, under a symbol nothing enumerates. A
 * check is a closure, so once it is built the settings inside it are unreachable — and a reader
 * that cannot see them cannot say what a rule really watches. The generated pack pages printed the
 * `.check(…)` SOURCE instead, which is how `noGitDiscard({})`, a bare `TESTS` constant and a
 * helper call reached a page as the whole description of a rule. Read back through `settings` on
 * the loaded entry they are RESOLVED values: the globs a parameter supplied, the recipe a repo
 * named. Nothing in the run reads them — the engine calls the check and asks it nothing else — so
 * this cannot change what any rule decides.
 */
export function defineCheck<Options, C extends Check>(factory: (options: Options) => C): (options: Options) => C {
  return (options: Options): C => {
    const check = factory(options);
    // On the check, not in a side table: a check outlives the call that made it — overlaid, copied
    // into a draft, handed to the runner — and every one of those carries the function itself. A
    // WeakMap here would be a second thing to keep in step.
    Object.defineProperty(check, SETTINGS, { value: options, enumerable: false, configurable: true });
    return check;
  };
}

/**
 * The options a check was configured with, or `undefined` for one that never came through
 * `defineCheck` — an inline lambda in a sentence, or a bespoke `const x: Check = …`.
 */
export function checkSettings(check: Check | undefined): unknown {
  return check === undefined ? undefined : (check as { readonly [SETTINGS]?: unknown })[SETTINGS];
}

// ── cases: a canned ctx, declared on the entry ───────────────────────────────
//
// The vocabulary is PER MOMENT, and it is the event fact that moment carries: a command string
// for a command rail, a path-and-content pair for a write rail, a staged set for the commit gate,
// a list of turn actions for turn-end. A case is a canned ctx and can be, because a check reads
// the world only through one — which is what lets `flow test` drive a core check, a pack's check
// and a repo's bespoke check through the same door the live hooks use.
//
// An entry without cases does not load. The class of bug that shipped two dead import fences for
// four days is a rule whose block case was never written, and it dies at authoring time or not
// at all.

/**
 * The answers a case records for whatever its check reaches for beyond the event's own facts.
 *
 * Everything is optional and an absent answer is not a silent zero: the runner reports a reach it
 * cannot answer as a FAILED case, naming the command or path to add here. A case that passed
 * because the world happened to answer "" is the thing this design exists to prevent.
 */
export interface CaseWorld {
  /**
   * Recorded `ctx.exec` answers, by command. Matched exactly first, then by CONTAINMENT — a key
   * of `"depcruise"` answers the multi-line invocation the depcruise check builds, which is not a
   * string anybody would want to retype into a case.
   */
  readonly exec?: Readonly<Record<string, { stdout?: string; stderr?: string; code?: number }>>;
  /** Files `ctx.fs` can see, by path. A path not here does not exist. */
  readonly fs?: Readonly<Record<string, string>>;
  /** What `ctx.git.diff()` answers. */
  readonly gitDiff?: string;
  /** What `ctx.git.stagedFiles()` answers when the moment carried no staged set of its own. */
  readonly staged?: readonly string[];
}

/** One canned event, in the dialect its moment speaks. */
export type Case =
  /** A command rail, shorthand — by far the commonest case, and it should read as one line. */
  | string
  | { readonly command: string; readonly world?: CaseWorld; readonly actor?: readonly string[] }
  | {
      readonly path: string;
      readonly content: string;
      /** The change landed before it was judged, as a shell command's does: `ctx.file.existed`. */
      readonly existed?: boolean;
      readonly world?: CaseWorld;
      readonly actor?: readonly string[];
    }
  | {
      readonly staged: readonly string[];
      /** The staged paths the last commit does not have. Each file's `ctx.file.existed` says so. */
      readonly added?: readonly string[];
      /** The staged paths identical to the last commit, as under `--all`. Each sets `ctx.file.unchanged`. */
      readonly unchanged?: readonly string[];
      /**
       * Staged deletions, by path, each with its content as the last commit has it. An entry that
       * fires at `delete` as well as `commit` is asked about each one, as a delete.
       */
      readonly deleted?: Readonly<Record<string, string>>;
      readonly world?: CaseWorld;
      readonly actor?: readonly string[];
    }
  | { readonly actions: readonly TurnAction[]; readonly world?: CaseWorld; readonly actor?: readonly string[] };

/** The cases an entry carries: what must pass it, and what must be blocked by it. */
export interface Cases {
  readonly pass?: readonly Case[];
  readonly block?: readonly Case[];
}

/** What a recorded world was reached for and could not answer. */
export interface Unanswered {
  readonly kind: "exec" | "read";
  readonly asked: string;
}

/**
 * THE recorded world — a `CaseWorld` as the three capabilities, and there must only ever be one.
 *
 * It sits beside `makeCtx` for the same reason and it is the same sentence: `flow test` drives a
 * check through this, the engine's own suite drives a whole rail through this, and F5's replay will
 * drive a recorded session through this. The moment there are two of them they disagree about
 * silence — which is precisely what happened for one commit, where a second copy answered an
 * unrecorded file read with `""` while this one recorded the reach. One of those makes a case pass
 * on a fiction, and telling which is which afterwards is impossible.
 *
 * Recorded exec answers are matched by exact command first and then by CONTAINMENT, which is not
 * laziness: the commands a check builds are not always things a person would want to retype — the
 * depcruise runner's is a multi-line heredoc carrying a compiled config — so a case says
 * `{ "depcruise": … }` and means "when it shells out to that". Exact wins when both could match, so
 * a case can still pin one specific invocation out of three.
 *
 * An unanswered reach is RECORDED rather than guessed at or thrown on. Guessing would let a case
 * pass on a fiction; throwing from here would be a throw in a pure home. The caller turns the
 * record into a failure naming exactly what was asked for.
 */
export function cannedWorld(
  recorded: CaseWorld,
  staged: readonly string[] | undefined,
  unanswered: Unanswered[],
): World {
  const execAnswers = recorded.exec ?? {};
  const files = recorded.fs ?? {};
  return {
    exec: (cmd: string): Promise<ExecResult> => {
      const key = Object.hasOwn(execAnswers, cmd) ? cmd : Object.keys(execAnswers).find((k) => cmd.includes(k));
      const answer = key === undefined ? undefined : execAnswers[key];
      if (answer === undefined) {
        unanswered.push({ kind: "exec", asked: cmd });
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      }
      return Promise.resolve({ stdout: answer.stdout ?? "", stderr: answer.stderr ?? "", code: answer.code ?? 0 });
    },
    fs: {
      // `exists` is answered by the map alone and is never unanswered: a path the recording did not
      // mention is a path that is not there, which is the ordinary thing silence means here.
      exists: (path: string): Promise<boolean> => Promise.resolve(Object.hasOwn(files, path)),
      read: (path: string): Promise<string> => {
        const text = files[path];
        if (text === undefined) {
          unanswered.push({ kind: "read", asked: path });
          return Promise.resolve("");
        }
        return Promise.resolve(text);
      },
    },
    git: {
      diff: (): Promise<string> => Promise.resolve(recorded.gitDiff ?? ""),
      stagedFiles: (): Promise<string[]> => Promise.resolve([...(staged ?? recorded.staged ?? [])]),
    },
  };
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTRIES — THE SENTENCE. One entry, spoken as a chain, and the data it becomes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The grammar is closed and final:
//
//   at · for · on · ignore · check · message | text | file · disabled · test · description
//
// and it rests on the three rules the YAML format died holding, now enforced by the compiler
// rather than by a validator nobody reached:
//
//   NOTHING IS DEFAULTED. A guardrail that never said .at(), .check(), .message() and .test() is
//   not an entry, and `definePack` refuses it at the line you typed. An absent `on` is absent, not
//   `**/*` — a reader never needs a check's private fallback to know what an entry does.
//
//   NOTHING EXTRA IS TOLERATED. The chain IS the key set. There is no `bans:`-for-`ban:` here,
//   because a key the grammar does not have is a method that does not exist.
//
//   NOTHING IS SAID TWICE. Each verb may be spoken once per sentence; a second `.on(…)` is not a
//   silent overwrite, it is a call the type system has already removed.
//
// The chain is IMMUTABLE — every verb returns a new sentence. That is what lets a pack build a
// family from a shared prefix without one entry's later verb reaching back into another's.
//
// A note on what a sentence is NOT: it never says WHERE it is bound. The config's `pack()` line
// does that, and the entry's id is the property it is filed under. You never write a name twice.


// ── the data an entry IS ─────────────────────────────────────────────────────

/** An entry turned off, and why. The reason is the sentence `flow status` prints beside it. */
export interface DisabledMark {
  readonly reason?: string | undefined;
}

interface SpecCommon {
  readonly for?: readonly Category[];
  readonly on?: readonly string[];
  readonly ignore?: readonly string[];
  readonly disabled?: DisabledMark;
  readonly description?: string;
}

/** A guardrail, as its sentence stated it. Every key explicit; nothing derived. */
export interface GuardrailSpec extends SpecCommon {
  readonly kind: "guardrail";
  readonly at?: readonly GuardrailMoment[];
  readonly check?: Check;
  readonly message?: string;
  readonly test?: Cases;
}

/** A breadcrumb: a note, and the moments it shows at — all of them, not just the first. */
export interface BreadcrumbSpec extends SpecCommon {
  readonly kind: "breadcrumb";
  readonly at?: readonly BreadcrumbMoment[];
  readonly text?: string;
  readonly file?: string;
}

export type EntrySpec = GuardrailSpec | BreadcrumbSpec;

/**
 * A path scope, as anything that has one states it — an entry's spec, or the universe row the
 * facts layer reads. Two readers of `on` / `ignore` is how the guard and the report come to
 * disagree about what a rule watches, so there is one and everything that has a scope wears it.
 */
export interface Scope {
  readonly on?: readonly string[] | undefined;
  readonly ignore?: readonly string[] | undefined;
}

/**
 * Is this path inside the entry's `on` / `ignore` scope? No `on` at all is every path.
 *
 * It lives HERE, with the two keys it reads, rather than with the engine that was its first
 * caller. Three things now ask it and they must agree exactly: the engine, deciding which staged
 * files an entry is run against; the case runner, driving that same fan-out from a recorded world;
 * and the facts layer, reporting what a rule watches. A commit rule whose case exercised a
 * different scope test than its live rail would be a green case that is not evidence.
 */
export function inScope(scope: Scope, path: string): boolean {
  if (scope.on && !matchAny(path, scope.on)) return false;
  if (scope.ignore && matchAny(path, scope.ignore)) return false;
  return true;
}

/**
 * The grammar's keys, per entry type — the closed sets the load re-checks.
 *
 * They are listed here rather than derived from the interfaces because a type is gone at run time
 * and the load happens at run time. Adding a verb below without adding it here would build an
 * entry the load then refuses, which is a loud failure and the right one.
 */
export const GUARDRAIL_KEYS = [
  "at",
  "for",
  "on",
  "ignore",
  "check",
  "message",
  "disabled",
  "test",
  "description",
] as const;

export const BREADCRUMB_KEYS = [
  "at",
  "for",
  "on",
  "ignore",
  "text",
  "file",
  "disabled",
  "description",
] as const;

export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
export type BreadcrumbKey = (typeof BREADCRUMB_KEYS)[number];

// ── the sentence, and the keys it has already spoken ─────────────────────────
//
// `Spoken` is the phantom: it grows by one word per chain call, and every verb already in it is
// typed `never`, so saying it twice is not a call the compiler will make. It costs nothing at run
// time — the object underneath carries all nine methods and always did.

/**
 * A verb, until it is spoken.
 *
 * Exported because the override chain in packs.ts is the same trick over the same grammar, and a
 * second copy of these fifty characters is a second place for "may be said once" to stop being
 * true.
 */
export type Once<Spoken extends string, Key extends string, Verb> = Key extends Spoken ? never : Verb;

/** What `.on()` becomes once `.at(…)` has ruled every path out. The TEXT is the diagnostic. */
type DeadScope =
  "flow: every moment this entry fires at carries no path, so .on()/.ignore() would narrow nothing";

/**
 * `.on()` / `.ignore()`, or the refusal — the compile-time half of the dead-scope rule.
 *
 * A path scope is consulted only when the event names a path (`PATH_MOMENTS`), so an entry whose
 * every moment is `command`, `turn-end` or `session` and which nonetheless speaks `.on(…)` reads as
 * armed and narrows nothing — config that looks like a fence and is one line of decoration. The
 * engine's silence about it was the old engine's behaviour, kept deliberately until now.
 *
 * It is a WRONG-ARGUMENT refusal rather than a `never`, and that is the whole design: `never` gives
 * "this expression is not callable", which says nothing about why. A parameter typed as the message
 * puts the sentence itself in the diagnostic, where a reader is already looking.
 *
 * It can only fire when `.at(…)` was spoken FIRST — before that, `At` is the whole vocabulary and
 * every scope is live. Saying `.on(…)` above `.at(command)` is the same mistake with the words in
 * the other order, and the load's `dead-scope` refusal is what catches it. Both halves, always.
 */
type Scoping<At extends Moment, Verb, Scopable extends Moment = PathMoment> = [Extract<At, Scopable>] extends [never]
  ? (dead: DeadScope) => never
  : Verb;

/**
 * `.on(…)` / `.ignore(…)` as a call that takes at least one glob — the compile-time half of the
 * empty-scope rule.
 *
 * Not `(glob: string, ...more: string[])`, and that is the whole design: a shipped pack scopes with
 * `.on(...repo.files)`, a list whose length is the repo's to choose, and a spread of `string[]`
 * into a first-required parameter is refused whether the list is empty or not. So the call infers
 * the arguments it was given, and only the arguments KNOWN to be none — a literal `.on()` — land
 * on a required parameter that was not passed: tsc's arity error, whose "an argument for
 * 'atLeastOneGlob' was not provided" note is the advice. A spread list that turns out empty is the
 * load's `empty-scope` refusal to catch. Both halves, always.
 */
type Globs<Next> = <G extends readonly string[]>(...globs: G extends readonly [] ? [atLeastOneGlob: string] : G) => Next;

/** What the second form of a breadcrumb's prose becomes once the first was said. The TEXT is the diagnostic. */
type DoubleProse<Said extends string> =
  `flow: this breadcrumb already said .${Said}(…) — its note is exactly one of .text(…) and .file(…)`;

/**
 * `.text(…)` / `.file(…)`, or the refusal once the OTHER form was said — the compile-time half of
 * the double-prose rule. The same form said twice is `Once`'s job, not this one.
 *
 * A wrong-argument refusal rather than a `never`, for the reason `Scoping` gives: the sentence lands
 * in the diagnostic, on the line of the second form.
 */
type Prose<Spoken extends string, Other extends "text" | "file", Verb> = Other extends Spoken
  ? (both: DoubleProse<Other>) => never
  : Verb;

/** Anything a pack may file under an entry name. The one shape `definePack` walks. */
export interface Sentence<S extends EntrySpec = EntrySpec> {
  readonly spec: S;
}

/** A group of entries, or of groups — a pack may nest, and `git.node.versionIsSemver` is why. */
export interface EntryGroup {
  readonly [key: string]: Sentence | EntryGroup;
}

// The SECOND parameter is the moments already named, and it exists for one rule: `Scoping`. Until
// `.at(…)` is spoken it is the whole vocabulary, which is why a scope said first is always allowed.
export interface GuardrailSentence<Spoken extends GuardrailKey = never, At extends GuardrailMoment = GuardrailMoment>
  extends Sentence<GuardrailSpec> {
  readonly at: Once<
    Spoken,
    "at",
    <M extends GuardrailMoment[]>(...moments: M) => GuardrailSentence<Spoken | "at", M[number]>
  >;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => GuardrailSentence<Spoken | "for", At>>;
  readonly on: Once<Spoken, "on", Scoping<At, Globs<GuardrailSentence<Spoken | "on", At>>>>;
  readonly ignore: Once<Spoken, "ignore", Scoping<At, Globs<GuardrailSentence<Spoken | "ignore", At>>>>;
  readonly check: Once<Spoken, "check", (check: Check) => GuardrailSentence<Spoken | "check", At>>;
  readonly message: Once<Spoken, "message", (message: string) => GuardrailSentence<Spoken | "message", At>>;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => GuardrailSentence<Spoken | "disabled", At>>;
  readonly test: Once<Spoken, "test", (cases: Cases) => GuardrailSentence<Spoken | "test", At>>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => GuardrailSentence<Spoken | "description", At>
  >;
}

export interface BreadcrumbSentence<
  Spoken extends BreadcrumbKey = never,
  At extends BreadcrumbMoment = BreadcrumbMoment,
> extends Sentence<BreadcrumbSpec> {
  readonly at: Once<
    Spoken,
    "at",
    <M extends BreadcrumbMoment[]>(...moments: M) => BreadcrumbSentence<Spoken | "at", M[number]>
  >;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => BreadcrumbSentence<Spoken | "for", At>>;
  readonly on: Once<Spoken, "on", Scoping<At, Globs<BreadcrumbSentence<Spoken | "on", At>>, BriefScopeMoment>>;
  readonly ignore: Once<
    Spoken,
    "ignore",
    Scoping<At, Globs<BreadcrumbSentence<Spoken | "ignore", At>>, BriefScopeMoment>
  >;
  readonly text: Once<Spoken, "text", Prose<Spoken, "file", (text: string) => BreadcrumbSentence<Spoken | "text", At>>>;
  readonly file: Once<Spoken, "file", Prose<Spoken, "text", (path: string) => BreadcrumbSentence<Spoken | "file", At>>>;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => BreadcrumbSentence<Spoken | "disabled", At>>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => BreadcrumbSentence<Spoken | "description", At>
  >;
}

// ── completeness, as a type ──────────────────────────────────────────────────
//
// This is J1.3's compile-time half. `definePack` accepts `T & Complete<T>`: the first component
// infers the shape, the second checks it, and an incomplete sentence lands on a string literal
// whose TEXT is the diagnostic — which is why the error a reader gets names the missing verb
// instead of saying "not assignable to never".

type Missing<Spoken extends string, Required extends string> = Exclude<Required, Spoken>;

type NeverSaid<What extends string, Verb extends string> = Verb extends string
  ? `flow: this ${What} never said .${Verb}() — nothing defaults, so it is not an entry`
  : never;

/** A guardrail must say when it fires, what it asks, what it tells you, and what proves it. */
type GuardrailRequired = "at" | "check" | "message" | "test";

/** A breadcrumb must say when it shows, and carry its prose one of the two ways. */
type BreadcrumbProse = "flow: this breadcrumb has no prose — say .text(…) or .file(…)";

export type CompleteEntry<B> =
  B extends GuardrailSentence<infer S, infer _GuardrailAt>
    ? "disabled" extends S
      ? B
      : [Missing<S, GuardrailRequired>] extends [never]
        ? B
        : NeverSaid<"guardrail", Missing<S, GuardrailRequired>>
    : B extends BreadcrumbSentence<infer S, infer _BreadcrumbAt>
      ? "disabled" extends S
        ? B
        : [Missing<S, "at">] extends [never]
          ? "text" extends S
            ? B
            : "file" extends S
              ? B
              : BreadcrumbProse
          : NeverSaid<"breadcrumb", Missing<S, "at">>
      : B extends EntryGroup
        ? { readonly [K in keyof B]: CompleteEntry<B[K]> }
        : never;

// ── the builders ─────────────────────────────────────────────────────────────

/**
 * THE chain builder — every chain in this grammar, and there are three of them: a guardrail, a
 * breadcrumb, and an override.
 *
 * The three differ in only two ways, and both are arguments here: which keys they START from, and
 * how the accumulated keys are EXPOSED (a sentence shows them as `.spec`, an override wraps them
 * in its binding). What they must never differ in is the verbs themselves — that a second `.on()`
 * replaces nothing, that `.disabled()` records an empty reason rather than dropping it, that every
 * step returns a NEW object so a pack can build a family off a shared prefix. Each of those was
 * written twice for one commit, which is one commit longer than "one of the two copies is now
 * subtly different" needs.
 *
 * Which verbs a given caller may reach is a TYPE question and is answered entirely by the
 * interfaces above and in packs.ts — an override has no `.check` because its chain type does not
 * declare one, not because a different builder withheld it. That is the same reason this works
 * over an untyped record: the chain types are a PROJECTION of this one object, a shrinking subset
 * of eleven verbs, and no signature can describe that from the inside. The casts at each entry
 * point are the seam.
 */
export function chain<Exposed extends object>(
  spoken: Readonly<Record<string, unknown>>,
  expose: (spoken: Readonly<Record<string, unknown>>) => Exposed,
): Exposed {
  const next = (patch: Record<string, unknown>): Exposed => chain({ ...spoken, ...patch }, expose);
  return {
    ...expose(spoken),
    at: (...moments: string[]) => next({ at: moments }),
    for: (...categories: Category[]) => next({ for: categories }),
    on: (...globs: string[]) => next({ on: globs }),
    ignore: (...globs: string[]) => next({ ignore: globs }),
    check: (check: Check) => next({ check }),
    message: (message: string) => next({ message }),
    text: (text: string) => next({ text }),
    file: (file: string) => next({ file }),
    disabled: (reason?: string) => next({ disabled: reason === undefined ? {} : { reason } }),
    test: (test: Cases) => next({ test }),
    description: (description: string) => next({ description }),
  };
}

/** How a sentence exposes what it has spoken: as the entry spec itself. */
const asSpec = (spoken: Readonly<Record<string, unknown>>): Sentence => ({ spec: spoken as unknown as EntrySpec });

/** Open a guardrail sentence. It blocks; it must therefore say what it asks and what it proves. */
export function guardrail(): GuardrailSentence {
  return chain({ kind: "guardrail" }, asSpec) as unknown as GuardrailSentence;
}

/** Open a breadcrumb sentence. Breadcrumbs are data — no check, ever, and no rail to block. */
export function breadcrumb(): BreadcrumbSentence {
  return chain({ kind: "breadcrumb" }, asSpec) as unknown as BreadcrumbSentence;
}

/** Is this an entry rather than a group of them? What `definePack` walks a pack's tree with. */
export function isSentence(value: unknown): value is Sentence {
  const kind = held(held(value, "spec"), "kind");
  return kind === "guardrail" || kind === "breadcrumb";
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// PACKS — PACKS DEFINE, THE CONFIG BINDS. Two verbs, and the overlay between them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A pack is just code: `definePack` over a tree of sentences, exported from a file in the repo or
// from an npm package, identical shape either way. Promotion is publishing — the body already IS
// a pack, so the only line that changes anywhere is the import path.
//
// flow.config.ts is the only file that turns anything on. Importing a pack does nothing; a
// `pack()` line binds it, entries and all, opt-out. `override(x.entry)` speaks only what it
// changes. If a rule is not reachable from that file, it does not run.
//
// TWO THINGS THIS FILE REFUSES TO BUILD, and they are the same thing twice:
//
//   No string routes. An entry is addressed by the property it was filed under —
//   `tdd.commitRunsTests`, `git.node.versionIsSemver` — because entry names are identifiers. One
//   spelling from definition to log line, no second naming scheme, and no resolver with ambiguity
//   rules to get wrong.
//
//   No reaching inside a check. An override moves an entry, rewords it or switches it off.
//   Anything a repo may VARY is a parameter the pack declared, with a type, in one place, chosen
//   by the pack's author. The blind whole-replacement of a script's inputs is the class of
//   failure that produced twelve distinct load errors, and it is deleted rather than reported.
//
// PRECEDENCE, three rungs, top-down, nothing merges: the override beats the pack's sentence,
// which beats the parameter's default. A parameter default lives inside the factory closure, so
// by the time a sentence exists the bottom rung has already been spent — which is why `overlay`
// below has exactly two inputs and not three.


// ONE branding mechanism across this package: `Symbol.for`, never a string key and never a bare
// `Symbol()`. It matters more here than anywhere else in flow, because a pack's entries ARE its
// properties — `tdd.id` and `tdd.pack` are entry names somebody will want one day, and a brand
// that occupies a spellable name takes one away. The registry form (`.for`) rather than a
// per-module symbol, so two copies of flow in one node_modules tree still recognise each other's
// packs; a private symbol would make that failure invisible and unexplainable.
//
// The same mechanism holds `CATEGORY` in categories.ts. Two mechanisms is two answers to "is this
// really one of ours", and one of them is always the one nobody updated.
const PACK = Symbol.for("flow.pack");
const REF = Symbol.for("flow.ref");
/** Phantoms: typed, never present at run time. They exist so a call site can be refused. */
const PARAMS = Symbol.for("flow.params");
const KIND = Symbol.for("flow.kind");

// ── what a pack IS ───────────────────────────────────────────────────────────

/** A pack's definition — its name, and how to build its entries. */
export interface PackDefinition {
  readonly name: string;
  /** Build the entry tree. A pack that takes no parameters ignores the argument. */
  readonly build: (params: unknown) => EntryGroup;
  /**
   * Does this pack REQUIRE parameters? Measured from the factory's arity, so a factory whose
   * parameter has a default — `(repo: Doors = {}) => …`, every field optional — is a pack
   * `pack(docs)` may bind, exactly as the compiler already allows.
   */
  readonly takesParams: boolean;
}

/** Where a reference points. Flat: the pack's name, and the entry's dotted path within it. */
export interface RefTarget {
  readonly pack: string;
  readonly id: string;
}

/**
 * A typed reference to one entry.
 *
 * `Kind` is a phantom — nothing carries it at run time, because a parameterised pack's tree does
 * not exist until it is bound and a reference has to be writable before that. What it buys is the
 * whole point of references being typed: `override()` knows whether it is looking at a guardrail
 * or a breadcrumb, so `.message()` on a breadcrumb and `.text()` on a guardrail are refused where
 * you type them rather than at a load nobody watches.
 */
export interface EntryRef<Kind extends EntrySpec["kind"] = EntrySpec["kind"]> {
  readonly [REF]: RefTarget;
  readonly [KIND]?: Kind;
}

/** The reference tree a pack presents — the same shape as the entries, refs at the leaves. */
export type Refs<T> = {
  readonly [K in keyof T]: T[K] extends Sentence<GuardrailSpec>
    ? EntryRef<"guardrail">
    : T[K] extends Sentence<BreadcrumbSpec>
      ? EntryRef<"breadcrumb">
      : T[K] extends EntryGroup
        ? Refs<T[K]>
        : never;
};

interface PackHandle<Params> {
  readonly [PACK]: PackDefinition;
  /** Phantom. It exists so `pack(tdd)` without parameters is not a call the compiler will make. */
  readonly [PARAMS]?: Params;
}

/** What `definePack` hands back: the reference tree, with the definition riding underneath it. */
export type Pack<T extends EntryGroup, Params = undefined> = Refs<T> & PackHandle<Params>;

// ── the config's sentences ───────────────────────────────────────────────────

export interface PackBinding {
  readonly kind: "pack";
  /** `undefined` when the bound value was never a pack — what the load's `not-a-pack` reads. */
  readonly pack: PackDefinition | undefined;
  readonly params: unknown;
  /** Were parameters supplied at all? The load's coarse backstop behind the compiler's fine one. */
  readonly hasParams: boolean;
}

export interface OverrideBinding {
  readonly kind: "override";
  readonly ref: RefTarget;
  /** ONLY the keys the chain spoke. An absent key here is one that flows through from the pack. */
  readonly spoken: Readonly<Record<string, unknown>>;
}

export type Binding = PackBinding | OverrideBinding;

/**
 * The engine's dials — the few numbers that are about the RUN rather than about any one entry.
 *
 * It is deliberately not part of the sentence grammar, and `defineConfig`'s second argument is
 * where it goes. `driftTokens` is the clearest example of why: how far a session may drift before
 * a breadcrumb shows again is one answer for the whole repo, and putting it on entries would make
 * every breadcrumb restate it or inherit it silently. The grammar stays closed; this is a knob.
 */
export interface Settings {
  /** Context tokens between re-showings of a breadcrumb. Absent = the engine's own default. */
  readonly driftTokens?: number;
  /**
   * Grammars this repo built itself, for `astGrep` rules whose language has no published package.
   *
   * ast-grep parses five languages out of the box and resolves anything else as an
   * `@ast-grep/lang-<name>` package. A grammar that nobody publishes — astro, vue, svelte — has no
   * third route unless a repo can hand over the tree-sitter library it built, which is what this is.
   * Declared here rather than on the entry because a grammar is a fact about the MACHINE the guard
   * runs on, not about any one rule: two rules on the same language must never be able to resolve
   * it two ways.
   */
  readonly grammars?: readonly Grammar[];
  /**
   * Globs for the IGNORED paths the snapshot records as well. The snapshot is git's view of the
   * tree — tracked files, and untracked ones git does not ignore — so a shell write to an ignored
   * file is never seen unless a glob here brings it back. `.env` is the usual one.
   */
  readonly snapshotInclude?: readonly string[];
  /**
   * What is put back when a rule refuses a write that has already landed: `"refused"` (the default)
   * writes back only the files a rule refused, `"all"` every file that call changed. While another
   * agent's call overlaps it, only the refused files are put back whatever this says — that call's
   * writes can be in the same diff.
   */
  readonly revert?: "refused" | "all";
}

/**
 * One hand-built tree-sitter grammar, as `registerDynamicLanguage` wants it.
 *
 * `libraryPath` is a path to a compiled library (`.so` / `.dylib`), relative to the repo root or
 * absolute. It is a BUILD ARTEFACT — machine-specific, never committed — so a repo declaring one
 * carries the recipe that builds it, and the refusal when it is missing names that file.
 */
export interface Grammar {
  /** The name an `astGrep` rule spells as its `language`. */
  readonly name: string;
  /** The compiled tree-sitter library, relative to the repo root or absolute. */
  readonly libraryPath: string;
  /** The file extensions the grammar is for — ast-grep wants them, and they document the rule's reach. */
  readonly extensions: readonly string[];
  /** The symbol inside the library. Defaults to ast-grep's own `tree_sitter_<name>`. */
  readonly languageSymbol?: string;
}

/** A whole guard, as its config file states it: bindings, in the order they were spoken. */
export interface FlowConfig {
  readonly bindings: readonly Binding[];
  readonly settings: Settings;
}

// ── definePack ───────────────────────────────────────────────────────────────

/**
 * Declare a pack: a name, and its entries.
 *
 * The entries argument is `T & CompleteEntry<T>` — the first half infers the tree, the second
 * checks every sentence in it. An incomplete one lands on a string literal whose text names the
 * verb it never said, so the editor's error is the instruction.
 */
export function definePack<T extends EntryGroup>(name: string, entries: T & CompleteEntry<T>): Pack<T>;
export function definePack<Params, T extends EntryGroup>(
  name: string,
  factory: (params: Params) => T & CompleteEntry<T>,
): Pack<T, Params>;
export function definePack(
  name: string,
  entries: EntryGroup | ((params: never) => EntryGroup),
): Pack<EntryGroup, never> {
  // ARITY, not "is a function": a parameter with a default does not count toward `length`, so a
  // pack whose parameters are ALL optional stays bindable as `pack(x)`. Measured any other way, a
  // pack that gains its first optional parameter refuses every config that already bound it — at
  // load, which takes that repo's whole guard down over a default nobody changed.
  const takesParams = typeof entries === "function" && entries.length > 0;
  const build = (params: unknown): EntryGroup =>
    typeof entries === "function" ? entries(params as never) : entries;
  return refProxy(name, [], { name, build, takesParams }) as Pack<EntryGroup, never>;
}

// One proxy serves both jobs a pack value has: it IS the reference tree, and it CARRIES the
// definition. Lazy by necessity — a parameterised pack's entries do not exist until a `pack()`
// line supplies the parameters, and `override(tdd.commitRunsTests)` has to be writable before
// that. So a property access never asks the tree anything; it just gets longer, and whether the
// path it built names a real entry is settled at load.
function refProxy(packName: string, path: readonly string[], definition?: PackDefinition): object {
  const target: Record<string | symbol, unknown> = { [REF]: { pack: packName, id: path.join(".") } };
  if (definition) target[PACK] = definition;
  return new Proxy(target, {
    get(t, key) {
      // The brands answer from the target; a string key that is not one of them is the next
      // segment of a path; an unknown SYMBOL is nothing — which is what keeps a ref from
      // accidentally looking thenable, inspectable, or iterable to code that probes for those.
      if (key in t) return t[key];
      return typeof key === "string" ? refProxy(packName, [...path, key]) : undefined;
    },
  });
}

/** The definition riding under a pack value, or undefined if this was never made by definePack. */
export function packDefinition(value: unknown): PackDefinition | undefined {
  const definition = held(value, PACK);
  return isPackDefinition(definition) ? definition : undefined;
}

function isPackDefinition(value: unknown): value is PackDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PackDefinition).name === "string" &&
    typeof (value as PackDefinition).build === "function"
  );
}

/** Where a reference points, or undefined if this was never a reference. */
export function refTarget(value: unknown): RefTarget | undefined {
  const target = held(value, REF);
  const packName = held(target, "pack");
  const id = held(target, "id");
  return typeof packName === "string" && typeof id === "string" ? { pack: packName, id } : undefined;
}

// ── pack() ───────────────────────────────────────────────────────────────────

/**
 * Bind a pack — all its entries, opt-out.
 *
 * ONE signature, not two overloads, and the reason is the error message. A pack that declares no
 * parameters carries `Params = undefined`, and the rest-tuple below then resolves to `[]` — so
 * `pack(node)` is a complete call. A pack that DOES declare them infers its own parameter type,
 * the tuple gains a required member, and `pack(tdd)` is short an argument: "Expected 2 arguments,
 * but got 1", at the line you typed. Two overloads produced the same refusal wearing a diagnostic
 * about a phantom property, which was true and unreadable.
 */
export function pack<T extends EntryGroup, Params>(
  definition: Pack<T, Params>,
  // OPTIONAL when the pack's own parameter is: `undefined extends Params` is true both for a pack
  // that declares none and for one whose every field has a default, and the two want different
  // things — the first may be given nothing, the second may be given nothing OR its object. A bare
  // `[]` here made an all-optional pack impossible to configure at all.
  ...params: undefined extends Params ? [params?: Params] : [params: Params]
): PackBinding;
export function pack(definition: object, ...params: readonly unknown[]): PackBinding {
  // A value that is not a pack still produces a binding, holding nothing. Refusing here would
  // mean throwing from pure code and losing every OTHER fault in the file; the load collects them
  // all and reports them together.
  return {
    kind: "pack",
    pack: packDefinition(definition),
    params: params[0],
    hasParams: params.length > 0,
  };
}

// ── override() ───────────────────────────────────────────────────────────────

/**
 * What an override may speak: BOTH entry grammars, minus the two verbs it must never reach.
 *
 * Derived rather than listed, and the subtraction is the whole statement — "an override moves an
 * entry, rewords it or switches it off, and can never touch what the entry ASKS" is said once,
 * here, in a form that cannot drift from the key sets it is subtracting from. A third hand-typed
 * listing of the grammar would be a third place to forget a verb.
 */
type OverrideKey = Exclude<GuardrailKey | BreadcrumbKey, "check" | "test">;

interface OverrideChain<Kind extends EntrySpec["kind"], Spoken extends OverrideKey> {
  readonly binding: OverrideBinding;
  readonly at: Once<
    Spoken,
    "at",
    (
      ...moments: (Kind extends "guardrail" ? GuardrailMoment : BreadcrumbMoment)[]
    ) => OverrideChain<Kind, Spoken | "at">
  >;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => OverrideChain<Kind, Spoken | "for">>;
  readonly on: Once<Spoken, "on", Globs<OverrideChain<Kind, Spoken | "on">>>;
  readonly ignore: Once<Spoken, "ignore", Globs<OverrideChain<Kind, Spoken | "ignore">>>;
  readonly message: Kind extends "guardrail"
    ? Once<Spoken, "message", (message: string) => OverrideChain<Kind, Spoken | "message">>
    : never;
  readonly text: Kind extends "breadcrumb"
    ? Once<Spoken, "text", Prose<Spoken, "file", (text: string) => OverrideChain<Kind, Spoken | "text">>>
    : never;
  readonly file: Kind extends "breadcrumb"
    ? Once<Spoken, "file", Prose<Spoken, "text", (path: string) => OverrideChain<Kind, Spoken | "file">>>
    : never;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => OverrideChain<Kind, Spoken | "disabled">>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => OverrideChain<Kind, Spoken | "description">
  >;
}

/**
 * Override one entry, speaking only what changes.
 *
 * There is no `.check()` and no `.test()` here, and their absence is the design: an override can
 * move an entry, reword it or switch it off, but it can never reach inside what the entry ASKS.
 */
export function override<Kind extends EntrySpec["kind"]>(ref: EntryRef<Kind>): OverrideChain<Kind, never> {
  const target = refTarget(ref) ?? { pack: "", id: "" };
  // The same chain builder every sentence uses (entries.ts). All that differs is how the spoken
  // keys are exposed — a sentence shows them as `.spec`, an override wraps them in its binding.
  return chain({}, (spoken): { binding: OverrideBinding } => ({
    binding: { kind: "override", ref: target, spoken },
  })) as unknown as OverrideChain<Kind, never>;
}

// ── defineConfig ─────────────────────────────────────────────────────────────

/** Anything a config line may be: a pack binding, or an override chain at any point in its chain. */
export type ConfigSentence = PackBinding | { readonly binding: OverrideBinding };

/**
 * The config: the sentences, in order, and the engine's dials.
 *
 * It records and does not judge. Every refusal lives in `loadConfig` instead, for one reason —
 * a config with three mistakes should report three, and a function that threw on the first would
 * report one and hide the rest behind a fix.
 *
 * The settings argument is OPTIONAL and trailing, which is the shape F1 promised it: `driftTokens`
 * is an engine number and the engine did not exist yet, so the grammar was closed without it and
 * left room for exactly this. A config that sets nothing writes `defineConfig([…])` as before.
 */
export function defineConfig(sentences: readonly ConfigSentence[], settings: Settings = {}): FlowConfig {
  return {
    bindings: sentences.map((s) => ("binding" in s ? s.binding : s)),
    settings,
  };
}

// ── the overlay ──────────────────────────────────────────────────────────────

/** An effective entry, and where each of its keys came from. */
export interface Overlaid {
  readonly spec: EntrySpec;
  readonly source: Readonly<Record<string, "pack" | "override">>;
}

/**
 * Lay an override's spoken keys over a definition, and record where every key came from.
 *
 * A named key replaces the WHOLE key — lists never merge, so an override that narrows one glob
 * restates the others. That is deliberate: two merge semantics is two bugs, and it is the same
 * replacement rule the YAML shadows had, kept.
 *
 * THE ONLY place a source map is built, including the first one: an entry with no override at all
 * is `overlay(spec, {})`, not a second loop somewhere else that agrees with this one until it
 * doesn't. `prior` is what makes that true for the second override onto one entry as well —
 * without it, laying anything over an already-overridden entry would relabel the earlier
 * override's keys as the pack's.
 */
export function overlay(
  base: EntrySpec,
  spoken: Readonly<Record<string, unknown>>,
  prior?: Readonly<Record<string, "pack" | "override">>,
): Overlaid {
  // A breadcrumb's prose is ONE key said in two forms, so an override that says either form
  // replaces whichever the pack used, rather than landing beside it as a note with both.
  const isProse = (key: string) => key === "text" || key === "file";
  const kept = Object.keys(spoken).some(isProse)
    ? Object.fromEntries(Object.entries(base).filter(([key]) => !isProse(key)))
    : base;
  const source: Record<string, "pack" | "override"> = {};
  for (const key of Object.keys(kept)) source[key] = prior?.[key] ?? "pack";
  for (const key of Object.keys(spoken)) source[key] = "override";
  return { spec: { ...kept, ...spoken } as EntrySpec, source };
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LOAD — bindings in, the effective regime out, or every refusal
// ════════════════════════════════════════════════════════════════════════════════════════════════

// This is the backstop, not the front door. The front door is the compiler: a config is
// TypeScript, so a wrong key is a method that does not exist, a missing parameter is an argument
// the call demands, and a moment typo is an unresolved import — all of it red in the editor, at
// the line you typed. What arrives HERE is a config that reached a loader without an editor in
// the way: generated, hand-edited, `as`-cast past the types, or built by an agent that guessed.
//
// Every class of grammar misuse gets a NAMED refusal carrying the entry it is about, because that
// text is what every gated moment answers with while the config will not load: the live hook rail
// passes it to the agent with each call, and the commit gate refuses with it (F3). A refusal an
// agent cannot act on is a commit gate that stays shut.
//
// It COLLECTS rather than stops. A config with three mistakes reports three: stopping at the
// first means three fix-and-rerun cycles, and the second mistake is usually the informative one.
// That is also why nothing here throws — refusals are values, and the shell that wants an
// exception makes one out of them.


/** The closed vocabulary of refusals. Every load failure is exactly one of these. */
export const REFUSAL_CODES = [
  "not-a-pack",
  "missing-parameter",
  "unknown-entry",
  "unknown-key",
  "unknown-moment",
  "missing-mandatory",
  "undeclared-category",
  "no-block-cases",
  "duplicate-id",
  "dead-scope",
  "bad-check-options",
  "empty-scope",
  "double-prose",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** One reason the config will not load. */
export interface Refusal {
  readonly code: RefusalCode;
  /** What it is about: `pack.entry`, or the pack alone when no entry is named. */
  readonly entry: string;
  /** The sentence a reader acts on. It always names the entry, because a hook shows one line. */
  readonly detail: string;
}

/** One entry as the engine will run it: the pack's sentence, with every override laid over it. */
export interface LoadedEntry {
  /** `pack.id` — one spelling from definition to log line. */
  readonly id: string;
  readonly pack: string;
  /** The entry's dotted path within its pack. */
  readonly key: string;
  readonly spec: EntrySpec;
  /** Where each key came from — what `flow status` prints when it explains an entry. */
  readonly source: Readonly<Record<string, "pack" | "override">>;
  /** The categories this entry is scoped to. Empty means every category. */
  readonly categories: readonly string[];
  /** The engine phases this entry fires at. Empty for a breadcrumb, which has no rail. */
  readonly phases: readonly string[];
  /**
   * The options this entry's check was configured with, RESOLVED — what a parameter supplied, not
   * what the source typed. `undefined` for a breadcrumb, and for a check that never came through
   * `defineCheck`. Nothing in the run reads it; it is how a reader is told what a rule watches.
   */
  readonly settings?: unknown;
}

export type LoadResult =
  | { readonly ok: true; readonly entries: readonly LoadedEntry[] }
  | { readonly ok: false; readonly refusals: readonly Refusal[] };

/**
 * Every refusal as ONE block of text — the sentence a person reads when the config will not load.
 *
 * There is exactly one wording, here, because there are three places it surfaces and they must not
 * drift: the `flow test` exception (errors.ts), the block a gated moment refuses with, and the
 * notice a breadcrumb moment degrades to. A guard that describes its own breakage differently
 * depending on which rail you hit is a guard nobody learns to read.
 */
export function refusalText(refusals: readonly Refusal[]): string {
  return [
    `flow: the config will not load — ${refusals.length} refusal${refusals.length === 1 ? "" : "s"}.`,
    ...refusals.map((r) => `  ${r.code}: ${r.detail}`),
  ].join("\n");
}

interface Draft {
  id: string;
  pack: string;
  key: string;
  spec: EntrySpec;
  source: Readonly<Record<string, "pack" | "override">>;
}

/** Turn a config's bindings into the effective regime, or into every reason it cannot be one. */
export function loadConfig(config: FlowConfig): LoadResult {
  const refusals: Refusal[] = [];
  const drafts: Draft[] = [];
  const seen = new Map<string, Draft>();

  // ── the pack bindings, in the order they were spoken ──
  for (const binding of config.bindings) {
    if (binding.kind !== "pack") continue;

    if (!binding.pack || binding.pack.name === "") {
      refusals.push({
        code: "not-a-pack",
        entry: "",
        detail:
          "A `pack(…)` line was given a value that no `definePack` ever made. Import the pack's default export, not one of its entries.",
      });
      continue;
    }

    const { name, build, takesParams } = binding.pack;
    if (takesParams && !binding.hasParams) {
      refusals.push({
        code: "missing-parameter",
        entry: name,
        detail: `The pack \`${name}\` declares parameters and was bound without any — write \`pack(${name}, { … })\`. Which fields it needs is stated by its factory's type.`,
      });
      continue;
    }

    for (const { key, spec } of flatten(build(binding.params))) {
      // `overlay(spec, {})` rather than a source loop of its own: an entry with no override is
      // the same operation with nothing laid over it, and overlay is the one place a source map
      // is built.
      const draft: Draft = { id: `${name}.${key}`, pack: name, key, ...overlay(spec, {}) };
      const clash = seen.get(draft.id);
      if (clash) {
        refusals.push({
          code: "duplicate-id",
          entry: draft.id,
          detail: `Two entries claim the id \`${draft.id}\`. An id is its property name inside its pack, so this is one pack bound twice, or two packs sharing a name.`,
        });
        continue;
      }
      seen.set(draft.id, draft);
      drafts.push(draft);
    }
  }

  // ── the overrides, resolved against everything bound ──
  //
  // After the packs rather than in line with them, so a config may speak an override above the
  // `pack()` line it refines. Reading order is the author's business; resolution order is not.
  for (const binding of config.bindings) {
    if (binding.kind !== "override") continue;
    const id = `${binding.ref.pack}.${binding.ref.id}`;
    const draft = seen.get(id);
    if (!draft) {
      refusals.push({
        code: "unknown-entry",
        entry: id,
        detail: `\`override(${id})\` names an entry no bound pack has. Bind the pack it lives in, or correct the reference.`,
      });
      continue;
    }
    const laid = overlay(draft.spec, binding.spoken, draft.source);
    draft.spec = laid.spec;
    draft.source = laid.source;
  }

  // ── every entry, judged once, in its final shape ──
  for (const draft of drafts) refusals.push(...judge(draft));

  if (refusals.length > 0) return { ok: false, refusals };
  return {
    ok: true,
    entries: drafts.map((d) => ({
      id: d.id,
      pack: d.pack,
      key: d.key,
      spec: d.spec,
      source: d.source,
      categories: (d.spec.for ?? []).map((c) => c.name),
      phases: d.spec.kind === "guardrail" ? phasesOf(d.spec.at ?? []) : [],
      settings: d.spec.kind === "guardrail" ? checkSettings(d.spec.check) : undefined,
    })),
  };
}

/**
 * Walk a pack's tree to its entries, dotting the path as it goes.
 *
 * It takes an untyped record rather than `EntryGroup`, and that is not laziness: the type says
 * every leaf is a sentence or a group, and this function is one of the places that exists BECAUSE
 * a config may have reached here without a compiler agreeing. A guard the types have already
 * proved is a guard that will be deleted the day the types are wrong.
 */
function flatten(group: Readonly<Record<string, unknown>>, path: readonly string[] = []): Found[] {
  const out: Found[] = [];
  for (const [name, value] of Object.entries(group)) {
    if (isSentence(value)) out.push({ key: [...path, name].join("."), spec: value.spec });
    else if (typeof value === "object" && value !== null)
      out.push(...flatten(value as Record<string, unknown>, [...path, name]));
  }
  return out;
}

interface Found {
  key: string;
  spec: EntrySpec;
}

/** Every fault in one entry, so a reader fixes them together. */
function judge(draft: Draft): Refusal[] {
  const { id, spec } = draft;
  const out: Refusal[] = [];
  const say = (code: RefusalCode, detail: string) => out.push({ code, entry: id, detail });

  const allowed: readonly string[] = spec.kind === "guardrail" ? GUARDRAIL_KEYS : BREADCRUMB_KEYS;
  const extra = Object.keys(spec).filter((k) => k !== "kind" && !allowed.includes(k));
  if (extra.length > 0)
    say(
      "unknown-key",
      `\`${id}\` carries ${extra.map((k) => `\`${k}\``).join(", ")}, which the ${spec.kind} grammar does not have. It is closed: ${allowed.join(" · ")}.`,
    );

  const at: readonly string[] = spec.at ?? [];
  const legal = spec.kind === "guardrail" ? isGuardrailMoment : isBreadcrumbMoment;
  const wrong = at.filter((m) => !legal(m));
  if (wrong.length > 0)
    say(
      "unknown-moment",
      `\`${id}\` fires at ${wrong.map((m) => `\`${m}\``).join(", ")}, which is not a moment a ${spec.kind} has a rail for.`,
    );

  const strayCategory = (spec.for ?? []).some((c) => !isCategory(c));
  if (strayCategory)
    say(
      "undeclared-category",
      `\`${id}\` is scoped with \`.for(…)\` to something \`defineCategory\` never made. A category is a value with its recognizer aboard — import the one you mean.`,
    );

  // A SCOPE WITH NO GLOBS. `.on()` matches no path and `.ignore()` carves out nothing, so either
  // one is a sentence that reads as a decision and decides nothing. Before the disabled exemption
  // on purpose: an empty scope is a mistake in what was written, not something the entry proves.
  const empty = (["on", "ignore"] as const).filter((key) => spec[key]?.length === 0);
  if (empty.length > 0) {
    // Who said each one is decided per key: one verb may be the pack's and the other an override's,
    // so the verbs are grouped by who said them and each group gets its own clause and its own fix.
    // `overlay` gives every key of the spec a source, so each empty verb lands in exactly one group.
    const said = (["pack", "override"] as const)
      .map((who) => ({ who, keys: empty.filter((key) => draft.source[key] === who) }))
      .filter((group) => group.keys.length > 0);
    const verbs = (keys: readonly string[]) => keys.map((key) => `\`.${key}()\``).join(" and ");
    const place = {
      pack: { speaker: "its pack", fixIn: "the pack" },
      override: { speaker: "an override", fixIn: "the override" },
    } as const;
    const fix = ({ who, keys }: (typeof said)[number]) =>
      keys.length === 1
        ? `In ${place[who].fixIn}, give ${verbs(keys)} at least one glob or delete it.`
        : `In ${place[who].fixIn}, give ${verbs(keys)} each at least one glob or delete them.`;
    say(
      "empty-scope",
      `\`${id}\` has a scope that narrows nothing: ${said.map(({ who, keys }) => `${place[who].speaker} says ${verbs(keys)} with no globs`).join(", and ")}. ${said.map(fix).join(" ")}`,
    );
  }

  // PROSE SAID TWICE. A note shows one text, so a breadcrumb with both forms is a note whose author
  // has not decided which one it is. An override's prose replaces the pack's (overlay), so what
  // reaches here is one sentence, or one override, that said both.
  if (spec.kind === "breadcrumb" && spec.text !== undefined && spec.file !== undefined)
    say(
      "double-prose",
      `\`${id}\` says both \`.text(…)\` and \`.file(…)\`. A breadcrumb's note is exactly one of the two — keep the one you mean and drop the other.`,
    );

  // A disabled entry is listed with its reason and never runs, so it is asked to prove nothing.
  // That is not a hole: what it says is already inert, and demanding a message and cases from an
  // entry somebody turned off is how an opt-out becomes cheaper to delete than to explain.
  if (spec.disabled) return out;

  const missing: string[] = [];
  if (at.length === 0) missing.push(".at(…)");
  if (spec.kind === "guardrail") {
    if (!spec.check) missing.push(".check(…)");
    if (spec.message === undefined) missing.push(".message(…)");
  } else if (spec.text === undefined && spec.file === undefined) {
    missing.push(".text(…) or .file(…)");
  }
  if (missing.length > 0)
    say(
      "missing-mandatory",
      `\`${id}\` never said ${missing.join(" and ")}. Nothing in this grammar defaults — an absent key is absent, not a fallback.`,
    );

  // A SCOPE THAT NARROWS NOTHING. `on` / `ignore` are consulted only when the event names a path,
  // so an entry firing only at `command`, `turn-end` or `session` and speaking one of them reads as
  // a fence and is decoration. The sentence types refuse it where the moments were named first;
  // this catches the other word order, and every config built outside an editor.
  const scoped = (spec.on?.length ?? 0) > 0 || (spec.ignore?.length ?? 0) > 0;
  if (scoped && at.length > 0 && !at.some((m) => isScopable(spec.kind, m)))
    say(
      "dead-scope",
      `\`${id}\` narrows by path but fires only at ${at.map((m) => `\`${m}\``).join(", ")}, which name no subject to narrow — its \`on\`/\`ignore\` would be read by nothing. Drop the scope, or add a moment that carries one (${(spec.kind === "breadcrumb" ? BRIEF_SCOPE_MOMENTS : PATH_MOMENTS).join(" · ")}).`,
    );

  // NO BLOCK CASE. Pass cases alone prove nothing about what the rule catches, so a guardrail
  // without a block case does not load, however many pass cases it has.
  if (spec.kind === "guardrail" && (spec.test?.block?.length ?? 0) === 0)
    say(
      "no-block-cases",
      `\`${id}\` has no block case. A block case is an input the rule must refuse: add one to \`.test({ block })\`. Pass cases alone prove nothing about what the rule catches.`,
    );

  // A CHECK THAT SAID ITS OWN OPTIONS ARE UNUSABLE. The check answers this, not the loader: what
  // makes an option nonsense is the check's own knowledge, and a loader that judged it would be a
  // second place every stock check's contract is written down.
  for (const fault of faultsOf(spec.kind === "guardrail" ? spec.check : undefined))
    say("bad-check-options", `\`${id}\` ${fault}`);

  return out;
}
