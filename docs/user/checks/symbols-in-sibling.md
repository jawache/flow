---
summary: "reads: file body · fires at: write · commit"
---

# `symbolsInSibling`

Every name a file exports must be referenced somewhere in its sibling test's text. A real parser reads the exports, so `export const x` inside a string or comment never false-matches. It is a cheap nudge, not coverage.

The parser reads the file as TSX, so JavaScript files are read too. It reads three shapes of export:

- **`export function`** with no return type and no type parameters, `async` included
- **`export class`** with no `extends`, no `implements` and no type parameters
- **`export const`** with no type annotation, which includes:
  - **every declarator**: `export const a = 1, b = 2` is read as `a` and `b`
  - **destructuring**: every name the pattern binds is read, so `export const { a, b: c, ...d } = obj` is read as `a`, `c` and `d`, and `export const [x, y] = arr` as `x` and `y`

Every other export is left out of the check, such as:

- `export let`, `interface`, `type`, `enum`, `export default` and re-exports
- generator functions (`export function*`)
- `export abstract class`

When the sibling test does not exist, the check refuses the file with `sibling test not found`, whether or not the file exports anything.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sibling` | template string | yes | the companion path. For the file `a/b/x.ts`, `{dir}` is `a/b`, `{base}` is `x.ts`, `{name}` is `x` and `{path}` is `a/b/x`, the path without its extension |

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

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
