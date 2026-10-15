# The config

docs/user/reference · `flow.config.ts`, its settings, a pack, every verb of a guardrail and a breadcrumb, cases, categories, and what the loader refuses · 2026-10-15

`flow.config.ts` is the whole guard: a TypeScript file at the repo root that binds packs and overrides their entries. Because the config is TypeScript, most of what this page calls a refusal is a compile error in your editor. The loader checks the same things again at run time, for a config edited outside an editor.

The moments a rule runs at are on [moments](./moments.md). What a check is called with is on [the ctx a check reads](./ctx.md).

## The file

`flow.config.ts` sits at the repo root. It imports its packs, binds them, and exports one `defineConfig([...])` as its default. A rule not reachable from it does not run.

```
import { defineConfig, override, pack } from "@jawache/flow";
import { git } from "@jawache/flow/packs";
import { house } from "./guards/house.ts";

export default defineConfig([
  pack(git, { release: "just release" }),           // bind a pack and all its entries
  pack(house),
  override(git.noForcePush).disabled("scratch repo"),   // bend one entry of a bound pack
]);
```

## The config verbs

| Verb | What it does |
| --- | --- |
| `defineConfig([…])` | The whole guard: a list of bindings, exported as the file's default |
| `pack(x)` | Binds a pack. Every entry in it goes live |
| `pack(x, params)` | Binds a pack that declares mandatory typed parameters: a repo fact the pack needs to work. Omitting one does not compile |
| `override(x.entry)` | Changes one entry of a bound pack. Chain the keys that change: `.on(…)`, `.message(…)` or `.disabled("why")`. Each key replaces the pack's whole value for that key, and is never merged with it. A key the override does not name keeps the pack's value |
| `defineConfig([…], settings)` | The same guard, plus the settings below, as an optional second argument |

### Settings

The settings apply to the whole run rather than to one entry, so they are `defineConfig`'s optional second argument and not part of the sentence grammar. A config that sets nothing writes `defineConfig([…])`.

| Key | Type | Meaning |
| --- | --- | --- |
| `revert` | `"refused"` or `"all"` | What is put back when a rule refuses a write that has already landed on disk. To revert a file is to write its previous content back over it. `"refused"` is the default: only the files the rule refused are put back, and every other file the same tool call changed stays as that call left it. `"all"` puts back every file that call changed. When two or more agents are running tool calls that overlap in time, `"all"` is ignored, only the refused files are put back, and the refusal message says that happened |
| `snapshotInclude` | array of globs | Ignored paths to record in the snapshot as well. The snapshot is the record of every file's content that flow takes before a tool call and compares against the tree after the call. It holds what git holds: every tracked file, and every untracked file git does not ignore. A file git ignores is left out unless a glob here matches it. Each entry is a glob: a pattern that matches file paths. A rule that guards `.env` works only while `.env` is in the snapshot. `flow status` shows a red line for a rule whose scope reaches an ignored path that no glob here includes |
| `driftTokens` | number | Context tokens between re-showings of a `touch` breadcrumb. When it is absent, the engine's own default applies. It is one value for the whole repo, which is why it is not set on entries |
| `grammars` | array | Grammars this repo built itself, for `astGrep` rules whose language nobody publishes. Each is `{ name, libraryPath, extensions, languageSymbol? }`. The path is relative to the repo root or absolute, and it is a build artefact. Until the file is built, `flow status` shows a red line naming it, and the rules on that language refuse rather than pass |

```
export default defineConfig([pack(house)], { driftTokens: 120_000 });
```

## Defining a pack

A pack is a module: `definePack("name", { … })`, whose values are sentences. It lives in `guards/` or in an npm package, in the same shape.

```
import { command, definePack, guardrail } from "@jawache/flow";

export const house = definePack("house", {
  noForcePush: guardrail()
    .at(command)
    .check(/* … */)
    .message("…")
    .test({ pass: […], block: […] }),
});
```

A pack that needs a repo fact passes a function of its parameters to `definePack` instead of an object. [How to share a pack](../how-to/share-a-pack.md) shows one.

## A guardrail

A guardrail is a rule that refuses a write, a command or a commit. Every verb is a method, and saying one twice is a compile error. `.at(…)`, `.check(…)` and `.message(…)` are mandatory, and a guardrail missing one does not load.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | moments | **Mandatory.** When it runs. See [moments](./moments.md) |
| `.on(…globs)` | globs | The files it watches. A file rule needs it, and a command rule takes none. An empty scope is refused |
| `.ignore(…globs)` | globs | Carve-outs from `.on(…)` |
| `.for(category)` | category | Binds the rule to an actor. It runs only for that category |
| `.check(fn)` | a check | **Mandatory.** A function of `ctx`, or a stock check such as `textBan({…})` |
| `.message(str)` | string | **Mandatory.** What the blocked person reads |
| `.description(str)` | string | What the entry is for, for the reader |
| `.test({ pass, block })` | cases | What must pass and what must block. A guardrail with no block case does not load |
| `.disabled(why)` | string | Turns the entry off, on the record. The reason prints in `flow status` |

## A breadcrumb

A breadcrumb is a note shown to the agent. It has no rail to block with, so it has no `.check(…)` or `.message(…)`. It has prose instead.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | `session · touch · command · turn-end` | **Mandatory.** When the note shows |
| `.on(…globs)` | globs | What the note is about: the files whose touch shows it, or, at `command`, the command lines it is about (`"npm install*"`) |
| `.ignore(…globs)` | globs | Carve-outs from `.on(…)` |
| `.for(category)` | category | Binds the note to an actor. Only that category is shown it |
| `.text(str)` / `.file(path)` | prose | The note itself. Exactly one of the two |
| `.description(str)` | string | What the entry is for, for the reader |
| `.disabled(why)` | string | Turns the entry off, on the record. The reason prints in `flow status` |

## Cases

A case is a canned `ctx`. Its shape picks which moment's dialect it speaks, and that must be a moment the entry runs at. A guardrail with no block case does not load.

| Case shape | Dialect |
| --- | --- |
| `"a string"` or `{ command }` | command |
| `{ path, content }` | write (a file rule). Add `actor: [...]` to the case to give the canned session its category names. Add `existed: true` or `existed: false` to test a change a shell command made: it sets `ctx.file.existed` |
| `{ staged }` | commit. Add `added: [...]` to list the staged paths the last commit does not have: it sets each file's `ctx.file.existed`. Add `deleted: { path: content }` to list the files the commit deletes, each with its content as the last commit has it: a rule bound at both `deletion` and `commit` is called with each one, as a delete |
| `{ actions }` | turn-end |

Any case may include a `world`, which is `{ fs, exec, git }` answers, for a rule that reaches past its facts:

```
.test({
  pass:  ["git push origin main"],
  block: ["git push --force origin main"],
})

.test({
  pass:  [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
  block: [{ staged: ["a.txt"], world: { fs: { "a.txt": "SECRET" } } }],
})
```

`flow test` runs every case. See [how to test your rules](../how-to/test-your-rules.md).

## Categories

`defineCategory(name, classify)` is a name with its recognizer, bound to a rule with `.for(…)`. The classifier reads host-written evidence, never a claim the session made about itself. The stock `spawnedAs("builder")` classifies by the agent a spawn was registered as.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
// …then, on an entry:  .for(subagent)
```

Why a category reads evidence the host wrote is on [rules bound to who](../explanation/rules-bound-to-who.md).

## What the loader refuses

Each refusal is a closed code that includes the entry it names. It is a compile error in your editor, and it is checked again at load for a config edited outside one.

| Code | Cause |
| --- | --- |
| `not-a-pack` | A binding was given something that is not a pack |
| `missing-parameter` | A pack with a mandatory typed parameter was bound without it |
| `unknown-entry` | An override names an entry the pack does not have |
| `unknown-key` | A verb outside the closed set |
| `unknown-moment` | A moment outside the seven |
| `missing-mandatory` | A guardrail without `.at`, `.check` or `.message` |
| `undeclared-category` | `.for(…)` a category nothing declared |
| `no-cases` | A guardrail with no block case |
| `duplicate-id` | Two entries share a name in one pack |
| `bad-check-options` | A check was configured with options it cannot work with, and said so. For example, a depcruise layer written as a regex where the dialect takes globs. The check's own sentence is the refusal |
| `dead-scope` | An `.on(…)` that could never narrow anything. It is refused, not ignored |

> [!IMPORTANT]
> If the file does not load at all, every gated moment refuses until it is fixed. A write to `flow.config.ts` or to a pack it imports still goes through, so the config can be repaired. See [fail loud](../explanation/fail-loud.md).

---

[Index](../index.md) · when each rule runs: [moments](./moments.md) · what a check is called with: [the ctx a check reads](./ctx.md) · each stock check's options: [the stock checks](../index.md#the-stock-checks--one-page-each) · the terms: [vocabulary](./vocabulary.md)
