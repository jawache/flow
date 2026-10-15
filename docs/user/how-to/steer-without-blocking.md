---
summary: "show the agent a note when it reads or changes an area, with a breadcrumb"
---

# How to steer without blocking

This guide shows you how to show the agent a note about an area of the code, without refusing anything. A note of this kind is a breadcrumb.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `breadcrumb` and `touch` to the import.

2. Add a breadcrumb at `touch`, scoped to the files it is about, with the note in `.text(…)`:

   ```
   workerRuntime: breadcrumb()
     .at(touch)
     .on("src/pages/api/**")
     .text("This code runs in a Worker: no Node natives, env per request, gate auth first."),
   ```

3. Run `flow status`. The breadcrumb is listed under `touch`.

A `touch` breadcrumb is shown the first time a tool call names a matching file. It is shown again after about 200,000 tokens of session.

## Variants

- **If you want the note at the start of every session**, use `.at(session)`.
- **If you want a broad note and finer ones**, write both. Notes stack, so a file can match a general note and a specific one.
- **If the note is long**, put it in a file and use `.file(path)` in place of `.text(…)`.

---

[Index](../index.md) · every verb of a breadcrumb: [the config reference](../reference/config.md#a-breadcrumb) · when each moment runs: [moments](../reference/moments.md)
