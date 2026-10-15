# How to make files change together

docs/user/how-to · refuse a commit that stages one file without its partner, with `changeTogether` · 2026-10-15

This guide shows you how to refuse a commit that changes one file without the file that must change with it, such as a schema without its migration.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `changeTogether` to the import.

2. Add an entry that runs `changeTogether` at `commit`. Each group says: if a file in `if` is staged, a file matching `thenAny` must be staged too.

   ```
   schemaAndMigration: guardrail()
     .at(commit)
     .check(changeTogether({ groups: [{ if: ["src/db/schema.ts"], thenAny: ["src/db/migrations/**"] }] }))
     .message("Schema changed but no migration is staged with it.")
     .test({
       pass: [{ staged: ["src/db/schema.ts", "src/db/migrations/003.ts"] }],
       block: [{ staged: ["src/db/schema.ts"] }],
     }),
   ```

3. Run `flow test`.

## Variants

- **If you have several pairs of files**, add one group per pair to `groups`.

---

[Index](../index.md) · every option: [`changeTogether`](../checks/change-together.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
