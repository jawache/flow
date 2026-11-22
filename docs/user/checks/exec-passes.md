---
summary: "reads: runs a tool · fires at: commit"
---

# `execPasses`

Runs a whole-project tool and blocks on a non-zero exit, showing what the tool printed. flow decides WHEN it runs; the tool owns its own job and config. If `run` contains `{files}`, flow substitutes the changed set.

## What the refusal shows

The refusal shows the tool's stdout and stderr together, in the order the tool printed them. Output of up to 40 lines is shown whole. Longer output is cut to its last 40 lines, followed by a line with the number of lines cut and the path of a file that holds all of it, `.flow/output/<entry id>.log`. Each refusal replaces the file. The whole output is also in the refusal's row of [the session log](../reference/log.md#guardrail).

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

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
