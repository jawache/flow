---
summary: "reads: command line · fires at: command"
---

# `substitutionInProse`

Refuses a command that records prose, such as a commit message or a pull request body, when the shell would run a backtick in it. Inside double quotes or an unquoted heredoc, `` `just test` `` is not Markdown: the shell runs `just test` and puts its output into the text before the command starts. The `git` and `work` packs bind this check for the commands they own.

## What is refused

The check reads [the parse](../explanation/what-the-guard-sees.md#the-parse-what-a-command-is) of the command line, one command at a time.

- **A command named by a head.** Each head is a command in words, such as `"gh pr"`, matched the way [`banCommands`](./ban-commands.md#how-a-command-is-matched) matches an entry: the same program, and every argument of the head among the command's arguments.
- **A git command named by its subcommand.** A git command is matched by the subcommand the parse finds after git's own options, so `git -C '/a b' commit` and `git --git-dir /x commit` are both `commit`.
- **Any other command** is never refused.
- **A backtick the shell runs.** The command is refused when one of its [substitutions](../reference/ctx.md#ctxcommands) is a backtick. That covers a backtick in a double-quoted or bare argument, and in an unquoted heredoc the command is fed.
- **Through a `$( … )`.** A `$( … )` alone is not refused. A backtick that runs inside it is: `git commit -m "$(cat <<EOF … EOF)"` with a backtick in the heredoc is refused.
- **A line that does not parse** is passed.

These run nothing, so they pass:

- **A single-quoted argument:** `` git commit -m 'run `just test`' ``.
- **An escaped backtick** inside double quotes: `` --body "run \`just test\`" ``.
- **A quoted heredoc**, such as `git commit -F - <<'EOF'`, including one inside `$( … )`.
- **A backtick in another command** on the same line, such as `` gh issue view 1; echo `date` ``.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `heads` | list of strings | yes | the commands that record prose, each in words: a program, then the arguments that make it record prose. Each is matched against each command in the line, as `banCommands` matches an entry. A head that is not one command in words, such as a regex, refuses to load |
| `gitSubcommands` | list of strings | no | the git subcommands that record prose, such as `commit`. A git command whose subcommand is in the list is checked, whatever options come before the subcommand |

## Example

```
noBacktickInNotes: guardrail()
  .at(command)
  .check(substitutionInProse({ heads: ["notes add"] }))
  .message(SUBSTITUTION_MESSAGE)
  .test({ pass: ["notes add 'run `just test`'"], block: ['notes add "run `just test`"'] }),
```

`SUBSTITUTION_MESSAGE` is the message the `git` and `work` packs give with this check. It is exported from `@jawache/flow` beside it.

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
