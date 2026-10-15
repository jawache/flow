---
summary: "about a config that will not load: why flow refuses instead of passing, and why repairing it is still allowed"
---

# Fail loud, and the one repair exception

If `flow.config.ts` will not load, flow refuses every write, command and commit, loudly, until you fix it.

## Why flow refuses instead of passing

A guard that fails open lies about being there. If a broken config let every action through, nobody would notice that the guard had stopped, because nothing would be refused. So a broken config refuses every write, command and commit, and says why.

Two moments are told rather than refused:

- **Turn-end** reports the fault, and the turn ends. Holding the turn open would stop the agent handing back to the person who can fix the config, and every risky action is already refused.
- **Breadcrumbs** are replaced by a notice of the fault.

You see the fault in three places. Delete a `.message(…)` from an entry and save:

- **Your editor** marks the line in red, because the config is TypeScript. This needs the editor to resolve `@jawache/flow`'s types.
- **The next write or command in a session** is refused, with the load error on screen.
- **`flow status`** prints the fault and names the entry. The first line names the version of flow that is running:

```
flow 0.2.3 — the config will not load, so every guardrail and breadcrumb here is OFF.
  …
  ✗ missing-mandatory: `demo.noMarkedFiles` never said .message(…). Nothing in this grammar defaults — an absent key is absent, not a fallback.
1 red line — flow is NOT fully in force here.
```

## The one exception: the repair

While the config is broken, a write to `flow.config.ts` still goes through. So does a write to a pack it imports, whatever you called that folder, and so does a delete of either.

Without the exception, the rule that demands a fix would also forbid it. An agent, or anything else with a hook in front of it, would be locked out of its own repair.

flow works out which files count as the repair by reading the config's relative import lines as text. It cannot load the module to find them, because the module is the thing that will not load.

The exception covers writes and deletes of those files, and nothing else:

- **Commands** stay refused, even one that would edit the config. A command line does not say which file it will change before it runs.
- **The commit gate** stays refused.

So nothing written under the exception reaches a commit until the config loads green again.

---

[Index](../index.md) · every refusal code: [what the loader refuses](../reference/config.md#what-the-loader-refuses) · the report: [`flow status`](../reference/cli.md) · the model: [how flow works](./how-flow-works.md)
