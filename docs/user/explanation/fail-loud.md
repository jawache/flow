---
summary: "about a config that will not load: why flow lets work through and reports the fault on every call, and why the commit gate stays shut"
---

# Fail loud

If `flow.config.ts` will not load, flow turns every guardrail and breadcrumb off and reports the load error on every call. The commit gate refuses every commit until the config loads again.

## What happens while the config will not load

| Moment | What flow does |
| --- | --- |
| **Session start** | Shows the load error in place of the breadcrumbs. |
| **Write, delete, command** | Lets the call through, and passes the load error to the agent with it. |
| **Turn-end** | Reports the load error, and the turn ends. |
| **Commit** | Refuses the commit, with the load error. |
| **`flow status`** | Prints the load error, and exits 2. |

So the agent can repair the config the way it does any other work: with the edit tools, or with a command. In a fresh clone that has no `node_modules` yet, `npm ci` runs.

You see the fault in three places. Delete a `.message(…)` from an entry and save:

- **Your editor** marks the line in red, because the config is TypeScript. This needs the editor to resolve `@jawache/flow`'s types.
- **The next write or command in a session** carries the load error to the agent.
- **`flow status`** prints the fault and names the entry. The first line names the version of flow that is running:

```
flow 0.2.3 — the config will not load, so every guardrail and breadcrumb here is OFF.
  …
  ✗ missing-mandatory: `demo.noMarkedFiles` never said .message(…). Nothing in this grammar defaults — an absent key is absent, not a fallback.
1 red line — flow is NOT fully in force here.
```

## Why flow reports instead of refusing

A guard must never be off without anyone reading that it is off. A config that will not load is the one failure where flow still runs. flow has the load error, and it passes it to the agent on every call, so the agent reads that the guard is off, and why, at the moment it acts.

Refusing every call as well costs more than it buys:

- **It refuses the repair.** The fix for a missing package is a command such as `npm ci`, and a guard that refuses every command refuses that one too.
- **Writes reach the commit gate anyway.** Once the config loads, the commit gate checks the staged files against every guardrail. A write made while flow was off is checked before it reaches a commit.

## What is off while the config will not load

Every guardrail is off until the config loads again. Two kinds are rules a later commit cannot check:

- **Guardrails on commands.** The git pack's refusal of `git reset --hard` and `git clean -f` is one. While the config will not load, those commands run.
- **The rule that protects flow's own files.** The flow pack's [`flow.noDeleteGuardrails`](../packs/flow.md#flownodeleteguardrails--guardrail) refuses a command that deletes `flow.config.ts`, a pack it imports, or `.githooks/pre-commit`, the script git runs as the commit gate. While the config will not load, that command runs, and a commit made after it is not checked. Once the config loads, `flow status` reports a missing commit gate as a red line.

The agent can put flow in this state itself. Deleting one `.message(…)` from the config is an ordinary edit, and the config then does not load.

The window lasts until the config loads again. The agent has the load error on every call, so it can fix the config straight away, or hand back to you.

## The commit gate stays shut

A commit turns work in the tree into history. The commit gate refuses every commit while the config will not load, so nothing reaches a commit until every guardrail has checked it.

## When flow cannot report

flow reports a fault only while it runs. Two failures stop it from running at all:

- **The hooks are not registered** in Claude Code's settings. Nothing calls flow.
- **`flow` is not on your `PATH`.** Claude Code runs the call and shows the hook's error to you, not to the agent. git refuses the commit with `flow: not found`.

Run `flow status` to check for both:

- **Its `hooks` line is red** when the settings file does not call flow for every hook.
- **Your shell prints `command not found`** when `flow` is not on your `PATH`.

---

[Index](../index.md) · every refusal code: [what the loader refuses](../reference/config.md#what-the-loader-refuses) · the report: [`flow status`](../reference/cli.md) · the model: [how flow works](./how-flow-works.md)
