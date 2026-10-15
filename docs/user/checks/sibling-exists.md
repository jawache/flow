---
summary: "reads: file path · fires at: write · commit"
---

# `siblingExists`

A file must have its required companion on disk — every `src/domain/**` needs its `.test.ts`. The check asks one question: does the sibling exist. (To also require each export be referenced in that test, add [`symbolsInSibling`](./symbols-in-sibling.md).)

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sibling` | template string | yes | the companion path. For the file `a/b/x.ts`, `{dir}` is `a/b`, `{base}` is `x.ts`, `{name}` is `x` and `{path}` is `a/b/x`, the path without its extension |

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

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
