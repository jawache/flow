# Config reference

docs/user/02 · every verb of the grammar, every accepted value · 2026-09-06

This page is a lookup table, not a lesson: every verb of the flow sentence grammar, what it accepts, and what the loader refuses. If you are learning the guard, start with the [guidebook](./00-guide.md) — come here when you need the exact shape. Because the config is TypeScript, most of what this page calls a refusal is a compile error you see in your editor; the loader checks the same things again at run time, for a config edited outside one.

## The file

`flow.config.ts` sits at the repo root. It imports its packs, binds them, and exports one `defineConfig([...])`. A rule not reachable from it does not run.

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
| `defineConfig([…])` | the whole guard — a list of bindings, exported as the file's default |
| `pack(x)` | bind a pack: every entry in it goes live |
| `pack(x, params)` | bind a pack that declares mandatory typed parameters — a repo fact it needs to work; omitting one does not compile |
| `override(x.entry)` | bend one entry of a bound pack — chain the keys that change; each replaces the pack's whole value, never merges |
| `defineConfig([…], settings)` | the same guard, plus the engine's dials — an optional trailing object, below |

### Settings

The dials are about the *run* rather than about any one entry, so they are `defineConfig`'s optional second argument and not part of the sentence grammar. A config that sets nothing writes `defineConfig([…])` as before.

| Key | Type | Meaning |
| --- | --- | --- |
| `revert` | `"file"` or `"call"` | what is put back when a rule refuses a write that has already landed on disk. To revert a file is to write its previous content back over it. `"file"` is the default: only the files the rule refused are put back, and every other file the same tool call changed stays as that call left it. `"call"` puts back every file that call changed. When two or more agents are running tool calls that overlap in time, `"call"` is ignored, only the refused files are put back, and the refusal message says that happened |
| `snapshotIgnore` | array of globs | paths kept out of the snapshot. The snapshot is the record of every file's content that flow takes before a tool call and compares against the tree after the call. Each entry is a glob — a pattern that matches file paths. `.git` and `node_modules` are always out of the snapshot, and what you list here is kept out in addition to those two. Every other path is in the snapshot, whether git ignores it or not. A rule that guards `.env` works only while `.env` is in the snapshot |
| `driftTokens` | number | context tokens between re-showings of a `touch` breadcrumb. Absent = the engine's own default. It is one answer for the whole repo, which is why it is not on entries |
| `grammars` | array | grammars this repo built itself, for `astGrep` rules whose language nobody publishes — each `{ name, libraryPath, extensions, languageSymbol? }`. The path is relative to the repo root or absolute, and it is a build artefact: `flow status` is a red line naming the file until it is built, and the rules on that language refuse rather than passing quietly |

```
export default defineConfig([pack(house)], { driftTokens: 120_000 });
```

## Defining a pack

A pack is a module: `definePack("name", { … })` whose values are sentences. It lives in `guards/` or in an npm package — identical shape.

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

## The sentence — a guardrail

Every verb is a method; saying one twice is a compile error. `.at(…)`, `.check(…)` and `.message(…)` are mandatory; a guardrail missing one does not load.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | moments | **mandatory.** When it fires — the moments table below |
| `.on(…globs)` | globs | the files it watches. A file rule needs it; a command rule takes none. An empty scope is refused |
| `.ignore(…globs)` | globs | carve-outs from `.on(…)` |
| `.for(category)` | category | bind the rule to an actor — it fires only for that category |
| `.check(fn)` | a check | **mandatory.** A function of `ctx`, or a stock check like `textBan({…})` |
| `.message(str)` | string | **mandatory.** What the blocked person reads |
| `.description(str)` | string | what the entry is for, for the reader |
| `.test({ pass, block })` | cases | what must pass and what must block — a guardrail with no block case does not load |
| `.disabled(why)` | string | turn the entry off, on the record; the reason prints in `flow status` |

### A breadcrumb

A breadcrumb steers and has no rail to block with, so it carries no `.check(…)` or `.message(…)` — it carries prose instead.

| Verb | Value | Meaning |
| --- | --- | --- |
| `.at(…moments)` | `session · touch · command · turn-end` | **mandatory.** When the note shows |
| `.on(…globs)` | globs | what the note is about — the files whose touch shows it, or, at `command`, the command lines it is about (`"npm install*"`) |
| `.ignore(…globs)` | globs | carve-outs from `.on(…)` |
| `.for(category)` | category | bind the note to an actor — only that category is shown it |
| `.text(str)` / `.file(path)` | prose | the note itself — exactly one of the two |
| `.description(str)` | string | what the entry is for, for the reader |
| `.disabled(why)` | string | turn the entry off, on the record; the reason prints in `flow status` |

## Moments

Moments are imported symbols. `deletion` and `turnEnd` are spelled that way because `delete` is a reserved word — the moment is still “delete”.

| Symbol | Moment | For | Fires |
| --- | --- | --- | --- |
| `write` | write | guardrail | a file is created or changed. When the Edit or Write tool makes the change, the rule runs before the change reaches the disk, on the would-be content of the file held in memory. When anything else makes the change — a heredoc, `sed -i`, a script, a recipe, an MCP tool — the rule runs the moment the change has reached the disk, and a refusal writes the previous content back. A refused write never stays on disk |
| `command` | command | guardrail | before a shell command runs |
| `deletion` | delete | guardrail | a file is removed. When an `rm` command would remove it, the rule runs before that command runs. When anything else removes it, the rule runs the moment the file is gone, and a refusal writes the file back |
| `commit` | commit | guardrail | the git pre-commit gate, over the staged set — for humans too |
| `turnEnd` | turn-end | either | when the agent hands back |
| `session` | session | breadcrumb | a chat starts, resumes, or is compacted |
| `touch` | touch | breadcrumb | a tool call first names a matching file, or a shell command reads one. The note is shown again after drift: once the session has spent the `driftTokens` budget of tokens since the last showing, about 200,000 by default. If a matching file is changed before any tool call has named it and before any command has read it, the note is shown at that change instead |
| `command` | command | either | before a shell command runs. A guardrail refuses it; a breadcrumb rides the same answer as a note, scoped by `.on(…)` to the commands it is about |

`command` is the one moment where the two kinds are scoped differently. A command *guardrail* takes no `.on(…)` — its patterns are its scope, and a second way to narrow it is two halves that can disagree. A command *breadcrumb* has no patterns at all, so `.on(…)` is the only thing that says which commands it is about; without one it would show on every shell call, which is the same as showing on none.

## The `ctx` a check reads

A check is `(ctx) => ctx.ok() | ctx.fail(detail)`, and `ctx` is its only door to the world. What is populated depends on the moment.

| Field | Is |
| --- | --- |
| `ctx.file` | the file this moment is about — `{ path, content }` — at a file moment. At write, `content` is the would-be bytes when the Edit tool made the change, and the bytes now on disk when a shell command made it. A check reads `content` the same way in both cases |
| `ctx.command` | the shell command line, at the command moment |
| `ctx.staged` | the staged paths, at the commit moment |
| `ctx.turn` | the turn's actions (edits and runs), at turn-end |
| `ctx.actor` | the category names that match the session making this change. Each name comes from evidence the host wrote about that session, never from a claim the session made about itself. The stock `oneWriter` check reads this field |
| `ctx.moment` | which moment this is |
| `ctx.fs` · `ctx.exec` · `ctx.git` | the effects — read a file, run a command, ask git; the only way a check reaches beyond its facts |
| `ctx.ok()` · `ctx.fail(detail)` | the verdict — a pass, or a block carrying the detail line |

## Cases

A case is a canned `ctx`, and its *shape* chooses which moment's dialect it speaks — which must be a moment the entry fires at. A guardrail with no block case does not load.

| Case shape | Dialect |
| --- | --- |
| `"a string"` or `{ command }` | command |
| `{ path, content }` | write (a file rule). Add `actor: [...]` to the case to give the canned session its category names |
| `{ staged }` | commit |
| `{ actions }` | turn-end |

Any case may carry a `world` — `{ fs, exec, git }` answers — for a rule that reaches past its facts:

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

## Categories

`defineCategory(name, classify)` is a name with its recognizer aboard, bound to a rule with `.for(…)`. The classifier reads host-written evidence, never a claim the session made about itself. The stock `spawnedAs("builder")` classifies by the agent a spawn was registered as.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
// …then, on an entry:  .for(subagent)
```

## What the loader refuses

Each is a closed refusal code carrying the entry it names — a compile error in your editor, and checked again at load for a config edited outside one:

| Code | Cause |
| --- | --- |
| `not-a-pack` | a binding was handed something that is not a pack |
| `missing-parameter` | a pack with a mandatory typed parameter was bound without it |
| `unknown-entry` | an override names an entry the pack does not have |
| `unknown-key` | a verb outside the closed set |
| `unknown-moment` | a moment outside the seven |
| `missing-mandatory` | a guardrail without `.at`, `.check` or `.message` |
| `undeclared-category` | `.for(…)` a category nothing declared |
| `no-cases` | a guardrail with no block case — the class this whole grammar exists to catch |
| `duplicate-id` | two entries share a name in one pack |
| `bad-check-options` | a check was configured with options it cannot work with, and said so — a depcruise layer written as a regex where the dialect takes globs, for instance. The check's own sentence is the refusal |
| `dead-scope` | an `.on(…)` that could never narrow anything — refused, not ignored |

And if the file will not load at all, every gated moment refuses, loudly, until it is fixed — a guard that fails open is a guard that lies about being there. The one exception is the repair: see the [guidebook](./00-guide.md#7--fail-loud--and-the-one-repair-exception).

---

docs/user/02 · Verified against the shipped binary. The situational account is the [guidebook](./00-guide.md); each stock check's options are on its [page](./index.md#the-stock-checks--one-page-each).
