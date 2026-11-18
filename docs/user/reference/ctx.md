---
summary: "the check contract, every field of `ctx`, and what each moment fills in"
---

# What a check is given

A check is a function of `ctx`, and `ctx` is its only access to the world. What is filled in depends on the moment.

## The check contract

A check is `(ctx) => ctx.ok() | ctx.fail(detail)`.

- **`defineCheck(factory)`** takes a factory, `(options) => check`, and returns a function of the same shape: called with options, it returns the check. The options are an ordinary typed argument, so a wrong value is a compile error.
- **A check may be async.**
- **A check reaches the world only through `ctx`.** It never uses `node:fs`, `child_process` or `process.env`. That is what lets the same check run live, run in a case, and replay from a recording with no repo.
- **`ctx.fail(detail)`** takes a sentence naming what was seen and what to do.
- **A check that throws while it runs** blocks, with the detail `the check threw: <message>`, and the refusal names the entry. In `flow test`, the case fails. A throw while `flow.config.ts` is being imported is a load fault that names `flow.config.ts`.

```
const frontmatterComplete = defineCheck((_opts: Record<string, never>) => (ctx) => {
  const { content } = ctx.file ?? { content: "" };
  return content.startsWith("---") ? ctx.ok() : ctx.fail("missing frontmatter block");
});
```

A check declares no moments, no schema and no `kind`. The entry's `.at(…)` sets when it runs, and the check reads whatever that moment fills in. [How to write your own check](../how-to/write-your-own-check.md) gives the steps.

## The fields

| Field | Is |
| --- | --- |
| `ctx.file` | The staged file this call is about, `{ path, content, existed, unchanged }`, at the commit moment, in a rule with `.on(…)`. See [ctx.file](#ctxfile) |
| `ctx.staged` | The paths the commit adds or changes, at the commit moment, in every call that moment makes. Under `flow hook commit --all`, every file git lists |
| `ctx.deleted` | The paths the commit deletes, as a list of strings, at the commit moment, in every call that moment makes |
| `ctx.message` | The commit message as git records it, at the commit moment, in every call that moment makes. `null` under `flow hook commit --all`, which has no commit |
| `ctx.command` | The shell command line, at the command moment |
| `ctx.commands` | The command line parsed as bash, at the command moment: one entry per simple command, or `null` when the line does not parse. Every field of an entry is on [the command parse](./parse.md#what-a-command-holds) |
| `ctx.added` | The staged paths the last commit does not have, at the commit moment, in every call that moment makes |
| `ctx.turn` | The turn's actions, at turn-end: each file a call changed, and each shell command run. For a subagent, they are that subagent's own actions |
| `ctx.actor` | The category names that match the agent making this change. Each name comes from evidence the harness wrote about that agent, never from a claim the agent made about itself |
| `ctx.moment` | Which moment this is, to branch on |
| `ctx.fs` · `ctx.exec` · `ctx.git` | The effects: read a file, run a command, query git. They are the only way a check reaches beyond its facts |
| `ctx.ok()` · `ctx.fail(detail)` | The verdict: a pass, or a block that includes the detail line |

### ctx.file

- **`content`** is the file as staged.
- **`existed`** is `true` if the last commit has the file, and `false` if it does not.
- **`unchanged`** is `true` on a file identical to the one in the last commit. Only `flow hook commit --all` passes such a file to a rule. On every other file, `unchanged` is not set.

### ctx.commands

`ctx.commands` lists every simple command in the line, in the order they appear, including commands nested inside another. A rule without `.everywhere()` is passed only those [inside the repo](./parse.md#a-command-outside-the-repo).

`ctx.commands` is `null` when the line does not parse, for example when a quote never closes. A check reads `null` as "cannot tell", and the stock checks then pass, except `banCommands`, which refuses the line when the program and every argument it names appear in it as whole words.

This check compares each program without its path, with `programName`, so `/usr/bin/gh` counts as `gh`:

```
const noBareGh = defineCheck((_opts: Record<string, never>) => (ctx) => {
  const bare = (ctx.commands ?? []).find((c) => programName(c.program) === "gh");
  return bare === undefined ? ctx.ok() : ctx.fail(`\`${bare.text}\` runs gh directly — run it as \`just gh …\``);
});
```

## What each moment fills in

| At | The check reads |
| --- | --- |
| `commit` (with `.on`) | The check is called once per staged file in scope that the commit adds or changes. `ctx.file` = `{ path, content, existed }`, with `ctx.staged`, `ctx.deleted` and `ctx.message` for the whole commit. Under `flow hook commit --all`, `ctx.file` also has `unchanged: true` when the file is identical to the one in the last commit. |
| `commit` (no `.on`) | `ctx.staged`, `ctx.deleted` and `ctx.message`: the whole commit, in one call |
| `command` | `ctx.command`: the line about to run, and `ctx.commands`: that line parsed |
| `turn-end` | `ctx.turn`: the changed files and the commands of the turn |
| any | `ctx.actor`, `ctx.fs`, `ctx.exec`, `ctx.git` and `ctx.moment` |

Which commits are judged is on [the commit moment](./moments.md#the-commit-moment).

---

[Index](../index.md) · the steps: [how to write your own check](../how-to/write-your-own-check.md) · when each moment runs: [moments](./moments.md) · cases, the canned `ctx`: [the config](./config.md#cases)
