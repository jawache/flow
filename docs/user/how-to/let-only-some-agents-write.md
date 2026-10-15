---
summary: "refuse a file change from any actor outside a list, with `oneWriter`"
---

# How to let only some agents write

This guide shows you how to let only some agents change files when several agents share one worktree. For example, a builder changes files and a checker only reports.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `breadcrumb`, `defineCategory`, `deletion`, `oneWriter`, `session` and `spawnedAs` to the import.

2. Declare a category for each kind of actor that may write. A category is a name for an actor, together with a function that decides which sessions have it. `spawnedAs` builds that function from evidence the harness wrote about the session: `parent: true` matches the top-level chat, and `types` matches a subagent by the agent type it was started as.

   ```
   const parent = defineCategory("parent", spawnedAs({ parent: true }));
   const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));
   ```

3. Name those categories in the `.for(…)` of an entry the config binds. flow works out a session's categories only from the categories some bound entry names in `.for(…)`. A name listed only in `oneWriter`'s `writers` is never matched, so every session's `ctx.actor` is empty and every write is refused, the top-level chat's included. A session breadcrumb for the writers does the job:

   ```
   writers: breadcrumb()
     .at(session)
     .for(builder, parent)
     .text("You may change files in this worktree. Every other agent hands its finding back instead."),
   ```

4. Add an entry that runs `oneWriter` at `write` and `deletion`. `writers` lists the categories allowed to create, change or delete a file:

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

5. Run `flow test`. In a test case, `actor: ["builder"]` gives the canned session its categories.

6. Run `flow status`. Its `categories` line lists `builder` and `parent`.

If the top-level chat should not write either, leave `parent` out of `writers` and out of the breadcrumb's `.for(…)`.

## What happens when the rule refuses

Every actor outside `writers` is refused.

- **Through the Edit or Write tool**, the write is refused before it lands.
- **Through `rm`, `git rm`, `mv` or `git mv` naming a file**, the delete is refused before the command runs. For `mv` and `git mv`, the file being moved away is the one deleted.
- **Through any other shell command**, the change lands, flow checks it, and flow writes the file's previous content back.

[What the guard sees](../explanation/what-the-guard-sees.md) explains the routes. [Rules bound to who](../explanation/rules-bound-to-who.md) explains categories.

---

[Index](../index.md) · every option: [`oneWriter`](../checks/one-writer.md) · defining a category: [the config reference](../reference/config.md#categories)
