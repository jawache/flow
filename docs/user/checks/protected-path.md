# `protectedPath`

reads: file path · fires at: write · delete · commit · 2026-09-06

Refuses a hand-edit of a protected path. The `.on(…)` set *is* the protected set — any file that reaches the check is protected by definition, so matching it is the violation. Name the bare folder alongside its glob, or an `rm -rf` of the directory slips past. A protected-path rule is block-only: everything in scope is refused, so there is nothing to pass.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `existingOnly` | boolean | no | append-only: a NEW file here is fine, but an existing one may not be edited or deleted. At write, a new file is one that was not on disk before the change. At commit, a new file is one the last commit does not have, and a file the commit deletes is refused when the rule is bound at both `deletion` and `commit`. A rename is refused by its old path |

## Example

```
keepGenerated: guardrail()
  .at(write, deletion, commit)
  .on("src/generated/**", "src/generated")
  .check(protectedPath({}))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({ block: [{ path: "src/generated/api.ts", content: "" }] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
