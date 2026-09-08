// flow/packs/git.ts — the git surface.
// Subtlety: these rules read COMMAND STRINGS, not files at rest — an agent writes file text through commands (heredocs), so the attribution literals are ASSEMBLED from pieces (TRAILER/VENDOR/SITE below) or committing this file would trip its own ban.
//
// Subtlety: the release RECIPE is a mandatory parameter, not `just release` written into the pack — which command cuts a release is the repo's fact, and it is named in the sentence a blocked person reads.
//
// NO BYPASSES: `noGitDiscard` and `noForcePush` have no marker escape. The strictest variant in the
// fleet is the one that shipped; a repo that wants out disables the entry in its config, visibly.
//
// The `node/` sub-group is release discipline that happens to be spelled in package.json — a
// Python or Rust repo binds the same two jobs against pyproject.toml or Cargo.toml. It is nested
// rather than flattened because `git.node.versionIsSemver` is what the entry is called, and a
// pack's shape is what a reader navigates it by.

import {
  banCommands,
  breadcrumb,
  command,
  commit,
  commitMessage,
  defineCheck,
  definePack,
  gitDirPrefix,
  gitInvocations,
  guardrail,
  jsonInvariant,
  quoteArg,
  session,
  substitutionInProse,
  SUBSTITUTION_MESSAGE,
  write,
  type Check,
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
const noGitDiscard = defineCheck(
  (_opts: Record<string, never>): Check =>
    async (ctx) => {
      const command = ctx.command ?? "";
      const targets = discardPaths(command);
      if (targets.length === 0) return ctx.ok();
      const cleaning = /(^|[;&|\n]\s*)git\s+clean\b/.test(command);
      // THE COMMAND'S OWN `-C`, copied onto the read, exactly as `commitReason` copies it: a
      // `git -C ~/other-repo checkout -- x` is about THAT repo's tree, and a status read here would
      // answer about files the command was never aimed at — clean ones, so the loss goes through.
      const git = `git ${gitDirPrefix(command)}`.trimEnd();
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
const conventionalCommit = defineCheck(
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
      const message = commitMessage(ctx.command ?? "");
      if (message === null) return ctx.ok();
      if (isReleaseCommit(message)) return ctx.ok(); // the one shape that may write it
      // `git diff HEAD` — staged AND unstaged, because `git commit -a` sweeps the second lot in.
      // Prefixed with the command's own `-C`, the way `commitReason` is: a commit aimed at another
      // repo has to be judged against that repo's diff, or this vetoes it over a version field it
      // cannot see.
      const git = `git ${gitDirPrefix(ctx.command ?? "")}`.trimEnd();
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

/** The type words a commit header may use. Stated, never defaulted — the entry is the whole rule. */
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

  noAiAttributionInCommits: guardrail()
    .at(command)
    .description("Blocks Claude/Anthropic attribution in commits, PRs and issues.")
    .check(
      banCommands({
        ban: [
          `git commit[\\s\\S]*[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(${VENDOR}|[Aa]nthropic)`,
          `git commit[\\s\\S]*[Gg]enerated with[\\s\\S]*${VENDOR}`,
          `git commit[\\s\\S]*(${SITE}|🤖 Generated)`,
          `gh (pr|issue)[\\s\\S]*[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(${VENDOR}|[Aa]nthropic)`,
          `gh (pr|issue)[\\s\\S]*(${SITE}|🤖 Generated)`,
        ],
      }),
    )
    .message(
      `Commit / PR / issue body contains Claude or Anthropic attribution. Remove it (the ${TRAILER} line, the 'Generated with Claude' line, any Claude/Anthropic mention) and retry.`,
    )
    // EVERY LITERAL ASSEMBLED, the cases included: written whole, a case would carry the shape its
    // own rule bans, and this file's next commit would be refused by it.
    .test({
      pass: ['git commit -m "fix(auth): renew the session"'],
      block: [
        `git commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR} <noreply@anthropic.com>"`,
        `gh pr create --body "${TRAILER}: ${VENDOR}"`,
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
        // Branch switching passes: only the `--` pathspec form discards.
        "git checkout main",
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
      ],
      block: [
        {
          command: "git checkout -- src/x.ts",
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
    // ANCHORED TO A COMMAND POSITION — the start of the line, or just past a shell operator —
    // exactly as `work.noAgentInboxItems` is. Unanchored, the pattern refuses a script for EDITING
    // the words, wherever they sit inside a heredoc it is writing, and a rule that cries wolf is
    // one agents learn to route around.
    .check(
      banCommands({
        ban: [
          "(?:^|[\\n;&|(]\\s*)\\s*git\\s+push[^\\n]*\\s(--force|-f)(\\s|$)",
          "(?:^|[\\n;&|(]\\s*)\\s*git\\s+push[^\\n]*--force-with-lease",
        ],
      }),
    )
    .message(
      "Force-push rewrites history that other clones (and every open PR) already have — the one loss no stash can undo. Push a new commit that corrects the old one. A repo whose workflow genuinely rewrites a scratch remote disables this entry in flow.config.ts, visibly.",
    )
    .test({
      pass: [
        "git push origin main",
        // PROSE THAT MENTIONS THE VERB IS NOT AN INVOCATION. A heredoc writing a note about the
        // ban carries the words in a BODY line, where no command position is — which is the whole
        // difference the anchor reads, and the false positive it was added for.
        "cat > notes.md <<'EOF'\nnever run git push --force here\nEOF",
      ],
      block: [
        "git push --force origin main",
        "git push -f",
        "git push --force-with-lease origin main",
        // …and a POSITION is not the start of the string: a real force-push chained behind another
        // command is still one, which is the half an anchor written as `^` alone would let through.
        "git status && git push --force origin main",
      ],
    }),

  conventionalCommitFormat: guardrail()
    .at(command)
    .description("The commit header must speak Conventional Commits v1.0.0 (checked before git commit runs).")
    .check(conventionalCommit({ types: TYPES }))
    .message(
      [
        "Commit header must match Conventional Commits v1.0.0: type(scope)!: description — e.g. `fix(auth): renew session on token refresh`.",
        `The type is one of: ${TYPES.join(" · ")}.`,
      ].join("\n"),
    )
    .test({
      pass: [
        'git commit -m "fix(auth): renew session on token refresh"',
        "git status",
        // The BANG, which is what drives the SemVer major — a scope and a `!` together, since that
        // is the shape a breaking change is actually typed in.
        'git commit -m "feat(cli)!: the config grammar is closed"',
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
      ],
    }),

  // The commands in THIS pack that write a permanent record — `git commit -m` and the two `gh`
  // verbs that open a PR or an issue. The lifecycle's own prose-writing verbs are the same rule in
  // the `work` pack, and the shared tail is `substitutionInProse`, a core check beside
  // `banCommands`: a repo that binds only `git` still gets the half every repo has.
  noShellSubstitutionInProse: guardrail()
    .at(command)
    .description("A backtick inside a double-quoted argument of a commit or a PR body is live command substitution, not Markdown.")
    .check(banCommands({ ban: [substitutionInProse(["git\\s+commit\\b[^\\n]*?-{1,2}[a-zA-Z]*m", "gh\\s+(?:pr|issue)\\b"])] }))
    .message(SUBSTITUTION_MESSAGE)
    .test({
      pass: ["git commit -F - <<'EOF'\nfix: a `thing`\nEOF", "git commit -m 'fix: run `just test` first'"],
      block: ['git commit -m "fix: run `just test` first"', 'gh pr create --body "see `just gate`"'],
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
