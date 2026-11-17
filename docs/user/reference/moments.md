---
summary: "the five moments a rule runs at, and exactly when each happens"
---

# Moments

A moment is when a rule runs. A guardrail runs at one or more moments, set with `.at(…)`. A breadcrumb does too.

## The moments

Moments are imported symbols: `commit · command · session · change · turnEnd`.

| Symbol | Moment | Guardrail | Breadcrumb | Runs |
| --- | --- | --- | --- | --- |
| `commit` | commit | yes | no | Git is about to record a commit. A guardrail judges the staged files, the files the commit deletes, and the commit message. See [the commit moment](#the-commit-moment) |
| `command` | command | yes | yes | Before a shell command runs. A guardrail refuses it. A breadcrumb is shown before it runs, scoped by `.on(…)` to the commands it is about |
| `session` | session | no | yes | A session starts, resumes or is cleared, and a subagent starts or is resumed. A breadcrumb bound with `.for(…)` is shown only to an agent of that category |
| `change` | change | no | yes | After a tool call that changed a file matching the breadcrumb's `.on(…)`. A created file and a deleted file are changes. See [the change moment](#the-change-moment) |
| `turnEnd` | turn-end | yes | yes | An agent hands back: the main session or a subagent. A guardrail holds the turn open. A breadcrumb is shown. See [the turn-end moment](#the-turn-end-moment) |

`turnEnd` is spelled that way because a symbol has no hyphen. The moment is called "turn-end".

Which hook of each harness delivers each moment is on [flow under Claude Code](./claude-code.md) and [flow under Codex](./codex.md).

## The commit moment

Git delivers the commit moment, not the harness, so it runs for a commit a person makes too. Two git hooks deliver it:

| Hook | File | Runs | Judges |
| --- | --- | --- | --- |
| before the commit | `.githooks/pre-commit` | `flow hook commit` | the staged files, and the files the commit deletes |
| the commit message | `.githooks/commit-msg` | `flow hook commit-msg` | the message |

- **The staged changes** are read from git: the files the commit adds, changes and deletes.
- **A rename** is, to git, a deletion of the old path plus an add of the new one.
- **A rule with no `.on(…)`** is called once, with the whole staged set in `ctx.staged` and the deleted paths in `ctx.deleted`.
- **A rule with `.on(…)`** is called once per added or changed file in scope, with that file in `ctx.file`.
- **A file the commit deletes** is judged by [`protectedPath`](../checks/protected-path.md), which is called once per deleted file in scope. Your own check reads `ctx.deleted`.
- **A rule that reads the message** runs in the commit-message hook, with the message in `ctx.message`. Those are the stock checks [`commitMessage`](../checks/commit-message.md) and [`commitReason`](../checks/commit-reason.md), and any rule of your own with a `{ message }` case. Every other commit rule runs in the hook before the commit.
- **The message** is as git records it: comment lines, and the diff that `git commit -v` adds, are removed.

Which commits git runs the hooks for:

| Command | Judged |
| --- | --- |
| `git commit`, and `git commit --amend` | the staged files and the message |
| `git merge`, with or without a conflict | nothing. A merge commit passes |
| `git cherry-pick`, `git revert`, `git rebase` | nothing. Git runs no hook that can refuse them |
| `git commit --no-verify` | nothing. Git skips both hooks |

## The change moment

A `change` breadcrumb is shown after a tool call that changed a file under its `.on(…)` globs.

- **What changed** is found by comparing git's list of changed paths before and after the call. Any tool counts: Edit, Write, a shell command, a script the command ran.
- **A file git ignores** is not in git's list, so its change shows no breadcrumb.
- **A call that edits and commits in one line** leaves git's list clean. flow reads the files of the commit as the changed paths.
- **Another worktree of the same repository** is read too, when the call worked in it. The rules are those of the config in the folder the session started in.
- **The breadcrumb is shown after the first change,** with the tool's result. The agent reads it before its next call.

## The turn-end moment

A turn-end rule runs each time an agent hands back: the main session or a subagent. The same rules run at both.

- **A rule with no `.for(…)`** runs for both. A rule with `.for(…)` runs only for an agent that has one of the categories it names, as [rules bound to who](../explanation/rules-bound-to-who.md) shows.
- **A harness's internal agents,** such as the one that makes prompt suggestions, are not judged and are shown nothing.
- **A guardrail** holds the turn open, and its message is the agent's next instruction. The agent acts on it, then hands back again.
- **A breadcrumb** is shown. The agent takes one more turn to read it, then hands back again.
- **A guardrail and a breadcrumb at the same hand-back** are passed to the agent together.
- **A hand-back that a hook already held open** is let through: flow runs no guardrail and shows no breadcrumb. So flow never holds an agent open twice in a row.
- **`ctx.turn`** holds the actions of the agent that hands back.

## When a breadcrumb is shown again

A breadcrumb is shown to an agent once. It is shown to the same agent again in two cases:

- **After a compaction.** A compaction removes the breadcrumb's text from the agent's context. Every breadcrumb except a `session` one is shown again the next time its moment happens.
- **After the context grows by `driftTokens`** since the breadcrumb was last shown, 200,000 tokens by default. This applies to every breadcrumb except a `session` one. `driftTokens` is a [setting](./config.md#settings).

A `session` breadcrumb is shown once per session and agent. A compaction, or a resume that keeps the session, does not show it again.

## Scope at the command moment

`command` is the one moment where the two kinds are scoped differently.

- **A command guardrail** takes no `.on(…)`. Its patterns are its scope.
- **A command breadcrumb** has no patterns, so `.on(…)` is the only thing that says which commands it is about. Without one it would show on every shell call.

---

[Index](../index.md) · the verbs that set a moment: [the config](./config.md) · what a check is called with at each moment: [what a check is given](./ctx.md) · the commands: [the flow command](./cli.md)
