---
summary: "give every rule its cases, and run them"
---

# How to test your rules

This guide shows you how to prove that each rule passes what it should and blocks what it should.

Every guardrail has its own cases, written on the entry with `.test({ pass, block })`. A case is a canned `ctx`: the input a check is called with, supplied as data. `pass` lists the inputs the rule must let through, and `block` lists the inputs it must refuse. A guardrail with no cases at all does not load.

## Write the cases

1. **Add a block case first.** flow loads a guardrail that has only pass cases, but such a rule proves nothing about what it catches. A block case that passes is how `flow test` reports a rule that catches nothing.
2. **Add a pass case** for an input the rule must let through.
3. **If the rule is about a command**, write each case as a bare string. A bare string is always a command line:

   ```
   .test({
     pass:  ["git push origin main"],
     block: ["git push --force origin main"],
   })
   ```

4. **If the rule is about a file, a commit or the turn**, write each case as an object. Add a `world` when the check reads more than its input:

   ```
   .test({
     pass:  [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
     block: [{ staged: ["a.txt"], world: { fs: { "a.txt": "SECRET" } } }],
   })
   ```

   Use the shape for the rule's moment:

   - **`path` and `content`** for a write rule.
   - **`command`** for a command rule, when the case also needs a `world` or an `actor`.
   - **`staged`** for a commit rule.
   - **`actions`** for a turn-end rule.
   - **`world`**, with `fs`, `exec`, `gitDiff` or `staged` answers, for a check that reads further.

   A case whose shape belongs to a moment the rule is not bound at fails in `flow test`.

[Cases](../reference/config.md#cases) in the config reference lists every case shape and the keys each one accepts.

## Run them

1. Run every bound rule's cases:

   ```
   flow test
   ```

   Each case runs through the same `ctx` the live rules build, with the world supplied as data. When every case passes, `flow test` prints one line. Each failing case prints its own line, naming the entry and the case, and the command exits 1.

2. After a green run, change one case so that it should fail, and run `flow test` again. Check that it goes red. A test that cannot fail proves nothing.

3. Put the case back.

---

[Index](../index.md) · every case shape: [the config reference](../reference/config.md#cases) · the command: [`flow test`](../reference/cli.md) · a check of your own: [how to write your own check](./write-your-own-check.md)
