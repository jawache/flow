[flow packs](./index.md) › flow

# The `flow` pack

1 guardrail · 2 breadcrumbs · fires at: session · touch · delete · takes 2 parameters

flow's own orientation and self-protection, as a pack any repo binds.

Every guarded repo wants these three: a note saying what is steering you, a nudge when you edit
the steering itself, and a refusal when a command would delete it.

Generated from `packs/flow.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 2 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `packs` | `readonly string[]` | Every glob covering a pack file `flow.config.ts` imports — one entry per folder a repo keeps its own packs in, and `[]` in a repo whose rules are all written inline in the config.<br><br>MANDATORY, and empty is a real answer rather than the absence of one. An unstated list is a list nobody reviews, and here it decides what two rules watch: the nudge when you edit the guard, and the refusal to delete it. Both name it and neither defaults.<br><br>The engine derives the REPAIR surface from the config's imports directly (`configSurface`), because it is asked in the broken state and can only read text. This is the same fact asked at a moment where the config loads, so it is stated once, here, and typed. |
| `hostSurface` | `readonly string[]` | The harness's own permission surface — the files an agent's tools and permissions are declared in. Defaults to Claude Code's: `.claude/settings.json`, `.claude/settings.local.json`, `.claude/agents/**` and `.claude/skills/**`.<br><br>The edit nudge fires on these as well as on the guard itself, because a tool list and a hook registration decide what any rule here can ever see. A repo on another harness names its own files; a repo with none passes `[]`. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

export default defineConfig([pack(flow, { packs: ["rules/**"] })]);
```

To turn one entry off, say so in the config: `override(flow.orientation).disabled("why")`. It is a committed change, so a reviewer sees it.

## What the repo needs in place

A `flow.config.ts` at the repo root and a folder for the packs the repo writes itself —
whatever it is called, named here as the `packs` parameter. `flow init` writes both.

## Adopting it

Bind it first, before any other pack: it is the one every guarded repo wants whether or
not it agrees with a single other opinion in this package.

## Entries

- [`flow.orientation`](#floworientation--breadcrumb) · breadcrumb · What the guard layer is and how it steers — shown at the start of every session.
- [`flow.editingTheGuardrails`](#floweditingtheguardrails--breadcrumb) · breadcrumb · A nudge when you edit the guardrails themselves; it never blocks.
- [`flow.noDeleteGuardrails`](#flownodeleteguardrails--guardrail) · guardrail · Stops a command from deleting the committed guard surface. No bypass — disable entries in the file instead.

## `flow.orientation` — breadcrumb

What the guard layer is and how it steers — shown at the start of every session.

- **Shown when** once, at the start of a session
- **Watches** not scoped by path
- **Categories** every session

### Why it exists

Without it, an agent works in a guarded repo without knowing it is guarded: a refusal arrives
with no model of where it came from, and the config that produced it is just another file.

### What the agent reads

```
This repo is guarded by flow. Guardrails judge every change to the tree — an Edit before it lands, a shell edit the moment it has landed — and a refused write never persists: it is undone, and you are told why. The commit gate judges again. Breadcrumbs steer you by area as you touch files, whether you read them with a tool or with cat.
The whole guard is `flow.config.ts` — every rule that fires is reachable from that one file, whether it comes from a pack the config imports or from a pack this repo writes itself. Nothing resolves at run time and nothing defaults: what you read there is what fires. Authoring a new entry is always welcome; never loosen a guardrail to get an edit through — that is the user's call.
There is no bypass token anywhere in this system. A guardrail is on or off, and turning one off is `override(pack.entry).disabled("why")` in flow.config.ts — a committed change, visible in review.
If the config will not load, every gated moment refuses until it is fixed. A guard that fails open is a guard that lies about being there. The ONE exception is the repair itself: while the config is broken you may still write `flow.config.ts` and the pack files it imports, because otherwise the rule that demands a fix also forbids it. Commands stay blocked, and so does the commit gate — nothing written under that exception reaches a commit until the config loads green.
```

## `flow.editingTheGuardrails` — breadcrumb

A nudge when you edit the guardrails themselves; it never blocks.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `flow.config.ts` · `rules/**` · `.claude/settings.json` · `.claude/settings.local.json` · `.claude/agents/**` · `.claude/skills/**`
- **Categories** every session

### Why it exists

Without it, the steering layer gets edited like any other file — a rule loosened in passing,
a hook rewritten mid-task — and the guard changes without anybody deciding that it should.

### What the agent reads

```
You are editing the guardrails themselves.
If this edit weakens, disables or removes a guardrail or a permission because it just blocked you — stop and confirm with the user first.
Authoring new entries is always fine; loosening one to get an edit through is the user's call, not yours.
An AGENT DEFINITION is a permission surface too: its `tools:` list decides what that agent can do, and the installed link is live — the file you are editing is the one that takes effect, with nothing between your edit and every future session. Widening a tool list, or adding a permissionMode, is the user's call — a mode added as a hardening is as likely to be a loosening.
Whatever you are authoring here — a `.message(…)`, a finding format, a warning — name what was SEEN (which file, which commit, which command) and what that specific cause wants done. A condition that cannot produce a distinguishing message is two rules, not one: split it. A detector that emits the same sentence for causes the reader must answer differently teaches them to talk past it, and then fails silently on the one occasion it was right.
Every guardrail carries its own cases. Add the block case first — a rule whose block case passes is a rule that catches nothing, and `flow test` is what says so.
```

## `flow.noDeleteGuardrails` — guardrail

Stops a command from deleting the committed guard surface. No bypass — disable entries in the file instead.

- **Refuses at** a file is deleted
- **Watches** `flow.config.ts` · `rules/**` · `.githooks/pre-commit`
- **Categories** every session
- **Check** [`protectedPath`](../checks/protected-path.md) — no options

### What the agent reads when refused

```
That command would delete this repo's guard surface (flow.config.ts binds every rule; the packs it imports are where this repo writes its own; .githooks/pre-commit is what runs them at the gate). Deleting any of them is the same attack. There is no bypass — `override(pack.entry).disabled("why")` inside flow.config.ts is the visible, committed route.
```

### Proved by

**passes**

- *no pass case declared*

**blocks**

- writing `flow.config.ts`
- writing `.githooks/pre-commit`

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

flow docs · [the packs](./index.md) · `flow` · generated page, do not edit
