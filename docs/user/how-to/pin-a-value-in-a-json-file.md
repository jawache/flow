---
summary: "refuse a change that breaks an assertion about a JSON file, with `jsonInvariant`"
---

# How to pin a value in a JSON file

This guide shows you how to refuse a write or a commit that changes a value in a JSON file you need to stay fixed, such as `strict` in `tsconfig.json`.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `jsonInvariant` to the import.

2. Add an entry that runs `jsonInvariant` at `write` and `commit`, scoped to the file:

   ```
   strictStaysOn: guardrail()
     .at(write, commit)
     .on("tsconfig.json")
     .check(jsonInvariant({ assert: [{ path: "compilerOptions.strict", equals: true, required: true }] }))
     .message("Strictness is load-bearing — a red squiggle is a defect found, not a setting to relax.")
     .test({
       pass:  [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":true}}' }],
       block: [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":false}}' }],
     }),
   ```

3. Run `flow test`.

Each assertion takes one or more of four checks: `equals`, `matches`, `keysPrefixedWith` and `required`.

> [!IMPORTANT]
> Set `required: true` on any path that must exist. Without it, an assertion on a missing path passes.

A file that does not parse as JSON passes every assertion, `required` included.

---

[Index](../index.md) · every option: [`jsonInvariant`](../checks/json-invariant.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
