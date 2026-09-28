# `astGrep`

reads: file body · fires at: write · commit · 2026-09-06

Bans or requires a structural code pattern, parsed rather than text-matched — so a match inside a string or a comment never false-fires. `language` is always stated and never defaulted: the wrong grammar mis-parses quietly. `rule` is an [ast-grep](https://ast-grep.github.io) rule object.

## Options

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `language` | string | yes | the grammar to parse with — html · css · javascript · typescript · tsx (and the `js` · `ts` · `jsx` spellings) are built in |
| `rule` | ast-grep rule | yes | the pattern to find; wrap in `not:` to require its absence |

## Example

```
noRawEslint: guardrail()
  .at(write, commit)
  .on("eslint.config.js")
  .check(astGrep({
    language: "javascript",
    rule: { kind: "program", not: { has: { stopBy: "end", kind: "string", regex: "eslint\\.config\\.base" } } },
  }))
  .message("This eslint config does not import the shared base.")
  .test({
    pass: [{ path: "eslint.config.js", content: 'import base from "./eslint.config.base.js";\nexport default [...base];\n' }],
    block: [{ path: "eslint.config.js", content: "export default [];\n" }],
  }),
```

## Which grammars resolve, and in what order

Three routes, tried in this order. A name that matches none of them is a **refusal**, never a silent fall-through to another parser — the wrong grammar matches nothing and reports green forever, which is the failure this check exists to delete.

1. **Built in.** `html · css · javascript · typescript · tsx`, with the `js` · `ts` · `jsx` spellings. Nothing to install.
2. **Declared by your config.** A grammar you built yourself, named in `defineConfig`'s settings — this is the route for a language nobody publishes (astro, vue, svelte):

   ```
   export default defineConfig([pack(house)], {
     grammars: [{ name: "astro", libraryPath: "grammars/astro.dylib", extensions: ["astro"], languageSymbol: "tree_sitter_astro" }],
   });
   ```

   `libraryPath` is relative to the repo root or absolute, and it points at a compiled tree-sitter library — a *build artefact*, machine-specific, which you do not commit. Carry the recipe that builds it (`tree-sitter build --output grammars/astro.dylib`) and gitignore the output. Until the file is there, `flow status` shows a red line naming it and every rule on that language refuses.
3. **A published package.** `npm i -D @ast-grep/lang-<name>` (sql, python, go, rust…), picked up on the next run.

---

[All stock checks](../index.md#the-stock-checks--one-page-each) · the sentence around it: [the config reference](../02-entry-reference.md) · this page's example is copied from a pack that `flow test` proves green.
