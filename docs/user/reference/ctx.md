---
summary: "the check contract, every field of `ctx`, and what each moment fills in"
---

# The ctx a check reads

A check is a function of `ctx`, and `ctx` is its only access to the world. What is filled in depends on the moment.

## The check contract

A check is `(ctx) => ctx.ok() | ctx.fail(detail)`.

- **`defineCheck`** takes a function of an options object, and returns the check. The options are an ordinary typed argument, so a wrong value is a compile error.
- **A check may be async.**
- **A check reaches the world only through `ctx`.** It never uses `node:fs`, `child_process` or `process.env`. That is what lets the same check run live, run in a case, and replay from a recording with no repo.
- **`ctx.fail(detail)`** takes a sentence naming what was seen and what to do.
- **A check that throws** is a load-time fault that names the file. It never loads as a rule that has stopped checking.

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
| `ctx.file` | The file this moment is about, `{ path, content, existed }`, at a file moment. See [ctx.file](#ctxfile) |
| `ctx.command` | The shell command line, at the command moment |
| `ctx.staged` | The staged paths, at the commit moment |
| `ctx.turn` | The turn's actions (edits and runs), at turn-end |
| `ctx.actor` | The category names that match the session making this change. Each name comes from evidence the host wrote about that session, never from a claim the session made about itself. The stock `oneWriter` check reads this field |
| `ctx.moment` | Which moment this is, to branch on |
| `ctx.fs` · `ctx.exec` · `ctx.git` | The effects: read a file, run a command, query git. They are the only way a check reaches beyond its facts |
| `ctx.ok()` · `ctx.fail(detail)` | The verdict: a pass, or a block that includes the detail line |

### ctx.file

- **`content` at write** is the would-be bytes when the Edit tool made the change, and the bytes now on disk when a shell command made it. A check reads `content` the same way in both cases.
- **`existed` after a shell command** is `true` if a file was at `path` before the command ran, and `false` if the command created it. The check runs after the command, so `ctx.fs.exists(path)` returns `true` for a file the command created.
- **`existed` at commit** is `true` if the last commit has the file, and `false` if it does not.
- **When `existed` is not set**, use `ctx.fs.exists(path)`. At write, it returns whether the file was there before the change.
- **A file the commit deletes** is passed to a rule bound at both `deletion` and `commit`. `ctx.moment` is `delete`, `content` is the file as the last commit has it, and `existed` is `true`.

Read `existed` when it is set.

## What each moment fills in

| At | The check reads |
| --- | --- |
| `write` · `commit` (a file rule) | `ctx.file` = `{ path, content }`. At commit, the check is called once per staged file, when the rule lists globs with `.on(…)` |
| `command` | `ctx.command`: the line about to run |
| `commit` (no `.on`) | `ctx.staged`: the whole staged set, in one call |
| `commit`, for a deleted file | Only when the rule is bound at both `deletion` and `commit`, and lists globs with `.on(…)`. `ctx.moment` is `delete`, and `ctx.file` = `{ path, content, existed: true }`, where `content` is the file as the last commit has it. It is the same `ctx` the rule is called with when a file is deleted during a session |
| `turn-end` | `ctx.turn`: the edits and runs of the turn |
| any | `ctx.actor`, `ctx.fs`, `ctx.exec`, `ctx.git` and `ctx.moment` |

---

[Index](../index.md) · the steps: [how to write your own check](../how-to/write-your-own-check.md) · when each moment runs: [moments](./moments.md) · cases, the canned `ctx`: [the config](./config.md#cases)
