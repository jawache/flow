---
summary: "from an unguarded repo to a refused command and a refused commit"
---

# Getting started

In this tutorial, we will guard a git repo with flow, see a banned command refused before it runs, see the commit gate refuse a commit, and run every rule's own test cases. It takes about five minutes, and every command below is real, so run each one as you read.

You need **Node 24 or later**, and a git repo to guard. A throwaway repo is fine.

## 1 · Install flow

First, install flow once for the whole machine:

```
npm i -g @jawache/flow
```

Let's check it worked: `flow --version` prints the version you installed.

> [!NOTE]
> This tutorial uses a global install so the steps are the same in every repo. To pin flow in one repo instead, see [How to install flow](../how-to/install-flow.md).

## 2 · Guard a repo

Now go into the repo and run `flow init`:

```
cd my-repo              # any git repo
flow init
```

The output should look like this:

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

Notice the first line it created: `flow.config.ts`. That file is the whole guard, and it is the only file that turns anything on. `flow init` writes a demo config you can read in one screen. It binds two packs:

- **`flow`**: flow's own self-protection.
- **`demo`**: three guardrails, so we have something to see refused before we write our own.

You can run `flow init` again whenever you like. It adds only what is missing, and says so.

## 3 · See what is bound

Now let's check that the guard is working:

```
flow status
```

The output should look like this:

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
  ✓ commit-gate: .githooks/pre-commit runs `flow hook commit` over the staged changes
  ✓ hooks-path: core.hooksPath = .githooks
  ✓ hooks: ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop
green — every rule loads, every fitting is in place.
```

Notice the last line: green. Every rule loads, and every fitting it needs is in place. A fitting is a piece of wiring flow depends on, such as the commit gate or the hook registrations. If something were not in place, `flow status` would print a red line with its fix, and exit with a non-zero code.

## 4 · See the commit gate refuse a commit

The demo config refuses any commit that stages a file containing the literal marker `DO`-`NOT`-`COMMIT` (written as one word). Let's make such a file, stage it, and run the gate.

`flow hook commit` is the command git's pre-commit hook runs. It checks whatever is staged:

```
printf 'DO-NOT-COMMIT here\n' > bad.txt
git add bad.txt
flow hook commit
```

The output should look like this:

```
flow — commit blocked:

✗ demo.noMarkedFiles
  A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.
    bad.txt carries the marker

Fix the above, then commit again.
```

Notice that the refusal names the rule, `demo.noMarkedFiles`, and the file that broke it. A real `git commit` is refused at the hook in the same way, whether you or an agent makes it.

Now clean up:

```
git reset bad.txt && rm bad.txt
```

## 5 · See a banned command refused

Open a Claude Code session in this repo, and ask the agent to force-push the branch. flow refuses the command before it runs, and shows the agent the rule's own message:

```
flow — command blocked before it ran:

✗ demo.noForcePush · git push --force origin main
  Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
    matches banned /git\s+push\b[^\n]*(--force|(^|\s)-f(\s|$))/

Adjust the command, then retry.
```

Notice that the refusal quotes the command and the pattern it matched.

## 6 · Run every rule's own cases

Every guardrail carries the inputs it must let through and the inputs it must refuse. Let's run them all:

```
flow test
# flow test — 7 cases over 4 guardrails, all green
```

Notice the count: 7 cases over 4 guardrails, all green.

## 7 · Commit the guard

Finally, commit the guard like any other code:

```
git add flow.config.ts .githooks
git commit -m "chore: guard this repo with flow"
```

Let's check what we committed: `flow.config.ts` and `.githooks/pre-commit`. The `.flow/` folder holds flow's own state. It ignores itself, so git never commits it.

## What we built

We now have a repo that guards itself:

- **A banned command** is refused before it runs.
- **A commit** is checked over its staged files, and refused when a rule says no.
- **Every rule** proves itself with its own cases, through `flow test`.

Anyone who clones the repo and runs `flow init` gets the same guard.

## Where to go next

- **Why flow works this way:** [How flow works](../explanation/how-flow-works.md) reads the demo config line by line.
- **Write your own rules:** start with [How to ban a pattern in files](../how-to/ban-a-pattern-in-files.md), [How to block a command](../how-to/block-a-command.md) or [How to protect files](../how-to/protect-files.md).
- **Look up an exact shape:** [the config reference](../reference/config.md), and one page per [stock check](../index.md#the-stock-checks--one-page-each).

---

[Index](../index.md) · every command: [the command reference](../reference/cli.md) · the grammar: [the config reference](../reference/config.md) · the model: [How flow works](../explanation/how-flow-works.md)
