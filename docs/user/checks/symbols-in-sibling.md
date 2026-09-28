# `symbolsInSibling`

reads: file body · fires at: write · commit · 2026-09-06

Every name a TypeScript file exports must be referenced somewhere in its sibling test's text. A real parser reads the exports, so `export const x` inside a string or comment never false-matches. TypeScript only — a cheap nudge, not coverage.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sibling` | template string | yes | the companion path — `{dir} {name} {base} {path}` expand from the touched file |

## Example

```
exportsTested: guardrail()
  .at(write, commit)
  .on("src/domain/**/*.ts")
  .ignore("**/*.test.ts")
  .check(symbolsInSibling({ sibling: "{dir}/{name}.test.ts" }))
  .message("An exported function is never referenced in its test — a cheap nudge, not coverage.")
  .test({
    pass:  [{ path: "src/domain/a.ts", content: "export const x = 1;", world: { fs: { "src/domain/a.test.ts": "expect(x)" } } }],
    block: [{ path: "src/domain/a.ts", content: "export const y = 1;", world: { fs: { "src/domain/a.test.ts": "nothing" } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
