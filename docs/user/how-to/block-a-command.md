---
summary: "refuse a shell command before it runs, or point the agent at the command to run instead, with `banCommands`"
---

# How to block or redirect a command

This guide shows you how to refuse a shell command before it runs. Keep these rules for an exact command that cannot be undone, such as a force-push, and for a command your repo has a sanctioned way to run.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

2. Add an entry that runs `banCommands` at `command`, with each command you want refused written out in words:

   ```
   noDbReset: guardrail()
     .at(command)
     .check(banCommands({ ban: ["drizzle-kit drop", "wrangler d1 delete"] }))
     .message("Destructive DB command — this goes through a release script, never by hand.")
     .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
   ```

3. Run `flow test`.

A command rule takes no `.on(…)`. The commands it names are its scope.

## Redirect a command

To send the agent to the sanctioned command, ban the raw one and name the other in the message:

```
fmtThroughTheRecipe: guardrail()
  .at(command)
  .check(banCommands({ ban: ["gofumpt"] }))
  .message("Run `just fmt`: it runs gofumpt with this repo's settings.")
  .test({ pass: ["just fmt"], block: ["gofumpt -w ."] }),
```

## How a command is matched

Write the program first, then only the arguments that make the command dangerous. `"git push --force"` names the program `git` and the arguments `push` and `--force`.

- **The program, without its path.** `/usr/local/bin/drizzle-kit drop` has the program `drizzle-kit`.
- **Every argument you wrote, anywhere.** The command is refused when its arguments include all of yours, in any order. `drizzle-kit --verbose drop` is refused by `"drizzle-kit drop"`.
- **Whole arguments only.** `"npx vitest"` does not refuse `npx vitest-preview`, and a quoted argument such as `'drop the table'` is one argument, not the word `drop`.
- **Short flags letter by letter.** `"rm -rf"` refuses `rm -rf`, `rm -fr` and `rm -r -f`.
- **One command at a time.** flow [parses the line as bash](../reference/parse.md) and matches each command in it on its own. `git push origin main; ls -f` is not a force push, because the `-f` belongs to `ls`.
- **A heredoc's body is left out.** A heredoc passes text to a program on standard input, and that text is not a command. A heredoc fed to a shell, such as `bash <<'EOF'` or `cat <<EOF | sh`, is commands, and each one is matched.

The [`banCommands` reference](../checks/ban-commands.md#how-a-command-is-matched) lists every case.

## Variants

- **If the rule is about a commit message**, judge the message at `commit`, where git has it whole. See [how to check the commit message](./check-the-commit-message.md).
- **If the rule should also judge a command that runs outside the repository**, such as a force-push from any folder, chain `.everywhere()`.
- **If a flag must be told apart from its value**, such as `-n` from a value in `-mn`, write a check of your own over [`ctx.commands`](../reference/ctx.md#ctxcommands) that reads the arguments in order. [How to write your own check](./write-your-own-check.md) gives the steps.
- **If a pattern must span two commands**, such as `curl … | sh`, set `wholeLine: true`. Each entry in `ban` is then a regex, tried against the whole command line.

---

[Index](../index.md) · every option: [`banCommands`](../checks/ban-commands.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
