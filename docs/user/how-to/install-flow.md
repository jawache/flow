---
summary: "install flow from GitHub at a tag, set it up in a repo with `flow init`, and remove it with `flow uninstall`"
---

# How to install and pin flow in a project

This guide shows you how to install flow in one project at a fixed version, set it up, and remove it. flow needs **Node 24 or later**, npm and git.

Each project has its own copy of flow, its own config and its own hooks. Nothing is installed for the whole machine.

## Install flow

1. Install flow as a dev dependency, from GitHub, at a release tag:

   ```
   cd my-repo
   npm i -D --allow-git=root github:jawache/flow#v0.4.0
   ```

   The tag holds flow's built files, so nothing is built on your machine. The lockfile records the exact commit, and every clone runs that commit after `npm install`. npm 12 installs a git dependency only when told to, and `--allow-git=root` allows it only for a package the project's own `package.json` names.

2. Check the install. It prints the version of the tag:

   ```
   npx flow --version
   ```

Type each `flow` command in this guide as `npx flow`.

**If the project is not a Node project,** give it a `package.json` that exists only for flow, then install as above:

```
npm init -y
npm pkg set private=true
```

Add `node_modules/` to `.gitignore`.

## Set it up in the repo

1. Run `flow init`:

   ```
   npx flow init
   ```

   It prompts for the harnesses that run agents in the repo, with the ones it detects already selected. It warns you about what it finds, such as hooks git already runs. Then it writes `flow.config.ts`, the git hook, `.githooks/commit-msg`, and `.flow/`, and registers flow's hooks for each [harness](../reference/glossary.md#harness) you chose: Claude Code in `.claude/settings.json`, Codex in `.codex/hooks.json`. Each prompt is listed in [the command reference](../reference/cli.md#what-flow-init-prompts-for).

2. If you chose Codex, do the two steps `flow init` names: trust the folder in Codex, and approve the hooks with `/hooks`. Until both are done, Codex runs no hook. See [the two trust gates](../reference/codex.md#the-two-trust-gates).

3. Check the guard:

   ```
   npx flow status      # is the guard working here? what is bound, and what is not wired yet
   npx flow test        # do your rules do what they claim? the cases of your own packs, run
   ```

   A red line in `flow status` names its own fix. The command then exits non-zero, so a setup script can read the exit code.

4. Commit `package.json`, the lockfile, `flow.config.ts`, the [packs](../reference/glossary.md#pack) it imports, `.githooks/`, and the registration file of each harness you chose: `.claude/settings.json`, `.codex/hooks.json`.

## Variants

- **If a script or an agent runs `flow init`**, it prompts for nothing and registers the harnesses it detects. Name them with `--harness claude-code,codex` to be exact.
- **If you want an empty config**, run `npx flow init --empty`. It writes the same files with a config that binds no pack.
- **If you already have a config or a git hook**, run `flow init` anyway. It never writes over `flow.config.ts` or a hook in `.githooks/`, and adds only what is missing.
- **If git already runs other hooks**, such as husky's, `flow init` leaves them alone and prints `FLOW IS NOT INSTALLED`, with the lines to add to your own hooks. [When git already runs other hooks](../reference/cli.md#when-git-already-runs-other-hooks) has the steps.
- **If you cloned a repo that already uses flow**, run `npm install`, then `npx flow init`. `core.hooksPath` is a setting of one clone, so each clone needs it.
- **If you add a git worktree**, run `npm ci` in it. The hooks run the worktree's own copy of flow.
- **If a machine was set up by flow 0.3**, follow [the 0.4 migration guide](../migrations/0.4.0.md) to remove the machine-wide install.
- **If you want flow off in one repo for a while**, create `.flow/off`. Every rule in that repo is off until you delete it.

## Uninstall

Run `flow uninstall` before you remove the package. Removing the package alone leaves the hooks in place, and they then fail with `flow: not found`.

> [!IMPORTANT]
> Run `flow uninstall` in your own terminal. The `flow` pack refuses it when an agent runs it, because it removes the guard.

1. Remove what `flow init` wrote:

   ```
   npx flow uninstall
   ```

   It removes the git hook, `core.hooksPath`, `.flow/` and flow's hooks in `.claude/settings.json` and `.codex/hooks.json`. It leaves `flow.config.ts` and the packs it imports. Each removal is listed in [the command reference](../reference/cli.md#what-flow-uninstall-removes).

2. Remove the package, with the command `flow uninstall` prints as its last line:

   ```
   npm uninstall @jawache/flow
   ```

3. If you no longer want them, delete `flow.config.ts` and the packs it imports, and commit.

---

[Index](../index.md) · a first run, step by step: [Getting started](../tutorials/getting-started.md) · a newer version: [how to upgrade flow](./upgrade-flow.md) · every command: [the command reference](../reference/cli.md)
