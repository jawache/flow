---
summary: "about categories: why a rule can depend on the actor, and why the actor is read from evidence the harness wrote"
---

# Rules bound to who, not what

A rule can give a different answer to the same act depending on who does it, and flow decides who from evidence the harness wrote, never from what the agent says about itself.

## The same act, a different answer

A **category** is a name for an actor, with the function that recognises it. `.for(category)` binds a rule to that actor, so the rule runs only for agents in that category. `.for(…)` may list several categories, and the rule then runs for an agent in any of them. It works on a guardrail and on a breadcrumb.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
```

A guardrail bound to this category can refuse a commit from a subagent and let the same commit from the main session through. The act is the same and the actor is different, so the answer is different.

It matters most for breadcrumbs at the start of a session. A builder goes on to commit, run recipes and change code, so it needs the notes about all three. A reviewer reads and reports, and needs few of them. A breadcrumb bound with `.for(builder)` is shown to the one and not the other.

What an agent can do at all, such as whether a reviewer may write files, is set by the agent's tool list in the harness. flow does not stop a write.

## Why the evidence is the harness's

The function that recognises a category reads **evidence the harness wrote**. It never reads a claim the agent made about itself. The evidence is one of two things:

- **The agent type.** The harness includes `agent_type` in the hook message for a subagent's calls. The agent cannot change that message.
- **The brief.** The first message a spawned agent was given, read from that subagent's own transcript.

The reason is that a rule resting on a claim rests on nothing. An agent that could say "I am the builder" and be believed could pass any rule bound to the builder.

The evidence is not out of reach of every command. A subagent's transcript sits outside the repo, and flow remembers each agent's categories under `.flow/`, which git ignores. Both are ordinary files, and nothing the agent says in its own messages is read.

## Recognising a category

Every category is declared with `defineCategory(name, recognise)`. The second argument is the function that recognises it, and there are two ways to write it:

- **`spawnedAs({ types: ["builder"] })`** builds the function from the agent a session was spawned as. It checks the evidence in a fixed order, so it is the way that is hardest to get wrong:

  ```
  const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));
  ```

- **A function of your own** over the harness's facts, as `subagent` above is. Use it for every other case.

[Categories](../reference/config.md#categories) in the config reference gives the syntax.

---

[Index](../index.md) · the syntax: [the config reference](../reference/config.md#categories) · the steps: [how to bind a rule to a type of agent](../how-to/bind-a-rule-to-a-type-of-agent.md) · the model: [how flow works](./how-flow-works.md)
