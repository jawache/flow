---
summary: "reads: runs a tool · fires at: commit"
---

# `depcruise`

Import fences over the real dependency graph, compiled to [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)'s own schema. Name your layers as globs, then forbid the edges that must never exist — a fence pointed the right way is what keeps a package a package rather than a folder.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `scan` | string | yes | what dependency-cruiser cruises, passed to it as its one path argument: a directory such as `src`, or a glob such as `src/**/*.ts` |
| `layers` | map of name → globs, or `{ path, not }` | yes | the named regions of the graph. **Globs, never regexes** — a regex is escaped into a literal and the fence then matches nothing, so one is refused at load, naming the layer and the entry. For a layer with holes in it (a folder minus a few subtrees), say `{ path: ["src/pages/**"], not: ["src/pages/api/**"] }` rather than a lookahead |
| `forbid` | list | no | the edges that must not exist. Each item is one of the forms in [the `forbid` forms](#the-forbid-forms) |
| `only` | map | no | fail-closed allowlist: a layer may reach ONLY these layers |
| `require` | list | no | an inverted fence: modules in a path MUST import a target |
| `except` | list | no | only `"type-only"` is read; any other string is ignored. It exempts type-only imports from the fences. The check runs dependency-cruiser with `tsPreCompilationDeps: false`, so a type-only import is never an edge in the first place, and `except` changes nothing unless `options` sets `tsPreCompilationDeps` to `true` |
| `options` | object | no | dependency-cruiser's own options, merged over the check's defaults |

## The `forbid` forms

| Form | Forbids |
| --- | --- |
| `{ from, to, why? }` | any import from a module in layer `from` into a module in layer `to`. `why` is the sentence the violation prints |
| `{ from, to, transitive: true, why? }` | the same, but for any module `from` can reach through other imports, not only direct ones |
| `{ cyclesBetween, why? }` | an import from one feature folder into a sibling feature folder, inside the named layer. The feature folder is the last `*` of the layer's first glob |
| `"circular"` | any dependency cycle |
| `"orphans"` | a module nothing imports, other than `.d.ts` files. It is compiled at severity `warn`, and it refuses the commit like any other violation |

## A layer with holes in it

The shape a real architecture usually wants is “this folder, except these”: the marketing surface of a site is everything under `src/pages/` apart from the handful of subtrees that are endpoints. Say that with `not`, which compiles to dependency-cruiser's own `pathNot`:

```
layers: {
  "marketing-pages": { path: ["src/pages/**"], not: ["src/pages/app/**", "src/pages/api/**", "src/pages/admin/**"] },
  "per-user-runtime": ["src/lib/auth/**", "src/lib/session/**"],
},
forbid: [{ from: "marketing-pages", to: "per-user-runtime", why: "a cached page must render the same for everyone" }],
```

Enumerating what IS in the layer instead is the trap: the fence quietly stops covering the next folder somebody adds. Two places `not` is refused rather than half-applied: inside an `only` allowlist, which is compiled by inverting the layers it names and would drop the holes silently; and excluding `node:*`, because a builtin is matched as a dependency type and the only exclusion available says “not a core module at all”, which is wider than the layer means. A NAMED builtin (`node:fs`) is an ordinary path and excludes cleanly.

## Example

```
layersFenced: guardrail()
  .at(commit)
  .check(depcruise({
    scan: "src/**/*.ts",
    layers: { core: ["src/core/**"], io: ["src/io/**"] },
    forbid: [{ from: "core", to: "io", why: "the functional core reaches the world only through a shell" }],
  }))
  .message("An import crosses a fenced layer boundary.")
  .test({
    pass:  [{ staged: ["src/core/a.ts"], world: { exec: { depcruise: { stdout: '{"summary":{"violations":[]}}' } } } }],
    block: [{ staged: ["src/core/a.ts"], world: { exec: { depcruise: { code: 1, stdout: '{"summary":{"violations":[{"rule":{"name":"no-core-to-io"},"from":"src/core/a.ts","to":"src/io/db.ts"}]}}' } } } }],
  }),
```

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../reference/config.md)
