---
summary: "install flow as a dev dependency or globally, wire it into a repo with `flow init`, and remove it with `flow uninstall`"
---

# How to install flow

This guide shows you how to install flow, wire it into a repo, and remove it. flow needs **Node 24 or later**.

> [!IMPORTANT]
> Git and Claude Code run flow for you: the commit gate runs `flow hook commit`, and each Claude Code hook runs `flow hook <event>`. Each one runs the repo's own `@jawache/flow` package first, then the `flow` on the `PATH` that git and Claude Code use. If neither has it, every commit is refused with `flow: not found`, the session hooks check nothing, and `flow status` prints a red line.

## Install flow

Install flow in one of two ways:

- **As a dev dependency**, to guard one repo. The version is recorded in the repo's lockfile, and every clone runs that version after `npm install`:

  ```
  cd my-repo
  npm i -D @jawache/flow
  ```

- **Globally**, once per machine, to guard every repo you run `flow init` in:

  ```
  npm i -g @jawache/flow
  ```

If a repo has flow as a dev dependency and the machine also has it globally, git and Claude Code run the repo's copy.

Check the install. It prints the version you installed:

```
npx flow --version   # a dev dependency
flow --version       # a global install
```

With a dev dependency, type each `flow` command in this guide as `npx flow`.

## Wire it into the repo

1. Go to the repo and run `flow init`:

   ```
   cd my-repo
   flow init            # writes flow.config.ts, .githooks/pre-commit, .flow/, and the hook registrations
   ```

   `flow init` writes a demo `flow.config.ts`, arms the commit gate, and registers flow's five hooks with Claude Code. Each file it writes is listed in [the command reference](../reference/cli.md).

   Where the hooks are registered depends on the install:

   - **A dev dependency:** the repo's `.claude/settings.json`. The hooks run only in this repo.
   - **A global install:** `~/.claude/settings.json`. The hooks run in every repo on the machine.
   - **A dev dependency, on a machine an older flow set up:** `flow init` also rewrites flow's old commands in `~/.claude/settings.json` to the command in the repo's file. Claude Code then runs each hook once, not twice.

2. Check the guard:

   ```
   flow status          # is the guard working here? what is bound, and what is not wired yet
   flow test            # do the rules do what they claim? every rule's own cases, driven
   ```

   `flow status` lists every rule by moment, then checks every fitting: the config loads, the gate is armed, the hooks are registered, and the `flow` they run is found. A red line names its own fix, and the command exits non-zero, so a setup script can call it and read the exit code.

3. Commit `flow.config.ts`, the packs it imports and `.githooks/pre-commit`. With a dev dependency, also commit `.claude/settings.json`, `package.json` and the lockfile.

## Variants

- **If you want an empty config**, run `flow init --empty`. It writes the same wiring with a config that binds no packs.
- **If you already have a config or a commit hook**, run `flow init` anyway. It never writes over `flow.config.ts` or `.githooks/pre-commit`, and adds only what is missing.

  If your commit hook does not run flow, add these two lines to the end of it. The first runs the repo's own `@jawache/flow` when it has one, and the second runs the `flow` on the `PATH` otherwise:

  ```
  f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit
  exec flow hook commit
  ```

- **If `core.hooksPath` already points at another folder**, such as `.husky/_`, move those hooks into `.githooks/` first. `flow init` sets `core.hooksPath` to `.githooks`, and git then stops running the hooks in the old folder.
- **If you cloned a repo that already uses flow**, run `flow init` in the clone. `core.hooksPath` is a setting of one clone, so each clone needs it. If the repo has flow as a dev dependency, run `npm install` first.
- **If you want to work on flow itself**, clone it and run `just install`, then `just link`. That puts your checkout on your `PATH` in place of the global install.
- **If you want flow off in one repo for a while**, create `.flow/off`. Every rule in that repo is off until you delete it.

## Uninstall

Run `flow uninstall` before you remove the package. Uninstalling the package alone leaves the hooks in place, and they then fail with `flow: not found`. npm cannot clean up for you: npm 7 and later run no script when a package is uninstalled.

> [!IMPORTANT]
> Run `flow uninstall` in your own terminal. The flow pack refuses it when an agent runs it, because it removes the guard.

1. In each repo that uses flow, remove its wiring:

   ```
   flow uninstall
   ```

   It removes the commit gate, `core.hooksPath` and `.flow/`, and, for a dev dependency, flow's hooks in the repo's `.claude/settings.json`. It leaves `flow.config.ts` and the packs it imports, so `flow init` can put the guard back. It prints each thing it removed. Each one is listed in [the command reference](../reference/cli.md#what-flow-uninstall-removes).

2. If you installed flow globally, and no repo on the machine needs it any more, remove its hooks from the machine-wide settings file:

   ```
   flow uninstall --machine
   ```

   The machine-wide file is `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set. Every repo on the machine reads it, so every repo stops running flow's hooks.

3. Remove the package. `flow uninstall` prints this command as its last line:

   - **A dev dependency:** `npm uninstall @jawache/flow`, in the repo.
   - **A global install:** `npm uninstall -g @jawache/flow`.

4. If you no longer want them, delete `flow.config.ts` and the packs it imports, and commit.

### If flow is already gone

If you uninstalled the package first, `flow uninstall` is not there to run. Remove the wiring by hand:

1. In each repo that used flow, stop git calling the gate:

   ```
   git config --unset core.hooksPath
   rm .githooks/pre-commit
   ```

   If the repo kept other hooks in `.githooks/`, delete only `pre-commit`, and set `core.hooksPath` back to the folder those hooks need.

2. Open the Claude Code settings file that holds flow's hooks:

   - **A dev dependency:** the repo's `.claude/settings.json`.
   - **A global install:** `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set.

   Under `hooks`, remove each entry whose command ends with `flow hook session-start`, `flow hook pre-tool-use`, `flow hook post-tool-use`, `flow hook post-tool-use-failure` or `flow hook stop`.

---

[Index](../index.md) · a first run, step by step: [Getting started](../tutorials/getting-started.md) · every command and what `flow init` writes: [the command reference](../reference/cli.md)
