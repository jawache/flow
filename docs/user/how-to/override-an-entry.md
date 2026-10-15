---
summary: "`override(…)` in `flow.config.ts`, for one entry of a bound pack"
---

# How to change or turn off one entry of a pack

This guide shows you how to change one entry of a pack your repo binds, or turn it off, without editing the pack.

`override(pack.entry)` in `flow.config.ts` changes only the keys you chain onto it. Every key you leave out keeps the pack's value.

## Change or turn off the entry

1. **Find the entry's name.** `flow status` lists every bound entry as `<pack>.<entry>`, for example `tdd.vitest`. An entry inside a group has the group in its name, for example `tdd.vitestIdioms.noOnlyInTests`.
2. **Add an `override(…)` line** to the list in `defineConfig([…])`. Its position in the list does not matter: flow applies every override after it has bound every pack.
3. **Chain the key you want to change:**

   - **If you want a different scope**, chain `.on(…)` with the globs for this repo.
   - **If you want a different refusal message**, chain `.message(…)`.
   - **If you want the entry off**, chain `.disabled("why")` with the reason.

   ```
   import { defineConfig, override, pack } from "@jawache/flow";
   import { tdd } from "@jawache/flow/packs";

   export default defineConfig([
     pack(tdd, { run: "just test" }),
     override(tdd.testingStrategy).on("src/**/*.test.ts"),                    // this repo's scope
     override(tdd.vitest).disabled("this repo's suite runs on node:test"),    // visible opt-out
   ]);
   ```

   An override also accepts `.at(…)`, `.for(…)`, `.ignore(…)` and `.description(…)`, and on a breadcrumb `.text(…)` and `.file(…)`. It never accepts `.check(…)` or `.test(…)`.

4. **List the whole value.** An override replaces the key it names. A narrowed `.on(…)` is the whole list of globs, never a merge with the pack's list, so the pack's own globs are not added back beside it.
5. **Run `flow status`.** An entry turned off with `.disabled("why")` is marked `○`, with `off: <reason>` under it. An entry with a new `.on(…)` shows its new globs.

> [!NOTE]
> `.disabled("why")` turns one entry off in a committed line of `flow.config.ts`, so it shows in review. Two other things also turn rules off: leaving the pack out of `defineConfig([…])`, and the `.flow/off` switch, which turns every rule off and is never committed. See [the flow command](../reference/cli.md) for `.flow/off`.

---

[Index](../index.md) · every verb: [the config reference](../reference/config.md) · why overrides exist: [how flow works](../explanation/how-flow-works.md) · sharing the pack itself: [how to share a pack across repos](./share-a-pack.md)
