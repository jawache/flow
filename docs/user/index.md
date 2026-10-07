# flow — user documentation

docs/user · flow's human-facing docs · 2026-09-28

**flow** is the guard: your whole guard is one TypeScript file, and these pages are how to write it. New here? Run the [quick start](./01-quick-start.md) — five minutes, real commands. A rule just blocked you? The [guidebook](./00-guide.md)'s cookbook has the shape of every rule you'll meet. Everything on these pages is executed against the shipped binary, not read off the code.

## The pages

### [00 · The guidebook](./00-guide.md)

The front door: what a guard is, the demo config read line by line, the “I want to…” cookbook, categories, testing, and how a pack travels to a second repo.

### [01 · Quick start](./01-quick-start.md)

From an unguarded repo to a blocked commit, hands on, in five minutes.

### [02 · Config reference](./02-entry-reference.md)

Every verb of the sentence grammar — `guardrail`, `breadcrumb`, `pack`, `override`, the moments, the `ctx` — and what the loader refuses.

### [03 · Authoring a pack](./03-authoring-scripts.md)

Writing a check no stock one expresses — the `defineCheck` contract — and packing rules for a second repo.

### [Upgrading flow](./migrations/index.md)

One migration guide per release: what a repo that uses flow must change to upgrade to that version, as steps an agent can follow.

## The shipped packs — one page each

Ten packs arrive with the install, behind `@jawache/flow/packs`, and a repo binds the ones it wants a line at a time. Each page is generated from the pack itself: every entry, when it fires and over what, the exact words an agent reads, the check's settings as written, and both sides of every case. Start at [the packs](./packs/index.md).

## The stock checks — one page each

Fourteen configured checks cover what a guard actually asks. You import one and hand it to `.check(…)`; each page lists its options and a real example.

| Check | Reads | Checks |
| --- | --- | --- |
| [`textBan`](./checks/text-ban.md) | file body | banned regexes, per line, in any text |
| [`astGrep`](./checks/ast-grep.md) | file body | a structural code pattern (never a string or a comment) |
| [`jsonInvariant`](./checks/json-invariant.md) | file body | assertions over a JSON file's values |
| [`symbolsInSibling`](./checks/symbols-in-sibling.md) | file body | exported symbols are referenced in the sibling test |
| [`banCommands`](./checks/ban-commands.md) | command line | banned shell commands, before they run |
| [`commitReason`](./checks/commit-reason.md) | command line | this commit needs a reason recorded in its message |
| [`protectedPath`](./checks/protected-path.md) | file path | paths that must not be touched (or are append-only) |
| [`oneWriter`](./checks/one-writer.md) | the acting session's categories | only the listed categories may change a file; any other actor's write is refused, and one that already landed is put back |
| [`siblingExists`](./checks/sibling-exists.md) | file path | a file's required companion exists on disk |
| [`canonicalFiles`](./checks/canonical-files.md) | file path | only approved names in a folder |
| [`changeTogether`](./checks/change-together.md) | staged set | files that must move in the same commit |
| [`execPasses`](./checks/exec-passes.md) | runs a tool | run any whole-project tool; block on a non-zero exit |
| [`depcruise`](./checks/depcruise.md) | runs a tool | import fences over the real dependency graph |
| [`ranSinceEdit`](./checks/ran-since-edit.md) | the turn | “you changed X this turn but never ran Y” — at turn-end |

---

The repo's own README is the shorter tour; `packs/` holds the ten packs `@jawache/flow/packs` ships.
