---
summary: "reads: file body · fires at: write · commit"
---

# `jsonInvariant`

Holds one or more assertions over the values in a JSON file. Each assertion digs to a dotted path and states one thing that must be true there.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `assert` | list of assertions | yes | each: `path?` (dotted, root if absent), any of `equals` · `matches` (regex) · `keysPrefixedWith`, and `required?`. Every key present is checked |

Set `required: true` on any path that must exist. Without it, an assertion on a missing path passes.

A file that does not parse as JSON passes every assertion, `required` included. The check runs on the file as it would be after each edit, and a half-typed file is often not valid JSON yet.

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

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
