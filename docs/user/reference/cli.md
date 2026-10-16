---
summary: "every `flow` command, what `flow init` writes and `flow uninstall` removes, the two switch files, and the exit codes"
---

# The flow command

`flow` is one binary. You type `flow init`, `flow status`, `flow test` and `flow uninstall`, and Claude Code and git call `flow hook` for you.

## Commands

| Command | What it does |
| --- | --- |
| `flow init [--empty]` | Writes `flow.config.ts`, `.githooks/pre-commit` and `.flow/`, sets `core.hooksPath`, and registers flow's hooks in the Claude Code settings file. `--empty` writes a config that binds no packs. Run it again at any time: it writes only what is missing, and never writes over `flow.config.ts` or `.githooks/pre-commit` once they exist. It does change one thing you may have set yourself, the hook registrations, listed under [what `flow init` writes](#what-flow-init-writes). When git already runs other hooks, it leaves them alone and prints that flow is not installed, as described under [when git already runs other hooks](#when-git-already-runs-other-hooks) |
| `flow uninstall [--machine]` | Removes what `flow init` wrote in this repo, except `flow.config.ts`. `--machine` also removes flow's hooks from the machine-wide Claude Code settings file. Prints each thing it removed, then the `npm uninstall` command to run next. Each removal is listed under [what `flow uninstall` removes](#what-flow-uninstall-removes). The flow pack refuses it when an agent runs it |
| `flow status [--json]` | Lists every bound rule by moment, and checks each fitting: the config, the commit gate, that git runs the commit gate, the hook registrations and the `flow` they run. A fitting that is not in place is a red line with its fix |
| `flow test [config]` | Runs every bound rule's `.test()` cases. The default config is `flow.config.ts` |
| `flow facts [options]` | Reports what the log in `.flow/` and the Claude Code transcripts record about this repo. The options are listed under [`flow facts`](#flow-facts) |
| `flow replay <file> [config] [--against <log>]` | Runs a recorded session through the rules again, with no repo and no Claude Code. `config` is the config to judge it with, `flow.config.ts` by default. `--against` compares the result with a log |
| `flow hook <event>` | Called by the Claude Code hook registrations, with the hook's payload on standard input. You do not type it. An event flow does not know exits 0 and does nothing |
| `flow hook commit [--all]` | Called by `.githooks/pre-commit`. Runs every `commit` rule over the staged changes, which flow reads from git. `--all` runs them over every file git lists, tracked or untracked, as if all of them were staged |
| `flow --version` | Prints the version |

`flow commit` is the name `.githooks/pre-commit` used before 0.2.2. It runs the same gate as `flow hook commit`, and ignores any file list it is given.

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

## What `flow init` writes

| Path | What it is |
| --- | --- |
| `flow.config.ts` | The config: the `flow` pack, which protects the guard itself, and a demo pack you can read in one screen. With `--empty`, a config that binds nothing |
| `.githooks/pre-commit` | The commit gate: a shell script of comments that runs the repo's own `node_modules/@jawache/flow/dist/flow.mjs` with `node` when that file is there, then ends with `exec flow hook commit`. Not written when a file is already at that path |
| `.flow/` | flow's state and logs. It holds its own `.gitignore`, so it is never committed and your `.gitignore` is not changed. Each session's log is `.flow/log/<session id>.jsonl`, described in [the session log](./log.md) |
| `node_modules/@jawache/flow` | A link to the `flow` that is running. Written only when the repo does not install `@jawache/flow` itself |
| The Claude Code settings file | Six hook registrations: `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop` and `SubagentStop`. Each one runs the command `f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook <event>; exec flow hook <event>`. The file is the repo's `.claude/settings.json` when the repo's `package.json` lists `@jawache/flow`. Otherwise it is `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set. A registration an older `flow init` wrote, as the bare `flow hook <event>` or on fewer tools, is rewritten in place to this command and matcher. When the hooks go in the repo's file, a bare `flow hook <event>` in the machine-wide file is rewritten to the same command too, and nothing else in that file changes. When `flow init` adds or rewrites a registration, it writes the whole file back as JSON indented by two spaces. Every key already in the file is kept |
| `core.hooksPath` | Set to `.githooks`, so git runs the gate. `flow init` sets it only when it is unset and `.git/hooks` holds no hooks. It is a setting of one clone, so run `flow init` in every new clone |

Every hook and the commit gate run the repo's own `@jawache/flow` package first, then the `flow` on the `PATH` that git and Claude Code use. They never run a `flow` in the repo's `node_modules/.bin`, because any package can install one there. If neither has it, each hook fails with `flow: not found`, every commit is refused, and `flow status` prints a red `binary` line. [How to install flow](../how-to/install-flow.md) gives the two installs that put `flow` there.

### When git already runs other hooks

Git runs hooks from one folder. `flow init` leaves that folder alone when git already runs other hooks from it, and flow is then not installed.

Git already runs other hooks when either of these is true:

- **`core.hooksPath` points at another folder**, such as husky's `.husky/_`.
- **`.git/hooks` holds a hook**: any file there whose name does not end in `.sample`. Git LFS and lefthook install their hooks there.

In that case, `flow init` writes every other file in the table above, does not set `core.hooksPath`, and exits 1. Its output ends with a block that starts `FLOW IS NOT INSTALLED`. The block names the folder git runs hooks from and gives two ways to finish:

- **Add flow's two lines to the end of the `pre-commit` hook git runs.** For husky, that file is `.husky/pre-commit`.
- **Move those hooks into `.githooks/`**, then run `git config core.hooksPath .githooks`.

Git runs a `pre-commit` hook only when the file is executable. The first way changes with the state of that hook:

- **The hook is not there:** the block says to create it with `#!/bin/sh` and flow's two lines, then to run `chmod +x` on it.
- **The hook calls flow but is not executable:** git skips it, so flow is not installed. The block says to run `chmod +x` on it.
- **The hook does not call flow and is not executable:** the block says to add flow's two lines to the end of it, then to run `chmod +x` on it.
- **Husky's `.husky/pre-commit`:** it does not need to be executable, because husky's hook in `.husky/_` runs it with `sh`, and the block never says to create it.

In a terminal, the block is printed in bold red, unless the `NO_COLOR` environment variable is set. `flow status` prints the same message as a red line.

Once the `pre-commit` hook git runs calls flow, and is executable when git runs it itself, `flow init` and `flow status` count flow as installed. For husky, flow reads `.husky/pre-commit`.

## What `flow uninstall` removes

| Path | What happens to it |
| --- | --- |
| `.githooks/pre-commit` | Deleted when it holds only comments and the lines `flow init` writes. Otherwise the lines that run flow are removed, and the rest of the script is kept |
| `core.hooksPath` | Unset when it is `.githooks` and the folder holds no other hook. `.githooks/` is then deleted if it is empty. When the folder holds another hook, `core.hooksPath` stays `.githooks` |
| `.flow/` | Deleted, with its logs, recordings and switch files |
| `node_modules/@jawache/flow` | Deleted when it is a link, which `flow init` writes when the repo does not install `@jawache/flow` itself |
| The repo's `.claude/settings.json` | When the repo's `package.json` lists `@jawache/flow`: each hook entry whose command ends with `flow hook <event>` is removed, for the six events `flow init` registers. An event left with no entry is removed. Every other key in the file is kept |
| The machine-wide settings file | With `--machine` only: the same entries are removed from `~/.claude/settings.json`, or from `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set |

`flow uninstall` leaves `flow.config.ts` and the packs it imports. Run `flow init` to wire the repo again.

> [!WARNING]
> Every repo on the machine reads the machine-wide settings file. After `flow uninstall --machine`, flow's hooks run in no repo that relies on a global install, and an agent there is no longer guarded.

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

- **A blocked action** exits 2, from every hook and from the commit gate.
- **A config that does not load** exits 2 from the commit gate only. Every hook exits 0: `pre-tool-use` and `session-start` pass the load error to the agent as a note, and `stop` and `subagent-stop` write it to standard error and let the turn end.

These commands exit 1:

- **`flow status`**, when a fitting is missing.
- **`flow test`**, when a case fails.
- **`flow facts`**, when the record cannot be read at all, such as a repo where no session has ever been recorded.
- **`flow replay`**, when the recording did not capture something a check reached for, or when `--against` finds a difference.
- **`flow init`**, when one of its steps fails.
- **`flow init`**, when git already runs other hooks and the `pre-commit` hook git runs does not call flow, or is not executable, as described under [when git already runs other hooks](#when-git-already-runs-other-hooks).
- **`flow uninstall`**, when one of its steps fails. It still carries out the other steps, and lists the one that failed.

A config that does not load makes `flow status` and `flow test` exit 2.

`e2e/product.test.ts` checks the three codes against the binary: `flow status` and `flow test` for 0 and 1, and for 2 a refusal at the commit gate and at a hook, a config that does not load, and a misused verb.

---

[Index](../index.md) · what `flow.config.ts` holds: [the config](./config.md) · when each rule runs: [moments](./moments.md) · the install choices: [how to install flow](../how-to/install-flow.md)
