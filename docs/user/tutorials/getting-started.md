---
summary: "from an unguarded repo to a refused commit, a refused command and a breadcrumb shown"
---

# Getting started

In this tutorial, we will guard a git repo with flow, see a commit refused, see a command refused before it runs, see a breadcrumb shown to an agent, and run every rule's own test cases. It takes about ten minutes, and every command below is real, so run each one as you read.

You need **Node 24 or later**, git, and a git repo to guard. A throwaway repo is fine. For steps 6 and 7 you need Claude Code or Codex.

## 1 · Install flow

First, go into the repo and install flow from GitHub, at a release tag:

```
cd my-repo              # any git repo
npm init -y             # only if the repo has no package.json
npm i -D github:jawache/flow#v0.4.0
```

Let's check it worked: `npx flow --version` prints `0.4.0`.

## 2 · Guard the repo

Now run `flow init`:

```
npx flow init
```

It asks which harnesses run agents in this repo. Select both, so the rest of this tutorial works under either:

```
Which harnesses run agents in this repo?
  [x] Claude Code   detected: claude on the PATH
  [x] Codex         detected: codex on the PATH
```

Then it lists what it is about to write. Go ahead. The output should look like this:

```
flow init — created:
  + flow.config.ts
  + .githooks/commit-msg
  + .flow/ — flow's own state, self-ignoring, never committed
  + .claude/settings.json — SessionStart · SubagentStart · PreToolUse · PostToolUse · Stop · SubagentStop
  + .codex/hooks.json — SessionStart · SubagentStart · PreToolUse · PostToolUse · Stop · SubagentStop
  + git config core.hooksPath .githooks
  codex: trust this folder in Codex, then approve the hooks with /hooks. Until both are done, Codex runs no hook.
  next: `flow status` — what is bound, and what is not wired yet.
```

Notice the first line it created: `flow.config.ts`. That file is the whole guard, and it is the only file that turns anything on. Everything flow wrote is inside the repo.

## 3 · Write three rules

Open `flow.config.ts`. It binds one pack, `flow`, which protects the guard itself. Let's add a pack of our own, written out in full. Replace the file with this:

```
import { banCommands, breadcrumb, change, command, commit, commitMessage, defineConfig, definePack, guardrail, pack, textBan } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

export const house = definePack("house", {
  // A guardrail at commit: judged on the staged files, whatever tool wrote them.
  noTodo: guardrail()
    .at(commit)
    .on("src/**")
    .check(textBan({ ban: ["\\bTODO\\b"] }))
    .message("No TODOs — do it now, or track it properly.")
    .test({ pass: [{ path: "src/x.ts", content: "const x = 1;" }], block: [{ path: "src/x.ts", content: "// TODO: later" }] }),

  // A guardrail at commit, on the message.
  header: guardrail()
    .at(commit)
    .check(commitMessage({ header: "^(feat|fix|docs|chore): .+" }))
    .message("The first line is `type: description`, such as `fix: read a quoted heredoc`.")
    .test({ pass: [{ message: "fix: read a quoted heredoc" }], block: [{ message: "wip" }] }),

  // A guardrail at command: an exact command, named in words, that cannot be undone.
  noForcePush: guardrail()
    .at(command)
    .check(banCommands({ ban: ["git push --force", "git push -f"] }))
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),

  // A breadcrumb: a note, shown after the first change under src/.
  sourceLayout: breadcrumb()
    .at(change)
    .on("src/**")
    .text("Code under src/ is pure: no file or network access. Put those in shell/."),
});

export default defineConfig([
  pack(flow),
  pack(house),
]);
```

## 4 · See what is bound

Now let's check that the guard is working:

```
npx flow status
```

The output should look like this:

```
flow is ON — 5 guardrails · 2 breadcrumbs, every one resolved and able to fire
  config     …/my-repo/flow.config.ts
  state      …/my-repo/.flow
  commit
    ✗ flow.noDeleteGuardrails  —  on flow.config.ts .githooks/commit-msg .claude/settings.json .codex/hooks.json
        This commit deletes part of this repo's guard. Turn a rule off in flow.config.ts instead.
    ✗ house.noTodo  —  on src/**
        No TODOs — do it now, or track it properly.
    ✗ house.header
        The first line is `type: description`, such as `fix: read a quoted heredoc`.
  command
    ✗ flow.noUninstall
        `flow uninstall` removes this repo's guard. Run it yourself, in your own terminal.
    ✗ house.noForcePush
        Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
  session
    🍞 flow.orientation
        This repo is guarded by flow. A guardrail refuses a commit or a command, and a breadcrumb is a note…
  change
    🍞 house.sourceLayout  —  on src/**
        Code under src/ is pure: no file or network access. Put those in shell/.
  ✓ config: …/my-repo/flow.config.ts
  ✓ git hook: .githooks/commit-msg runs flow, and core.hooksPath = .githooks
  ✓ binary: the hooks run this repo's own flow
  ✓ claude-code: registered · no hook has run here
  ✓ codex: registered · no hook has run here
        Codex runs a project's hooks only in a trusted folder, and each hook only once approved in /hooks
green — every rule loads, every fitting is in place.
```

Notice the last line: green. Every rule loads, and every fitting it needs is in place. A fitting is a piece of wiring flow depends on, such as the git hook or a harness's hook registrations. If something were not in place, `flow status` would print a red line with its fix, and exit with a non-zero code.

## 5 · See a commit refused

Let's stage a file that breaks `house.noTodo`, and commit it:

```
mkdir -p src
printf '// TODO: later\n' > src/a.ts
git add src/a.ts
git commit -m "feat: add a"
```

The output should look like this:

```
flow — commit blocked:

✗ house.noTodo · src/a.ts
  No TODOs — do it now, or track it properly.
    line 1 matches \bTODO\b

Fix the above, then commit again.
```

Notice that flow let us write the file. It refused the commit, and named the rule and the file.

Now fix the file, and commit with a message that breaks `house.header`:

```
printf 'export const a = 1;\n' > src/a.ts
git add src/a.ts
git commit -m "wip"
```

```
flow — commit blocked:

✗ house.header · wip
  The first line is `type: description`, such as `fix: read a quoted heredoc`.

Fix the above, then commit again.
```

Commit again with `git commit -m "feat: add a"`. This time git records the commit.

## 6 · See a command refused

Open a Claude Code or Codex session in this repo. Under Codex, first trust the folder and approve the hooks with `/hooks`. Ask the agent to force-push the branch. flow refuses the command before it runs, and shows the agent the rule's own message:

```
flow — command blocked before it ran:

✗ house.noForcePush · git push --force origin main
  Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
    matches banned `git push --force`

Adjust the command, then retry.
```

## 7 · See a breadcrumb shown

In the same session, ask the agent to add a function to `src/a.ts`. After its first change under `src/`, the agent is shown the note:

```
# breadcrumb: house.sourceLayout (change)
Code under src/ is pure: no file or network access. Put those in shell/.
```

Ask the agent what it was just told about `src/`. It repeats the note. When it changes `src/a.ts` a second time, it is not shown the note again.

## 8 · Run every rule's own cases

Every guardrail carries the inputs it must let through and the inputs it must refuse. Let's run them all:

```
npx flow test
# flow test — 12 cases over 5 guardrails, all green
```

## 9 · Commit the guard

Finally, commit the guard like any other code:

```
git add package.json package-lock.json flow.config.ts .githooks .claude/settings.json .codex/hooks.json
git commit -m "chore: guard this repo with flow"
```

The `.flow/` folder holds flow's own state. It ignores itself, so git never commits it.

## What we built

We now have a repo that guards itself:

- **A commit** is judged on its staged files and its message, and refused when a rule says no.
- **A named command** is refused before it runs.
- **A breadcrumb** tells an agent about an area when it first changes a file there.
- **Every rule** proves itself with its own cases, through `flow test`.

Anyone who clones the repo and runs `npm install` and `npx flow init` gets the same guard.

## Where to go next

- **Why flow works this way:** [How flow works](../explanation/how-flow-works.md).
- **Write your own rules:** start with [How to check file content at commit](../how-to/check-file-content-at-commit.md), [How to block or redirect a command](../how-to/block-a-command.md) or [How to steer with a breadcrumb](../how-to/steer-with-a-breadcrumb.md).
- **Look up an exact shape:** [the config reference](../reference/config.md), and one page per [stock check](../index.md#the-stock-checks--one-page-each).

---

[Index](../index.md) · every command: [the command reference](../reference/cli.md) · the grammar: [the config reference](../reference/config.md) · the model: [How flow works](../explanation/how-flow-works.md)
