---
summary: "reads: command line · fires at: command"
---

# `banCommands`

Bans a shell command before it runs. flow parses the command line as bash and splits it into simple commands, each one program and its arguments. Each pattern is tried against each command on its own, from the command's program name. A command rule takes no `.on(…)`, because its patterns are its scope. A rule whose patterns match nothing in a repo is not misconfigured.

## What a pattern is matched against

- **One command at a time.** `git push origin main; ls -f` is two commands: `git push origin main` and `ls -f`. A pattern for a force push matches neither, because the `-f` is an argument of `ls`.
- **From the program name.** A pattern matches only at the start of a command. The pattern `npx vitest run` refuses `npx vitest run --watch` and `cd app && npx vitest run`. It does not refuse `echo 'npx vitest run'`, or `gh issue create --body "ran npx vitest run"`, where the words are an argument.
- **With quotes removed.** Each argument is matched as the program receives it: `git commit -m "fix: x"` is matched as `git commit -m fix: x`. A quoted argument keeps its newlines, so a pattern can match across the lines of a commit message.
- **Past a wrapper.** A variable assignment such as `FOO=1` in front of the program is skipped. So are `sudo`, `env`, `nohup`, `nice`, `time`, `timeout`, `command`, `exec` and `xargs`, with their own options and arguments. `sudo rm -rf build` and `timeout 5 rm -rf build` are both matched as `rm -rf build`.
- **Nested commands.** A command inside `$( … )`, backticks or `<( … )` is a command of its own, and is matched. So is each command in the string given to `bash -c`, `sh -c` or `eval`.
- **Not inside a heredoc.** A heredoc is the lines after a `<<WORD` opener, up to the line that holds only `WORD`, fed to a program on its standard input. Those lines are not matched. So a script fed to `python3`, or a file written with `cat`, is not refused when it includes the words of a banned command.
- **A heredoc fed to a shell.** The lines of a heredoc read by `bash`, `sh`, `zsh`, `dash` or `ksh` are commands. So are the lines of a heredoc piped into one of them or into `eval`, as in `cat <<'EOF' | sh`. Each one is matched.
- **A here-string fed to a shell.** The text of a `<<<` here-string read by `bash`, `sh`, `zsh`, `dash` or `ksh`, such as `bash <<< 'rm -rf build'`, is commands. Each one is matched.
- **A here-string.** The text of a `<<<` here-string is the last argument of its command, and is matched.
- **A line that does not parse.** A line flow cannot parse, such as one with an unclosed quote, is matched whole, as written.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of regex | yes | each pattern is tried against each command in the line, from its program name, as described above. Any pattern that matches refuses the command |
| `matchHeredocs` | boolean | no | set `true` to match each command together with the text of its own heredocs, added after its arguments. A rule about what a command is fed, such as a commit message given with `git commit -F - <<'EOF'`, needs it |
| `wholeLine` | boolean | no | set `true` to try each pattern against the whole command line as written, less its heredoc bodies. A pattern then matches anywhere in the line. Use it for a pattern that spans two commands on purpose, such as `curl … \| sh` |

## Example

```
noDbReset: guardrail()
  .at(command)
  .check(banCommands({ ban: ["drizzle-kit\\s+drop", "wrangler\\s+d1\\s+delete"] }))
  .message("Destructive DB command — this goes through a release script, never by hand.")
  .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
