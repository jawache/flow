---
summary: "show the agent a breadcrumb at the start of a session, for a type of agent, or when a path changes"
---

# How to steer with a breadcrumb

This guide shows you how to show the agent a breadcrumb: text added to its context, which refuses nothing. Use one for a preferred way of working, and for a mistake the agent can recover from.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `breadcrumb`, and `session` or `fileChange`, to the import.

2. Add the breadcrumb for your case, from the sections below.

3. Run `flow status`. The breadcrumb is listed under its moment.

## At the start of a session

```
orientation: breadcrumb()
  .at(session)
  .text("Commands live in the justfile: run `just` first. Commit often, and stash before you discard an edit."),
```

Every agent is shown it once: the main session, and each subagent as it starts.

## For a type of agent

Bind the breadcrumb to a category with `.for(…)`, and only that type of agent is shown it:

```
const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));

commitRules: breadcrumb()
  .at(session)
  .for(builder)
  .text("Commit each coherent piece. The header is `type(scope): description`."),
```

An agent that only reads and reports needs fewer breadcrumbs than a builder. [How to bind a rule to a type of agent](./bind-a-rule-to-a-type-of-agent.md) has the categories.

## When a path changes

```
workerRuntime: breadcrumb()
  .at(fileChange)
  .on("src/pages/api/**")
  .text("This code runs in a Worker: no Node natives, env per request, gate auth first."),
```

The breadcrumb is shown after the first tool call that changes a matching file, whichever tool changed it. A breadcrumb is shown for a change, never for a read.

## Variants

- **If the breadcrumb is about a command**, use `.at(command)` with the command lines in `.on(…)`, such as `.on("npm install*")`. It is shown before the command runs.
- **If you want a broad breadcrumb and finer ones**, write both. A file can match a general breadcrumb and a specific one, and the agent is shown both.
- **If the text is long**, put it in a file and use `.file(path)` in place of `.text(…)`.

[When a breadcrumb is shown again](../reference/moments.md#when-a-breadcrumb-is-shown-again) says when an agent is shown the same breadcrumb twice.

---

[Index](../index.md) · every verb of a breadcrumb: [the config reference](../reference/config.md#a-breadcrumb) · when each moment runs: [moments](../reference/moments.md)
