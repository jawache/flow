[flow packs](./index.md) › docs

# The `docs` pack

1 guardrail · 2 breadcrumbs · fires at: touch · write · commit · takes 2 parameters

*No lead. Add a doc comment on `definePack` saying what this pack is for.*

Generated from `packs/docs.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 2 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `root` | `string` | The documentation folder, as a path from the repo root. Defaults to `docs`.<br><br>Both guardrails and both breadcrumbs are scoped to it, so a repo whose pages live in `documentation/` names that here and keeps every rule. |
| `allow` | `readonly string[]` | Filenames allowed to sit LOOSE at the top of that folder, beside the two doors. Defaults to none — every file belongs behind `user/` or `agent/`.<br><br>A repo that keeps a `README.md` at the top of its docs folder names it here. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { docs } from "@jawache/flow/packs";

export default defineConfig([pack(docs, { root: "documentation", allow: ["README.md"] })]);
```

To turn one entry off, say so in the config: `override(docs.docs).disabled("why")`. It is a committed change, so a reviewer sees it.

## Entries

- [`docs.docs`](#docsdocs--breadcrumb) · breadcrumb · The two audiences, the admission test, and the discipline that keeps docs true.
- [`docs.userDocsStyle`](#docsuserdocsstyle--breadcrumb) · breadcrumb · The ruled style of docs/user — Diátaxis page discipline, the language rules, captured output.
- [`docs.docsShape`](#docsdocsshape--guardrail) · guardrail · docs/ holds exactly user/ and agent/ — the folder allowlist.

## `docs.docs` — breadcrumb

The two audiences, the admission test, and the discipline that keeps docs true.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `documentation/**`
- **Categories** every session

### Why it exists

Without it, an agent writing under `docs/` has no way to know there are two audiences. User
pages fill with rationale nobody asked for, and agent pages fill with copies of what the code
already says, which go stale silently while still reading as true.

### What the agent reads

```
Two audiences, two doors, opposite rules. `docs/user/` is for PEOPLE: HTML or markdown, entered through an index file, and multimodal on purpose — images, SVGs and short recordings are encouraged wherever they explain better than sentences. The measure of a user doc is how little work the reader has to do.
`docs/agent/` is ARCHIVAL CONTEXT, loaded on demand, entered through README.md as an index of pointers. The admission test: could a fresh agent derive this from the code, the config or the guard layer? Then it does not belong — derivable content is replication, and replication goes stale silently while still reading as true. Only expensive syntheses live here: understanding that took hours to establish and would take hours to re-derive. Pointers outward, never copies inward; this folder must never compete with the breadcrumb layer.
The style law, both sides: state CURRENT FACTS in the present tense. No litigation, no rationale essays, no history — the journal owns the past. Where a decision would otherwise look wrong, one Chesterton-fence line pointing at the decision record, never a retelling.
The failure mode is silent staleness, not error: a doc stays literally correct while a whole task's machinery lands unmentioned, and nothing complains. So if the work you just shipped changed a boundary, a component's job or the lifecycle, the doc changes in the SAME commit.
```

## `docs.userDocsStyle` — breadcrumb

The ruled style of docs/user — Diátaxis page discipline, the language rules, captured output.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `documentation/user/**`
- **Categories** every session

### Why it exists

Without it, every user page is written in whatever style that session had, and the docs read
as ten authors. Every source it cites is a public standard — Diátaxis, the Google developer
style guide — so nothing in it is one repo's taste.

### What the agent reads

```
The user docs have a ruled style — hold it:
· One page, one job (the Diátaxis framework, https://diataxis.fr): the quick start teaches by doing (explanation is linked, never inlined); the guide solves situations; reference pages state facts for lookup, no narrative.
· Language (per the Google developer style guide, https://developers.google.com/style): second person, present tense, active voice. Define a term on first use or do not use it. Spend words in proportion to difficulty — one sentence for the simple thing, the full walkthrough for the hard one. No "simply", no filler.
· Code examples are TypeScript, formatted as the repo formats it — a config example is copied from a file that compiles, never typed into the page.
· Every claim and printed output is captured from the shipped binary, never paraphrased — re-run the example before you change its text.
```

## `docs.docsShape` — guardrail

docs/ holds exactly user/ and agent/ — the folder allowlist.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `documentation/**`
- **Categories** every session
- **Check** [`canonicalFiles`](../checks/canonical-files.md)

<details><summary>settings</summary>

```
{
  "root": "documentation",
  "allow": [
    "README.md"
  ],
  "folders": [
    "user",
    "agent"
  ]
}
```

</details>

### Why it exists

Without it, `docs/` grows a third folder nobody chose — notes, scratch, drafts — and the two
doors stop being a rule. A folder with no declared audience is how a docs folder becomes a
drawer, and neither audience's rules can be applied to what is in it.

### What the agent reads when refused

```
docs/ holds exactly two doors: `user/` (for people) and `agent/` (archival context, for agents). A third folder or a loose file at the top is documentation with no declared audience, which is how a docs folder becomes a drawer.
```

### Proved by

**passes**

- writing `documentation/user/index.md`

**blocks**

- writing `documentation/notes/scratch.md`

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

flow docs · [the packs](./index.md) · `docs` · generated page, do not edit
