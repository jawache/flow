---
summary: "reads: file path · fires at: write · commit"
---

# `canonicalFiles`

Judges a folder against a canon: which filenames a tier may hold, and/or which folders may sit directly under a root. The canon is the whole content of the rule, so both allowlists are stated rather than defaulted.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `root` | string | yes | the tier boundary. With `folders`, every name directly under it is judged. With `allow`, every source file inside a folder under it is judged; a file directly under `root` is not |
| `allow` | list of names | yes | the filenames a feature folder may hold, written without the extension: `"domain"`, not `"domain.ts"`. Only source files are judged: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` and `.jsx`. A `.d.ts` file is never judged. An empty list means the filename tier is not policed |
| `folders` | list of names | no | the names allowed directly under `root` (absent = the folder tier is not policed) |
| `thinking` | string | no | the one file that may carry a `.test.<ext>` sibling |

## Example

```
docsTwoDoors: guardrail()
  .at(write, commit)
  .on("docs/**")
  .check(canonicalFiles({ root: "docs", allow: [], folders: ["user", "agent"] }))
  .message("docs/ holds exactly two doors: `user/` (for people) and `agent/` (archival context, for agents). A third folder or a loose file at the top is documentation with no declared audience, which is how a docs folder becomes a drawer.")
  .test({
    pass:  [{ path: "docs/user/index.html", content: "" }],
    block: [{ path: "docs/notes/scratch.md", content: "" }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
