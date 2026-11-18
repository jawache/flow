---
summary: "reads: commit message · fires at: commit"
---

# `commitMessage`

Holds the commit message to a format, and bans text in it. It reads the message as git records it. A message typed in an editor, passed with `-m` or read from a file is judged the same way.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `header` | regex | no | the first line of the message must match it |
| `ban` | list of regex | no | any line of the message matching any of them blocks. Case-sensitive |

At least one of the two is required. A refusal names the header as written, or the banned line.

## Example: a header format

```
conventionalHeader: guardrail()
  .at(commit)
  .check(commitMessage({ header: "^(feat|fix|docs|refactor|test|chore)(\\([a-z0-9-]+\\))?!?: .+" }))
  .message("The first line is `type(scope): description`, such as `fix(parse): read a quoted heredoc`.")
  .test({ pass: [{ message: "fix(parse): read a quoted heredoc" }], block: [{ message: "wip" }] }),
```

## Example: banned text

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

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md) · a reason the message owes: [`commitReason`](./commit-reason.md)
