---
summary: "keep flow guarding an agent that works in a git worktree, and what to do when flow says it does not guard the worktree the agent is in"
---

# How to work in a git worktree

This guide shows you how to keep flow guarding an agent that works in a git worktree. A **worktree** is another working folder of the same repository, with its own branch checked out.

> [!WARNING]
> flow guards only the folder a Claude Code session started in. When the agent works in another worktree, by running `cd` into it or by editing a file there, its changes in that worktree are unguarded:
>
> - **No guardrail** judges a write or a delete there, and nothing is written back.
> - **No breadcrumb** is shown for a file there.
> - **Only the commit gate** still runs, when a commit is made in that worktree.

## Start the session in the worktree

1. Create the worktree, or pick one you already have:

   ```
   git worktree add -b feature ../my-repo-feature
   ```

2. If the repo lists `@jawache/flow` as a dev dependency, install the packages in the worktree. A new worktree has no `node_modules`, and the hooks run the worktree's own copy of flow first.

   ```
   cd ../my-repo-feature
   npm install
   ```

3. Start Claude Code from inside the worktree:

   ```
   claude
   ```

4. Check that flow guards the worktree:

   ```
   flow status
   ```

   The `state` line names the worktree's own `.flow` folder, such as `…/my-repo-feature/.flow`.

## When flow says it does not guard the worktree

flow passes the agent a message at the first tool call that works in another worktree of the repository. The message names the folder flow guards and the worktree it does not guard. It tells the agent to stop its work there and tell you.

When the agent tells you this:

1. End the session, or keep it for work in the folder it started in.
2. Start a new session in the worktree, as in [Start the session in the worktree](#start-the-session-in-the-worktree).
3. Check the files the earlier session changed in the worktree, because no guardrail judged them. In the worktree, run the commit rules over every file:

   ```
   flow hook commit --all
   ```

A subagent that Claude Code starts in its own worktree, with `isolation: "worktree"`, gets the same message. It stops and reports back to the agent that started it. To have its work guarded, start a session in that worktree instead.

---

[Index](../index.md) · why flow tells rather than follows: [Another worktree of the same repository](../explanation/what-the-guard-sees.md#another-worktree-of-the-same-repository) · `flow hook commit --all`: [the flow command](../reference/cli.md#commands)
