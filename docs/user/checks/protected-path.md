---
summary: "reads: file path · fires at: write · delete · commit"
---

# `protectedPath`

Refuses a hand-edit of a protected path. The `.on(…)` set *is* the protected set — any file that reaches the check is protected by definition, so matching it is the violation. When the rule is bound at `deletion`, a glob such as `src/generated/**` also covers an `rm -rf` of the folder: each file the command removed is judged after it runs, and written back when refused. Without `existingOnly`, every file in scope is refused, so the rule has only block cases. With `existingOnly: true`, a new file passes, so a pass case can name one.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `existingOnly` | boolean | no | append-only: a NEW file here is fine, but an existing one may not be edited or deleted. At write, a new file is one that was not on disk before the change. At commit, a new file is one the last commit does not have, and a file the commit deletes is refused when the rule is bound at both `deletion` and `commit`. A rename is refused by its old path |

## Example

```
keepGenerated: guardrail()
  .at(write, deletion, commit)
  .on("src/generated/**")
  .check(protectedPath({}))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({ block: [{ path: "src/generated/api.ts", content: "" }] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
