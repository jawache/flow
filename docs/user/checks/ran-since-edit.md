---
summary: "reads: the turn · fires at: turn-end"
---

# `ranSinceEdit`

Holds the turn open once when the agent changed a matching file this turn but never ran the command afterwards — “you changed a guard but never ran the tests”. It reads the turn's own actions, holds no state, and never traps: the next stop attempt goes through. A changed file is one a call of the turn changed, whichever tool changed it: an edit tool or a shell command.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `edited` | list of globs | yes | the files whose change-without-a-run is the violation |
| `mustRun` | string | yes | the command that must have run after the last matching change |

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

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
