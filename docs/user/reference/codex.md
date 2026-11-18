---
summary: "what flow reads from Codex and what it writes: the hooks, the payload fields, the two trust gates, how an agent's type is learned, and the transcript"
---

# flow under Codex

Codex is a harness: it runs the agent and calls flow's hooks. The same `flow.config.ts` guards a repository under Codex and under Claude Code, with no rule rewritten. This page lists everything flow reads from Codex and writes to it.

## The hooks

When Codex is chosen, `flow init` registers six hooks in the repository's `.codex/hooks.json`.

| Hook | Matcher | Runs | Delivers |
| --- | --- | --- | --- |
| `SessionStart` | every source | `flow hook session-start` | the `session` moment. With the source `compact`, a [compaction](./moments.md#when-a-breadcrumb-is-shown-again) |
| `SubagentStart` | every agent | `flow hook subagent-start` | the `session` moment, for the subagent |
| `PreToolUse` | `Bash` | `flow hook pre-tool-use` | the `command` moment |
| `PostToolUse` | every tool | `flow hook post-tool-use` | the `file-change` moment |
| `Stop` | none | `flow hook stop` | the `turn-end` moment, for the main session |
| `SubagentStop` | none | `flow hook subagent-stop` | the `turn-end` moment, for a subagent |

Each registration runs this command, with its own event. It finds the repository with git, from the folder Codex runs the hook in:

```
f="$(git rev-parse --show-toplevel)/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook <event>; exec flow hook <event>
```

## The two trust gates

Codex runs a project's hooks only when both of these are true. When either is not, no hook runs, and nothing in the session says so.

1. **The folder is trusted.** In a folder Codex does not trust, `.codex/hooks.json` is not read.
2. **Each hook is approved.** You approve a project's hooks in Codex with `/hooks`. Codex ties the approval to the hook's definition, so a hook that `flow init` rewrites must be approved again.

`flow init` warns of these two steps when Codex is chosen. `flow status` says when a Codex hook last ran in the repository, and names the two gates when none has: see [what `flow status` reports](./cli.md#what-flow-status-reports).

## What flow reads from a payload

| Field | Used for |
| --- | --- |
| `session_id` | the session log's file name, and the state kept for each agent. For a subagent it is the parent session's id |
| `transcript_path` | the transcript, below. It may be `null` |
| `cwd` | the folder a shell command starts in |
| `source` | on `SessionStart`: `compact` is a compaction |
| `tool_name`, `tool_input` | the shell line, in `tool_input.command`, and the log's `tool` row. Codex names its shell tool `Bash` |
| `agent_id`, `agent_type` | which agent is acting, and its type |
| `permission_mode` | the log's `tool` row |
| `stop_hook_active` | a hand-back that a hook already held open, which flow lets through |

## What flow writes back

| Answer | How |
| --- | --- |
| Refuse a command | exit code 2, with the guardrail's message on standard error |
| Show a breadcrumb | `additionalContext` in the hook's JSON output. Codex keeps about 2,500 tokens of it, and replaces a longer one with a preview |
| Hold a turn open | `decision: "block"` in the hook's JSON output, with the guardrail's message as the reason |

## How an agent's type is learned

- **A subagent** has `agent_id` and `agent_type` in the payloads of its calls. `agent_type` is `default`, `worker` or `explorer`, or the `name` of an agent defined in `.codex/agents/`.
- **The main session** has neither field.

## The transcript

Codex names the session's transcript in each payload: `~/.codex/sessions/<year>/<month>/<day>/rollout-<start time>-<id>.jsonl`.

- **The context size** is read from its `token_count` rows, for `driftTokens`. With no transcript, a breadcrumb is not shown again as the context grows.
- **Prompts and tool calls** are read for `flow facts`.

flow writes nothing to a transcript.

## What differs from Claude Code

- **Every write goes through the shell.** A Codex agent writes files with shell commands. flow judges content at `commit`, so this changes nothing a rule refuses.
- **The two trust gates,** above.
- **The conversation id is Codex's own.** The tool that starts a Codex session cannot choose it.

---

[Index](../index.md) · the other harness: [flow under Claude Code](./claude-code.md) · when each moment runs: [moments](./moments.md) · what `flow init` writes: [the flow command](./cli.md#what-flow-init-writes)
