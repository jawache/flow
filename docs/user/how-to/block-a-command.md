---
summary: "refuse a shell command before it runs, with `banCommands`"
---

# How to block a command

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

- **One command at a time.** flow parses the line as bash and tries each pattern against each command in it. A program in one command never pairs with an argument of the next, so `git push origin main; ls -f` is not a force push.
- **From the program name.** A pattern matches at the start of a command, after any `FOO=1`, `sudo` or `env` in front of it. So a banned command named inside another command's quoted argument is not refused.
- **A heredoc's body is left out.** A heredoc passes text to a program on standard input, and that text is not part of the command. So a script that only contains the words of a banned command is not refused.
- **A heredoc fed to a shell is matched.** When the heredoc is read by `bash`, `sh`, `zsh`, `dash` or `ksh`, the body is a list of commands, and each one is matched. This includes a heredoc piped into one of them or into `eval`, as in `cat <<EOF | sh`.

The [`banCommands` reference](../checks/ban-commands.md#what-a-pattern-is-matched-against) lists every case.

## Variants

- **If the rule must read what a command is fed**, such as the text of a commit message, set `matchHeredocs: true` in the `banCommands` options.
- **If a pattern must span two commands**, such as `curl … | sh`, set `wholeLine: true`. Its patterns are then tried against the whole command line.

---

[Index](../index.md) · every option: [`banCommands`](../checks/ban-commands.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
