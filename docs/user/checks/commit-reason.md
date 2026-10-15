---
summary: "reads: command line · fires at: command"
---

# `commitReason`

Makes an act legal when the commit message explains it — the classic being “adding a dependency is fine, adding it silently is not”. The reason lands in git history, where the next reviewer reads it. It fires at `command`, not `commit`: git runs the pre-commit gate before the message exists, so the only place a message can be read is the typed command — which also means it polices agent-typed commits only.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `token` | string | yes | the word that must start a line of the message, followed by a colon, when the reason is due: `new-dep: zod`. Spaces or tabs may come before the token and before the colon. The match ignores case, so `NEW-DEP: zod` also counts |
| `whenChanged` | list of globs | no | changed files matching these make the token due. The changed files are what `git diff HEAD --name-only` lists plus every untracked file, so an unstaged edit counts as well as a staged one |
| `whenAdded` | list of globs | no | ADDED files (not edits) matching these make it due |
| `except` | list of globs | no | files matching these never make the token due through `whenChanged` or `whenAdded`. A name `diffAdds` finds is still due, even in a file `except` matches |
| `diffAdds` | list of `{ file, patterns, known? }` | no | the third condition, and the only one not about paths: names this commit ADDED *inside* one named file. `patterns` are regexes with one capture group each — the name; `known` lists the names already there, which are matched and ignored. |

All three conditions report in ONE sentence, each hit marked with why it asked — `(changed)`, `(new)`, `(added in <file>)`. A binding that names only `diffAdds` reads one diff and asks git nothing else, which is why the second example below records one command where the first records three.

## Example — a path condition

```
newDependency: guardrail()
  .at(command)
  .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
  .message("Adding a dependency is fine; adding it silently is not — put `new-dep: <name> — <why>` in the message.")
  .test({
    pass: [{ command: "git commit -m 'feat: x\n\nnew-dep: zod — checked ajv'", world: { exec: {
      "git diff HEAD --name-only": { stdout: "package.json" },
      "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
      "git ls-files --others --exclude-standard": { stdout: "" },
    } } }],
    block: [{ command: 'git commit -m "feat: x"', world: { exec: {
      "git diff HEAD --name-only": { stdout: "package.json" },
      "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
      "git ls-files --others --exclude-standard": { stdout: "" },
    } } }],
  }),
```

## Example — the diff-adds condition

A RATCHET on a dispatch surface. “Did this file change” is the wrong question — every commit changes it — and the right one is “what did this commit add inside it”. Names already on the surface go in `known`, so a refactor that moves one is silent and only growth owes a sentence.

```
newVerbNeedsCaller: guardrail()
  .at(command)
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
    pass: [{ command: "git commit -m 'feat: explain\n\ncaller: human — no verb answers it'", world: { exec: {
      "diff HEAD -- 'flow.ts'": { stdout: '+    case "explain":' },
    } } }],
    block: [{ command: 'git commit -m "feat: explain"', world: { exec: {
      "diff HEAD -- 'flow.ts'": { stdout: '+    case "explain":' },
    } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
