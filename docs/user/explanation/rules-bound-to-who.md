---
summary: "about categories: why a rule can depend on the actor, and why the actor is read from host-written evidence"
---

# Rules bound to who, not what

A rule can give a different answer to the same act depending on who does it, and flow decides who from evidence the host wrote, never from what the session says about itself.

## The same act, a different answer

A **category** is a name for an actor, with the function that recognises it. `.for(category)` binds a rule to that actor, so the rule runs only for sessions in that category. `.for(…)` may list several categories, and the rule then runs for a session in any of them.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
```

The demo config's `chatCommits` rule uses this category. It refuses a commit from a subagent and lets the same commit from the main chat through. The act is the same and the actor is different, so the answer is different.

This matters when several agents share one worktree. A builder agent should change files and a reviewing agent should not. A rule about the file alone cannot tell them apart, and a rule bound to the actor can.

## Why the evidence is host-written

The function that recognises a category reads **host-written evidence**. It never reads a claim the session made about itself. The evidence is one of two things:

- **The agent type.** Claude Code includes `agent_type` in the hook message for every tool call a subagent makes. The session cannot change that message.
- **The brief.** The first message a spawned agent was given, read from that subagent's own transcript.

The reason is that a permission resting on a claim rests on nothing. A session that could say "I am the builder" and be believed could write any file the builder may write.

The evidence is not out of reach of every command. A subagent's transcript sits outside the repo, and flow remembers each session's identity under `.flow/`, which git ignores. Both are ordinary files. What keeps them out of a rule's way is that neither is in the snapshot flow judges a change against, and nothing the session says in its own messages is read.

## Recognising a category

Every category is declared with `defineCategory(name, recognise)`. The second argument is the function that recognises it, and there are two ways to write it:

- **`spawnedAs({ types: ["builder"] })`** builds the function from the agent a session was spawned as. It checks the evidence in a fixed order, so it is the way that is hardest to get wrong:

  ```
  const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));
  ```

- **A function of your own** over the host's facts, as `subagent` above is. Use it for every other case.

[Categories](../reference/config.md#categories) in the config reference gives the syntax.

---

[Index](../index.md) · the syntax: [the config reference](../reference/config.md#categories) · a rule over who may write: [how to let only some agents write](../how-to/let-only-some-agents-write.md) · the model: [how flow works](./how-flow-works.md)
