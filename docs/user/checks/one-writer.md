# `oneWriter`

reads: the actor · fires at: write · delete · 2026-09-28

Refuses a change to a file by any actor not wearing one of the named categories. It exists for a worktree shared by several agents — a builder that writes and verifiers that read — where a verifier's “quick fix” is the change nobody asked for. It reads `ctx.actor`, the categories the acting session wears (host-written evidence, never a claim the session made), so an actor outside the list is refused whether it edits through Edit, a heredoc or a script: an Edit is refused before it lands, and a change that has already landed is reverted. The parent chat wears no category unless the config gives it one — name a category it does wear, or it is refused too.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `writers` | list of category names | yes | the categories that may create, change or delete files; every other actor's write or delete is refused |

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

A case names the actor beside the file, as `actor: [...]` — the categories the canned session wears. A category is a name with its recognizer aboard; the [config reference](../02-entry-reference.md#categories) says how one is defined and how `.for(…)` binds a rule to one. This check is the other direction: not “this rule is for that actor”, but “this act is for those actors only”.

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
