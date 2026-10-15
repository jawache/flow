---
summary: "refuse a commit when your test suite, typecheck or any tool exits non-zero, with `execPasses`"
---

# How to gate a commit on a tool

This guide shows you how to run your test suite, a typecheck or any other tool before each commit, and refuse the commit when it fails.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `execPasses` to the import.

2. Add an entry that runs `execPasses` at `commit`, with the command in `run`:

   ```
   testsGreen: guardrail()
     .at(commit)
     .check(execPasses({ run: "just test", changed: ["src/**"] }))
     .message("The suite is red — fix it, then commit.")
     .test({
       pass:  [{ staged: ["README.md"] }],                                          // nothing in src/** moved — the gate does not run
       block: [{ staged: ["src/a.ts"], world: { exec: { "just test": { code: 1, stdout: "1 failing" } } } }],
     }),
   ```

3. Run `flow test`.

An exit code of 0 passes. Any other exit code refuses the commit, and the refusal shows the tool's failing lines.

## Variants

- **If you want the tool to run only when one area changed**, list that area's globs in `changed`. Leave `changed` out to run the tool on every commit.
- **If the tool takes a list of files**, put `{files}` in `run`. flow replaces it with the changed files.

---

[Index](../index.md) · every option: [`execPasses`](../checks/exec-passes.md) · how a case supplies an exit code: [the config reference](../reference/config.md#cases)
