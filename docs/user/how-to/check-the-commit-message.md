---
summary: "hold the commit message to a header format, ban text in it, or require a reason line, with `commitMessage` and `commitReason`"
---

# How to check the commit message

This guide shows you how to refuse a commit because of its message. flow reads the message from git, in git's commit-message hook, so a message is judged however it was given: with `-m`, from a file, or in an editor.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `commitMessage` or `commitReason` to the import.

2. Add the entry for your case, from the sections below.

3. Run `flow test`.

## A header format

```
conventionalHeader: guardrail()
  .at(commit)
  .check(commitMessage({ header: "^(feat|fix|docs|refactor|test|chore)(\\([a-z0-9-]+\\))?!?: .+" }))
  .message("The first line is `type(scope): description`, such as `fix(parse): read a quoted heredoc`.")
  .test({ pass: [{ message: "fix(parse): read a quoted heredoc" }], block: [{ message: "wip" }] }),
```

## Banned text

```
noAttribution: guardrail()
  .at(commit)
  .check(commitMessage({ ban: ["^Co-Authored-By:", "Generated with"] }))
  .message("Commits here carry no tool attribution. Take the line out and commit again.")
  .test({
    pass:  [{ message: "fix: x" }],
    block: [{ message: "fix: x\n\nCo-Authored-By: A Tool <tool@example.com>" }],
  }),
```

## A reason line the commit owes

`commitReason` makes a change legal when the message explains it. `whenChanged` lists the staged files that need a reason. `token` is the word that must start a line of its own in the message, followed by a colon. The match ignores case:

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

A merge commit's message is not judged. Git writes it.

---

[Index](../index.md) · every option: [`commitMessage`](../checks/commit-message.md) · [`commitReason`](../checks/commit-reason.md) · which commits are judged: [the commit moment](../reference/moments.md#the-commit-moment)
