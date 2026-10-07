# Authoring a pack

docs/user/03 · a bespoke check, and packing rules for a second repo · 2026-09-06

Before you write a check, check you need one: most rules are a [stock check](./index.md#the-stock-checks--one-page-each) plus a sentence, and a structural code pattern is `astGrep`, no code at all. Write your own when the check needs real logic — read a companion file, compute something, hold an invariant no stock check expresses. This page is that contract, and how a pack travels to a second repo.

## A check is a function of `ctx`

`defineCheck` takes an options object and returns the check — a function of `ctx` that answers `ctx.ok()` or `ctx.fail(detail)`. It may be async. It reaches the world **only** through `ctx` — never `node:fs`, `child_process` or `process.env` — and that single rule is what lets the same check run live, run in a case, and replay from a recording with no repo at all.

```
// guards/house.ts
import { defineCheck, write, commit, definePack, guardrail } from "@jawache/flow";

const frontmatterComplete = defineCheck((_opts: Record<string, never>) => (ctx) => {
  const { content } = ctx.file ?? { content: "" };
  return content.startsWith("---") ? ctx.ok() : ctx.fail("missing frontmatter block");
});

export const house = definePack("house", {
  frontmatter: guardrail()
    .at(write, commit)
    .on("content/**/*.md")
    .check(frontmatterComplete({}))
    .message("Every content file opens with frontmatter.")
    .test({
      pass:  [{ path: "content/a.md", content: "---\ntitle: x\n---\n" }],
      block: [{ path: "content/a.md", content: "no frontmatter here" }],
    }),
});
```

Note what is *not* here: no declaration of which moments the check supports, no schema factory, no `kind`. The sentence's `.at(…)` says when it fires; the `ctx` a check reads is whatever that moment carries; and its options are an ordinary typed argument, so a wrong value is a compile error, not a runtime surprise.

## What `ctx` carries, by moment

| At | The check reads |
| --- | --- |
| `write` · `commit` (a file rule) | `ctx.file` = `{ path, content }`. At write, `content` is the would-be bytes when the Edit tool made the change, and the bytes now on disk when a shell command made it. Read `content` the same way in both cases. At commit, the check is called once per staged file, when the rule lists globs with `.on(…)` |
| `command` | `ctx.command` — the line about to run |
| `commit` (no `.on`) | `ctx.staged` — the whole staged set, asked once |
| `commit`, for a deleted file | only when the rule is bound at both `deletion` and `commit`, and lists globs with `.on(…)`. `ctx.moment` is `delete`, and `ctx.file` = `{ path, content, existed: true }`, where `content` is the file as the last commit has it — the same `ctx` the rule is called with when a file is deleted during a session |
| `turn-end` | `ctx.turn` — the edits and runs of the turn |
| any | `ctx.actor` — the category names that match the session making the change. `ctx.fs` · `ctx.exec` · `ctx.git` — read a file, run a command, query git. `ctx.moment` — which moment this is, to branch on |

Return `ctx.fail(detail)` with a sentence naming what was seen and what to do — a detector that emits the same line for causes the reader must answer differently teaches them to talk past it. A check that throws is a load-time fault that names the file; it can never load as a rule that silently stopped checking.

## Proving it

A bespoke check is authored logic, so its entry carries cases like any other — a rule with no block case does not load. The case shapes are in the [config reference](./02-entry-reference.md). Run them with:

```
flow test
```

Every case runs through the same `ctx` the live rails build, with the world supplied as data. After a green run, flip a case so it should go red and watch it fail — a test that cannot fail proves nothing.

## Packing rules for a second repo

Rules start in a repo's `guards/`. When a second repo wants them, the pack is a module, so sharing it is a move, not a rewrite: the file goes to an npm package and both repos `import` it. There is nothing on the machine to resolve against.

Where two repos differ on a fact the pack needs — a pure-code home, a test command — the pack declares it as a **mandatory typed parameter** rather than baking one repo's answer in. A repo that binds the pack without stating the fact does not compile:

```
// the pack takes a repo fact it cannot know
export const tdd = definePack("tdd", (repo: { run: string }) => ({
  commitRunsTests: guardrail()
    .at(commit)
    .check(execPasses({ run: repo.run }))
    .message("Commit runs the suite.")
    .test({ /* … */ }),
}));

// …and the config supplies it
export default defineConfig([
  pack(tdd, { run: "just test-commit" }),
]);
```

Where a repo disagrees with a single entry, it `override`s rather than forking — a different scope, a different message, or `.disabled("why")`. Each override key replaces the pack's whole value, and its reason prints in `flow status`, so the divergence is visible.

## Writing the pack down — the three doc-comment slots

A pack file is not a document. The sentence spreads a rule over `.at()`, `.on()`, `.check()`, `.message()` and `.test()`, so the way a pack is *read* is its generated page — one per pack, under [docs/user/packs/](./packs/index.md), written by `just docs-packs`. Every fact on that page is loaded from the pack itself. Three things are not loadable, and they are doc comments you write:

| Doc comment on | Says | Required |
| --- | --- | --- |
| `definePack` | The pack's **lead** — one paragraph on what the pack is for, in the words someone who has never seen your repo needs. | always |
| each member of the parameter interface | What the fact is, and why the pack cannot know it. | always |
| each entry's key | **Why the entry exists**, under the delete-it test: what goes wrong in the repo without it. | every breadcrumb; a guardrail only when its refusal message cannot carry the reason |

Everything else stays an ordinary `//` comment — placement notes, the history of a fix, an aside to the next editor. Those never reach the page, which is what keeps the page readable.

Three JSDoc tags on that same `definePack` comment become their own sections on the page. A tag nobody uses renders nothing; a tag outside the three is not read at all.

| Tag | Section | Says |
| --- | --- | --- |
| `@install` | What to install first | The tool a rule here shells out to, and how to get it. |
| `@setup` | What the repo needs in place | A file, a recipe or a script the rules assume — with the copyable text where there is any. |
| `@adopt` | Adopting it | What happens on the first run in a repo that has never bound this pack, and what to fix first. |

```
/**
 * Test-first artefacts exist, and the suite gates the commit.
 *
 * @install vitest, and a recipe that runs it.
 * @adopt Bind it with your suite recipe; expect the commit gate to run the suite from the first
 * commit, so land a green suite before you bind it.
 */
export const tdd = definePack("tdd", (repo: Suite) => ({ /* … */ }));
```

## Prose strings never wrap

A string in `.text(…)` or `.message(…)` stays on **one line** however long it gets. Only a model reads it, so the wrap buys no reader anything, and on the page it arrives as a line break through the middle of a sentence. An aligned table or a bulleted list is not a wrap — there every line is a complete unit, and the line above it finishes.

```
// wrapped to fit an editor — the page shows the break, the model sees a newline
"· One page, one job: the quick start",
"  teaches by doing; the guide solves situations.",

// one line, however long
"· One page, one job: the quick start teaches by doing; the guide solves situations.",
```

Doc comments are the other way round: a human reads those, so they wrap at the width the rest of the file uses.

---

docs/user/03 · Verified against the shipped binary. The built-ins to reach for first: the [stock checks](./index.md#the-stock-checks--one-page-each); the ten shipped packs, one page each: [the packs](./packs/index.md).
