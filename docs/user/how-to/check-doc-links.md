---
summary: "refuse a commit whose code cites a docs page or section that does not exist, with `docLinks`"
---

# How to check that doc links in code still resolve

This guide shows you how to keep the docs pages your code cites from going stale. A comment that says where a behaviour is documented, such as `docs/user/reference/record.md § Ids`, is refused at commit when the page or the heading is gone.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, command, commit, definePack, guardrail, textBan } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `docLinks` to the import.

2. Add an entry that runs `docLinks` at `commit`. `.on(…)` lists the code that cites, and `pages` lists the pages that may be cited:

   ```
   docLinksResolve: guardrail()
     .at(commit)
     .on("src/**/*.ts")
     .check(docLinks({ pages: ["docs/user/**/*.md"] }))
     .message("This file cites a docs page or section that does not exist. Fix the citation, or restore the heading.")
     .test({
       pass: [{ path: "src/id.ts", content: "// docs/user/reference/record.md § Ids", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
       block: [{ path: "src/id.ts", content: "// docs/user/reference/record.md § Idz", world: { fs: { "docs/user/reference/record.md": "# The record\n\n## Ids\n" } } }],
     }),
   ```

3. Run `flow test`.

4. Check the whole repo once, since a commit judges only its staged files:

   ```
   npx flow hook commit --all
   ```

## Variants

- **If you rename a page or reword a heading**, run `npx flow hook commit --all` before you commit. It lists every file that still cites the old name.

---

[Index](../index.md) · what counts as a citation: [`docLinks`](../checks/doc-links.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
