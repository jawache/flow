# `canonicalFiles`

reads: file path · fires at: write · commit · 2026-09-06

Judges a folder against a canon: which filenames a tier may hold, and/or which folders may sit directly under a root. The canon is the whole content of the rule, so both allowlists are stated rather than defaulted.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `root` | string | yes | the tier boundary — everything below it is judged |
| `allow` | list of names | yes | the filenames a feature folder may hold (empty = the filename tier is not policed) |
| `folders` | list of names | no | the names allowed directly under `root` (absent = the folder tier is not policed) |
| `thinking` | string | no | the one file that may carry a `.test.<ext>` sibling |

## Example

```
docsTwoDoors: guardrail()
  .at(write, commit)
  .on("docs/**")
  .check(canonicalFiles({ root: "docs", allow: [], folders: ["user", "agent"] }))
  .message("docs/ holds exactly two doors: user/ (HTML, for people) and agent/ (archival context).")
  .test({
    pass:  [{ path: "docs/user/index.html", content: "" }],
    block: [{ path: "docs/notes/scratch.md", content: "" }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
