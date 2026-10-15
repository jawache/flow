# How to change or turn off one entry of a pack

docs/user/how-to · `override(…)` in `flow.config.ts`, for one entry of a bound pack · 2026-10-15

This guide shows you how to change one entry of a pack your repo binds, or turn it off, without editing the pack.

`override(pack.entry)` in `flow.config.ts` changes only the keys you chain onto it. Every key you leave out keeps the pack's value.

## Change or turn off the entry

1. **Find the entry's name.** `flow status` lists every bound entry as `<pack>.<entry>`, for example `git.noForcePush`.
2. **Add an `override(…)` line** to the list in `defineConfig([…])`, after the `pack(…)` line that binds the pack.
3. **Chain the key you want to change:**

   - **If you want a different scope**, chain `.on(…)` with the globs for this repo.
   - **If you want a different refusal message**, chain `.message(…)`.
   - **If you want the entry off**, chain `.disabled("why")` with the reason.

   ```
   export default defineConfig([
     pack(tdd),
     override(tdd.commitRunsTests).on("src/**"),                       // this repo's scope
     override(tdd.coverageGate).disabled("no coverage bar here yet"),  // visible opt-out
   ]);
   ```

4. **List the whole value.** An override replaces the key it names. A narrowed `.on(…)` is the whole list of globs, never a merge with the pack's list, so the pack's own globs are not added back beside it.
5. **Run `flow status`.** It prints the override's reason beside the entry.

> [!NOTE]
> `.disabled("why")` is the only way to turn a rule off. It is a committed line in `flow.config.ts`, so it shows in review.

---

[Index](../index.md) · every verb: [the config reference](../reference/config.md) · why overrides exist: [how flow works](../explanation/how-flow-works.md) · sharing the pack itself: [how to share a pack across repos](./share-a-pack.md)
