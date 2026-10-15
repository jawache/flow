# How to install flow

docs/user/how-to · a global install or a dev dependency, then `flow init` · 2026-10-15

This guide shows you how to install flow and wire it into a repo. flow needs **Node 24 or later**.

## Install it

Pick one of the two installs.

- **If the repo has a `package.json`**, install flow as a dev dependency and run it with `npx`:

  ```
  npm i -D @jawache/flow
  npx flow init
  ```

  The version is then pinned in that repo's lockfile. `flow init` writes no `node_modules/@jawache/flow` link, because the repo installs the package itself.

- **If the repo has no `package.json`**, or you want one `flow` for every repo, install it globally:

  ```
  npm i -g @jawache/flow   # once per machine; or `npm i -D @jawache/flow` and `npx flow`, per repo
  ```

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

- **If you want an empty config**, run `flow init --empty`. It writes the same wiring with a config that binds no packs.
- **If you already have a config or a hook**, run `flow init` anyway. It never writes over a file that exists, and adds only what is missing.
- **If you cloned a repo that already uses flow**, run `flow init` in the clone. `core.hooksPath` is a setting of one clone, so each clone needs it.
- **If you want to work on flow itself**, clone it and run `just install`, then `just link`. That puts your checkout on your `PATH` in place of the install.

## Uninstall

- **A global install:** `npm uninstall -g @jawache/flow`.
- **A dev dependency:** `npm uninstall @jawache/flow`, in the repo.

---

[Index](../index.md) · a first run, step by step: [Getting started](../tutorials/getting-started.md) · every command and what `flow init` writes: [the command reference](../reference/cli.md)
