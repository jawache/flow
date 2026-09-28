# `oneWriter`

reads: the actor · fires at: write · delete · 2026-09-28

Refuses a write or a delete by an actor that has none of the categories listed in `writers`. An actor is the session that made the change: the parent chat, or one of the subagents it started. A category is a name for an actor, defined in the config together with the recognizer that decides which sessions have it. The check reads the acting session's category names from `ctx.actor`. Those names come from evidence the harness wrote about the session, never from a claim the session made about itself.

Which tool made the change does not change the answer: a change through the Edit tool, through a heredoc and through a script are all judged by this rule. An Edit is refused before anything is written to disk. A change already written to disk is reverted to the file's previous content.

The check is for a worktree several agents share — one builder that writes files, and verifiers that only read them. There, a verifier that repairs what it noticed has changed a file nobody asked it to change.

The parent chat has no category unless the config defines one for it. List a category the parent chat does have, or the parent chat's own writes and deletes are refused too.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `writers` | list of category names | yes | the categories allowed to create, change or delete a file. A write or a delete by an actor that has none of them is refused |

## Example

```
builderWrites: guardrail()
  .at(write, deletion)
  .check(oneWriter({ writers: ["builder", "parent"] }))
  .message("Only the builder changes files in this worktree — hand your finding back instead of fixing it.")
  .test({
    pass:  [{ path: "src/x.ts", content: "", actor: ["builder"] }],
    block: [{ path: "src/x.ts", content: "", actor: ["checker"] }],
  }),
```

A case adds an `actor` field beside `path` and `content`. `actor: ["builder"]` is the list of category names the canned session has. The [config reference](../02-entry-reference.md#categories) gives the syntax for defining a category, and for binding a rule to one with `.for(…)`. `.for(…)` limits which actor a rule applies to. `oneWriter` limits which actors may change the file, and refuses every other one.

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
