# `textBan`

reads: file body · fires at: write · commit · 2026-09-06

Bans a word or pattern in text — prose, config, comments, anything. Each regex is tried against every line; a match is a finding naming the line. Case-sensitive. For code *shapes* prefer [`astGrep`](./ast-grep.md), which parses the tree and cannot false-match inside a string or a comment.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ban` | list of regex | yes | one pattern per concern; any line matching any of them blocks |

## Example

```
noTodo: guardrail()
  .at(write, commit)
  .on("src/**/*.ts")
  .check(textBan({ ban: ["\\bTODO\\b"] }))
  .message("No TODOs — do it now, or track it properly.")
  .test({ pass: [{ path: "src/x.ts", content: "const x = 1;" }], block: [{ path: "src/x.ts", content: "// TODO: later" }] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
