---
summary: "the check contract, every field of `ctx`, and what each moment fills in"
---

# The ctx a check reads

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
| `ctx.file` | The file this moment is about, `{ path, content, existed }`, at a file moment. See [ctx.file](#ctxfile) |
| `ctx.command` | The shell command line, at the command moment |
| `ctx.commands` | The command line parsed as bash, at the command moment: one entry per simple command, or `null` when the line does not parse. See [ctx.commands](#ctxcommands) |
| `ctx.staged` | The staged paths, at the commit moment, in every call that moment makes. Under `flow hook commit --all`, every file git lists |
| `ctx.turn` | The turn's actions (edits and runs), at turn-end. For a subagent, they are that subagent's own actions |
| `ctx.actor` | The category names that match the session making this change. Each name comes from evidence the host wrote about that session, never from a claim the session made about itself. The stock `oneWriter` check reads this field |
| `ctx.moment` | Which moment this is, to branch on |
| `ctx.fs` · `ctx.exec` · `ctx.git` | The effects: read a file, run a command, query git. They are the only way a check reaches beyond its facts |
| `ctx.ok()` · `ctx.fail(detail)` | The verdict: a pass, or a block that includes the detail line |

### ctx.file

- **`content` at write** is the would-be bytes when the Edit tool made the change, and the bytes now on disk when a shell command made it. A check reads `content` the same way in both cases.
- **`existed` after a shell command** is `true` if a file was at `path` before the command ran, and `false` if the command created it. The check runs after the command, so `ctx.fs.exists(path)` returns `true` for a file the command created.
- **`existed` at commit** is `true` if the last commit has the file, and `false` if it does not.
- **`unchanged`** is `true` on a file identical to the one in the last commit. Only `flow hook commit --all` passes such a file to a rule. On every other file, and at every other moment, `unchanged` is not set.
- **When `existed` is not set**, use `ctx.fs.exists(path)`. At write, it returns whether the file was there before the change.
- **A file the commit deletes** is passed to a rule bound at both `deletion` and `commit`, with paths in `.on(…)`. `ctx.moment` is `delete`, `content` is the file as the last commit has it, and `existed` is `true`.
- **At an in-session delete**, `ctx.file` is `{ path, content }`, with no `existed`. `content` is the file before it was removed.

Read `existed` when it is set.

### ctx.commands

`ctx.commands` lists every simple command in the line, in the order they appear, including commands nested inside another. [The parse](../explanation/what-the-guard-sees.md#the-parse-what-a-command-is) explains how the line is read. Each entry has these fields:

| Field | Is |
| --- | --- |
| `program` | The program that runs, after any `FOO=1` assignment and any wrapper: `sudo`, `env`, `nohup`, `nice`, `time`, `timeout`, `command`, `exec` or `xargs`. It keeps any path it is run by, such as `/usr/bin/gh`. `programName(program)`, from `@jawache/flow`, returns it without the path: `gh` |
| `args` | Its arguments, in order, each as the program receives it, with quotes removed |
| `text` | `program` and `args` joined by single spaces, for a message to show. A check compares `program` and `args`, never this |
| `heredocs` | Each heredoc the command is fed, as `{ body, quoted }`. `quoted` is `true` for a delimiter in quotes or after a backslash, such as `<<'EOF'`, where the shell runs nothing in the body |
| `substitutions` | Each `$( … )` or backtick substitution the shell runs while building this command's arguments and unquoted heredocs, as `{ text, backtick, commands, argument, prefix }`. `commands` lists the commands it runs, nested ones included, as `ctx.commands` lists them. `argument` is the index in `args` of the argument the substitution ends, when only plain text comes before it in that argument. `prefix` is that text: `""` for `-m "$(cat <<'EOF' … EOF)"`, and `--message=` for `--message="$( … )"`. Both are `null` otherwise |
| `redirects` | Each redirect on the command, as `{ operator, target }`, such as `{ operator: ">", target: "notes.md" }`. A redirect on a group or a loop, such as `{ …; } > out.log`, is listed on each command inside it |
| `nested` | `true` for a command inside a substitution, a `<( … )`, or a string given to `bash -c`, `sh -c` or `eval`. Also `true` for each line of a heredoc a shell reads, such as `bash <<'EOF'` or `cat <<'EOF' \| sh`, and of a here-string a shell reads, such as `bash <<< 'ls'` |

`ctx.commands` is `null` when the line does not parse, for example when a quote never closes. A check reads `null` as "cannot tell", and the stock checks then pass, except `banCommands`, which refuses the line when the program and every argument it names appear in it as whole words.

This check compares each program without its path, with `programName`, so `/usr/bin/gh` counts as `gh`:

```
const noBareGh = defineCheck((_opts: Record<string, never>) => (ctx) => {
  const bare = (ctx.commands ?? []).find((c) => programName(c.program) === "gh");
  return bare === undefined ? ctx.ok() : ctx.fail(`\`${bare.text}\` runs gh directly — run it as \`work gh …\``);
});
```

## What each moment fills in

| At | The check reads |
| --- | --- |
| `write` | `ctx.file` = `{ path, content }`, plus `existed` when a shell command made the change |
| `delete` | `ctx.file` = `{ path, content }`, where `content` is the file before it was removed |
| `commit` (a file rule) | When the rule lists globs with `.on(…)`, the check is called once per staged file in scope that is on disk. `ctx.file` = `{ path, content, existed }`, and `ctx.staged` is the whole staged set |
| `command` | `ctx.command`: the line about to run, and `ctx.commands`: that line parsed |
| `commit` (no `.on`) | `ctx.staged`: the whole staged set, in one call |
| `commit`, for a deleted file | Only when the rule is bound at both `deletion` and `commit`, and lists globs with `.on(…)`. `ctx.moment` is `delete`, and `ctx.file` = `{ path, content, existed: true }`, where `content` is the file as the last commit has it. `ctx.staged` is the whole staged set |
| `turn-end` | `ctx.turn`: the edits and runs of the turn |
| any | `ctx.actor`, `ctx.fs`, `ctx.exec`, `ctx.git` and `ctx.moment` |

---

[Index](../index.md) · the steps: [how to write your own check](../how-to/write-your-own-check.md) · when each moment runs: [moments](./moments.md) · cases, the canned `ctx`: [the config](./config.md#cases)
