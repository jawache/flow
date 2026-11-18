---
summary: "refuse a commit by what its files hold: a banned pattern, a pinned JSON value, an unapproved file name, a protected file, a missing test"
---

# How to check file content at commit

This guide shows you how to refuse a commit because of what a staged file holds, or which file it is. Each rule below is one stock check at `commit`, scoped with `.on(…)`.

1. Open the [pack](../reference/glossary.md#pack) that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add the check you use to the import.

2. Add the entry for your case, from the sections below.

3. Run `flow test`.

A rule at `commit` with `.on(…)` is called once per staged file in scope, with the file as staged. It is never called for a file the commit deletes.

## Ban a pattern

```
noTodo: guardrail()
  .at(commit)
  .on("src/**/*.ts")
  .check(textBan({ ban: ["\\bTODO\\b"] }))
  .message("No TODOs — do it now, or track it properly.")
  .test({ pass: [{ path: "src/x.ts", content: "const x = 1;" }], block: [{ path: "src/x.ts", content: "// TODO: later" }] }),
```

Each regex is tried against every line. For a shape of code, not text, use [`astGrep`](../checks/ast-grep.md), which cannot match inside a string or a comment.

## Pin a JSON value

```
strictStaysOn: guardrail()
  .at(commit)
  .on("tsconfig.json")
  .check(jsonInvariant({ assert: [{ path: "compilerOptions.strict", equals: true, required: true }] }))
  .message("Strictness is load-bearing — a red squiggle is a defect found, not a setting to relax.")
  .test({
    pass:  [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":true}}' }],
    block: [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":false}}' }],
  }),
```

## Keep a folder to approved names

[`canonicalFiles`](../checks/canonical-files.md) refuses a file in scope whose name is not on the list. Its page has the options and an example.

## Protect a file

```
keepGenerated: guardrail()
  .at(commit)
  .check(protectedPath({ paths: ["src/generated/**"] }))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({
    pass:  [{ staged: ["src/app.ts"] }],
    block: [{ staged: ["src/generated/api.ts"] }, { staged: [], deleted: ["src/generated/api.ts"] }],
  }),
```

`protectedPath` refuses a commit that changes or deletes any file under `paths`. It takes no `.on(…)`: it is called once, with the whole commit. An agent can still change the file in the working tree. The commit is where it is refused.

- **If you want to keep existing files but allow new ones**, such as in a migrations folder, pass `existingOnly: true`. A rename is refused by its old path.
- **If you want to refuse only a deletion**, write a check of your own that reads the paths the commit deletes:

  ```
  .check((ctx) => {
    const gone = (ctx.deleted ?? []).filter((path) => path.startsWith("migrations/"));
    return gone.length === 0 ? ctx.ok() : ctx.fail("this commit deletes " + gone.join(", "));
  })
  ```

## Require a sibling test

```
pureHasTest: guardrail()
  .at(commit)
  .on("src/domain/**/*.ts")
  .ignore("**/*.test.ts")
  .check(siblingExists({ sibling: "{dir}/{name}.test.ts" }))
  .message("This module has no test beside it. Add the test to this commit.")
  .test({
    pass:  [{ path: "src/domain/x.ts", content: "", world: { fs: { "src/domain/x.test.ts": "" } } }],
    block: [{ path: "src/domain/x.ts", content: "" }],
  }),
```

For the file `src/domain/x.ts`, `{dir}` is `src/domain`, `{base}` is `x.ts`, `{name}` is `x` and `{path}` is `src/domain/x`. To require that the test names each export, use [`symbolsInSibling`](../checks/symbols-in-sibling.md).

---

[Index](../index.md) · every option: [`textBan`](../checks/text-ban.md) · [`jsonInvariant`](../checks/json-invariant.md) · [`canonicalFiles`](../checks/canonical-files.md) · [`protectedPath`](../checks/protected-path.md) · [`siblingExists`](../checks/sibling-exists.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
