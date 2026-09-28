# `banCommands`

reads: command line · fires at: command · 2026-09-28

Bans a shell command before it runs. The patterns are tried against the whole command line. One command is one subject however many lines it occupies, so a pattern may match across a newline: an agent writing `git commit` with a message body sends one command over several lines. A heredoc is the text after `<<` on the command line, fed to a program on its standard input. That text is not matched, so a script fed to `python3`, or a file written with `cat`, is not refused even when it includes the words of a banned command. The exception is a heredoc fed to a shell (`bash`, `sh`, `zsh`, `eval`), whose text is commands and is matched. A command rule takes no `.on(…)`, because its patterns are its scope. A rule whose patterns match nothing in a repo is not misconfigured.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of regex | yes | each pattern is tried against the whole command line. Text a heredoc feeds to a program is left out of that line, unless the program is a shell such as `bash`, `sh`, `zsh` or `eval`, where the text is itself commands. Any pattern that matches refuses the command |

## Example

```
noDbReset: guardrail()
  .at(command)
  .check(banCommands({ ban: ["drizzle-kit\\s+drop", "wrangler\\s+d1\\s+delete"] }))
  .message("Destructive DB command — this goes through a release script, never by hand.")
  .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
