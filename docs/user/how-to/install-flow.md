---
summary: "put `flow` on your PATH, wire it into a repo with `flow init`, and remove it again"
---

# How to install flow

This guide shows you how to install flow, wire it into a repo, and remove it. flow needs **Node 24 or later**.

> [!IMPORTANT]
> Git and Claude Code call `flow` by name: the commit gate runs `exec flow hook commit`, and each Claude Code hook runs `flow hook <event>`. `flow` must be on the `PATH` they use. If it is not, every commit is refused with `flow: not found`, and the session hooks check nothing.

## Put `flow` on your PATH

1. Install flow globally, once per machine:

   ```
   npm i -g @jawache/flow
   ```

2. Check that it is on your `PATH`:

   ```
   flow --version
   ```

   It prints the version you installed.

## Wire it into the repo

1. Go to the repo and run `flow init`:

   ```
   cd my-repo
   flow init            # writes flow.config.ts, .githooks/pre-commit, .flow/, and the hook registrations
   ```

   `flow init` writes a demo `flow.config.ts`, arms the commit gate, and registers flow's five hooks with Claude Code. Each file it writes is listed in [the command reference](../reference/cli.md).

2. Check the guard:

   ```
   flow status          # is the guard working here? what is bound, and what is not wired yet
   flow test            # do the rules do what they claim? every rule's own cases, driven
   ```

   `flow status` lists every rule by moment, then checks every fitting: the config loads, the gate is armed, the hooks are registered. A red line names its own fix, and the command exits non-zero, so a setup script can call it and read the exit code.

3. Commit `flow.config.ts`, the packs it imports and `.githooks/pre-commit`.

## Variants

- **If you want the repo to pin its own version**, also install flow as a dev dependency: `npm i -D @jawache/flow`. The version is then recorded in the repo's lockfile, and `npx flow` runs that copy. Keep the global install as well: git and Claude Code still call the `flow` on your `PATH`, not the copy in `node_modules`. With a dev dependency, `flow init` writes no `node_modules/@jawache/flow` link, because the repo installs the package itself.
- **If you want an empty config**, run `flow init --empty`. It writes the same wiring with a config that binds no packs.
- **If you already have a config or a commit hook**, run `flow init` anyway. It never writes over `flow.config.ts` or `.githooks/pre-commit`, and adds only what is missing.
- **If `core.hooksPath` already points at another folder**, such as `.husky/_`, move those hooks into `.githooks/` first. `flow init` sets `core.hooksPath` to `.githooks`, and git then stops running the hooks in the old folder.
- **If you cloned a repo that already uses flow**, run `flow init` in the clone. `core.hooksPath` is a setting of one clone, so each clone needs it.
- **If you want to work on flow itself**, clone it and run `just install`, then `just link`. That puts your checkout on your `PATH` in place of the global install.
- **If you want flow off in one repo for a while**, create `.flow/off`. Every rule in that repo is off until you delete it.

## Uninstall

Uninstalling the package alone leaves the hooks in place, and they then fail with `flow: not found`. Remove the wiring first.

1. In each repo that uses flow, stop git calling the gate:

   ```
   git config --unset core.hooksPath
   rm .githooks/pre-commit
   ```

   If the repo kept other hooks in `.githooks/`, delete only `pre-commit`, and set `core.hooksPath` back to the folder those hooks need.

2. Delete `flow.config.ts`, the packs it imports and `.flow/` from the repo, if you no longer want them.

3. Open the Claude Code settings file: `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set. Under `hooks`, remove each entry whose command is `flow hook session-start`, `flow hook pre-tool-use`, `flow hook post-tool-use`, `flow hook post-tool-use-failure` or `flow hook stop`. This file applies to every repo on the machine, so do this only when no repo needs flow.

4. Remove the package:

   - **A global install:** `npm uninstall -g @jawache/flow`.
   - **A dev dependency:** `npm uninstall @jawache/flow`, in the repo.

---

[Index](../index.md) · a first run, step by step: [Getting started](../tutorials/getting-started.md) · every command and what `flow init` writes: [the command reference](../reference/cli.md)
