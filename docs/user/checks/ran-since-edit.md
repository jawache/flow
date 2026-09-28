# `ranSinceEdit`

reads: the turn · fires at: turn-end · 2026-09-06

Holds the turn open once when the agent edited a matching file this turn but never ran the command afterwards — “you changed a guard but never ran the tests”. It reads the turn's own actions, holds no state, and never traps: the next stop attempt goes through.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `edited` | list of globs | yes | the files whose edit-without-a-run is the violation |
| `mustRun` | string | yes | the command that must have run after the last matching edit |

## Example

```
guardsTested: guardrail()
  .at(turnEnd)
  .check(ranSinceEdit({ edited: ["guards/**"], mustRun: "flow test" }))
  .message("You changed a guard this turn but never ran `flow test` — run it before finishing.")
  .test({
    pass:  [{ actions: [{ did: "edit", path: "guards/x.ts" }, { did: "run", command: "flow test" }] }],
    block: [{ actions: [{ did: "edit", path: "guards/x.ts" }] }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
