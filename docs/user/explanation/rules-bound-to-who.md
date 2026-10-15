---
summary: "about categories: why a rule can depend on the actor, and why the actor is read from host-written evidence"
---

# Rules bound to who, not what

A rule can give a different answer to the same act depending on who does it, and flow decides who from evidence the host wrote, never from what the session says about itself.

## The same act, a different answer

A **category** is a name for an actor, with the function that recognises it. `.for(category)` binds a rule to that actor, so the rule runs only for sessions in that category.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
```

The demo config's `chatCommits` rule uses this category. It refuses a commit from a subagent and lets the same commit from the main chat through. The act is the same and the actor is different, so the answer is different.

This matters when several agents share one worktree. A builder agent should change files and a reviewing agent should not. A rule about the file alone cannot tell them apart, and a rule bound to the actor can.

## Why the evidence is host-written

The function that recognises a category reads **host-written evidence**: a sidecar file the harness wrote, or the brief a spawned agent was given. It never reads a claim the session made about itself.

The reason is that a permission resting on a claim rests on nothing. A session that could say "I am the builder" and be believed could write any file the builder may write. Evidence the harness wrote is outside the session's reach, so the session cannot change which category it is in.

## The two ways to declare a category

- **`spawnedAs("builder")`** recognises a session by the agent it was spawned as. It is the stock way, and the one that is hardest to get wrong.
- **`defineCategory`** takes any function over the host's facts. Use it for every other case.

[Categories](../reference/config.md#categories) in the config reference gives the syntax.

---

[Index](../index.md) · the syntax: [the config reference](../reference/config.md#categories) · a rule over who may write: [how to let only some agents write](../how-to/let-only-some-agents-write.md) · the model: [how flow works](./how-flow-works.md)
