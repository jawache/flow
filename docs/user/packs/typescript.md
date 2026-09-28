[flow packs](./index.md) › typescript

# The `typescript` pack

4 guardrails · 1 breadcrumb · fires at: touch · write · commit · takes 5 parameters

TypeScript discipline as shared configuration: strict stays on, the checker is never silenced.

This pack does not re-implement a linter. The escape hatches — `@ts-expect-error`, explicit
`any`, double assertions — are typescript-eslint's `strictTypeChecked` job, and it does it
better than a hand-rolled pattern can. What is left is the half a linter cannot do: keep the
repo's own configs pointing at a shared base, run both tools at the gate, and teach the design
habit no tool checks.

Generated from `packs/typescript.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 5 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `typecheck` | `string` | The recipe that typechecks every project in one pass. |
| `lint` | `string` | The recipe that lints the repo. |
| `tsconfigBase` | `string` | The shared tsconfig every project must extend — a path (`./tsconfig.base.json`) or a package name. Optional, and with nothing here the rule does not ask for one.<br><br>flow ships no such file: a base states one fleet's opinion about target, module and lib, and a neutral engine has no business having one. What the pack holds without it is the opinion that travels — `strictOptions` below stay on wherever they are set. |
| `eslintBase` | `string` | The shared eslint config the repo's own config must import — a path (`./eslint.config.base.js`) or a package name. Optional; with nothing here there is no entry. |
| `strictOptions` | `readonly string[]` | The compiler options that may never be turned off. Defaults to `["strict", "noUncheckedIndexedAccess"]`.<br><br>Stated as option names under `compilerOptions`, each asserted `true`. This is the pack's whole opinion when no base file is named. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { typescript } from "@jawache/flow/packs";

export default defineConfig([pack(typescript, { typecheck: "./ci.sh types", lint: "./ci.sh lint", tsconfigBase: "./tsconfig.base.json", eslintBase: "./eslint.config.base.js" })]);
```

To turn one entry off, say so in the config: `override(typescript.strictTypesNoInvalidStates).disabled("why")`. It is a committed change, so a reviewer sees it.

## What the repo needs in place

The two gate recipes, and nothing else. THIS PACK SHIPS NO FILE: a base states one
fleet's opinion about target, module and lib, and a neutral engine has no business having one,
so with no base named the pack holds only the opinion that travels — the strict options stay on
wherever they are set.

A shared base is still worth having, and a repo that keeps one names it in `tsconfigBase` and
`eslintBase`; the two rules then hold every project to it. REFERENCE below, not a file to match:
the smallest base that carries the opinion, to copy as `tsconfig.base.json` and then add a
repo's own emit and module settings to. Every `tsconfig*.json` extends it.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

…and the lint half as `eslint.config.base.js`, which the repo's own `eslint.config.js` imports
and spreads. It is deliberately not a hand-rolled rule set: `strictTypeChecked` is the maintained
good-patterns set, it already holds the escape hatches at error, and it supersedes every idiom
rule a pack could write. `projectService` is what makes the type-aware rules work at all.

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
```

## Adopting it

Bind it with the two gate recipes this repo really has. Expect the first commit after
binding to run both tools over everything — a repo that has been typechecking one project at a
time usually finds errors in the ones nobody was checking.

## Entries

- [`typescript.strictTypesNoInvalidStates`](#typescriptstricttypesnoinvalidstates--breadcrumb) · breadcrumb · Use the type system as a design tool — strict stays on, impossible states stay impossible.
- [`typescript.tsconfigStrict`](#typescripttsconfigstrict--guardrail) · guardrail · Every tsconfig.json extends ./tsconfig.base.json and keeps strict and noUncheckedIndexedAccess on.
- [`typescript.eslintFromBase`](#typescripteslintfrombase--guardrail) · guardrail · The repo's eslint config imports ./eslint.config.base.js.
- [`typescript.commitRunsTsc`](#typescriptcommitrunstsc--guardrail) · guardrail · Runs the whole-project typecheck at commit and blocks on any type error.
- [`typescript.commitRunsEslint`](#typescriptcommitrunseslint--guardrail) · guardrail · Runs the lint at commit and blocks on any error.

## `typescript.strictTypesNoInvalidStates` — breadcrumb

Use the type system as a design tool — strict stays on, impossible states stay impossible.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `**/tsconfig*.json` · `eslint.config.*`
- **Categories** every session

### Why it exists

Without it, strictness is treated as a setting rather than a design tool: the escape hatches
get reached for under time pressure, and impossible states go on being representable because
nothing ever said to model them out.

### What the agent reads

```
Strictness is not yours to weaken: `strict` and `noUncheckedIndexedAccess` come from the committed `./tsconfig.base.json`. A red squiggle is a defect found, not a setting to relax — an exception is a visible, local, per-rule override, on the record.
Model state so the impossible cannot be constructed. Two sibling booleans (isLoading + isError) are a smell: a discriminated union makes the invalid combination unrepresentable (Vanderkam, Effective TypeScript; Feldman, "Make Impossible States Impossible").
The linter holds the escape hatches (@ts-expect-error, explicit any, double assertions) at error, and it does that job better than any rule we could write — which is why this pack points at the linter rather than carrying patterns of its own.
```

## `typescript.tsconfigStrict` — guardrail

Every tsconfig.json extends ./tsconfig.base.json and keeps strict and noUncheckedIndexedAccess on.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `**/tsconfig.json`
- **Categories** every session
- **Check** [`jsonInvariant`](../checks/json-invariant.md)

<details><summary>settings</summary>

```
{
  "assert": [
    {
      "path": "extends",
      "matches": "\\./tsconfig\\.base\\.json$",
      "required": true
    },
    {
      "path": "compilerOptions.strict",
      "equals": true
    },
    {
      "path": "compilerOptions.noUncheckedIndexedAccess",
      "equals": true
    }
  ]
}
```

</details>

### Why it exists

Without it, a project quietly stops extending the shared base — or extends it and then turns
`strict` back off — and the fleet's one standard becomes per-project taste that only shows up
as a bug much later.

### What the agent reads when refused

```
This tsconfig must extend `./tsconfig.base.json`, and it must not turn strict or noUncheckedIndexedAccess back off. Weakening the strictness means changing the shared base once, visibly, not this project quietly.
```

### Proved by

**passes**

- writing `cli/tsconfig.json` — `{"extends":"./tsconfig.base.json"}`

**blocks**

- writing `cli/tsconfig.json` — `{"compilerOptions":{"strict":false}}`
- writing `cli/tsconfig.json` — `{"extends":"./tsconfig.base.json","compilerOptions":{"strict":false}}`

## `typescript.eslintFromBase` — guardrail

The repo's eslint config imports ./eslint.config.base.js.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `eslint.config.js` · `eslint.config.mjs`
- **Categories** every session
- **Check** [`astGrep`](../checks/ast-grep.md)

<details><summary>settings</summary>

```
{
  "language": "javascript",
  "rule": {
    "kind": "program",
    "not": {
      "has": {
        "stopBy": "end",
        "kind": "string",
        "regex": "\\./eslint\\.config\\.base\\.js"
      }
    }
  }
}
```

</details>

### What the agent reads when refused

```
This eslint config does not import `./eslint.config.base.js`. The shared rules live there — a config that does not import it lints to a private standard while this repo's guard claims the shared one.
Fix: `import base from "./eslint.config.base.js";` and spread it, then add only what is genuinely local to this repo.
```

### Proved by

**passes**

- writing `eslint.config.js` — `import base from "./eslint.config.base.js"; export default [...base];`

**blocks**

- writing `eslint.config.js` — `export default [];`

## `typescript.commitRunsTsc` — guardrail

Runs the whole-project typecheck at commit and blocks on any type error.

- **Refuses at** the commit gate, over the staged set
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`execPasses`](../checks/exec-passes.md)

<details><summary>settings</summary>

```
{
  "run": "./ci.sh types"
}
```

</details>

### What the agent reads when refused

```
The typecheck failed (`./ci.sh types`) — the commit is blocked until types are clean. tsc catches the cross-file mismatches a file-at-a-time build never sees: a change that compiled here and broke a caller there.
```

### Proved by

**passes**

- committing `cli/a.ts`
  - given `./ci.sh types` exits 0

**blocks**

- committing `cli/a.ts`
  - given `./ci.sh types` exits 1 and says `a.ts(1,1): error TS2322`

## `typescript.commitRunsEslint` — guardrail

Runs the lint at commit and blocks on any error.

- **Refuses at** the commit gate, over the staged set
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`execPasses`](../checks/exec-passes.md)

<details><summary>settings</summary>

```
{
  "run": "./ci.sh lint"
}
```

</details>

### What the agent reads when refused

```
The lint failed (`./ci.sh lint`) — the commit is blocked until it is clean. This is where the escape hatches are held (floating promises, explicit any, ts-comments); fix the finding, or override that one rule visibly and locally.
```

### Proved by

**passes**

- committing `cli/a.ts`
  - given `./ci.sh lint` exits 0

**blocks**

- committing `cli/a.ts`
  - given `./ci.sh lint` exits 1 and says `error Unsafe assignment`

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

flow docs · [the packs](./index.md) · `typescript` · generated page, do not edit
