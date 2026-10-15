# How to ban a pattern in files

docs/user/how-to · refuse a word or a regex in the files you choose, with `textBan` · 2026-10-15

This guide shows you how to refuse a write or a commit when a file contains a banned word or pattern.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

2. Add an entry that runs `textBan` at `write` and `commit`, scoped with `.on(…)` to the files you want checked:

   ```
   noTodo: guardrail()
     .at(write, commit)
     .on("src/**/*.ts")
     .check(textBan({ ban: ["\\bTODO\\b"] }))
     .message("No TODOs — do it now, or track it properly.")
     .test({ pass: [{ path: "src/x.ts", content: "const x = 1;" }], block: [{ path: "src/x.ts", content: "// TODO: later" }] }),
   ```

3. Run `flow test`. The entry's `pass` case must pass and its `block` case must be refused.

Each regex in `ban` is tried against each line of the file. Matching is case-sensitive.

## Variants

- **If you want to ban a code shape** rather than a string, use [`astGrep`](../checks/ast-grep.md) instead. It parses the syntax tree, so it never matches inside a string or a comment.
- **If you want to leave some files out**, add `.ignore(…)` with their globs.

---

[Index](../index.md) · every option: [`textBan`](../checks/text-ban.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
