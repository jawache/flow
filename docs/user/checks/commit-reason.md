---
summary: "reads: commit message · staged set · fires at: commit"
---

# `commitReason`

Makes an act legal when the commit message explains it — the classic being “adding a dependency is fine, adding it silently is not”. The reason lands in git history, where the next reviewer reads it. It reads the message, so it runs in git's commit-message hook, for a commit a person makes as well as an agent's.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `token` | string | yes | the word that must start a line of the message, followed by a colon, when the reason is due: `new-dep: zod`. Spaces or tabs may come before the token and before the colon. The match ignores case, so `NEW-DEP: zod` also counts |
| `whenChanged` | list of globs | no | staged files matching these make the token due |
| `whenAdded` | list of globs | no | staged files the last commit does not have, matching these, make it due |
| `except` | list of globs | no | files matching these never make the token due through `whenChanged` or `whenAdded`. A name `diffAdds` finds is still due, even in a file `except` matches |
| `diffAdds` | list of `{ file, patterns, known? }` | no | the third condition, and the only one not about paths: names this commit ADDED *inside* one named file. `patterns` are regexes with one capture group each — the name; `known` lists the names already there, which are matched and ignored. |

All three conditions report in ONE sentence, each hit marked with why it asked — `(changed)`, `(new)`, `(added in <file>)`. A binding that names `diffAdds` reads the staged diff of each named file, which is why the second example below answers one command in its `world`.

## Example — a path condition

```
newDependency: guardrail()
  .at(commit)
  .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
  .message("Adding a dependency is fine; adding it silently is not — put `new-dep: <name> — <why>` in the message.")
  .test({
    pass:  [{ message: "feat: x\n\nnew-dep: zod — checked ajv", staged: ["package.json"] }],
    block: [{ message: "feat: x", staged: ["package.json"] }],
  }),
```

## Example — the diff-adds condition

A RATCHET on a dispatch surface. “Did this file change” is the wrong question — every commit changes it — and the right one is “what did this commit add inside it”. Names already on the surface go in `known`, so a refactor that moves one is silent and only growth owes a sentence.

```
newVerbNeedsCaller: guardrail()
  .at(commit)
  .check(commitReason({
    diffAdds: [{
      file: "flow.ts",
      patterns: ['case\\s+"([a-z][a-z-]*)"\\s*:'],
      known: ["test", "hook", "commit", "init", "status", "replay", "facts"],
    }],
    token: "caller",
  }))
  .message("Adding a verb must name its caller — put `caller: <who> — <why>` on a line of its own.")
  .test({
    pass: [{ message: "feat: explain\n\ncaller: human — no verb answers it", staged: ["flow.ts"], world: { exec: {
      "diff --cached -- 'flow.ts'": { stdout: '+    case "explain":' },
    } } }],
    block: [{ message: "feat: explain", staged: ["flow.ts"], world: { exec: {
      "diff --cached -- 'flow.ts'": { stdout: '+    case "explain":' },
    } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
