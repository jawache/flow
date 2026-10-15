# How to block a command

docs/user/how-to · refuse a shell command before it runs, with `banCommands` · 2026-10-15

This guide shows you how to refuse a dangerous shell command before it runs.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

2. Add an entry that runs `banCommands` at `command`, with one regex per command you want refused:

   ```
   noDbReset: guardrail()
     .at(command)
     .check(banCommands({ ban: ["drizzle-kit\\s+drop", "wrangler\\s+d1\\s+delete"] }))
     .message("Destructive DB command — this goes through a release script, never by hand.")
     .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
   ```

3. Run `flow test`.

A command rule takes no `.on(…)`. The patterns are its scope.

## What the patterns are matched against

- **The whole command line** is one input, however many lines it has. A pattern can match across a newline.
- **A heredoc's body is left out.** A heredoc passes text to a program on standard input, and that text is not part of the command line. So a script that only contains the words of a banned command is not refused.
- **A heredoc fed to a shell is matched.** When the program reading the heredoc is `bash`, `sh`, `zsh` or `eval`, the body is a list of commands, and the patterns are matched against it too.

## Variants

- **If the rule must read what a command is fed**, such as the text of a commit message, set `matchHeredocs: true` in the `banCommands` options.

---

[Index](../index.md) · every option: [`banCommands`](../checks/ban-commands.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
