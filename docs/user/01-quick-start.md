# Quick start

docs/user/01 · from an unguarded repo to a blocked commit · 2026-09-06

In five minutes you will guard a repo, watch a banned command refuse before it runs, watch the commit gate hold, and run every rule's own cases. Every command below is real — run them as you read. What the pieces mean and why they are shaped this way is the [guidebook](./00-guide.md)'s job; this page only does. flow needs **Node ≥ 24**.

## 1 · Put `flow` on your PATH, once

One install, and the binary answers in every repo you are about to guard.

```
npm i -g @jawache/flow
```

Undo it any time with `npm uninstall -g @jawache/flow`. In a repo that has a `package.json` of its own, prefer `npm i -D @jawache/flow` and `npx flow`: the version is then pinned in that repo's lockfile, and the link line in §2 does not appear at all. To work *on* flow rather than with it, clone it and run `just install` then `just link`, which puts your checkout on PATH in place of the install.

## 2 · Guard a repo

```
cd my-repo              # any git repo
flow init
```

One command writes the whole guard and prints exactly what it did:

```
flow init — created:
  + flow.config.ts
  + .githooks/pre-commit
  + .flow/ — flow's own state, self-ignoring, never committed
  + node_modules/@jawache/flow → …/flow (a link to the flow that is running — nothing here resolved @jawache/flow)
  + ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop
  + git config core.hooksPath .githooks
  next: `flow status` — what is bound, and what is not wired yet.
```

`flow.config.ts` is a demo guard you can read in one screen — the only file that turns anything on. It binds two packs: flow's own self-protection, and a `demo` pack of three guardrails, so you have something to watch fire before you write your own. Re-run `flow init` whenever you like: it adds only what is missing and says so.

## 3 · See what is bound

```
flow status
```

```
flow is ON — 4 guardrails · 2 breadcrumbs, every one resolved and able to fire
  config     …/my-repo/flow.config.ts
  state      …/my-repo/.flow
  session    no live session has marked this worktree yet
  categories subagent — what the entries below bind to
  session
    🍞 flow.orientation
        This repo is guarded by flow. Guardrails are rules that refuse a change, and every change to the fi…
  touch
    🍞 flow.editingTheGuardrails  —  on flow.config.ts .claude/settings.json .claude/settings.local.json .claude/agents/** .claude/skills/**
        You are editing the guardrails themselves. If this edit weakens, disables or removes a guardrail or…
  delete
    ✗ flow.noDeleteGuardrails  —  on flow.config.ts .githooks/pre-commit
        That command would delete this repo's guard surface (flow.config.ts binds every rule; the packs it …
  command
    ✗ demo.noForcePush
        Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
  commit
    ✗ demo.noMarkedFiles
        A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.
    ✗ demo.chatCommits  —  for subagent
        A subagent does not commit — hand the change back to the chat that spawned it.
  ✓ config: …/my-repo/flow.config.ts
  ✓ commit-gate: .githooks/pre-commit runs `flow commit` over the staged set
  ✓ hooks-path: core.hooksPath = .githooks
  ✓ hooks: ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop
green — every rule loads, every fitting is in place.
```

Green means guarded: every rule loads, and every fitting it needs is in place. Anything not true yet is a red line carrying its own fix, and `flow status` exits non-zero — so a setup script can just ask.

## 4 · Watch the commit gate hold

The demo config refuses any commit that stages a file carrying the literal marker `DO`-`NOT`-`COMMIT` (spelled whole). Make one and ask the gate directly — `flow commit` is what git's pre-commit hook runs:

```
printf 'DO-NOT-COMMIT here\n' > bad.txt
git add bad.txt
flow commit bad.txt
```

```
flow — commit blocked:

✗ demo.noMarkedFiles
  A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.
    bad.txt carries the marker

Fix the above, then commit again.
```

This is the same check that runs when anyone — you or an agent — commits: a real `git commit` is refused at the hook the same way. Take the marker out and the commit lands. Then clean up: `git reset bad.txt && rm bad.txt`.

## 5 · Watch a banned command refuse

Open a coding session in this repo and ask the agent to force-push the branch. It is stopped *before the command runs*, with the rule's own sentence — there is no way around it:

```
flow — command blocked before it ran:

✗ demo.noForcePush · git push --force origin main
  Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
    matches banned /git\s+push\b[^\n]*(--force|(^|\s)-f(\s|$))/

Adjust the command, then retry.
```

## 6 · Run every rule's own cases

Every rule carries what must pass it and what it must block. A rule with no block case does not load — so this is proof, not a formality:

```
flow test
# flow test — 7 cases over 4 guardrails, all green
```

## 7 · Commit the guard

```
git add flow.config.ts .githooks
git commit -m "chore: guard this repo with flow"
```

The guard is ordinary committed code — `flow.config.ts`, the packs it imports, and `.githooks/pre-commit`. Anyone who clones the repo and runs `flow init` gets the same protection. (`.flow/` ignores itself and is never committed.)

## Where to go next

The [guidebook](./00-guide.md) is the front door: what a guard is, the demo config read line by line, a cookbook of rules people actually want, and how a pack travels to a second repo. When a page of exact fields is what you need, that is the [config reference](./02-entry-reference.md); each stock check has its own [page](./index.md#the-stock-checks--one-page-each).

---

docs/user/01 · Every command on this page is executed against the built binary; the transcripts are in the task's `evidence/`.
