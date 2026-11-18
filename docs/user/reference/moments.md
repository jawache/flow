---
summary: "the five moments a rule runs at, and exactly when each happens"
---

# Moments

A [moment](./glossary.md#moment) is when a rule runs. A [guardrail](./glossary.md#guardrail) runs at one or more moments, set with `.at(…)`. A [breadcrumb](./glossary.md#breadcrumb) does too.

## The moments

Moments are imported symbols: `commit · command · session · fileChange · turnEnd`.

Two facts about a moment decide what it takes. A guardrail needs a moment that is before the thing happens, so there is something to refuse. A breadcrumb needs a moment where flow can add text to the agent's context.

| Symbol | Moment | When | Before the thing? | Text to the agent? | Takes |
| --- | --- | --- | --- | --- | --- |
| `commit` | commit | Git is about to record a commit. See [the commit moment](#the-commit-moment) | yes | no: git calls flow, not the [harness](./glossary.md#harness) | a guardrail, which refuses the commit |
| `command` | command | Before a shell command runs | yes | yes | a guardrail, which refuses the command, and a breadcrumb, scoped by `.on(…)` to the commands it is about |
| `turnEnd` | turn-end | An agent is about to hand back: the main session or a subagent. See [the turn-end moment](#the-turn-end-moment) | yes | yes | a guardrail, which holds the turn open, and a breadcrumb |
| `session` | session | A session starts, resumes or is cleared, and a subagent starts or is resumed | nothing to refuse | yes | a breadcrumb. Bound with `.for(…)`, it is shown only to an agent of that [category](./glossary.md#category) |
| `fileChange` | file-change | After a tool call that changed a file. A created file and a deleted file are changes. See [the file-change moment](#the-file-change-moment) | no: it has happened | yes | a breadcrumb, scoped by `.on(…)` to the files it is about |

A guardrail at `session` or `file-change`, and a breadcrumb at `commit`, do not compile.

`fileChange` and `turnEnd` are spelled that way because a symbol has no hyphen. The moments are called "file-change" and "turn-end".

Which hook of each harness delivers each moment is on [flow under Claude Code](./claude-code.md) and [flow under Codex](./codex.md).

## The commit moment

Git delivers the commit moment, not the harness, so it runs for a commit a person makes too. One git hook delivers it: `.githooks/commit-msg`, git's commit-message hook, which runs `flow hook commit` once git has the message. Every commit rule runs there, once, with the staged files and the message.

Someone who commits in an editor writes the message first. The commit is refused when they save it.

- **The staged changes** are read from git: the files the commit adds, changes and deletes.
- **A rename** is, to git, a deletion of the old path plus an add of the new one.
- **A rule with no `.on(…)`** is called once, with the whole commit.
- **A rule with `.on(…)`** is called once per added or changed file in scope, with that file in `ctx.file`.
- **The files the commit deletes** are a list of paths, `ctx.deleted`, in every call. No rule is called for a deleted file. A rule that judges deletions reads the list, as [`protectedPath`](../checks/protected-path.md) does.
- **Every call has the message,** in `ctx.message`, and the staged paths, in `ctx.staged`.
- **The message** is as git records it: comment lines, and the diff that `git commit -v` adds, are removed.

Which commits are judged:

| Command | Judged |
| --- | --- |
| `git commit`, and `git commit --amend` | the staged files and the message |
| `git merge`, with or without a conflict | nothing. A merge commit passes |
| `git cherry-pick`, `git revert`, `git rebase` | nothing. Git runs no hook that can refuse them |
| `git commit --no-verify` | nothing. Git skips the hook |

## The file-change moment

A `file-change` breadcrumb is shown after a tool call that changed a file under its `.on(…)` globs.

- **What changed** is found by comparing git's list of changed paths before and after the call. Any tool counts: Edit, Write, a shell command, a script the command ran.
- **A file git ignores** is not in git's list, so its change shows no breadcrumb.
- **Another worktree of the same repo** is read too, when the call worked in it. The rules are those of the config in the folder the session started in.
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

- **After a compaction.** A compaction removes every breadcrumb's text from the agent's context. A `session` breadcrumb is shown again at once, as the compacted session starts. Every other breadcrumb is shown again the next time its moment happens.
- **After the context grows by `driftTokens`** since the breadcrumb was last shown, 200,000 tokens by default. This applies to every breadcrumb except a `session` one. `driftTokens` is a [setting](./config.md#settings).

A resume that keeps the session does not show a `session` breadcrumb again.

## Scope at the command moment

`command` is the one moment where the two kinds are scoped differently.

- **A command guardrail** takes no `.on(…)`. Its patterns are its scope.
- **A command breadcrumb** has no patterns, so `.on(…)` is the only thing that says which commands it is about. Without one it would show on every shell call.

---

[Index](../index.md) · the verbs that set a moment: [the config](./config.md) · what a check is called with at each moment: [what a check is given](./ctx.md) · the commands: [the flow command](./cli.md)
