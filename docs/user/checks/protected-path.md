---
summary: "reads: staged set · deleted paths · fires at: commit"
---

# `protectedPath`

Refuses a commit that changes or deletes a file under the paths you name. It is called once per commit, with no `.on(…)`, and reads the commit's staged paths and its deleted paths. An agent can still change a protected file in the working tree. The commit is where it is refused.

A file identical to the one in the last commit passes. Only `flow hook commit --all` lists such a file, because it lists every file in the repo and most of them are as committed.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paths` | list of globs | yes | the protected files |
| `existingOnly` | boolean | no | append-only: a NEW file under `paths` is fine, but an existing one may not be changed or deleted. A new file is one the last commit does not have. A rename is refused by its old path |

A refusal lists each protected file the commit changes, and each it deletes.

## Example

```
keepGenerated: guardrail()
  .at(commit)
  .check(protectedPath({ paths: ["src/generated/**"] }))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({
    pass:  [{ staged: ["src/app.ts"] }],
    block: [{ staged: ["src/generated/api.ts"] }, { staged: [], deleted: ["src/generated/api.ts"] }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
