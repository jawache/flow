---
summary: "reads: command line · fires at: command"
---

# `banCommands`

Bans a shell command before it runs. You name each banned command in plain words, such as `"git push --force"`: a program and the arguments that make it dangerous. flow parses the command line as bash, and refuses a command whose program is the banned program and whose arguments include every banned argument. A command rule takes no `.on(…)`, because its commands are its scope. A rule whose commands appear nowhere in a repo is not misconfigured.

## How a command is matched

Each entry in `ban` is parsed the same way as the command line: the first word is the program, and the words after it are its arguments. A command matches the entry when both of these hold:

- **The program is the same.** The program's path is ignored on both sides, so `/usr/local/bin/work plan tick` has the program `work`.
- **Every argument of the entry is among the command's arguments.** Order and position do not matter, and other arguments may come before, between and after them. So `"work plan tick"` matches `work plan tick F7.B1` and `work --verbose plan A B tick`.

Each argument is compared whole:

- **A word is one argument.** `"work task"` does not match `work task-list`, and `"npx vitest"` does not match `npx vitest-preview`.
- **A quoted argument is one argument.** `"work plan tick"` does not match `work plan decision 'we tick later'`, because `we tick later` is one argument, not the word `tick`.
- **A bundle of short flags counts letter by letter.** An argument of one `-` and letters, such as `-rf`, is the flags `-r` and `-f`, on both sides. So `"rm -rf"` matches `rm -rf build`, `rm -fr build` and `rm -r -f build`. A long flag such as `--force` is one argument.

An entry with no arguments, such as `"curl"`, matches every command that runs that program.

## Which commands are matched

- **One command at a time.** `git push origin main; ls -f` is two commands: `git push origin main` and `ls -f`. `"git push -f"` matches neither, because the `-f` is an argument of `ls`.
- **The program that runs, not the words around it.** `echo 'npx vitest run'` and `gh issue create --body "ran npx vitest run"` are not refused by `"npx vitest"`. Their programs are `echo` and `gh`, and the words are an argument.
- **Past a wrapper.** A variable assignment such as `FOO=1` in front of the program is skipped. So are `sudo`, `env`, `nohup`, `nice`, `time`, `timeout`, `command`, `exec` and `xargs`, with their own options and arguments. `sudo rm -rf build` and `timeout 5 rm -rf build` both have the program `rm`.
- **Nested commands.** A command inside `$( … )`, backticks or `<( … )` is a command of its own, and is matched. So is each command in the string given to `bash -c`, `sh -c` or `eval`.
- **Not inside a heredoc.** A heredoc is the lines after a `<<WORD` opener, up to the line that holds only `WORD`, fed to a program on its standard input. Those lines are not commands. So a script fed to `python3`, or a file written with `cat`, is not refused when it includes the words of a banned command.
- **A heredoc fed to a shell.** The lines of a heredoc read by `bash`, `sh`, `zsh`, `dash` or `ksh` are commands. So are the lines of a heredoc piped into one of them or into `eval`, as in `cat <<'EOF' | sh`. Each one is matched.
- **A here-string fed to a shell.** The text of a `<<<` here-string read by `bash`, `sh`, `zsh`, `dash` or `ksh`, such as `bash <<< 'rm -rf build'`, is commands. Each one is matched.
- **A line that does not parse.** A line flow cannot parse, such as one with an unclosed quote, is refused when the entry's program and every one of its arguments appear in the line as whole words.

A flag that takes a value attached to it, such as `-mfix`, counts letter by letter like any bundle: `-m`, `-f`, `-i`, `-x`. A rule that must tell a flag from its value, as the `git` pack's rules do, is a check of its own that reads [`ctx.commands`](../reference/ctx.md#ctxcommands). [How to write your own check](../how-to/write-your-own-check.md) gives the steps.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of strings | yes | each banned command, in words: a program, then the arguments that make it dangerous. Matched as described above. Under `wholeLine`, each entry is a regex instead |
| `wholeLine` | boolean | no | set `true` to try each entry as a regex against the whole command line as written, less its heredoc bodies. A pattern then matches anywhere in the line. Use it for a pattern that spans two commands on purpose, such as `curl … \| sh` |

## Example

```
noDbReset: guardrail()
  .at(command)
  .check(banCommands({ ban: ["drizzle-kit drop", "wrangler d1 delete"] }))
  .message("Destructive DB command — this goes through a release script, never by hand.")
  .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
