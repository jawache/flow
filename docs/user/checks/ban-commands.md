# `banCommands`

reads: command line · fires at: command · 2026-09-28

Bans a shell command before it runs. The whole command line is the subject — a command is one subject however many lines it occupies, so a pattern may span a newline (which is exactly how an agent batches a `git commit` with a body). The body a heredoc carries is not part of the line: a script fed on stdin that merely mentions a banned command is not a use of it, and is never matched. The patterns *are* the scope, so a command rule takes no `.on(…)`, and matching nothing in a repo is the rule working, not watching the wrong place.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of regex | yes | each is tried against the whole command line, heredoc bodies elided; any match blocks |

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
