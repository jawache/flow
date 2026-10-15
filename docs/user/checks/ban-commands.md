---
summary: "reads: command line · fires at: command"
---

# `banCommands`

Bans a shell command before it runs. The patterns are tried against the whole command line. One command is one subject however many lines it occupies, so a pattern may match across a newline: an agent writing `git commit` with a message body sends one command over several lines. A heredoc is the lines after a `<<WORD` opener, up to the line that holds only `WORD`, fed to a program on its standard input. Those lines are not matched, so a script fed to `python3`, or a file written with `cat`, is not refused even when it includes the words of a banned command. The rest of the opener's own line is matched: in `cat <<EOF > out.txt && drizzle-kit drop`, the `drizzle-kit drop` part is matched. A `<<<` here-string is matched too. The exception is a heredoc fed to a shell (`bash`, `sh`, `zsh`, `dash`, `ksh` or `eval`, or a pipeline into one of them), whose lines are commands and are matched. A rule that has to see heredoc text sets `matchHeredocs: true`, and its patterns are then tried against the whole command, heredocs included. A command rule takes no `.on(…)`, because its patterns are its scope. A rule whose patterns match nothing in a repo is not misconfigured.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of regex | yes | each pattern is tried against the whole command line. Text a heredoc feeds to a program is left out of that line, unless the program is `bash`, `sh`, `zsh`, `dash`, `ksh` or `eval`, or a pipeline the heredoc feeds into one of them, where the text is itself commands. Any pattern that matches refuses the command |
| `matchHeredocs` | boolean | no | set `true` to match the text of every heredoc as well. A rule about what a command is fed — a commit message given on standard input — needs it; without it that text is left out, as above |

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
