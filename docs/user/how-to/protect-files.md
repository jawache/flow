# How to protect files

docs/user/how-to · refuse every write, delete and commit of the paths you list, with `protectedPath` · 2026-10-15

This guide shows you how to stop anyone changing or deleting files that nobody should edit, such as generated code.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `deletion` and `protectedPath` to the import.

2. Add an entry that runs `protectedPath` at `write`, `deletion` and `commit`. List the paths in `.on(…)`:

   ```
   keepGenerated: guardrail()
     .at(write, deletion, commit)
     .on("src/generated/**", "src/generated")
     .check(protectedPath({}))
     .message("Machine-written — edit the source the header names, then re-run the build.")
     .test({ block: [{ path: "src/generated/api.ts", content: "" }] }),
   ```

3. Run `flow test`.

`protectedPath` refuses every file it is called with, and it does not read the file's contents. Which files are protected is set only by the globs in `.on(…)`. The agent is shown the text you pass to `.message(…)`.

> [!IMPORTANT]
> List the folder's own path as well as the glob for what is inside it, as `.on(…)` does above with `src/generated` and `src/generated/**`. `rm -rf src/generated` removes the path `src/generated`, and `src/generated/**` matches only paths inside it. Without the bare path, that delete matches neither glob and goes through.

The `.test` block has `block` cases and no `pass` cases. `pass` lists the inputs the rule must let through, and `block` lists the inputs it must refuse. This rule refuses every input, so `pass` has nothing to list.

## Variants

- **If you want to keep existing files but allow new ones**, such as in a migrations folder, pass `protectedPath({ existingOnly: true })`. A file that exists can no longer be changed or deleted, and a new file can still be created. At commit, a new file is one the last commit does not have. Keep the rule at `write`, `deletion` and `commit`, so a commit that deletes or renames an existing file is refused too. A rename is refused by its old path.

## What happens when the rule refuses

- **Through the Edit tool**, the refusal comes first and nothing is written.
- **Through a shell command**, the change lands, flow checks it, and flow writes the file's previous content back.

[What the guard sees](../explanation/what-the-guard-sees.md) explains both routes.

---

[Index](../index.md) · every option: [`protectedPath`](../checks/protected-path.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
