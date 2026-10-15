---
summary: "reads: file body · fires at: write · commit"
---

# `symbolsInSibling`

Every name a file exports must be referenced somewhere in its sibling test's text. A real parser reads the exports, so `export const x` inside a string or comment never false-matches. It is a cheap nudge, not coverage.

The parser reads the file as TSX, so JavaScript files are read too. It reads three shapes of export:

- **`export function`** with no return type and no type parameters, `async` included
- **`export class`** with no `extends`, no `implements` and no type parameters
- **`export const`** with no type annotation

Every other export is left out of the check, such as:

- `export let`, `interface`, `type`, `enum`, `export default` and re-exports
- generator functions (`export function*`)
- `export abstract class`
- every declarator after the first in `export const a = 1, b = 2`: only `a` is read

When the sibling test does not exist, the check refuses the file with `sibling test not found`, whether or not the file exports anything.

## What it reports

A refusal names the sibling test once and lists every export it never mentions. The line prints under the entry's `.message(…)`:

```
✗ exportsTested · src/domain/rooms.ts
  The exports listed below are never named in this file's test. Write a test that uses each one, then write the change again: a reference is enough, as this is a nudge, not coverage.
    not referenced in src/domain/rooms.test.ts: ROOM_JOIN_TILES, roomJoinSoFar
```

## Limits

- **A destructured `export const`**, such as `export const { a, b } = obj`, is read as one name, `{ a, b }`. That text never matches as a word in the test, so the file is always refused.

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
  .message("The exports listed below are never named in this file's test. Write a test that uses each one, then write the change again: a reference is enough, as this is a nudge, not coverage.")
  .test({
    pass:  [{ path: "src/domain/a.ts", content: "export const x = 1;", world: { fs: { "src/domain/a.test.ts": "expect(x)" } } }],
    block: [{ path: "src/domain/a.ts", content: "export const y = 1;", world: { fs: { "src/domain/a.test.ts": "nothing" } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
