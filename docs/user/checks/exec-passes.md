# `execPasses`

reads: runs a tool · fires at: commit · 2026-09-06

Runs a whole-project tool and blocks on a non-zero exit, showing its failing lines. flow decides WHEN it runs; the tool owns its own job and config. If `run` contains `{files}`, flow substitutes the changed set.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `run` | string | yes | the command to run; exit 0 passes, anything else blocks |
| `changed` | list of globs | no | run only when the change touched this area; otherwise the gate stands aside |

## Example

```
testsGreen: guardrail()
  .at(commit)
  .check(execPasses({ run: "just test", changed: ["src/**"] }))
  .message("The suite is red — fix it, then commit.")
  .test({
    pass:  [{ staged: ["README.md"] }],
    block: [{ staged: ["src/a.ts"], world: { exec: { "just test": { code: 1, stdout: "1 failing" } } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
