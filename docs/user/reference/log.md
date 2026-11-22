---
summary: "the session log flow writes under .flow/log/, and every field of each kind of row"
---

# The session log

flow writes one log per session of a [harness](./glossary.md#harness), at `.flow/log/<session id>.jsonl`. Each line is one JSON object, called a row. A row records one thing flow saw or did: a tool call, the files a call changed, a rule that ran, a [breadcrumb](./glossary.md#breadcrumb) it showed, a commit or a command it refused.

A session's subagents write to the same file as the session that started them. The `agent` field on each row says which agent the row came from.

## An example

A breadcrumb that a `builder` subagent was shown when it first changed `engine/state.ts`:

```json
{"ts":"2026-10-16T13:32:09.364Z","seq":3,"agent":"a6009b558b4c9155c","agentType":"builder","kind":"breadcrumb","moment":"file-change","id":"house.layout","cause":"first","subject":"engine/state.ts"}
```

## The fields on every row

Every row except `meta` has these fields:

| Field | What it holds |
| --- | --- |
| `ts` | The time flow wrote the row, as an ISO 8601 string in UTC |
| `seq` | The row's position in the file: 1 for the first row after `meta`, then one more for each row. Two rows written in the same millisecond still have different `seq` values |
| `agent` | The agent the row came from. `main` is the session itself. A subagent's rows hold its `agent_id`, the id the harness sends in each hook message from that subagent, such as `a6009b558b4c9155c` |
| `agentType` | The agent type the subagent was started as, such as `builder` or `general-purpose`, from the `agent_type` in the harness's hook message. Only on a subagent's rows, and only when the hook message includes the type |
| `kind` | The kind of row, one of the eight below |

Two subagents of the same type have the same `agentType` and different `agent` values.

### Commit rows

The commit [moment](./glossary.md#moment) runs in git's commit-message hook. No agent calls it. Its rows name the agent whose tool call last ran in the worktree, when that call was in the last 4 hours. They go into that agent's session log. When no call was that recent, the rows go into `.flow/log/commit.jsonl` with `agent` set to `commit`.

## The kinds of row

| Kind | Written |
| --- | --- |
| [`meta`](#meta) | Once, as the first line, when flow creates the file |
| [`run`](#run) | Each time the rules run at a moment |
| [`tool`](#tool) | For each tool call: before a shell command, and after any other call |
| [`read`](#read) | Before a shell command, for each file it reads by name |
| [`change`](#change) | After a tool call that changed files |
| [`guardrail`](#guardrail) | For each commit, command or hand-back a [guardrail](./glossary.md#guardrail) refused |
| [`breadcrumb`](#breadcrumb) | For each breadcrumb flow showed |
| [`compaction`](#compaction) | When the harness compacts the session's context |

### `meta`

The first line of the file. It has no `ts`, `seq`, `agent` or `agentType`.

| Field | What it holds |
| --- | --- |
| `v` | The version of the log's format: `2` |
| `harness` | The harness the session runs under: `claude-code` or `codex` |
| `session` | The session id, as used in the file's name |
| `started` | The time flow created the file, as an ISO 8601 string in UTC |
| `branch` | The branch the worktree had checked out, or `null` |
| `worktree` | The absolute path of the worktree |

### `run`

| Field | What it holds |
| --- | --- |
| `moment` | The [moment](./moments.md) the rules ran at: `session`, `file-change`, `command`, `commit` or `turn-end` |
| `subjects` | How many subjects the rules ran on: the files staged at `commit`, and 1 at every other moment |
| `rules` | One object per guardrail in force at the moment: `id`, `evaluated` (the subjects it ran on), `hits` (the subjects it refused) and `silenced` (1 when its `.for(…)` binds it to another kind of agent, so it did not run) |

### `tool`

| Field | What it holds |
| --- | --- |
| `tool` | The tool's name, such as `Read`, `Edit`, `Bash` or `Grep` |
| `path` | The file the call names in `file_path` or `notebook_path`, relative to the repo |
| `edit` | `true` when the tool changes the file it names, such as `Edit` or `Write`, and `false` when it does not, such as `Read`. Only beside `path` |
| `command` | The command line, for a `Bash` call |
| `pattern` | The search pattern, for a call such as `Grep` or `Glob` |
| `scope` | The `path` the search runs in, relative to the repo, when the call names one |
| `mode` | The permission mode the harness reported for the call, such as `auto` |

### `read`

| Field | What it holds |
| --- | --- |
| `tool` | `Bash` |
| `path` | A file the command reads by name, such as the file in `cat notes.md`, relative to the repo |

### `change`

| Field | What it holds |
| --- | --- |
| `tool` | The tool whose call changed the files |
| `paths` | The files the call changed, relative to the repo, from git's list of changed paths. The row holds no file content |

### `guardrail`

| Field | What it holds |
| --- | --- |
| `moment` | The moment the guardrail ran at |
| `id` | The entry's id, such as `house.noForcePush` |
| `subject` | The file, the commit message or the command line it refused |
| `out` | `deny` |
| `message` | The guardrail's message |
| `detail` | What the check found, when it returned more than its message |
| `output` | Everything the tool printed, stdout and stderr together, when the check ran a tool that failed, such as [`execPasses`](../checks/exec-passes.md) |

### `breadcrumb`

| Field | What it holds |
| --- | --- |
| `moment` | `session`, `file-change`, `command` or `turn-end` |
| `id` | The entry's id, such as `house.layout` |
| `cause` | Why flow showed it: `session` at the start of a session, `first` the first time a matching file changed or a matching command ran, and `drift` when it was shown again after the context grew by `driftTokens` |
| `subject` | The file or the command line that showed it. Only on rows whose `cause` is `first` or `drift` |

### `compaction`

It has no fields beyond the ones on every row. After it, each `session` breadcrumb is shown again at once, and every other breadcrumb the next time its moment happens.

---

[Index](../index.md) · the report built from the log: [the facts report](./facts.md) · when each moment runs: [moments](./moments.md)
