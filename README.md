# flow

**Guardrails and breadcrumbs for AI coding agents, written as code.** flow judges an agent's work at the commit, refuses a short list of commands outright, and steers the rest with notes. The rules are one TypeScript file in your repo. When a commit or a command breaks a rule, flow refuses it and tells the agent why, in your words. flow works with [Claude Code](https://claude.com/claude-code) and [Codex](https://developers.openai.com/codex), and its commit rules run for people too.

Instructions in an `AGENTS.md` or `CLAUDE.md` file are advice: an agent can misread or skip them, more often as a session grows long. A flow guardrail runs every time, at the moment it applies, and a refused action does not happen.

Not to be confused with Flow, Meta's JavaScript type checker. No relation.

## Why use flow

- **The commit is judged on real content.** A git hook runs your rules over the staged files, the files the commit deletes, and the message, whichever tool wrote them and whoever commits: the lint, the tests, a coverage bar, a banned pattern, a protected file, the format of the message.
- **A named command is stopped before it runs.** A force-push, a `gh repo delete`, a raw command your repo has a recipe for: the rule refuses the command, and the agent gets the rule's message instead of the command's output.
- **Recoverable mistakes are not blocked.** flow does not stop a write. An agent finds out at the commit, while the mistake is still in the working tree.
- **Notes arrive when they matter.** A breadcrumb is a note shown to the agent at the start of a session, chosen by the type of agent, or the first time it changes a file in a given area, instead of one long instruction file read once at the start.
- **Rules are tested code.** Each rule lists the inputs it must let through and the inputs it must refuse. A rule with no refusal case does not load, `flow test` runs every case, and your editor flags a mistyped rule, because the rules are TypeScript.
- **A broken guard is never silent.** If the config does not load, every guardrail and breadcrumb is off, the agent is given the load error with every command, and every commit is refused until the config loads.
- **Rules can depend on who is acting.** A guardrail or a breadcrumb can apply only to one type of agent. flow identifies an agent from what the harness records about it, never from what the agent says about itself.
- **Your rules are yours.** flow ships one small pack, which protects the guard itself. Every other rule is in your repo, or in a package of packs you share between your repos.

## What a rule looks like

```ts
noForcePush: guardrail()
  .at(command)
  .check(banCommands({ ban: ["git push --force", "git push -f"] }))
  .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
  .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
```

`.at(command)` says when the rule runs: before a shell command. `.check(…)` is what it checks, `.message(…)` is what the agent is told, and `.test(…)` lists the cases `flow test` runs. When an agent tries `git push --force origin main`, the command does not run, and the agent is shown:

```text
flow — command blocked before it ran:

✗ house.noForcePush · git push --force origin main
  Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.
    matches banned `git push --force`

Adjust the command, then retry.
```

## Get started

flow needs Node 24 or later, npm and git, and Claude Code or Codex for the session rules. Install it in the repo you want guarded, from GitHub, at a release tag:

```sh
cd my-repo
npm i -D github:jawache/flow#v0.4.0
npx flow init
npx flow status
```

The tag holds flow's built files, and the lockfile pins the commit. flow is not on npm, and nothing is installed for the whole machine. [How to install and pin flow](./docs/user/how-to/install-flow.md) has the details, including a project that is not a Node project.

`flow init` asks which harnesses you use, then writes `flow.config.ts`, a git hook, and flow's hook registrations for each one, all inside the repo. `flow status` lists every rule and checks the wiring: green means every rule loads and is in place. Then follow [Getting started](./docs/user/tutorials/getting-started.md), which takes you from an unguarded repo to a refused commit, a refused command and a breadcrumb shown.

## Documentation

| To | Read |
| --- | --- |
| Learn flow by doing | [Getting started](./docs/user/tutorials/getting-started.md) |
| Solve a specific problem: gate a commit on your tests, check the commit message, block a command | [The how-to guides](./docs/user/index.md#get-something-done) |
| Look up the rule grammar, the moments, `ctx` and test cases | [The config](./docs/user/reference/config.md) · [moments](./docs/user/reference/moments.md) · [`ctx`](./docs/user/reference/ctx.md) |
| Look up a command, a switch or an exit code | [The flow command](./docs/user/reference/cli.md) |
| Look up how a shell line is read | [The command parse](./docs/user/reference/parse.md) |
| See what flow reads from your harness | [Claude Code](./docs/user/reference/claude-code.md) · [Codex](./docs/user/reference/codex.md) |
| Write your own check or pack | [How to write your own check, and share rules as a pack](./docs/user/how-to/write-your-own-check.md) |
| See what a stock check does | [The checks](./docs/user/index.md#the-stock-checks--one-page-each) |
| Understand why flow works the way it does | [How flow works](./docs/user/explanation/how-flow-works.md) |
| Upgrade a repo that already uses flow | [Migration guides](./docs/user/migrations/index.md) |
| See what changed in each release | [CHANGELOG.md](./CHANGELOG.md) |

## How it works

`flow init` registers flow with Claude Code and Codex, and adds a git hook. The harness then runs `flow` when a session or a subagent starts, before a shell command, after a tool call, and when an agent hands back. Git runs flow at every commit, once it has the message. Each time, flow loads `flow.config.ts` and runs the rules bound to that moment: `commit`, `command`, `session`, `file-change` or `turn-end`. A guardrail refuses by exiting with code 2, which the harness and git both treat as "do not go ahead", and its message is shown to the agent. A breadcrumb never refuses: its text is added to the agent's context. [Moments](./docs/user/reference/moments.md) describes each one.

## Working on flow

```sh
just install                 # dependencies, and a link from node_modules back to this checkout
just                         # every recipe, with what it does
just test-commit             # what the commit runs: the rule cases, the typecheck, the suite
just test-tutorial           # the Getting started tutorial against the built binary
```

flow guards its own repo, from its own checkout. `flow.config.ts` binds the `flow` pack and this repo's own packs in `guards/`, and its hooks are in its own `.claude/settings.json` and `.codex/hooks.json`. A change that breaks a rule, an export or the build is refused at this repo's own next commit.

## Licence

MIT.
