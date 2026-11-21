---
summary: "every part of the report flow facts prints, where each number is read from, what a test run is, and what is sent to Jev"
---

# The facts report

`flow facts` prints what happened in a repo's conversations with a [harness](./glossary.md#harness): what ran, what failed, what flow refused, and what the person typed.

## What it reads

| Source | Where | Holds |
| --- | --- | --- |
| The transcripts | where the harness keeps them ([Claude Code](./claude-code.md), [Codex](./codex.md)), one file per conversation and one per subagent it started | every prompt, every model request, every tool call and its result |
| [The session log](./log.md) | `.flow/log/` in this worktree | every rule that ran, every refusal and every [breadcrumb](./glossary.md#breadcrumb) shown |

`flow facts` reads every conversation that started in this worktree and is not marked read.

`--transcripts <dir>` and `--log <dir>` read copies kept elsewhere, such as the ones a tool saved before it removed the worktree. With transcripts and no log, the report has every part read from the transcripts, and `health` says the log is missing.

## The parts of the report

| Part | What it holds | Read from |
| --- | --- | --- |
| Conversations | How many conversations were read, of how many unread, and how many have a session log | both |
| Recorded | Tool calls, conversations and days in the log. Under 15 conversations and under 30 days, the log is too thin to call a rule dead | log |
| Blocks | How many times a guardrail refused a commit or a command | log |
| Excluded | Sessions in the log with no transcript behind them, which no count includes | both |
| Requests | Model requests, and the largest context in tokens, for the conversation and for each subagent | transcripts |
| Models | The model the conversation and each subagent ran on | transcripts |
| Test runs | For the conversation and for each subagent: how many [test runs](#test-runs) there were, how many failed, and how many model requests fell between a failed run and the next one that passed | transcripts |
| Refusals | For each [guardrail](./glossary.md#guardrail), in the conversation and its subagents: how often it refused, and how often the next command differed from the refused one | transcripts |
| Lead | For each breadcrumb shown: how many tool calls passed before a file it is about changed | log |
| Gap | A folder where files changed and no rule's globs reach. Up to 5 | log |
| Dead, retire, quiet | Rules whose globs never matched, rules that never ran, and rules that last refused over 30 days ago. Printed when the log is not too thin | log |
| Session | Edit calls, Write calls, files a shell command read by name, and commits | transcripts |
| Shell | The files those shell commands read, most read first | transcripts |
| Mode | Tool calls for each permission mode | both |
| Unwatched | A file the conversation read or changed that no rule's globs reach. Up to 5 | transcripts |
| Actors | Each subagent: its type and its description. Up to 5 | transcripts |
| Guard edited | A warning when a guardrail refused and the conversation later changed `flow.config.ts`, a pack file it imports, or the hooks file | both |
| Prompts | Each prompt a person typed, with [its kind and a frustration score](#prompts) | transcripts, Jev |
| Marked | With `--mark`, how many conversations were marked read | transcripts |

A file counts as changed from the log's [`change` rows](./log.md#change), whichever tool changed it.

The printed report has one line for each part. An example of five of them:

```
  requests  286 · largest context 214k
  models    builder opus-5-5 ×2 · coach opus-5-5
  tests     26 runs · 2 failed · 3 requests between a failed run and the next pass
  refused   git.conventionalCommitFormat 2× · the next command differed 2×
  prompts   13 · 1 correction · 1 confusion · 2 frustrated
```

## Test runs

A test run is one shell command that runs a test, a build or a gate. A command is a test run when it runs either of these:

- a recipe of the repo's justfile whose name starts with `test`, `check`, `gate`, `e2e`, `lint`, `typecheck` or `build`;
- a program that one of those recipes runs, such as `vitest`. A shell utility never counts: `cat`, `cd`, `cp`, `echo`, `find`, `grep`, `head`, `ls`, `mkdir`, `mv`, `rm`, `sed`, `sort`, `tail`, `test`, `touch`, `true` or `wc`, nor does `node`.

[`testRuns`](./config.md#settings) in `flow.config.ts` adds recipe names, each matched whole.

A test run failed when the harness marked its result as an error, or when its output ends with a test runner's failure line, such as `Tests  2 failed`, `--- FAIL`, `error TS2304` or ``error: Recipe `test` failed``.

The count of requests between starts at the first failed run and stops at the next run that passes.

## Prompts

A prompt is text a person typed or sent to the conversation. A notice the harness writes, such as a finished background task, is not a prompt.

`flow facts` sends each prompt to Jev, TypeSafe's decision model, with the end of the agent's message before it. No code and no command is sent. Jev returns:

| Field | What it is |
| --- | --- |
| kind | one of `correction`, `confusion`, `new_direction`, `answer`, `go_ahead`, `question` or `other` |
| confidence | 0 to 1, how sure Jev is of the kind |
| frustrated | 0 to 1, how likely the person is annoyed with the agent |

| Kind | The prompt |
| --- | --- |
| `correction` | says the agent did something wrong, misread the request, or asked when it need not have |
| `confusion` | says the person cannot follow what the agent wrote |
| `new_direction` | changes or widens what is wanted |
| `answer` | answers the agent's question |
| `go_ahead` | approves, such as "go" |
| `question` | requests an explanation |
| `other` | is none of these |

## The report as JSON

`--json` prints every part in full.

| Key | What it holds |
| --- | --- |
| `host`, `root` | The harness's name and the repo's folder |
| `selection`, `coverage`, `store` | Which conversations were read, which were left, and where the transcripts are |
| `withoutTranscript` | The Excluded sessions |
| `health` | A warning when there is no log |
| `requests` | For the conversation and each subagent: model requests, largest context and model |
| `testRuns` | Each test run: its command, the transcript line, and whether it failed. Then the totals, for the conversation and each subagent |
| `refusals` | For each guardrail: each refusal's transcript line, and whether the next command differed |
| `prompts` | Each prompt, shortened, with its kind, confidence and frustration score |
| `metrics` | For each guardrail and breadcrumb: its counts from the log. Then the numbers behind Recorded, Lead, Gap, Dead, retire, quiet |
| `narrative` | Every file read or changed, with a count, and the recipes run, by name |
| `uncovered` | The whole Unwatched list |
| `actors` | Every subagent: its type, description and the transcript line that started it |
| `weakened` | The Guard edited warnings |
| `modes` | Calls for each permission mode |
| `marked` | How many conversations were marked read, or `null` without `--mark` |
| `terrain` | Every folder and file of the repo, with how often it was read, how often changed, and which rules reach it |
| `moments` | Every bound rule grouped by the [moment](./glossary.md#moment) it runs at, with its counts |

## The report as a page

`--report <file>` writes one HTML page in the work + flow colours and type. It has the totals of requests, failed test runs, refusals and prompts, one row per conversation with its requests, failed test runs and largest context, the refusals per guardrail, and the prompts by kind.

---

[Index](../index.md) · the command's options: [`flow facts`](./cli.md#flow-facts) · the log it reads: [the session log](./log.md)
