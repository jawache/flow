---
summary: "every `flow` command, what `flow init` writes and `flow uninstall` removes, what `flow status` reports, the two switch files, and the exit codes"
---

# The flow command

`flow` is one binary. You type `flow init`, `flow status`, `flow test` and `flow uninstall`, and the harness and git call `flow hook` for you.

## Commands

| Command | What it does |
| --- | --- |
| `flow init [--empty] [--harness <names>]` | Prompts for the harnesses to register, then writes `flow.config.ts`, the git hook and `.flow/`, sets `core.hooksPath`, and registers flow's hooks for each harness you chose, inside the repo. See [what `flow init` prompts for](#what-flow-init-prompts-for). `--empty` writes a config that binds no pack. Run it again at any time: it writes only what is missing, and never writes over `flow.config.ts` or `.githooks/commit-msg` once they exist. It does change one thing you may have set yourself, the hook registrations, listed under [what `flow init` writes](#what-flow-init-writes). When git already runs other hooks, it leaves them alone and prints that flow is not installed, as described under [when git already runs other hooks](#when-git-already-runs-other-hooks) |
| `flow uninstall [--machine]` | Removes what `flow init` wrote in this repo, except `flow.config.ts`. `--machine` also removes the hooks that flow 0.3 wrote to the machine-wide Claude Code settings file. Prints each thing it removed, then the `npm uninstall` command to run next. Each removal is listed under [what `flow uninstall` removes](#what-flow-uninstall-removes). The `flow` pack refuses it when an agent runs it |
| `flow status [--json]` | Lists every bound rule by moment, and checks each fitting. A fitting that is not in place is a red line with its fix. See [what `flow status` reports](#what-flow-status-reports) |
| `flow test [config]` | Runs every bound rule's `.test()` cases. The default config is `flow.config.ts` |
| `flow facts [options]` | Reports what the log in `.flow/` and the harness's transcripts record about this repo. The options are listed under [`flow facts`](#flow-facts) |
| `flow replay <file> [config] [--against <log>]` | Runs a recorded session through the rules again, with no repo and no harness. `config` is the config to judge it with, `flow.config.ts` by default. `--against` compares the result with a log |
| `flow hook <event>` | Called by a harness's hook registrations, with the hook's payload on standard input. You do not type it. An event flow does not know exits 0 and does nothing |
| `flow hook commit [<file>] [--all]` | Called by `.githooks/commit-msg`, with the file git holds the message in. Runs every `commit` rule over the staged changes, which flow reads from git, and the message. `--all` runs them over every file git lists, tracked or untracked, as if all of them were staged. Under `--all`, a file identical to the one in the last commit is checked for its content, never as an edit |
| `flow --version` | Prints the version |

`flow commit` is the name the git hook used before 0.2.2. It runs the same gate as `flow hook commit`, and ignores any file list it is given.

### `flow facts`

| Option | What it does |
| --- | --- |
| `--json` | Prints the whole report as JSON |
| `--session <id>` | Reads exactly this conversation |
| `--branch <name>` | Reads only the conversations recorded on this branch |
| `--limit <n>` | Reads only the first `n` conversations in order. The rest are read next time |
| `--all` | Ignores `--limit` |
| `--largest` | Orders the conversations by size, largest first |
| `--since <date>` | Reads only conversations from this date on |
| `--mark` | Marks what was read, so the next run starts after it |

The report's corrections are prompts a person typed that read as pushback, such as "no, revert that". A notice that the harness writes when a background task finishes is not a prompt.

The report counts a file as changed from the log's [`change` rows](./log.md#change), whichever tool changed it.

## What `flow init` prompts for

In a terminal, `flow init` is interactive.

1. **It detects the harnesses.** A harness is detected by its folder in the repo, `.claude/` or `.codex/`, or by its program on the `PATH`, `claude` or `codex`.
2. **It prompts for the harnesses to register,** with each detected harness already selected:

   ```
   Which harnesses run agents in this repo?
     [x] Claude Code   detected: .claude/
     [ ] Codex         not found
   ```

3. **It prints each warning that applies,** before it writes anything:

   | Warning | When |
   | --- | --- |
   | git already runs other hooks | as described under [when git already runs other hooks](#when-git-already-runs-other-hooks) |
   | flow is not a dev dependency of this repo | `package.json` is missing, or does not list `@jawache/flow`. The hooks then run whatever `flow` is on the `PATH` |
   | flow's hooks are also in the machine-wide settings file | flow 0.3 wrote them. Each hook would run twice. The warning gives the command that removes them |
   | Codex runs no hook until you trust the folder and approve the hooks | Codex is chosen. See [the two trust gates](./codex.md#the-two-trust-gates) |

4. **It lists the files it is about to write, and prompts for a yes.**

When `flow init` is not run in a terminal, as when an agent or a script runs it, it prompts for nothing. It registers the detected harnesses, or both when it detects none, prints the warnings, and writes.

`--harness` names the harnesses and skips the prompt: `--harness claude-code`, `--harness codex` or `--harness claude-code,codex`.

## What `flow init` writes

| Path | What it is |
| --- | --- |
| `flow.config.ts` | The config. It binds one pack, [`flow`](#the-flow-pack), which protects the guard itself. With `--empty`, a config that binds nothing |
| `.githooks/commit-msg` | Git's commit-message hook: a shell script that runs the repo's own `node_modules/@jawache/flow/dist/flow.mjs` with `node` when that file is there, then ends with `exec flow hook commit "$1"`. Not written when a file is already at that path. A `.githooks/pre-commit` that an older `flow init` wrote is deleted when it holds only flow's lines, and otherwise loses them |
| `.flow/` | flow's state and logs. It holds its own `.gitignore`, so it is never committed and your `.gitignore` is not changed. Each session's log is `.flow/log/<session id>.jsonl`, described in [the session log](./log.md) |
| `node_modules/@jawache/flow` | A link to the `flow` that is running. Written only when the repo does not install `@jawache/flow` itself |
| `.claude/settings.json` | Claude Code's hook registrations, listed on [flow under Claude Code](./claude-code.md#the-hooks). Written when Claude Code is chosen |
| `.codex/hooks.json` | Codex's hook registrations, listed on [flow under Codex](./codex.md#the-hooks). Written when Codex is chosen |
| `core.hooksPath` | Set to `.githooks`, so git runs the hook. `flow init` sets it only when it is unset and `.git/hooks` holds no hooks. It is a setting of one clone, so run `flow init` in every new clone |

`flow init` writes every registration inside the repo, whatever the repo is. It writes nothing to a machine-wide file.

- **A registration an older `flow init` wrote in the repo's file** is rewritten in place to the 0.4 command and matcher. One for an event flow no longer uses is removed.
- **When `flow init` adds or rewrites a registration,** it writes the whole file back as JSON indented by two spaces. Every key already in the file is kept.

Every hook runs the repo's own `@jawache/flow` package first, then the `flow` on the `PATH` that git and the harness use. They never run a `flow` in the repo's `node_modules/.bin`, because any package can install one there. If neither has it, each hook fails with `flow: not found`, every commit is refused, and `flow status` prints a red `binary` line. [How to install and pin flow](../how-to/install-flow.md) puts `flow` there.

### The `flow` pack

flow ships one pack, behind `@jawache/flow/packs`. It has three entries:

| Entry | Kind | Moment | What it does |
| --- | --- | --- | --- |
| `flow.orientation` | breadcrumb | `session` | Tells the agent the repo is guarded, and that turning a guardrail off is a change to `flow.config.ts` |
| `flow.noUninstall` | guardrail | `command` | Refuses `flow uninstall`, in any folder |
| `flow.noDeleteGuardrails` | guardrail | `commit` | Refuses a commit that deletes `flow.config.ts`, `.githooks/commit-msg`, `.claude/settings.json` or `.codex/hooks.json` |

To protect your own pack files too, add a rule of your own with [`protectedPath`](../checks/protected-path.md).

### When git already runs other hooks

Git runs hooks from one folder. `flow init` leaves that folder alone when git already runs other hooks from it, and flow is then not installed.

Git already runs other hooks when either of these is true:

- **`core.hooksPath` points at another folder**, such as husky's `.husky/_`.
- **`.git/hooks` holds a hook**: any file there whose name does not end in `.sample`. Git LFS and lefthook install their hooks there.

In that case, `flow init` writes every other file in the table above, does not set `core.hooksPath`, and exits 1. Its output ends with a block that starts `FLOW IS NOT INSTALLED`. The block names the folder git runs hooks from and gives two ways to finish:

- **Add flow's two lines to the end of the `commit-msg` hook git runs.** For husky, that file is `.husky/commit-msg`.
- **Move those hooks into `.githooks/`**, then run `git config core.hooksPath .githooks`.

Git runs a `commit-msg` hook only when the file is executable. The first way changes with the state of that hook:

- **The hook is not there:** the block says to create it with `#!/bin/sh` and flow's two lines, then to run `chmod +x` on it.
- **The hook calls flow but is not executable:** git skips it, so flow is not installed. The block says to run `chmod +x` on it.
- **The hook does not call flow and is not executable:** the block says to add flow's two lines to the end of it, then to run `chmod +x` on it.
- **Husky's `.husky/commit-msg`:** it does not need to be executable, because husky's hook in `.husky/_` runs it with `sh`.

In a terminal, the block is printed in bold red, unless the `NO_COLOR` environment variable is set. `flow status` prints the same message as a red line.

Once the `commit-msg` hook git runs calls flow, and is executable when git runs it itself, `flow init` and `flow status` count flow as installed. For husky, flow reads `.husky/commit-msg`.

## What `flow uninstall` removes

| Path | What happens to it |
| --- | --- |
| `.githooks/commit-msg` | Deleted when it holds only comments and the lines `flow init` writes. Otherwise the lines that run flow are removed, and the rest of the script is kept |
| A hook git runs from another folder | Left as it is. When it still calls flow, such as `.husky/commit-msg` holding flow's two lines, the report names the file and the lines to delete by hand, and says to delete them before `npm uninstall` |
| `core.hooksPath` | Unset when it is `.githooks` and the folder holds no other hook. `.githooks/` is then deleted if it is empty. When the folder holds another hook, `core.hooksPath` stays `.githooks` |
| `.flow/` | Deleted, with its logs, recordings and switch files |
| `node_modules/@jawache/flow` | Deleted when it is a link, which `flow init` writes when the repo does not install `@jawache/flow` itself |
| `.claude/settings.json` and `.codex/hooks.json` | Each hook entry whose command ends with `flow hook <event>` is removed. An event left with no entry is removed. Every other key in the file is kept |
| The machine-wide Claude Code settings file | With `--machine` only: the entries flow 0.3 wrote are removed from `~/.claude/settings.json`, or from `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set |

`flow uninstall` leaves `flow.config.ts` and the packs it imports. Run `flow init` to wire the repo again.

## What `flow status` reports

`flow status` lists every bound rule by moment, then one line per fitting:

| Fitting | Green when |
| --- | --- |
| `config` | `flow.config.ts` loads |
| `git hook` | git runs the `commit-msg` hook, and it calls flow |
| `binary` | the `flow` the hooks run is found |
| one line per registered harness | the harness's hooks are registered in the repo. The line also says when one of its hooks last ran here, from the session log |

For Codex with no hook run, the line names the two trust gates as the likely reason:

```
  ✓ codex: registered · no hook has run here
        Codex runs a project's hooks only in a trusted folder, and each hook only once approved in /hooks
```

`--json` prints the same report as JSON. Each entry has its id, kind, moments, text or message, description and globs.

## Switches

| File | While it exists |
| --- | --- |
| `.flow/off` | Every rule is off, and nothing is logged. Delete it to turn flow back on |
| `.flow/record` | Each session is recorded, so `flow replay` can run it again |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | passed — nothing was refused, and every fitting is in place |
| `1` | **the report is no** — `flow status` found a fitting missing, `flow test` found a case that fails, or `flow facts`, `flow replay`, `flow init` or `flow uninstall` could not finish, as listed below |
| `2` | **refused** — a rule blocked, or the config would not load, or a top-level verb was misused |

A hook has two codes: 0 lets the action go ahead, and 2 refuses it and shows standard error to the agent.

- **A blocked action** exits 2, from every hook of a harness and from the git hook, with the message on standard error.
- **A config that does not load** exits 2 from the git hook only. Every hook of a harness exits 0: `pre-tool-use`, `post-tool-use`, `session-start` and `subagent-start` pass the load error to the agent as added text, and `stop` and `subagent-stop` write it to standard error and let the turn end.

These commands exit 1:

- **`flow status`**, when a fitting is missing.
- **`flow test`**, when a case fails.
- **`flow facts`**, when the record cannot be read at all, such as a repo where no session has ever been recorded.
- **`flow replay`**, when the recording did not capture something a check reached for, or when `--against` finds a difference.
- **`flow init`**, when one of its steps fails.
- **`flow init`**, when git already runs other hooks and the `commit-msg` hook git runs does not call flow, or is not executable, as described under [when git already runs other hooks](#when-git-already-runs-other-hooks).
- **`flow uninstall`**, when one of its steps fails. It still carries out the other steps, and lists the one that failed.

A config that does not load makes `flow status` and `flow test` exit 2.

`e2e/product.test.ts` checks the three codes against the binary: `flow status` and `flow test` for 0 and 1, and for 2 a refusal at a git hook and at a harness's hook, a config that does not load, and a misused verb.

---

[Index](../index.md) · what `flow.config.ts` holds: [the config](./config.md) · when each rule runs: [moments](./moments.md) · the install: [how to install and pin flow](../how-to/install-flow.md)
