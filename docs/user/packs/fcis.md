[flow packs](./index.md) › fcis

# The `fcis` pack

7 guardrails · 1 breadcrumb · fires at: touch · write · commit · command · takes 6 parameters

Functional Core, Imperative Shell (Bernhardt, "Boundaries", SCNA 2012).

The one-stop shop for running FCIS in a repo: the model, the rules that hold both sides honest,
the tests that prove the pure side, and the gate on growing it.

EVERY RULE KEYS OFF ONE IDENTITY CONVENTION — the single way a repo names its pure code — and
the pack DEMANDS it rather than guessing: `Convention` is a mandatory typed parameter, so a repo
that binds this pack without saying where its pure code lives does not compile.

The import FENCE is not here and cannot be: its layers ARE a repo's architecture. What the pack
ships is the half that is true everywhere (no shell IMPORTS in pure); the fence lives in the
guarded repo's own house pack, where its layers are.

Generated from `packs/fcis.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 6 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `files` | `readonly string[]` | Every pure FILE — what the rails judge, one glob per shape the repo actually uses. |
| `homes` | `readonly string[]` | Every pure HOME — where the teaching breadcrumb fires, and what the coverage gate watches. |
| `coverage` | `string` | The recipe that runs the coverage gate. |
| `example` | `string` | ONE PURE FILE, spelled out — a path both `files` and `homes` match.<br><br>`pureCovered` and `newPureFileNeedsReason` narrow inside their CHECK rather than through `.on(…)`, so their cases have to name a concrete path, and a path the pack invented would fall outside the repo's own convention and prove nothing. Asked for rather than computed: turning a caller's glob into a concrete path is arithmetic that does not belong in a pack. A repo knows one of its own pure files; nothing else does. |
| `sibling` | `string` | Where a pure file's test sits, as a template over the file's own path. Defaults to `{dir}/{name}.test.ts`.<br><br>`{dir}` is the file's folder and `{name}` its basename without the extension. `pureHasTest` demands it exists and `pureExportsTested` reads it, so a repo whose tests live in `__tests__/` or end in `.spec.ts` states that here rather than turning both rules off. |
| `tests` | `string` | What a new pure file may be without owing a reason: a test. Defaults to a glob matching any file whose name carries `.test.`, at any depth.<br><br>It is `newPureFileNeedsReason`'s exemption, and the `example` path with `.test` before its extension is what proves it, so the two are read together. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { fcis } from "@jawache/flow/packs";

export default defineConfig([pack(fcis, { files: ["core/**/*.ts"], homes: ["core/**"], coverage: "./ci.sh coverage", example: "core/clock.ts" })]);
```

To turn one entry off, say so in the config: `override(fcis.fcis).disabled("why")`. It is a committed change, so a reviewer sees it.

## What the repo needs in place

A pure home the repo can name in globs, one real pure file to point at, and a coverage
recipe — all four parameters. The sibling-test trio reads them, so a repo that cannot say where
its pure code lives cannot bind this pack, by design.

## Adopting it

Expect the coverage gate and the sibling-test rules to fire on the first commit that
touches pure code; both are scoped to the home you named, so the way to narrow them is to narrow
that, never to disable the rule.

## Entries

- [`fcis.fcis`](#fcisfcis--breadcrumb) · breadcrumb · The functional-core/imperative-shell mental model, for when you're working in pure-core code.
- [`fcis.noSideEffectsInPure`](#fcisnosideeffectsinpure--guardrail) · guardrail · Pure code performs no I/O and reads no clock, env or randomness — a structural match, not a regex.
- [`fcis.noShellInPure`](#fcisnoshellinpure--guardrail) · guardrail · Pure code imports no filesystem, process, socket or OS module — the leak the call-site rule cannot see.
- [`fcis.noThrowInPure`](#fcisnothrowinpure--guardrail) · guardrail · Pure decisions return errors as values, never throw control flow.
- [`fcis.pureHasTest`](#fcispurehastest--guardrail) · guardrail · A pure file has its sibling test — the test-first artefact exists.
- [`fcis.pureExportsTested`](#fcispureexportstested--guardrail) · guardrail · Every exported pure function is at least referenced in its test — the 'wrote no test' nudge.
- [`fcis.pureCovered`](#fcispurecovered--guardrail) · guardrail · Blocks a commit if the pure core's coverage gate fails — only runs when pure files changed.
- [`fcis.newPureFileNeedsReason`](#fcisnewpurefileneedsreason--guardrail) · guardrail · A commit adding a non-test file to the pure core must say why the pure file it belongs in isn't the place.

## `fcis.fcis` — breadcrumb

The functional-core/imperative-shell mental model, for when you're working in pure-core code.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `core/**`
- **Categories** every session

### Why it exists

Without it, the split is a rule with no model behind it: an agent moves a side effect out of a
pure file because a guardrail refused it, learns nothing, and puts the next one back.

### What the agent reads

```
Functional Core, Imperative Shell (Bernhardt, "Boundaries", SCNA 2012).
Decisions live in pure functions, in this repo's declared pure home (see the fcis entries in flow.config.ts): no I/O, no clock, no randomness, no env — inject them as arguments; determinism IS testability.
The shell is the wiring around the core — full of functions, but never of decisions: a branch that encodes a rule or a threshold belongs in pure, even if it is currently wrapped in an `await`. Values cross the boundary, never live objects.
The shell is covered by integration tests, not unit tests.
```

## `fcis.noSideEffectsInPure` — guardrail

Pure code performs no I/O and reads no clock, env or randomness — a structural match, not a regex.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `core/**/*.ts`
- **Ignores** `**/*.test.ts`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "typescript",
  "rule": {
    "any": [
      {
        "pattern": "Date.now()"
      },
      {
        "pattern": "new Date()"
      },
      {
        "pattern": "Math.random()"
      },
      {
        "pattern": "crypto.randomUUID()"
      },
      {
        "pattern": "crypto.getRandomValues($$$)"
      },
      {
        "pattern": "fetch($$$)"
      },
      {
        "pattern": "setTimeout($$$)"
      },
      {
        "pattern": "setInterval($$$)"
      },
      {
        "pattern": "process.env"
      },
      {
        "pattern": "Bun.spawn($$$)"
      },
      {
        "pattern": "Bun.file($$$)"
      }
    ]
  }
}
```

</details>

### What the agent reads when refused

```
Impurity in the functional core. Pure code takes no clock / randomness / I/O / process.env — inject them as arguments and keep the decision pure.
  clock   → new Date() / Date.now()      (accept an injected `now`)
  random  → Math.random / crypto         (accept an injected id/rng)
  I/O     → fetch / timers / spawn       (do it in the shell)
  env     → process.env                  (pass config in)
Move the side effect to the shell and pass the pure input down.
```

### Proved by

**passes**

- writing `cli/pure/a.ts` — `export const at = (iso: string) => new Date(iso);`

**blocks**

- writing `cli/pure/a.ts` — `export const now = () => new Date();`

## `fcis.noShellInPure` — guardrail

Pure code imports no filesystem, process, socket or OS module — the leak the call-site rule cannot see.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `core/**/*.ts`
- **Ignores** `**/*.test.ts`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "typescript",
  "rule": {
    "kind": "import_statement",
    "has": {
      "kind": "string",
      "regex": "^[\"'](node:)?(fs|fs/promises|child_process|net|dns|tls|http|https|http2|os|cluster|worker_threads|readline|repl|v8|vm|zlib|dgram|inspector)[\"']$"
    }
  }
}
```

</details>

### What the agent reads when refused

```
A shell module imported into pure code. The functional core DECIDES; reaching for the filesystem, a process, a socket or the OS is the shell's job, and an import of one is a leak whatever the file then does with it.
  fs · child_process · net · dns · http(s) · os · worker_threads · cluster
Move the effect into the shell around this file and pass the values in. (`node:path` and `node:url` are string algebra and stay allowed, as does the test runner. Your own modules are fenced by the import-boundaries entry, per repo.)
```

### Proved by

**passes**

- writing `cli/pure/a.ts` — `import { join } from "node:path";`

**blocks**

- writing `cli/pure/a.ts` — `import * as fs from "node:fs";`

## `fcis.noThrowInPure` — guardrail

Pure decisions return errors as values, never throw control flow.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `core/**/*.ts`
- **Ignores** `**/*.test.ts`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "typescript",
  "rule": {
    "any": [
      {
        "pattern": "throw $X"
      },
      {
        "pattern": "Promise.reject($$$)"
      }
    ]
  }
}
```

</details>

### What the agent reads when refused

```
`throw` / Promise.reject in the functional core. Errors are VALUES here — return a Result / tagged union (ok/err) so the failure path shows in the signature and the caller must handle both arms. Adapt thrown errors to Results at the boundary, not inside pure code.
```

### Proved by

**passes**

- writing `cli/pure/a.ts` — `export const f = () => ({ ok: false as const });`

**blocks**

- writing `cli/pure/a.ts` — `export const f = () => { throw new Error("x"); };`

## `fcis.pureHasTest` — guardrail

A pure file has its sibling test — the test-first artefact exists.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `core/**/*.ts`
- **Ignores** `**/*.test.ts`
- **Categories** every session
- **Check** [`siblingExists`](../checks/sibling-exists.md)

<details><summary>settings</summary>

```
{
  "sibling": "{dir}/{name}.test.ts"
}
```

</details>

### What the agent reads when refused

```
The pure core is test-first (red → green): {dir}/{name}.test.ts is missing. Write the failing test, then the code.
```

### Proved by

**passes**

- writing `cli/pure/a.ts`
  - given `cli/pure/a.test.ts` is empty

**blocks**

- writing `cli/pure/b.ts`

## `fcis.pureExportsTested` — guardrail

Every exported pure function is at least referenced in its test — the 'wrote no test' nudge.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `core/**/*.ts`
- **Ignores** `**/*.test.ts`
- **Categories** every session
- **Check** [`symbolsInSibling`](../checks/symbols-in-sibling.md)

<details><summary>settings</summary>

```
{
  "sibling": "{dir}/{name}.test.ts"
}
```

</details>

### What the agent reads when refused

```
An exported pure function is never referenced in its test. Cheap nudge, not coverage — but 'added a function, wrote no test' is exactly the miss it catches.
```

### Proved by

**passes**

- writing `cli/pure/a.ts` — `export const x = 1;`
  - given `cli/pure/a.test.ts` holds `expect(x)`

**blocks**

- writing `cli/pure/a.ts` — `export const y = 1;`
  - given `cli/pure/a.test.ts` holds `nothing`

## `fcis.pureCovered` — guardrail

Blocks a commit if the pure core's coverage gate fails — only runs when pure files changed.

- **Refuses at** the commit gate, over the staged set
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`execPasses`](../checks/exec-passes.md)

<details><summary>settings</summary>

```
{
  "changed": [
    "core/**"
  ],
  "run": "./ci.sh coverage"
}
```

</details>

### What the agent reads when refused

```
Coverage of the pure core fell below the bar — add tests for the new and changed code. (Runs only when pure files changed.)
```

### Proved by

**passes**

- committing `README.md`
  - given `./ci.sh coverage` exits 1

**blocks**

- committing `core/clock.ts`
  - given `./ci.sh coverage` exits 1 and says `ERROR: Coverage 91% < 95%`

## `fcis.newPureFileNeedsReason` — guardrail

A commit adding a non-test file to the pure core must say why the pure file it belongs in isn't the place.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`commitReason`](../checks/commit-reason.md)

<details><summary>settings</summary>

```
{
  "whenAdded": [
    "core/**/*.ts"
  ],
  "except": [
    "**/*.test.*"
  ],
  "token": "new-pure-file"
}
```

</details>

### What the agent reads when refused

```
Adding a file to the pure core must say why the pure file it belongs in isn't the place — put `new-pure-file: <why not the existing file>` on a line of its own in the commit message. The verifier reads that reason at the next phase boundary.
```

### Proved by

**passes**

- running `git commit -m 'feat: x

new-pure-file: a whole new tier'`
  - given `git diff HEAD --name-only` exits 0 and says `core/clock.ts` · `git diff HEAD --name-only --diff-filter=A` exits 0 and says `core/clock.ts` · `git ls-files --others --exclude-standard` exits 0
- running `git commit -m "test: cover it"`
  - given `git diff HEAD --name-only` exits 0 and says `core/clock.test.ts` · `git diff HEAD --name-only --diff-filter=A` exits 0 and says `core/clock.test.ts` · `git ls-files --others --exclude-standard` exits 0

**blocks**

- running `git commit -m "feat: x"`
  - given `git diff HEAD --name-only` exits 0 and says `core/clock.ts` · `git diff HEAD --name-only --diff-filter=A` exits 0 and says `core/clock.ts` · `git ls-files --others --exclude-standard` exits 0

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

flow docs · [the packs](./index.md) · `fcis` · generated page, do not edit
