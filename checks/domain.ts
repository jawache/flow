// flow/checks/domain.ts — THE STOCK CHECKS. Every judgement flow ships, as functions over ctx.
//
// The second stage of the pipeline — language → checks → engine → adapter. It imports the
// grammar's types and nothing after it: a check knows what one event is and what a verdict is,
// and knows nothing of matching, scoping, effects, or which harness reported the event. That is
// the property `.test()` cases and recorded replay both stand on.
//
// ONE FILE, and the consolidation is the point rather than a tidy-up. These were fourteen modules
// in the old engine, each a zod schema plus an adapter plus a pure decision, and the shape hid
// what they had in common: `text-ban` and `command-guard` were the same regex sweep written twice
// with different message text, three scripts each re-derived a changed-file set their own way,
// and two carried their own copy of "read a command line as git invocations". Here the sharing is
// visible — `patternHits` is the one matcher, `changedSet` the one changed-file read,
// `gitInvocations` the one tokeniser — and a fifteenth check has to say what it reuses.
//
// WHAT DIED IN THE MOVE, deliberately, because a typed grammar makes the tolerance pointless:
//   · The one-or-many unions. `ban: "TODO"` and `ban: ["TODO"]` were both accepted because YAML
//     could not say which one an author meant. A list is a list now, and the compiler says so.
//   · The dual key spellings. `then-any` beside `thenAny`, `must_run` beside `mustRun` — kebab
//     because YAML, camel because JavaScript. One spelling each, camelCase, because that is what
//     the language this config is written in spells.
//   · The zod schema factories. A `with:` box needed a runtime validator because it arrived as
//     untyped data through a string route. An options object is checked where you type it.
//   · `bindings-lint`, which lint-checked the YAML format. Its successor is the type system.
//
// HOW A CHECK REACHES THE WORLD, and it is the one rule this whole file obeys: through `ctx` and
// no other way. There is no node:fs here, no child_process, no process.env — a test suite runs
// through `ctx.exec`, a sibling file is read through `ctx.fs`, and the changed set arrives as an
// event fact. eslint refuses those imports on the line and work.yaml's import-boundaries refuses
// them at the commit, but the rails are not the reason: a check that reads the world directly
// cannot be driven by a case and cannot be replayed, and both failures this package exists to
// delete were first seen as a rule nobody could test.
//
//   PATTERNS      the one regex sweep — textBan · banCommands
//   PATHS         protectedPath · siblingExists · canonicalFiles
//   CONTENT       jsonInvariant · symbolsInSibling
//   THE COMMIT    changeTogether
//   COMMANDS      the git tokeniser · commitReason
//   THE TURN      ranSinceEdit
//   TOOLS         execPasses · depcruise · astGrep, each orchestrating, never reimplementing
//   CASES         the canned ctx a `.test()` case becomes, and the runner that walks them

import { cannedWorld, defineCheck, inScope, makeCtx } from "../language/domain.ts";
import type {
  Case,
  CaseWorld,
  Check,
  Ctx,
  ExecResult,
  GuardrailMoment,
  LoadedEntry,
  Moment,
  TurnAction,
  Unanswered,
  Verdict,
  World,
} from "../language/domain.ts";
import { escapeRe, expandTemplate, globTokenToRegExp, matchAny, tokenizeGlob } from "../glob.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TWO SHAPES EVERY CHECK HAS
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Almost every check below ends the same way — a list of hits, empty meaning yes — and most of
// them start the same way, by reading the file the event is about. Written out each time that was
// eleven copies of one ternary and four copies of one fallback, which is eleven places for a check
// to answer `ok()` when it meant `fail()`.

/**
 * A verdict from a list of hits: none is a pass, and any is ONE block naming all of them.
 *
 * One block rather than one per hit, because a rail shows a person a single message: four separate
 * refusals for one file is four things to read and three to lose.
 */
function answer(ctx: Ctx, hits: readonly string[], join = " · "): Verdict {
  return hits.length === 0 ? ctx.ok() : ctx.fail(hits.join(join));
}

/**
 * The would-be file this event is about.
 *
 * Empty strings when the moment carries none — a check bound at a moment with no file is a binding
 * mistake, and it is caught where mistakes belong: the load refuses a `.test()` case whose dialect
 * the entry's moments cannot speak, so a path check bound at `command` fails its own cases.
 */
function touched(ctx: Ctx): { readonly path: string; readonly content: string } {
  return ctx.file ?? { path: "", content: "" };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PATTERNS — the one regex sweep, and the two checks that render it differently
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// `text-ban` and `command-guard` were two files, two schemas and two tests for one question:
// which of these patterns match this string, and where. They differ in what they are pointed at
// and in the sentence they say about a hit, and in nothing else — so the sweep is written once
// and each check says its own sentence.

/** One pattern that matched, and the 1-based line it matched on. */
export interface PatternHit {
  readonly pattern: string;
  readonly line: number;
}

/**
 * Every pattern that matches, per line, in order.
 *
 * A pattern is applied per LINE rather than to the whole text, because a hit has to be able to
 * name one: "matches /TODO/" sends a reader to a file, "line 42: matches /TODO/" sends them to the
 * place. A single-line subject — a command — simply has one line.
 */
export function patternHits(text: string, patterns: readonly string[]): PatternHit[] {
  const lines = text.split("\n");
  const hits: PatternHit[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern);
    lines.forEach((line, index) => {
      if (re.test(line)) hits.push({ pattern, line: index + 1 });
    });
  }
  return hits;
}

/**
 * Ban a word or shape in a file's text.
 *
 * For code shapes prefer `astGrep` — it parses, so it will not match the word inside a string
 * literal or inside a comment that is talking ABOUT the ban.
 */
export const textBan = defineCheck(
  (opts: { ban: readonly string[] }): Check =>
    (ctx) => {
      const hits = patternHits(touched(ctx).content, opts.ban);
      return answer(ctx, hits.map((h) => `line ${h.line}: matches /${h.pattern}/`));
    },
);

/**
 * Ban a dangerous command before it runs.
 *
 * A DETERRENT: the patterns ARE its scope, so matching nothing in a repo is the rule working, not
 * a rule watching the wrong place.
 *
 * MATCHED WHOLE, and that is the one difference from `textBan` above. A command is ONE subject
 * however many lines it occupies — `git commit -m "subject\n\nCo-Authored-By: …"` is a single
 * invocation, and the patterns that police it span the newline on purpose. Swept line by line
 * (which is right for a file, where a hit must be able to name its line) every one of those
 * patterns matches nothing, silently: the rule loads, counts, and cannot catch the thing it
 * names. Measured at the crossing, on the attribution ban, which is the reason this comment is
 * here rather than a `// eslint-disable`-shaped shrug.
 */
export const banCommands = defineCheck(
  (opts: { ban: readonly string[] }): Check =>
    (ctx) => {
      const command = ctx.command ?? "";
      const hits = opts.ban.filter((pattern) => new RegExp(pattern).test(command));
      return answer(ctx, hits.map((pattern) => `matches banned /${pattern}/`));
    },
);

/**
 * A `banCommands` pattern for: a command that writes permanent prose, with a BACKTICK inside a
 * double-quoted argument.
 *
 * Reads as: <one of `heads`> … <an OPEN double quote> … <a backtick>, where the quote-pair walk
 * skips arguments that are already closed, and both scans refuse to cross a QUOTED heredoc opener
 * — inside one the shell substitutes nothing, so it is the sanctioned way to carry backticks and
 * must not be blocked. An unquoted `<<EOF` is deliberately still caught: there, substitution
 * really does happen. This is the one pattern that has to span a newline, and the reason
 * `banCommands` matches a command whole rather than line by line.
 *
 * A BUILDER over a `heads` list rather than one frozen expression, because the commands that
 * record prose belong to different packs: `git commit` and `gh pr|issue` are `git`'s, which every
 * repo binds, and the `work …` verbs are `work`'s, which only a repo running the work lifecycle
 * binds. One tail, two heads, and neither pack carries a copy of the other's — a second copy of
 * this expression is how the two would drift while both still read as armed.
 *
 * WHY IT IS CORE and not a helper beside the packs, which is where it lived until F5: TWO PACKS
 * SHARE IT, and that is the whole rule the fold settled — anything two packs share is a core
 * check. A shared file sitting beside the packs is a library with two users and no owner, and this
 * one proved it by growing four unrelated sections around this pair. Here it sits next to the
 * check it builds a pattern for, and the door that exports one exports both.
 */
export function substitutionInProse(heads: readonly string[]): string {
  return `(?:${heads.join("|")})` + "[^\"`]*(?:\"(?:(?!<<-?')[^\"])*\"[^\"`]*)*\"(?:(?!<<-?')[^\"])*`";
}

/**
 * What a blocked prose-writing command is told, and it is the same sentence whichever pack caught
 * it: the mechanism, the absence of an undo, the fix, and the one false positive the rule owns.
 *
 * ONE constant rather than a message per pack. The sentence never named the verb that was blocked
 * — it names the shape — so two copies would be two places for the same advice to drift, and the
 * copy that drifted would still read as correct.
 */
export const SUBSTITUTION_MESSAGE = [
  "You are recording prose through a shell command, and a backtick inside a DOUBLE-quoted argument is not Markdown — the shell RUNS it and splices its output into your text before the command ever sees it.",
  "On an append-only record there is no undo: no amend, no redact. And once the binary has argv the splice has already happened, so this is the only moment it can be caught.",
  "Fix: SINGLE-quote the argument (backticks are literal there), or feed the prose on stdin with a QUOTED heredoc — `git commit -F -` plus `<<'EOF'`, which this rule treats as safe.",
  "ALREADY single-quoted and still blocked? Then your PROSE carries an unbalanced double quote before the backtick, and the matcher cannot tell that quote from a real open argument. Nothing would splice — this one is the rule's cost, not your mistake. Balance the quote, drop it, or use the heredoc; do not go back to double quotes to make it pass.",
  "Measured four times. A `work plan decision` whose double-quoted text carried backticks around a command name executed it and spliced a whole task-list dump into the Decision Log. A justfile @echo with backticks ran `npm unlink`, silently undoing the link the message was announcing.",
].join("\n");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PATHS — claims about where a file is, never about what is in it
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Refuse a hand-edit of a protected path.
 *
 * The entry's `.on()` IS the protected set and the engine has already filtered on it, so any file
 * that reaches this check is protected by definition: matching it is the violation. There is no
 * second list of paths inside the check — there used to be (`deny:` beside `on:`), it meant a rule
 * could be scoped one way and protect another, and a scalar `deny: "vendor/**"` protected nothing
 * at all for a year.
 *
 * `existingOnly` is what an APPEND-ONLY tree needs: a migrations folder, where yesterday's file is
 * history and may never move while today's is the whole point of the folder. Absent means no
 * narrowing — every write to a protected path is refused — which is the empty value rather than a
 * default a reader has to know about.
 */
export const protectedPath = defineCheck(
  (opts: { existingOnly?: boolean }): Check =>
    async (ctx) => {
      const { path } = touched(ctx);
      if (opts.existingOnly === true) {
        // "Already there" is asked of the tree, not of git: at write time the file either exists
        // or is being created, and that is exactly the distinction append-only wants. A delete has
        // no would-be file to ask about, and the entry's scope is what protects it.
        if (ctx.moment !== "delete" && !(await ctx.fs.exists(path))) return ctx.ok();
        return ctx.fail(
          `'${path}' is append-only — an existing file here is history and may not be edited or deleted (adding a new one is fine)`,
        );
      }
      return ctx.fail(`'${path}' is a protected path (do not edit directly)`);
    },
);

/**
 * A file must have a required companion on disk — every `src/domain/**` needs its `.test.ts`.
 *
 * Path shape only: it reads no content, just asks whether the sibling is there. The template fills
 * `{dir}` `{name}` `{base}` `{path}` from the touched path.
 */
export const siblingExists = defineCheck(
  (opts: { sibling: string }): Check =>
    async (ctx) => {
      const sibling = expandTemplate(opts.sibling, touched(ctx).path);
      return (await ctx.fs.exists(sibling)) ? ctx.ok() : ctx.fail(`required sibling missing: ${sibling}`);
    },
);

/**
 * The canon a feature folder is judged against.
 *
 * `root` and `allow` are REQUIRED. They used to default to `src/lib` and one platform's own
 * eight-name union — a canon invented in one repo and applied silently in every other. The canon
 * is the whole content of the rule, so an entry that does not say it is an entry nobody can read.
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

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

/**
 * What the canon says about one path.
 *
 * A DISCRIMINATED reason rather than a boolean, because there are two different violations here
 * and they earn different sentences. The decision and the wording used to be two functions, each
 * re-deriving the tier from the path — which meant the message could describe a different fault
 * from the one that fired, and only a reader comparing the two would ever notice.
 */
export type CanonVerdict =
  | { readonly ok: true }
  /** A name directly under `root` that the folder tier does not allow. `found` is that name. */
  | { readonly ok: false; readonly tier: "folder"; readonly found: string }
  /** A filename inside a feature folder that the canon does not allow. */
  | { readonly ok: false; readonly tier: "filename" };

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
export function judgeCanonical(path: string, o: CanonOptions): CanonVerdict {
  const p = path.replace(/\\/g, "/");
  const marker = o.root.replace(/^\/+|\/+$/g, "") + "/";
  const ix = p.indexOf(marker);
  if (ix === -1) return { ok: true };
  const rel = p.slice(ix + marker.length);

  // The FOLDER tier, judged first and on any file type: what may sit directly under root. A stray
  // `docs/notes.md` and a stray `docs/notes/` are the same mistake, and neither is about source
  // code, so the extension check below must not get to decide.
  if (o.folders?.length) {
    const first = rel.split("/")[0] ?? "";
    const name = first.replace(/\.[^.]+$/, "");
    if (first !== "" && !o.folders.includes(first) && !o.folders.includes(name)) {
      return { ok: false, tier: "folder", found: first };
    }
  }
  if (!o.allow.length) return { ok: true };

  const m = SOURCE.exec(p);
  if (!m) return { ok: true };
  if (p.endsWith(".d.ts")) return { ok: true };
  if (!rel.includes("/")) return { ok: true }; // the shared-util tier — any name, tested elsewhere

  const file = rel.slice(rel.lastIndexOf("/") + 1);
  const base = file.slice(0, -m[0].length);

  // Only the thinking file may carry a test: a talking file with a test is a talking file that
  // grew logic, which is the whole thing this allowlist is watching for.
  const bad = base.endsWith(".test")
    ? base.slice(0, -".test".length) !== (o.thinking ?? "")
    : !o.allow.includes(base);
  return bad ? { ok: false, tier: "filename" } : { ok: true };
}

/** The sentence a verdict earns. It renders what was decided — it never decides anything itself. */
export function canonicalFault(verdict: CanonVerdict, path: string, o: CanonOptions): string {
  if (verdict.ok) return "";
  if (verdict.tier === "folder") {
    return `'${verdict.found}' is not one of the names ${o.root}/ may hold: ${o.folders?.join(" · ") ?? ""} (found ${path})`;
  }
  return (
    `non-canonical file in a ${o.root} feature folder: ${path} ` +
    `(allowed: ${o.allow.join(" · ")}${o.thinking === undefined ? "" : ` — only ${o.thinking} may carry a .test sibling`})`
  );
}

/** A feature folder may hold only canonical filenames. */
export const canonicalFiles = defineCheck(
  (opts: CanonOptions): Check =>
    (ctx) => {
      const { path } = touched(ctx);
      const verdict = judgeCanonical(path, opts);
      return verdict.ok ? ctx.ok() : ctx.fail(canonicalFault(verdict, path, opts));
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTENT — claims about what a file says
// ════════════════════════════════════════════════════════════════════════════════════════════════

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

type Dug = { found: false } | { found: true; value: unknown };

/** Walk a dot-path into a parsed document. `found: false` means the path is absent. */
function dig(obj: unknown, path: string | undefined): Dug {
  let node: unknown = obj;
  for (const key of (path ?? "").split(".").filter(Boolean)) {
    if (node == null || typeof node !== "object" || !(key in (node as Record<string, unknown>))) {
      return { found: false };
    }
    node = (node as Record<string, unknown>)[key];
  }
  return { found: true, value: node };
}

/** One assertion → its violations (usually none or one). */
function checkOne(obj: unknown, a: JsonAssert): string[] {
  const out: string[] = [];
  const { path } = a;
  const dugged = dig(obj, path);

  if (!dugged.found) {
    if (a.required === true) out.push(`"${path}" is missing (required)`);
    return out; // absent + optional → nothing to check
  }
  const value = dugged.value;
  if (a.keysPrefixedWith !== undefined) {
    if (!value || typeof value !== "object") return out; // nothing to constrain
    for (const k of Object.keys(value)) {
      if (!k.startsWith(a.keysPrefixedWith)) out.push(`"${path}.${k}" must be prefixed "${a.keysPrefixedWith}"`);
    }
  }
  if ("equals" in a && JSON.stringify(value) !== JSON.stringify(a.equals)) {
    out.push(`"${path}" must equal ${JSON.stringify(a.equals)} (is ${JSON.stringify(value)})`);
  }
  if (a.matches !== undefined && !new RegExp(a.matches).test(String(value))) {
    out.push(`"${path}" (${JSON.stringify(value)}) must match /${a.matches}/`);
  }
  return out;
}

/**
 * Every assertion that fails over one JSON document.
 *
 * Text that will not parse yields NO violations, and that is deliberate rather than lax: this runs
 * on a would-be file at write time, which is frequently mid-keystroke, and a rule that shouted
 * "invalid JSON" at every second character would be turned off within a day. A file that really is
 * broken JSON is a problem the tool that reads it will name, loudly, on its own.
 */
export function jsonViolations(jsonText: string, assert: readonly JsonAssert[]): string[] {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return [];
  }
  return assert.flatMap((a) => checkOne(obj, a));
}

/** A structured (JSON) file must hold an invariant. */
export const jsonInvariant = defineCheck(
  (opts: { assert: readonly JsonAssert[] }): Check =>
    (ctx) => {
      return answer(ctx, jsonViolations(touched(ctx).content, opts.assert));
    },
);

/** Of some exported names, which are never mentioned in the sibling test's text? */
export function unreferenced(names: readonly string[], siblingText: string): string[] {
  return names.filter((n) => !new RegExp(`\\b${escapeRe(n)}\\b`).test(siblingText));
}

/**
 * The names a TypeScript source exports — functions, classes and consts.
 *
 * A real parser rather than a regex, because `export const x = …` inside a string or a comment is
 * exactly the false positive that teaches people to ignore a rule. Parsing is not reaching the
 * world — a string in, a tree out — which is why the grammar library sits in this layer's import
 * allowlist beside the HTML parser, and why the import is dynamic: the native binding costs real
 * milliseconds to load and no other check needs it.
 */
export async function exportedNames(content: string): Promise<string[]> {
  const { parse, Lang } = await import("@ast-grep/napi");
  const root = parse(Lang.Tsx, content).root();
  const out = new Set<string>();
  for (const p of ["export function $N($$$) { $$$ }", "export class $N { $$$ }", "export const $N = $V"]) {
    for (const m of root.findAll(p)) {
      const n = m.getMatch("N");
      if (n) out.add(n.text());
    }
  }
  return [...out];
}

/** Every exported symbol is referenced in its sibling test. */
export const symbolsInSibling = defineCheck(
  (opts: { sibling: string }): Check =>
    async (ctx) => {
      const { path, content } = touched(ctx);
      const sibling = expandTemplate(opts.sibling, path);
      if (!(await ctx.fs.exists(sibling))) return ctx.fail(`sibling test not found: ${sibling}`);
      const text = await ctx.fs.read(sibling);
      const missing = unreferenced(await exportedNames(content), text);
      return answer(ctx, missing.map((n) => `exported '${n}' is never referenced in ${sibling}`));
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMIT — claims about the set of files moving together
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The changed set this event is about.
 *
 * ONE read, in one place, because three separate checks used to derive it three ways: the commit
 * gate had it as an event fact, the tool-gate re-shelled for it, and change-together shelled for
 * it again with its own error handling. It is an event FACT first — the adapter puts the staged
 * paths on ctx at the commit moment — and a capability call only when the moment carried none,
 * which is what lets a `.test()` case supply it as plain data.
 */
export async function changedSet(ctx: Ctx): Promise<readonly string[]> {
  if (ctx.staged) return ctx.staged;
  return ctx.git.stagedFiles();
}

/** One "these move together" group: if any `if` glob changed, some `thenAny` glob must have too. */
export interface ChangeGroup {
  readonly if: readonly string[];
  readonly thenAny: readonly string[];
}

/** Which groups were triggered without their companion. */
export function lonelyChanges(changed: readonly string[], groups: readonly ChangeGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    if (!changed.some((f) => matchAny(f, g.if))) continue;
    if (changed.some((f) => matchAny(f, g.thenAny))) continue;
    out.push(`${g.if.join(", ")} changed but none of [${g.thenAny.join(", ")}] did in the same commit`);
  }
  return out;
}

/** Files that must move in the SAME commit — a schema and its migration, a dep and its lockfile. */
export const changeTogether = defineCheck(
  (opts: { groups: readonly ChangeGroup[] }): Check =>
    async (ctx) => {
      return answer(ctx, lonelyChanges(await changedSet(ctx), opts.groups));
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMMANDS — reading a command line, and what a commit owes
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The tokeniser is here rather than with the adapter because judging a command IS a check's job:
// the string arrives as an event fact, already in memory, and what it MEANS is a question about
// shell and git syntax rather than about any harness. Its old twin, the `git status --porcelain`
// parser, went the other way and belongs with the adapter — that one reads the world's format.

// A NEWLINE separates commands too. Leaving it out meant anything after a line break was
// invisible: `git commit -m "bad"` judged on line one, sailing through as line two of a multi-line
// block — which is exactly how an agent batches commands.
const OPERATORS = new Set([";", "&&", "||", "|", "&", "|&", "\n"]);

/**
 * git's own options that TAKE A VALUE, and therefore swallow the token after them.
 *
 * They have to be known by name to find where the subcommand starts: `git -C ~/repo commit -m x`
 * puts two tokens between `git` and `commit`, and a scan that took the first argument as the
 * subcommand saw `-C` and walked away. The bug that earned the list: a scan for `-C` anywhere in
 * the token stream read `git commit -C HEAD` — git's reuse-this-message flag, nothing to do with
 * directories — as a command aimed at a directory named HEAD.
 */
export const GIT_VALUE_OPTS: ReadonlySet<string> = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

function findDquoteEnd(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') return i;
  }
  return -1;
}

/**
 * A shell-ish tokeniser: quotes respected (so a commit message mentioning `git commit` is not a
 * second command), operators emitted as their own tokens.
 *
 * Null on unparseable input — an unclosed quote — and null means "cannot tell", which every caller
 * must read as "do not judge". A guard that guesses at a line it cannot parse is worse than one
 * that stands aside.
 */
export function tokenizeCommand(command: string): string[] | null {
  const cmd = command;
  const tokens: string[] = [];
  let cur = "";
  let started = false;
  let i = 0;
  const push = (): void => {
    if (started) tokens.push(cur);
    cur = "";
    started = false;
  };
  while (i < cmd.length) {
    const c = cmd[i] as string;
    if (c === "'" || c === '"') {
      const end = c === "'" ? cmd.indexOf("'", i + 1) : findDquoteEnd(cmd, i + 1);
      if (end === -1) return null;
      cur += c === '"' ? cmd.slice(i + 1, end).replace(/\\(["\\$`])/g, "$1") : cmd.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[i + 1] as string;
      started = true;
      i += 2;
    } else if (c === "\n") {
      push();
      tokens.push("\n");
      i++;
    } else if (/\s/.test(c)) {
      push();
      i++;
    } else if (c === ";" || c === "|" || c === "&") {
      push();
      const two = cmd.slice(i, i + 2);
      if (two === "&&" || two === "||" || two === "|&") {
        tokens.push(two);
        i += 2;
      } else {
        tokens.push(c);
        i++;
      }
    } else {
      cur += c;
      started = true;
      i++;
    }
  }
  push();
  return tokens;
}

/** One `git …` in a command line, split where git stops and its subcommand starts. */
export interface GitInvocation {
  /** git's OWN options, before the subcommand — where `-C` counts and only there. */
  readonly globals: readonly string[];
  /** The subcommand word (`commit`, `status`), or null when the invocation carries none. */
  readonly subcommand: string | null;
  /** Everything after the subcommand — its own flags and arguments. */
  readonly args: readonly string[];
}

/**
 * Every git invocation in a command line, in order. Null when the line cannot be parsed at all.
 *
 * A token only starts an invocation at a COMMAND position — the start of the line or just after an
 * operator — so a `git` inside a quoted message or as an argument to something else is not one.
 */
export function gitInvocations(command: string): GitInvocation[] | null {
  const tokens = tokenizeCommand(command);
  if (!tokens) return null;
  const out: GitInvocation[] = [];
  let i = 0;
  let atCommand = true;
  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (OPERATORS.has(tok)) {
      atCommand = true;
      i++;
      continue;
    }
    if (atCommand && tok === "git") {
      const words: string[] = [];
      let j = i + 1;
      while (j < tokens.length && !OPERATORS.has(tokens[j] as string)) words.push(tokens[j++] as string);
      let k = 0;
      while (k < words.length) {
        const a = words[k] as string;
        if (GIT_VALUE_OPTS.has(a)) k += 2;
        else if (a.startsWith("-")) k += 1;
        else break; // the subcommand
      }
      out.push({ globals: words.slice(0, k), subcommand: words[k] ?? null, args: words.slice(k + 1) });
      i = j;
      atCommand = false;
      continue;
    }
    atCommand = false;
    i++;
  }
  return out;
}

/**
 * The body of the first heredoc in the raw command, or null.
 *
 * `git commit -F -` reads its message on stdin, and a QUOTED heredoc is the safe way to write one
 * containing backticks — a form this codebase's own rules push commits toward. The argument scan
 * cannot see it: there is no `-m` token, so every message written that way went unjudged. Measured
 * 2026-08-09: all eight commits of one session used this form, and the three rules that read the
 * message were inert on every one of them.
 *
 * Deliberately last-resort and deliberately dumb — it runs only when no inline message was found,
 * and reads the FIRST heredoc, because a commit command carrying two is not a shape anyone writes
 * and guessing between them would be worse than the gap.
 */
export function heredocBody(command: string): string | null {
  const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(command);
  if (!open) return null;
  const delimiter = open[2];
  const rest = command.slice(open.index + open[0].length);
  const lines = rest.split("\n").slice(1); // the rest of the opening line is not body
  const end = lines.findIndex((l) => l.trim() === delimiter);
  if (end === -1) return null; // unterminated — not ours to guess at
  const body = lines.slice(0, end).join("\n").trim();
  return body === "" ? null : body;
}

/**
 * The message a `git commit` in this command line carries, or null when there is no judgeable
 * commit in it at all. Null is the "not our business" answer and every caller passes on it.
 *
 * EVERY `-m` IS READ, AND THEY JOIN AS PARAGRAPHS. This returned the FIRST one and stopped, which
 * made `git commit -m "<subject>" -m "<body>"` — git's own two-paragraph form, and the one an agent
 * reaches for when the reason will not fit in a subject — a commit whose body was never read. The
 * consequence was not a missed block but the worse direction: a commit that HAD recorded its reason
 * in the second `-m` was refused, on the one rail whose whole job is to be obeyed.
 *
 * The separator is a BLANK line because that is what git writes. Verified rather than assumed:
 * `git commit -m a -m b -m c` then `git log --format=%B | od -c` shows `a\n\nb\n\nc\n\n`.
 *
 * The forms it sees, settled from the two scripts this absorbed rather than invented:
 *
 *   git commit -m MSG · -mMSG · --message MSG · --message=MSG      judged
 *   git commit -m SUBJECT -m BODY   (repeated, any mix of forms)   judged, joined as git joins them
 *   git commit -F - <<'EOF' … EOF   (any heredoc on the line)      judged, via the heredoc body
 *   git commit -F path/to/file                                     NOT judged — the message is on
 *                                                                  disk, and reading it is a read
 *                                                                  of the world this layer does not
 *                                                                  do
 *   git commit            (an editor commit, no message anywhere)  NOT judged — there is nothing to
 *                                                                  read before the editor opens
 *
 * The boundary is on the record: this rail polices AGENT-typed commits, which are its audience. A
 * human committing from an editor is not its subject and never was.
 */
export function commitMessage(command: string): string | null {
  const invocations = gitInvocations(command);
  if (!invocations) return null; // unparseable → cannot tell → do not judge
  const commit = invocations.find((inv) => inv.subcommand === "commit");
  if (!commit) return null;
  const parts: string[] = [];
  for (let i = 0; i < commit.args.length; i++) {
    const a = commit.args[i] as string;
    if (a === "-m" || a === "--message") {
      const value = commit.args[i + 1];
      if (value === undefined) break; // a trailing `-m` with nothing after it — git would refuse too
      parts.push(value);
      i++; // STEP OVER the value: without this a message that looks like a flag is read twice
      continue;
    }
    if (a.startsWith("-m") && a !== "-m") parts.push(a.slice(2)); // -mMESSAGE
    else if (a.startsWith("--message=")) parts.push(a.slice("--message=".length));
  }
  if (parts.length) return parts.join("\n\n");
  // No inline message: it may still be on stdin. An EDITOR commit (neither `-m` nor a heredoc)
  // returns null and passes, which is the narrow scope this rail has always kept.
  return heredocBody(command);
}

/** One shell argument, single-quoted so nothing in it can be expanded or re-parsed. */
export function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `-C <path>` prefix a command's first git invocation carries, quoted, or the empty string.
 *
 * It is COPIED rather than resolved. The old engine turned it into an absolute root, because it
 * had a root to resolve against and a `spawnSync` cwd to point at one; a check has neither, and
 * inventing a `root` on ctx to get one back would put a filesystem fact into a contract whose whole
 * promise is that there is no filesystem in it. Copying the tokens through means the shell resolves
 * them exactly as git would have, relative to wherever `ctx.exec` runs — which is the repo.
 *
 * The misfire it preserves the fix for: a `git -C ~/other-repo commit` was once judged against THIS
 * repo's staged state, and vetoed another repo's commit over files it could not see.
 *
 * The FIRST invocation decides. One ctx serves the whole command line, and a chain that commits in
 * two different repos is beyond what one answer can honestly describe.
 */
export function gitDirPrefix(command: string): string {
  const first = gitInvocations(command)?.[0];
  if (!first) return "";
  const out: string[] = [];
  for (let i = 0; i < first.globals.length - 1; i++) {
    if (first.globals[i] === "-C") out.push("-C", quoteArg(first.globals[i + 1] as string));
  }
  return out.join(" ");
}

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
export function givesReason(message: string, token: string): boolean {
  return new RegExp(`^[ \\t]*${escapeRe(token)}[ \\t]*:`, "im").test(message);
}

/** What the working tree is about to carry, split by whether each path is new to the repo. */
export interface WorkingState {
  /** Everything that moved — tracked edits, staged adds, and untracked files. */
  readonly changed: readonly string[];
  /** The subset that is NEW here: a staged add, or untracked. */
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
export function addedNames(diff: string, patterns: readonly string[], known: readonly string[] = []): string[] {
  const seen = new Set(known);
  const found = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);
    for (const pattern of patterns) {
      const re = new RegExp(pattern, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        if (m[1] !== undefined && !seen.has(m[1])) found.add(m[1]);
        if (m[0] === "") re.lastIndex++; // a pattern that can match empty would spin here
      }
    }
  }
  return [...found];
}

export interface ReasonInput {
  /** The commit message, as the command line carries it. */
  readonly message: string;
  /**
   * What the working tree has to say — index and worktree, tracked and untracked.
   *
   * Deliberately the generous reading: a commit is usually typed straight after the staging,
   * `git commit -a` sweeps tracked worktree edits in, and the cost of asking for a sentence that
   * was not strictly owed is a sentence, while the cost of missing one is the record this rule
   * exists to keep.
   */
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
  readonly namesAdded?: readonly { readonly name: string; readonly file: string }[] | undefined;
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
export function reasonHits(o: ReasonInput): string[] {
  const { message, state, whenChanged, whenAdded, except, namesAdded, token } = o;
  const isNew = new Set(state.added);
  const asked: string[] = [];
  for (const path of state.changed) {
    if (except && matchAny(path, except)) continue;
    if (isNew.has(path) && whenAdded && matchAny(path, whenAdded)) asked.push(`\`${path}\` (new)`);
    else if (whenChanged && matchAny(path, whenChanged)) asked.push(`\`${path}\` (changed)`);
  }
  for (const { name, file } of namesAdded ?? []) asked.push(`\`${name}\` (added in ${file})`);
  if (!asked.length) return [];
  if (givesReason(message, token)) return [];
  return [
    `${asked.join(" · ")} — and this commit's message records no reason. ` +
      `Put \`${token}: <why>\` on a line of its own in the message; the act is fine, doing it silently is not.`,
  ];
}

/** Lines of output as a path list — the shape all three commands below answer in. */
function pathLines(out: string): string[] {
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

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
 * AT WHICH RAIL, and the boundary that comes with it: the COMMAND moment — the Bash rail, before
 * the command runs, which is where an agent's commit can still be stopped and rewritten. git's own
 * commit-msg hook (which would also catch a human committing from an editor) was considered and
 * shelved on the record: the agent is the audience.
 *
 * THREE COMMANDS, AND NOT `git status`. The old script read `git status --porcelain=v1` and carried
 * a fixed-width parser for the answer. That parser reads the world's own format and went with the
 * adapter; what is left here asks three questions whose answers need no format knowledge at all —
 * each one is a list of paths, one per line. It is also strictly better: the porcelain parser had a
 * war story about eating the first character of a path, and there is now no column to slice.
 *
 * …AND IT ASKS THEM ONLY WHEN A PATH CONDITION IS BOUND. A binding that names `diffAdds` alone —
 * the verb ratchets in both house packs do — reads one diff and nothing else. This is not a
 * micro-optimisation: every one of these commands is a question a `.test()` case has to answer, so
 * asking three that cannot change the verdict makes every case for a diff-adds entry carry three
 * lines of git output that mean nothing, and a case full of noise is a case nobody re-reads.
 *
 * Fails safe on every read: not a git repo, or git unavailable, and the check stands aside rather
 * than trapping a commit it cannot judge.
 */
export const commitReason = defineCheck(
  (opts: {
    whenChanged?: readonly string[];
    whenAdded?: readonly string[];
    except?: readonly string[];
    diffAdds?: readonly DiffAdds[];
    token: string;
  }): Check =>
    async (ctx) => {
      // The message first, and no git call unless there is one: a command that is not a judgeable
      // commit is the overwhelming majority of everything typed at this rail.
      const message = commitMessage(ctx.command ?? "");
      if (message == null) return ctx.ok();

      const git = `git ${gitDirPrefix(ctx.command ?? "")}`.trimEnd();

      let state: WorkingState = { changed: [], added: [] };
      if (opts.whenChanged || opts.whenAdded) {
        const [tracked, adds, untracked] = await Promise.all([
          ctx.exec(`${git} diff HEAD --name-only`),
          ctx.exec(`${git} diff HEAD --name-only --diff-filter=A`),
          ctx.exec(`${git} ls-files --others --exclude-standard`),
        ]);
        if (tracked.code !== 0 || adds.code !== 0 || untracked.code !== 0) return ctx.ok();
        const untrackedPaths = pathLines(untracked.stdout);
        state = {
          changed: [...new Set([...pathLines(tracked.stdout), ...untrackedPaths])],
          added: [...pathLines(adds.stdout), ...untrackedPaths],
        };
      }

      const namesAdded: { name: string; file: string }[] = [];
      for (const surface of opts.diffAdds ?? []) {
        // `git diff HEAD`, so a staged add and an unstaged edit both count — `git commit -a`
        // sweeps the second in, and the generous reading is the same one the path conditions take.
        const diff = await ctx.exec(`${git} diff HEAD -- ${quoteArg(surface.file)}`);
        if (diff.code !== 0) return ctx.ok();
        for (const name of addedNames(diff.stdout, surface.patterns, surface.known ?? []))
          namesAdded.push({ name, file: surface.file });
      }

      const hits = reasonHits({
        message,
        state,
        whenChanged: opts.whenChanged,
        whenAdded: opts.whenAdded,
        except: opts.except,
        namesAdded,
        token: opts.token,
      });
      return answer(ctx, hits);
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TURN — what the actor did since it last ran something
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Did an `edited`-matching edit happen AFTER the last run of `mustRun`? True is the violation.
 *
 * `edited` is REQUIRED, and that is a fix rather than a tightening: an empty list makes this answer
 * false for every turn, so a binding that left it out was a rule the engine loaded, counted, and
 * could never fire.
 */
function editedSinceRun(actions: readonly TurnAction[], edited: readonly string[], mustRun: string): boolean {
  if (mustRun === "" || edited.length === 0) return false;
  let lastEdit = -1;
  let lastRun = -1;
  actions.forEach((a, i) => {
    if (a.did === "edit" && matchAny(a.path, edited)) lastEdit = i;
    if (a.did === "run" && a.command.includes(mustRun)) lastRun = i;
  });
  return lastEdit >= 0 && lastEdit > lastRun;
}

/**
 * "You changed X this turn but never ran Y afterwards" — the turn-end rule.
 *
 * The actions arrive as harness-neutral facts on ctx. That is the change from the old engine, where
 * this rule read `$WORK_TURN_TRANSCRIPT` from the environment, opened the file itself and parsed
 * Claude Code's JSONL: three reads of the world inside a rule script, which made it the one core
 * rule no case could drive and no replay could reach. Which tool names count as an edit is the
 * adapter's knowledge and stays there.
 *
 * Stands aside when the moment carried no turn facts at all: there is nothing to judge, and a rule
 * that blocked on the absence of evidence would block every turn on a harness that supplies none.
 */
export const ranSinceEdit = defineCheck(
  (opts: { edited: readonly string[]; mustRun: string }): Check =>
    (ctx) => {
      if (!ctx.turn) return ctx.ok();
      return editedSinceRun(ctx.turn, opts.edited, opts.mustRun)
        ? ctx.fail(`edited ${opts.edited.join(", ")} this turn but never ran \`${opts.mustRun}\` afterwards`)
        : ctx.ok();
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS — orchestrate, never reimplement
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Three checks here delegate to a real tool, and the doctrine is the same for all of them: the tool
// owns its own job and its own config; flow decides WHEN it runs and what a failure means. The
// graph walk stays dependency-cruiser's, the parse stays ast-grep's, the test suite stays the
// repo's. Each reaches its tool through `ctx.exec` or, for the in-process parser, an import — and
// never through disk.

/**
 * Should a scoped gate skip — is its area untouched?
 *
 * True only when `changed` globs are given AND none of the changed files match, so a file-scoped
 * gate (a type-checker for `site/**`) stays quiet on commits that do not touch its area. No globs,
 * or nothing changed to judge → run it. Fail-safe: never silently skip a gate we cannot scope.
 */
export function skipForChanged(files: readonly string[], changed: readonly string[] | undefined): boolean {
  const globs = changed ?? [];
  if (!globs.length) return false;
  if (!files.length) return false;
  return !files.some((f) => matchAny(f, globs));
}

/**
 * The lines worth showing FIRST when a tool fails — the errors, not the success chatter.
 *
 * Prefer lines that look like a failure; fall back to the tail. Capped, so a blocked commit stays
 * terse: quiet on pass, and on failure the error is up top rather than buried under a progress log.
 */
export function failureExcerpt(output: string, cap = 8): string {
  const lines = output.trim().split("\n").filter(Boolean);
  const hot = lines.filter(
    (l) => /\b(fail|failed|error|not ok|assert|expected|cannot|undefined)\b/i.test(l) || /[✖✗✘]/.test(l),
  );
  return (hot.length ? hot : lines.slice(-6)).slice(0, cap).join("\n");
}

/**
 * Run a whole-project tool and block on its failure — the one tool-delegated check.
 *
 * Some checks need the whole tree in a consistent state (a transitive import boundary, coverage,
 * the type graph) and cannot run per keystroke, so this belongs at commit or turn-end.
 *
 * IT IS HANDED THE CHANGED SET, which is what the old tool-gate was not. That rule spawned its tool
 * with empty argv and no file list, so a repo's own script had to re-scan the whole tree and could
 * never name the file that broke it — the whole of P6, and the reason a repo's own logic felt
 * second-class. Here the changed set is an event fact: it scopes the gate (`changed`), and
 * `{files}` in the run string expands to the files themselves, shell-quoted. A run string naming
 * `{files}` with nothing changed does not run at all, because a tool handed an empty file list
 * usually reads that as "do everything".
 */
export const execPasses = defineCheck(
  (opts: { run: string; changed?: readonly string[] }): Check =>
    async (ctx) => {
      const files = await changedSet(ctx);
      if (skipForChanged(files, opts.changed)) return ctx.ok();
      const wantsFiles = opts.run.includes("{files}");
      if (wantsFiles && files.length === 0) return ctx.ok();
      const run = wantsFiles ? opts.run.replace("{files}", files.map(quoteArg).join(" ")) : opts.run;
      const result = await ctx.exec(run);
      if (result.code === 0) return ctx.ok();
      return ctx.fail(`\`${run}\` failed (exit ${result.code}):\n${failureExcerpt(result.stderr || result.stdout)}`);
    },
);

// ── depcruise: the layers-and-fences dialect, compiled to the tool's own schema ──────────────

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
export interface Dialect {
  /** What to cruise. A GLOB, because a bare directory makes depcruise cruise zero modules. */
  readonly scan: string;
  readonly layers: Readonly<Record<string, readonly string[]>>;
  /** Fail-closed allowlist: a layer may reach ONLY these layers. */
  readonly only?: Readonly<Record<string, readonly string[]>>;
  /** Forbidden edges, each carrying the `why` its violation prints. */
  readonly forbid?: readonly (ForbidEdge | "circular" | "orphans")[];
  /** An inverted fence: modules in a path MUST import a target. */
  readonly require?: readonly RequireEdge[];
  /** Carve-outs — `type-only` above all, since a type import is erased at compile time. */
  readonly except?: readonly string[];
  /** Informational rules that never block. `sdp` = the Stable Dependencies Principle. */
  readonly warn?: readonly string[];
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
export function globToRe(glob: string): string {
  const tokens = tokenizeGlob(glob);
  const trailing = tokens[tokens.length - 1]?.kind === "globstar";
  const body = (trailing ? tokens.slice(0, -1) : tokens).map(globTokenToRegExp).join("");
  return `^${body}${trailing ? "" : "$"}`;
}

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
export function entryToMatcher(entry: string): { core?: true; path?: string } {
  if (entry === "node:*") return { core: true };
  if (entry.startsWith("node:")) return { path: `^${escapeRe(entry)}$` };
  if (entry.includes("/") || entry.includes("*") || entry.includes(".")) return { path: globToRe(entry) };
  return { path: `node_modules/${escapeRe(entry)}(/|$)` };
}

/** Layer names → a depcruise matcher fragment. `path` is an OR-list; builtins become a type. */
export function layersMatcher(
  names: readonly string[],
  layers: Readonly<Record<string, readonly string[]>>,
): Matcher {
  const path: string[] = [];
  let core = false;
  for (const name of names) {
    for (const entry of layers[name] ?? []) {
      const m = entryToMatcher(entry);
      if (m.core) core = true;
      else if (m.path) path.push(m.path);
    }
  }
  const out: Matcher = {};
  if (path.length) out["path"] = path;
  if (core) out["dependencyTypes"] = ["core"];
  return out;
}

/** The whole dialect → a native `{ forbidden, required, options }` config. */
export function compileDialect(rule: Dialect): NativeConfig {
  const layers = rule.layers;
  const forbidden: NativeRule[] = [];
  const required: NativeRule[] = [];
  const typeOnlyAllowed = (rule.except ?? []).includes("type-only");
  // A `to` matcher gets the type-only carve-out: a type-only import is erased at compile time, so
  // it is never a real edge and never fenced.
  const withExcept = (to: Matcher): Matcher =>
    typeOnlyAllowed ? { ...to, dependencyTypesNot: ["type-only"] } : to;

  // ── only: fail-closed allowlist. From a layer, importing anything NOT in the allowed layers
  //    blocks — so the list grows only by deliberate decision, at the moment of need.
  for (const [layer, allowed] of Object.entries(rule.only ?? {})) {
    const allow = layersMatcher(allowed, layers);
    const to: Matcher = { pathNot: allow["path"] ?? [] };
    forbidden.push({
      name: `${layer}-only`,
      severity: "error",
      comment: `${layer} may import only: ${allowed.join(", ")} — an unlisted import blocks here (add it to a layer, or keep it out).`,
      from: layersMatcher([layer], layers),
      to: withExcept(to),
    });
  }

  // ── forbid: edges between layers, plain circular, orphans, cyclesBetween.
  for (const f of rule.forbid ?? []) {
    if (f === "circular") {
      forbidden.push({
        name: "no-circular",
        severity: "error",
        comment: "no dependency cycles",
        from: { pathNot: "node_modules" },
        to: { circular: true },
      });
    } else if (f === "orphans") {
      forbidden.push({
        name: "no-orphans",
        severity: "warn",
        comment: "unreferenced module",
        from: { orphan: true, pathNot: "node_modules|\\.d\\.ts$" },
        to: {},
      });
    } else if (f.cyclesBetween !== undefined) {
      // A feature importing a DIFFERENT feature (sideways). Capture the feature folder from the
      // layer's first glob and forbid an import into a sibling feature via a backreference.
      const cyc = f.cyclesBetween;
      const first = (layers[cyc] ?? [])[0] ?? "";
      const base = globToRe(first)
        .replace(/\$$/, "")
        .replace(/\[\^\/\]\*$/, "([^/]+)"); // last * → capture
      forbidden.push({
        name: `no-cycles-between-${cyc}`,
        severity: "error",
        comment: f.why ?? `${cyc} must not import sideways`,
        from: { path: `${base}/` },
        to: withExcept({ path: `${base.replace(/\(\[\^\/\]\+\)/, "[^/]+")}/`, pathNot: "$1/" }),
      });
    } else if (f.from !== undefined && f.to !== undefined) {
      const to: Matcher = { ...layersMatcher([f.to], layers) };
      if (f.transitive === true) to["reachable"] = true; // purity is about what core can REACH
      forbidden.push({
        name: `no-${f.from}-to-${f.to}${f.transitive === true ? "-transitive" : ""}`,
        severity: "error",
        comment: f.why ?? `${f.from} must not import ${f.to}`,
        from: layersMatcher([f.from], layers),
        to: withExcept(to),
      });
    }
  }

  // ── require: an INVERTED rule — modules in a path MUST import a target.
  for (const r of rule.require ?? []) {
    required.push({
      name: `must-import-${r.import}`,
      severity: "error",
      comment: r.why ?? `modules in ${r.in} must import ${r.import}`,
      module: { path: globToRe(r.in) },
      to: { path: globToRe(r.import) },
    });
  }

  // ── warn: informational only.
  for (const w of rule.warn ?? []) {
    if (w === "sdp") {
      forbidden.push({
        name: "sdp",
        severity: "warn",
        comment: "depends on a more-unstable module (Stable Dependencies Principle)",
        from: {},
        to: { moreUnstable: true },
      });
    }
  }

  // options: resolve TS/JS imports to real module paths (so a fence's `to` matches a resolved file,
  // not a bare './db'), and record edges into node_modules without walking their trees.
  const options: Record<string, unknown> = {
    enhancedResolveOptions: { extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"] },
    doNotFollow: { path: "node_modules" },
    // Post-compilation deps only: a pure `import type {…}` is erased at compile time, so it never
    // becomes an edge and is transparent to every fence for free. The `except: [type-only]`
    // affordance still emits its carve-out for anyone who flips this to true.
    tsPreCompilationDeps: false,
    ...(rule.options ?? {}),
  };
  return { forbidden, required, options };
}

/** The delimiter of the heredoc the run command carries its config in. */
const CONFIG_HEREDOC = "FLOW_DEPCRUISE_CONFIG";

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
export function depcruiseCommand(dialect: Dialect): string {
  const config = JSON.stringify(compileDialect(dialect));
  return [
    `d=$(mktemp -d)`,
    `cat > "$d/dc.json" <<'${CONFIG_HEREDOC}'`,
    config,
    CONFIG_HEREDOC,
    `npx --no-install depcruise --config "$d/dc.json" --output-type json ${quoteArg(dialect.scan)}`,
    `rc=$?`,
    `rm -rf "$d"`,
    `exit $rc`,
  ].join("\n");
}

interface DepcruiseViolation {
  rule?: { name?: string; comment?: string };
  comment?: string;
  from?: string;
  to?: string;
}

/** The tool's JSON report → one hit per violation, each naming the fence and its `why`. */
export function depcruiseHits(result: ExecResult): string[] {
  let json: { summary?: { violations?: DepcruiseViolation[] } };
  try {
    json = JSON.parse(result.stdout || "") as { summary?: { violations?: DepcruiseViolation[] } };
  } catch {
    // No parseable JSON. Exit 0 with no report is an empty cruise; anything else is a real failure
    // — a bad config, a missing tool — and saying so beats reporting a clean graph.
    if (result.code === 0) return [];
    return [`depcruise failed (exit ${result.code}): ${failureExcerpt(result.stderr || result.stdout, 3)}`];
  }
  return (json.summary?.violations ?? []).map((v) => {
    const name = v.rule?.name ?? "fence";
    const why = v.comment ?? v.rule?.comment ?? ""; // the fence's own reason, when depcruise echoes it
    return `${name}: ${v.from} → ${v.to}${why ? ` — ${why}` : ""}`;
  });
}

/**
 * The generic import-fence runner.
 *
 * A whole-graph check: bind it at commit or turn-end, never per keystroke. It orchestrates and
 * never reimplements — the graph walk is dependency-cruiser's job, and the dialect above exists
 * only so the fences are readable by the person who has to change them.
 */
export const depcruise = defineCheck(
  (opts: Dialect): Check =>
    async (ctx) => {
      return answer(ctx, depcruiseHits(await ctx.exec(depcruiseCommand(opts))), "\n");
    },
);

// ── ast-grep: ban or require a code SHAPE, parsed rather than matched ────────────────────────

/**
 * The tier-0 grammars, and which `Lang` member each name resolves to.
 *
 * Spelled as member NAMES rather than as the members themselves, so the list can be read without
 * loading the native binding — one list, so a grammar cannot be built in at match time and unknown
 * to a caller asking what is available.
 */
const NATIVE: Readonly<Record<string, string>> = {
  html: "Html",
  css: "Css",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "Tsx",
  jsx: "Tsx", // ast-grep has no separate Jsx grammar; Tsx is the superset
};

/** The grammars that need no install. */
export const NATIVE_LANGUAGES: readonly string[] = Object.keys(NATIVE);

/** Dynamic grammars registered in this process. Registration is idempotent and lazy. */
const registered = new Set<string>();

/** A resolved grammar, or the sentence saying why there is none. */
type LangResult = { readonly ok: true; readonly lang: unknown } | { readonly ok: false; readonly detail: string };

/**
 * Resolve a grammar name to something `parse()` accepts.
 *
 * TWO ROUTES, down from the old engine's three. A tier-0 native is free. A published
 * `@ast-grep/lang-<name>` package (sql, python, go, rust…) is registered on first use — its
 * compiled binary lives in node_modules, and `registerDynamicLanguage` is safe to call per grammar.
 *
 * The route that did NOT come across is the third: a hand-built grammar declared in an
 * `sgconfig.yml` under the rule library. flow has no library — that is the whole of P1 — and
 * resolving one would mean reading a YAML file from a path this layer may not touch. It can come
 * back the day someone needs it, as a parameter naming a built `.so`, which would be a decision
 * rather than a leftover.
 *
 * An unknown name is a REFUSAL VALUE, and it never falls through to Tsx. The check turns it into a
 * block, which is the fail-loud doctrine at its narrowest and most useful: a silent fall-through is
 * how a rule ends up parsing the wrong grammar, matching nothing, and reporting green forever.
 */
export async function resolveLang(name: string): Promise<LangResult> {
  const { Lang, registerDynamicLanguage } = await import("@ast-grep/napi");
  const member = NATIVE[name];
  if (member !== undefined) return { ok: true, lang: (Lang as unknown as Record<string, unknown>)[member] };
  if (registered.has(name)) return { ok: true, lang: name };
  try {
    const mod = (await import(`@ast-grep/lang-${name}`)) as { default?: unknown };
    registerDynamicLanguage({ [name]: (mod.default ?? mod) as never });
    registered.add(name);
    return { ok: true, lang: name };
  } catch {
    return {
      ok: false,
      detail:
        `unknown ast-grep grammar: '${name}'. Built in: ${NATIVE_LANGUAGES.join(", ")}. ` +
        `Anything else installs as a package — \`npm i -D @ast-grep/lang-${name}\` — and is picked up here on the next run.`,
    };
  }
}

/** Every match of an ast-grep rule in some source, as `line: text` — or why there are none. */
export async function astGrepHits(
  content: string,
  rule: unknown,
  language: string,
): Promise<{ readonly ok: true; readonly hits: string[] } | { readonly ok: false; readonly detail: string }> {
  const resolved = await resolveLang(language);
  if (!resolved.ok) return resolved;
  const { parse } = await import("@ast-grep/napi");
  const root = parse(resolved.lang as never, content).root();
  return { ok: true, hits: root.findAll({ rule: rule as never }).map((m) => `${m.range().start.line + 1}: ${m.text()}`) };
}

/**
 * Ban or require a code shape.
 *
 * ast-grep is a Rust tool with a native Node binding, so the would-be file is handed over AS A
 * STRING and the matches come back — no subprocess, no temp file — which is what lets a structural
 * rule run pre-emptively on every edit as well as at commit.
 *
 * `language` is mandatory. It used to default to tsx, which mis-parses some .ts and then silently
 * matched nothing: a private fallback the entry could not show, which is exactly what "nothing
 * defaults" exists to delete.
 */
export const astGrep = defineCheck(
  (opts: { rule: unknown; language: string }): Check =>
    async (ctx) => {
      const found = await astGrepHits(touched(ctx).content, opts.rule, opts.language);
      if (!found.ok) return ctx.fail(found.detail);
      return answer(ctx, found.hits);
    },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CASES — a canned ctx, and the runner that walks every bound entry's
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A case is a canned ctx, and it CAN be, because a check reads the world only through one. That
// sentence is the whole reason the contract is shaped the way it is: `flow test` drives a core
// check, a pack's check and a repo's own bespoke check through exactly the same door the live hooks
// drive them through, with the world supplied as data.
//
// The class of bug this exists to kill: an entry whose block case was never written. Two import
// fences in a production repo compiled to dead literals, loaded green, reported healthy, and
// checked nothing for four days. A rule whose block case PASSES cannot ship — which is what makes
// cases a proof rather than a formality.

/** The four dialects a case can be written in — one per kind of event fact. */
export type CaseDialect = "command" | "write" | "commit" | "turn-end";

/**
 * WHICH GUARDRAIL MOMENTS SPEAK EACH DIALECT — the one table, and everything else reads it.
 *
 * `write` covers `delete` too, because both carry a path and the delete rail hands over the file
 * that is going away. Nothing else overlaps: a command case can only ever reach a command rail.
 */
const SPEAKS: Readonly<Record<CaseDialect, readonly GuardrailMoment[]>> = {
  command: ["command"],
  write: ["write", "delete"],
  commit: ["commit"],
  "turn-end": ["turn-end"],
};

/**
 * Read a case once: which dialect it speaks, the event facts it carries, and its recorded world.
 *
 * ONE ladder over the union, and it is the only one. There were three — this, a `caseMoment` that
 * asked the same questions to answer half of it, and a `momentSpeaks` that hard-coded the same
 * pairing a fourth time — so adding a fifth case shape meant finding three places, and missing one
 * of them would have produced a case that ran at the wrong moment rather than an error.
 */
export function readCase(c: Case): {
  readonly dialect: CaseDialect;
  readonly facts: Partial<Ctx>;
  readonly world: CaseWorld;
} {
  if (typeof c === "string") return { dialect: "command", facts: { command: c }, world: {} };
  const world = c.world ?? {};
  if ("command" in c) return { dialect: "command", facts: { command: c.command }, world };
  if ("path" in c) return { dialect: "write", facts: { file: { path: c.path, content: c.content } }, world };
  if ("staged" in c) return { dialect: "commit", facts: { staged: c.staged }, world };
  return { dialect: "turn-end", facts: { turn: c.actions }, world };
}

/** Which moment's dialect a case speaks. */
export function caseMoment(c: Case): Moment {
  return readCase(c).dialect;
}

/**
 * Build the ctx one case becomes, at one moment.
 *
 * BOTH halves are the language layer's, and deliberately the same two calls the live engine makes:
 * `cannedWorld` turns what the case wrote down into the three capabilities, and `makeCtx` assembles
 * the ctx from those and the event's facts. A case is a recorded WORLD handed to one assembler, not
 * a second kind of ctx — the moment either of those is written twice, a green case stops being
 * evidence about the live rail, which is the whole value of cases existing.
 */
export function cannedCtx(moment: Moment, c: Case, unanswered: Unanswered[]): Ctx {
  const { world, facts } = cannedParts(c, unanswered);
  return makeCtx(moment, facts, world);
}

/** A case read once: the world it recorded, assembled, and the event facts it carries. */
function cannedParts(c: Case, unanswered: Unanswered[]): { readonly world: World; readonly facts: Partial<Ctx> } {
  const { world, facts } = readCase(c);
  return { world: cannedWorld(world, facts.staged, unanswered), facts };
}

/**
 * Every ctx one case becomes for one entry — one, or one per staged file it is scoped to.
 *
 * The plural is the whole of the fan-out fix, and the world is built ONCE and shared across the
 * subjects: a case records one world, and a per-file rule reading it four times must see the same
 * four answers the live gate would.
 */
export async function caseCtxs(entry: LoadedEntry, moment: Moment, c: Case, unanswered: Unanswered[]): Promise<Ctx[]> {
  const { world, facts } = cannedParts(c, unanswered);
  const subjects = moment === "commit" ? await commitSubjects(entry, facts, world) : [facts];
  return subjects.map((subject) => makeCtx(moment, subject, world));
}

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
 */
async function commitSubjects(entry: LoadedEntry, facts: Partial<Ctx>, world: World): Promise<Partial<Ctx>[]> {
  const staged = facts.staged ?? [];
  if (!entry.spec.on) return [facts];
  const out: Partial<Ctx>[] = [];
  for (const path of staged) {
    if (!inScope(entry.spec, path)) continue;
    if (!(await world.fs.exists(path))) continue;
    out.push({ file: { path, content: await world.fs.read(path) }, staged });
  }
  return out;
}

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
export async function runCase(
  entry: LoadedEntry,
  check: Check,
  c: Case,
  expect: "pass" | "block",
  index: number,
): Promise<CaseResult> {
  const { dialect } = readCase(c);
  const at: readonly GuardrailMoment[] = entry.spec.kind === "guardrail" ? (entry.spec.at ?? []) : [];
  const moment = at.find((m) => SPEAKS[dialect].includes(m));
  const head = { entry: entry.id, expect, index };
  if (moment === undefined) {
    return {
      ...head,
      ok: false,
      detail: `this case speaks the ${dialect} dialect, and the entry fires at ${at.length ? at.join(", ") : "no moment at all"} — nothing here would ever be handed one`,
    };
  }

  const unanswered: Unanswered[] = [];
  let blocked: boolean;
  let answer: Verdict = { ok: true };
  try {
    const answers: Verdict[] = [];
    for (const ctx of await caseCtxs(entry, moment, c, unanswered)) answers.push(await check(ctx));
    // Any subject blocking blocks the commit, exactly as the engine's effects do. No subject at all
    // — a scope nothing staged fell into — is a pass, because there was nothing to refuse.
    answer = answers.find((v) => !v.ok) ?? { ok: true };
    blocked = !answer.ok;
  } catch (error) {
    return { ...head, ok: false, detail: `the check threw: ${(error as Error).message}` };
  }
  if (unanswered.length) return { ...head, ok: false, detail: unansweredText(unanswered) };

  const wanted = expect === "block";
  if (blocked === wanted) return { ...head, ok: true, detail: "" };
  if (wanted) {
    return {
      ...head,
      ok: false,
      detail: "expected a block and the check passed it — the rule does not catch what it says it catches",
    };
  }
  const why = answer.ok || answer.detail === undefined ? "" : `: ${answer.detail}`;
  return { ...head, ok: false, detail: `expected a pass and the check blocked it${why}` };
}

/** The sentence an unanswered reach earns — it names what to add to the case. */
export function unansweredText(missing: readonly Unanswered[]): string {
  return missing
    .map((m) =>
      m.kind === "exec"
        ? `the check ran \`${m.asked}\` and the case records no answer — add it under \`world.exec\``
        : `the check read \`${m.asked}\` and the case records no content — add it under \`world.fs\``,
    )
    .join(" · ");
}

/**
 * Every bound entry's cases, driven — what `flow test` is.
 *
 * Disabled entries are skipped: they are listed with their reason and never run, so asking them to
 * prove anything is how an opt-out becomes cheaper to delete than to explain. Breadcrumbs carry no
 * check and have nothing to prove. Everything else must have cases at all, which the load already
 * refused it without.
 */
export async function runCases(entries: readonly LoadedEntry[]): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const entry of entries) {
    const { spec } = entry;
    if (spec.kind !== "guardrail" || spec.disabled || !spec.check) continue;
    const check = spec.check;
    const cases = spec.test ?? {};
    for (const [expect, list] of [
      ["pass", cases.pass],
      ["block", cases.block],
    ] as const) {
      for (const [index, c] of (list ?? []).entries()) {
        out.push(await runCase(entry, check, c, expect, index));
      }
    }
  }
  return out;
}
