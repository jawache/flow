[flow packs](./index.md) › justfile

# The `justfile` pack

3 guardrails · 2 breadcrumbs · fires at: session · touch · write · commit · command · takes 3 parameters

The justfile is the repo's TOOL CATALOGUE.

The frame: the justfile plays the role MCP tools play elsewhere — the discovery surface an agent
can reach for with confidence. `just --list` is the manifest and each `[doc]` string is a tool
description. Every entry here is the same arrow pointing at it: the orientation says look here
first, `node/noPackageScripts` closes the decoy surface agents habitually read, and `justfileDocs`
keeps the manifest readable.

Generated from `packs/justfile.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 3 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `exempt` | `readonly string[]` | Recipe names that owe no `[doc("…")]`. Usually empty, and MANDATORY so that it is empty on the record rather than by default — an exemption list nobody stated is one nobody reviews.<br><br>A parameter rather than an override, because `exempt` is the CHECK's option and an override speaks only the sentence keys (at · for · on · ignore · message · disabled).<br><br>`[private]` recipes need no entry — `just --list` hides them, so the check skips them. |
| `tools` | `string` | The folder holding the code behind the recipes. Defaults to `tools`. |
| `recipes` | `Readonly<Record<string, string>>` | Commands this repo has a recipe for, as a map from the command's pattern to the recipe that replaces it — `{ "npm run build": "just build" }`.<br><br>OPTIONAL, and with no map there is no entry at all: which raw command a repo has wrapped is a fact only that repo has, and a rule with an empty list would be one more armed entry matching nothing. The patterns are regular expressions over the command line, so `npx vitest\\b` is a pattern and `npx vitest` is one too.<br><br>The catalogue's whole promise is that the recipe is the thing to reach for; a breadcrumb says so once a session, and this refuses the raw command by name for the ones that matter. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { justfile } from "@jawache/flow/packs";

export default defineConfig([pack(justfile, { exempt: [], recipes: { "npx vitest": "./ci.sh test" } })]);
```

To turn one entry off, say so in the config: `override(justfile.orientation).disabled("why")`. It is a committed change, so a reviewer sees it.

## What to install first

`just` itself — `brew install just`, or see https://just.systems. Every rule here reads
a `justfile` at the repo root and none of them shells out, so nothing else is needed.

## What the repo needs in place

A `justfile` at the root whose every non-private recipe carries a `[doc("…")]`, and a
`package.json` whose `scripts` block holds nothing but `//`-prefixed comment keys. A repo with
live npm scripts moves them into recipes first, or does not bind this pack.

## Entries

- [`justfile.orientation`](#justfileorientation--breadcrumb) · breadcrumb · Where the repo's tooling is catalogued, what earns a recipe, and what stays a script.
- [`justfile.toolsHome`](#justfiletoolshome--breadcrumb) · breadcrumb · The fork every file in tools/ faces — catalogue entry, or one-shot.
- [`justfile.node.noPackageScripts`](#justfilenodenopackagescripts--guardrail) · guardrail · package.json scripts stays empty — the justfile is the single command source.
- [`justfile.justfileDocs`](#justfilejustfiledocs--guardrail) · guardrail · Every justfile recipe carries an explicit [doc] — `just --list` is the catalogue's help screen.
- [`justfile.useTheRecipe`](#justfileusetherecipe--guardrail) · guardrail · A command the repo has a recipe for is refused, and the refusal names the recipe.

## `justfile.orientation` — breadcrumb

Where the repo's tooling is catalogued, what earns a recipe, and what stays a script.

- **Shown when** once, at the start of a session
- **Watches** not scoped by path
- **Categories** every session

### Why it exists

Without it, an agent discovers commands from package.json, from memory, or from a README that
has drifted — and reaches for a tool this repo does not have, or hand-runs the chain a recipe
already spells correctly.

### What the agent reads

```
The justfile is this repo's tool catalogue — the single source of truth for the tooling you can confidently reach for. Run `just` FIRST to see what you can do here; do not discover commands from package.json or memory.
A recipe means: reach for this repeatedly, with confidence. Recipes stay thin — the code behind one lives in `tools/`; one-off operational scripts live there too and never become recipes.
A one-off command or chain is fine to run directly. Anything you'll run more than once becomes a script; anything a human should also run becomes a recipe (with a [doc("…")]).
If a service offers a CLI, prefer it over an MCP — a command is recorded, guardable and reproducible.
```

## `justfile.toolsHome` — breadcrumb

The fork every file in tools/ faces — catalogue entry, or one-shot.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `tools/**`
- **Categories** every session

### Why it exists

Without it, everything in the tools folder is treated the same way: one-shots get promoted
into the catalogue until `just --list` is noise, or a genuinely repeatable tool is left with
no recipe pointing at it and nobody finds it again.

### What the agent reads

```
You are writing into `tools/` — the implementation layer, not the catalogue. Decide which of two things this file is:
Repeatable — part of the catalogue? Then it also needs a thin justfile recipe pointing at it, with a [doc("…")] — a tool that exists only in `tools/` is undiscoverable.
A one-off (a migration, a backfill, a workflow step)? Then it gets NO recipe — one-shots promoted into the catalogue are how `just --list` becomes noise and stops being trustworthy.
```

## `justfile.node.noPackageScripts` — guardrail

package.json scripts stays empty — the justfile is the single command source.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `package.json`
- **Categories** every session
- **Check** [`jsonInvariant`](../checks/json-invariant.md)

<details><summary>settings</summary>

```
{
  "assert": [
    {
      "path": "scripts",
      "keysPrefixedWith": "//"
    }
  ]
}
```

</details>

### Why it exists

Without it, package.json grows a second command surface — the one an agent reads FIRST, out
of habit — and the two drift until the catalogue is no longer the truth about this repo.

### What the agent reads when refused

```
package.json `scripts` must stay empty — the justfile is the catalogue, and a second command surface is one an agent reads instead of it. Only //-prefixed comment keys are allowed; move the command into a justfile recipe.
```

### Proved by

**passes**

- writing `package.json` — `{"scripts":{"//":"see the justfile"}}`

**blocks**

- writing `package.json` — `{"scripts":{"dev":"vite"}}`

## `justfile.justfileDocs` — guardrail

Every justfile recipe carries an explicit [doc] — `just --list` is the catalogue's help screen.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `justfile`
- **Categories** every session
- **Check** `justfileDocs` *(written in this pack)*

<details><summary>settings</summary>

```
{
  "exempt": []
}
```

</details>

### Why it exists

Without it, `just --list` falls back to the last comment line above a recipe, which for a
multi-line comment block is a mid-sentence fragment — a help screen assembled by accident, and
a tool nobody can choose from its description.

### What the agent reads when refused

```
Every non-private justfile recipe needs an explicit [doc("…")] — `just --list` is the tool catalogue's help screen, and an undocumented recipe is a tool nobody can choose. ([private] recipes are exempt; they're hidden from the listing.)
```

### Proved by

**passes**

- writing `justfile` — `[doc("Run the suite.")] test: npx vitest run`
- writing `justfile` — `[private] _helper: echo hi`
- writing `justfile` — `set shell := ["bash", "-c"] port := "3000"`
- writing `justfile` — `import "other.just" mod sub [doc("Run it.")] test: npx vitest run`
- writing `justfile` — `[private] [doc("why")] a: echo x`
- writing `justfile` — `[doc("why")] [private] b: echo x`
- writing `justfile` — `[doc("why")] a: echo "test: not a recipe"`

**blocks**

- writing `justfile` — `test: npx vitest run`
- writing `justfile` — `[doc("belongs to a")] a: echo x b: echo y`
- writing `justfile` — `greet name: echo {{name}}`
- writing `justfile` — `@quiet: echo hi`

## `justfile.useTheRecipe` — guardrail

A command the repo has a recipe for is refused, and the refusal names the recipe.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "npx vitest"
  ]
}
```

</details>

### What the agent reads when refused

```
This repo has a recipe for that command — use it. The catalogue is the tooling you can reach for with confidence, and a raw command run beside it is the one nobody sees, nobody documents and nobody can change in one place.
· `npx vitest` → `./ci.sh test`
```

### Proved by

**passes**

- running `./ci.sh test`

**blocks**

- running `npx vitest`

## Where each part of this page comes from

| On the page | In the pack | Read how |
| --- | --- | --- |
| Lead, and the parameters table | The doc comment on `definePack`, and the doc comment on each member of the parameter interface | JSDoc, read with the TypeScript compiler API |
| The named sections above the entries | An `@install`, `@setup` or `@adopt` tag on that same doc comment. A tag nobody uses renders nothing. | JSDoc tags |
| Entry id, kind, moments, globs, categories, description | The entry itself — `.at()` `.on()` `.description()` | Loaded: the same data the engine runs |
| Why it exists | The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason. | JSDoc |
| What the agent reads | `.text()` or `.message()`, verbatim | Loaded |
| Check and its settings | The check the entry asks, and the options it was given | The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied. |
| Proved by, and what each case was told | `.test({ pass, block })` — the event, and the `world` the case supplies for whatever the check reads | Loaded |

---

flow docs · [the packs](./index.md) · `justfile` · generated page, do not edit
