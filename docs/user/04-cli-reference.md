# Command reference

docs/user · the `flow` command · 2026-10-07

Every `flow` command, what `flow init` writes, the two switch files, and the exit codes.

## Commands

| Command | What it does |
| --- | --- |
| `flow init [--empty]` | Writes `flow.config.ts`, `.githooks/pre-commit` and `.flow/`, sets `core.hooksPath`, and registers flow's hooks in the Claude Code settings file. `--empty` writes a config that binds no packs. Run it again at any time: it adds only what is missing, and never writes over a file that exists |
| `flow status [--json]` | Lists every bound rule by moment, and checks each fitting: the config, the commit gate, `core.hooksPath` and the hook registrations. A fitting that is not in place is a red line with its fix |
| `flow test [config]` | Runs every bound rule's `.test()` cases. The default config is `flow.config.ts` |
| `flow facts [--json]` | Reports what the log in `.flow/` and the Claude Code transcripts record about this repo |
| `flow replay <file> [--against <log>]` | Runs a recorded session through the rules again, with no repo and no Claude Code. `--against` compares the result with a log |
| `flow hook <event>` | Called by the Claude Code hook registrations, with the hook's payload on standard input. You do not type it |
| `flow hook commit [--all]` | Called by `.githooks/pre-commit`. Runs every `commit` rule over the staged changes, which flow reads from git. `--all` runs them over every file git lists, tracked or untracked, as if all of them were staged |
| `flow --version` | Prints the version |

`flow commit` is the name `.githooks/pre-commit` used before 0.2.2. It runs the same gate as `flow hook commit`, and ignores any file list it is given.

## What `flow init` writes

| Path | What it is |
| --- | --- |
| `flow.config.ts` | The config: the `flow` pack, which protects the guard itself, and a demo pack you can read in one screen. With `--empty`, a config that binds nothing |
| `.githooks/pre-commit` | The commit gate, one line: `exec flow hook commit`. Not written when a hook is already there |
| `.flow/` | flow's state and logs. It holds its own `.gitignore`, so it is never committed and your `.gitignore` is not changed |
| `node_modules/@jawache/flow` | A link to the `flow` that is running. Written only when the repo does not install `@jawache/flow` itself |
| The Claude Code settings file | Five hook registrations: `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `Stop`. The file is `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set |
| `core.hooksPath` | Set to `.githooks`, so git runs the gate. It is a setting of one clone, so run `flow init` in every new clone |

## Switches

| File | While it exists |
| --- | --- |
| `.flow/off` | Every rule is off, and nothing is logged. Delete it to turn flow back on |
| `.flow/record` | Each session is recorded, so `flow replay` can run it again |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | passed — nothing was refused, and every fitting is in place |
| `1` | **the report is no** — `flow status` found a fitting missing, or `flow test` found a case that fails |
| `2` | **refused** — a rule blocked, or the config would not load, or a verb was misused |

A hook has two codes: 0 lets the action go ahead, and 2 refuses it and shows standard error to the agent. So a blocked action and a config that does not load both exit 2, from every hook and from the commit gate.

Only `flow status` and `flow test` exit 1, because they report rather than refuse. A config that does not load makes both of them exit 2.

`e2e/product.test.ts` runs every row of this table against the binary.
