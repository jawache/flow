# How to let only some agents write

docs/user/how-to · refuse a file change from any actor outside a list, with `oneWriter` · 2026-10-15

This guide shows you how to let only some agents change files when several agents share one worktree. For example, a builder changes files and a checker only reports.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `deletion` and `oneWriter` to the import.

2. Add an entry that runs `oneWriter` at `write` and `deletion`. `writers` lists the categories allowed to create, change or delete a file:

   ```
   builderWrites: guardrail()
     .at(write, deletion)
     .check(oneWriter({ writers: ["builder", "parent"] }))
     .message("Only the builder changes files in this worktree — hand your finding back instead of fixing it.")
     .test({
       pass:  [{ path: "src/x.ts", content: "", actor: ["builder"] }],
       block: [{ path: "src/x.ts", content: "", actor: ["checker"] }],
     }),
   ```

3. Run `flow test`.

A category is a name for an actor. flow matches it from evidence the harness wrote about the session. In a test case, `actor: ["builder"]` gives the canned session its categories.

## What happens when the rule refuses

Every actor outside `writers` is refused.

- **Through the Edit tool**, the write is refused before it lands.
- **Through a shell command**, the file is written back to its previous content after the command.

[What the guard sees](../explanation/what-the-guard-sees.md) explains both routes. [Rules bound to who](../explanation/rules-bound-to-who.md) explains categories.

---

[Index](../index.md) · every option: [`oneWriter`](../checks/one-writer.md) · defining a category: [the config reference](../reference/config.md#categories)
