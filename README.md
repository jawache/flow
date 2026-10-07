# flow

**Guardrails for AI coding agents, written as code.** flow checks every change a coding agent makes to your repo against rules you write in one TypeScript file. When a change breaks a rule, flow refuses it: a banned command never runs, a refused file write is put back, and a refused commit does not land. The agent is told why, in your words. flow works with [Claude Code](https://claude.com/claude-code), and its commit rules run for people too.

Instructions in a `CLAUDE.md` file are advice: an agent can misread or skip them, more often as a session grows long. A flow rule runs every time, at the moment it applies, and a refused action does not happen.

Not to be confused with Flow, Meta's JavaScript type checker. No relation.

## Why use flow

- **Every change is checked, whichever tool made it.** flow records the files before each tool call and compares them after. A file written by the Edit tool, a shell command (`sed -i`, a heredoc, a script, a code generator), an MCP tool or a subagent is checked the same way, and a refused file is put back.
- **A banned command is stopped before it runs.** A force-push, a `git reset --hard`, an `npm install` you did not want: the rule refuses the command, and the agent gets the rule's message instead of the command's output.
- **Your commit rules hold for everyone.** A git pre-commit hook runs the same rules over the staged changes, whether you, an agent or a merge makes the commit, including files the commit deletes or renames.
- **Rules are tested code.** Each rule lists the inputs it must let through and the inputs it must refuse. A rule with no refusal case does not load, `flow test` runs every case, and your editor flags a mistyped rule, because the rules are TypeScript.
- **A broken guard refuses everything.** If the config does not load, every command and commit is refused, and so is every write except one that fixes the config. A mistake in the config never lets an action through.
- **Notes arrive when they matter.** A breadcrumb is a note shown to the agent the first time it reads or changes a file in a given area, instead of one long instruction file read once at the start.
- **Rules can depend on who is acting.** A rule can apply only to subagents, or let only one named agent write a folder. flow identifies an agent from what Claude Code records about it, never from what the agent says about itself.
- **Ten packs come with it.** Rules for git, node, TypeScript, secrets, the justfile, docs, tests, code layout, agent workflow and the guard itself, each turned on with one line and adjusted with `override(…)`.

## What a rule looks like

This rule is in the demo config `flow init` writes:

```ts
noForcePush: guardrail()
  .at(command)
  .check(banCommands({ ban: ["git\\s+push\\b[^\\n]*(--force|(^|\\s)-f(\\s|$))"] }))
  .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
  .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
```

`.at(command)` says when the rule runs: before every shell command. `.check(…)` is what it checks, `.message(…)` is what the agent is told, and `.test(…)` lists the cases `flow test` runs. When an agent tries `git push --force origin main`, the command does not run, and the agent is shown:

```text
flow — command blocked before it ran:

✗ demo.noForcePush · git push --force origin main
  Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
    matches banned /git\s+push\b[^\n]*(--force|(^|\s)-f(\s|$))/

Adjust the command, then retry.
```

## Get started

flow needs Node 24 or later, git, and Claude Code for the session rules. In the repo you want guarded, install it as a dev dependency, so every clone gets the same version:

```sh
npm i -D @jawache/flow
npx flow init
npx flow status
```

For a folder with no `package.json`, install it globally with `npm i -g @jawache/flow` and run `flow init`.

`flow init` writes `flow.config.ts`, a git pre-commit hook and flow's hook registrations for Claude Code. `flow status` lists every rule and checks the wiring: green means every rule loads and is in place. Then follow the [quick start](./docs/user/01-quick-start.md), which takes you from an unguarded repo to a refused commit in five minutes.

## Documentation

| To | Read |
| --- | --- |
| Learn flow by doing, in five minutes | [Quick start](./docs/user/01-quick-start.md) |
| Solve a specific problem: protect files, ban a command, gate a commit on your tests | [Guidebook](./docs/user/00-guide.md) |
| Look up the rule grammar, the moments, `ctx` and test cases | [Config reference](./docs/user/02-entry-reference.md) |
| Look up a command, a switch or an exit code | [Command reference](./docs/user/04-cli-reference.md) |
| Write your own check or pack | [Authoring a pack](./docs/user/03-authoring-scripts.md) |
| See what a shipped pack or check does | [The packs](./docs/user/packs/index.md) · [the checks](./docs/user/index.md#the-stock-checks--one-page-each) |
| Upgrade a repo that already uses flow | [Migration guides](./docs/user/migrations/index.md) |
| See what changed in each release | [CHANGELOG.md](./CHANGELOG.md) |

## How it works

`flow init` registers flow with Claude Code, and adds a git pre-commit hook. Claude Code then runs `flow` when a session starts, before and after every tool call, and when the agent finishes. Git runs `flow hook commit` before every commit. Each time, flow loads `flow.config.ts` and runs the rules bound to that moment: `session`, `touch`, `write`, `delete`, `command`, `commit` or `turn-end`. A guardrail refuses by exiting with code 2, which Claude Code and git both treat as "do not go ahead", and its message is shown to the agent. A breadcrumb never refuses: its text is added to the agent's context. The [guidebook](./docs/user/00-guide.md) explains each moment.

## Working on flow

```sh
just install && just link    # run `flow` from your checkout
just                         # every recipe, with what it does
just test-commit             # what the commit gate runs: the rule cases, the typecheck, the suite
just test-packs              # the ten shipped packs, bound in a throwaway repo
```

flow guards its own repo. `flow.config.ts` binds the ten shipped packs, plus one pack this repo writes, `guards/house.ts`, so a change that breaks a rule, an export or the build is refused at this repo's own next commit.

## Licence

MIT.
