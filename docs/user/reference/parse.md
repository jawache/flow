---
summary: "how a shell line becomes a list of commands, what each command holds, and everything the parse follows"
---

# The command parse

At the command moment, flow parses the shell line as bash, once, with [unbash](https://github.com/webpro-nl/unbash). The parse is a list of simple commands. Every command guardrail reads that list, and a check of your own reads it as `ctx.commands`.

This page is the boundary of the parse. It states everything that is followed. Nothing else is.

## What a command holds

`ctx.commands` lists every simple command in the line, in the order they appear, including commands nested inside another. Each entry has these fields:

| Field | Is |
| --- | --- |
| `program` | The program that runs, after any `FOO=1` assignment and any wrapper: `sudo`, `env`, `nohup`, `nice`, `time`, `timeout`, `command`, `exec` or `xargs`. It keeps any path it is run by, such as `/usr/bin/gh`. `programName(program)`, from `@jawache/flow`, returns it without the path: `gh` |
| `args` | Its arguments, in order, each as the program receives it, with quotes removed |
| `text` | `program` and `args` joined by single spaces, for a message to show. A check compares `program` and `args`, never this |
| `heredocs` | Each heredoc the command is fed, as `{ body, quoted }`. `quoted` is `true` for a delimiter in quotes or after a backslash, such as `<<'EOF'`, where the shell runs nothing in the body |
| `substitutions` | Each `$( … )` or backtick substitution the shell runs while building this command's arguments and unquoted heredocs, as `{ text, backtick, commands, argument, prefix }`. `commands` lists the commands it runs, nested ones included, as `ctx.commands` lists them. `argument` is the index in `args` of the argument the substitution ends, when only plain text comes before it in that argument. `prefix` is that text: `""` for `-m "$(cat <<'EOF' … EOF)"`, and `--message=` for `--message="$( … )"`. Both are `null` otherwise |
| `redirects` | Each redirect on the command, as `{ operator, target }`, such as `{ operator: ">", target: "notes.md" }`. A redirect on a group or a loop, such as `{ …; } > out.log`, is listed on each command inside it |
| `folder` | The absolute folder the command runs in, or `null` when the line does not settle it. In a case, it is relative to where the line starts |
| `nested` | `true` for a command inside a substitution, a `<( … )`, or a string given to `bash -c`, `sh -c` or `eval`. Also `true` for each line of a heredoc or a here-string a shell reads |

## What is followed

- **Separate commands stay separate.** `git push origin main; ls -f` is two commands, and the `-f` is an argument of `ls`.
- **A quoted argument is one argument.** In `gh issue create --body "ran npx vitest run"`, the words `npx vitest run` are text passed to `gh`.
- **The program is the one that runs.** An assignment such as `FOO=1`, and a wrapper such as `sudo`, `env` or `timeout 5`, is stepped past. `sudo rm -rf build` has the program `rm`.
- **A nested command is in the list.** A command inside `$( … )`, backticks or `<( … )` is a command of its own. So is each command in a string given to `bash -c`, `sh -c` or `eval`.
- **A heredoc or a here-string fed to a shell is commands.** Each line read by `bash`, `sh`, `zsh`, `dash` or `ksh`, such as `bash <<'EOF'`, `cat <<'EOF' | sh` or `bash <<< 'rm -rf build'`, is a nested command.
- **A heredoc belongs to its command.** Each heredoc is attached to the command it feeds, with whether its delimiter is quoted.
- **The folder is followed** through `cd`, `pushd`, `popd` and `git -C`.
- **A variable the line sets is its value.** After `P=/tmp/s`, `sed -i s/a/b/ $P/x.ts` has the argument `/tmp/s/x.ts`. The value is filled in for `program`, `args`, `text` and each redirect's `target`.
- **A command in a `for` loop is one command per value.** `for r in a b; do git -C $r status; done` is two commands, one in the folder `a` and one in `b`. Past 1,000 copies in one line, as nested loops can reach, the loop is listed once, as written.

## What is not followed

- **A variable set anywhere but on the line** stays as written, such as `$TMPDIR/x.ts`.
- **What a script does.** `python3 build.py` and `just release` are each one command. What they run is not in the list.
- **A line that does not parse,** such as one with a quote that never closes, has no parse. `ctx.commands` is `null`.

A shell feature is added to this page only when incidents counted from real sessions call for it.

## A command outside the repo

A command rule judges only commands that run inside the repo, unless it is marked `.everywhere()`.

- **A command is inside** when the folder it runs in is.
- **A folder is inside** when git names this repo for it. So every worktree of this repo is inside.
- **A folder flow cannot tell,** such as after `cd "$(mktemp -d)"`, counts as inside.

So `cd /tmp/r && git init && git commit --no-verify -m init` runs: a rule against `--no-verify` is not passed that commit.

## How a guardrail names a command

A command rule names a command in words, never with a regex over the line. `"git push --force"` is the program `git` and the arguments `push` and `--force`. flow compares them with each command in the parse, one whole argument at a time. [`banCommands`](../checks/ban-commands.md#how-a-command-is-matched) has the matching rules.

A regex is for text: a commit message or a file's contents.

## Worked examples

A rule that names `git push --force`, against four lines:

| The line | Commands in the parse | The rule |
| --- | --- | --- |
| `git push --force origin main` | `git push --force origin main` | refuses |
| `echo "never git push --force"` | `echo` with one argument | passes: the words are text passed to `echo` |
| `bash -c "cd api && git push --force"` | `bash`, then nested `cd api` and `git push --force` in the folder `api` | refuses |
| `R=/tmp/scratch; git -C $R push --force` | `git -C /tmp/scratch push --force`, in the folder `/tmp/scratch` | passes: that folder is outside the repo. Refuses when the rule is `.everywhere()` |

A loop and a substitution in one line:

```
for d in api web; do (cd $d && npm test > "$(git rev-parse --short HEAD).log"); done
```

| Command | `folder` | `nested` | `redirects` |
| --- | --- | --- | --- |
| `cd api` | the repo | `false` | none |
| `npm test` | `api` | `false` | `>` to the substitution, as written |
| `git rev-parse --short HEAD` | `api` | `true` | none |
| `cd web` | the repo | `false` | none |
| `npm test` | `web` | `false` | `>` to the substitution, as written |
| `git rev-parse --short HEAD` | `web` | `true` | none |

---

[Index](../index.md) · what a check is given: [ctx](./ctx.md) · the stock check that names commands: [`banCommands`](../checks/ban-commands.md) · why flow parses: [what flow reads](../explanation/what-flow-reads.md)
