# `siblingExists`

reads: file path · fires at: write · commit · 2026-09-06

A file must have its required companion on disk — every `src/domain/**` needs its `.test.ts`. The check asks one question: does the sibling exist. (To also require each export be referenced in that test, add [`symbolsInSibling`](./symbols-in-sibling.md).)

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sibling` | template string | yes | the companion path — `{dir} {name} {base} {path}` expand from the touched file |

## Example

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

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
