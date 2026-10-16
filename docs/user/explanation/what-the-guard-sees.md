---
summary: "about how flow detects every change to the tree, and why it judges the change on disk rather than the tool that made it"
---

# What the guard sees

A guardrail is checked against what changed on disk, not against the tool that changed it.

## One mechanism for every change

Before each tool call, flow records the content of every file in the working tree. This record is the **snapshot**. After the call, flow compares the snapshot with the tree as it now stands, and the differences are the changes the call made:

- **Each file the call created or changed** is passed to the write rules, with the content now on disk.
- **Each file the call removed** is passed to the delete rules.
- **Each breadcrumb whose globs match a changed path** is shown to the agent.

A file git put in place is left out of all three. That is a file that matches HEAD after the call, or one the call removed that HEAD held before the call and does not hold after it. Either counts only when HEAD after the call is a commit the repo already has. See [Files git puts in place](#files-git-puts-in-place).

Which rules a change is passed to depends on the change on disk, not on the command that made it. So a heredoc, `sed -i`, a Python script, a `just` recipe, an MCP tool and a subagent all reach the rules by the same route. That leaves one mechanism to understand, and no second one to reach for when a change arrives some new way.

flow reads a tool call's input in three cases, each to act earlier than the diff can:

- **The Edit and Write tools:** flow builds the file the tool would produce from the tool's input, and judges it before it is written.
- **An `rm` command:** flow reads the files it names from the command line, and judges each delete before the command runs.
- **A shell command's reads:** flow reads the paths it reads from the command line, to show their breadcrumbs.

## Two routes, one outcome

The two routes differ in timing, not in outcome:

- **A change made through the Edit or Write tool** is checked before it lands. flow builds the file the tool would produce, holds it in memory, and calls the rules on that. A refusal leaves the disk untouched.
- **A file an `rm` command names** is checked before the command runs. A refusal stops the command.
- **A change made any other way** is checked once it has landed, because until then its content does not exist anywhere to check. When a rule refuses it, flow writes the file back to the content it had before the call, byte for byte. The agent is told which rule refused and why, in the same place it reads the tool's own result.

Either way, a refused write never stays on disk. Someone writing a rule does not need to know which route ran. A check is called with a path and the file's content in both cases, and its message reads the same either way.

The first line of the refusal differs between the routes, so a reader of the log can tell which one happened:

```
flow — blocked before the write landed:          an Edit, judged in memory — disk untouched
flow — blocked before the delete:                an rm, judged before it ran
flow — write reverted after it landed:           a shell edit, undone from the snapshot
flow — delete reverted after it landed:          a shell delete, restored from the snapshot
```

A refused shell edit then reads like this. The last line is on every refusal after a change has landed:

```
✗ house.noTodo · src/b.ts
  No TODOs in src/ — do it now, or track it properly.
    line 3: matches /\bTODO\b/

src/b.ts is back to its previous content. Adjust the change so it passes and write it again — through Edit, which is judged before it lands.
Only file content was put back: anything else the call did has already happened.
```

## How much a refusal undoes

How much of a call a refusal undoes is a choice, set by `revert` in the config's [settings](../reference/config.md#settings):

- **`revert: "refused"`**, the default, writes back only the files that failed a rule. The other files the same command wrote stay as the command wrote them, and the refusal message lists them.
- **`revert: "all"`** writes back every file the call changed. Choose it if you would rather a refusal mean the call never happened.

Neither setting undoes anything except file content. If the same command ran the tests over the bad content, made a commit, pushed, or ran a migration, those have already happened and they stay. The refusal message says so.

## Files git puts in place

A file that matches HEAD after the call is left out of the diff, when HEAD is a commit the repo already has. HEAD is the commit the checked-out branch points at. A call that makes a new commit, such as a commit, a rebase or a merge that is not a fast-forward, has every change judged.

A `git switch`, `checkout` or `reset`, or a `pull` or `merge` that fast-forwards, writes files out of a commit the repo already has. That content is already committed, and committed content is judged at the commit gate. Judging it again against today's rules refuses files that are right for that commit, and writing them back leaves the tree different from HEAD. So flow compares each changed file with its copy in HEAD after the call:

- **A file identical to its copy in HEAD** is left out. It is not judged, not written back, and shows no breadcrumb, and `flow facts` does not count it as a shell write.
- **A file the call removed that HEAD held before the call and does not hold after it** is left out the same way. A file no commit holds, such as an untracked file or `.env`, is still judged when it is removed.
- **Every other change** is judged as above. An edit to a committed file differs from its copy in HEAD, so it is judged.

The test reads content, not the command line. So git run by a `just` recipe or a script is covered, and in `git switch dev && sed -i … file` the `sed` edit is still judged.

**A commit the call makes** does not leave its files out, unless the call also pushes it. A call can skip the commit gate, with `git commit --no-verify` or by removing the hook first, so the content of a commit it makes has not been judged. HEAD after the call is a commit the repo already has in two cases:

- **Before the call**, a ref or a worktree's HEAD pointed at it or at a commit built on it. A ref is a branch, a tag or a remote-tracking branch.
- **After the call**, a remote-tracking branch points at it or at a commit built on it. A `git pull` fetches a commit and moves HEAD to it in the same call, and this is what leaves the files it brings out. A commit the call makes and pushes counts the same way.

A `git stash pop`, a merge stopped on conflicts and a `cherry-pick --no-commit` write files that match no commit. Those files are judged like any other write.

## Several agents in one worktree

The **harness** is the coding-agent program flow plugs into, such as Claude Code. It runs one writing tool call at a time for each agent in a session, so the calls of one agent never overlap each other.

A parent agent and its subagents are not ordered against each other that way, and their calls can overlap in time. flow works out the overlap from its own log of each call's snapshot and diff. Another agent's call overlaps this one if it started before this call's diff, and either has not finished or finished after this call's snapshot. When any call overlaps, flow writes back only the refused files, even where `revert: "all"` is set, and the message lists the overlapping calls.

## A command started in the background

A command started in the background gets no special treatment. The tool call returns before the process does, and the harness runs no hook when the process ends. So what the process writes after that point shows up in the diff of whichever later tool call finds it. It is judged there, and written back if a rule refuses it. With `revert: "all"` set, it goes back with everything else that call changed.

A revert can therefore land on a file a process is still writing. Keep what a background process writes, such as logs, build output and caches, in a path git ignores. flow never records an ignored path unless `snapshotInclude` lists it. An untracked folder that git does not ignore is still recorded.

## Who may write is a separate question

Overlap is about when a write happened. The [`oneWriter`](../checks/one-writer.md) check is about who was allowed to make it. It is given the categories that may change files, where a category is flow's name for the actor behind a call, and it fails for any actor outside that list. So a verifier agent that corrects a typo of its own accord has the file written back, and the message says which actor wrote it.

## Reads through the shell

A breadcrumb is a note shown to the agent, not a refusal, so it is worth showing on a file the agent only reads. That is why the `touch` moment also matches the paths a shell command reads. `cat`, `head`, `sed -n` and `grep` on a path all match the `touch` moment, and the note is shown before the command's output comes back.

Reading paths out of a command line is best-effort, so a script that computes its own paths is not detected. The diff still catches what that misses: a file that changes without any detected read has its breadcrumb shown at the change. That is later than it would otherwise be, but it is not skipped.

## Two commands report on all of this

- **`flow status`** prints the permission mode the session runs under. Under Claude Code's auto mode, it says whether the session is being steered towards shell edits.
- **`flow facts`** counts shell writes and shell reads alongside the edits made through tool calls, and lists their paths. That is why its lead and coverage figures count everything that happened.

## The edges of the snapshot

The snapshot holds what git holds: every tracked file, and every untracked file that git does not ignore.

- **A file git ignores** is not in it, so a shell write to that file is not judged, and neither is anything under `.git`. Some ignored files are worth guarding, and an `.env` file is the usual one. `snapshotInclude` in the config lists globs for the ignored paths to record as well.
- **A rule whose scope reaches an ignored path** that the snapshot leaves out is reported by `flow status` as a red line naming the rule and the setting, so the gap cannot stay silent.
- **Files outside the repository** are never recorded.
- **A file that one command creates and then deletes** leaves nothing in the diff, so no rule is called on it.
- **A command you type yourself with `!`** is your own work rather than the agent's, and it is not put through the guard.

---

[Index](../index.md) · `revert` and `snapshotInclude`: [the settings](../reference/config.md#settings) · when each rule runs: [the moments](../reference/moments.md) · the model: [how flow works](./how-flow-works.md)
