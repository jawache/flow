---
summary: "reads: file body · fires at: commit"
---

# `docLinks`

Refuses a staged file that cites a docs page, or a section of one, that does not exist. Code that says where its behaviour is documented stays true when the page is renamed or the heading reworded.

## What a citation is

A citation is a link you can click in an editor: the page's path from the repo root, and for a section, `#` and the heading's anchor.

- **A page:** `docs/user/reference/record.md`. A path is a citation when it matches the `pages` globs.
- **A section:** `docs/user/reference/record.md#ids`. It resolves when the page has a heading with that anchor, at any level. The anchor is the heading's text in lower case, with each space as a hyphen and punctuation removed, as GitHub makes it: `## Where the record is` is `#where-the-record-is`.

```
// The next id comes from the counter (docs/user/reference/record.md#ids).
```

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `pages` | list of globs | yes | the pages that may be cited. A path in a staged file that matches is checked |

A refusal lists each citation that does not resolve, with its line, and says whether the page or the anchor is missing.

The check judges the staged files in `.on(…)`. A commit that renames a page does not judge the files that cite it, unless they are staged too. `flow hook commit --all` judges every file `.on(…)` matches.

## Example

```
docLinksResolve: guardrail()
  .at(commit)
  .on("internal/**/*.go")
  .check(docLinks({ pages: ["docs/user/**/*.md"] }))
  .message("This file cites a docs page or section that does not exist. Fix the citation, or restore the heading.")
  .test({
    pass: [{ path: "internal/id.go", content: "// docs/user/reference/record.md#ids", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
    block: [{ path: "internal/id.go", content: "// docs/user/reference/record.md#idz", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md) · the steps: [how to check that doc links in code still resolve](../how-to/check-doc-links.md)
