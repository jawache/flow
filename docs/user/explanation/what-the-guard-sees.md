---
summary: "about how flow detects every change to the tree, and why it judges the change on disk rather than the tool that made it"
---

# What the guard sees

A guardrail is checked against what changed on disk, not against the tool that changed it.

## The snapshot: what a call changed

Before each tool call, flow records the content of every file in the working tree. This record is the **snapshot**. After the call, flow compares the snapshot with the tree as it now stands, and the differences are the changes the call made:

- **Each file the call created or changed** is passed to the write rules, with the content now on disk.
- **Each file the call removed** is passed to the delete rules.
- **Each breadcrumb whose globs match a changed path** is shown to the agent.

A file git put in place is left out of all three. That is a file that matches HEAD after the call, or one the call removed that HEAD held before the call and does not hold after it. Either counts only when HEAD after the call is a commit the repo already has. See [Files git puts in place](#files-git-puts-in-place).

Which rules a change is passed to depends on the change on disk, not on the command that made it. So a heredoc, `sed -i`, a Python script, a `just` recipe, an MCP tool and a subagent all reach the rules by the same route. So no change escapes the snapshot, however it arrives.

flow reads a tool call's input in two cases, each to act earlier than the diff can:

- **The Edit and Write tools:** flow builds the file the tool would produce from the tool's input, and judges it before it is written.
- **A shell command:** flow parses the command line as bash before it runs. The command rules judge the parse, the files an `rm` removes are judged as deletes, and the files the command reads have their breadcrumbs shown. [The parse](#the-parse-what-a-command-is) explains how.

## The parse: what a command is

The snapshot records what a command changed. The parse reads what a command is, before it runs. They are flow's two mechanisms, and every guardrail on a shell command uses one or both.

flow reads shell as code, never as text. A regex over a command cannot tell one command from the next, a command from the same words inside a quoted argument, or `task` from `task-list`. So no rule in flow decides which command it is looking at with a regex:

- **A command rule names a command in words.** `"git push --force"` is the program `git` and the arguments `push` and `--force`, and flow compares them with each command in the parse, one whole argument at a time.
- **A regex is for text.** A commit message, a pull request body or a file's contents is text, and a rule about it may match a regex against it.

flow parses each command line once, with [unbash](https://github.com/webpro-nl/unbash), a bash parser. The parse is a list of simple commands, each one program and its arguments as the program receives them:

- **Separate commands stay separate.** `git push origin main; ls -f` is two commands, and the `-f` is an argument of `ls`.
- **A quoted argument is one argument.** In `gh issue create --body "ran npx vitest run"`, the words `npx vitest run` are text passed to `gh`.
- **Nested commands are in the list.** A command inside `$( … )`, backticks or `<( … )` is a command of its own. So is each command in a string given to `bash -c`, `sh -c` or `eval`.
- **A heredoc fed to a shell is commands.** Each line of a heredoc a shell reads, such as `bash <<'EOF'` or `cat <<'EOF' | sh`, is read as a nested command.
- **A here-string fed to a shell is commands.** The text of a here-string read by `bash`, `sh`, `zsh`, `dash` or `ksh`, such as `bash <<< 'rm -rf build'`, is read as nested commands.
- **A heredoc belongs to its command.** Each heredoc is attached to the command it feeds, with whether its delimiter is quoted. In the body of a quoted heredoc, such as `<<'EOF'`, the shell runs nothing.
- **The program is the one that runs.** A variable assignment such as `FOO=1`, and a wrapper such as `sudo`, `env` or `timeout 5`, is stepped past. `sudo rm -rf build` has the program `rm`.

Every rule that judges a shell command before it runs reads this one parse:

- **The command rules.** [`banCommands`](../checks/ban-commands.md) compares the program and arguments it names with each command in the parse, and a check of your own reads it as [`ctx.commands`](../reference/ctx.md#ctxcommands).
- **The git safety rail.** It reads which `git` commands the line runs, and which repo each one is aimed at.
- **Deletes.** The files that `rm`, `git rm` and `mv` remove are read from their commands' arguments, and judged before the command runs.
- **Reads.** The files that `cat`, `head`, `sed -n`, `grep` and the other readers name are read from their commands' arguments, to show their breadcrumbs.
- **Recipes.** A command whose program the repo has a recipe for is counted as going round the recipe.

The parse holds only what is written on the line. It does not include what `python3 script.py` or a `just` recipe writes, or the value a variable holds when the command runs. That is why the snapshot, not the parse, is the record of what a command changed. A line flow cannot parse, such as one with an unclosed quote, has no parse. `ctx.commands` is then `null`, and `banCommands` refuses the line when the program and every argument it names appear in it as whole words.

## The order within a shell command

1. The agent sends a shell command.
2. flow parses the command line.
3. The command rules run on the parse. A refusal stops the command here, before anything has run.
4. flow records the snapshot, and the command runs.
5. flow compares the tree with the snapshot. The write and delete rules run on what changed, and a refused change is written back.

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

A parent agent and its subagents are not ordered against each other that way, and their calls can overlap in time. flow works out the overlap from its own log of each call's snapshot and diff. Another agent's call overlaps this one if it started before this call's diff, and either has not finished or finished after this call's snapshot. A call with no finish an hour after it started is treated as dead, and is not counted. When any call overlaps, flow writes back only the refused files, even where `revert: "all"` is set, and the message lists the overlapping calls.

## A command started in the background

A command started in the background gets no special treatment. The tool call returns before the process does, and the harness runs no hook when the process ends. So what the process writes after that point shows up in the diff of whichever later tool call finds it. It is judged there, and written back if a rule refuses it. With `revert: "all"` set, it goes back with everything else that call changed.

A revert can therefore land on a file a process is still writing. Keep what a background process writes, such as logs, build output and caches, in a path git ignores. flow never records an ignored path unless `snapshotInclude` lists it. An untracked folder that git does not ignore is still recorded.

## Who may write is a separate question

Overlap is about when a write happened. The [`oneWriter`](../checks/one-writer.md) check is about who was allowed to make it. It is given the categories that may change files, where a category is flow's name for the actor behind a call, and it fails for any actor outside that list. So a verifier agent that corrects a typo of its own accord has the file written back, and the message says which actor wrote it.

## Reads through the shell

A breadcrumb is a note shown to the agent, not a refusal, so it is worth showing on a file the agent only reads. That is why the `touch` moment also matches the paths a shell command reads. `cat`, `head`, `sed -n` and `grep` on a path all match the `touch` moment, and the note is shown before the command's output comes back.

The paths come from [the parse](#the-parse-what-a-command-is), so a path named inside a quoted argument or a heredoc body is not a read. A script that computes its own paths is not detected. The diff still catches what that misses: a file that changes without any detected read has its breadcrumb shown at the change. That is later than it would otherwise be, but it is not skipped.

## Two commands report on all of this

- **`flow status`** prints the permission mode the session runs under. Under Claude Code's auto mode, it says whether the session is being steered towards shell edits.
- **`flow facts`** counts shell writes and shell reads alongside the edits made through tool calls, and lists their paths. That is why its lead and coverage figures count everything that happened.

## The edges of the snapshot

The snapshot holds what git holds: every tracked file, and every untracked file that git does not ignore.

- **A file git ignores** is not in it, so a shell write to that file is not judged, and neither is anything under `.git`. Some ignored files are worth guarding, and an `.env` file is the usual one. `snapshotInclude` in the config lists globs for the ignored paths to record as well.
- **A rule that names an ignored path exactly**, such as `.on(".env.keys")`, is reported by `flow status` as a red line naming the rule and the setting, unless `snapshotInclude` lists the path. The red line is only for a path the rule names exactly. A broad glob such as `src/**` that also matches an ignored `.DS_Store` gets no red line.
- **A file that enters the snapshot during a call** has no earlier copy in it. This happens when the call adds the file to `snapshotInclude`, or edits `.gitignore` so git stops ignoring it. flow records the file as it stands, does not judge it for that call, and prints one line naming it. Every later change to the file is judged. So flow never deletes a file it has no earlier copy of.
- **A file that leaves the snapshot during a call** was not removed, so no delete rule is called on it. This happens when the call removes the file from `snapshotInclude`, or adds it to `.gitignore`. If the call left the file as it was, nothing is judged. If the call also rewrote it, the write rules judge that change, and a refused rewrite is put back.
- **Files outside the repository** are never recorded.
- **Files in another worktree of the same repository** are outside the folder flow guards too. flow tells the session when it works there. See [Another worktree of the same repository](#another-worktree-of-the-same-repository).
- **A file that one command creates and then deletes** leaves nothing in the diff, so no rule is called on it.
- **A command you type yourself with `!`** is your own work rather than the agent's, and it is not put through the guard.

## Another worktree of the same repository

> [!WARNING]
> A session that works in a worktree it did not start in is unguarded there. No guardrail judges its changes in that worktree and no breadcrumb is shown for them. Only the commit gate judges them, when they are committed. [flow says it does not guard this worktree](../troubleshooting/flow-does-not-guard-this-worktree.md) gives the fix: start the session in the worktree.

flow guards one folder: the folder the session started in. Claude Code passes that folder to every hook as `CLAUDE_PROJECT_DIR`. The snapshot, the log and the state in `.flow/` all belong to it.

A git **worktree** is another working folder of the same repository, with its own branch checked out. A session can work in one without starting there, by running `cd` in its commands. The files it changes there are outside the folder flow guards, so no write rule judges them and no breadcrumb is shown for them.

flow cannot guard that work, so it tells the agent to stop. A tool call works in another worktree when:

- **The Edit or Write tool** writes a file inside it.
- **A shell command** runs inside it, because the session's own folder is there or because the command runs `cd` into it.

At the first such call, flow passes the agent a message beside the call's result. The message names the folder flow guards and the worktree it does not guard. It tells the agent to stop its work in the worktree and tell you to start a session there, because flow guards that worktree only from a session started in it.

- **Once per worktree.** flow tells a session once for each worktree it works in.
- **A subagent** that Claude Code starts in its own worktree, with `isolation: "worktree"`, is told the same way, and reports back to the agent that started it.
- **The call goes through.** The message steers the agent and is not a refusal.
- **The worktrees counted** are the ones `git worktree list` lists for the guarded folder.

The commit gate still runs in the worktree, because git runs it from the worktree's own folder, with that worktree's config.

### Why flow tells, rather than follows or refuses

- **Following the work** would judge each call against whichever worktree it changed, with that worktree's config. One command can change files in both folders, and would need two snapshots and two sets of rules. A guard whose folder moves during a session is harder to reason about than one that names its folder.
- **Refusing** works only for the Edit and Write tools. A shell write in the worktree is outside the snapshot, so flow cannot write it back. Refusing one route and not the other would leave the worktree no better guarded.

---

[Index](../index.md) · `revert` and `snapshotInclude`: [the settings](../reference/config.md#settings) · when each rule runs: [the moments](../reference/moments.md) · the model: [how flow works](./how-flow-works.md)
