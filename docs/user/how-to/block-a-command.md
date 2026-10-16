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

## How a command is matched

Write the program first, then only the arguments that make the command dangerous. `"git push --force"` names the program `git` and the arguments `push` and `--force`.

- **The program, without its path.** `/usr/local/bin/drizzle-kit drop` has the program `drizzle-kit`.
- **Every argument you wrote, anywhere.** The command is refused when its arguments include all of yours, in any order. `drizzle-kit --verbose drop` is refused by `"drizzle-kit drop"`.
- **Whole arguments only.** `"npx vitest"` does not refuse `npx vitest-preview`, and a quoted argument such as `'drop the table'` is one argument, not the word `drop`.
- **Short flags letter by letter.** `"rm -rf"` refuses `rm -rf`, `rm -fr` and `rm -r -f`.
- **One command at a time.** flow parses the line as bash and matches each command in it on its own. `git push origin main; ls -f` is not a force push, because the `-f` belongs to `ls`.
- **A heredoc's body is left out.** A heredoc passes text to a program on standard input, and that text is not a command. A heredoc fed to a shell, such as `bash <<'EOF'` or `cat <<EOF | sh`, is commands, and each one is matched.

The [`banCommands` reference](../checks/ban-commands.md#how-a-command-is-matched) lists every case.

## Variants

- **If the rule is about the text a command is given**, such as a commit message, write a check of your own over [`ctx.commands`](../reference/ctx.md#ctxcommands). Each command there has its `program`, its `args` and its `heredocs`. This check refuses a `git commit` whose message says `WIP`:

  ```ts
  import { command, defineCheck, definePack, guardrail, programName } from "@jawache/flow";

  const noWipCommit = defineCheck((_opts: Record<string, never>) => (ctx) => {
    const wip = (ctx.commands ?? []).find(
      (c) => programName(c.program) === "git" && c.args.includes("commit") && c.args.some((a) => /\bWIP\b/.test(a)),
    );
    return wip === undefined ? ctx.ok() : ctx.fail(`\`${wip.text}\` commits a WIP message`);
  });
  ```

  [How to write your own check](./write-your-own-check.md) gives the rest of the steps.
- **If a flag must be told apart from its value**, such as `-n` from the message in `-mn`, write a check of your own over `ctx.commands` that reads the arguments in order.
- **If a pattern must span two commands**, such as `curl … | sh`, set `wholeLine: true`. Each entry in `ban` is then a regex, tried against the whole command line.

---

[Index](../index.md) · every option: [`banCommands`](../checks/ban-commands.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
