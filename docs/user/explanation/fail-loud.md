# Fail loud, and the one repair exception

docs/user/explanation · about a config that will not load: why every gated moment refuses, and why repairing it is still allowed · 2026-10-15

If `flow.config.ts` will not load, every gated moment refuses, loudly, until you fix it.

## Why flow refuses instead of passing

A guard that fails open lies about being there. If a broken config let every action through, nobody would notice that the guard had stopped, because nothing would be refused. So a broken config refuses every write, command and commit, and says why.

You see the fault in three places. Delete a `.message(…)` from an entry and save:

- **Your editor** marks the line in red, because the config is TypeScript.
- **The next write or command in a session** is refused, with the load error on screen.
- **`flow status`** prints the fault and names the entry:

```
flow 0.0.1 — the config will not load, so every guardrail and breadcrumb here is OFF.
  …
  ✗ missing-mandatory: `demo.noMarkedFiles` never said .message(…). Nothing in this grammar defaults — an absent key is absent, not a fallback.
1 red line — flow is NOT fully in force here.
```

## The one exception: the repair

While the config is broken, a write to `flow.config.ts` still goes through. So does a write to a pack it imports, whatever you called that folder.

Without the exception, the rule that demands a fix would also forbid it. An agent or the commit gate, anything with a hook in front of it, would be locked out of its own repair.

flow works out which files count as the repair by reading the config's relative import lines as text. It cannot load the module to find them, because the module is the thing that will not load.

The exception covers writes and nothing else:

- **Commands** stay refused.
- **The commit gate** stays refused.

So nothing written under the exception reaches a commit until the config loads green again.

---

[Index](../index.md) · every refusal code: [what the loader refuses](../reference/config.md#what-the-loader-refuses) · the report: [`flow status`](../reference/cli.md) · the model: [how flow works](./how-flow-works.md)
