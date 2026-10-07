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

In the repo you want guarded, as a dev dependency — so every clone and every CI run gets the same
flow, pinned in your lockfile:

```sh
npm i -D @jawache/flow
npx flow init
```

Or on your PATH, for a folder with no `package.json` of its own — which is what the five-minute
walkthrough below uses:

```sh
npm i -g @jawache/flow
```

Either way `flow init` does the wiring, and you never link anything by hand. When `@jawache/flow`
does not resolve from the repo — a global install, a bare demo folder — init links the flow that is
running and says so on the line. Install it as a dependency instead and that step is simply absent.

To work *on* flow rather than with it: clone it, `just install`, `just link` — the binary then runs
from your checkout, undone with `npm unlink -g @jawache/flow`.

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
  + node_modules/@jawache/flow → …/flow (a link to the flow that is running — nothing here resolved @jawache/flow)
  + ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop
  + git config core.hooksPath .githooks
  next: `flow status` — what is bound, and what is not wired yet.
```

Six things, and each one is checkable:

| what | why |
| --- | --- |
| `flow.config.ts` | flow's own `flow` pack plus a demo guard you can read in one screen — the only file that turns anything on |
| `.githooks/pre-commit` | the commit gate. Never written over one you already have |
| `.flow/` | flow's own state and logs. It ignores itself, so your `.gitignore` is untouched |
| `node_modules/@jawache/flow` | a link to the flow that is running, because this folder resolves no `@jawache/flow` of its own. `npm i -D @jawache/flow` and this row disappears |
| the host's `settings.json` | five hook registrations, so a coding agent in any repo asks flow first |
| `core.hooksPath` | what makes git run the gate. It is per-clone, so every fresh checkout runs `flow init` |

`flow init --empty` gives you the same wiring with no opinions, for a repo that knows what it wants.
Run `flow init` again whenever you like — it adds only what is missing and says so.

Now look at what you have:

```sh
flow status
```

```
flow is ON — 4 guardrails · 2 breadcrumbs, every one resolved and able to fire
  config     /tmp/flow-demo/flow.config.ts
  state      /tmp/flow-demo/.flow
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
  ✓ config: /tmp/flow-demo/flow.config.ts
  ✓ commit-gate: .githooks/pre-commit runs `flow hook commit` over the staged changes
  ✓ hooks-path: core.hooksPath = .githooks
  ✓ hooks: ~/.claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop
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

**3 — a shell edit is refused too.** Ask the agent to add a `TODO` to a guarded file with a
heredoc or `sed -i` instead of the Edit tool. The write goes through, so the file on disk changes.
The same rule then checks it, and flow puts the file back to the content it had before. The refusal
is printed beside the command's own output. Notice that a refused write never stays, whichever tool
made it.

**4 — the commit gate holds.** Have the agent write a file containing the literal marker
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

The one exception is the repair: while the config is broken, a write to `flow.config.ts` — or to a
pack it imports, whatever you called that folder — still goes through. The surface is read out of
the config's own relative import lines, as text, because the module is the thing that will not load.
Without the exception the rule demanding a fix would also forbid it — you would never notice,
because your editor has no hooks in front of it, but anything that does is locked out of its own
repair. Commands stay refused, and so does the commit gate, so nothing written under the exception
reaches a commit until the config loads green.

**6 — run every rule's own cases.**

```sh
flow test
# flow test — 7 cases over 4 guardrails, all green
```

Delete a rule's `.test(…)` block and the config stops loading at all, naming the entry.

## Proving the packs themselves

`flow test` proves the rules in *your* config. One command proves the ten this package ships, and it
is the one to run before you trust a change to any of them:

```sh
just test-packs
```

It builds the bundles, runs `flow init` in a throwaway repo that has never heard of flow, binds every
shipped pack at once with a stranger's parameters — one shell script for the toolchain, `core/` for
the pure home, `rules/` for the repo's own pack — and then drives the rails: `flow status` green,
each pack's cases run pack by pack, and one real refusal at each of write · delete · command ·
commit · turn-end. It prints what it bound and what refused, and exits non-zero naming the pack the
moment a count moves.

## The config

Open `flow.config.ts`. It is ordinary code, and it is the whole guard:

```ts
import { commit, command, defineCategory, defineConfig, definePack, guardrail, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

const subagent = defineCategory("subagent", (facts) => facts.subagent);

export const demo = definePack("demo", {
  noForcePush: guardrail()
    .at(command)
    .check((ctx) => (/--force/.test(ctx.command ?? "") ? ctx.fail("rewrites shared history") : ctx.ok()))
    .message("Force-pushing rewrites history everyone else has.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
});

export default defineConfig([pack(flow, { packs: [] }), pack(demo)]);
```

Six things to know, and then you can write your own:

- **A sentence says everything, and defaults nothing.** `.at(…)` when it fires · `.on(…)`/`.ignore(…)`
  which files · `.for(…)` which actor · `.check(…)` the question · `.message(…)` what you are told ·
  `.test({ pass, block })` what proves it. Say a verb twice and the compiler stops you.
- **A check is a function of `ctx`** and reaches the world only through it — `ctx.file`, `ctx.command`,
  `ctx.staged`, `ctx.exec`, `ctx.fs`, `ctx.git`. That is what lets the same check run live, run in a
  case, and replay from a recording without a repo.
- **A pack is just code.** `definePack` in a file here, or a package you install: identical shape.
  Publishing one is promotion, not a rewrite.
- **Packs come with the install, behind their own door.** `@jawache/flow` is the GRAMMAR a rule is
  written in; `@jawache/flow/packs` is the CONTENT — ten opinionated packs (`git` · `justfile` ·
  `node` · `secrets` · `typescript` · `fcis` · `tdd` · `docs` · `flow` · `work`), each bound by one
  `pack(…)` line, and an unbound one costs nothing. A pack names nothing it does not ship: the
  recipe your gate runs is a typed, mandatory parameter, so a config that never says which command
  cuts a release does not compile — and `flow`, flow's own self-protection, takes the folder your
  own packs live in, so it never guesses at a folder your repo does not have. `flow init` binds
  that one for you.
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
| `touch` | a tool call names a file, or a shell command reads a file | — | ✓ |
| `write` | a file is created or changed. A write from the Edit tool is checked before the file changes; a write from a shell command is checked the moment it has changed. A refused write is undone | ✓ | — |
| `delete` | a file is removed. An `rm` is checked before it runs; any other removal is checked the moment the file is gone. A refused delete puts the file back | ✓ | — |
| `command` | a shell command is about to run | ✓ | — |
| `commit` | git's pre-commit hook, over the staged changes | ✓ | — |
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
| `flow hook commit [--all]` | what git's pre-commit hook calls, over the staged changes. `--all` checks every file instead |

Two switches, both files, both one command:

```sh
touch .flow/off        # every rail silenced. rm it to turn the guard back on
touch .flow/record     # capture sessions so `flow replay` can run them again
```

## Exit codes

| | |
| --- | --- |
| `0` | yes — nothing refused, and every fitting is in place |
| `1` | **the report is no** — `flow status` found a fitting missing, or `flow test` found a case that fails |
| `2` | **something refused** — a rule blocked, or the config would not load, or a verb was misused |

**Exit 2 is a refusal at every rail, and it has to be.** It is the host's own refusal channel, and
a hook has exactly two codes to answer with — so a blocked write and a config that will not load
are both 2, because from a hook's seat they are one instruction: *this did not happen, read
stderr*. The commit gate answers the same way, for the same reason.

**Exit 1 belongs to the two verbs you ask rather than obey.** `flow status` and `flow test` are
asked a question, so they have room for a third answer, and "not fully in force" is a genuinely
different fact from "caught something". A config that will not load collapses even that room: it
makes both of them answer 2, because there is nothing left to report on.

This table is pinned by the suite — `e2e/product.test.ts` drives every row against the binary, so a
code that moves fails a test rather than quietly making this page wrong.

## Working on flow

```sh
just                    # the catalogue — every recipe carries its own [doc]
just test-commit        # what the commit gate runs: the rules cases, the typecheck, the suite
just gate               # the gate itself, over every file git can see
```

flow guards itself: `flow.config.ts` at the root binds the ten packs above through
`@jawache/flow/packs` — the same import a stranger writes — plus one pack this repo writes,
`guards/house.ts`. A door that stops exporting, a rule that stops loading or a bundle that stops
building refuses this repo's own next commit first.

Longer documentation is in [`docs/user/`](docs/user/index.md): the guidebook, the five-minute
quick start, the config reference, how to author a pack, and one page per stock check.

## Licence

MIT.
