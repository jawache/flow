---
summary: "the terms the flow docs use, and what each one means"
---

# Vocabulary

Each term below is used with this meaning on every page of these docs.

| Term | Meaning |
| --- | --- |
| **entry** | One breadcrumb or guardrail, named inside its pack |
| **pack** | A TypeScript module grouping entries: `definePack("name", { … })`. It lives in `guards/` or in a package of its own, in the same shape. See [defining a pack](./config.md#defining-a-pack) |
| **bind** | `pack(x)` in `flow.config.ts`: turn a pack's entries on. See [the config verbs](./config.md#the-config-verbs) |
| **override** | `override(pack.entry).<key>(…)`: change one thing about a bound entry. Each key replaces the pack's whole value. See [override one entry of a pack](../how-to/write-your-own-check.md#override-one-entry-of-a-pack) |
| **moment** | When a rule runs: `commit · command · session · change · turn-end`. See [moments](./moments.md) |
| **guardrail** | A rule that refuses a commit or a command, or holds a turn open |
| **breadcrumb** | A note shown to the agent, at a session's start, when a file changes, before a command or at turn-end |
| **harness** | The program that runs the agent and calls flow's hooks: Claude Code or Codex |
| **actor** | The categories recorded for an agent, read from evidence the harness wrote. `.for(…)` binds a rule to one or more of them. A check reads them from `ctx.actor` |
| **check** | A function of `ctx` that returns `ctx.ok()` or `ctx.fail(detail)`: a stock one, or your own via `defineCheck`. See [the check contract](./ctx.md#the-check-contract) |
| **ctx** | The one argument a check is called with, and its only access to the world: the event facts (`file · staged · deleted · message · command · turn · actor · moment`) and the effects (`fs · exec · git`). See [what a check is given](./ctx.md) |
| **category** | A name with its recognizer, `defineCategory`, read from evidence the harness wrote and bound with `.for(…)`. See [categories](./config.md#categories) |
| **case** | A canned `ctx` that must pass or must block, included on the entry as `.test({ pass, block })`. A guardrail with no block case does not load. See [cases](./config.md#cases) |
| **fitting** | What `flow status` checks beyond the rules: the config loads, git runs the two commit hooks, each harness's hooks are registered, and the `flow` they run is found. See [the flow command](./cli.md) |

---

[Index](../index.md) · the grammar: [the config](./config.md) · the model behind it: [how flow works](../explanation/how-flow-works.md)
