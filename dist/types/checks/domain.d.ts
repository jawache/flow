import type { Case, CaseWorld, Check, Ctx, ExecResult, GitCommand, Grammar, LoadedEntry, Moment, ShellCommand, Unanswered, World } from "../language/domain.ts";
/** One pattern that matched, and the 1-based line it matched on. */
export interface PatternHit {
    readonly pattern: string;
    readonly line: number;
}
/**
 * Every pattern that matches, per line, in order.
 *
 * A pattern is applied per LINE rather than to the whole text, because a hit has to be able to
 * name one: "matches TODO" sends a reader to a file, "line 42 matches TODO" sends them to the
 * place. A single-line subject — a command — simply has one line.
 */
export declare function patternHits(text: string, patterns: readonly string[]): PatternHit[];
/**
 * Ban a word or shape in a file's text.
 *
 * For code shapes prefer `astGrep` — it parses, so it will not match the word inside a string
 * literal or inside a comment that is talking ABOUT the ban.
 */
export declare const textBan: (options: {
    ban: readonly string[];
}) => Check;
/**
 * Ban a dangerous command before it runs.
 *
 * A DETERRENT: the commands it names ARE its scope, so matching nothing in a repo is the rule
 * working, not a rule watching the wrong place.
 *
 * EACH ENTRY IS A COMMAND IN WORDS — `"git push --force"` — read by the same parse as the line: a
 * program, then the arguments that make it dangerous. A command in `ctx.commands` matches when its
 * program, less its path, is the entry's, and its arguments include every one of the entry's, in
 * any order. Arguments are compared whole, so `"work task"` is not `work task-list` and a quoted
 * `'we tick later'` is not the word `tick`; a bundle of short flags counts letter by letter on both
 * sides, so `"rm -rf"` is `rm -fr` and `rm -r -f`. A regex over a command's text could say none of
 * that: it read `/usr/local/bin/work plan tick` as no tick and `rm -fr` as no `-rf`.
 *
 * One command at a time, so `git push origin main; ls -f` is no force push, and a heredoc's body
 * is text fed to a program, not arguments — unless a shell reads it, when the parse has already
 * made its lines commands of their own. A line that does not parse is refused when an entry's words
 * all appear in it as whole words: a deterrent that cannot read a line errs toward refusing it.
 *
 * `wholeLine: true` is the escape hatch for a pattern that spans two commands on purpose
 * (`curl … | sh`): each entry is then a regex, compiled when the rule loads and tried anywhere in
 * the line as written, less its heredoc bodies. One that does not compile refuses to load.
 *
 * An entry that is not one command in words — a line that does not parse, two commands, a
 * backslash, the mark of a regex written before words, or a wrapper such as `sudo` or a `FOO=1`
 * assignment in front — refuses to load, rather than arming a ban that matches nothing, or every
 * use of its program.
 *
 * docs/user/checks/ban-commands.md is the promise, case by case.
 */
export declare const banCommands: (options: {
    ban: readonly string[];
    wholeLine?: boolean;
}) => Check;
/**
 * Refuse a commit that changes or deletes a file under `paths`.
 *
 * CALLED ONCE PER COMMIT, with no `.on(…)`: the protected set is the option, so the check reads the
 * commit's own facts — the staged paths, the paths the last commit does not have and the paths it
 * deletes — and a deletion is a path like any other. A rule scoped with `.on(…)` is asked about
 * files, one at a time, and never about a deleted one. A rename is a deletion of the old path plus
 * an add of the new one, so it is refused by its old path.
 *
 * `existingOnly` is what an APPEND-ONLY tree needs: a migrations folder, where yesterday's file is
 * history and may never move while today's is the whole point of the folder. A file is new when
 * the last commit does not have it (`ctx.added`). Absent means no narrowing, which is the empty
 * value rather than a default a reader has to know about.
 *
 * It has no `.on(…)`, so `flow hook commit --all`, which makes no commit, does not call it.
 */
export declare const protectedPath: (options: {
    paths: readonly string[];
    existingOnly?: boolean;
}) => Check;
/**
 * A file must have a required companion on disk — every `src/domain/**` needs its `.test.ts`.
 *
 * Path shape only: it reads no content, just asks whether the sibling is there. The template fills
 * `{dir}` `{name}` `{base}` `{path}` from the touched path.
 */
export declare const siblingExists: (options: {
    sibling: string;
}) => Check;
/**
 * The canon a feature folder is judged against.
 *
 * `root` and `allow` are REQUIRED: the canon IS the content of the rule, so an entry that does not
 * state it is an entry nobody can read, and a default would be one repo's canon applied silently
 * in every other.
 * `thinking` and `folders` stay optional because absent means "no exemption" and "the folder tier
 * is not policed" — the empty value in both cases.
 */
export interface CanonOptions {
    /** The tier boundary — everything below it is judged. */
    readonly root: string;
    /** The filenames a feature folder may hold. Empty means the filename tier is not policed. */
    readonly allow: readonly string[];
    /** The one file that may carry a `.test.<ext>` sibling. Absent means none may. */
    readonly thinking?: string;
    /**
     * The names allowed DIRECTLY under `root` — the folder tier.
     *
     * A second allowlist rather than a mode flag, because the two questions are genuinely different
     * and a repo can want either alone. `docs/` wants only this one (exactly `user/` and `agent/` at
     * the top, anything below them); a feature tree wants only the filename one. Absent means the
     * folder tier is not policed, which is what every caller before docs asked for.
     */
    readonly folders?: readonly string[];
}
/**
 * What the canon says about one path.
 *
 * A DISCRIMINATED reason rather than a boolean, because there are two different violations here
 * and they earn different sentences. The decision and the wording used to be two functions, each
 * re-deriving the tier from the path — which meant the message could describe a different fault
 * from the one that fired, and only a reader comparing the two would ever notice.
 */
export type CanonVerdict = {
    readonly ok: true;
}
/** A name directly under `root` that the folder tier does not allow. `found` is that name. */
 | {
    readonly ok: false;
    readonly tier: "folder";
    readonly found: string;
}
/** A filename inside a feature folder that the canon does not allow. */
 | {
    readonly ok: false;
    readonly tier: "filename";
};
/**
 * Judge one path against the canon. The ONE place the tier decision is made.
 *
 * The rule. A file directly under `root` is the shared-util tier and may be named anything — the
 * test and coverage rules already cover it. A file INSIDE a feature folder (`<root>/<feature>/…`)
 * must be one of `allow`. An invented name (payload · helpers · utils · views · mappers) is the
 * classic escape hatch: somewhere to stash logic that dodges the domain's test and its coverage
 * gate. So it is refused, and the fix is to fold that logic into the thinking file or to rename
 * the talking file after the thing it talks to.
 *
 * The extensions are derived from the path rather than configured — a repo that writes .ts and one
 * that writes .mjs want the same rule, and a second list to keep in step is a second list to get
 * wrong. It reads no content: this is a claim about NAMES, and reading the file would only invite
 * the rule to start having opinions about what is in it.
 */
export declare function judgeCanonical(path: string, o: CanonOptions): CanonVerdict;
/** The sentence a verdict earns. It renders what was decided — it never decides anything itself. */
export declare function canonicalFault(verdict: CanonVerdict, path: string, o: CanonOptions): string;
/** A feature folder may hold only canonical filenames. */
export declare const canonicalFiles: (options: CanonOptions) => Check;
/**
 * One assertion about a JSON file: a dotted path, and one thing that must hold at it.
 *
 * `required` is what tells an absent OPTIONAL path from an absent mandatory one. Without it every
 * assertion would either have to exist, or would silently pass the day the key was renamed.
 */
export interface JsonAssert {
    /** The dotted path to dig to. Absent (or empty) means the document root. */
    readonly path?: string;
    /** The value is an object and EVERY key starts with this string. */
    readonly keysPrefixedWith?: string;
    /** The value deep-equals this (compared as JSON). */
    readonly equals?: unknown;
    /** The value, stringified, matches this regular expression. */
    readonly matches?: string;
    /** The path must exist at all. An absent optional path is skipped silently. */
    readonly required?: boolean;
}
/**
 * Every assertion that fails over one JSON document.
 *
 * Text that will not parse yields NO violations, and that is deliberate rather than lax: a rule
 * about a JSON file's contents has nothing to say about a file that is not JSON yet. A file that
 * really is broken JSON is a problem the tool that reads it will name, loudly, on its own.
 */
export declare function jsonViolations(jsonText: string, assert: readonly JsonAssert[]): string[];
/** A structured (JSON) file must hold an invariant. */
export declare const jsonInvariant: (options: {
    assert: readonly JsonAssert[];
}) => Check;
/** Of some exported names, which are never mentioned in the sibling test's text? */
export declare function unreferenced(names: readonly string[], siblingText: string): string[];
/**
 * The names a TypeScript source exports — functions, classes and consts, in source order.
 *
 * An `export const` is read as every name it binds: each declarator of `export const a = 1, b = 2`,
 * and each name a destructuring pattern binds. A declarator with a type annotation is left out,
 * destructured or not, and so is an ambient `export declare const`: the declaration sits under an
 * `ambient_declaration`, not directly under the export, so it is never matched.
 *
 * A real parser rather than a regex, because `export const x = …` inside a string or a comment is
 * exactly the false positive that teaches people to ignore a rule. Parsing is not reaching the
 * world — a string in, a tree out — which is why the grammar library sits in this layer's import
 * allowlist beside the HTML parser, and why the import is dynamic: the native binding costs real
 * milliseconds to load and no other check needs it.
 */
export declare function exportedNames(content: string): Promise<string[]>;
/**
 * Every exported symbol is referenced in its sibling test.
 *
 * A refusal is one line: the sibling test once, then every export it never mentions.
 */
export declare const symbolsInSibling: (options: {
    sibling: string;
}) => Check;
/**
 * The anchor each heading of a Markdown page makes, as GitHub makes it: the text in lower case,
 * punctuation removed, each space a hyphen, and a repeat of one anchor numbered `-1`, `-2`.
 * A heading inside a fenced block is no heading. Link and image syntax in a heading gives its text.
 */
export declare function headingAnchors(markdown: string): Set<string>;
/**
 * Every docs page, and section of one, the staged file cites must exist.
 *
 * A citation is a path matching `pages`, and `#anchor` after it names a heading by the anchor
 * GitHub makes for it. A page is read once for all the anchors the file cites in it. The check
 * judges the file the call is about, so a page renamed in a commit judges the files that cite it
 * only when they are staged too.
 */
export declare const docLinks: (options: {
    pages: readonly string[];
}) => Check;
/**
 * The changed set this event is about.
 *
 * ONE read, in one place, because three separate checks used to derive it three ways: the commit
 * gate had it as an event fact, the tool-gate re-shelled for it, and change-together shelled for
 * it again with its own error handling. It is an event FACT first — the adapter puts the staged
 * paths on ctx at the commit moment — and a capability call only when the moment carried none,
 * which is what lets a `.test()` case supply it as plain data.
 */
export declare function changedSet(ctx: Ctx): Promise<readonly string[]>;
/** One "these move together" group: if any `if` glob changed, some `thenAny` glob must have too. */
export interface ChangeGroup {
    readonly if: readonly string[];
    readonly thenAny: readonly string[];
}
/** Which groups were triggered without their companion. */
export declare function lonelyChanges(changed: readonly string[], groups: readonly ChangeGroup[]): string[];
/** Files that must move in the SAME commit — a schema and its migration, a dep and its lockfile. */
export declare const changeTogether: (options: {
    groups: readonly ChangeGroup[];
}) => Check;
/** What a command reader is handed: the line, and its parse when the engine made one. */
type CommandFacts = Pick<Ctx, "command" | "commands">;
/**
 * The command line parsed as bash: `ctx.commands`, or the line parsed here when the ctx carries no
 * parse at all — which is what an engine older than the parse hands these checks. Null when the
 * line does not parse, and every reader takes null as "cannot tell".
 */
export declare function shellCommands(facts: CommandFacts): readonly ShellCommand[] | null;
/** Every git command the line runs, in the order the parse lists them; none when it does not parse. */
export declare function gitCommands(facts: CommandFacts): GitCommand[];
/** One shell argument, single-quoted so nothing in it can be expanded or re-parsed. */
export declare function quoteArg(value: string): string;
/**
 * WHICH WORKING TREE THIS COMMAND IS ABOUT, as a `-C` prefix to put on every read — or "".
 *
 * It is the first git command's `folder`, from the parse: where the line started, moved by each
 * `cd` and `pushd` before it and by its own `git -C`. The check works none of that out itself —
 * the parse followed the line once, for every reader — so `cd ../other && git checkout x` and
 * `git -C ../other checkout x` are both read against `../other`, the tree they are aimed at, and
 * never against the session's.
 *
 * Two ways a command leaves this repo, and a rule that reads the wrong tree does not fail loudly;
 * it passes quietly. The F3 builder ran `git checkout <path>` from a session rooted in another
 * worktree, and every git read the check made answered about the session's tree, where the path
 * did not exist — so the discard found nothing to lose, and went through.
 *
 * THE FIRST git command decides: a line that walks two trees is beyond what one answer can
 * honestly describe. In a line whose start nobody knows, as in a case, the folder is relative to
 * where it started, and `.` — the start itself — needs no `-C`: the read lands where `ctx.exec`
 * runs. A folder the parse could not settle, such as after `cd "$(mktemp -d)"`, or a git command
 * that names its repository itself with `--git-dir`, gets no `-C` either, so the read is of this
 * repository, where `ctx.exec` runs.
 */
export declare function gitDirPrefix(facts: CommandFacts): string;
/**
 * Does the message carry the token, on a LINE OF ITS OWN?
 *
 * A line, not a mention. The line is what makes the reason findable later — a reviewer reads these
 * at every phase boundary — and a token buried mid-sentence ("reverted the new-dep: thing") is both
 * unreadable to them and a free pass to anyone who types the word by accident. The two scripts this
 * absorbed matched the token anywhere; this is the one place the rebuild is deliberately stricter,
 * and the hit says so in as many words.
 *
 * The token is regex-ESCAPED. Both absorbed scripts interpolated it raw, so a token carrying `.` or
 * `+` quietly matched more than it said.
 */
export declare function givesReason(message: string, token: string): boolean;
/** What the commit carries, split by whether each path is new to the repo. */
export interface WorkingState {
    /** Everything the commit adds or changes: `ctx.staged`. */
    readonly changed: readonly string[];
    /** The subset that is NEW here, which the last commit does not have: `ctx.added`. */
    readonly added: readonly string[];
}
/**
 * One file whose DIFF is read for names that owe a reason, and the shape of the third condition.
 *
 * The two conditions above it ask about PATHS — a file changed, a file is new — and there is a
 * third question a guard keeps wanting to ask that neither can reach: not "did this file change"
 * but "what did this commit ADD INSIDE it". A dispatch surface is the case that forced it: every
 * commit to `cli/work.ts` changes the file, so a path condition there asks for a sentence about
 * every edit and is turned off within a week; what actually owes one is a NEW VERB, and a verb is
 * a name on an added line.
 *
 * WHY IT REPLACED A CHECK OF ITS OWN. This arrived as `newCommandNeedsCaller` in the shared file
 * beside the packs, and it was `commitReason` with one condition missing and everything else
 * rewritten: its own commit detection, its own message parse, its own token read, its own
 * one-sentence refusal. No pack bound it — two house packs in two repos did — so it was a shipped
 * check with no shipped user, carrying a second copy of a mechanism that already existed. As a
 * condition it inherits all of it, and the `known` list stays where it always had to be: on the
 * binding, because which names are already there is a project's own fact.
 */
export interface DiffAdds {
    /** The one file whose `git diff HEAD -- <file>` is read. Nothing else in the commit is looked at. */
    readonly file: string;
    /**
     * Regex sources, each with exactly ONE capture group — the name a hit is reported by.
     *
     * Several, because one surface registers a name several ways: a `case "x":` in a dispatch
     * switch, a `command === "x"`, a `sub === "x"` in a subcommand router. Two of those three went
     * unwatched for a year under a check that hard-coded them, which is the argument for the list
     * being a parameter a reader of the binding can see rather than a constant inside a function.
     */
    readonly patterns: readonly string[];
    /**
     * Names already on the surface: matched, and ignored.
     *
     * This is what makes it a RATCHET rather than a rule about editing the file at all. Renaming,
     * moving or reformatting an existing name is silent by design — a rule that fired on every
     * dispatch tidy is a rule someone turns off — and a stale list is the same silent failure the
     * ratchet exists to catch, which is why it is stated at the binding and never inside the check.
     */
    readonly known?: readonly string[] | undefined;
}
/**
 * The names one file's diff ADDED and did not already know.
 *
 * Added lines only: removals and context are ignored, so a rename shows the new name and nothing
 * else, and a reformat shows nothing. `+++` is skipped — it is the header naming the file, not a
 * line of the file.
 *
 * A pattern with no capture group contributes nothing rather than throwing: the binding is
 * TypeScript and a missing group is a mistake, but the moment this runs is a commit gate, and a
 * gate that crashes on a bad pattern refuses every commit in the repo until someone reads a stack
 * trace.
 */
export declare function addedNames(diff: string, patterns: readonly string[], known?: readonly string[]): string[];
export interface ReasonInput {
    /** The commit message, as git records it. */
    readonly message: string;
    /** What the commit carries, as git answered for the whole commit. */
    readonly state: WorkingState;
    /** Paths that owe a reason when they change at all. */
    readonly whenChanged?: readonly string[] | undefined;
    /** Paths that owe a reason only when they are NEW. */
    readonly whenAdded?: readonly string[] | undefined;
    /** Paths that never owe one, whichever condition matched — a test sibling, typically. */
    readonly except?: readonly string[] | undefined;
    /**
     * What the third condition found: names added inside a watched file, each with the file it came
     * from. Already filtered against that file's `known` list by `addedNames` — reading the diff is
     * IO and belongs to the check, and what is left here is the same pure judgement as the other two.
     */
    readonly namesAdded?: readonly {
        readonly name: string;
        readonly file: string;
    }[] | undefined;
    /** The key the message must carry on a line of its own. */
    readonly token: string;
}
/**
 * The findings for one commit. Empty means either nothing this rule watches moved, or the reason is
 * there.
 *
 * ONE hit, naming everything that asked and why it asked — `(new)`, `(changed)`, or `(added in
 * <file>)` for a name the third condition found inside a diff. A message that names four things
 * when one is the reason is a message nobody reads twice, so all three conditions report together
 * in one sentence rather than one hit each.
 *
 * WHAT IT BLOCKS is the UNEXPLAINED act, never the act. Adding a dependency is fine; adding one
 * with nothing written down is not, because the one thing a diff can never show is which
 * alternatives were weighed.
 */
export declare function reasonHits(o: ReasonInput): string[];
/**
 * Hold the commit message to a format, and ban text in it.
 *
 * `header` is a regex the FIRST line of the message must match; `ban` is a list of regexes, and any
 * line of the message matching any of them blocks. Both read `ctx.message`, the message as git
 * records it, so a message typed in an editor, passed with `-m` or read from a file is judged the
 * same way. Under `flow hook commit --all` there is no commit, so no message, and nothing to judge.
 *
 * At least one of the two is required, and a pattern that is not a regex refuses to load: a check
 * that could never fail would load, count and arm nothing.
 */
export declare const commitMessage: (options: {
    header?: string;
    ban?: readonly string[];
}) => Check;
/**
 * This commit needs a reason recorded, and here is whether it gave one.
 *
 * WHAT THIS REPLACES. THREE hand-rolled checks asked the same question about different nouns — a
 * commit adding a dependency, a commit adding a file to a pure core, and a commit adding a verb to
 * a dispatch surface — each carrying its own git-commit detection, its own read of what moved, its
 * own message parse and its own refusal sentence. One check, three conditions and a token: that is
 * the whole mechanism now, and it is stated on the entry where a reader meets it.
 *
 * THE THIRD CONDITION is `diffAdds`, and it is the one that is not about paths: see `DiffAdds`. It
 * came in from `newCommandNeedsCaller`, a shipped check no pack ever bound — two house packs in two
 * repos did — which on inspection was this check with one condition missing and everything else
 * written a second time.
 *
 * AT `commit`, in git's commit-message hook, where the message exists as git records it. The
 * message is `ctx.message`, so a commit a person types in an editor owes its reason as an agent's
 * does, and the files it changes are the staged ones: `ctx.staged` and `ctx.added`, which git
 * answered once for the whole commit. Under `flow hook commit --all` there is no commit, so no
 * message, and no reason is owed.
 *
 * `diffAdds` is the one condition that asks git again: one `git diff --cached` of the named file,
 * and only when a binding names it, because every question a check asks is one a `.test()` case
 * has to answer. A diff git cannot give leaves the check standing aside rather than trapping a
 * commit it cannot judge.
 */
export declare const commitReason: (options: {
    whenChanged?: readonly string[];
    whenAdded?: readonly string[];
    except?: readonly string[];
    diffAdds?: readonly DiffAdds[];
    token: string;
}) => Check;
/**
 * "You changed X this turn but never ran Y afterwards" — the turn-end rule.
 *
 * The actions arrive as harness-neutral facts on ctx, which is what makes this rule drivable by a
 * case and reachable by a replay: a rule that opened the transcript and parsed it would be reading
 * the world three times inside a check. Which tool names count as an edit is the adapter's
 * knowledge and stays there.
 *
 * Stands aside when the moment carried no turn facts at all: there is nothing to judge, and a rule
 * that blocked on the absence of evidence would block every turn on a harness that supplies none.
 */
export declare const ranSinceEdit: (options: {
    edited: readonly string[];
    mustRun: string;
}) => Check;
/**
 * Should a scoped gate skip — is its area untouched?
 *
 * True only when `changed` globs are given AND none of the changed files match, so a file-scoped
 * gate (a type-checker for `site/**`) stays quiet on commits that do not touch its area. No globs,
 * or nothing changed to judge → run it. Fail-safe: never silently skip a gate we cannot scope.
 */
export declare function skipForChanged(files: readonly string[], changed: readonly string[] | undefined): boolean;
/**
 * The lines worth showing FIRST when a tool fails — the errors, not the success chatter.
 *
 * Prefer lines that look like a failure; fall back to the tail. Capped, so a blocked commit stays
 * terse: quiet on pass, and on failure the error is up top rather than buried under a progress log.
 */
export declare function failureExcerpt(output: string, cap?: number): string;
/**
 * Run a whole-project tool and block on its failure — the one tool-delegated check.
 *
 * Some checks need the whole tree in a consistent state (a transitive import boundary, coverage,
 * the type graph) and cannot run per keystroke, so this belongs at commit or turn-end.
 *
 * IT IS HANDED THE CHANGED SET. A gate spawned with empty argv makes a repo's own script re-scan
 * the whole tree and leaves it unable to name the file that broke it. Here the changed set is an
 * event fact: it scopes the gate (`changed`), and
 * `{files}` in the run string expands to the files themselves, shell-quoted. A run string naming
 * `{files}` with nothing changed does not run at all, because a tool handed an empty file list
 * usually reads that as "do everything".
 */
export declare const execPasses: (options: {
    run: string;
    changed?: readonly string[];
}) => Check;
export type Matcher = Record<string, unknown>;
export interface NativeRule {
    name: string;
    severity: string;
    comment?: string;
    from?: Matcher;
    to?: Matcher;
    module?: Matcher;
}
export interface NativeConfig {
    forbidden: NativeRule[];
    required: NativeRule[];
    options: Record<string, unknown>;
}
export interface ForbidEdge {
    readonly from?: string;
    readonly to?: string;
    readonly transitive?: boolean;
    readonly why?: string;
    /** A feature importing a DIFFERENT feature, sideways — named by the layer it applies within. */
    readonly cyclesBetween?: string;
}
export interface RequireEdge {
    readonly in: string;
    readonly import: string;
    readonly why?: string;
}
/**
 * The dialect an entry writes its fences in.
 *
 * `layers` names sets of path globs, npm packages or node builtins; everything else declares a
 * relationship between them. It exists because dependency-cruiser's native schema is a regex
 * language, and a fence written in regexes is a fence nobody re-reads — the compiled literals of
 * one such config were dead for four days while the guard's own status reported it healthy.
 */
/**
 * One layer: the globs that are in it, and — optionally — the globs that are NOT.
 *
 * `not` exists because the shape a real architecture wants is "this folder, except these few": the
 * marketing surface of a site is `src/pages/**` minus the handful of subtrees that are endpoints.
 * Written as an enumeration of what IS marketing, the fence silently stops covering the next folder
 * somebody adds — which is the failure this dialect is supposed to prevent, not cause. It compiles
 * to dependency-cruiser's own `pathNot`, which is the same pair the `only` rule already uses.
 */
export interface Layer {
    readonly path: readonly string[];
    readonly not?: readonly string[];
}
export interface Dialect {
    /** What to cruise: a directory or a glob. `src` and `src/**` cruise the same modules. */
    readonly scan: string;
    /** Each layer, as globs — a bare list, or `{ path, not }` when it has holes in it. */
    readonly layers: Readonly<Record<string, readonly string[] | Layer>>;
    /** Fail-closed allowlist: a layer may reach ONLY these layers. */
    readonly only?: Readonly<Record<string, readonly string[]>>;
    /** Forbidden edges, each carrying the `why` its violation prints. */
    readonly forbid?: readonly (ForbidEdge | "circular" | "orphans")[];
    /** An inverted fence: modules in a path MUST import a target. */
    readonly require?: readonly RequireEdge[];
    /** Carve-outs — `type-only` above all, since a type import is erased at compile time. */
    readonly except?: readonly string[];
    /** dependency-cruiser's own options, passed through. */
    readonly options?: Readonly<Record<string, unknown>>;
}
/**
 * A path glob → a module-path regex for dependency-cruiser (posix module paths).
 *
 * It emits from ../glob.ts's tokens, and that is the whole point: this used to be a SECOND glob
 * translator, and it did not speak the whole dialect. It escaped `{` and `}` into literals, so
 * `src/**` + `/*.{ts,tsx}` — an ordinary layer glob — compiled to a fence that matched nothing,
 * silently, behind a green tick. One parser now, and a construct either has a token every emitter
 * maps or it is not in the dialect at all.
 *
 * The ONE thing this emitter does differently, and why it is an anchor rule rather than a dialect:
 * a TRAILING `**` means "everything under here", so the prefix is emitted and the end is left
 * unanchored. dependency-cruiser matches module paths unanchored at the tail, and every layer in
 * every repo already written against that behaviour must keep meaning what it meant.
 */
export declare function globToRe(glob: string): string;
/**
 * A layer entry → a module-path regex or a marker. `node:*` → the builtin marker; a bare name with
 * no slash, no star and no DOT → an npm package under node_modules; anything else → a path glob.
 *
 * THE DOT IS WHAT TELLS A ROOT FILE FROM A PACKAGE, and it is a fix rather than a nicety. Read as a
 * package name, an entry for a file at the repo root — `glob.ts`, `index.ts` — compiled to a matcher
 * for `node_modules/glob.ts`, so the layer covered nothing at all while `flow status` reported the
 * fence armed. It bit twice in this package alone, and only the commit gate caught either.
 *
 * The mirror case is the cost, and it has a spelling already: an npm package whose NAME carries a
 * dot (`socket.io`) now reads as a file, and is named the way a SCOPED package has always had to be
 * named here — as a path under node_modules, behind a leading globstar. One escape, already in use,
 * rather than a second convention.
 */
export declare function entryToMatcher(entry: string): {
    core?: true;
    path?: string;
};
/** Layer names → a depcruise matcher fragment. `path` is an OR-list; builtins become a type. */
/** The globs a layer holds, whichever of the two ways it was written. */
export declare function layerGlobs(layer: readonly string[] | Layer | undefined): {
    path: readonly string[];
    not: readonly string[];
};
export declare function layersMatcher(names: readonly string[], layers: Readonly<Record<string, readonly string[] | Layer>>): Matcher;
/** The whole dialect → a native `{ forbidden, required, options }` config. */
export declare function compileDialect(rule: Dialect): NativeConfig;
/**
 * The one command the depcruise check runs.
 *
 * A separate function because it is the whole of what this check DOES, and a case that stubs the
 * tool has to be able to see it. Three facts about its shape, each load-bearing:
 *
 *   The config travels in a QUOTED heredoc. dependency-cruiser takes its rules from a file and
 *   nothing else, and a check may not write one — so the command writes it, into a temp dir it
 *   removes afterwards. A quoted heredoc is literal: no expansion, no quoting hazard, and the one
 *   way it could break (a body line equal to the delimiter) cannot happen, because `JSON.stringify`
 *   with no indent emits exactly one line.
 *
 *   `npx --no-install`. dependency-cruiser is one of flow's own dependencies, so installing flow
 *   installs it; `--no-install` means the command resolves the local copy or fails loudly, and
 *   never silently downloads a different version in the middle of a commit.
 *
 *   The exit code is the TOOL's. `rm -rf` on the temp dir must not swallow a non-zero exit, which
 *   is what the explicit `rc` capture is for.
 */
export declare function depcruiseCommand(dialect: Dialect): string;
/** The tool's JSON report → one hit per violation, each naming the fence and its `why`. */
export declare function depcruiseHits(result: ExecResult): string[];
/**
 * Every layer entry that is a regex where a glob belongs — the fault `depcruise` refuses to load with.
 *
 * MEASURED, NOT IMAGINED: the first repo to convert its guard to flow brought its fence across
 * verbatim, layers and all, from an engine whose layers WERE regexes. They compiled to
 * `^\^src/pages/\([^/]!app/…` — a pattern no module path can match — and the fence loaded, reported
 * armed, walked the graph and found nothing, for as long as it took somebody to plant a probe and
 * watch the commit sail through. A rule that cannot do its job must refuse to load.
 */
export declare function nonGlobLayers(layers: Readonly<Record<string, readonly string[] | Layer>>): string[];
/**
 * A layer with holes, named in an `only` allowlist — refused, because the holes would be silent.
 *
 * `only` is compiled by INVERTING the allowed layers: everything not in them blocks. The inversion
 * reads the `path` globs and nothing else, so a layer's `not` would simply not be there — the
 * allowlist would quietly be wider than the layer it names. Rather than half-apply it, this says so
 * at load: use plain globs for a layer that an `only` names, or express the exclusion as a `forbid`.
 */
export declare function holesInAnOnlyList(opts: Dialect): string[];
/**
 * A `warn` option — refused, because it is gone and its rule would silently go with it.
 *
 * `warn: ["sdp"]` compiled a Stable Dependencies rule that nothing bound, and it is removed with no
 * replacement. The type no longer has the key, so a literal config fails to compile; but options
 * built in a variable carry it past the compiler, and dropped quietly the rule would report armed
 * and fence nothing. It is read off the raw object because the type cannot name it.
 */
export declare function removedWarnOption(opts: Dialect): string[];
/**
 * The generic import-fence runner.
 *
 * A whole-graph check: bind it at commit or turn-end, never per keystroke. It orchestrates and
 * never reimplements — the graph walk is dependency-cruiser's job, and the dialect above exists
 * only so the fences are readable by the person who has to change them.
 */
export declare const depcruise: (options: Dialect) => Check;
/** The grammars that need no install. */
export declare const NATIVE_LANGUAGES: readonly string[];
/**
 * WHAT A MISSING GRAMMAR LIBRARY SAYS — one sentence, in one place.
 *
 * It is read at two moments that must not disagree: `flow status` says it before anything runs, and
 * `resolveLang` says it when a rule on that language is reached. Two spellings would be two accounts
 * of the same fact, and the day one of them was improved the other would quietly become the older,
 * worse answer — which is the drift this package refuses everywhere else.
 */
export declare function missingGrammarText(name: string, libraryPath: string): string;
/**
 * Declare the config's grammars, and how to tell whether one is built.
 *
 * Called once per config read; the last config read wins, and one declaring none clears the list —
 * which is what makes `flow test <other-config>` an honest answer rather than one coloured by the
 * file read before it.
 */
export declare function useGrammars(grammars: readonly Grammar[], exists?: (path: string) => boolean): void;
/** A resolved grammar, or the sentence saying why there is none. */
type LangResult = {
    readonly ok: true;
    readonly lang: unknown;
} | {
    readonly ok: false;
    readonly detail: string;
};
/**
 * Resolve a grammar name to something `parse()` accepts.
 *
 * THREE ROUTES, in this order. A tier-0 native is free. A grammar the CONFIG DECLARED is registered
 * from the library the repo built — this is how a language nobody publishes (astro, vue, svelte)
 * gets in, and it is tried SECOND, before the package route, because a repo that went to the trouble
 * of building and declaring one has said which library it means. A published
 * `@ast-grep/lang-<name>` package (sql, python, go, rust…) is registered on first use; its compiled
 * binary lives in node_modules, and `registerDynamicLanguage` is safe to call per grammar.
 *
 * A DECLARED GRAMMAR THAT WILL NOT LOAD IS ITS OWN REFUSAL, naming the library file. The path is a
 * build artefact, machine-specific and never committed, so "missing" is the ordinary state of a
 * fresh clone and the message has to say which file and who builds it — not "unknown grammar",
 * which sends the reader looking for a package that does not exist.
 *
 * An unknown name is a REFUSAL VALUE, and it never falls through to Tsx. The check turns it into a
 * block, which is the fail-loud doctrine at its narrowest and most useful: a silent fall-through is
 * how a rule ends up parsing the wrong grammar, matching nothing, and reporting green forever.
 */
export declare function resolveLang(name: string): Promise<LangResult>;
/** Every match of an ast-grep rule in some source, as `line: text` — or why there are none. */
export declare function astGrepHits(content: string, rule: unknown, language: string): Promise<{
    readonly ok: true;
    readonly hits: string[];
} | {
    readonly ok: false;
    readonly detail: string;
}>;
/**
 * Ban or require a code shape.
 *
 * ast-grep is a Rust tool with a native Node binding, so the would-be file is handed over AS A
 * STRING and the matches come back — no subprocess, no temp file — which is what lets a structural
 * rule run pre-emptively on every edit as well as at commit.
 *
 * `language` is mandatory. A default here is a private fallback the entry cannot show — and the
 * wrong parser mis-parses a file and then matches nothing, silently, which is the failure this
 * package exists to delete.
 */
export declare const astGrep: (options: {
    rule: unknown;
    language: string;
}) => Check;
/** The three dialects a case can be written in — one per kind of event fact. */
export type CaseDialect = "command" | "commit" | "turn-end";
/**
 * What a commit says beyond the paths it stages — what a case lists, and what the live gate's event
 * carries (`GuardEvent` takes every field from here). Written out rather than derived from
 * `readCase`, so a field added to a case's reading does not silently become an option of the fan-out.
 */
export interface CommitFileFacts {
    /**
     * The staged paths the last commit does not have, which become each file's `existed`. Absent
     * when the shell could not ask git, or the case does not say, and then `existed` is left unset.
     */
    readonly added?: readonly string[] | undefined;
    /** Every path the commit deletes: `ctx.deleted`. */
    readonly deleted?: readonly string[] | undefined;
    /** The message as git records it. `null` under `--all`; absent, an empty one, as in a case with none. */
    readonly message?: string | null | undefined;
}
/**
 * Read a case once: which dialect it speaks, the event facts it carries, and its recorded world.
 *
 * ONE ladder over the union, and it is the only one. There were three — this, a `caseMoment` that
 * asked the same questions to answer half of it, and a `momentSpeaks` that hard-coded the same
 * pairing a fourth time — so adding a fifth case shape meant finding three places, and missing one
 * of them would have produced a case that ran at the wrong moment rather than an error.
 */
export declare function readCase(c: Case): {
    readonly dialect: CaseDialect;
    readonly facts: Partial<Ctx>;
    readonly world: CaseWorld;
} & CommitFileFacts;
/** Which moment's dialect a case speaks. */
export declare function caseMoment(c: Case): Moment;
/**
 * Every ctx one case becomes for one entry — one, or one per staged file it is scoped to.
 *
 * The plural is the whole of the fan-out fix, and the world is built ONCE and shared across the
 * subjects: a case records one world, and a per-file rule reading it four times must see the same
 * four answers the live gate would.
 */
export declare function caseCtxs(entry: LoadedEntry, moment: Moment, c: Case, unanswered: Unanswered[]): Promise<Ctx[]>;
/**
 * THE COMMIT FAN-OUT, in a case — the same split the engine makes, made from a recorded world.
 *
 * At the gate an entry that named `.on(…)` is about FILES: it is asked once per staged file in its
 * scope, each time holding that file as `ctx.file`. An entry that named none is about the commit
 * and is asked once with the staged set. The case runner used to know only the second half, so a
 * commit-only content rule — a staged-secret scan, a marker sweep — could not be given a case that
 * reached its own rail: the check was handed `ctx.file` empty and passed a fixture full of the
 * thing it exists to catch. Green, and not evidence.
 *
 * A staged path the recorded world holds no content for yields no subject, exactly as a staged
 * deletion does live. `runCase` reports the unanswered read either way, so a case that forgot the
 * content is a failure naming what to add rather than a silent pass.
 *
 * A case that lists `added` says which files the last commit does not have, as the live gate does,
 * and each file's `existed` follows from it. A case that lists none leaves `existed` unset.
 *
 * A case's `deleted` paths are no subject: a rule with `.on(…)` is asked about files the commit
 * holds, and one without reads them from `ctx.deleted`.
 */
export declare function commitSubjects(entry: LoadedEntry, facts: Partial<Ctx>, world: World, commit: CommitFileFacts, whole?: boolean): Promise<Partial<Ctx>[]>;
/** How one case came out. */
export interface CaseResult {
    readonly entry: string;
    readonly expect: "pass" | "block";
    /** The case's index within its own list — what `flow test` prints to point at one. */
    readonly index: number;
    readonly ok: boolean;
    /** Empty when it went as declared; otherwise the one sentence saying what happened instead. */
    readonly detail: string;
}
/**
 * One case, driven.
 *
 * Three ways it fails besides the obvious one, and each was a real hole:
 *
 *   The case speaks a dialect the entry has no rail for. A write rule tested with a command string
 *   proves nothing about the rule and looks exactly like proof.
 *
 *   The check throws. A crashing check is a failing check everywhere in flow; here it is the case's
 *   failure, named, which is the earliest anyone could have found out.
 *
 *   The check reached the world and the case did not answer. Left alone, that case would pass on a
 *   fiction — the canned world's silence read as a clean exit or an empty file.
 */
export declare function runCase(entry: LoadedEntry, check: Check, c: Case, expect: "pass" | "block", index: number): Promise<CaseResult>;
/** The sentence an unanswered reach earns — it names what to add to the case. */
export declare function unansweredText(missing: readonly Unanswered[]): string;
/**
 * Every bound entry's cases, driven — what `flow test` is.
 *
 * Disabled entries are skipped: they are listed with their reason and never run, so asking them to
 * prove anything is how an opt-out becomes cheaper to delete than to explain. Breadcrumbs carry no
 * check and have nothing to prove. Everything else must have cases at all, which the load already
 * refused it without.
 */
export declare function runCases(entries: readonly LoadedEntry[]): Promise<CaseResult[]>;
export {};
