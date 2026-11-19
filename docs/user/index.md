---
summary: "flow's human-facing docs"
---

# flow — user documentation

**flow** guards a repo that coding agents work in. Your whole guard is one TypeScript file, `flow.config.ts`, and these pages are how to write it. Every example on these pages is run against the shipped binary.

Each page is one of four kinds: a lesson, a guide to one task, a description to look things up in, or an explanation of why.

## Learn it

For you if you are new to flow: one lesson, from an unguarded repo to a refused commit.

- [Getting started](./tutorials/getting-started.md): guard a repo, watch a commit and a command refused and a [breadcrumb](./reference/glossary.md#breadcrumb) shown, and run every rule's own cases, in about ten minutes.

## Get something done

For you if flow already runs and you have one task to finish: each guide gives the steps to one result.

- [How to install and pin flow in a project](./how-to/install-flow.md)
- [How to upgrade flow in a project](./how-to/upgrade-flow.md)
- [How to gate a commit on a tool](./how-to/gate-a-commit-on-a-tool.md)
- [How to check file content at commit](./how-to/check-file-content-at-commit.md)
- [How to make files change together](./how-to/change-files-together.md)
- [How to check the commit message](./how-to/check-the-commit-message.md)
- [How to check that doc links in code still resolve](./how-to/check-doc-links.md)
- [How to block or redirect a command](./how-to/block-a-command.md)
- [How to steer with a breadcrumb](./how-to/steer-with-a-breadcrumb.md)
- [How to bind a rule to a type of agent](./how-to/bind-a-rule-to-a-type-of-agent.md)
- [How to test your rules](./how-to/test-your-rules.md)
- [How to write your own check, and share rules as a pack](./how-to/write-your-own-check.md)

### Upgrading flow

[The migration guides](./migrations/index.md) have one page per release: what a repo that uses flow must change to upgrade to that version, as steps an agent can follow.

## Look something up

For you when you need an exact command, verb, [moment](./reference/glossary.md#moment) or field: each page describes one part of flow.

- [The flow command](./reference/cli.md): every `flow` command, what `flow init` writes and `flow uninstall` removes, what `flow status` reports, the one [pack](./reference/glossary.md#pack) flow ships, the two switch files and the exit codes.
- [The config](./reference/config.md): `flow.config.ts`, its settings, every verb of a [guardrail](./reference/glossary.md#guardrail) and a breadcrumb, cases, categories, and what the loader refuses.
- [Moments](./reference/moments.md): the five moments a rule runs at, exactly when each one happens, and which take a guardrail or a breadcrumb.
- [What a check is given](./reference/ctx.md): the contract a check is written to, and every field of `ctx` at each moment.
- [The command parse](./reference/parse.md): how a shell line becomes a list of commands, what each holds, and everything the parse follows.
- [flow under Claude Code](./reference/claude-code.md): the hooks, the payload fields, how an agent's type is learned, and the transcript.
- [flow under Codex](./reference/codex.md): the same for Codex, with its two [trust gates](./reference/glossary.md#trust-gate).
- [The session log](./reference/log.md): the log flow writes for each session, and every field of each kind of row.
- [Glossary](./reference/glossary.md): every term these pages use.

### The stock checks — one page each

flow ships fifteen configured checks. You import one and pass it to `.check(…)`. Each page lists its options and a real example.

| Check | Reads | Checks |
| --- | --- | --- |
| [`textBan`](./checks/text-ban.md) | file body | banned regexes, per line, in any text |
| [`astGrep`](./checks/ast-grep.md) | file body | a structural code pattern (never a string or a comment) |
| [`jsonInvariant`](./checks/json-invariant.md) | file body | assertions over a JSON file's values |
| [`symbolsInSibling`](./checks/symbols-in-sibling.md) | file body | exported symbols are referenced in the sibling test |
| [`banCommands`](./checks/ban-commands.md) | command line | banned shell commands, before they run |
| [`commitMessage`](./checks/commit-message.md) | commit message | a header format, and banned text |
| [`commitReason`](./checks/commit-reason.md) | commit message · staged set | this commit needs a reason recorded in its message |
| [`docLinks`](./checks/doc-links.md) | file body | every docs page and section the file cites exists |
| [`protectedPath`](./checks/protected-path.md) | staged set · deleted paths | paths a commit must not change or delete (or are append-only) |
| [`siblingExists`](./checks/sibling-exists.md) | file path | a file's required companion exists |
| [`canonicalFiles`](./checks/canonical-files.md) | file path | only approved names in a folder |
| [`changeTogether`](./checks/change-together.md) | staged set | files that must change in the same commit |
| [`execPasses`](./checks/exec-passes.md) | runs a tool | runs any whole-project tool, and blocks on a non-zero exit |
| [`depcruise`](./checks/depcruise.md) | runs a tool | import fences over the real dependency graph |
| [`ranSinceEdit`](./checks/ran-since-edit.md) | the turn | “you changed X this turn but never ran Y”, at turn-end |

## Understand it

For you when you want to know why flow is built the way it is.

- [How flow works](./explanation/how-flow-works.md): the two kinds of guidance, the five moments, why content is judged at the commit, where a rule goes, and why one file is the whole guard.
- [What flow reads](./explanation/what-flow-reads.md): what flow reads at a commit, at a command and after a tool call, and what it cannot read.
- [Rules bound to who, not what](./explanation/rules-bound-to-who.md): categories, and why they read evidence the [harness](./reference/glossary.md#harness) wrote.
- [Fail loud](./explanation/fail-loud.md): why a config that will not load turns flow off and reports it on every call, and why every commit is refused until it loads.

## Not here

- What flow is and why you would use it: the repo's [README](../../README.md).
- The research and the numbered decisions behind flow: [docs/agent](https://github.com/jawache/flow/blob/main/docs/agent/README.md).
