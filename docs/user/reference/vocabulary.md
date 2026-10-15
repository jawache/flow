---
summary: "the terms the flow docs use, and what each one means"
---

# Vocabulary

Each term below is used with this meaning on every page of these docs.

| Term | Meaning |
| --- | --- |
| **entry** | One breadcrumb or guardrail, named inside its pack |
| **pack** | A TypeScript module grouping entries: `definePack("name", { … })`. It lives in `guards/` or is installed from npm, in the same shape. See [defining a pack](./config.md#defining-a-pack) |
| **bind** | `pack(x)` in `flow.config.ts`: turn a pack's entries on. See [the config verbs](./config.md#the-config-verbs) |
| **override** | `override(pack.entry).<key>(…)`: change one thing about a bound entry. Each key replaces the pack's whole value. See [how to override an entry](../how-to/override-an-entry.md) |
| **moment** | When a rule runs: `session · touch · write · command · delete · commit · turn-end`. See [moments](./moments.md) |
| **observed** | A change flow detects after the tool call that made it: a shell edit, a script, a recipe. It is checked by the same rules as an Edit, and undone if refused. See [what the guard sees](../explanation/what-the-guard-sees.md) |
| **actor** | The categories recorded for a session, read from evidence the host wrote. `.for(…)` binds a rule to one or more of them. A check reads them from `ctx.actor` |
| **check** | A function of `ctx` that returns `ctx.ok()` or `ctx.fail(detail)`: a stock one, or your own via `defineCheck`. See [the check contract](./ctx.md#the-check-contract) |
| **ctx** | The one argument a check is called with, and its only access to the world: the event facts (`file · command · staged · turn · actor · moment`) and the effects (`fs · exec · git`). See [the ctx a check reads](./ctx.md) |
| **category** | A name with its recognizer, `defineCategory`, read from host-written evidence and bound with `.for(…)`. See [categories](./config.md#categories) |
| **case** | A canned `ctx` that must pass or must block, included on the entry as `.test({ pass, block })`. A guardrail with no case at all, pass or block, does not load. See [cases](./config.md#cases) |
| **fitting** | What `flow status` checks beyond the rules: the config loads, the gate is armed, the hooks are registered, and the `flow` they run is found. See [the flow command](./cli.md) |

---

[Index](../index.md) · the grammar: [the config](./config.md) · the model behind it: [how flow works](../explanation/how-flow-works.md)
