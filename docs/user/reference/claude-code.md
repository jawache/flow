---
summary: "what flow reads from Claude Code and what it writes: the hooks, the payload fields, how an agent's type is learned, and the transcript"
---

# flow under Claude Code

Claude Code is a harness: it runs the agent and calls flow's hooks. This page lists everything flow reads from it and writes to it.

## The hooks

`flow init` registers six hooks in the repository's `.claude/settings.json`.

| Hook | Matcher | Runs | Delivers |
| --- | --- | --- | --- |
| `SessionStart` | `startup\|resume\|clear\|compact` | `flow hook session-start` | the `session` moment. With the source `compact`, a [compaction](./moments.md#when-a-breadcrumb-is-shown-again) |
| `SubagentStart` | every agent | `flow hook subagent-start` | the `session` moment, for the subagent |
| `PreToolUse` | `Bash` | `flow hook pre-tool-use` | the `command` moment |
| `PostToolUse` | every tool | `flow hook post-tool-use` | the `change` moment |
| `Stop` | none | `flow hook stop` | the `turn-end` moment, for the main session |
| `SubagentStop` | none | `flow hook subagent-stop` | the `turn-end` moment, for a subagent |

Each registration runs this command, with its own event:

```
f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook <event>; exec flow hook <event>
```

flow registers no hook before the Edit and Write tools, and none after a failed call. A change that a failed call made is found after the next call.

## What flow reads from a payload

| Field | Used for |
| --- | --- |
| `session_id` | the session log's file name, and the state kept for each agent |
| `transcript_path` | the transcript, below |
| `cwd` | the folder a shell command starts in |
| `source` | on `SessionStart`: `compact` is a compaction |
| `tool_name`, `tool_input` | the shell line, in `tool_input.command`, and the log's `tool` row |
| `agent_id`, `agent_type` | which agent is acting, and its type |
| `permission_mode` | the log's `tool` row |
| `stop_hook_active` | a hand-back that a hook already held open, which flow lets through |

## What flow writes back

| Answer | How |
| --- | --- |
| Refuse a command | exit code 2, with the guardrail's message on standard error |
| Show a breadcrumb | `additionalContext` in the hook's JSON output |
| Hold a turn open | `decision: "block"` in the hook's JSON output, with the guardrail's message as the reason |

## How an agent's type is learned

- **A subagent** has `agent_id` and `agent_type` in every payload of its calls. `agent_type` is the name it was started as: `builder`, or `plugin:name` for a plugin's agent.
- **The main session** has neither field. Started with `claude --agent <name>`, it has that name as `agent_type`.
- **A generic type,** such as `general-purpose`, says nothing about the job. A category may read the brief the subagent was started with, from the subagent's own transcript. [Categories](./config.md#categories) lists the keys.
- **Claude Code's internal agents** send `SubagentStop` with an empty `agent_type`. flow runs no rule for them.

## The transcript

flow reads the transcript named in the payload, and for a subagent the subagent's own.

- **The context size,** from the last message's input and cache tokens, for `driftTokens`.
- **A generic subagent's brief,** for a category.
- **Prompts and tool calls,** for `flow facts`.

flow writes nothing to a transcript.

---

[Index](../index.md) · the other harness: [flow under Codex](./codex.md) · when each moment runs: [moments](./moments.md) · what `flow init` writes: [the flow command](./cli.md#what-flow-init-writes)
