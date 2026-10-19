---
summary: "the agent stops and says flow does not guard the git worktree it is working in: why, and how to start a session there"
---

# flow says it does not guard this worktree

The agent stops and tells you that flow does not guard the worktree it is working in. A **worktree** is another working folder of the same repository, with its own branch checked out.

## What you see

The agent stops its work and tells you two folders:

- **The folder flow guards:** the one the Claude Code session started in.
- **The worktree flow does not guard:** the one the agent was working in.

It asks you to start a session in that worktree. flow passed the agent this message at the first tool call that worked in the worktree: an Edit or Write of a file there, or a shell command run there.

## Why

flow guards only the folder a Claude Code session started in. The agent reached the worktree by running `cd` into it, or by editing a file there. Its changes in that worktree are unguarded:

- **No guardrail** judges a write or a delete there, and nothing is written back.
- **No breadcrumb** is shown for a file there.
- **Only the commit gate** still runs, when a commit is made in that worktree.

[Another worktree of the same repository](../explanation/what-the-guard-sees.md#another-worktree-of-the-same-repository) explains why flow tells the agent rather than guarding the worktree too.

## How to fix it

1. End the session, or keep it for work in the folder it started in.
2. If the repo lists `@jawache/flow` as a dev dependency, install the packages in the worktree. A worktree has its own `node_modules`, and the hooks run the worktree's own copy of flow first.

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

5. Check the files the earlier session changed in the worktree, because no guardrail judged them. In the worktree, run the commit rules over every file:

   ```
   flow hook commit --all
   ```

### When a subagent reported it

A subagent that Claude Code starts in its own worktree, with `isolation: "worktree"`, gets the same message. It stops and reports back to the agent that started it. To have that work guarded, start a session in the worktree, as in the steps above, instead of a subagent.

---

[Index](../index.md) · why flow tells rather than follows: [Another worktree of the same repository](../explanation/what-the-guard-sees.md#another-worktree-of-the-same-repository) · `flow hook commit --all`: [the flow command](../reference/cli.md#commands)
