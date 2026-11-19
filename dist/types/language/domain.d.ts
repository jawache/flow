declare const PHASES: {
    readonly command: readonly ["edit", "commit"];
    readonly commit: readonly ["commit"];
    readonly "turn-end": readonly ["turn"];
};
/** The moments a guardrail may fire at — the keys of the one table above. */
export type GuardrailMoment = keyof typeof PHASES;
/** The moments a breadcrumb may show at. A breadcrumb is a note; it has no rail to block. */
export type BreadcrumbMoment = (typeof BREADCRUMB_MOMENTS)[number];
/** Either vocabulary. `turn-end` is the one word in both. */
export type Moment = GuardrailMoment | BreadcrumbMoment;
export declare const GUARDRAIL_MOMENTS: readonly GuardrailMoment[];
export declare const BREADCRUMB_MOMENTS: readonly ["session", "file-change", "command", "turn-end"];
export declare const command: "command";
export declare const commit: "commit";
export declare const turnEnd: "turn-end";
export declare const session: "session";
/** `fileChange` and `turnEnd` are spelled so because a symbol has no hyphen: the moments are called "file-change" and "turn-end". */
export declare const fileChange: "file-change";
/** The engine phases a moment list fires at — deduped, in declaration order. */
export declare function phasesOf(at: readonly GuardrailMoment[]): string[];
/** Is this string one of the guardrail words? The load's backstop, not the editor's job. */
export declare function isGuardrailMoment(m: string): m is GuardrailMoment;
/** Is this string one of the breadcrumb words? */
export declare function isBreadcrumbMoment(m: string): m is BreadcrumbMoment;
/**
 * The moments whose events NAME A PATH — and therefore the only ones `.on()` / `.ignore()` narrow.
 *
 * The commit gate carries the staged set; a file change carries each file the tool call changed. The
 * other three carry no path at all: a command guard's patterns ARE its scope, a turn-end is about
 * what the actor did, and a session start is about the session. The engine expresses the same fact
 * at run time — `subjectsOf` consults `inScope` for exactly these moments, and `brief` narrows a
 * note only when the event names a path — and stating it here is what lets a scope that would
 * narrow NOTHING be refused rather than quietly ignored.
 */
export declare const PATH_MOMENTS: readonly ["commit", "file-change"];
export type PathMoment = (typeof PATH_MOMENTS)[number];
/** Does this moment carry a path for `on` / `ignore` to narrow? */
export declare function isPathMoment(m: string): m is PathMoment;
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
export declare const BRIEF_SCOPE_MOMENTS: readonly ["commit", "file-change", "command"];
export type BriefScopeMoment = (typeof BRIEF_SCOPE_MOMENTS)[number];
/** Does a scope narrow anything for this KIND of entry at this moment? */
export declare function isScopable(kind: EntrySpec["kind"], m: string): boolean;
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
declare const CATEGORY: unique symbol;
/** Declare a category: a name, and the recognizer that travels with it. */
export declare function defineCategory(name: string, classify: Classifier): Category;
/** Was this made by `defineCategory`? The load's backstop behind `.for()`'s typing. */
export declare function isCategory(value: unknown): value is Category;
/** What `ctx.exec` answers. A diagnostic command's whole result, as data. */
export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
}
/** A check's answer. Never an action — the engine turns a fail into an effect. */
export type Verdict = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly detail?: string;
};
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
export type TurnAction = {
    readonly did: "edit";
    readonly path: string;
} | {
    readonly did: "run";
    readonly command: string;
};
/**
 * Everything a check may know and everything it may do.
 *
 * The facts are already in memory when the check runs — a command rail sees the line about to
 * run; the commit gate sees the staged paths and the message. That is what lets a repo's own check
 * name the file at fault instead of re-deriving the tree, and it makes the work scale with the
 * change rather than with the repo.
 */
export interface Ctx {
    readonly moment: Moment;
    /**
     * commit, for a rule with `.on(…)`: the file the call is about, as the commit holds it.
     *
     * `existed` says whether the last commit had a file at `path`: every staged file is on disk, so
     * `ctx.fs.exists(path)` answers yes to a file the commit adds, and "before" is the last commit.
     * Absent, git could not say.
     */
    readonly file?: {
        readonly path: string;
        readonly content: string;
        readonly existed?: boolean | undefined;
    } | undefined;
    /** command: the line about to run. */
    readonly command?: string | undefined;
    /**
     * command: that line parsed as bash — one entry per simple command, nested ones included, in
     * the order they appear. `null` when the line does not parse: read it as "cannot tell".
     */
    readonly commands?: readonly ShellCommand[] | null | undefined;
    /** commit: the staged paths. Empty under `flow hook commit --all`, which makes no commit. */
    readonly staged?: readonly string[] | undefined;
    /** commit: the staged paths the last commit does not have. Empty when git could not say, and under `--all`. */
    readonly added?: readonly string[] | undefined;
    /** commit: the paths the commit deletes. A rename is a deletion of the old path plus an add of the new one. */
    readonly deleted?: readonly string[] | undefined;
    /**
     * commit: the message as git records it, comment lines and the scissors section removed. `null`
     * under `flow hook commit --all`, which has no commit, and for a hook an older flow wrote, which
     * runs before git has the message.
     */
    readonly message?: string | null | undefined;
    /** turn-end: what the actor did this turn, in order. */
    readonly turn?: readonly TurnAction[] | undefined;
    /**
     * Every moment: the category names that match the session making this change — the categories
     * some bound entry names, whose recognizer said yes to the host-written evidence about it. Empty
     * when it matches none, which is not "every category".
     */
    readonly actor: readonly string[];
    exec(cmd: string): Promise<ExecResult>;
    readonly fs: {
        read(path: string): Promise<string>;
        exists(path: string): Promise<boolean>;
    };
    readonly git: {
        diff(path?: string): Promise<string>;
        stagedFiles(): Promise<string[]>;
    };
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
export declare const verdict: {
    ok: () => Verdict;
    fail: (detail?: string) => Verdict;
};
/**
 * Everything a check may reach for beyond the event's own facts — the three capabilities, alone.
 *
 * Derived from `Ctx` rather than restated, so there is one description of what flow can reach and
 * no way to grow a fourth capability that a `.test()` case has no means of recording.
 */
export type World = Pick<Ctx, "exec" | "fs" | "git">;
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
/** One redirect on a command: its operator (`>`, `>>`, `<`, `2>&1`'s `>&` …) and its target word, a variable the line sets filled in. */
export interface ShellRedirect {
    readonly operator: string;
    readonly target: string;
}
/** One simple command in a parsed line — the fields docs/user/reference/ctx.md promises. */
export interface ShellCommand {
    /** The program that runs, after any `FOO=1` assignment and any wrapper, a variable the line sets filled in. */
    readonly program: string;
    /**
     * Its arguments as the program receives them, quotes removed: a variable the line sets is its
     * value, an unquoted one split at its spaces, and one set elsewhere stays as written (`$TMPDIR/x`).
     */
    readonly args: readonly string[];
    /** `program` and `args` joined by single spaces. */
    readonly text: string;
    readonly heredocs: readonly ShellHeredoc[];
    /** What the shell runs while building this command's arguments and unquoted heredocs. */
    readonly substitutions: readonly ShellSubstitution[];
    /** Its redirects, and those of every group or loop it sits in. A heredoc or here-string is not one. */
    readonly redirects: readonly ShellRedirect[];
    /**
     * The folder it runs in: where the line started, moved by each `cd`, `pushd` and `popd` before it
     * and by its own `git -C`. Absolute when the start is known; for a line whose start is not, as in
     * a case, relative to it — `.` for the start itself, `../other` after `cd ../other`. Null when only
     * running the line could tell, such as after `cd "$(mktemp -d)"` or `cd "$DIR"`, and for a git
     * command that names its repository itself, with `--git-dir`, `--work-tree`, `GIT_DIR` or `GIT_WORK_TREE`.
     */
    readonly folder: string | null;
    /** Inside a substitution, a `<( … )`, a `bash -c` or `eval` string, or a heredoc or here-string fed to a shell. */
    readonly nested: boolean;
}
/**
 * One piece of a word as the line writes it: text the shell passes as is (quoted, escaped or plain),
 * a variable it expands (`$NAME`, `${NAME}`), a leading unquoted `~`, or something only running
 * the line could tell — a substitution, a special parameter, a `${…}` with an operation in it.
 */
export type ShellWordPiece = {
    readonly kind: "text";
    readonly text: string;
}
/** `quoted` inside double quotes, where the shell does not split its value into words. */
 | {
    readonly kind: "variable";
    readonly name: string;
    readonly quoted: boolean;
} | {
    readonly kind: "tilde";
} | {
    readonly kind: "unknown";
};
/** A word as the line writes it, piece by piece, so a reader expands `$F` and leaves `'$F'` alone. */
export type ShellWord = readonly ShellWordPiece[];
/**
 * THE SAME PARSE, IN THE ORDER IT RUNS — for a reader that follows the line the way the shell does:
 * where a `cd` leaves it, what a variable the line set holds, what a `for` loop's body is given.
 * Not on ctx, and not public: `ctx.commands` is exactly these steps' commands (`stepCommands`), so
 * the two can never disagree about what a line runs.
 */
export type ShellStep = {
    readonly kind: "command";
    readonly command: ShellCommand;
    /**
     * Its words as written — wrappers first, no here-string — and where the program starts among
     * them: `words.slice(0, at)` are the wrappers stepped past (`xargs -a list …`), and the rest
     * are the program and the arguments it is given. A here-string's text is stdin, not a word.
     */
    readonly words: readonly ShellWord[];
    readonly at: number;
    /** The names of the `NAME=value` assignments in front of it, as its env: `FOO` for `FOO=1 rm`. Not one of its words. */
    readonly env: readonly string[];
    /** `command.redirects` with each target as written, so a reader expands `< $F` and leaves `< '$F'` alone. */
    readonly redirects: readonly StepRedirect[];
    /** The substitutions that build its words, which run before it does. */
    readonly before: readonly ShellStep[];
}
/**
 * `NAME=value` on its own, or as an argument of `export`, `declare`, `local`, `readonly` or
 * `typeset`, which sets a shell variable. In front of a command it is that command's env, and not a step.
 */
 | {
    readonly kind: "assign";
    readonly name: string;
    readonly value: ShellWord;
}
/** A subshell, a substitution, or a script handed to another shell: a `cd` or a variable set inside stays inside. */
 | {
    readonly kind: "scope";
    readonly body: readonly ShellStep[];
}
/**
 * `for name in values; do body; done`: the body runs once per value, so it is read once per value,
 * each turn its own copy: turn `i` runs with `values[i]`. `values` is empty when the line lists
 * none, and the body is then read once. Fewer turns than values is a loop past `LOOP_COPIES`: its
 * body is read once, and walked once with its variable as written.
 */
 | {
    readonly kind: "for";
    readonly name: string;
    readonly values: readonly ShellWord[];
    readonly turns: readonly (readonly ShellStep[])[];
};
/**
 * Every command in the steps, nested ones included, in the order they appear in the line: a
 * command before the commands its own substitutions run, which is the order `ctx.commands` keeps.
 */
export declare function stepCommands(steps: readonly ShellStep[]): ShellCommand[];
/** A redirect on a step: its operator, and its target as written. A redirect with no target has one unknown piece. */
export interface StepRedirect {
    readonly operator: string;
    readonly target: ShellWord;
}
/** Whether the program, without its path, is a wrapper the parse steps past to the program that runs. */
export declare function isWrapper(program: string): boolean;
/**
 * A program's name without its path, the ONE way flow reads it: `/usr/bin/git` and `git` are both
 * `git`. A word ending in `/` names a directory, and gives "".
 */
export declare function programName(program: string): string;
/** Where a line starts: the shell's folder, and what `~` and `$HOME` mean. */
export interface ShellStart {
    /** The folder the shell stands in when the line starts: absolute, or `.` when it is not known. */
    readonly cwd: string;
    /** What `~` and `$HOME` mean; absent, a path through them is not known. */
    readonly home?: string | undefined;
}
/** An option word — `-P`, `--x` — and not `-`, which is an operand: `cd -`, or stdin. */
export declare const isOption: (arg: string | null) => boolean;
/**
 * A path as the shell resolves it from `base`: an absolute one as given, a relative one only when
 * `base` is known. String arithmetic only — never the process's own folder — so a relative `base`
 * gives a relative answer: `../other` from `.`.
 */
export declare function resolveFrom(path: string, base: string | null): string | null;
/** One command step, as the walk hands it to a reader. */
type CommandStep = Extract<ShellStep, {
    kind: "command";
}>;
/**
 * Follow the steps as the shell runs them. `visit` is called on every command, after the
 * substitutions that build it and before its own move, with the folder the shell stands in then,
 * that scope's expansion of a word, whether the command moves the shell itself (`cd`, `pushd`,
 * `popd`), and that scope's expansion of a word into the arguments the shell passes for it. Each
 * turn of a `for` loop is followed with its own value, and is its own copy of the body, so every
 * command is visited once.
 */
export declare function followSteps(steps: readonly ShellStep[], start: ShellStart, visit: (step: CommandStep, cwd: string | null, expand: (word: ShellWord) => string | null, moves: boolean, fields: (word: ShellWord) => string[] | null) => void): void;
/**
 * Parse one shell command line as bash: every simple command in it, nested ones included, in the
 * order they appear — or `null` when the line, or any script nested inside it, does not parse.
 * Each command's `folder` is followed from `start`; with none, it is relative to where the line started.
 */
export declare function parseCommandLine(line: string, start?: ShellStart): ShellCommand[] | null;
/** The same parse as its steps, in the order the shell runs them — or `null` when it does not parse. */
export declare function parseShellSteps(line: string, start?: ShellStart): readonly ShellStep[] | null;
/**
 * git's own options that TAKE A VALUE, and therefore swallow the token after them.
 *
 * They have to be known by name to find where the subcommand starts: `git -C ~/repo commit -m x`
 * puts two tokens between `git` and `commit`, and a scan that took the first argument as the
 * subcommand saw `-C` and walked away. Knowing them by name is also what keeps `git commit -C
 * HEAD` — the reuse-this-message flag, nothing to do with directories — from reading as a command
 * aimed at a directory called HEAD.
 */
export declare const GIT_VALUE_OPTS: ReadonlySet<string>;
/** One `git` command in the parse, split where git's own options stop and its subcommand starts. */
export interface GitCommand {
    /** git's OWN options, before the subcommand — where `-C` counts and only there. */
    readonly globals: readonly string[];
    /** The subcommand word (`commit`, `status`), or null when the command carries none. */
    readonly subcommand: string | null;
    /** Everything after the subcommand — its own flags and arguments. */
    readonly args: readonly string[];
    /** Where `args` starts in `command.args`: `args[i]` is `command.args[argsAt + i]`. */
    readonly argsAt: number;
    /** The parsed command it was read from: its heredocs are what `git commit -F -` reads. */
    readonly command: ShellCommand;
}
/**
 * One parsed command read as git, or null when its program is not git. The parse has already
 * found the program, so a `git` inside a quoted message, a heredoc body or another command's
 * arguments is never one, and a `git` inside `$( … )` or a `bash -c` string is.
 */
export declare function gitCommand(command: ShellCommand): GitCommand | null;
/**
 * The line as written, less the body of every heredoc in it — the subject a `banCommands` rule
 * with `wholeLine` matches. The opener and the terminator line stay, and so does everything else,
 * newlines included. A heredoc a shell reads, directly or through a pipeline, holds commands, and
 * its body stays; so does a body inside a string the parse reads again (`bash -c`, `eval`), which
 * is part of that string. `null` when the line does not parse.
 */
export declare function elideHeredocBodies(line: string): string | null;
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
export declare function makeCtx(moment: Moment, facts: Partial<Ctx>, world: World): Ctx;
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
export declare function withFaults<C extends Check>(check: C, faults: readonly string[]): C;
/** What a configured check said is wrong with its own options. Empty for every healthy check. */
export declare function faultsOf(check: Check | undefined): readonly string[];
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
 * that cannot see them cannot say what a rule really watches. Read back through `settings` on
 * the loaded entry they are RESOLVED values: the globs a parameter supplied, the recipe a repo
 * named. Nothing in the run reads them — the engine calls the check and asks it nothing else — so
 * this cannot change what any rule decides.
 */
export declare function defineCheck<Options, C extends Check>(factory: (options: Options) => C): (options: Options) => C;
/**
 * The options a check was configured with, or `undefined` for one that never came through
 * `defineCheck` — an inline lambda in a sentence, or a bespoke `const x: Check = …`.
 */
export declare function checkSettings(check: Check | undefined): unknown;
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
    readonly exec?: Readonly<Record<string, {
        stdout?: string;
        stderr?: string;
        code?: number;
    }>>;
    /** Files `ctx.fs` can see, by path. A path not here does not exist. */
    readonly fs?: Readonly<Record<string, string>>;
    /** What `ctx.git.diff()` answers. */
    readonly gitDiff?: string;
    /** What `ctx.git.stagedFiles()` answers when the moment carried no staged set of its own. */
    readonly staged?: readonly string[];
}
/** What a commit case may say beside the files it stages and the message it carries. */
interface CommitCase {
    /** The staged paths the last commit does not have: it sets `ctx.added` and each file's `ctx.file.existed`. */
    readonly added?: readonly string[];
    /** The paths the commit deletes: it sets `ctx.deleted`. */
    readonly deleted?: readonly string[];
    /** The commit message, as git records it. A case with none has an empty one. */
    readonly message?: string;
    readonly world?: CaseWorld;
    readonly actor?: readonly string[];
}
/** One canned event, in the dialect its moment speaks. */
export type Case = 
/** A command rail, shorthand — by far the commonest case, and it should read as one line. */
string | {
    readonly command: string;
    readonly world?: CaseWorld;
    readonly actor?: readonly string[];
} | {
    readonly path: string;
    readonly content: string;
    /** The change landed before it was judged, as a shell command's does: `ctx.file.existed`. */
    readonly existed?: boolean;
    readonly world?: CaseWorld;
    readonly actor?: readonly string[];
} | ({
    readonly staged: readonly string[];
} & CommitCase) | ({
    readonly staged?: readonly string[] | undefined;
    readonly message: string;
} & CommitCase) | {
    readonly actions: readonly TurnAction[];
    readonly world?: CaseWorld;
    readonly actor?: readonly string[];
};
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
export declare function cannedWorld(recorded: CaseWorld, staged: readonly string[] | undefined, unanswered: Unanswered[]): World;
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
    /**
     * `.everywhere()`: the rule also judges work outside the repository. A guardrail's alone — a
     * breadcrumb is about this repository's files, and an override never says it.
     */
    readonly everywhere?: true;
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
export declare function inScope(scope: Scope, path: string): boolean;
/**
 * The grammar's keys, per entry type — the closed sets the load re-checks.
 *
 * They are listed here rather than derived from the interfaces because a type is gone at run time
 * and the load happens at run time. Adding a verb below without adding it here would build an
 * entry the load then refuses, which is a loud failure and the right one.
 */
export declare const GUARDRAIL_KEYS: readonly ["at", "for", "everywhere", "on", "ignore", "check", "message", "disabled", "test", "description"];
export declare const BREADCRUMB_KEYS: readonly ["at", "for", "on", "ignore", "text", "file", "disabled", "description"];
export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
export type BreadcrumbKey = (typeof BREADCRUMB_KEYS)[number];
/**
 * A verb, until it is spoken.
 *
 * Exported because the override chain in packs.ts is the same trick over the same grammar, and a
 * second copy of these fifty characters is a second place for "may be said once" to stop being
 * true.
 */
export type Once<Spoken extends string, Key extends string, Verb> = Key extends Spoken ? never : Verb;
/** What `.on()` becomes once `.at(…)` has ruled every path out. The TEXT is the diagnostic. */
type DeadScope = "flow: every moment this entry fires at carries no path, so .on()/.ignore() would narrow nothing";
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
type Scoping<At extends Moment, Verb, Scopable extends Moment = PathMoment> = [Extract<At, Scopable>] extends [never] ? (dead: DeadScope) => never : Verb;
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
type DoubleProse<Said extends string> = `flow: this breadcrumb already said .${Said}(…) — its note is exactly one of .text(…) and .file(…)`;
/**
 * `.text(…)` / `.file(…)`, or the refusal once the OTHER form was said — the compile-time half of
 * the double-prose rule. The same form said twice is `Once`'s job, not this one.
 *
 * A wrong-argument refusal rather than a `never`, for the reason `Scoping` gives: the sentence lands
 * in the diagnostic, on the line of the second form.
 */
type Prose<Spoken extends string, Other extends "text" | "file", Verb> = Other extends Spoken ? (both: DoubleProse<Other>) => never : Verb;
/** Anything a pack may file under an entry name. The one shape `definePack` walks. */
export interface Sentence<S extends EntrySpec = EntrySpec> {
    readonly spec: S;
}
/** A group of entries, or of groups — a pack may nest, and `git.node.versionIsSemver` is why. */
export interface EntryGroup {
    readonly [key: string]: Sentence | EntryGroup;
}
export interface GuardrailSentence<Spoken extends GuardrailKey = never, At extends GuardrailMoment = GuardrailMoment> extends Sentence<GuardrailSpec> {
    readonly at: Once<Spoken, "at", <M extends GuardrailMoment[]>(...moments: M) => GuardrailSentence<Spoken | "at", M[number]>>;
    readonly for: Once<Spoken, "for", (...categories: Category[]) => GuardrailSentence<Spoken | "for", At>>;
    readonly everywhere: Once<Spoken, "everywhere", () => GuardrailSentence<Spoken | "everywhere", At>>;
    readonly on: Once<Spoken, "on", Scoping<At, Globs<GuardrailSentence<Spoken | "on", At>>>>;
    readonly ignore: Once<Spoken, "ignore", Scoping<At, Globs<GuardrailSentence<Spoken | "ignore", At>>>>;
    readonly check: Once<Spoken, "check", (check: Check) => GuardrailSentence<Spoken | "check", At>>;
    readonly message: Once<Spoken, "message", (message: string) => GuardrailSentence<Spoken | "message", At>>;
    readonly disabled: Once<Spoken, "disabled", (reason?: string) => GuardrailSentence<Spoken | "disabled", At>>;
    readonly test: Once<Spoken, "test", (cases: Cases) => GuardrailSentence<Spoken | "test", At>>;
    readonly description: Once<Spoken, "description", (description: string) => GuardrailSentence<Spoken | "description", At>>;
}
export interface BreadcrumbSentence<Spoken extends BreadcrumbKey = never, At extends BreadcrumbMoment = BreadcrumbMoment> extends Sentence<BreadcrumbSpec> {
    readonly at: Once<Spoken, "at", <M extends BreadcrumbMoment[]>(...moments: M) => BreadcrumbSentence<Spoken | "at", M[number]>>;
    readonly for: Once<Spoken, "for", (...categories: Category[]) => BreadcrumbSentence<Spoken | "for", At>>;
    readonly on: Once<Spoken, "on", Scoping<At, Globs<BreadcrumbSentence<Spoken | "on", At>>, BriefScopeMoment>>;
    readonly ignore: Once<Spoken, "ignore", Scoping<At, Globs<BreadcrumbSentence<Spoken | "ignore", At>>, BriefScopeMoment>>;
    readonly text: Once<Spoken, "text", Prose<Spoken, "file", (text: string) => BreadcrumbSentence<Spoken | "text", At>>>;
    readonly file: Once<Spoken, "file", Prose<Spoken, "text", (path: string) => BreadcrumbSentence<Spoken | "file", At>>>;
    readonly disabled: Once<Spoken, "disabled", (reason?: string) => BreadcrumbSentence<Spoken | "disabled", At>>;
    readonly description: Once<Spoken, "description", (description: string) => BreadcrumbSentence<Spoken | "description", At>>;
}
type Missing<Spoken extends string, Required extends string> = Exclude<Required, Spoken>;
type NeverSaid<What extends string, Verb extends string> = Verb extends string ? `flow: this ${What} never said .${Verb}() — nothing defaults, so it is not an entry` : never;
/** A guardrail must say when it fires, what it asks, what it tells you, and what proves it. */
type GuardrailRequired = "at" | "check" | "message" | "test";
/** A breadcrumb must say when it shows, and carry its prose one of the two ways. */
type BreadcrumbProse = "flow: this breadcrumb has no prose — say .text(…) or .file(…)";
export type CompleteEntry<B> = B extends GuardrailSentence<infer S, infer _GuardrailAt> ? "disabled" extends S ? B : [Missing<S, GuardrailRequired>] extends [never] ? B : NeverSaid<"guardrail", Missing<S, GuardrailRequired>> : B extends BreadcrumbSentence<infer S, infer _BreadcrumbAt> ? "disabled" extends S ? B : [Missing<S, "at">] extends [never] ? "text" extends S ? B : "file" extends S ? B : BreadcrumbProse : NeverSaid<"breadcrumb", Missing<S, "at">> : B extends EntryGroup ? {
    readonly [K in keyof B]: CompleteEntry<B[K]>;
} : never;
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
 * of twelve verbs, and no signature can describe that from the inside. The casts at each entry
 * point are the seam.
 */
export declare function chain<Exposed extends object>(spoken: Readonly<Record<string, unknown>>, expose: (spoken: Readonly<Record<string, unknown>>) => Exposed): Exposed;
/** Open a guardrail sentence. It blocks; it must therefore say what it asks and what it proves. */
export declare function guardrail(): GuardrailSentence;
/** Open a breadcrumb sentence. Breadcrumbs are data — no check, ever, and no rail to block. */
export declare function breadcrumb(): BreadcrumbSentence;
/** Is this an entry rather than a group of them? What `definePack` walks a pack's tree with. */
export declare function isSentence(value: unknown): value is Sentence;
declare const PACK: unique symbol;
declare const REF: unique symbol;
/** Phantoms: typed, never present at run time. They exist so a call site can be refused. */
declare const PARAMS: unique symbol;
declare const KIND: unique symbol;
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
    readonly [K in keyof T]: T[K] extends Sentence<GuardrailSpec> ? EntryRef<"guardrail"> : T[K] extends Sentence<BreadcrumbSpec> ? EntryRef<"breadcrumb"> : T[K] extends EntryGroup ? Refs<T[K]> : never;
};
interface PackHandle<Params> {
    readonly [PACK]: PackDefinition;
    /** Phantom. It exists so `pack(tdd)` without parameters is not a call the compiler will make. */
    readonly [PARAMS]?: Params;
}
/** What `definePack` hands back: the reference tree, with the definition riding underneath it. */
export type Pack<T extends EntryGroup, Params = undefined> = Refs<T> & PackHandle<Params>;
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
/**
 * Declare a pack: a name, and its entries.
 *
 * The entries argument is `T & CompleteEntry<T>` — the first half infers the tree, the second
 * checks every sentence in it. An incomplete one lands on a string literal whose text names the
 * verb it never said, so the editor's error is the instruction.
 */
export declare function definePack<T extends EntryGroup>(name: string, entries: T & CompleteEntry<T>): Pack<T>;
export declare function definePack<Params, T extends EntryGroup>(name: string, factory: (params: Params) => T & CompleteEntry<T>): Pack<T, Params>;
/** The definition riding under a pack value, or undefined if this was never made by definePack. */
export declare function packDefinition(value: unknown): PackDefinition | undefined;
/** Where a reference points, or undefined if this was never a reference. */
export declare function refTarget(value: unknown): RefTarget | undefined;
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
export declare function pack<T extends EntryGroup, Params>(definition: Pack<T, Params>, ...params: undefined extends Params ? [params?: Params] : [params: Params]): PackBinding;
/**
 * What an override may speak: BOTH entry grammars, minus the verbs it must never reach.
 *
 * Derived rather than listed, and the subtraction is the whole statement — "an override moves an
 * entry, rewords it or switches it off, and can never touch what the entry ASKS" is said once,
 * here, in a form that cannot drift from the key sets it is subtracting from. A third hand-typed
 * listing of the grammar would be a third place to forget a verb. `everywhere` is the pack's to
 * say: where a rule's protection reaches is part of what it asks.
 */
type OverrideKey = Exclude<GuardrailKey | BreadcrumbKey, "check" | "test" | "everywhere">;
interface OverrideChain<Kind extends EntrySpec["kind"], Spoken extends OverrideKey> {
    readonly binding: OverrideBinding;
    readonly at: Once<Spoken, "at", (...moments: (Kind extends "guardrail" ? GuardrailMoment : BreadcrumbMoment)[]) => OverrideChain<Kind, Spoken | "at">>;
    readonly for: Once<Spoken, "for", (...categories: Category[]) => OverrideChain<Kind, Spoken | "for">>;
    readonly on: Once<Spoken, "on", Globs<OverrideChain<Kind, Spoken | "on">>>;
    readonly ignore: Once<Spoken, "ignore", Globs<OverrideChain<Kind, Spoken | "ignore">>>;
    readonly message: Kind extends "guardrail" ? Once<Spoken, "message", (message: string) => OverrideChain<Kind, Spoken | "message">> : never;
    readonly text: Kind extends "breadcrumb" ? Once<Spoken, "text", Prose<Spoken, "file", (text: string) => OverrideChain<Kind, Spoken | "text">>> : never;
    readonly file: Kind extends "breadcrumb" ? Once<Spoken, "file", Prose<Spoken, "text", (path: string) => OverrideChain<Kind, Spoken | "file">>> : never;
    readonly disabled: Once<Spoken, "disabled", (reason?: string) => OverrideChain<Kind, Spoken | "disabled">>;
    readonly description: Once<Spoken, "description", (description: string) => OverrideChain<Kind, Spoken | "description">>;
}
/**
 * Override one entry, speaking only what changes.
 *
 * There is no `.check()` and no `.test()` here, and their absence is the design: an override can
 * move an entry, reword it or switch it off, but it can never reach inside what the entry ASKS.
 */
export declare function override<Kind extends EntrySpec["kind"]>(ref: EntryRef<Kind>): OverrideChain<Kind, never>;
/** Anything a config line may be: a pack binding, or an override chain at any point in its chain. */
export type ConfigSentence = PackBinding | {
    readonly binding: OverrideBinding;
};
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
export declare function defineConfig(sentences: readonly ConfigSentence[], settings?: Settings): FlowConfig;
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
export declare function overlay(base: EntrySpec, spoken: Readonly<Record<string, unknown>>, prior?: Readonly<Record<string, "pack" | "override">>): Overlaid;
/** The closed vocabulary of refusals. Every load failure is exactly one of these. */
export declare const REFUSAL_CODES: readonly ["not-a-pack", "missing-parameter", "unknown-entry", "unknown-key", "unknown-moment", "unknown-setting", "missing-mandatory", "undeclared-category", "no-block-cases", "duplicate-id", "dead-scope", "bad-check-options", "empty-scope", "double-prose"];
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
export type LoadResult = {
    readonly ok: true;
    readonly entries: readonly LoadedEntry[];
} | {
    readonly ok: false;
    readonly refusals: readonly Refusal[];
};
/**
 * Every refusal as ONE block of text — the sentence a person reads when the config will not load.
 *
 * There is exactly one wording, here, because there are three places it surfaces and they must not
 * drift: the `flow test` exception (errors.ts), the block a gated moment refuses with, and the
 * notice a breadcrumb moment degrades to. A guard that describes its own breakage differently
 * depending on which rail you hit is a guard nobody learns to read.
 */
export declare function refusalText(refusals: readonly Refusal[]): string;
/** Turn a config's bindings into the effective regime, or into every reason it cannot be one. */
export declare function loadConfig(config: FlowConfig): LoadResult;
export {};
