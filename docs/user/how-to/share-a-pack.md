---
summary: "move a pack from `guards/` to a package a second repo imports"
---

# How to share a pack across repos

This guide shows you how to share a pack you wrote in one repo with a second repo.

A pack is a TypeScript module, so sharing it is a move, not a rewrite. The entries stay as they are, and each repo still binds the pack with one `pack(…)` line.

## Move the pack

1. **Move the pack file** from the repo's `guards/` folder into an npm package.
2. **Replace each repo-specific fact with a parameter.** If the two repos differ on a fact the pack needs, such as a pure-code home or a test command, declare it as a mandatory typed parameter:

   ```
   // the pack takes a repo fact it cannot know
   export const tdd = definePack("tdd", (repo: { run: string }) => ({
     commitRunsTests: guardrail()
       .at(commit)
       .check(execPasses({ run: repo.run }))
       .message("Commit runs the suite.")
       .test({ /* … */ }),
   }));

   // …and the config supplies it
   export default defineConfig([
     pack(tdd, { run: "just test-commit" }),
   ]);
   ```

   A repo that binds the pack without stating the fact does not compile, so the pack never applies another repo's assumptions.

3. **Import the pack in each repo's `flow.config.ts`** from the package, and bind it with `pack(…)`. The import path is the only line that changes.
4. **If a repo disagrees with one entry**, override that entry in the repo's config. Do not fork the pack. [How to change or turn off one entry of a pack](./override-an-entry.md) gives the steps.
5. **Write the pack's doc comments**, so its generated page explains it to a reader who has never seen your repo. [How to document a pack](./document-a-pack.md) gives the steps.

---

[Index](../index.md) · why a pack is code: [how flow works](../explanation/how-flow-works.md) · `pack(x, params)`: [the config reference](../reference/config.md) · the ten packs flow ships: [the packs](../packs/index.md)
