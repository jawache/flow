# `jsonInvariant`

reads: file body · fires at: write · commit · 2026-09-06

Holds one or more assertions over the values in a JSON file. Each assertion digs to a dotted path and states one thing that must be true there.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `assert` | list of assertions | yes | each: `path?` (dotted, root if absent), and one of `equals` · `matches` (regex) · `keysPrefixedWith`, plus `required?` |

Set `required: true` on any path that must exist — without it, a missing path skips silently.

## Example

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

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
