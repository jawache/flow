---
summary: "refuse a commit when your typecheck, lint, tests or coverage bar fails, with `execPasses`"
---

# How to gate a commit on a tool

This guide shows you how to run a tool at each commit, and refuse the commit when the tool fails. The tool is the typecheck, the lint, the tests or the coverage bar.

1. Open the [pack](../reference/glossary.md#pack) that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

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
- **If you want one entry per tool**, add an entry for each: the typecheck, the lint, the tests. Each refusal then names the tool that failed.
- **If you want a coverage bar**, run the tool that enforces it, such as `execPasses({ run: "npx vitest run --coverage", changed: ["src/**"] })`, with the threshold set in that tool's own config. Code written before its test passes, as long as the commit meets the bar.

---

[Index](../index.md) · every option: [`execPasses`](../checks/exec-passes.md) · how a case supplies an exit code: [the config reference](../reference/config.md#cases)
