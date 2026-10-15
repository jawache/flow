# How to test your rules

docs/user/how-to · give every rule its cases, and run them · 2026-10-15

This guide shows you how to prove that each rule passes what it should and blocks what it should.

Every guardrail has its own cases, written on the entry with `.test({ pass, block })`. A case is a canned `ctx`: the input a check is called with, supplied as data. `pass` lists the inputs the rule must let through, and `block` lists the inputs it must refuse. A guardrail with no block case does not load.

## Write the cases

1. **Add a block case first.** A rule whose block case passes catches nothing, and `flow test` is what reports it.
2. **Add a pass case** for an input the rule must let through.
3. **If the rule is about a command or a file body**, write each case as a bare string. The string is the command line, or the file's content:

   ```
   .test({
     pass:  ["git push origin main"],                       // a bare string is the command / file body
     block: ["git push --force origin main"],
   })
   ```

4. **If the rule reads more than its input**, write each case as an object, with a `world` that supplies the answers the check reads:

   ```
   .test({
     pass:  [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],   // or a full canned ctx
     block: [{ staged: ["a.txt"], world: { fs: { "a.txt": "SECRET" } } }],
   })
   ```

   Use the shape for the rule's moment:

   - **`file` and `content`** for a content rule.
   - **`command`** for a command rule.
   - **`staged`** for a commit rule.
   - **`world`**, with `fs`, `exec` or `git` answers, for a rule that reads further.

[Cases](../reference/config.md#cases) in the config reference lists every case shape and the keys each one accepts.

## Run them

1. Run every bound rule's cases:

   ```
   flow test
   ```

   Each case runs through the same `ctx` the live rules build, with the world supplied as data. `flow test` reports one line.

2. After a green run, change one case so that it should fail, and run `flow test` again. Check that it goes red. A test that cannot fail proves nothing.

3. Put the case back.

---

[Index](../index.md) · every case shape: [the config reference](../reference/config.md#cases) · the command: [`flow test`](../reference/cli.md) · a check of your own: [how to write your own check](./write-your-own-check.md)
