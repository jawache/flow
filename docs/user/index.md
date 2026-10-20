---
summary: "flow's human-facing docs"
---

# flow — user documentation

**flow** guards a repo that coding agents work in. Your whole guard is one TypeScript file, `flow.config.ts`, and these pages are how to write it. Every example on these pages is run against the shipped binary.

Each page is one of four kinds: a lesson, a guide to one task, a description to look things up in, or an explanation of why.
A troubleshooting page is a guide to one task that starts from what you see.

## Learn it

For you if you are new to flow: one lesson, from an unguarded repo to a refused commit.

- [Getting started](./tutorials/getting-started.md): guard a repo, watch a banned command and a commit refused, and run every rule's own cases, in about five minutes.

## Get something done

For you if flow already runs and you have one task to finish: each guide gives the steps to one result.

- [How to install flow](./how-to/install-flow.md)
- [How to ban a pattern in files](./how-to/ban-a-pattern-in-files.md)
- [How to block a command](./how-to/block-a-command.md)
- [How to protect files](./how-to/protect-files.md)
- [How to gate a commit on a tool](./how-to/gate-a-commit-on-a-tool.md)
- [How to make files change together](./how-to/change-files-together.md)
- [How to pin a value in a JSON file](./how-to/pin-a-value-in-a-json-file.md)
- [How to require a sibling test](./how-to/require-a-sibling-test.md)
- [How to require a reason in the commit message](./how-to/require-a-reason-in-the-commit-message.md)
- [How to let only some agents write](./how-to/let-only-some-agents-write.md)
- [How to steer without blocking](./how-to/steer-without-blocking.md)
- [How to test your rules](./how-to/test-your-rules.md)
- [How to write your own check](./how-to/write-your-own-check.md)
- [How to change or turn off one entry of a pack](./how-to/override-an-entry.md)
- [How to share a pack across repos](./how-to/share-a-pack.md)
- [How to document a pack](./how-to/document-a-pack.md)

### Upgrading flow

[The migration guides](./migrations/index.md) have one page per release: what a repo that uses flow must change to upgrade to that version, as steps an agent can follow.

## When something goes wrong

For you when flow stops the agent, refuses something you expected to pass, or says something is wrong: each page starts from what you see, says why, and gives the fix.

- [flow says it does not guard this worktree](./troubleshooting/flow-does-not-guard-this-worktree.md)

## Look something up

For you when you need an exact command, verb, moment or field: each page describes one part of flow.

- [The flow command](./reference/cli.md): every `flow` command, what `flow init` writes and `flow uninstall` removes, the two switch files and the exit codes.
- [The config](./reference/config.md): `flow.config.ts`, its settings, every verb of a guardrail and a breadcrumb, cases, categories, and what the loader refuses.
- [Moments](./reference/moments.md): the seven moments a rule runs at, and when each one happens.
- [The ctx a check reads](./reference/ctx.md): the contract a check is written to, and every field of `ctx` at each moment.
- [The session log](./reference/log.md): the log flow writes for each session, and every field of each kind of row.
- [Vocabulary](./reference/vocabulary.md): every term these pages use.

### The shipped packs — one page each

Ten packs arrive with the install, behind `@jawache/flow/packs`. A repo binds the ones it needs, one line each. Each page is generated from the pack itself: every entry, when it runs and over which files, the exact words an agent reads, the check's settings as written, and both sides of every case. Start at [the packs](./packs/index.md).

### The stock checks — one page each

flow ships fifteen configured checks. You import one and pass it to `.check(…)`. Each page lists its options and a real example.

| Check | Reads | Checks |
| --- | --- | --- |
| [`textBan`](./checks/text-ban.md) | file body | banned regexes, per line, in any text |
| [`astGrep`](./checks/ast-grep.md) | file body | a structural code pattern (never a string or a comment) |
| [`jsonInvariant`](./checks/json-invariant.md) | file body | assertions over a JSON file's values |
| [`symbolsInSibling`](./checks/symbols-in-sibling.md) | file body | exported symbols are referenced in the sibling test |
| [`banCommands`](./checks/ban-commands.md) | command line | banned shell commands, before they run |
| [`commitReason`](./checks/commit-reason.md) | command line | this commit needs a reason recorded in its message |
| [`substitutionInProse`](./checks/substitution-in-prose.md) | command line | a backtick the shell would run in a command that records prose |
| [`protectedPath`](./checks/protected-path.md) | file path | paths that must not be changed (or are append-only) |
| [`oneWriter`](./checks/one-writer.md) | the acting session's categories | only the listed categories may change a file; any other actor's write is refused, and one that already landed is put back |
| [`siblingExists`](./checks/sibling-exists.md) | file path | a file's required companion exists on disk |
| [`canonicalFiles`](./checks/canonical-files.md) | file path | only approved names in a folder |
| [`changeTogether`](./checks/change-together.md) | staged set | files that must change in the same commit |
| [`execPasses`](./checks/exec-passes.md) | runs a tool | runs any whole-project tool, and blocks on a non-zero exit |
| [`depcruise`](./checks/depcruise.md) | runs a tool | import fences over the real dependency graph |
| [`ranSinceEdit`](./checks/ran-since-edit.md) | the turn | “you changed X this turn but never ran Y”, at turn-end |

## Understand it

For you when you want to know why flow is built the way it is.

- [How flow works](./explanation/how-flow-works.md): the two kinds of guidance, why one file is the whole guard, packs and overrides, and the demo config read line by line.
- [Rules bound to who, not what](./explanation/rules-bound-to-who.md): categories, and why they read evidence the host wrote.
- [Fail loud](./explanation/fail-loud.md): why a config that will not load turns flow off and reports it on every call, and why every commit is refused until it loads.
- [What the guard sees](./explanation/what-the-guard-sees.md): how flow finds every change to the tree, and what a refusal puts back.

## Not here

- What flow is and why you would use it: the repo's [README](../../README.md).
- The research and the numbered decisions behind flow: [docs/agent](https://github.com/jawache/flow/blob/main/docs/agent/README.md).
