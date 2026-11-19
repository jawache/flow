---
name: release
description: Use when releasing a new version of flow — on "cut a release", "release flow", "tag 0.x.y", "write the migration guide", when `just release` refuses because a version has no migration guide, or when the house pack refuses a commit for the same reason. Covers the migration guide, the pre-release checks, the local release commit and the tag that holds the built files, and the push the human types. flow is not published to npm.
---

# Releasing flow

A release is six steps, in order. You do the first four in this session. The human types the push in their own terminal, and you verify the result. A release is a git tag on GitHub that holds flow's built files. Nothing is published to npm.

| Step | What | Who |
| --- | --- | --- |
| 1 | Find the version `just release-dry` computes | you |
| 2 | Write the migration guide for that version | you |
| 3 | Run `just release-check` and read the file list | you |
| 4 | Date the guide's index row, then `just release` | you |
| 5 | Push the branch and the tag | the human |
| 6 | Confirm the tag installs and runs | you |

## What a release is

- **The version is computed, never chosen.** commit-and-tag-version reads the Conventional Commit headers since the last `v*` tag. Config is in `.versionrc.mjs`. Below 1.0.0 every bump is demoted one level: a `BREAKING CHANGE` is a minor, a `feat` is a patch, a `fix` is a patch.
- **You must not hand-edit** the `version` field in `package.json` or `package-lock.json`, or `CHANGELOG.md`. This repo's rules refuse the commit.
- **`just release` is local, and makes two commits.** The first is `chore(release): x.y.z` on the branch: the version and the changelog. The second holds the built files, `dist/`, with the first as its parent. The tag `vx.y.z` points at the second, and the branch stays at the first. So `main` never holds built files, and the tag always does. It pushes nothing.
- **The tagged `package.json` has no build script:** no `prepare`, `prepack`, `build`, `install` or `postinstall`. npm builds a git dependency that has one, and installs an empty package when scripts are off.
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

This runs the full gate, the commit suite and a minified production build. Then it makes the release's two commits and its tag in a throwaway clone. It installs flow from that tag into a scratch folder with `npm i -D --ignore-scripts`, and runs the installed `dist/flow.mjs --version`. It pushes nothing, and leaves this repo as it was.

- **Read the file list** at the end. It is exactly what a project gets in `node_modules/@jawache/flow`. `files` in `package.json` is the allowlist. A file missing from the list, or one that must not ship, is a fix to `files` before the release.
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

The recipe checks the guide exists, runs the gate, runs commit-and-tag-version, then builds for release and makes the commit that holds `dist/`. Confirm what it made:

```sh
git log -1 --format='%h %s'                  # chore(release): <version>
git log -1 --format='%h %s' v<version>       # the commit that holds dist/
git rev-parse v<version>^                    # the release commit above
git ls-tree -r --name-only v<version> dist | head -3
git status                                   # clean
```

## 5 · Hand the push to the human

Stop here, and write the commands for the human to type, in a terminal of their own:

```sh
git push origin HEAD
git push origin v<version>
```

- **The tag is pushed by name.** It points at a commit the branch does not have, so `--follow-tags` does not send it.
- **The push is the human's unless they say otherwise.** A pushed tag is what every project pins. A tag that projects have installed is never moved: a mistake is fixed by the next version.

## 6 · Verify

```sh
git ls-remote --tags origin v<version>       # one line
```

Then install the tag as a project does, in a scratch folder, with scripts off:

```sh
npm init -y && npm i -D --ignore-scripts github:jawache/flow#v<version>
node node_modules/@jawache/flow/dist/flow.mjs --version      # <version>
```

The release is done when the tag is on the remote and the installed flow prints the new version. Then say so, with the version and the install line a project runs.

## When something refuses

| What you read | What it means | What to do |
| --- | --- | --- |
| `release-guide: <version> has no migration guide` | Step 2 is not done | Write the guide, and its index row |
| The gate refuses with `releaseHasMigrationGuide` | `package.json` names a version with no guide | Write the guide for that version |
| The gate refuses inside `just release`, after `package.json` and `CHANGELOG.md` are stamped | commit-and-tag-version has no rollback | `git stash push -m release-stamp` the stamped files, fix the cause, drop that entry by its label, run `just release` again |
| The installed flow prints nothing, or `dist/flow.mjs` is missing | The tag points at the release commit, not the commit that holds `dist/` | Tell the human. The fix is the next version, cut with `just release` |

You must not pass `--no-verify` to any commit, and you must not publish flow to npm.
