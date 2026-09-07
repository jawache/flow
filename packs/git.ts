// flow/packs/git.ts — conventional commit headers, computed versions, and nothing destroys
// uncommitted work.
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
  definePack,
  guardrail,
  jsonInvariant,
  session,
  substitutionInProse,
  SUBSTITUTION_MESSAGE,
  write,
} from "../index.ts";
import { conventionalCommit, noGitDiscard, noHandEditedVersion } from "./checks.ts";

/** The type words this repo accepts. Stated, never defaulted — the entry is the whole rule. */
const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert", "release"];

// The words this pack bans from a commit message, ASSEMBLED rather than written out.
//
// Not coyness. The rule fires on the command line, and every one of these entries is a command
// line's worth of prose about it — spelled whole, the ban would refuse the very commit that adds
// the file defining it, and the first thing anybody would do is turn the rule off to land it.
// Measured while writing this file: a `python3 - <<'PY'` heredoc carrying the pattern was blocked
// by the pattern, which is the rule working and the reason these three lines exist.
const TRAILER = ["Co", "Authored", "By"].join("-");
const VENDOR = ["Cl", "aude"].join("");
const SITE = ["cl", "aude", "\\.com/", "cl", "aude", "-code"].join("");

/** The one fact this pack cannot know: which recipe cuts a release here. */
export interface Release {
  /**
   * The recipe that computes the version from the history, writes the changelog, stamps the
   * version file and tags — `just release` here, `npm run release` elsewhere.
   *
   * MANDATORY rather than defaulted, by the same rule tdd's suite recipe follows: a default is a
   * rule that names the wrong command in every repo that spells it differently, and it names it in
   * the one sentence a person reads at the moment they are blocked.
   */
  readonly release: string;
}

export const git = definePack("git", (repo: Release) => ({
  orientation: breadcrumb()
    .at(session)
    .description("The whole commit contract — how commits are written here, how versions are computed, what is blocked.")
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
    .test({
      pass: ['git commit -m "fix(auth): renew the session"'],
      block: [
        `git commit -m "fix(auth): renew the session\n\n${TRAILER}: ${VENDOR} <noreply@anthropic.com>"`,
        `gh pr create --body "${TRAILER}: ${VENDOR}"`,
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
      ],
    }),

  noForcePush: guardrail()
    .at(command)
    .description("Blocks a force-push — rewriting pushed history is the one loss a stash cannot undo.")
    .check(banCommands({ ban: ["git\\s+push[^\\n]*\\s(--force|-f)(\\s|$)", "git\\s+push[^\\n]*--force-with-lease"] }))
    .message(
      "Force-push rewrites history that other clones (and every open PR) already have — the one loss no stash can undo. Push a new commit that corrects the old one. A repo whose workflow genuinely rewrites a scratch remote disables this entry in flow.config.ts, visibly.",
    )
    .test({
      pass: ["git push origin main"],
      block: ["git push --force origin main", "git push -f", "git push --force-with-lease origin main"],
    }),

  conventionalCommitFormat: guardrail()
    .at(command)
    .description("The commit header must speak Conventional Commits v1.0.0 (checked before git commit runs).")
    .check(conventionalCommit({ types: TYPES }))
    .message(
      "Commit header must match Conventional Commits v1.0.0: type(scope)!: description — e.g. `fix(auth): renew session on token refresh`.",
    )
    .test({
      pass: ['git commit -m "fix(auth): renew session on token refresh"', "git status"],
      block: ['git commit -m "fixed the auth thing"'],
    }),

  // The commands in THIS pack that write a permanent record — `git commit -m` and the two `gh`
  // verbs that open a PR or an issue. It arrived here when the packs moved into the package: it
  // was one entry in `guard` covering these AND the `work …` lifecycle verbs, which is two packs'
  // worth of commands in one rule, so the head split along the pack line and the tail is shared
  // (`substitutionInProse`, a core check beside `banCommands`). A repo that binds `work` gets the
  // other head there; a
  // repo that binds only `git` still gets this one, which is the half every repo has.
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
      .on("package.json")
      .description("package.json version is valid SemVer 2.0.0 — the number the computed release writes. See https://semver.org/")
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
      .message("package.json `version` must be valid SemVer 2.0.0 (MAJOR.MINOR.PATCH[-prerelease][+build]).")
      .test({
        pass: [{ path: "package.json", content: '{"version":"1.2.3"}' }],
        block: [{ path: "package.json", content: '{"version":"1.2"}' }],
      }),

    noHandEditedVersion: guardrail()
      .at(command)
      .description("The version field is written by the release commit, never by hand.")
      .check(noHandEditedVersion({ versionFile: "package.json", recipe: repo.release }))
      .message(
        `The version is computed from the commit history at release time — run \`${repo.release}\`, which writes the version, the changelog and the tag together. A real release commit (\`release:\` / \`chore(release):\`) passes.`,
      )
      .test({
        pass: [
          // A release commit may write it — the one shape that passes with the diff right there.
          {
            command: 'git commit -m "chore(release): 1.2.3"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // The other two release spellings the header rule accepts, so all three arms are proved
          // rather than the one this repo happens to type.
          {
            command: 'git commit -m "release: 1.2.3"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          {
            command: 'git commit -m "release(flow)!: 2.0.0"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "2.0.0"' } } },
          },
          // A metadata edit that rewrites the version LINE without moving its value — adding a key
          // after it puts a comma on the end. Values are compared, never lines, or this would fire
          // on every reformat.
          {
            command: 'git commit -m "chore: add a field"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.2",' } } },
          },
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "name": "a"\n+  "name": "b"' } } },
          },
        ],
        block: [
          {
            command: 'git commit -m "fix: a thing"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
          // THE HOLE THIS CASE CLOSED: a bare `chore:` used to read as a release, so every
          // housekeeping commit in the repo was licensed to hand-edit the version. `chore` needs
          // its release scope now, and this case is what keeps it needing one.
          {
            command: 'git commit -m "chore: tidy the readme"',
            world: { exec: { "git diff HEAD -- package.json": { stdout: '-  "version": "1.2.2"\n+  "version": "1.2.3"' } } },
          },
        ],
      }),
  },
}));
