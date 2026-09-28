# `changeTogether`

reads: staged set · fires at: commit · 2026-09-06

When one file changes, another must be staged with it — a schema and its migration, an interface and its fixture. Each group names the trigger set and the set at least one of which must move too.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `groups` | list of groups | yes | each: `if` (globs that trigger) and `thenAny` (globs, at least one of which must be staged too) |

## Example

```
schemaAndMigration: guardrail()
  .at(commit)
  .check(changeTogether({ groups: [{ if: ["src/db/schema.ts"], thenAny: ["src/db/migrations/**"] }] }))
  .message("Schema changed but no migration is staged with it.")
  .test({
    pass:  [{ staged: ["src/db/schema.ts", "src/db/migrations/003.ts"] }],
    block: [{ staged: ["src/db/schema.ts"] }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
