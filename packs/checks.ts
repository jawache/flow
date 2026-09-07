// flow/packs/checks.ts — the checks the packs in this folder need that the stock thirteen do not cover.
//
// Each one was a `.mjs` script in the home-directory rule library, discovered by a `use:` string
// and validated by a zod box nobody could see from the binding. They are ordinary exported
// functions now: imported by name, typed at their call site, and reachable only through `ctx`.
//
// WHAT DIED IN THE MOVE, and it is most of each file: the shell tokeniser (three copies across the
// library, now one, in flow), the `execFileSync` calls (every read of the world goes through
// `ctx.exec`, which is what lets a `.test()` case answer them), the zod `with:` schema (the
// parameter type IS the schema now, and it is checked in your editor), and the `kind`/`at`
// contract block (a binding says when it fires; a check does not get an opinion).
//
// HOW THEY ARE PROVED: by the `.test({ pass, block })` cases on the entries that bind them, driven
// by `flow test` through the same ctx the live rails build. That is the whole claim of a check
// being a function of ctx, and a second vitest suite over the same logic would be a second place
// for it to be right.

import {
  commitMessage,
  defineCheck,
  gitInvocations,
  givesReason,
  quoteArg,
  type Check,
  type Ctx,
} from "../index.ts";

// ── git: the commands that destroy work, and the commits that owe a sentence ──

/** `git restore` args → the working-tree paths it would overwrite. `--staged` alone touches none. */
function restoreWorktreePaths(args: readonly string[]): string[] {
  const staged = args.includes("--staged") || args.includes("-S");
  const worktree = args.includes("--worktree") || args.includes("-W");
  if (staged && !worktree) return [];
  const paths: string[] = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (afterDashDash) {
      paths.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-s" || a === "--source") {
      i++; // skip the source value
      continue;
    }
    if (a.startsWith("-")) continue;
    paths.push(a);
  }
  return paths;
}

/**
 * The working-tree paths a command line would discard, or [] when it is safe to run.
 *
 * Deliberately narrow — false negatives beat blocking real work. Only the `--` pathspec form of
 * checkout counts (branch switching passes), only the restore forms that touch the tree, and
 * `reset --hard` / `clean -f`, whose target is the tree itself.
 */
export function discardPaths(command: string): string[] {
  const invocations = gitInvocations(command);
  if (!invocations) return [];
  const paths: string[] = [];
  for (const { subcommand, args } of invocations) {
    if (subcommand === "checkout") {
      const dd = args.indexOf("--");
      if (dd !== -1) paths.push(...args.slice(dd + 1));
    } else if (subcommand === "restore") {
      paths.push(...restoreWorktreePaths(args));
    } else if (subcommand === "reset" && args.includes("--hard")) {
      // A hard reset overwrites the whole tree from a commit; it has no discarding pathspec form,
      // so the target is `.` and the dirty check below reads that as "every uncommitted file".
      paths.push(".");
    } else if (subcommand === "clean" && args.some((a) => /^-[a-zA-Z]*[fx]/.test(a) || a === "--force")) {
      const named = args.filter((a) => !a.startsWith("-"));
      paths.push(...(named.length ? named : ["."]));
    }
  }
  return paths;
}

/** Of some porcelain lines, the paths with real uncommitted work. */
export function dirtyIn(porcelain: string, includeUntracked: boolean): string[] {
  return porcelain
    .split("\n")
    .filter((l) => l !== "" && (includeUntracked || !l.startsWith("??")))
    .map((l) => l.slice(3));
}

/**
 * Blocks a git command that would silently destroy uncommitted work. No bypass, by ruling.
 *
 * `git clean` is the one form whose whole purpose is deleting UNTRACKED files, so for it the
 * untracked half of the status IS the loss; everywhere else those files survive and counting them
 * would block a safe command.
 */
export const noGitDiscard = defineCheck(
  (_opts: Record<string, never>): Check =>
    async (ctx) => {
      const command = ctx.command ?? "";
      const targets = discardPaths(command);
      if (targets.length === 0) return ctx.ok();
      const cleaning = /(^|[;&|\n]\s*)git\s+clean\b/.test(command);
      // `quoteArg` rather than a pair of typed quotes: a path with an apostrophe in it closes a
      // hand-rolled quote and the rest of the pathspec becomes shell. One quoter in this package,
      // and this is the call that was the second one.
      const status = await ctx.exec(`git status --porcelain -- ${targets.map(quoteArg).join(" ")}`);
      if (status.code !== 0) return ctx.ok(); // not a repo, or a bad pathspec — git owns that error
      const dirty = dirtyIn(status.stdout, cleaning);
      if (dirty.length === 0) return ctx.ok();
      return ctx.fail(
        dirty.map((f) => `would discard uncommitted edits to ${f} — use \`git stash\` instead (recoverable)`).join("\n"),
      );
    },
);

/** Does this header line speak Conventional Commits for the given type set? */
export function isConventional(header: string, types: readonly string[]): boolean {
  const alt = types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`^(${alt})(\\([^)]+\\))?!?: .+`).test(header.split("\n")[0] ?? "");
}

/**
 * The commit header must speak Conventional Commits v1.0.0, checked before `git commit` runs.
 *
 * `types` is stated, never defaulted: the accepted words are the whole content of the rule, and a
 * private list inside a script is a rule a reader of the entry cannot check.
 */
export const conventionalCommit = defineCheck(
  (opts: { types: readonly string[] }): Check =>
    (ctx) => {
      const message = commitMessage(ctx.command ?? "");
      if (message === null) return ctx.ok(); // nothing judgeable — an editor commit passes
      return isConventional(message, opts.types)
        ? ctx.ok()
        : ctx.fail(`commit header "${message.split("\n")[0] ?? ""}" is not Conventional Commits (type(scope)!: description)`);
    },
);

/**
 * A release commit's header — the ONE shape allowed to write a version by hand.
 *
 * `release: …` · `release(scope): …` · `release(scope)!: …` · `chore(release): …`, and a `chore`
 * ONLY with a release-ish scope.
 *
 * TWO FAULTS FIXED HERE, both found by writing the cases the crossing's audit asked for, and both
 * the same shape: a claim nobody had driven.
 *
 * The hole: the old expression was `^(release|chore)(\([^)]*release[^)]*\))?!?:` with the scope
 * group OPTIONAL, so a bare `chore:` matched — every `chore: tidy the readme` in this repo's
 * history was licensed to hand-edit the version, which is the whole thing this rule exists to
 * refuse. `chore` now REQUIRES its release scope.
 *
 * The lie: the doc line claimed `release(scope)!:` worked, and it could not — the scope group
 * demanded the word "release" inside the parentheses, so `release(flow): 1.0.0` was refused. That
 * spelling is about to be typed here for real, now that `work` and `flow` version independently.
 */
export function isReleaseCommit(message: string): boolean {
  const first = message.split("\n")[0] ?? "";
  return /^(release(\([^)]*\))?|chore\([^)]*release[^)]*\))!?:/i.test(first);
}

// JSON and TOML in one expression — `"version": "1.2.3"` and `version = "1.2.3"` ask the identical
// question, and three parsers for one line is three things to get wrong.
const VERSION_LINE = /["']?\bversion["']?\s*[:=]\s*["']?(\d+\.\d+\.\d+[^"',\s]*)/;

/**
 * Does this diff change the version VALUE?
 *
 * Values on both sides, compared — never "an added line mentions version". Adding a key after the
 * version rewrites its line (it gains a comma), and a rule that fired on every reformat is a rule
 * whose message people stop reading.
 */
export function changesVersion(diff: string): boolean {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const m = VERSION_LINE.exec(line);
    if (!m?.[1]) continue;
    if (line.startsWith("+")) added.push(m[1]);
    else if (line.startsWith("-")) removed.push(m[1]);
  }
  return added.some((v) => !removed.includes(v));
}

/** The version field is written by the release commit, never by hand. */
export const noHandEditedVersion = defineCheck(
  (opts: { versionFile: string; recipe: string }): Check =>
    async (ctx) => {
      const message = commitMessage(ctx.command ?? "");
      if (message === null) return ctx.ok();
      if (isReleaseCommit(message)) return ctx.ok(); // the one shape that may write it
      // `git diff HEAD` — staged AND unstaged, because `git commit -a` sweeps the second lot in.
      const diff = await ctx.exec(`git diff HEAD -- ${opts.versionFile}`);
      if (diff.code !== 0) return ctx.ok();
      if (!changesVersion(diff.stdout)) return ctx.ok();
      return ctx.fail(
        `this commit hand-edits the \`version\` field in ${opts.versionFile}. The version is COMPUTED ` +
          `from the commit history at release time — run \`${opts.recipe}\`, which writes the version, ` +
          `the changelog and the tag together. (A real release commit, headed \`release:\` or ` +
          `\`chore(release):\`, passes.)`,
      );
    },
);

// ── the justfile: every recipe is discoverable ───────────────────────────────

/** Words that open a non-recipe construct at column 0. */
const RESERVED = new Set(["set", "alias", "export", "import", "mod", "unexport"]);

/**
 * Recipes with no `[doc(…)]` attribute, as `{ name, line }` (1-based).
 *
 * `[private]` recipes are SKIPPED, and that is a fix rather than a nicety: `just --list` hides
 * them, so a private recipe is not in the catalogue and cannot owe the catalogue a description.
 * The message has claimed this exemption from the day it was written and the walk never honoured
 * it — a rule that refuses what its own sentence promises to allow is the worst kind, because the
 * reader does the thing they were told to do and is refused anyway.
 */
export function undocumentedRecipes(text: string, exempt: readonly string[] = []): { name: string; line: number }[] {
  const ex = new Set(exempt);
  const lines = text.split("\n");
  const bad: { name: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = /^(@?[A-Za-z_][A-Za-z0-9_-]*)(\s|:)/.exec(line);
    if (!m?.[1]) continue; // indented (a body), a comment, an attribute, a blank
    const name = m[1].replace(/^@/, "");
    if (RESERVED.has(name) || ex.has(name)) continue;
    const colon = line.indexOf(":");
    if (colon === -1 || line[colon + 1] === "=") continue; // not a recipe / an assignment
    // Walk up over the recipe's contiguous attribute lines (`[private]`, `[doc(…)]`, …). Either
    // one settles it: a documented recipe is fine, and a private one is not in the listing at all.
    let excused = false;
    for (let j = i - 1; j >= 0; j--) {
      const above = lines[j] as string;
      if (!/^\[.*\]\s*$/.test(above)) break;
      if (/\bdoc\(/.test(above) || /\bprivate\b/.test(above)) {
        excused = true;
        break;
      }
    }
    if (!excused) bad.push({ name, line: i + 1 });
  }
  return bad;
}

/**
 * Every justfile recipe carries an explicit `[doc("…")]`.
 *
 * Without one, `just --list` falls back to the LAST comment line above a recipe, which for a
 * multi-line comment block is a mid-sentence fragment — a help screen assembled by accident.
 */
export const justfileDocs = defineCheck(
  (opts: { exempt?: readonly string[] }): Check =>
    (ctx) => {
      const bad = undocumentedRecipes(ctx.file?.content ?? "", opts.exempt ?? []);
      return bad.length === 0
        ? ctx.ok()
        : ctx.fail(bad.map((r) => `recipe '${r.name}' (line ${r.line}) has no [doc("…")] attribute`).join("\n"));
    },
);

// ── node: the lockfile moves with the dependency, not with the file ──────────

const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "yarn.lock"];

/**
 * The dependency names whose entry differs between two package.json texts.
 *
 * Unparseable JSON on either side names every dependency both sides mention: a file being reshaped
 * into something else is a change we cannot rule out. An empty string means the file did not exist
 * on that side.
 */
export function movedDependencies(beforeText: string, afterText: string): string[] {
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = beforeText.trim() === "" ? {} : (JSON.parse(beforeText) as Record<string, unknown>);
    after = afterText.trim() === "" ? {} : (JSON.parse(afterText) as Record<string, unknown>);
  } catch {
    return ["(package.json is not parseable JSON on one side of this commit)"];
  }
  const moved: string[] = [];
  for (const block of DEP_BLOCKS) {
    const a = (before[block] ?? {}) as Record<string, unknown>;
    const b = (after[block] ?? {}) as Record<string, unknown>;
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (a[name] !== b[name] && !moved.includes(name)) moved.push(name);
  }
  return moved;
}

/**
 * A dependency move and its lockfile land in the same commit.
 *
 * Keyed on the dependency BLOCKS, never on the file: a `repository.url` fix moves no lockfile, and
 * the file-keyed version of this rule blocked exactly that commit (2026-08-13). Knowing the domain
 * is what buys the message the generic rule could never write — it names what moved.
 */
export const lockfileInStep = defineCheck(
  (_opts: Record<string, never>): Check =>
    async (ctx) => {
      const staged = ctx.staged ?? [];
      if (!staged.includes("package.json")) return ctx.ok();
      if (staged.some((f) => LOCKFILES.includes(f))) return ctx.ok();
      // `HEAD:` is the last committed version (empty = a brand-new package.json), `:` the staged one.
      const [head, index] = await Promise.all([ctx.exec("git show HEAD:package.json"), ctx.exec("git show :package.json")]);
      const moved = movedDependencies(head.code === 0 ? head.stdout : "", index.code === 0 ? index.stdout : "");
      if (moved.length === 0) return ctx.ok(); // a metadata edit — nothing for a lockfile to mirror
      return ctx.fail(`this commit moves ${moved.map((d) => `\`${d}\``).join(", ")} in package.json but stages no lockfile`);
    },
);

// ── the work platform: a new verb names its caller ───────────────────────────

/** One dispatch file, and the commands already on it. */
export interface Surface {
  readonly file: string;
  readonly known: readonly string[];
}

/**
 * From one file's diff, the command names introduced on ADDED lines and not already known.
 *
 * A command is registered three ways in this shell — `case "x":` in a dispatch switch,
 * `command === "x"` in the pre-journal guards, and `sub === "x"` in a subcommand router — so all
 * three count. Removals and context are ignored: renaming or editing a command is silent.
 */
export function addedCommands(diff: string, known: readonly string[]): string[] {
  const seen = new Set(known);
  const found = new Set<string>();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);
    for (const re of [/case\s+"([a-z][a-z-]*)"\s*:/g, /command\s*===\s*"([a-z][a-z-]*)"/g, /sub\s*===\s*"([a-z][a-z-]*)"/g]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) if (m[1] !== undefined && !seen.has(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}

/** Adding a verb to a dispatch surface must name its caller, in the commit message. */
export const newCommandNeedsCaller = defineCheck(
  (opts: { surfaces: readonly Surface[]; token: string }): Check =>
    async (ctx: Ctx) => {
      const message = commitMessage(ctx.command ?? "");
      if (message === null) return ctx.ok();
      const added: string[] = [];
      for (const surface of opts.surfaces) {
        const diff = await ctx.exec(`git diff HEAD -- ${surface.file}`);
        if (diff.code !== 0) return ctx.ok(); // not a repo — never trap
        for (const name of addedCommands(diff.stdout, surface.known)) added.push(`\`${name}\` (${surface.file})`);
      }
      if (added.length === 0) return ctx.ok();
      if (givesReason(message, opts.token)) return ctx.ok();
      return ctx.fail(`commit adds ${added.join(", ")} to a dispatch surface but its message names no caller`);
    },
);
