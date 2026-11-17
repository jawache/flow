---
summary: "run a guardrail, or show a breadcrumb, only for one type of agent, with a category and `.for(…)`"
---

# How to bind a rule to a type of agent

This guide shows you how to make a rule apply to one type of agent and not another, such as a breadcrumb only builders are shown, or a guardrail only subagents meet.

1. Declare a category in the pack that holds your repo's rules. Add `defineCategory` and `spawnedAs` to the import:

   ```
   const builder  = defineCategory("builder", spawnedAs({ types: ["builder"] }));
   const subagent = defineCategory("subagent", (facts) => facts.subagent);
   ```

   - **`spawnedAs({ types: […] })`** matches the type an agent was started as. Under Claude Code that is the agent's name, and under Codex the agent's `name`, or `default`, `worker` or `explorer`.
   - **A function of your own** reads the facts the harness wrote. `facts.subagent` is `true` for every subagent.

2. Chain `.for(…)` on the entry, with one or more categories:

   ```
   subagentsDoNotCommit: guardrail()
     .at(commit)
     .for(subagent)
     .check((ctx) => ctx.fail((ctx.staged ?? []).length + " staged file(s)"))
     .message("A subagent does not commit — hand the change back to the session that started it.")
     .test({ pass: [{ staged: ["a.txt"] }], block: [{ staged: ["a.txt"], actor: ["subagent"] }] }),
   ```

   A case names the canned agent's categories in `actor`.

3. Run `flow test`, then `flow status`. The entry is listed with the categories it is bound to.

A rule with no `.for(…)` applies to every agent.

## Variants

- **If the rule is a breadcrumb at the start of a session**, see [how to steer with a breadcrumb](./steer-with-a-breadcrumb.md#for-a-type-of-agent).
- **If a type is generic**, such as `general-purpose`, the type says nothing about the job. `spawnedAs` can read the brief the agent was started with: [categories](../reference/config.md#categories) lists the keys.
- **If you want to stop a type of agent writing files at all**, take the write tools out of that agent's tool list in the harness. flow does not stop a write.

---

[Index](../index.md) · the syntax: [categories](../reference/config.md#categories) · why the evidence is the harness's: [rules bound to who](../explanation/rules-bound-to-who.md)
