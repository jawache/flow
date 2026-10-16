---
summary: "the seven moments a rule runs at, and how each is delivered"
---

# Moments

A moment is when a rule runs. A guardrail runs at one or more moments, set with `.at(…)`. A breadcrumb may be set at four: `session`, `touch`, `command` and `turn-end`. The Claude Code adapter shows a breadcrumb at all four.

## The moments

Moments are imported symbols: `session · touch · write · command · deletion · commit · turnEnd`.

| Symbol | Moment | For | Runs |
| --- | --- | --- | --- |
| `session` | session | breadcrumb | Claude Code's `SessionStart` hook: a chat starts, resumes, is cleared or is compacted. A `session` breadcrumb is shown once per session and agent. A compaction, or a resume that keeps the session, does not show it again |
| `touch` | touch | breadcrumb | After a tool call whose input names a matching file in `file_path`, `notebook_path`, `path` or `glob` (Read, Edit, Write, Grep, Glob and others), and after a call that changed a matching file. Before a shell command that reads a matching file, such as `cat`, `head`, `sed -n` or `grep`. The note is shown the first time, and again once the context size has grown by `driftTokens` since the last showing, 200,000 by default. A compaction clears the marks of every breadcrumb except `session` ones, so each note is shown again at its next touch |
| `write` | write | guardrail | A file is created or changed. When the Edit or Write tool makes the change, the rule runs before the change reaches the disk, on the would-be content of the file held in memory. When anything else makes the change, such as a heredoc, `sed -i`, a script, a recipe or an MCP tool, the rule runs the moment the change has reached the disk, and a refusal writes the previous content back. A refused write never stays on disk. A file that matches HEAD after the call, when HEAD is a commit the repo already has, is not judged here, because git put it there: see [Files git puts in place](../explanation/what-the-guard-sees.md#files-git-puts-in-place) |
| `command` | command | either | Before a shell command runs. A guardrail refuses it. A breadcrumb is shown as a note before it runs, scoped by `.on(…)` to the commands it is about, and again after drift, as at `touch` |
| `deletion` | delete | guardrail | A file is removed. When an `rm` command would remove it, the rule runs before that command runs. When anything else removes it, the rule runs the moment the file is gone, and a refusal writes the file back. A file the call removed that HEAD held before the call and does not hold after it is not judged here, when HEAD after the call is a commit the repo already has: see [Files git puts in place](../explanation/what-the-guard-sees.md#files-git-puts-in-place) |
| `commit` | commit | guardrail | The git pre-commit gate, over the staged changes. It runs for commits people make too. A rule bound at both `deletion` and `commit`, with paths in `.on(…)`, also runs on each file the commit deletes, as a delete |
| `turnEnd` | turn-end | either | Claude Code's `Stop` hook, when the main chat hands back, and its `SubagentStop` hook, when a subagent hands back. A guardrail holds the turn open. A breadcrumb is shown as a note. See [the turn-end moment](#the-turn-end-moment) |

`deletion` and `turnEnd` are spelled that way because `delete` is a reserved word. The moment is still called "delete".

How flow detects a change made outside the Edit tool is on [what the guard sees](../explanation/what-the-guard-sees.md).

## The commit moment

Git's own pre-commit hook delivers the commit moment, not the harness. The hook is `.githooks/pre-commit`, and it runs `flow hook commit`.

- **The staged changes** are read from git: the files the commit adds, changes and deletes.
- **A rename** is, to git, a deletion of the old path plus an add of the new one.
- **A rule with no `.on(…)`** is called once, with the whole staged set in `ctx.staged`.
- **A rule with `.on(…)`** is called once per staged file in scope, with that file in `ctx.file`.
- **A file the commit deletes** goes only to a rule bound at both `deletion` and `commit`, with paths in `.on(…)`.

## The turn-end moment

A turn-end rule runs each time an agent hands back: the main chat or a subagent. The same rules run at both.

- **The main chat** hands back through Claude Code's `Stop` hook.
- **A subagent** hands back through Claude Code's `SubagentStop` hook. A rule with no `.for(…)` runs for it, as at every other moment. A rule with `.for(…)` runs only for an agent that has one of the categories it names, as [rules bound to who](../explanation/rules-bound-to-who.md) shows.
- **Claude Code's internal agents** also send `SubagentStop`. They make prompt suggestions and answer `/btw` side questions. flow runs no guardrail and shows no note for them.
- **A guardrail** holds the turn open, and its message is the agent's next instruction. The agent acts on it, then hands back again.
- **A breadcrumb** is shown as a note. The agent takes one more turn to read it, then hands back again.
- **When a note shows:** the first time, and again once the context size has grown by `driftTokens` since the last showing, as at `touch`.
- **A guardrail and a note at the same hand-back** are passed to the agent together.
- **A hand-back that a stop hook already held open** is marked by Claude Code with `stop_hook_active`. flow lets it through: it runs no guardrail and shows no note. So flow never holds an agent open twice in a row.
- **`ctx.turn`** holds the actions of the agent that hands back, read from that agent's own transcript.

## Scope at the command moment

`command` is the one moment where the two kinds are scoped differently.

- **A command guardrail** takes no `.on(…)`. Its patterns are its scope.
- **A command breadcrumb** has no patterns, so `.on(…)` is the only thing that says which commands it is about. Without one it would show on every shell call.

---

[Index](../index.md) · the verbs that set a moment: [the config](./config.md) · what a check is called with at each moment: [the ctx a check reads](./ctx.md) · the commands: [the flow command](./cli.md)
