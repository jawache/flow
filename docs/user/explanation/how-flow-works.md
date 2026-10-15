---
summary: "about flow: the two kinds of guidance, the one file, packs, and the demo config read line by line"
---

# How flow works

flow stops an agent's predictable mistakes at the moment they happen, instead of leaving them for you to find at review.

An agent working in your codebase makes confident mistakes, and it makes them at predictable moments. It edits a file nobody should touch, runs a command that deletes history, or commits a dependency without telling you. flow checks each of these moments as it happens:

- **A command** is refused before it runs.
- **An edit made with the Edit tool** is refused before it lands.
- **An edit written by a shell command** is refused the moment it has landed, and undone.
- **A commit** is refused before it is made.

What a rule refuses never stays.

## Two kinds of guidance, and nothing in between

flow gives an agent two kinds of guidance:

- **A breadcrumb** steers. It is a note added to the agent's session when it works in an area, such as "this code runs in a Worker, no Node natives".
- **A guardrail** blocks. It is a check that refuses a write, a command or a commit, and says why.

There are no warnings. A rule either blocks or it is a breadcrumb. A warning is a third kind that an agent learns to read past, so flow does not have one.

## `flow.config.ts` is the whole guard

`flow.config.ts` is one TypeScript file at the repo root, and a rule that cannot be reached from it does not run. There is no rule library on the machine, nothing resolves at run time, and nothing defaults. What the file says is exactly what runs.

The file is code for a reason. A misspelled verb is a red squiggle in your editor, and a rule that cannot compile never loads. A guard written as data would let the same mistake through until it failed at run time.

## Packs and overrides

The file has two verbs: it binds **packs**, and it states **overrides**.

```
import { defineConfig, override, pack } from "@jawache/flow";
import { git } from "@jawache/flow/packs";
import { house } from "./guards/house.ts";

export default defineConfig([
  pack(git, { release: "just release" }),           // bind a pack, and every entry in it
  pack(house),
  override(git.noForcePush).disabled("scratch repo — history is disposable here"),
]);
```

- **`pack(x)`** binds a pack and every entry in it.
- **`override(x.entry)`** states only what it changes: a different `.on(…)`, a different `.message(…)`, or `.disabled("why")`. Everything it leaves out comes from the pack.

An override replaces the key it names. A narrowed `.on(…)` is the whole list, never a merge, so a re-scope never takes the pack's own globs back beside it. Where two repos disagree about one entry, the second one overrides it instead of forking the pack, and `flow status` prints the override's reason beside the entry. The difference between the repos stays visible.

[How to change or turn off one entry of a pack](../how-to/override-an-entry.md) gives the steps.

## A pack is just code

A pack is an ordinary TypeScript module. One you wrote in `guards/` and one you installed from npm have the same shape. So sharing a pack is a move, not a rewrite: there is nothing on the machine to resolve against and no library to keep in sync, because the pack is the code you already read.

Every pack therefore sits in one of two tiers, and the tier is only where its file lives:

- **Yours.** A pack about your repo's own terrain, such as its project map or its house rules. It goes nowhere else and stays in `guards/`.
- **Publishable.** General discipline worth giving to a second repo. It moves to a package.

Nothing about the rules changes when a pack moves tier. Only the import path changes.

A pack that needs a fact about the repo declares it as a mandatory typed parameter. Binding the pack without that fact does not compile, so a pack cannot apply another repo's assumptions without saying so. [How to share a pack across repos](../how-to/share-a-pack.md) gives the steps.

## Moments

A guardrail runs at one or more **moments**: `write`, `command`, `delete`, `commit` and `turn-end`. A breadcrumb has its own: `session`, `touch`, `command` and `turn-end`. [The moments reference](../reference/moments.md) lists when each one runs.

The commit moment comes from git's own pre-commit hook, not from any harness. The hook runs `flow hook commit`, and flow reads the staged changes from git: the files the commit adds, changes and deletes. Because git runs the hook, every harness gets the commit gate, and so does a person committing in a terminal. To git, a rename is a deletion of the old path plus an add of the new one.

In code, moments are imported symbols: `session`, `touch`, `write`, `command`, `deletion`, `commit` and `turnEnd`. `deletion` and `turnEnd` are spelled that way because `delete` is a reserved word in JavaScript, but the moment is still "delete".

## The demo config, read line by line

`flow init` writes a demo `flow.config.ts`. It is ordinary code, and it is the whole guard. It binds two packs:

- **`flow`**, flow's own self-protection. It brings the orientation note, the note when you edit the guard, and the refusal to delete it.
- **`demo`**, a pack of three guardrails written out in the file.

```
// flow.config.ts — this repo's whole guard, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Everything below is ordinary code: a pack is a
// module, a check is a function of its ctx, and a category is a name with its recognizer aboard.
// Nothing defaults — an absent key is absent — so a mistake fails in your editor, not at 3am.
//
//   flow status   what is bound, at which moments, and what is not wired yet
//   flow test     every rule's own cases, run

import { banCommands, command, commit, defineCategory, defineConfig, definePack, guardrail, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

// A category is a name and the HOST-WRITTEN evidence that recognises it — never a claim a session
// made about itself. This one is "the harness wrote a sidecar for you", which is what a spawned
// subagent is and a chat is not.
const subagent = defineCategory("subagent", (facts) => facts.subagent);

// Spelled in pieces on purpose. Written whole it would appear in this very file, and the gate below
// greps staged content — so the demo would refuse the commit that added it.
const MARKER = ["DO", "NOT", "COMMIT"].join("-");

export const demo = definePack("demo", {
  noForcePush: guardrail()
    .at(command)
    .check(banCommands({ ban: ["git\\s+push\\b[^\\n]*(--force|(^|\\s)-f(\\s|$))"] }))
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),

  // No .on() here, and that is the sentence rather than an omission: an entry that names no paths is
  // about THE COMMIT, so it is asked once and handed the whole staged set. (Name paths with .on()
  // and the gate asks it once per staged file in scope instead, handing over each file.)
  noMarkedFiles: guardrail()
    .at(commit)
    .check(async (ctx) => {
      for (const path of ctx.staged ?? [])
        if ((await ctx.fs.read(path)).includes(MARKER)) return ctx.fail(path + " carries the marker");
      return ctx.ok();
    })
    .message("A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.")
    .test({
      pass: [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
      block: [{ staged: ["a.txt"], world: { fs: { "a.txt": MARKER } } }],
    }),

  // The same act, a different wearer, a different answer — a rule bound to WHO rather than to what.
  chatCommits: guardrail()
    .at(commit)
    .for(subagent)
    .check((ctx) => ctx.fail((ctx.staged ?? []).length + " staged file(s)"))
    .message("A subagent does not commit — hand the change back to the chat that spawned it.")
    .test({ pass: [], block: [{ staged: ["a.txt"] }] }),
});

export default defineConfig([
  // flow's own self-protection: what is steering you, a nudge when you edit it, and no deleting it.
  // Its packs list is where YOUR OWN packs live. Everything here is in this file, so it is empty —
  // move a pack out to a folder of its own and add that folder's glob, or the nudge and the delete
  // refusal stop covering it.
  pack(flow, { packs: [] }),
  pack(demo),
]);
```

Five ideas in this file explain the rest of flow:

- **A sentence states everything, and defaults nothing.** Each verb is one part of the rule:
  - `.at(…)` is when it runs.
  - `.on(…)` and `.ignore(…)` are which files.
  - `.for(…)` is which actor.
  - `.check(…)` is the question.
  - `.message(…)` is what the blocked person reads.
  - `.test({ pass, block })` is what proves it.

  A verb written twice is a compile error, and a guardrail with no `.message(…)` does not load.
- **A check is a function of `ctx`**, and it reaches the world only through it: `ctx.command`, `ctx.staged`, `ctx.file`, `ctx.fs`, `ctx.exec` and `ctx.git`. It returns `ctx.ok()` or `ctx.fail(detail)`. Because of that one rule, the same check runs live, runs in a test case, and replays from a recording with no repo at all.
- **Scope is part of the sentence.** `noMarkedFiles` has no `.on(…)`, so it is about the commit: it is called once, with the whole staged set. With paths in `.on(…)`, the gate calls the rule once per staged file in scope, with that file. A file the commit deletes is passed only to a rule bound at both `deletion` and `commit`. A rule bound at `commit` alone checks the files the commit will contain, and a deleted file is not one of them.
- **A category reads evidence the host wrote.** `subagent` is recognised from a sidecar file the harness wrote, never from anything the session claimed. [Rules bound to who](./rules-bound-to-who.md) explains why.
- **Every rule has its own cases.** `.test({ pass, block })` is part of the rule: a rule with no block case does not load. [How to test your rules](../how-to/test-your-rules.md) gives the steps.

---

[Index](../index.md) · when each rule runs: [the moments](../reference/moments.md) · every verb: [the config reference](../reference/config.md) · try it: [getting started](../tutorials/getting-started.md) · the terms: [the vocabulary](../reference/vocabulary.md)
