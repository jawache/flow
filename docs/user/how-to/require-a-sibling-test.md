---
summary: "refuse a module that has no test file beside it, with `siblingExists`"
---

# How to require a sibling test

This guide shows you how to refuse a write or a commit of a module whose test file does not exist.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `siblingExists` to the import.

2. Add an entry that runs `siblingExists` at `write` and `commit`. Scope it to the modules, and use `.ignore(…)` to leave the tests themselves out:

   ```
   pureHasTest: guardrail()
     .at(write, commit)
     .on("src/domain/**/*.ts")
     .ignore("**/*.test.ts")
     .check(siblingExists({ sibling: "{dir}/{name}.test.ts" }))
     .message("Test-first: the sibling test is missing. Write the failing test, then the code.")
     .test({
       pass:  [{ path: "src/domain/x.ts", content: "", world: { fs: { "src/domain/x.test.ts": "" } } }],
       block: [{ path: "src/domain/x.ts", content: "" }],
     }),
   ```

3. Run `flow test`.

The `sibling` pattern is built from the path of the file being written. It takes four placeholders: `{dir}`, `{name}`, `{base}` and `{path}`.

## Variants

- **If you also want every export referenced in that test**, add a second entry that runs [`symbolsInSibling`](../checks/symbols-in-sibling.md). It reads TypeScript only. It checks that each exported name appears in the test, and it does not measure coverage.

---

[Index](../index.md) · every option: [`siblingExists`](../checks/sibling-exists.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
