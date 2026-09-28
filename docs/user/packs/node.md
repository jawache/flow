[flow packs](./index.md) › node

# The `node` pack

2 guardrails · 1 breadcrumb · fires at: touch · command · commit · takes no parameters

package.json discipline: reach for a maintained package, say why, pin it, move the lockfile with
it.

The dependencies breadcrumb's POLARITY is deliberate. It does not read as "adding a dependency is
a risk"; it reads as "check whether it is already solved" — because the code we hand-roll to
avoid a package has no users, no reviewers and no fixes coming, which is the larger risk most of
the time.

Generated from `packs/node.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes no parameters. Example config:

```
import { defineConfig, pack } from "@jawache/flow";
import { node } from "@jawache/flow/packs";

export default defineConfig([pack(node)]);
```

To turn one entry off, say so in the config: `override(node.dependencies).disabled("why")`. It is a committed change, so a reviewer sees it.

## What the repo needs in place

A lockfile the repo commits — `package-lock.json`, `pnpm-lock.yaml`, `bun.lock`,
`bun.lockb` or `yarn.lock`; `lockfileInStep` recognises all five and asks for whichever one the
repo already has.

## Entries

- [`node.dependencies`](#nodedependencies--breadcrumb) · breadcrumb · When to reach for a package, how to vet it, and what a commit that adds one owes.
- [`node.newDependencyNeedsReason`](#nodenewdependencyneedsreason--guardrail) · guardrail · A commit that moves package.json must record why, and what else was checked.
- [`node.lockfileInStep`](#nodelockfileinstep--guardrail) · guardrail · A dependency move and the lockfile land in the same commit — deps stay exactly pinned.

## `node.dependencies` — breadcrumb

When to reach for a package, how to vet it, and what a commit that adds one owes.

- **Shown when** the first time in a session a file it watches is touched
- **Watches** `package.json` · `package-lock.json` · `pnpm-lock.yaml` · `bun.lock` · `bun.lockb` · `yarn.lock`
- **Categories** every session

### Why it exists

Without it, the reflex is to hand-roll rather than to look, and a repo accumulates private
versions of solved problems — code with no users, no reviewers and no fixes coming.

### What the agent reads

```
Before building it, check whether it's been solved: a maintained package that does the job beats hand-rolled code — ours has no users, no reviewers and no fixes coming.
When you DO add one, vet it: is it alive — downloads, recent releases, active issues? Most-downloaded isn't the bar (a newer, trending package can be the right call); the red flag is a package nobody uses and nobody maintains — that is the supply-chain risk (OWASP A03).
Adding a dependency is a decision that carries its reasoning: put `new-dep: <name> — <why, what else was checked>` on a line of its own in the commit message; the rule blocks a bare addition.
Pin the version; the lockfile change ships in the SAME commit.
```

## `node.newDependencyNeedsReason` — guardrail

A commit that moves package.json must record why, and what else was checked.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`commitReason`](../checks/commit-reason.md)

<details><summary>settings</summary>

```
{
  "whenChanged": [
    "package.json"
  ],
  "token": "new-dep"
}
```

</details>

### Why it exists

Without it, a dependency arrives with no record of what else was considered, and the next
person to ask "why do we depend on this" has only the package name to go on.

### What the agent reads when refused

```
This commit moves package.json with no reason recorded. A dependency is a supply-chain surface — put `new-dep: <name> — <why, and what else was checked>` on a line of its own in the commit message. Doing it is fine; doing it silently is not.
```

### Proved by

**passes**

- running `git commit -m 'feat: x

new-dep: zod — checked ajv'`
  - given `git diff HEAD --name-only` exits 0 and says `package.json` · `git diff HEAD --name-only --diff-filter=A` exits 0 · `git ls-files --others --exclude-standard` exits 0

**blocks**

- running `git commit -m "feat: x"`
  - given `git diff HEAD --name-only` exits 0 and says `package.json` · `git diff HEAD --name-only --diff-filter=A` exits 0 · `git ls-files --others --exclude-standard` exits 0

## `node.lockfileInStep` — guardrail

A dependency move and the lockfile land in the same commit — deps stay exactly pinned.

- **Refuses at** the commit gate, over the staged set
- **Watches** not scoped by path
- **Categories** every session
- **Check** `lockfileInStep` *(written in this pack)* — no options

### Why it exists

Without it, a dependency moves in one commit and the lockfile in another (or never), so a
fresh clone installs something nobody tested and the two files disagree about what this repo
depends on.

### What the agent reads when refused

```
A dependency moved in package.json but no lockfile is staged. Run the install and stage the lockfile in the same commit — a lockfile one commit behind is a build that resolves differently on the next machine.
```

### Proved by

**passes**

- committing `src/a.ts`
- committing `package.json`, `package-lock.json`
  - given `git show HEAD:package.json` exits 0 and says `{}` · `git show :package.json` exits 0 and says `{}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"name":"a","dependencies":{"zod":"1.0.0"}}` · `git show :package.json` exits 0 and says `{"name":"b","dependencies":{"zod":"1.0.0"}}`

**blocks**

- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}` · `git show :package.json` exits 0 and says `{"dependencies":{"zod":"2.0.0"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}` · `git show :package.json` exits 0 and says `{ not json at all`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{}` · `git show :package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}` · `git show :package.json` exits 0 and says `{}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"devDependencies":{"vitest":"1.0.0"}}` · `git show :package.json` exits 0 and says `{"devDependencies":{"vitest":"2.0.0"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{}` · `git show :package.json` exits 0 and says `{"peerDependencies":{"react":"^19"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{}` · `git show :package.json` exits 0 and says `{"optionalDependencies":{"fsevents":"^2"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 0 and says `{"devDependencies":{"zod":"1.0.0"}}` · `git show :package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}`
- committing `package.json`
  - given `git show HEAD:package.json` exits 128 and says `path does not exist in HEAD` · `git show :package.json` exits 0 and says `{"dependencies":{"zod":"1.0.0"}}`

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

flow docs · [the packs](./index.md) · `node` · generated page, do not edit
