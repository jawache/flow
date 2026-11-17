---
summary: "a check no stock one expresses, with `defineCheck`; a pack a second repo imports; and one entry of a pack changed or turned off"
---

# How to write your own check, and share rules as a pack

This guide shows you how to write a check of your own, for a rule that no stock check expresses, how to share a pack of rules with a second repo, and how to change one entry of a pack you bind.

Most rules are a [stock check](../index.md#the-stock-checks--one-page-each) plus a sentence, and a structural code pattern is `astGrep`, with no code at all. Write your own check when it needs real logic: it reads a companion file, computes something, or holds an invariant no stock check expresses.

## Write the check

1. **Call `defineCheck`** with a function that takes your options and returns the check. The check is a function of `ctx` that returns `ctx.ok()` or `ctx.fail(detail)`, and it may be async.
2. **Reach the world only through `ctx`.** Read files with `ctx.fs`, run commands with `ctx.exec`, query git with `ctx.git`. Never import `node:fs` or `child_process`, and never read `process.env`. Because of this rule, the same check runs live, runs in a test case, and replays from a recording with no repo at all.
3. **Bind it in a pack** like a stock check, and give the entry its cases:

   ```
   // guards/house.ts
   import { commit, defineCheck, definePack, guardrail } from "@jawache/flow";

   const frontmatterComplete = defineCheck((_opts: Record<string, never>) => (ctx) => {
     const { content } = ctx.file ?? { content: "" };
     return content.startsWith("---") ? ctx.ok() : ctx.fail("missing frontmatter block");
   });

   export const house = definePack("house", {
     frontmatter: guardrail()
       .at(commit)
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
5. **Run `flow test`.** A bespoke check is authored logic, so its entry needs cases like any other: a guardrail with no block case does not load, because a block case is what proves the check catches something. [How to test your rules](./test-your-rules.md) gives the steps.

A check that throws while it runs never passes quietly. Live, the entry blocks, with the detail `the check threw: <the error's message>`. In `flow test`, the case fails with the same detail. A throw while `flow.config.ts` is being imported is different: the config does not load, so every guardrail is off and every commit is refused until it is fixed. See [fail loud](../explanation/fail-loud.md).

## Share rules as a pack

A pack is a TypeScript module, so sharing it is a move, not a rewrite. The entries stay as they are, and each repo still binds the pack with one `pack(…)` line.

1. **Move the pack file** from the repo's `guards/` folder into a package of its own, in its own repository.
2. **Name flow as a peer dependency** of that package, so the pack uses the copy of flow its project has and installs none of its own:

   ```
   "peerDependencies": { "@jawache/flow": ">=0.4.0" }
   ```

3. **Replace each repo-specific fact with a parameter.** If two repos differ on a fact the pack needs, such as a test command, declare it as a mandatory typed parameter:

   ```
   // the pack takes a repo fact it cannot know
   export const tests = definePack("tests", (repo: { run: string }) => ({
     commitRunsTests: guardrail()
       .at(commit)
       .check(execPasses({ run: repo.run }))
       .message("Commit runs the suite.")
       .test({ /* … */ }),
   }));

   // …and the config supplies it
   export default defineConfig([
     pack(tests, { run: "just test-commit" }),
   ]);
   ```

   A repo that binds the pack without stating the fact does not compile, so the pack never applies another repo's assumptions.

4. **Install the package in each repo,** pinned as flow is, and import the pack in its `flow.config.ts`. A package in `node_modules` must hold built JavaScript: Node does not run TypeScript from there.

## Override one entry of a pack

`override(pack.entry)` in `flow.config.ts` changes only the keys you chain onto it. Every key you leave out keeps the pack's value. Where a repo disagrees with one entry, override it. Do not fork the pack.

1. **Find the entry's name.** `flow status` lists every bound entry as `<pack>.<entry>`, for example `flow.noUninstall`.
2. **Add an `override(…)` line** to the list in `defineConfig([…])`. Its position in the list does not matter.
3. **Chain the key you want to change:**

   ```
   import { defineConfig, override, pack } from "@jawache/flow";
   import { flow } from "@jawache/flow/packs";
   import { tests } from "./guards/tests.ts";

   export default defineConfig([
     pack(flow),
     pack(tests, { run: "just test" }),
     override(flow.noDeleteGuardrails).on("flow.config.ts", ".githooks/**", ".claude/settings.json", ".codex/hooks.json", "guards/**"),   // this repo's scope
     override(tests.commitRunsTests).disabled("this repo's suite runs in CI"),                                                           // visible opt-out
   ]);
   ```

   An override accepts `.at(…)`, `.on(…)`, `.ignore(…)`, `.for(…)`, `.message(…)`, `.description(…)` and `.disabled("why")`, and on a breadcrumb `.text(…)` and `.file(…)`. It never accepts `.check(…)` or `.test(…)`.

4. **List the whole value.** An override replaces the key it names. A narrowed `.on(…)` is the whole list of globs, never a merge with the pack's list.
5. **Run `flow status`.** An entry turned off with `.disabled("why")` is marked `○`, with `off: <reason>` under it.

> [!NOTE]
> `.disabled("why")` turns one entry off in a committed line of `flow.config.ts`, so it shows in review. Two other things also turn rules off: leaving the pack out of `defineConfig([…])`, and the `.flow/off` switch, which turns every rule off and is never committed.

---

[Index](../index.md) · what a check reads: [the `ctx` reference](../reference/ctx.md) · the sentence around it: [the config reference](../reference/config.md#a-guardrail) · the built-ins to reach for first: [the stock checks](../index.md#the-stock-checks--one-page-each)
