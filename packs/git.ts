// flow/packs/git.ts — the git surface.
// Subtlety: these rules read COMMAND STRINGS, not files at rest — an agent writes file text through commands (heredocs), so the attribution literals are ASSEMBLED from pieces (TRAILER/VENDOR/SITE below) or committing this file would trip its own ban.
//
// Subtlety: the release RECIPE is a mandatory parameter, not `just release` written into the pack — which command cuts a release is the repo's fact, and it is named in the sentence a blocked person reads.
//
// NO BYPASSES: `noGitDiscard` and `noForcePush` have no marker escape. The strictest variant in the
// fleet is the one that shipped; a repo that wants out disables the entry in its config, visibly.
//
// The `node/` sub-group is nested rather than flattened because `git.node.versionIsSemver` is what
// the entry is called, and a pack's shape is what a reader navigates it by.

import {
  breadcrumb,
  command,
  commit,
  commitMessage,
  defineCheck,
  definePack,
  escapeRe,
  gitCommands,
  gitDirPrefix,
  guardrail,
  jsonInvariant,
  programName,
  quoteArg,
  session,
  shellCommands,
  substitutionInProse,
  SUBSTITUTION_MESSAGE,
  write,
  type Check,
  type Ctx,
  type GitCommand,
  type ShellCommand,
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
 * The working-tree paths a line's git commands would discard OUTRIGHT, or [] when it is safe to run.
 *
 * Deliberately narrow — false negatives beat blocking real work. Every path here is one the
 * command line itself declares: the `--` pathspec form of checkout, the restore forms that touch
 * the tree, and `reset --hard` / `clean -f`, whose target is the tree itself.
 *
 * The BARE form of checkout — `git checkout <thing>` with no `--` — is not here and cannot be:
 * whether `<thing>` is a path or a branch is a fact about the repo, not about the string, and this
 * function is pure. `checkoutBarePaths` below names the candidates and the check asks git.
 */
function discardPaths(gits: readonly GitCommand[]): string[] {
  const paths: string[] = [];
  for (const { subcommand, args } of gits) {
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

/**
 * Options of `git checkout` that swallow the word after them, so it is a value and never a target.
 *
 * The list is short on purpose. `git ls-files` below is the real filter — a branch name it cannot
 * match is dropped whatever we do here — so this exists for the one case the filter gets wrong:
 * a NEW branch named after a folder that exists. `git checkout -b docs` in a repo with a `docs/`
 * would otherwise look exactly like a discard of every tracked file under it.
 */
const CHECKOUT_TAKES_VALUE = new Set(["-b", "-B", "--orphan", "--pathspec-from-file"]);

/**
 * The words a bare `git checkout` might be aiming at — candidates, not answers.
 *
 * `git checkout <path>` discards that path exactly as `git checkout -- <path>` does, and until F3
 * only the second was refused. The comment above this rule claimed the narrowing was deliberate
 * ("branch switching passes"), and it was — but it bought that pass by missing the form a person
 * actually types, which the F3 builder proved on itself by running `git checkout adapter/claude.ts`
 * over an hour of uncommitted work and watching the guard allow it.
 *
 * An invocation carrying `--` is skipped: `discardPaths` already has it, and everything before the
 * `--` there is a tree-ish by definition.
 */
function checkoutBarePaths(gits: readonly GitCommand[]): string[] {
  const out: string[] = [];
  for (const { subcommand, args } of gits) {
    if (subcommand !== "checkout" || args.includes("--")) continue;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string;
      if (CHECKOUT_TAKES_VALUE.has(arg)) i++;
      else if (!arg.startsWith("-")) out.push(arg);
    }
  }
  return out;
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
const noGitDiscard = defineCheck(
  (_opts: Record<string, never>): Check =>
    async (ctx) => {
      // The git commands the line runs, from the parse: a `git clean` named in a commit message
      // or written into a heredoc is not one, and a line that does not parse has none.
      const gits = gitCommands(ctx);
      const cleaning = gits.some((g) => g.subcommand === "clean");
      // THE COMMAND'S OWN `-C`, copied onto every read, exactly as `commitReason` copies it: a
      // `git -C ~/other-repo checkout -- x` is about THAT repo's tree, and a status read here would
      // answer about files the command was never aimed at — clean ones, so the loss goes through.
      const git = `git ${gitDirPrefix(ctx)}`.trimEnd();
      const targets = discardPaths(gits);
      // ASK GIT WHICH OF THEM IS A PATH. A bare `git checkout <thing>` discards the tree when
      // `<thing>` names a path and switches branch when it names a ref, and only the repo knows
      // which — so the candidates go to `ls-files`, whose answer IS the tracked set they match.
      // A branch matches nothing and falls out here; that is what keeps branch switching passing.
      const candidates = checkoutBarePaths(gits);
      if (candidates.length > 0) {
        const tracked = await ctx.exec(`${git} ls-files -- ${candidates.map(quoteArg).join(" ")}`);
        if (tracked.code === 0) targets.push(...tracked.stdout.split("\n").filter((line) => line !== ""));
      }
      if (targets.length === 0) return ctx.ok();
      // `quoteArg` rather than a pair of typed quotes: a path with an apostrophe in it closes a
      // hand-rolled quote and the rest of the pathspec becomes shell. One quoter in this package,
      // and this is the call that was the second one.
      const status = await ctx.exec(`${git} status --porcelain -- ${targets.map(quoteArg).join(" ")}`);
      if (status.code !== 0) return ctx.ok(); // not a repo, or a bad pathspec — git owns that error
      const dirty = dirtyIn(status.stdout, cleaning);
      if (dirty.length === 0) return ctx.ok();
      return ctx.fail(
        dirty.map((f) => `would discard uncommitted edits to ${f} — use \`git stash\` instead (recoverable)`).join("\n"),
      );
    },
);

/** `git commit`'s short options with a value: attached, the rest of the bundle; last, the next word. `-S` and `-u` take only an attached one. */
const COMMIT_SHORT_VALUE = new Set(["m", "F", "c", "C", "t"]);
const COMMIT_SHORT_ATTACHED = new Set(["S", "u"]);
/** `git commit`'s options whose value is the next word, so a message such as `-n` is never read as one. */
const COMMIT_TAKES_VALUE = new Set([
  "-m",
  "-F",
  "-c",
  "-C",
  "-t",
  "--message",
  "--file",
  "--reuse-message",
  "--reedit-message",
  "--template",
  "--author",
  "--date",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--pathspec-from-file",
]);

/** Does this `git commit` argument list carry `--no-verify`, or `-n` alone or in a bundle such as `-anm`? */
function skipsVerify(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") return false;
    if (arg === "--no-verify") return true;
    if (COMMIT_TAKES_VALUE.has(arg)) i++;
    else if (/^-[^-]/.test(arg))
      for (const flag of arg.slice(1)) {
        if (flag === "n") return true;
        if (COMMIT_SHORT_ATTACHED.has(flag)) break;
        if (COMMIT_SHORT_VALUE.has(flag)) {
          if (arg.endsWith(flag)) i++;
          break;
        }
      }
  }
  return false;
}

/**
 * Each way a command line writes a commit or a ref the commit gate never runs on, or [] when it
 * writes none: `git commit --no-verify` or `-n`, `-c core.hooksPath=…` before any subcommand, and
 * git's plumbing that writes commits and refs directly (`commit-tree`, `update-ref`,
 * `hash-object -w`). The git commands are read from the parse, so a `git commit -n` inside a quoted
 * argument or a heredoc body is not one.
 */
export function gateSkips(facts: Pick<Ctx, "command" | "commands">): string[] {
  const out: string[] = [];
  for (const { globals, subcommand, args } of gitCommands(facts)) {
    for (let i = 0; i < globals.length; i++) {
      const global = globals[i] as string;
      const setting = global === "-c" ? (globals[++i] ?? "") : global.startsWith("-c") ? global.slice(2) : global.startsWith("--config-env=") ? global.slice(13) : "";
      if (/^core\.hookspath=/i.test(setting)) out.push("`-c core.hooksPath=…` runs git with another hooks folder");
    }
    if (subcommand === "commit" && skipsVerify(args)) out.push("`git commit --no-verify` (or `-n`) skips the pre-commit hook");
    if (subcommand === "commit-tree") out.push("`git commit-tree` writes a commit with no hook");
    if (subcommand === "update-ref") out.push("`git update-ref` moves a ref with no hook");
    if (subcommand === "hash-object" && args.includes("-w")) out.push("`git hash-object -w` writes an object with no hook");
  }
  return out;
}

/** Refuses a command that makes a commit the commit gate never judged. */
const noGateSkip = defineCheck(
  (_opts: Record<string, never>): Check =>
    (ctx) => {
      const skips = gateSkips(ctx);
      return skips.length === 0 ? ctx.ok() : ctx.fail(skips.join("\n"));
    },
);

/** `git push`'s options that take the next word as their value, so the value is never read as a flag or a refspec. */
const PUSH_TAKES_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * How this `git push` argument list forces the remote, or null when it does not: `--force`, `-f`
 * alone or in a bundle such as `-fu`, `--force-with-lease` with or without its value, or a refspec
 * that starts with `+`.
 */
function pushForce(args: readonly string[]): string | null {
  let refspecs = false; // past `--`, every word is the repository or a refspec
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (refspecs || !arg.startsWith("-")) {
      if (arg.startsWith("+")) return `the refspec \`${arg}\``;
      continue;
    }
    if (arg === "--") refspecs = true;
    else if (arg === "--force" || arg === "--force-with-lease" || arg.startsWith("--force-with-lease=")) return `\`${arg}\``;
    else if (PUSH_TAKES_VALUE.has(arg)) i++;
    else if (!arg.startsWith("--"))
      for (const flag of arg.slice(1)) {
        if (flag === "f") return `\`-f\` in \`${arg}\``;
        if (flag === "o") {
          if (arg.endsWith("o")) i++; // `-o` last in the bundle takes the next word; otherwise the rest is its value
          break;
        }
      }
  }
  return null;
}

/**
 * Refuses a force-push, in every spelling git takes. The pushes are read from the parse, so git's
 * own options before `push` (`git -C <dir> push`) and git run by its path are pushes, and a push
 * written in a heredoc body or a quoted argument is not one.
 */
const noForcePush = defineCheck(
  (_opts: Record<string, never>): Check =>
    (ctx) => {
      const found = gitCommands(ctx).flatMap(({ subcommand, args }) => {
        const how = subcommand === "push" ? pushForce(args) : null;
        return how === null ? [] : [`\`git push\` forces the remote with ${how}`];
      });
      return found.length === 0 ? ctx.ok() : ctx.fail(found.join("\n"));
    },
);

/** Does this header line speak Conventional Commits for the given type set? */
export function isConventional(header: string, types: readonly string[]): boolean {
  const alt = types.map(escapeRe).join("|");
  return new RegExp(`^(${alt})(\\([^)]+\\))?!?: .+`).test(header.split("\n")[0] ?? "");
}

/**
 * The commit header must speak Conventional Commits v1.0.0, checked before `git commit` runs.
 *
 * `types` is stated, never defaulted: the accepted words are the whole content of the rule, and a
 * private list inside a script is a rule a reader of the entry cannot check.
 */
const conventionalCommit = defineCheck(
  (opts: { types: readonly string[] }): Check =>
    (ctx) => {
      const message = commitMessage(ctx);
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
 * `chore` REQUIRES its release scope: a bare `chore:` licensing a hand-edited version is the one
 * thing this rule exists to refuse. A `release(scope)` scope is free text — the word "release" is
 * not demanded inside the parentheses, so `release(cli): 1.0.0` passes.
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
const noHandEditedVersion = defineCheck(
  (opts: { versionFile: string; recipe: string }): Check =>
    async (ctx) => {
      const message = commitMessage(ctx);
      if (message === null) return ctx.ok();
      if (isReleaseCommit(message)) return ctx.ok(); // the one shape that may write it
      // `git diff HEAD` — staged AND unstaged, because `git commit -a` sweeps the second lot in.
      // Prefixed with the command's own `-C`, the way `commitReason` is: a commit aimed at another
      // repo has to be judged against that repo's diff, or this vetoes it over a version field it
      // cannot see.
      const git = `git ${gitDirPrefix(ctx)}`.trimEnd();
      const diff = await ctx.exec(`${git} diff HEAD -- ${quoteArg(opts.versionFile)}`);
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

/** The type words a commit header may use when the repo names none of its own. */
const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert", "release"];

// The words this pack bans from a commit message, ASSEMBLED rather than written out.
//
// Not coyness. The rule fires on the command line, and every one of these entries is a command
// line's worth of prose about it — spelled whole, the ban would refuse the very commit that adds
// the file defining it, and the first thing anybody would do is turn the rule off to land it.
const TRAILER = ["Co", "Authored", "By"].join("-");
const VENDOR = ["Cl", "aude"].join("");
const SITE = ["cl", "aude", "\\.com/", "cl", "aude", "-code"].join("");
// The same link as plain text, for the cases, and the emoji the tool's footer carries.
const LINK = ["cl", "aude", ".com/", "cl", "aude", "-code"].join("");
const ROBOT = "\u{1F916}";

/** The `gh` verbs that record prose: a pull request's and an issue's title, body and comments. */
const GH_PROSE_VERBS = ["pr", "issue"] as const;

/**
 * The commands that record that prose, in words: each verb run bare, and through `work gh`, the
 * wrapper a repo driven by work runs it as. The backtick rule names them as its heads, and the
 * attribution rule reads the same commands through `isGhProse`.
 */
const GH_PROSE_HEADS = [...GH_PROSE_VERBS.map((verb) => `gh ${verb}`), ...GH_PROSE_VERBS.map((verb) => `work gh ${verb}`)];

/**
 * The command is one of `GH_PROSE_HEADS`, matched as the backtick rule matches a head: the same
 * program, less its path, and every word of the head among its arguments, compared whole. An option
 * before the verb leaves it a head, so `gh --repo a/b pr create` and `work --verbose gh pr create`
 * are both read.
 */
function isGhProse(c: ShellCommand): boolean {
  const program = programName(c.program);
  return GH_PROSE_HEADS.some((head) => {
    const [name, ...words] = head.split(" ");
    return program === name && words.every((word) => c.args.includes(word));
  });
}

/**
 * Refuses attribution in what a `git commit` is given, and in the prose of a `gh pr` or `gh issue`.
 *
 * Both are read from the parse, never from a command's text. The commits come through
 * `gitCommands`: git's own options sit between `git` and `commit` (`git -C <worktree> commit`), and
 * a value with a space in it, `-C '/a b'`, is two words in a command's text, where a pattern loses
 * it. `message` is matched against each commit's arguments after `commit`, one per line, and the
 * bodies of the heredocs it is fed: every argument rather than the `-m` values alone, so `-am`,
 * `-m"…"` and a `"$(cat <<'EOF' … EOF)"` message are all in view. `prose` is matched the same way
 * against every argument of a `gh pr` or `gh issue` command, found as the backtick rule finds it,
 * and its heredocs' bodies, so a `--body-file -` fed on stdin is in view too. A line that does not
 * parse is matched whole.
 */
const noAttribution = defineCheck((opts: { message: readonly string[]; prose: readonly string[] }): Check => (ctx) => {
  const parsed = shellCommands(ctx);
  const matching = (patterns: readonly string[], texts: readonly string[]): string[] =>
    patterns.filter((pattern) => texts.some((text) => new RegExp(pattern).test(text)));
  // A line that does not parse is one text for both lists, and the lists share patterns: each
  // pattern that matches is reported once.
  const hits =
    parsed === null
      ? matching([...new Set([...opts.message, ...opts.prose])], [ctx.command ?? ""]).map((pattern) => `the line matches /${pattern}/`)
      : (() => {
          const given = (args: readonly string[], c: ShellCommand): string => [...args, ...c.heredocs.map((h) => h.body)].join("\n");
          const commits = gitCommands(ctx)
            .filter((g) => g.subcommand === "commit")
            .map((g) => given(g.args, g.command));
          const prose = parsed.filter(isGhProse).map((c) => given(c.args, c));
          return [
            ...matching(opts.message, commits).map((pattern) => `the commit's message matches /${pattern}/`),
            ...matching(opts.prose, prose).map((pattern) => `the PR or issue text matches /${pattern}/`),
          ];
        })();
  return hits.length === 0 ? ctx.ok() : ctx.fail(hits.join(" · "));
});

/** What this pack cannot know: which recipe cuts a release, and which file carries the version. */
export interface Release {
  /**
   * The file the release writes the version into. Defaults to `package.json`.
   *
   * `noHandEditedVersion` reads whatever this names out of the commit's own diff, so any manifest
   * works there. `versionIsSemver` reads it as JSON, so a repo whose manifest is TOML or YAML names
   * the file here and disables that one entry.
   */
  readonly versionFile?: string;

  /**
   * The type words a commit header may use. Defaults to the eleven of Conventional Commits plus
   * `release`: feat · fix · docs · style · refactor · perf · test · build · ci · chore · revert ·
   * release.
   *
   * A repo with its own vocabulary states the WHOLE list, never an addition — the refusal prints
   * what it was given, so a half-list would refuse a type it then failed to mention.
   */
  readonly types?: readonly string[];
  /**
   * The recipe that computes the version from the history, writes the changelog, stamps the
   * version file and tags — for example `just release` or `npm run release`.
   *
   * MANDATORY rather than defaulted, by the same rule tdd's suite recipe follows: a default is a
   * rule that names the wrong command in every repo that spells it differently, and it names it in
   * the one sentence a person reads at the moment they are blocked.
   */
  readonly release: string;
}

/**
 * Conventional commit headers, computed versions, and nothing destroys uncommitted work.
 *
 * The `node/` sub-group is release discipline spelled in package.json, and package.json only.
 *
 * @setup A release path the repo really has, named as the `release` parameter: the recipe that
 * computes the next version from the commit headers, writes the changelog and tags. The version
 * rules refuse a hand-edited version in favour of it, so a repo without one has nowhere to send a
 * blocked reader.
 * @adopt Bind it in a repo that already writes conventional commits, or expect the header rule to
 * refuse the first few commits while everyone re-learns the format — that is the rule working, and
 * `flow status` will show it firing.
 */
export const git = definePack("git", (repo: Release) => {
  const versionFile = repo.versionFile ?? "package.json";
  const types = repo.types ?? TYPES;
  return {
  /**
   * Without it, the commit surface is learned by trial and refusal: an agent writes a header the
   * changelog cannot read, reaches for a force push, or discards uncommitted work with a command
   * that has no undo.
   */
  orientation: breadcrumb()
    .at(session)
    .description("The whole commit contract — how commits are written, how versions are computed, what is blocked.")
    .text(
      [
        `Commits, PRs and issues carry NO Claude/Anthropic attribution — no ${TRAILER} line, no "Generated with Claude", no mention. Author them as your own.`,
        "Commit headers speak Conventional Commits — `type(scope)!: description`. The TYPE is your judgement: `fix` patches behaviour, `feat` adds it, `refactor` changes neither (and must not change test expectations); a `!` or a `BREAKING CHANGE:` footer drives the SemVer major. The grammar is enforced; the choice is yours.",
        `The version number is computed from this history at release (\`${repo.release}\`) — never hand-edit a version field or a changelog.`,
        "A `git checkout` / `git restore` / `reset --hard` / `clean -f` that would silently wipe uncommitted work is blocked outright — there is no bypass token. Use `git stash` instead; it is recoverable.",
      ].join("\n"),
    ),

  /**
   * Claude Code tells every agent to end a commit or a pull request with a line crediting Claude,
   * and an agent follows the harness's instruction over the repo's. Without this, the credit lands
   * in history, where removing it means rewriting commits that may already be shared.
   */
  noAiAttributionInCommits: guardrail()
    .at(command)
    .description("Blocks Claude/Anthropic attribution in commits, PRs and issues.")
    .check(
      noAttribution({
        message: [
          `[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(${VENDOR}|[Aa]nthropic)`,
          `[Gg]enerated with[\\s\\S]*${VENDOR}`,
          `${SITE}|🤖 Generated`,
        ],
        prose: [
          `[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(${VENDOR}|[Aa]nthropic)`,
          `${SITE}|🤖 Generated`,
        ],
      }),
    )
    .message(
      `Commit / PR / issue body contains Claude or Anthropic attribution. Remove it (the ${TRAILER} line, the 'Generated with Claude' line, any Claude/Anthropic mention) and retry.`,
    )
    // EVERY LITERAL ASSEMBLED, the cases included: written whole, a case would carry the shape its
    // own rule bans, and this file's next commit would be refused by it.
    .test({
      pass: [
        'git commit -m "fix(auth): renew the session"',
        'git -C /repo/worktree commit -m "fix(auth): renew the session"',
        // A search for the trailer, and a note that names it, are no commit.
        `git log --grep "${TRAILER}: ${VENDOR}"`,
        `git commit -m "fix(auth): renew the session" && echo "${TRAILER}: ${VENDOR}"`,
        // The PR and issue prose is read from `gh pr` and `gh issue` alone: not from another
        // command on the line, another gh verb, or a work verb other than `work gh`.
        `gh pr view 1 && echo "${TRAILER}: ${VENDOR}"`,
        `gh api repos/x/y -f body="${TRAILER}: ${VENDOR}"`,
        `work plan note --body "${TRAILER}: ${VENDOR}"`,
      ],
      block: [
        // A value with a space in it, and a long option with its value apart: a pattern over the
        // command's text lost the commit in each.
        `git -C '/a b' commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR}"`,
        `git -c user.name='A B' commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR}"`,
        `git --git-dir /x commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR}"`,
        // The message in a bundle of short flags, and through a heredoc in a substitution.
        `git commit -am "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR}"`,
        `git commit -m "$(cat <<'EOF'\nfix(auth): renew the session\n\n${TRAILER}: ${VENDOR}\nEOF\n)"`,
        // git's own options before `commit`: a builder in a worktree, and a one-off config value.
        `git -C /repo/worktree commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR} Opus <noreply@anthropic.com>"`,
        `git -c commit.gpgsign=false commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR}"`,
        // The message given on stdin, through a heredoc: the heredoc's body is read with the arguments.
        `git commit -F - <<'EOF'\nfix(auth): renew the session\n\n${TRAILER}: ${VENDOR}\nEOF`,
        `git commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR} <noreply@anthropic.com>"`,
        `gh pr create --body "${TRAILER}: ${VENDOR}"`,
        // …and gh run by its path.
        `/usr/local/bin/gh pr create --body "${TRAILER}: ${VENDOR}"`,
        // …and through `work gh`, which is how a repo driven by work runs every gh call, on the
        // line or fed as the body on stdin.
        `work gh pr create --title x --body "${TRAILER}: ${VENDOR}"`,
        `work gh issue create --title x --body-file - <<'EOF'\nopened with ${LINK}\nEOF`,
        // …and with an option before the verb, bare or through `work`: the backtick rule finds the
        // verb anywhere among the arguments, and this rule finds the same commands.
        `gh --repo a/b pr create --body "${TRAILER}: ${VENDOR}"`,
        `work --verbose gh pr create --body "${TRAILER}: ${VENDOR}"`,
        // The generated-with line, and the tool's own footer — the site link and the robot emoji
        // beside it. Three of the five patterns had no case at all until this read.
        `git commit -m "fix(auth): renew the session\n\nGenerated with ${VENDOR} Code"`,
        `git commit -m "fix(auth): renew the session\n\n${ROBOT} Generated with ${LINK}"`,
        `gh issue create --body "opened with ${LINK}"`,
      ],
    }),

  noGitDiscard: guardrail()
    .at(command)
    .description("Blocks a git command that would wipe uncommitted work — checkout/restore/reset --hard/clean -f. No bypass; use git stash.")
    .check(noGitDiscard({}))
    .message(
      "This git command would discard uncommitted edits with no undo. Use `git stash` instead — it's recoverable. There is no opt-out token; disabling this entry in flow.config.ts is the visible route.",
    )
    .test({
      pass: [
        // BRANCH SWITCHING PASSES, and this is now a fact about the repo rather than about the
        // string: `main` goes to `ls-files`, which matches nothing, so there is no target at all.
        { command: "git checkout main", world: { exec: { "git ls-files": { stdout: "" } } } },
        // A bare checkout of a path in a CLEAN tree is still a pass — the path resolves, and the
        // status read that follows finds nothing to lose.
        {
          command: "git checkout src/x.ts",
          world: { exec: { "git ls-files": { stdout: "src/x.ts" }, "git status --porcelain": { stdout: "" } } },
        },
        // A NEW branch named after a folder that exists: `-b` swallows its value, so `docs` is
        // never offered to `ls-files` and the folder underneath it is never mistaken for a target.
        "git checkout -b docs",
        // A `cd` into ANOTHER repo whose tree is clean. The reads carry `-C ../other`, so the
        // answer is about the tree the command is aimed at rather than about the session's.
        {
          command: "cd ../other && git checkout -- src/x.ts",
          world: { exec: { "git -C '../other' status --porcelain": { stdout: "" } } },
        },
        "git status",
        // `git restore --staged` touches the INDEX, not the tree — nothing is lost, so nothing is
        // refused. `--staged --worktree` together DO touch the tree, and are blocked below.
        {
          command: "git restore --staged src/x.ts",
          world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } },
        },
        // A clean target with no uncommitted work in it: the command is one of the four, and
        // there is nothing to discard, so it runs.
        { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: "" } } } },
        // …and the same tree carrying only UNTRACKED files. A checkout overwrites tracked paths
        // and leaves untracked ones where they are, so counting them here would refuse a safe
        // command — which is why the untracked half of the status is read for `clean` and for
        // nothing else.
        { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: "?? other.ts" } } } },
        // The forms that discard NOTHING never reach a status call at all: a soft reset moves the
        // branch pointer and leaves the tree alone, and `clean -n` is a dry run that prints what it
        // would have deleted.
        "git reset --soft HEAD~1",
        "git clean -n",
        // A discard written INTO a file or named in an argument is text, not a git command: the
        // parse finds no git there, so nothing is asked of the repo.
        "cat > notes.md <<'EOF'\ngit checkout -- a.ts\ngit clean -fd\nEOF",
        'echo "never run git reset --hard here"',
      ],
      block: [
        {
          command: "git checkout -- src/x.ts",
          world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } },
        },
        // THE BARE FORM, which is the one a person types. It was allowed for as long as this rule
        // existed, because the comment above it reasoned about the string instead of the repo —
        // and the F3 builder discarded an hour of its own uncommitted work through the gap.
        {
          command: "git checkout src/x.ts",
          world: { exec: { "git ls-files": { stdout: "src/x.ts" }, "git status --porcelain": { stdout: " M src/x.ts" } } },
        },
        // THE OTHER WAY OUT OF THIS REPO. `cd other && git checkout <path>` was judged against the
        // SESSION's tree, where the path does not exist — so the check found nothing to lose and
        // let the discard through. The F3 builder did exactly this to its own uncommitted work.
        {
          command: "cd ../other && git checkout src/x.ts",
          world: {
            exec: {
              "git -C '../other' ls-files": { stdout: "src/x.ts" },
              "git -C '../other' status --porcelain": { stdout: " M src/x.ts" },
            },
          },
        },
        // `git restore <path>` never had the gap — it counts a bare path already — and this case is
        // what keeps that true rather than accidental.
        {
          command: "git restore src/x.ts",
          world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } },
        },
        {
          command: "git restore --staged --worktree src/x.ts",
          world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } },
        },
        // `git clean -fd` exists to delete UNTRACKED files, so for it the untracked half of the
        // status IS the loss — everywhere else those files survive and counting them would refuse
        // a safe command.
        { command: "git clean -fd", world: { exec: { "git status --porcelain": { stdout: "?? junk.txt" } } } },
        // The long spelling with a named path: `--force` counts exactly as a bundled `-f` does, and
        // a pathspec narrows what is lost rather than excusing it.
        {
          command: "git clean --force src/",
          world: { exec: { "git status --porcelain": { stdout: "?? src/junk.txt" } } },
        },
        // A hard reset has no discarding pathspec form, so its target is the whole tree — the one
        // of the four that needs no path named to be dangerous.
        { command: "git reset --hard", world: { exec: { "git status --porcelain": { stdout: " M a.ts" } } } },
        // TWO COMMANDS ON ONE LINE, and both are read. A reader that stopped at the first
        // invocation is how `git status` followed by a checkout sails through as a status call —
        // and a NEWLINE separates commands exactly as `&&` does, which is the half that gets
        // forgotten.
        {
          command: "git status\ngit checkout -- a.ts",
          world: { exec: { "git status --porcelain": { stdout: " M a.ts" } } },
        },
        // A git the line runs inside a string given to a shell is a git command all the same.
        {
          command: "bash -c 'git checkout -- a.ts'",
          world: { exec: { "git status --porcelain": { stdout: " M a.ts" } } },
        },
        // AIMED AT ANOTHER REPO, and judged there. The recorded world answers only the `-C` form,
        // so a check that read this repo's status instead would reach a question the case never
        // answered and fail saying so — which is what makes this case evidence about the routing
        // rather than about the checkout.
        {
          command: "git -C ../other checkout -- src/x.ts",
          world: { exec: { "git -C '../other' status --porcelain": { stdout: " M src/x.ts" } } },
        },
      ],
    }),

  noForcePush: guardrail()
    .at(command)
    .description("Blocks a force-push — rewriting pushed history is the one loss a stash cannot undo.")
    // Read from the parsed git command: the `-f` must be an argument of the push itself, never of
    // the command after it (`git push origin main; ls -f`), and the words in a note or a heredoc a
    // script is writing are not a push at all.
    .check(noForcePush({}))
    .message(
      "Force-push rewrites history that other clones (and every open PR) already have — the one loss no stash can undo. Push a new commit that corrects the old one. A repo whose workflow genuinely rewrites a scratch remote disables this entry in flow.config.ts, visibly.",
    )
    .test({
      pass: [
        "git push origin main",
        // A heredoc's body is text fed to `cat`, so a push written in it is not one, even where a
        // body line starts with the verb.
        "cat > notes.md <<'EOF'\nnever run git push --force here\nEOF",
        "cat > notes.md <<'EOF'\ngit push --force origin main\nEOF",
        // ONE COMMAND AT A TIME: the flag belongs to the command after the push (#9, #14).
        "git push origin main; ls -f",
        "git push origin HEAD; gh api graphql -f query=x",
        "git push && gh api -f a=b repos/x/y",
        // …and a push named inside another command's argument is not one.
        'echo "never git push -f here"',
        // A value of `-o` is never a flag or a refspec.
        "git push -o +f origin main",
        "git push -of origin main",
        "git push -uo +x origin main",
        "git push --repo +x origin main",
        "git fetch origin +main:main",
      ],
      block: [
        "git push --force origin main",
        // A command line spans newlines, and a body a SHELL reads is commands.
        "git status\ngit push --force origin main",
        "bash <<'EOF'\ngit push --force origin main\nEOF",
        "bash <<< 'git push --force origin main'",
        "git push -f",
        "git push -f origin main",
        "git push -fu origin main",
        "git push --force-with-lease origin main",
        "git push --force-with-lease=main:abc123 origin main",
        "git push origin +main",
        "git push origin -- +HEAD:main",
        // git's own options before `push`, and git run by its path: an agent in a worktree pushes
        // as `git -C <worktree> push`.
        "git -C /x push --force",
        "git --no-pager push -f",
        "/usr/bin/git push --force",
        // A force-push chained behind another command is a command of its own.
        "git status && git push --force origin main",
      ],
    }),

  /**
   * The commit gate is a hook, and git has ways to commit without running it. A commit made that
   * way holds content no rule judged, and flow treats a commit that already exists as judged: a
   * later `git switch` to it puts its files in place unread.
   */
  noGateSkip: guardrail()
    .at(command)
    .description("Blocks a commit the commit gate never runs on — --no-verify, -c core.hooksPath=…, commit-tree, update-ref, hash-object -w.")
    .check(noGateSkip({}))
    .message(
      "That git command makes a commit, or moves a ref, without the commit gate judging it. Commit normally and fix what the gate refuses. There is no opt-out token; a repo whose workflow needs one of these disables this entry in flow.config.ts, visibly.",
    )
    .test({
      pass: [
        'git commit -m "fix: a thing"',
        "git commit -qam 'fix: a thing'",
        // A message is a value, never a flag, whatever it says.
        "git commit -m '-n is not a flag here'",
        'git commit -m "fix: drop --no-verify from the docs"',
        // Other commands spell -n their own way: a dry run, a line count.
        "git clean -n",
        "git log -n 3",
        "git -c user.name=me commit -m 'fix: a thing'",
        "git hash-object src/a.ts",
        "git push --no-verify",
      ],
      block: [
        "git commit --no-verify -m 'fix: a thing'",
        "git commit -n -m 'fix: a thing'",
        // -n inside a bundle of short flags, and after a commit on the same line.
        "git commit -qanm 'fix: a thing'",
        "git add -A && git commit -nm 'fix: a thing'",
        "git -c core.hooksPath=/dev/null commit -m 'fix: a thing'",
        "git -C ../other -c core.hookspath=.nohooks commit -m 'fix: a thing'",
        'git commit-tree HEAD^{tree} -p HEAD -m "fix: a thing"',
        "git update-ref refs/heads/main abc123",
        "echo hi | git hash-object -w --stdin",
      ],
    }),

  conventionalCommitFormat: guardrail()
    .at(command)
    .description("The commit header must speak Conventional Commits v1.0.0 (checked before git commit runs).")
    .check(conventionalCommit({ types }))
    .message(
      [
        "Commit header must match Conventional Commits v1.0.0: type(scope)!: description — e.g. `fix(auth): renew session on token refresh`.",
        `The type is one of: ${types.join(" · ")}.`,
      ].join("\n"),
    )
    .test({
      pass: [
        'git commit -m "fix(auth): renew session on token refresh"',
        "git status",
        // The BANG, which is what drives the SemVer major — a scope and a `!` together, since that
        // is the shape a breaking change is actually typed in.
        'git commit -m "feat(cli)!: the config grammar is closed"',
        // THE COMMIT'S OWN HEREDOC is its message, not the first heredoc on the line, which here is
        // a python script (#9).
        "python3 - <<'EOF'\nprint(1)\nEOF\ngit commit -F - <<'EOF'\nfix: a thing\nEOF",
        // A message given as `-m "$(cat <<'EOF' … EOF)"` is the heredoc's body, which is what the
        // shell passes to git, and the form an agent is taught.
        "git commit -m \"$(cat <<'EOF'\nfix: a thing\n\nwhy it was needed\nEOF\n)\"",
        // …and so it is with the value attached to its option, in either spelling.
        "git commit -m\"$(cat <<'EOF'\nfix: a thing\nEOF\n)\"",
        "git commit --message=\"$(cat <<'EOF'\nfix: a thing\nEOF\n)\"",
      ],
      block: [
        'git commit -m "fixed the auth thing"',
        // A known type word with no colon after it. `feat a thing` reads as a sentence that happens
        // to start with a type, and a header regex that only looked for the word would take it.
        'git commit -m "feat a thing"',
        // THE FIRST LINE IS THE HEADER, and the body may say anything at all — including something
        // that looks exactly like a header. A check that searched the whole message would pass this
        // and every other well-meaning commit whose subject was never written.
        "git commit -m 'tidied things up\n\nfeat: the thing I actually did'",
        // …and the other way round: a header-shaped script ahead of the commit lends it nothing.
        "cat > a.md <<'EOF'\nfix: a thing\nEOF\ngit commit -F - <<'EOF'\ntidied things up\nEOF",
        // …and the heredoc in a `$( … )` is judged by its body, not passed for its `$(cat` text.
        "git commit -m \"$(cat <<'EOF'\ntidied things up\nEOF\n)\"",
      ],
    }),

  // The commands in THIS pack that write a permanent record — `git commit` and the `gh pr` and
  // `gh issue` verbs, run bare or through `work gh`. The lifecycle's own prose-writing verbs are
  // the same rule in the `work` pack, and the shared check is `substitutionInProse`, a core check
  // beside `banCommands`: a repo that binds only `git` still gets the half every repo has.
  noShellSubstitutionInProse: guardrail()
    .at(command)
    .description("A backtick the shell would run in a commit message or a PR or issue body (double-quoted, bare, or in an unquoted heredoc) is live command substitution, not Markdown.")
    .check(substitutionInProse({ heads: GH_PROSE_HEADS, gitSubcommands: ["commit"] }))
    .message(SUBSTITUTION_MESSAGE)
    .test({
      pass: [
        "git commit -F - <<'EOF'\nfix: a `thing`\nEOF",
        "git commit -m 'fix: run `just test` first'",
        // The message fed through a QUOTED heredoc in a `$( … )`, the form an agent is taught.
        "git commit -m \"$(cat <<'EOF'\nfix: run `just test` first\nEOF\n)\"",
        // #10: prose on stdin through a quoted heredoc, where the shell runs nothing…
        "gh pr create --body-file - <<'EOF'\nRun \"`just test`\" before merging.\nEOF",
        // …and a gh command, then a quoted heredoc that belongs to another command.
        "gh issue view 35 --json body --jq .body > body.md\npython3 - <<'EOF'\nnew = f\"\"\"- **Docs** `work` starts the daemon\"\"\"\nEOF",
        "gh issue view 1 > old.md\ncat > new.md <<'EOF'\nsay \"run `just test`\"\nEOF",
        // #11: an escaped backtick is a literal one, inside the prose or in a grep after it.
        String.raw`gh issue comment 1 --body "run \`just test\` first"`,
        String.raw`gh issue view 10 --json body --jq .body | grep -n "x\\\\\`"`,
      ],
      block: [
        'git commit -m "fix: run `just test` first"',
        'gh pr create --body "see `just gate`"',
        // #11: the backtick substitutes, so the comment would record what `just test` prints.
        'gh issue comment 1 --body "run `just test` first"',
        // …run through `work gh`, as a repo driven by work runs every gh call.
        'work gh issue comment 1 --body "run `just test` first"',
        // gh run by its path is still gh.
        '/opt/homebrew/bin/gh pr create --body "see `just gate`"',
        // The backtick sits in the body of a multi-line message.
        'git commit -m "fix: a thing\n\nrun `just test` first"',
        // A message written in an unquoted heredoc inside the argument: the backtick still runs.
        'git commit -m "$(cat <<EOF\nfix: run `just test` first\nEOF\n)"',
        // …and an unquoted heredoc fed to the commit on stdin, where the shell runs it too.
        "git commit -F - <<EOF\nfix: run `just test` first\nEOF",
        // git's own options before `commit`, read through the parse: a value with a space, and a
        // long option with its value apart.
        "git -C '/a b' commit -m \"fix: `date`\"",
        "git --git-dir /x commit -m \"fix: `date`\"",
      ],
    }),

  node: {
    versionIsSemver: guardrail()
      .at(write, commit)
      .on(versionFile)
      .description("The manifest's version is valid SemVer 2.0.0 — the number the computed release writes. See https://semver.org/")
      .check(
        jsonInvariant({
          assert: [
            {
              path: "version",
              matches: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$",
            },
          ],
        }),
      )
      .message(`\`${versionFile}\` needs a valid SemVer 2.0.0 \`version\` (MAJOR.MINOR.PATCH[-prerelease][+build]).`)
      .test({
        pass: [{ path: versionFile, content: '{"version":"1.2.3"}' }],
        block: [{ path: versionFile, content: '{"version":"1.2"}' }],
      }),

    noHandEditedVersion: guardrail()
      .at(command)
      .description("The version field is written by the release commit, never by hand.")
      .check(noHandEditedVersion({ versionFile, recipe: repo.release }))
      .message(
        `The version is computed from the commit history at release time — run \`${repo.release}\`, which writes the version, the changelog and the tag together. A real release commit (\`release:\` / \`chore(release):\`) passes.`,
      )
      .test({
        pass: [
          // A release commit may write it — the one shape that passes with the diff right there.
          {
            command: 'git commit -m "chore(release): 1.2.3"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // The other two release spellings the header rule accepts, so all three arms are proved
          // rather than the one this repo happens to type.
          {
            command: 'git commit -m "release: 1.2.3"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          {
            command: 'git commit -m "release(flow)!: 2.0.0"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "2.0.0"' } } },
          },
          // A release commit whose message is a heredoc in a `$( … )`: its body is the header.
          {
            command: "git commit -m \"$(cat <<'EOF'\nchore(release): 1.2.3\nEOF\n)\"",
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // A metadata edit that rewrites the version LINE without moving its value — adding a key
          // after it puts a comma on the end. Values are compared, never lines, or this would fire
          // on every reformat.
          {
            command: 'git commit -m "chore: add a field"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.2",' } } },
          },
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "name": "a"\n+  "name": "b"' } } },
          },
          // The type word is read case-insensitively: a person typing `Release:` has written a
          // release commit, and refusing it would teach them the rule is about capitalisation.
          {
            command: 'git commit -m "Release: 1.2.3"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // A `+++` line is the diff's own header naming the file, not a line OF the file — so a
          // path that happens to contain a version-shaped string changes nothing.
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '+++ b/version = "9.9.9"\n--- a/x' } } },
          },
        ],
        block: [
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // THE HOLE THIS CASE CLOSED: a bare `chore:` used to read as a release, so every
          // housekeeping commit in the repo was licensed to hand-edit the version. `chore` needs
          // its release scope now, and this case is what keeps it needing one.
          {
            command: 'git commit -m "chore: tidy the readme"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // A release header in the BODY is not a release commit. The header is line one, the same
          // reading the format rule takes — and a message parser that searched the whole text would
          // hand every commit a free pass by way of a footer.
          {
            command: "git commit -m 'feat: a thing\n\nrelease: 1.2.3'",
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // A version ADDED where the file had none: there is no removed value to compare against,
          // and writing the first one by hand is the same act as changing it.
          {
            command: 'git commit -m "chore: add the field"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '+  "version": "0.1.0"' } } },
          },
          // A prerelease suffix is part of the value, so `1.0.0` → `1.0.0-rc.1` is a change. A
          // comparison that read only the numeric core would wave through every rc a hand cut.
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { [`git diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.0.0"\n+  "version": "1.0.0-rc.1"' } } },
          },
          // A COMMIT AIMED ELSEWHERE, read where it lands. The world answers only the `-C` form,
          // so a check that diffed this repo would ask a question the case never answered and fail
          // naming it — the case is about which repo is read, not about the version.
          {
            command: 'git -C ../other commit -m "fix: a thing"',
            world: {
              exec: {
                [`git -C '../other' diff HEAD -- '${versionFile}'`]: { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' },
              },
            },
          },
        ],
      }),
    },
  };
});
