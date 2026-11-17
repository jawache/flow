---
summary: "about what flow can see at each moment, and what it cannot: the commit as git has it, the parse of a command, and the list of changed paths"
---

# What flow sees

flow judges only what it can read whole. At a commit that is the staged content and the message. At a command it is the parse of the line. After a call it is a list of paths, with no content.

## At a commit: what git has

Git holds everything a commit is before it records it, and flow reads it from git:

- **The staged files,** as staged: each file the commit adds or changes, with its content.
- **The files the commit deletes,** by path.
- **The message,** as git records it.

Nothing here depends on how the files were written. An edit tool, `sed -i`, a script and a recipe all end as the same staged content. That is why content rules judge at the commit.

flow does not judge every commit: a merge, a cherry-pick, a revert, a rebase and a commit with `--no-verify` pass. [The commit moment](../reference/moments.md#the-commit-moment) has the table. Work that is never committed is not judged.

## At a command: the parse

Before a shell command runs, flow parses the line as bash. The parse is a list of commands, each one a program and its arguments as the program receives them. flow reads shell as code, never as text: a regex over a line cannot tell one command from the next, a command from the same words inside a quoted argument, or `task` from `task-list`.

So a command rule names a command in words. `"git push --force"` is the program `git` and the arguments `push` and `--force`, compared with each command in the parse one whole argument at a time.

The parse follows what is written on the line: nested commands, the folder each command runs in, a variable the line sets, a loop's values. [The command parse](../reference/parse.md) is its boundary, and states everything followed.

**What flow does not see at a command:**

- **What a script does.** `python3 build.py` is one command. What it runs, writes or deletes is not in the parse.
- **A variable set anywhere but on the line.**
- **What the command changed.** flow judges the command before it runs, by its words. It does not judge the files it leaves behind.

This is why a command guardrail is for an exact command you can name, such as a force-push. A rule about what a line might do to a file belongs at the commit, where the file is.

## After a call: the changed paths

After each tool call, flow compares git's list of changed paths with the list before the call. The paths that are new or changed again are what the call changed. flow stores no file content for this.

The list has one use: a breadcrumb bound at `change` is shown when a path under its globs is in it. The same list is written to the session log.

**What flow does not see after a call:**

- **A file git ignores.** It is not in git's list.
- **The content of a change.** No rule judges it here.
- **The change before it lands.** The breadcrumb arrives after the first change in an area, and the agent reads it before its next call.

## What flow does not stop

flow does not stop a write. An agent can write any file in the working tree, and delete any file. What flow guards is the two ways out of the working tree: the commit, and a command that leaves the machine.

A mistake in the working tree is recoverable: git has the last commit. A guardrail on a recoverable mistake costs more in wrong refusals than it saves, so flow answers those with a breadcrumb, such as "commit often, and stash before you discard".

## Who is acting

Each call from a harness names the agent that made it, and its type. flow reads both from the harness's payload, never from what the agent says. A commit names no agent, so its rows in the log, and any rule bound to who, use the agent whose call last ran in that worktree. [Rules bound to who](./rules-bound-to-who.md) has the reasoning.

---

[Index](../index.md) · the boundary of the parse: [the command parse](../reference/parse.md) · when each moment runs: [moments](../reference/moments.md) · what each harness passes: [Claude Code](../reference/claude-code.md) · [Codex](../reference/codex.md)
