---
summary: "the session log flow writes under .flow/log/, and every field of each kind of row"
---

# The session log

flow writes one log per Claude Code session, at `.flow/log/<session id>.jsonl`. Each line is one JSON object, called a row. A row records one thing flow saw or did: a tool call, a file a call changed, a rule that ran, a note it showed, a change it refused.

A session's subagents write to the same file as the session that started them. The `agent` field on each row says which agent the row came from.

## An example

A `first-touch` breadcrumb that a `builder` subagent was shown when it first read `engine/state.ts`:

```json
{"ts":"2026-10-16T13:32:09.364Z","seq":3,"agent":"a6009b558b4c9155c","agentType":"builder","kind":"breadcrumb","moment":"touch","id":"house.layout","cause":"first-touch","subject":"engine/state.ts"}
```

## The fields on every row

Every row except `meta` has these fields:

| Field | What it holds |
| --- | --- |
| `ts` | The time flow wrote the row, as an ISO 8601 string in UTC |
| `seq` | The row's position in the file: 1 for the first row after `meta`, then one more for each row. Two rows written in the same millisecond still have different `seq` values |
| `agent` | The agent the row came from. `main` is the session itself. A subagent's rows hold its `agent_id`, the id Claude Code sends in each hook message from that subagent, such as `a6009b558b4c9155c` |
| `agentType` | The agent type the subagent was started as, such as `builder` or `general-purpose`, from the `agent_type` in Claude Code's hook message. Only on a subagent's rows, and only when the hook message includes the type |
| `kind` | The kind of row, one of the nine below |

Two subagents of the same type have the same `agentType` and different `agent` values.

### Commit rows

The commit gate runs in git's pre-commit hook. No agent calls it. Its rows name the agent whose tool call last ran in the worktree, when that call was in the last 4 hours, and go into that agent's session log. When no call was that recent, the rows go into `.flow/log/commit.jsonl` with `agent` set to `commit`.

## The kinds of row

| Kind | Written |
| --- | --- |
| [`meta`](#meta) | Once, as the first line, when flow creates the file |
| [`run`](#run) | Each time the rules run at a moment |
| [`tool`](#tool) | Before each tool call |
| [`read`](#read) | Before a shell command, for each file it reads by name |
| [`write`](#write) | After a tool call, for each file it changed that its `tool` row does not name |
| [`guardrail`](#guardrail) | For each change or command a guardrail refused |
| [`breadcrumb`](#breadcrumb) | For each note flow showed |
| [`compaction`](#compaction) | When Claude Code compacts the session's context |
| [`mismatch`](#mismatch) | When Claude Code's list of the files a command changed differs from flow's |

### `meta`

The first line of the file. It has no `ts`, `seq`, `agent` or `agentType`.

| Field | What it holds |
| --- | --- |
| `v` | The version of the log's format: `1` |
| `session` | The session id, as used in the file's name |
| `started` | The time flow created the file, as an ISO 8601 string in UTC |
| `branch` | The branch the worktree had checked out, or `null` |
| `worktree` | The absolute path of the worktree |

### `run`

| Field | What it holds |
| --- | --- |
| `moment` | The [moment](./moments.md) the rules ran at: `session`, `touch`, `write`, `command`, `delete`, `commit` or `turn-end` |
| `subjects` | How many subjects the rules ran on: the files staged at `commit`, and 1 at every other moment |
| `rules` | One object per guardrail in force at the moment: `id`, `evaluated` (the subjects it ran on), `hits` (the subjects it refused) and `silenced` (1 when its `.for(…)` binds it to another kind of agent, so it did not run) |

### `tool`

| Field | What it holds |
| --- | --- |
| `tool` | The tool's name, such as `Read`, `Edit`, `Bash` or `Grep` |
| `path` | The file the call names in `file_path` or `notebook_path`, relative to the repo |
| `edit` | `true` when the tool changes the file it names, such as `Edit` or `Write`. Only beside `path` |
| `command` | The command line, for a `Bash` call |
| `pattern` | The search pattern, for a call such as `Grep` or `Glob` |
| `scope` | The `path` the search runs in, relative to the repo, when the call names one |
| `mode` | The permission mode Claude Code reported for the call, such as `auto` |

### `read`

| Field | What it holds |
| --- | --- |
| `tool` | `Bash` |
| `path` | A file the command reads by name, such as the file in `cat notes.md`, relative to the repo |

### `write`

| Field | What it holds |
| --- | --- |
| `tool` | The tool whose call changed the file |
| `path` | The file, relative to the repo |
| `change` | `created`, `modified` or `deleted` |

### `guardrail`

| Field | What it holds |
| --- | --- |
| `moment` | The moment the guardrail ran at |
| `id` | The entry's id, such as `git.noForcePush` |
| `subject` | The file or the command line it refused |
| `out` | `deny` |
| `message` | The guardrail's message |
| `detail` | What the check found, when it returned more than its message |

### `breadcrumb`

| Field | What it holds |
| --- | --- |
| `moment` | `session`, `touch` or `command` |
| `id` | The entry's id, such as `house.layout` |
| `cause` | Why flow showed it: `session` at the start of a session, `first-touch` the first time a matching file or command was read or run, and `drift` when it was shown again after the context grew by `driftTokens` |
| `subject` | The file or the command line that showed it. Only on rows whose `cause` is `first-touch` or `drift` |

### `compaction`

It has no fields beyond the ones on every row. After it, each breadcrumb except a `session` one shows again at its next touch.

### `mismatch`

| Field | What it holds |
| --- | --- |
| `tool` | The tool whose call Claude Code reported on |
| `hostOnly` | Files Claude Code listed as changed that flow's diff does not hold |
| `flowOnly` | Files flow's diff holds that Claude Code did not list |
