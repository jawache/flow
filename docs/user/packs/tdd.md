[flow packs](./index.md) › tdd

# The `tdd` pack

6 guardrails · 1 breadcrumb · fires at: touch · write · commit · takes 2 parameters

Test-first artefacts exist; tests test behaviour, not implementation; the suite gates the commit.

`commitRunsTests` takes the suite recipe as a mandatory PARAMETER rather than defaulting to
`just test`: which command is the deterministic gate is a repo's fact, and a default is a rule
that runs the wrong suite in every repo whose gate has another name.

The `vitest/` sub-group holds FRAMEWORK spellings rather than testing principles: a repo on
another runner disables the four of them without losing the artefacts or the gate.

Generated from `packs/tdd.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 2 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `run` | `string` | The recipe that runs the deterministic suite — for example `just test-commit` or `npm test`.<br><br>MANDATORY rather than defaulted: which command is the gate is a repo's fact, and a default is a rule that runs the wrong suite in every repo whose gate has another name. |
| `tests` | `readonly string[]` | Every spelling of a test file. Defaults to the seven this fleet uses — `.test.` and `.spec.` with `.ts`, `.tsx`, `.js` and `.mjs`.<br><br>The strategy breadcrumb fires on them and the four `vitestIdioms` rules judge them, so a repo that keeps its tests in `__tests__/` names that here rather than re-scoping five entries. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { tdd } from "@jawache/flow/packs";

export default defineConfig([pack(tdd, { run: "./ci.sh test" })]);
```

To turn one entry off, say so in the config: `override(tdd.testingStrategy).disabled("why")`. It is a committed change, so a reviewer sees it.

## What to install first

vitest, unless the four `vitestIdioms` entries are disabled — every one of them reads a
vitest spelling.

## What the repo needs in place

One recipe that runs the deterministic suite, named as the `run` parameter. It is what
the commit gate runs, so it has to be the whole suite and it has to be green.

## Adopting it

A repo on another runner binds the pack and disables `vitest` and the `vitestIdioms`
group by name, keeping the strategy breadcrumb and the commit gate — that split is why the
framework rules are a sub-group rather than four loose entries.

## Entries

- [`tdd.testingStrategy`](#tddtestingstrategy--breadcrumb) · breadcrumb · How to spend testing effort (mostly integration) and what to test (behaviour, not implementation).
- [`tdd.vitest`](#tddvitest--guardrail) · guardrail · The fleet runs vitest — a second framework in a test file is a suite nothing here can check.
- [`tdd.vitestIdioms.noMockInternal`](#tddvitestidiomsnomockinternal--guardrail) · guardrail · Mock at owned boundaries only — never your own modules.
- [`tdd.vitestIdioms.noOnlyInTests`](#tddvitestidiomsnoonlyintests--guardrail) · guardrail · A committed `.only` silently disables the rest of the suite.
- [`tdd.vitestIdioms.noNetworkStubs`](#tddvitestidiomsnonetworkstubs--guardrail) · guardrail · Stubbing fetch or mocking an HTTP client tests the stub; intercept at the network edge instead.
- [`tdd.vitestIdioms.noEmptyTest`](#tddvitestidiomsnoemptytest--guardrail) · guardrail · A test with no assertions is a green light for nothing.
- [`tdd.commitRunsTests`](#tddcommitrunstests--guardrail) · guardrail · Runs the deterministic suite at commit and blocks if anything fails.

## `tdd.testingStrategy` — breadcrumb

How to spend testing effort (mostly integration) and what to test (behaviour, not implementation).

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
- **Categories** every session

### Why it exists

Without it, testing effort goes where it is easiest to write rather than where confidence is
cheapest — a thick unit layer pinned to implementation details, which then refuses every
behaviour-preserving refactor.

### What the agent reads

```
Spend where confidence-per-cost is highest (the Testing Trophy, Kent C. Dodds): static analysis base, modest unit layer, DOMINANT integration layer, thin e2e cap.
Test behaviour as the user sees it, never implementation details — if a behaviour-preserving refactor breaks a test, the test was wrong.
Mock only at owned boundaries: the network edge (MSW), not your own modules.
```

## `tdd.vitest` — guardrail

The fleet runs vitest — a second framework in a test file is a suite nothing here can check.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
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
      "regex": "^[\"'](node:test|node:assert|node:assert/strict|jest|@jest/globals|mocha|jasmine|ava|tap|tape|uvu)[\"']$"
    }
  }
}
```

</details>

### What the agent reads when refused

```
A second test framework in a test file. This fleet runs vitest — every idiom rule below reads vitest spellings, so a file under another runner is a file nothing here can check, and a suite that only one command knows how to run. Import `test` / `expect` / `describe` / `vi` from "vitest".
A repo that genuinely runs another framework disables this entry in its config, on the record, rather than mixing two.
```

### Proved by

**passes**

- writing `a.test.ts` — `import { test, expect } from "vitest";`

**blocks**

- writing `a.test.ts` — `import { test } from "node:test";`

## `tdd.vitestIdioms.noMockInternal` — guardrail

Mock at owned boundaries only — never your own modules.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "typescript",
  "rule": {
    "kind": "call_expression",
    "all": [
      {
        "has": {
          "field": "function",
          "regex": "^vi\\.mock$"
        }
      },
      {
        "has": {
          "kind": "arguments",
          "has": {
            "kind": "string",
            "regex": "^['\"]\\."
          }
        }
      }
    ]
  }
}
```

</details>

### What the agent reads when refused

```
Module-mocking your own code (a relative import). This pins the test to the file layout and skips the real integration — test behaviour through the public surface and mock at the boundary you own instead (network → MSW; clock/random → inject).
```

### Proved by

**passes**

- writing `a.test.ts` — `vi.mock("axios");`

**blocks**

- writing `a.test.ts` — `vi.mock("./neighbour.ts");`

## `tdd.vitestIdioms.noOnlyInTests` — guardrail

A committed `.only` silently disables the rest of the suite.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "tsx",
  "rule": {
    "kind": "call_expression",
    "has": {
      "field": "function",
      "regex": "\\.only$"
    }
  }
}
```

</details>

### What the agent reads when refused

```
A focused test (.only) silently skips the rest of the suite — CI goes green while nothing runs. Remove the focus before you commit.
```

### Proved by

**passes**

- writing `a.test.ts` — `it("works", () => { expect(1).toBe(1); });`

**blocks**

- writing `a.test.ts` — `it.only("works", () => { expect(1).toBe(1); });`

## `tdd.vitestIdioms.noNetworkStubs` — guardrail

Stubbing fetch or mocking an HTTP client tests the stub; intercept at the network edge instead.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "tsx",
  "rule": {
    "any": [
      {
        "pattern": "global.fetch = $X"
      },
      {
        "pattern": "globalThis.fetch = $X"
      },
      {
        "kind": "call_expression",
        "all": [
          {
            "has": {
              "field": "function",
              "regex": "^vi\\.mock$"
            }
          },
          {
            "has": {
              "kind": "arguments",
              "has": {
                "kind": "string",
                "regex": "^['\"](axios|node-fetch|got|ky|undici)['\"]$"
              }
            }
          }
        ]
      }
    ]
  }
}
```

</details>

### What the agent reads when refused

```
Hand-rolled network stub. Mock at the network boundary with MSW (Testing Trophy: mock only what you own — the edge, not the client), so request building, serialisation and error mapping stay under test.
```

### Proved by

**passes**

- writing `a.test.ts` — `server.use(http.get("/x", () => HttpResponse.json({})));`

**blocks**

- writing `a.test.ts` — `global.fetch = vi.fn();`

## `tdd.vitestIdioms.noEmptyTest` — guardrail

A test with no assertions is a green light for nothing.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/*.test.ts` · `**/*.test.tsx` · `**/*.test.js` · `**/*.test.mjs` · `**/*.spec.ts` · `**/*.spec.tsx` · `**/*.spec.js`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "tsx",
  "rule": {
    "any": [
      {
        "pattern": "it($DESC, () => {})"
      },
      {
        "pattern": "it($DESC, async () => {})"
      },
      {
        "pattern": "test($DESC, () => {})"
      },
      {
        "pattern": "test($DESC, async () => {})"
      }
    ]
  }
}
```

</details>

### What the agent reads when refused

```
Empty test body — it passes forever and counts as coverage. Write the assertion, or be honest with `it.todo('…')` until you do.
```

### Proved by

**passes**

- writing `a.test.ts` — `it.todo("covers the retry path");`

**blocks**

- writing `a.test.ts` — `it("covers the retry path", () => {});`

## `tdd.commitRunsTests` — guardrail

Runs the deterministic suite at commit and blocks if anything fails.

- **Refuses at** the commit gate, over the staged set
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`execPasses`](../checks/exec-passes.md)

<details><summary>settings</summary>

```
{
  "run": "./ci.sh test"
}
```

</details>

### What the agent reads when refused

```
The commit suite failed — the commit is blocked until it is green. (Run it yourself to see what broke.)
```

### Proved by

**passes**

- committing `cli/a.ts`
  - given `./ci.sh test` exits 0

**blocks**

- committing `cli/a.ts`
  - given `./ci.sh test` exits 1 and says `1 failed`

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

flow docs · [the packs](./index.md) · `tdd` · generated page, do not edit
