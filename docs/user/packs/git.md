[flow packs](./index.md) › git

# The `git` pack

7 guardrails · 1 breadcrumb · fires at: session · command · write · commit · takes 3 parameters

Conventional commit headers, computed versions, and nothing destroys uncommitted work.

The `node/` sub-group is release discipline spelled in package.json, and package.json only.

Generated from `packs/git.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 3 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `versionFile` | `string` | The file the release writes the version into. Defaults to `package.json`.<br><br>`noHandEditedVersion` reads whatever this names out of the commit's own diff, so any manifest works there. `versionIsSemver` reads it as JSON, so a repo whose manifest is TOML or YAML names the file here and disables that one entry. |
| `types` | `readonly string[]` | The type words a commit header may use. Defaults to the eleven of Conventional Commits plus `release`: feat · fix · docs · style · refactor · perf · test · build · ci · chore · revert · release.<br><br>A repo with its own vocabulary states the WHOLE list, never an addition — the refusal prints what it was given, so a half-list would refuse a type it then failed to mention. |
| `release` | `string` | The recipe that computes the version from the history, writes the changelog, stamps the version file and tags — for example `just release` or `npm run release`.<br><br>MANDATORY rather than defaulted, by the same rule tdd's suite recipe follows: a default is a rule that names the wrong command in every repo that spells it differently, and it names it in the one sentence a person reads at the moment they are blocked. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { git } from "@jawache/flow/packs";

export default defineConfig([pack(git, { release: "./ci.sh release" })]);
```

To turn one entry off, say so in the config: `override(git.orientation).disabled("why")`. It is a committed change, so a reviewer sees it.

## What the repo needs in place

A release path the repo really has, named as the `release` parameter: the recipe that
computes the next version from the commit headers, writes the changelog and tags. The version
rules refuse a hand-edited version in favour of it, so a repo without one has nowhere to send a
blocked reader.

## Adopting it

Bind it in a repo that already writes conventional commits, or expect the header rule to
refuse the first few commits while everyone re-learns the format — that is the rule working, and
`flow status` will show it firing.

## Entries

- [`git.orientation`](#gitorientation--breadcrumb) · breadcrumb · The whole commit contract — how commits are written, how versions are computed, what is blocked.
- [`git.noAiAttributionInCommits`](#gitnoaiattributionincommits--guardrail) · guardrail · Blocks Claude/Anthropic attribution in commits, PRs and issues.
- [`git.noGitDiscard`](#gitnogitdiscard--guardrail) · guardrail · Blocks a git command that would wipe uncommitted work — checkout/restore/reset --hard/clean -f. No bypass; use git stash.
- [`git.noForcePush`](#gitnoforcepush--guardrail) · guardrail · Blocks a force-push — rewriting pushed history is the one loss a stash cannot undo.
- [`git.conventionalCommitFormat`](#gitconventionalcommitformat--guardrail) · guardrail · The commit header must speak Conventional Commits v1.0.0 (checked before git commit runs).
- [`git.noShellSubstitutionInProse`](#gitnoshellsubstitutioninprose--guardrail) · guardrail · A backtick inside a double-quoted argument of a commit or a PR body is live command substitution, not Markdown.
- [`git.node.versionIsSemver`](#gitnodeversionissemver--guardrail) · guardrail · The manifest's version is valid SemVer 2.0.0 — the number the computed release writes. See https://semver.org/
- [`git.node.noHandEditedVersion`](#gitnodenohandeditedversion--guardrail) · guardrail · The version field is written by the release commit, never by hand.

## `git.orientation` — breadcrumb

The whole commit contract — how commits are written, how versions are computed, what is blocked.

- **Shown when** once, at the start of a session
- **Watches** not scoped by path
- **Categories** every session

### Why it exists

Without it, the commit surface is learned by trial and refusal: an agent writes a header the
changelog cannot read, reaches for a force push, or discards uncommitted work with a command
that has no undo.

### What the agent reads

```
Commits, PRs and issues carry NO Claude/Anthropic attribution — no Co-Authored-By line, no "Generated with Claude", no mention. Author them as your own.
Commit headers speak Conventional Commits — `type(scope)!: description`. The TYPE is your judgement: `fix` patches behaviour, `feat` adds it, `refactor` changes neither (and must not change test expectations); a `!` or a `BREAKING CHANGE:` footer drives the SemVer major. The grammar is enforced; the choice is yours.
The version number is computed from this history at release (`./ci.sh release`) — never hand-edit a version field or a changelog.
A `git checkout` / `git restore` / `reset --hard` / `clean -f` that would silently wipe uncommitted work is blocked outright — there is no bypass token. Use `git stash` instead; it is recoverable.
```

## `git.noAiAttributionInCommits` — guardrail

Blocks Claude/Anthropic attribution in commits, PRs and issues.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "git(?:\\s+-[Cc]\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)|\\s+--[\\w-]+(?:=\\S+)?)*\\s+commit[\\s\\S]*[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(Claude|[Aa]nthropic)",
    "git(?:\\s+-[Cc]\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)|\\s+--[\\w-]+(?:=\\S+)?)*\\s+commit[\\s\\S]*[Gg]enerated with[\\s\\S]*Claude",
    "git(?:\\s+-[Cc]\\s+(?:\"[^\"]*\"|'[^']*'|\\S+)|\\s+--[\\w-]+(?:=\\S+)?)*\\s+commit[\\s\\S]*(claude\\.com/claude-code|🤖 Generated)",
    "gh (pr|issue)[\\s\\S]*[Cc]o-[Aa]uthored-[Bb]y:[\\s\\S]*(Claude|[Aa]nthropic)",
    "gh (pr|issue)[\\s\\S]*(claude\\.com/claude-code|🤖 Generated)"
  ],
  "matchHeredocs": true
}
```

</details>

### Why it exists

Claude Code tells every agent to end a commit or a pull request with a line crediting Claude,
and an agent follows the harness's instruction over the repo's. Without this, the credit lands
in history, where removing it means rewriting commits that may already be shared.

### What the agent reads when refused

```
Commit / PR / issue body contains Claude or Anthropic attribution. Remove it (the Co-Authored-By line, the 'Generated with Claude' line, any Claude/Anthropic mention) and retry.
```

### Proved by

**passes**

- running `git commit -m "fix(auth): renew the session"`
- running `git -C /repo/worktree commit -m "fix(auth): renew the session"`

**blocks**

- running `git -C /repo/worktree commit -m "fix(auth): renew the session

Co-Authored-By: Claude Opus <noreply@anthropic.com>"`
- running `git -c commit.gpgsign=false commit -m "fix(auth): renew the session

Co-Authored-By: Claude"`
- running `git commit -F - <<'EOF'
fix(auth): renew the session

Co-Authored-By: Claude
EOF`
- running `git commit -m "fix(auth): renew the session

Co-Authored-By: Claude <noreply@anthropic.com>"`
- running `gh pr create --body "Co-Authored-By: Claude"`
- running `git commit -m "fix(auth): renew the session

Generated with Claude Code"`
- running `git commit -m "fix(auth): renew the session

🤖 Generated with claude.com/claude-code"`
- running `gh issue create --body "opened with claude.com/claude-code"`

## `git.noGitDiscard` — guardrail

Blocks a git command that would wipe uncommitted work — checkout/restore/reset --hard/clean -f. No bypass; use git stash.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** `noGitDiscard` *(written in this pack)* — no options

### What the agent reads when refused

```
This git command would discard uncommitted edits with no undo. Use `git stash` instead — it's recoverable. There is no opt-out token; disabling this entry in flow.config.ts is the visible route.
```

### Proved by

**passes**

- running `git checkout main`
  - given `git ls-files` exits 0
- running `git checkout src/x.ts`
  - given `git ls-files` exits 0 and says `src/x.ts` · `git status --porcelain` exits 0
- running `git checkout -b docs`
- running `cd ../other && git checkout -- src/x.ts`
  - given `git -C '../other' status --porcelain` exits 0
- running `git status`
- running `git restore --staged src/x.ts`
  - given `git status --porcelain` exits 0 and says `M src/x.ts`
- running `git checkout -- src/x.ts`
  - given `git status --porcelain` exits 0
- running `git checkout -- src/x.ts`
  - given `git status --porcelain` exits 0 and says `?? other.ts`
- running `git reset --soft HEAD~1`
- running `git clean -n`

**blocks**

- running `git checkout -- src/x.ts`
  - given `git status --porcelain` exits 0 and says `M src/x.ts`
- running `git checkout src/x.ts`
  - given `git ls-files` exits 0 and says `src/x.ts` · `git status --porcelain` exits 0 and says `M src/x.ts`
- running `cd ../other && git checkout src/x.ts`
  - given `git -C '../other' ls-files` exits 0 and says `src/x.ts` · `git -C '../other' status --porcelain` exits 0 and says `M src/x.ts`
- running `git restore src/x.ts`
  - given `git status --porcelain` exits 0 and says `M src/x.ts`
- running `git restore --staged --worktree src/x.ts`
  - given `git status --porcelain` exits 0 and says `M src/x.ts`
- running `git clean -fd`
  - given `git status --porcelain` exits 0 and says `?? junk.txt`
- running `git clean --force src/`
  - given `git status --porcelain` exits 0 and says `?? src/junk.txt`
- running `git reset --hard`
  - given `git status --porcelain` exits 0 and says `M a.ts`
- running `git status
git checkout -- a.ts`
  - given `git status --porcelain` exits 0 and says `M a.ts`
- running `git -C ../other checkout -- src/x.ts`
  - given `git -C '../other' status --porcelain` exits 0 and says `M src/x.ts`

## `git.noForcePush` — guardrail

Blocks a force-push — rewriting pushed history is the one loss a stash cannot undo.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:^|[\\n;&|(]\\s*)\\s*git\\s+push[^\\n]*\\s(--force|-f)(\\s|$)",
    "(?:^|[\\n;&|(]\\s*)\\s*git\\s+push[^\\n]*--force-with-lease"
  ]
}
```

</details>

### What the agent reads when refused

```
Force-push rewrites history that other clones (and every open PR) already have — the one loss no stash can undo. Push a new commit that corrects the old one. A repo whose workflow genuinely rewrites a scratch remote disables this entry in flow.config.ts, visibly.
```

### Proved by

**passes**

- running `git push origin main`
- running `cat > notes.md <<'EOF'
never run git push --force here
EOF`
- running `cat > notes.md <<'EOF'
git push --force origin main
EOF`

**blocks**

- running `git push --force origin main`
- running `git status
git push --force origin main`
- running `bash <<'EOF'
git push --force origin main
EOF`
- running `git push -f`
- running `git push --force-with-lease origin main`
- running `git status && git push --force origin main`

## `git.conventionalCommitFormat` — guardrail

The commit header must speak Conventional Commits v1.0.0 (checked before git commit runs).

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** `conventionalCommit` *(written in this pack)*

<details><summary>settings</summary>

```
{
  "types": [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
    "release"
  ]
}
```

</details>

### What the agent reads when refused

```
Commit header must match Conventional Commits v1.0.0: type(scope)!: description — e.g. `fix(auth): renew session on token refresh`.
The type is one of: feat · fix · docs · style · refactor · perf · test · build · ci · chore · revert · release.
```

### Proved by

**passes**

- running `git commit -m "fix(auth): renew session on token refresh"`
- running `git status`
- running `git commit -m "feat(cli)!: the config grammar is closed"`

**blocks**

- running `git commit -m "fixed the auth thing"`
- running `git commit -m "feat a thing"`
- running `git commit -m 'tidied things up

feat: the thing I actually did'`

## `git.noShellSubstitutionInProse` — guardrail

A backtick inside a double-quoted argument of a commit or a PR body is live command substitution, not Markdown.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:git\\s+commit\\b[^\\n]*?-{1,2}[a-zA-Z]*m|gh\\s+(?:pr|issue)\\b)[^\"`]*(?:\"(?:(?!<<-?')[^\"])*\"[^\"`]*)*\"(?:(?!<<-?')[^\"])*`"
  ],
  "matchHeredocs": true
}
```

</details>

### What the agent reads when refused

```
You are recording prose through a shell command, and a backtick inside a DOUBLE-quoted argument is not Markdown — the shell RUNS it and splices its output into your text before the command ever sees it.
On an append-only record there is no undo: no amend, no redact. And once the binary has argv the splice has already happened, so this is the only moment it can be caught.
Fix: SINGLE-quote the argument (backticks are literal there), or feed the prose on stdin with a QUOTED heredoc — `git commit -F -` plus `<<'EOF'`, which this rule treats as safe.
ALREADY single-quoted and still blocked? Then your PROSE carries an unbalanced double quote before the backtick, and the matcher cannot tell that quote from a real open argument. Nothing would splice — this one is the rule's cost, not your mistake. Balance the quote, drop it, or use the heredoc; do not go back to double quotes to make it pass.
```

### Proved by

**passes**

- running `git commit -F - <<'EOF'
fix: a `thing`
EOF`
- running `git commit -m 'fix: run `just test` first'`

**blocks**

- running `git commit -m "fix: run `just test` first"`
- running `gh pr create --body "see `just gate`"`
- running `git commit -m "fix: a thing

run `just test` first"`
- running `git commit -m "$(cat <<EOF
fix: run `just test` first
EOF
)"`

## `git.node.versionIsSemver` — guardrail

The manifest's version is valid SemVer 2.0.0 — the number the computed release writes. See https://semver.org/

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `package.json`
- **Categories** every session
- **Check** [`jsonInvariant`](../checks/json-invariant.md)

<details><summary>settings</summary>

```
{
  "assert": [
    {
      "path": "version",
      "matches": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$"
    }
  ]
}
```

</details>

### What the agent reads when refused

```
`package.json` needs a valid SemVer 2.0.0 `version` (MAJOR.MINOR.PATCH[-prerelease][+build]).
```

### Proved by

**passes**

- writing `package.json` — `{"version":"1.2.3"}`

**blocks**

- writing `package.json` — `{"version":"1.2"}`

## `git.node.noHandEditedVersion` — guardrail

The version field is written by the release commit, never by hand.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** `noHandEditedVersion` *(written in this pack)*

<details><summary>settings</summary>

```
{
  "versionFile": "package.json",
  "recipe": "./ci.sh release"
}
```

</details>

### What the agent reads when refused

```
The version is computed from the commit history at release time — run `./ci.sh release`, which writes the version, the changelog and the tag together. A real release commit (`release:` / `chore(release):`) passes.
```

### Proved by

**passes**

- running `git commit -m "chore(release): 1.2.3"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m "release: 1.2.3"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m "release(flow)!: 2.0.0"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "2.0.0"`
- running `git commit -m "chore: add a field"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.2",`
- running `git commit -m "fix: a thing"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "name": "a" + "name": "b"`
- running `git commit -m "Release: 1.2.3"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m "fix: a thing"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `+++ b/version = "9.9.9" --- a/x`

**blocks**

- running `git commit -m "fix: a thing"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m "chore: tidy the readme"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m 'feat: a thing

release: 1.2.3'`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`
- running `git commit -m "chore: add the field"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `+ "version": "0.1.0"`
- running `git commit -m "fix: a thing"`
  - given `git diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.0.0" + "version": "1.0.0-rc.1"`
- running `git -C ../other commit -m "fix: a thing"`
  - given `git -C '../other' diff HEAD -- 'package.json'` exits 0 and says `- "version": "1.2.2" + "version": "1.2.3"`

## Where each part of this page comes from

| On the page | In the pack | Read how |
| --- | --- | --- |
| Lead, and the parameters table | The doc comment on `definePack`, and the doc comment on each member of the parameter interface | JSDoc, read with the TypeScript compiler API |
| The named sections above the entries | An `@install`, `@setup` or `@adopt` tag on that same doc comment. A tag nobody uses renders nothing. | JSDoc tags |
| Entry id, kind, moments, globs, categories, description | The entry itself — `.at()` `.on()` `.description()` | Loaded: the same data the engine runs |
| Why it exists | The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason. | JSDoc |
| What the agent reads | `.text()` or `.message()`, verbatim | Loaded |
| Check and its settings | The check the entry asks, and the options it was given | The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied. |
| Proved by, and what each case was told | `.test({ pass, block })` — the event, and the `world` the case supplies for whatever the check reads | Loaded |

---

flow docs · [the packs](./index.md) · `git` · generated page, do not edit
