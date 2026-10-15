---
summary: "allow a change only when the commit message explains it, with `commitReason`"
---

# How to require a reason in the commit message

This guide shows you how to let a change through only when its commit message gives a reason for it, such as adding a dependency. The reason then sits in the git history, where the next reviewer reads it.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `commitReason` to the import.

2. Add an entry that runs `commitReason` at `command`. `whenChanged` lists the files that need a reason. `token` is the word that must start a line of its own in the message, followed by a colon, as in `new-dep: zod — checked ajv`. The match ignores case:

   ```
   newDependency: guardrail()
     .at(command)
     .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
     .message("Adding a dependency is fine; adding it silently is not — put `new-dep: <name> — <why>` in the message.")
     .test({
       // the case records the git answers the check reaches for — the staged, added and untracked sets
       pass: [{ command: "git commit -m 'feat: x\n\nnew-dep: zod — checked ajv'", world: { exec: {
         "git diff HEAD --name-only": { stdout: "package.json" },
         "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
         "git ls-files --others --exclude-standard": { stdout: "" },
       } } }],
       block: [{ command: 'git commit -m "feat: x"', world: { exec: {
         "git diff HEAD --name-only": { stdout: "package.json" },
         "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
         "git ls-files --others --exclude-standard": { stdout: "" },
       } } }],
     }),
   ```

3. Run `flow test`.

The rule runs at `command`, not at `commit`. Git runs the pre-commit gate before the commit message exists, so the typed `git commit` command is the only place the message can be read.

> [!NOTE]
> This rule checks only commits an agent types as a command. A commit written in an editor, or made by a person in a terminal, never reaches the `command` moment.

---

[Index](../index.md) · every option: [`commitReason`](../checks/commit-reason.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
