---
summary: "about a config that will not load: why flow lets work through and reports the fault on every call, and why every commit is refused"
---

# Fail loud

If `flow.config.ts` will not load, flow turns every [guardrail](../reference/glossary.md#guardrail) and [breadcrumb](../reference/glossary.md#breadcrumb) off and reports the load error on every call. Every commit is refused until the config loads again.

## What happens while the config will not load

| [Moment](../reference/glossary.md#moment) | What flow does |
| --- | --- |
| **Session start** | Shows the load error in place of the breadcrumbs. |
| **Command, file-change** | Lets the call through, and passes the load error to the agent with it. |
| **Turn-end** | Reports the load error, and the turn ends. |
| **Commit** | Refuses the commit, with the load error. |
| **`flow status`** | Prints the load error, and exits 2. |

So the agent can repair the config the way it does any other work: with the edit tools, or with a command. In a fresh clone that has no `node_modules` yet, `npm ci` runs.

You see the fault in three places. Delete a `.message(…)` from an entry and save:

- **Your editor** marks the line in red, because the config is TypeScript. This needs the editor to resolve `@jawache/flow`'s types.
- **The next command in a session** passes the load error to the agent.
- **`flow status`** prints the fault and names the entry. The first line names the version of flow that is running:

```
flow 0.4.0 — the config will not load, so every guardrail and breadcrumb here is OFF.
  …
  ✗ missing-mandatory: `house.noTodo` never said .message(…). Nothing in this grammar defaults — an absent key is absent, not a fallback.
1 red line — flow is NOT fully in force here.
```

## Why flow reports instead of refusing

A guard must never be off without anyone reading that it is off. A config that will not load is the one failure where flow still runs. flow has the load error, and it passes it to the agent on every call, so the agent reads that the guard is off, and why, at the moment it acts.

Refusing every call as well costs more than it buys:

- **It refuses the repair.** The fix for a missing package is a command such as `npm ci`, and a guard that refuses every command refuses that one too.
- **Content is judged at the commit.** Once the config loads, a commit judges the staged files against every content rule.

## What is off while the config will not load

Every guardrail is off until the config loads again. A later commit cannot judge a command that has already run. A rule that refuses a force-push is one example. While the config does not load, that command runs.

The agent can put flow in this state itself. Deleting one `.message(…)` from the config is an ordinary edit, and the config then does not load.

The window lasts until the config loads again. The agent has the load error on every call, so it can fix the config straight away, or hand back to you.

## Every commit is refused

A commit turns work in the tree into history. The git hook refuses every commit while the config does not load. So every commit is judged by every commit rule.

## When flow cannot report

flow reports a fault only while it runs. Two failures stop it from running at all:

- **The hooks are not registered** with the [harness](../reference/glossary.md#harness), or, under Codex, not trusted. Nothing calls flow. See [the two trust gates](../reference/codex.md#the-two-trust-gates).
- **The hooks cannot find `flow`.** The harness runs the call and shows the hook's error to you, not to the agent. git refuses the commit with `flow: not found`.

Run `flow status` to check for both:

- **A harness's line is red** when its file in the repo does not call flow for every hook.
- **Its `binary` line is red** when the hooks cannot find `flow`.

---

[Index](../index.md) · every refusal code: [what the loader refuses](../reference/config.md#what-the-loader-refuses) · the report: [`flow status`](../reference/cli.md) · the model: [how flow works](./how-flow-works.md)
