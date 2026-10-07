# Upgrading flow — migration guides

docs/user/migrations · one page per release · 2026-10-07

Each page lists what a repo that uses flow must change to upgrade to one version from the version before it. A repo that uses flow has a `flow.config.ts`, a `.githooks/pre-commit` written by `flow init`, and flow's hook registrations in the Claude Code settings file.

## Upgrade across several versions

Apply the pages one at a time, oldest first. For each page:

1. Install that page's version.
2. Make every change under **Required changes** whose **Applies if** check says yes.
3. Read **What now blocks or passes differently**.
4. Run the page's **Verify** steps, and fix what they report before you open the next page.

Find the version a repo has now with `npm ls @jawache/flow`, or `flow --version` for a global install.

To give the upgrade to an agent working in that repo, use this instruction, with the two versions filled in:

```
Upgrade @jawache/flow in this repo from <current> to <target>. Read the migration guides
index at <path to this folder>/index.md, then apply every guide after <current> up to and
including <target>, one at a time, oldest first, following the steps that index lists.
Stop and report if a Verify step fails.
```

## The guides

| Version | Released | Upgrades from | Changes needed |
| --- | --- | --- | --- |
| [0.2.2](./0.2.2.md) | unreleased | 0.2.1 | Edit `.githooks/pre-commit`, and any other command that runs `flow commit` |
| [0.2.1](./0.2.1.md) | 2026-10-02 | 0.2.0 | None |
| [0.2.0](./0.2.0.md) | 2026-10-01 | 0.1.2 | Re-run `flow init`. Remove `override(docs.noMarkdownInUserDocs)`. Check `banCommands` rules about heredoc text |
| [0.1.2](./0.1.2.md) | 2026-09-16 | 0.1.1 | Only for a repo with its own `depcruise` rule whose layers are written as regexes |
| [0.1.1](./0.1.1.md) | 2026-09-16 | 0.1.0 | None |
| [0.1.0](./0.1.0.md) | 2026-09-15 | a checkout linked with `npm link` | Install from npm. Rename the `guard` pack to `flow`. Replace removed checks and entries |

The full list of changes in each release is in [CHANGELOG.md](../../../CHANGELOG.md).
