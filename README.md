# flow

**Guardrails and breadcrumbs as code.** Your whole guard is one TypeScript file: rules that block
what must not happen, notes that arrive when they are useful, and a compiler that refuses the config
before it ever runs.

Not to be confused with **Flow, the JavaScript type checker** from Meta. No relation, no shared
history, nothing in common but four letters. This flow is a guard for coding agents.

Requires **Node >= 24**. Your config is TypeScript and is loaded by node's own type stripping, which
is on by default from 24 (the Active LTS) — there is no build step and there will not be one, because
a guard that compiles its own config is a guard with a build to go wrong. On an older node, flow
tells you the version it needs instead of dying on a syntax error.

---

## Why

A guard is worth having only if it is true. The failure that matters is not a rule that fires when it
should not — you notice that within a minute. It is a rule that reads as armed, is counted as armed,
and matches nothing: a glob for a folder that was renamed, a script that no longer imports, a fence
pointed the wrong way. That config is indistinguishable from a working one until the day it was
supposed to save you.

flow's answer is that **nothing defaults and nothing loads quietly**:

- A rule is written in a closed grammar, so a misspelled verb is a red squiggle in your editor.
- Every rule carries its own cases — what must pass it, and what it must block. A rule with no
  block-case does not load. `flow test` runs them all.
- A scope that could never narrow anything is refused, not ignored.
- If the config will not load, **every gated moment refuses**, loudly, until you fix it. A guard
  that fails open is a guard that lies about being there.

## Install

flow is not published yet. Until it has been lived on, it reaches a repo by `npm link` from a
checkout:

```sh
git clone https://github.com/jawache/work.git
cd work
just link-flow          # builds the binary and puts `flow` on your PATH
```

Undo it any time with `npm unlink -g @jawache/flow`.

## Five minutes, from nothing

```sh
mkdir /tmp/flow-demo && cd /tmp/flow-demo && git init -q
flow init
```

That writes:

```
flow init — created:
  + flow.config.ts
  + .githooks/pre-commit
  + .flow/ — flow's own state, self-ignoring, never committed
  + node_modules/@jawache/flow → …/work/flow (npm link is flow's distribution until it is published)
  + ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · Stop
  + git config core.hooksPath .githooks
  next: `flow status` — what is bound, and what is not wired yet.
```

Six things, and each one is checkable:

| what | why |
| --- | --- |
| `flow.config.ts` | a demo guard you can read in one screen — the only file that turns anything on |
| `.githooks/pre-commit` | the commit gate. Never written over one you already have |
| `.flow/` | flow's own state and logs. It ignores itself, so your `.gitignore` is untouched |
| `node_modules/@jawache/flow` | a link, because nothing is published yet. Once flow is on npm, this step disappears |
| the host's `settings.json` | four hook registrations, so a coding agent in any repo asks flow first |
| `core.hooksPath` | what makes git run the gate. It is per-clone, so every fresh checkout runs `flow init` |

`flow init --empty` gives you the same wiring with no opinions, for a repo that knows what it wants.
Run `flow init` again whenever you like — it adds only what is missing and says so.

Now look at what you have:

```sh
flow status
```

```
flow is ON — 3 guardrails · 1 breadcrumb, every one resolved and able to fire
  config     /tmp/flow-demo/flow.config.ts
  state      /tmp/flow-demo/.flow
  session    no live session has marked this worktree yet
  categories subagent — what the entries below bind to
  session
    🍞 demo.orientation
        This repo is guarded by flow. The rules are in flow.config.ts — read them rather than routing aroun…
  command
    ✗ demo.noForcePush
        Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
  commit
    ✗ demo.noMarkedFiles
        A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.
    ✗ demo.chatCommits  —  for subagent
        A subagent does not commit — hand the change back to the chat that spawned it.
  ✓ config: /tmp/flow-demo/flow.config.ts
  ✓ commit-gate: .githooks/pre-commit runs `flow commit` over the staged set
  ✓ hooks-path: core.hooksPath = .githooks
  ✓ hooks: ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · Stop
green — every rule loads, every fitting is in place.
```

Both blocks above are the real thing: the suite runs `flow init` and `flow status` in a throwaway
repo and pins them against this file, with only the three paths (this repo, your home, the checkout)
standing in for the ones you will see.

Green means guarded. Anything not true yet is a red line carrying its own fix, and `flow status`
exits non-zero — so a setup script can just ask.

Then prove each rule to yourself, in this order. Each step takes seconds.

**1 — the notes arrive.** Open a coding session in `/tmp/flow-demo` and say hello. The
orientation breadcrumb is injected into the session as context, before the agent does anything.

**2 — a banned command is refused.** Ask the agent to force-push the branch. It is stopped
*before the command runs*, with the rule's own sentence, and there is no way around it.

**3 — the commit gate holds.** Have the agent write a file containing the literal marker
`DO`-`NOT`-`COMMIT` (spelled whole), stage it, and commit. Git refuses at the hook, naming the rule
and the file. Take the marker out and the same commit lands.

**4 — a rule bound to WHO, not what.** Ask the main chat to make a small commit: it lands. Ask it to
delegate the identical commit to a subagent: refused. Same act, different wearer, different answer —
that is `.for(subagent)`, and the category recognises itself from what the host wrote, never from
anything the session claimed about itself.

**5 — break it, and watch everything stop.** Delete a `.message(…)` from `flow.config.ts` and save.
Your editor goes red on that line. Ask the agent to edit any file, or to run any command: both are
refused, with the load error on screen. Undo the edit and the next action passes. There is no
notice-and-proceed anywhere.

The one exception is the repair: while the config is broken, a write to `flow.config.ts` or to
`guards/**` still goes through. Without it the rule demanding a fix would also forbid it — you would
never notice, because your editor has no hooks in front of it, but anything that does is locked out
of its own repair. Commands stay refused, and so does the commit gate, so nothing written under the
exception reaches a commit until the config loads green.

**6 — run every rule's own cases.**

```sh
flow test
# flow test — 5 cases over 3 guardrails, all green
```

Delete a rule's `.test(…)` block and the config stops loading at all, naming the entry.

## The config

Open `flow.config.ts`. It is ordinary code, and it is the whole guard:

```ts
import { commit, command, defineCategory, defineConfig, definePack, guardrail, pack } from "@jawache/flow";

const subagent = defineCategory("subagent", (facts) => facts.subagent);

export const demo = definePack("demo", {
  noForcePush: guardrail()
    .at(command)
    .check((ctx) => (/--force/.test(ctx.command ?? "") ? ctx.fail("rewrites shared history") : ctx.ok()))
    .message("Force-pushing rewrites history everyone else has.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
});

export default defineConfig([pack(demo)]);
```

Five things to know, and then you can write your own:

- **A sentence says everything, and defaults nothing.** `.at(…)` when it fires · `.on(…)`/`.ignore(…)`
  which files · `.for(…)` which actor · `.check(…)` the question · `.message(…)` what you are told ·
  `.test({ pass, block })` what proves it. Say a verb twice and the compiler stops you.
- **A check is a function of `ctx`** and reaches the world only through it — `ctx.file`, `ctx.command`,
  `ctx.staged`, `ctx.exec`, `ctx.fs`, `ctx.git`. That is what lets the same check run live, run in a
  case, and replay from a recording without a repo.
- **A pack is just code.** `definePack` in a file here, or a package you install: identical shape.
  Publishing one is promotion, not a rewrite.
- **A repo bends a pack it did not write** with `override(pack.entry)`, which speaks only what it
  changes — a different glob, a different message, or `.disabled("why")`, and the reason is what
  `flow status` prints beside it.
- **A category is a name with its recognizer aboard.** It reads host-written evidence — a sidecar the
  harness wrote, the brief a spawn was given — and never a claim the session made about itself,
  because permissions that rest on a claim rest on a lie.

## Moments

| moment | when | guardrail | breadcrumb |
| --- | --- | --- | --- |
| `session` | a chat starts, resumes, or is compacted | — | ✓ |
| `touch` | a tool call names a file | — | ✓ |
| `write` | a file is about to be written | ✓ | — |
| `delete` | a command is about to remove a file | ✓ | — |
| `command` | a shell command is about to run | ✓ | — |
| `commit` | git's pre-commit hook, over the staged set | ✓ | — |
| `turn-end` | the agent is about to hand back | ✓ | — |

A guardrail blocks; a breadcrumb is a note and has no rail to block with. The commit moment is not
delivered by any harness — git's own hook is — which is why every harness gets the gates for free.

## Every verb

| | |
| --- | --- |
| `flow init [--empty]` | scaffold a config, arm the gate, register the hooks |
| `flow status [--json]` | what is bound here, at which moments, and what is not wired yet |
| `flow test [config]` | every rule's own cases, driven |
| `flow facts [--json]` | what the record and the conversations say about this repo |
| `flow replay <file>` | a recorded session, back through the engine — no repo, no harness |
| `flow hook <event>` | what the harness's registrations call. Not for you |
| `flow commit <files…>` | what git's pre-commit hook calls. Not for you |

Two switches, both files, both one command:

```sh
touch .flow/off        # every rail silenced. rm it to turn the guard back on
touch .flow/record     # capture sessions so `flow replay` can run them again
```

## Exit codes

| | |
| --- | --- |
| `0` | yes |
| `1` | the answer is no — a rule refused, or a fitting is missing |
| `2` | **your rules are broken** — the config would not load, or a verb was misused |

The 1/2 split is load-bearing: "your guard caught something" and "your guard cannot run" are
different facts, and a script, a hook or a CI step has to be able to tell them apart.

## Licence

MIT.
