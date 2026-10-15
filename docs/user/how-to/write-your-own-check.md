---
summary: "a check no stock one expresses, with `defineCheck`"
---

# How to write your own check

This guide shows you how to write a check of your own, for a rule that no stock check expresses.

Most rules are a [stock check](../index.md#the-stock-checks--one-page-each) plus a sentence, and a structural code pattern is `astGrep`, with no code at all. Write your own check when it needs real logic: it reads a companion file, computes something, or holds an invariant no stock check expresses.

## Write the check

1. **Call `defineCheck`** with a function that takes your options and returns the check. The check is a function of `ctx` that returns `ctx.ok()` or `ctx.fail(detail)`, and it may be async.
2. **Reach the world only through `ctx`.** Read files with `ctx.fs`, run commands with `ctx.exec`, query git with `ctx.git`. Never import `node:fs` or `child_process`, and never read `process.env`. Because of this rule, the same check runs live, runs in a test case, and replays from a recording with no repo at all.
3. **Bind it in a pack** like a stock check, and give the entry its cases:

   ```
   // guards/house.ts
   import { defineCheck, write, commit, definePack, guardrail } from "@jawache/flow";

   const frontmatterComplete = defineCheck((_opts: Record<string, never>) => (ctx) => {
     const { content } = ctx.file ?? { content: "" };
     return content.startsWith("---") ? ctx.ok() : ctx.fail("missing frontmatter block");
   });

   export const house = definePack("house", {
     frontmatter: guardrail()
       .at(write, commit)
       .on("content/**/*.md")
       .check(frontmatterComplete({}))
       .message("Every content file opens with frontmatter.")
       .test({
         pass:  [{ path: "content/a.md", content: "---\ntitle: x\n---\n" }],
         block: [{ path: "content/a.md", content: "no frontmatter here" }],
       }),
   });
   ```

   The check declares no moments, no schema and no `kind`. The entry's `.at(…)` says when it runs. The check reads whatever `ctx` holds at that moment, and [the `ctx` reference](../reference/ctx.md) lists what that is, moment by moment. The options are an ordinary typed argument, so a wrong value is a compile error.

4. **Write the detail as a sentence** naming what was seen and what to do. If two causes need different answers from the reader, give each its own detail line. A check that returns the same line for both teaches the reader to ignore it.
5. **Run `flow test`.** A bespoke check is authored logic, so its entry needs cases like any other: a rule with no block case does not load. [How to test your rules](./test-your-rules.md) gives the steps.

A check that throws is a load-time fault that names the file. It never loads as a rule that stopped checking.

---

[Index](../index.md) · what a check reads: [the `ctx` reference](../reference/ctx.md) · the sentence around it: [the config reference](../reference/config.md#a-guardrail) · the built-ins to reach for first: [the stock checks](../index.md#the-stock-checks--one-page-each)
