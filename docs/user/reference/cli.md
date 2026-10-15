---
summary: "every `flow` command, what `flow init` writes, the two switch files, and the exit codes"
---

# The flow command

`flow` is one binary. You type `flow init`, `flow status` and `flow test`, and Claude Code and git call `flow hook` for you.

## Commands

| Command | What it does |
| --- | --- |
| `flow init [--empty]` | Writes `flow.config.ts`, `.githooks/pre-commit` and `.flow/`, sets `core.hooksPath`, and registers flow's hooks in the Claude Code settings file. `--empty` writes a config that binds no packs. Run it again at any time: it writes only what is missing, and never writes over `flow.config.ts` or `.githooks/pre-commit` once they exist. It does change two things you may have set yourself, listed under [what `flow init` writes](#what-flow-init-writes) |
| `flow status [--json]` | Lists every bound rule by moment, and checks each fitting: the config, the commit gate, `core.hooksPath`, the hook registrations and the `flow` they run. A fitting that is not in place is a red line with its fix |
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
| `.githooks/pre-commit` | The commit gate: a shell script of comments that puts the repo's `node_modules/.bin` first on the `PATH`, then ends with `exec flow hook commit`. Not written when a file is already at that path |
| `.flow/` | flow's state and logs. It holds its own `.gitignore`, so it is never committed and your `.gitignore` is not changed |
| `node_modules/@jawache/flow` | A link to the `flow` that is running. Written only when the repo does not install `@jawache/flow` itself |
| The Claude Code settings file | Five hook registrations: `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `Stop`. Each one runs the command `PATH="$CLAUDE_PROJECT_DIR/node_modules/.bin:$PATH" flow hook <event>`. The file is the repo's `.claude/settings.json` when the repo's `package.json` lists `@jawache/flow`. Otherwise it is `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set. A registration an older `flow init` wrote, as the bare `flow hook <event>` or on fewer tools, is rewritten in place to this command and matcher. When `flow init` adds or rewrites a registration, it writes the whole file back as JSON indented by two spaces. Every key already in the file is kept |
| `core.hooksPath` | Set to `.githooks`, so git runs the gate. `flow init` sets it whenever it is not already `.githooks`, including when it points somewhere else. It is a setting of one clone, so run `flow init` in every new clone |

> [!WARNING]
> If `core.hooksPath` already points at another folder, such as `.husky/_`, `flow init` replaces it with `.githooks`. Git then stops running the hooks in the old folder. Move those hooks into `.githooks/` before you run `flow init`.

Every hook and the commit gate look for `flow` in the repo's `node_modules/.bin` first, then on the `PATH` that git and Claude Code use. If neither has it, each hook fails with `flow: not found`, every commit is refused, and `flow status` prints a red `binary` line. [How to install flow](../how-to/install-flow.md) gives the two installs that put `flow` there.

## Switches

| File | While it exists |
| --- | --- |
| `.flow/off` | Every rule is off, and nothing is logged. Delete it to turn flow back on |
| `.flow/record` | Each session is recorded, so `flow replay` can run it again |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | passed — nothing was refused, and every fitting is in place |
| `1` | **the report is no** — `flow status` found a fitting missing, `flow test` found a case that fails, or `flow facts`, `flow replay` or `flow init` could not finish, as listed below |
| `2` | **refused** — a rule blocked, or the config would not load, or a top-level verb was misused |

A hook has two codes: 0 lets the action go ahead, and 2 refuses it and shows standard error to the agent.

- **A blocked action** exits 2, from every hook and from the commit gate.
- **A config that does not load** exits 2 from the commit gate only. Every hook exits 0: `pre-tool-use` and `session-start` pass the load error to the agent as a note, and `stop` writes it to standard error and lets the turn end.

These commands exit 1:

- **`flow status`**, when a fitting is missing.
- **`flow test`**, when a case fails.
- **`flow facts`**, when the record cannot be read at all, such as a repo where no session has ever been recorded.
- **`flow replay`**, when the recording did not capture something a check reached for, or when `--against` finds a difference.
- **`flow init`**, when one of its steps fails.

A config that does not load makes `flow status` and `flow test` exit 2.

`e2e/product.test.ts` checks the three codes against the binary: `flow status` and `flow test` for 0 and 1, and for 2 a refusal at the commit gate and at a hook, a config that does not load, and a misused verb.

---

[Index](../index.md) · what `flow.config.ts` holds: [the config](./config.md) · when each rule runs: [moments](./moments.md) · the install choices: [how to install flow](../how-to/install-flow.md)
