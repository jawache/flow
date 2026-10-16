---
name: release
description: Use when publishing a new version of flow to npm — on "cut a release", "release flow", "publish 0.x.y", "write the migration guide", when `just release` refuses because a version has no migration guide, or when the house pack refuses a commit for the same reason. Covers the migration guide, the pre-release checks, the local release commit and tag, and the push and `npm publish` the human types.
---

# Releasing flow

A release is six steps, in order. You do the first four in this session. The human types the push and the publish in their own terminal, and you verify the result.

| Step | What | Who |
| --- | --- | --- |
| 1 | Find the version `just release-dry` computes | you |
| 2 | Write the migration guide for that version | you |
| 3 | Run `just release-check` and read the tarball list | you |
| 4 | Date the guide's index row, then `just release` | you |
| 5 | `git push --follow-tags` and `npm publish` | the human |
| 6 | Confirm the registry serves the new version | you |

## What a release is

- **The version is computed, never chosen.** commit-and-tag-version reads the Conventional Commit headers since the last `v*` tag. Config is in `.versionrc.mjs`. Below 1.0.0 every bump is demoted one level: a `BREAKING CHANGE` is a minor, a `feat` is a patch, a `fix` is a patch.
- **You must not hand-edit** the `version` field in `package.json` or `package-lock.json`, or `CHANGELOG.md`. The `git` pack refuses the commit.
- **`just release` is local.** It makes one commit, `chore(release): x.y.z`, tagged `vx.y.z`. It pushes nothing and publishes nothing.
- **Two gates ask for the migration guide.** `just release` refuses to start without `docs/user/migrations/<version>.md`. The house pack refuses any commit whose `package.json` version has no guide.

## 1 · Find the version

Start on the branch the release is cut from, with a clean tree:

```sh
git status
just release-dry
```

The dry run prints the version and the changelog entry it would write. It writes no file.

- **Read the entry against what shipped.** A change the human expects to see and the entry omits has a commit whose header type hides it, such as `refactor` for a behaviour change. Tell the human before you go on. History is not rewritten to fix it.
- **Remember the previous version** from `git describe --tags --abbrev=0`. The guide names it.

## 2 · Write the migration guide

The guide is `docs/user/migrations/<version>.md`. Its fixed shape, and where to find what changed, are in [migration-guide.md](./migration-guide.md). Write it with `/work docs`.

1. Find what changed since the previous tag, by the four reads that file lists.
2. Write the page in its shape. Every step is one an agent in another repo can detect, apply and check without reading flow's source.
3. Add its row to the table in `docs/user/migrations/index.md`, with `unreleased` in the Released column.
4. Commit: `docs(migrations): the guide for upgrading to <version> from <previous>`.

> [!NOTE]
> When the guide already exists, written while the work was done, compare it with the commits made since its last change. A commit after it may have added a required change. `git log --format='%h %s' -- docs/user/migrations/<version>.md` gives when it was last written.

## 3 · Check

```sh
just release-check
```

This runs the full gate, the commit suite, a minified production build and `npm pack --dry-run`. It publishes nothing.

- **Read the tarball's file list** at the end. It is exactly what a stranger installs. `files` in `package.json` is the allowlist. A file missing from the list, or one that must not ship, is a fix to `files` before the release.
- **A red line** is fixed on the branch, committed, and the check run again.

## 4 · Cut the release

Set the date first, so the release commit carries it. In `docs/user/migrations/index.md`, change the new row's `unreleased` to today's date from `date +%F`, then commit:

```sh
git commit -m 'docs(migrations): <version> is released today'
```

Then cut it:

```sh
just release
```

The recipe checks the guide exists, runs the gate, then runs commit-and-tag-version. Confirm what it made:

```sh
git log -1 --format='%h %s'       # chore(release): <version>
git tag --points-at HEAD          # v<version>
git status                        # clean
```

## 5 · Hand the push and the publish to the human

Stop here, and write the commands for the human to type, in a terminal of their own:

```sh
git push --follow-tags origin HEAD
npm whoami          # the account that owns @jawache/flow
npm publish
```

- **The publish is always the human's.** npm's two-factor prompt needs a terminal. A publish run through a subprocess, an agent's shell or anything that captures output fails at the one-time-password step with `EOTP` and never reaches the browser.
- **The push is the human's unless they say otherwise.** The push shares the release commit and the tag. The tag on the remote is what the changelog links point at.
- **A package is unpublishable only for 72 hours.** Say so if the human hesitates over the file list.

## 6 · Verify

npm replies to the publish with `202 Accepted` before the registry serves the version. Ask the registry until it serves the new one:

```sh
npm view @jawache/flow version
```

- **The old version printed** in the first minute or two is the lag, not a failed publish. Run it again.
- **The tag is on the remote** when `git ls-remote --tags origin v<version>` prints one line.

The release is done when the registry prints the new version and the tag is on the remote. Then say so, with the version and the link `https://www.npmjs.com/package/@jawache/flow/v/<version>`.

## When something refuses

| What you read | What it means | What to do |
| --- | --- | --- |
| `release-guide: <version> has no migration guide` | Step 2 is not done | Write the guide, and its index row |
| The gate refuses with `releaseHasMigrationGuide` | `package.json` names a version with no guide | Write the guide for that version |
| The gate refuses inside `just release`, after `package.json` and `CHANGELOG.md` are stamped | commit-and-tag-version has no rollback | `git stash` the stamped files, fix the cause, `git stash drop`, run `just release` again |
| `just docs-packs-check` names a stale page | A pack changed and its page did not | `just docs-packs`, stage the pages, commit |
| `npm publish` fails with `E401` or `EOTP` | The terminal is not logged in, or is not a terminal | The human runs `npm login`, then publishes from a real terminal |
| `npm view` prints the old version after five minutes | The publish did not land | The human reads the publish's output; `npm publish` again is safe, the registry refuses a duplicate version |

You must not pass `--no-verify` to any commit, and you must not run `npm publish` yourself. The `git` pack refuses the first. The second fails at the one-time-password step, with the version stamped and nothing published.
