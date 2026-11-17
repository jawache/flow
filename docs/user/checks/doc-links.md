---
summary: "reads: file body · fires at: commit"
---

# `docLinks`

Refuses a staged file that cites a docs page, or a section of one, that does not exist. Code that says where its behaviour is documented stays true when the page is renamed or the heading reworded.

## What a citation is

- **A page** is cited by its path from the repo root, anywhere in the file: `docs/user/reference/record.md`. A path is a citation when it matches the `pages` globs.
- **A section** is cited as the page, then ` § `, then the heading's text: `docs/user/reference/record.md § Ids`. It resolves when the text after `§` begins with a heading of that page, at any level. So `§ Ids).` and `§ Teardown, step 2` both resolve.

```
// The next id comes from the counter (docs/user/reference/record.md § Ids).
```

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `pages` | list of globs | yes | the pages that may be cited. A path in a staged file that matches is checked |

A refusal lists each citation that does not resolve, with its line, and says whether the page or the heading is missing.

The check judges the staged files in `.on(…)`. A commit that renames a page does not judge the files that cite it, unless they are staged too. `flow hook commit --all` judges every file.

## Example

```
docLinksResolve: guardrail()
  .at(commit)
  .on("internal/**/*.go")
  .check(docLinks({ pages: ["docs/user/**/*.md"] }))
  .message("This file cites a docs page or section that does not exist. Fix the citation, or restore the heading.")
  .test({
    pass: [{ path: "internal/id.go", content: "// docs/user/reference/record.md § Ids", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
    block: [{ path: "internal/id.go", content: "// docs/user/reference/record.md § Idz", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md) · the steps: [how to check that doc links in code still resolve](../how-to/check-doc-links.md)
