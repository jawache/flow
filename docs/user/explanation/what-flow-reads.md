---
summary: "about what flow reads at each moment, and what it cannot read: the commit as git has it, the parse of a command, and the list of changed paths"
---

# What flow reads

flow judges only what it can read whole. At a commit, that is the staged content and the message. At a command, it is the parse of the line. After a tool call, it is a list of paths, with no content.

## At a commit: what git has

Git holds everything a commit is before it records it. flow reads three things from git:

- **The staged files:** each file the commit adds or changes, with its content as staged.
- **The files the commit deletes,** by path.
- **The message,** as git records it.

None of this depends on how a file was written. An edit tool, `sed -i`, a script and a recipe all produce the same staged content. That is why content rules judge at the commit.

Some commits are not judged: a merge, a cherry-pick, a revert, a rebase, and a commit with `--no-verify`. [The commit moment](../reference/moments.md#the-commit-moment) has the table. Work that is never committed is not judged.

## At a command: the parse

Before a shell command runs, flow parses the line as bash, with [unbash](https://github.com/webpro-nl/unbash). The parse is a list of commands. Each one is a program and its arguments, as the program receives them.

flow reads shell as code, never as text. A regex over a line cannot tell one command from the next. It cannot tell a command from the same words inside a quoted argument, or `task` from `task-list`.

So a command rule names a command in words. `"git push --force"` is the program `git` and the arguments `push` and `--force`. flow compares them with each command in the parse, one whole argument at a time.

The parse follows what is written on the line: nested commands, the folder each command runs in, a variable the line sets, a loop's values. [The command parse](../reference/parse.md) states everything it follows.

**What the parse does not hold:**

- **What a script does.** `python3 build.py` is one command. What it runs, writes or deletes is not in the parse.
- **A variable set anywhere but on the line.**
- **What the command changes.** flow judges the command before it runs, by its words.

This is why a command [guardrail](../reference/glossary.md#guardrail) is for an exact command you can name, such as a force-push. A rule about what a line does to a file is a commit rule, because the commit has the file.

## After a tool call: the changed paths

After each tool call, flow reads git's list of changed paths and compares it with the list before the call. The paths that are new, or changed again, are the paths the call changed. flow stores no file content for this.

The list has two uses. A [breadcrumb](../reference/glossary.md#breadcrumb) bound at `file-change` is shown when a path under its globs is in the list. The same list is written to the session log.

**What the list does not hold:**

- **A file git ignores.**
- **The content of a change.** No rule judges it here.
- **A change before it is written.** The breadcrumb is shown after the first change in an area. The agent reads it before its next call.

## What flow does not stop

flow does not stop a write or a delete in the working tree. It guards two acts: a commit, and a command you named.

A mistake in the working tree is recoverable, because git has the last commit. A guardrail on a recoverable mistake refuses wrongly more often than it helps. flow uses a breadcrumb for those, such as "commit often, and stash before you discard".

## Who is acting

Each call from a [harness](../reference/glossary.md#harness) names the agent that made it, and its type. flow reads both from the harness's payload, never from the agent's own words.

A commit names no agent. Its rows in the log, and any commit rule bound to who, use the agent whose tool call last ran in that worktree.

[Rules bound to who](./rules-bound-to-who.md) has the reasoning.

---

[Index](../index.md) · everything the parse follows: [the command parse](../reference/parse.md) · when each moment runs: [moments](../reference/moments.md) · what each harness passes: [Claude Code](../reference/claude-code.md) · [Codex](../reference/codex.md)
