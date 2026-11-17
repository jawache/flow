---
summary: "reads: file path · fires at: commit"
---

# `protectedPath`

Refuses a commit that changes or deletes a protected path. The `.on(…)` set *is* the protected set — any file that reaches the check is protected by definition, so matching it is the violation. It is the one stock check called for a file the commit deletes. Without `existingOnly`, every file in scope is refused, so the rule has only block cases. With `existingOnly: true`, a new file passes, so a pass case can name one.

A file identical to the one in the last commit passes, with or without `existingOnly`. Only `flow hook commit --all` passes such a file to the check, because it checks every file in the repo and most of them are as committed.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `existingOnly` | boolean | no | append-only: a NEW file here is fine, but an existing one may not be edited or deleted. A new file is one the last commit does not have. A file the commit deletes is refused. A rename is refused by its old path |

## Example

```
keepGenerated: guardrail()
  .at(commit)
  .on("src/generated/**")
  .check(protectedPath({}))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({ block: [{ path: "src/generated/api.ts", content: "" }, { staged: [], deleted: { "src/generated/api.ts": "" } }] }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
