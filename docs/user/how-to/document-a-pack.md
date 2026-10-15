---
summary: "the doc comments a pack's generated page is built from"
---

# How to document a pack

This guide shows you how to write the doc comments that a pack's generated page is built from.

A pack file is not a document. A rule is spread over `.at()`, `.on()`, `.check()`, `.message()` and `.test()`, so a pack is read on its generated page, one per pack, under [docs/user/packs/](../packs/index.md). `just docs-packs` writes those pages. Every fact on a page is loaded from the pack itself, except three things that loading cannot give. You write those three as doc comments.

## Write the three doc comments

| Doc comment on | Says | Required |
| --- | --- | --- |
| `definePack` | The pack's **lead** — one paragraph on what the pack is for, in the words someone who has never seen your repo needs. | always |
| each member of the parameter interface | What the fact is, and why the pack cannot know it. | always |
| each entry's key | **Why the entry exists**, under the delete-it test: what goes wrong in the repo without it. | every breadcrumb; a guardrail only when its refusal message cannot carry the reason |

1. **Write the lead** on `definePack`.
2. **Write a doc comment on each parameter**, if the pack takes any.
3. **Write a doc comment on each breadcrumb's key.** If a guardrail's refusal message cannot carry the reason for the rule, write one on its key too.
4. **Keep everything else an ordinary `//` comment:** placement notes, the history of a fix, an aside to the next editor. These are left off the page, which keeps it readable.

## Add the sections a reader needs before binding it

Three JSDoc tags on the same `definePack` comment each become their own section on the page. A tag nobody uses renders nothing. A tag outside the three is not read.

| Tag | Section | Says |
| --- | --- | --- |
| `@install` | What to install first | The tool a rule here shells out to, and how to get it. |
| `@setup` | What the repo needs in place | A file, a recipe or a script the rules assume — with the copyable text where there is any. |
| `@adopt` | Adopting it | What happens on the first run in a repo that has never bound this pack, and what to fix first. |

```
/**
 * Test-first artefacts exist, and the suite gates the commit.
 *
 * @install vitest, and a recipe that runs it.
 * @adopt Bind it with your suite recipe; expect the commit gate to run the suite from the first
 * commit, so land a green suite before you bind it.
 */
export const tdd = definePack("tdd", (repo: Suite) => ({ /* … */ }));
```

## Keep each prose string on one line

Write each string in `.text(…)` or `.message(…)` on **one line**, however long it gets. Only a model reads it, so a wrap helps no reader, and on the page it shows as a line break in the middle of a sentence. An aligned table or a bulleted list is not a wrap: each line is a complete unit, and the line above it finishes.

```
// wrapped to fit an editor — the page shows the break, the model sees a newline
"· One page, one job: the quick start",
"  teaches by doing; the guide solves situations.",

// one line, however long
"· One page, one job: the quick start teaches by doing; the guide solves situations.",
```

Wrap doc comments the other way: a person reads those, so wrap them at the width the rest of the file uses.

## Generate the page

1. Run `just docs-packs`. It writes the pack's page under `docs/user/packs/`.
2. Read the page, and fix any doc comment that does not read well there.

---

[Index](../index.md) · the pages these comments become: [the packs](../packs/index.md) · moving a pack to a second repo: [how to share a pack across repos](./share-a-pack.md)
