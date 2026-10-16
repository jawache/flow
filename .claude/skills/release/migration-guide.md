# Writing a migration guide

A migration guide is a how-to guide with a fixed shape. `docs/user/migrations/<version>.md` says what a repo that uses flow must change to upgrade to `<version>` from the release before it.

Write the page with `/work docs`: its layout and sentence rules apply here as on any page. This file adds only the shape and where to look. The release steps around it are in [SKILL.md](./SKILL.md).

## Who reads it

- **The reader** is usually an agent in another repo, pointed at the page and told to migrate.
- **Every step** must be one it can detect, apply and check without reading flow's source.

## Find what changed

1. Read `git log --format='%h %s%n%b' v<previous>..HEAD`.
2. Read the `BREAKING CHANGE` footers in that log.
3. Read `git diff v<previous> HEAD -- index.ts packs/index.ts flow.ts`.
4. Read `HOOK_REGISTRATIONS` and `PRE_COMMIT` in `adapter/domain.ts`, in the same diff.

Together these cover the grammar and pack exports, the CLI, the session hook registrations and the pre-commit hook.

A change belongs on the page when it changes something in the other repo:

- a config that no longer loads
- an import
- an entry id an `override` lists
- a pack parameter
- `.claude/settings.json`
- `.githooks/pre-commit`
- a rule that now blocks or passes differently

## The page, in this order

```
---
summary: "upgrade to <version> from <previous>"
---

# Upgrade to <version>

[All guides](./index.md)

<One paragraph: what this release changes for a repo that uses flow, and whether it needs any
change. "No changes needed" is a valid answer, and is stated here.>

## 1 · Install <version>
<The install commands, for a dev dependency and for a global install.>

## 2 · Required changes
### 2.1 · <What to change, imperative>
**Applies if:** <a command or grep the reader runs, and the output that means yes>
**Change:** <the exact before → after>
**Why:** <one sentence>

## 3 · What now blocks or passes differently
<Each behaviour change with no config change: what is refused or allowed now that was not,
and what to do if a commit or a tool call is now refused.>

## 4 · Optional
<New features worth adopting: one line each, with the snippet.>

## 5 · Verify
<`flow status` green, `flow test` all green, and the gate over the whole tree, using the
command spelling this version has.>
```

- **An empty section** says "None." rather than disappearing, so a reader knows it was checked.
- **A version range** is applied one guide at a time, oldest first. Say so only in the index.
