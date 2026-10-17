---
summary: "`flow.config.ts`, its settings, a pack, every verb of a guardrail and a breadcrumb, cases, categories, and what the loader refuses"
---

# The config

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
| `override(x.entry)` | Changes one entry of a bound pack. Chain the keys that change: `.at(…)`, `.on(…)`, `.ignore(…)`, `.for(…)`, `.message(…)`, `.text(…)`, `.file(…)`, `.description(…)` or `.disabled("why")`. An override has no `.check(…)` and no `.test(…)`. Each key replaces the pack's whole value for that key, and is never merged with it. A key the override does not name keeps the pack's value. Overrides are resolved after every pack is bound, so an override may sit above the `pack(…)` line it changes |
| `defineConfig([…], settings)` | The same guard, plus the settings below, as an optional second argument |

### Settings

The settings apply to the whole run rather than to one entry, so they are `defineConfig`'s optional second argument and not part of the sentence grammar. A config that sets nothing writes `defineConfig([…])`.

| Key | Type | Meaning |
| --- | --- | --- |
| `revert` | `"refused"` or `"all"` | What is put back when a rule refuses a write that has already landed on disk. To revert a file is to write its previous content back over it. `"refused"` is the default: only the files the rule refused are put back, and every other file the same tool call changed stays as that call left it. `"all"` puts back every file that call changed. When two or more agents are running tool calls that overlap in time, `"all"` is ignored, only the refused files are put back, and the refusal message says that happened |
| `snapshotInclude` | array of globs | Ignored paths to record in the snapshot as well. The snapshot is the record of every file's content that flow takes before a tool call and compares against the tree after the call. It holds what git holds: every tracked file, and every untracked file git does not ignore. A file git ignores is left out unless a glob here matches it. Each entry is a glob: a pattern that matches file paths. A rule that guards `.env` works only while `.env` is in the snapshot. `flow status` shows a red line for a rule whose scope reaches an ignored path that no glob here includes |
| `driftTokens` | number | How far the session's context size must grow, in tokens, before a breadcrumb that has already been shown is shown again. It applies to every breadcrumb except a `session` one. The context size is read from the last message's input and cache tokens. The default is 200,000. It is one value for the whole repo, which is why it is not set on entries |
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

A guardrail is a rule that refuses a write, a command or a commit. Every verb is a method, and saying one twice is a compile error. `.at(…)`, `.check(…)`, `.message(…)` and `.test(…)` are mandatory: a guardrail missing one is a compile error. A guardrail with `.disabled(…)` is exempt from all four.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | moments | **Mandatory.** When it runs. See [moments](./moments.md) |
| `.on(…globs)` | globs | The files it watches. With no `.on(…)`, a file rule watches every path. `.on()` with no globs is refused. A command rule takes none |
| `.ignore(…globs)` | globs | Carve-outs from `.on(…)`. `.ignore()` with no globs is refused |
| `.for(…categories)` | categories | Binds the rule to actors. It runs only for a session that has at least one of the categories. With no `.for(…)`, it runs for every session |
| `.check(fn)` | a check | **Mandatory.** A function of `ctx`, or a stock check such as `textBan({…})` |
| `.message(str)` | string | **Mandatory.** What the blocked person reads |
| `.description(str)` | string | What the entry is for, for the reader |
| `.test({ pass, block })` | cases | **Mandatory.** What must pass and what must block. A guardrail with no block case does not load |
| `.disabled(why)` | string | Turns the entry off, on the record. The reason prints in `flow status` |

## A breadcrumb

A breadcrumb is a note shown to the agent. It has no rail to block with, so it has no `.check(…)` or `.message(…)`. It has prose instead.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | `session · touch · command · turn-end` | **Mandatory.** When the note shows. Each time a `turn-end` note shows, the agent takes one more turn to read it. See [the turn-end moment](./moments.md#the-turn-end-moment) |
| `.on(…globs)` | globs | What the note is about: the files whose touch shows it, or, at `command`, the command lines it is about (`"npm install*"`). `.on()` with no globs is refused |
| `.ignore(…globs)` | globs | Carve-outs from `.on(…)`. `.ignore()` with no globs is refused |
| `.for(…categories)` | categories | Binds the note to actors. Only a session that has at least one of the categories is shown it |
| `.text(str)` / `.file(path)` | prose | The note itself. Exactly one of the two is mandatory. A breadcrumb with both is refused. On an override, either one replaces the pack's prose, whichever of the two the pack used |
| `.description(str)` | string | What the entry is for, for the reader |
| `.disabled(why)` | string | Turns the entry off, on the record. The reason prints in `flow status` |

## Cases

A case is a canned `ctx`. Its shape picks which moment's dialect it speaks, and that must be a moment the entry runs at. A guardrail with no block case does not load, whatever pass cases it has.

| Case shape | Dialect |
| --- | --- |
| `"a string"` or `{ command }` | command |
| `{ path, content }` | write (a file rule). Add `existed: true` or `existed: false` to test a change a shell command made: it sets `ctx.file.existed` |
| `{ staged }` | commit. Add `added: [...]` to list the staged paths the last commit does not have: it sets each file's `ctx.file.existed`. Add `unchanged: [...]` to list the staged paths identical to the last commit, as `flow hook commit --all` passes them: it sets each one's `ctx.file.unchanged`. Add `deleted: { path: content }` to list the files the commit deletes, each with its content as the last commit has it: a rule bound at both `deletion` and `commit`, with paths in `.on(…)`, is called with each one, as a delete |
| `{ actions }` | turn-end |

Any case may add `actor: [...]`, the category names of the canned session.

Any case may include a `world`, for a rule that reaches past its facts. A reach the world does not answer fails the case.

| `world` key | Answers |
| --- | --- |
| `fs` | the files `ctx.fs` reads, by path. A path not listed does not exist |
| `exec` | `ctx.exec`, by command: `{ stdout, stderr, code }` |
| `gitDiff` | what `ctx.git.diff()` returns |
| `staged` | what `ctx.git.stagedFiles()` returns when the case has no staged set of its own |


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

`defineCategory(name, classify)` is a name with its recognizer, bound to a rule with `.for(…)`. The classifier reads host-written evidence, never a claim the session made about itself.

`spawnedAs(recipe)` builds a classifier from the agent type a spawn was registered as. The recipe is an object:

| Key | Value |
| --- | --- |
| `types` | agent types that are this category |
| `generic` | the harness's generic agent types, the only ones whose brief is read |
| `brief` | text that marks a generic spawn's brief as this category |
| `parent` | `true` for the top-level session only |

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
const builder = defineCategory("builder", spawnedAs({ types: ["builder"] }));
// …then, on an entry:  .for(subagent)
```

Why a category reads evidence the host wrote is on [rules bound to who](../explanation/rules-bound-to-who.md).

## What the loader refuses

Each refusal is a closed code that includes the entry it names. The loader checks every one at load. Most are also compile errors in your editor. These are caught only at load:

- **`duplicate-id`** and **`bad-check-options`**, always.
- **`no-block-cases`**, when `.test(…)` is written with no block case in it.
- **`dead-scope`**, when `.on(…)` comes before `.at(…)`.
- **`empty-scope`**, when `.on(…)` or `.ignore(…)` spreads a list that turns out empty, such as `.on(...files)`.
- **`unknown-entry`**, when the override names an entry of a pack the config does not bind.

| Code | Cause |
| --- | --- |
| `not-a-pack` | A binding was given something that is not a pack |
| `missing-parameter` | A pack with a mandatory typed parameter was bound without it |
| `unknown-entry` | An override names an entry the pack does not have |
| `unknown-key` | A verb outside the closed set |
| `unknown-moment` | A moment the entry's kind has no rail for: a breadcrumb at `write`, `delete` or `commit`, or a guardrail at `session` or `touch` |
| `missing-mandatory` | A guardrail without `.at`, `.check` or `.message`, or a breadcrumb without `.at` or without `.text`/`.file`. A disabled entry is exempt |
| `undeclared-category` | `.for(…)` a category nothing declared |
| `no-block-cases` | A guardrail with no block case. Pass cases alone do not count |
| `duplicate-id` | Two entries have the same id, `<pack>.<entry>`: one pack bound twice, or two packs with the same name |
| `bad-check-options` | A check was configured with options it cannot work with, and said so. For example, a depcruise layer written as a regex where the dialect takes globs. The check's own sentence is the refusal |
| `empty-scope` | An `.on()` or `.ignore()` with no globs, on an entry or an override |
| `double-prose` | A breadcrumb with both `.text(…)` and `.file(…)` |
| `dead-scope` | An `.on(…)` or `.ignore(…)` on an entry whose moments carry no path or command to narrow, such as a guardrail only at `command` or `turn-end`, or a breadcrumb only at `session` or `turn-end` |

> [!IMPORTANT]
> If the file does not load at all, every guardrail and breadcrumb is off until it is fixed. Every write, delete and command goes through, and the agent is given the load error with each one. Every commit is refused. See [fail loud](../explanation/fail-loud.md).

---

[Index](../index.md) · when each rule runs: [moments](./moments.md) · what a check is called with: [the ctx a check reads](./ctx.md) · each stock check's options: [the stock checks](../index.md#the-stock-checks--one-page-each) · the terms: [vocabulary](./vocabulary.md)
