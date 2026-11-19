---
summary: "each word flow gives its own meaning, in one line"
---

# Glossary

Each word flow gives its own meaning, as the other pages use it. git's and the harness's words, such as commit, hook, worktree and subagent, mean what those tools say.

## actor

the agent that is acting, as the set of categories recorded for it, which a check reads from `ctx.actor`

## bind

to turn a pack's entries on, with `pack(x)` in `flow.config.ts`

## breadcrumb

text shown to the agent at a moment, which refuses nothing

## case

a canned `ctx` that must pass or must block, written on the entry as `.test({ pass, block })`

## category

a kind of actor, as a name with the function that recognises it from evidence the harness wrote, bound to a rule with `.for(…)`; one agent can be in several, such as `subagent` and `builder`

## check

a function of `ctx` that returns `ctx.ok()` or `ctx.fail(detail)`: a stock one, or your own from `defineCheck`

## ctx

the one argument a check is called with, and its only access to files, commands and git

## entry

one breadcrumb or one guardrail, named inside its pack

## fitting

something `flow status` checks beyond the rules: the config loads, git runs the commit hook, each harness's hooks are registered, and the `flow` they run is found

## guardrail

a rule that refuses a commit or a command, or holds a turn open, and says why

## harness

the program that runs the agent and calls flow's hooks: Claude Code or Codex

## installed pack

a pack whose file is under `node_modules` or outside the repo. Every other pack is the repo's own

## moment

when a rule runs: `commit`, `command`, `session`, `file-change` or `turn-end`

## override

`override(pack.entry)` in `flow.config.ts`, which changes one key of a bound entry and leaves the rest as the pack has it

## pack

a TypeScript module that groups entries, `definePack("name", { … })`, in a file of your repo or in a package of its own

## parse

the list of commands flow reads from a shell line, each a program and its arguments

## redirect

a command guardrail whose message names the command to run instead

## trust gate

one of the two conditions Codex sets before it runs a project's hooks: the folder is trusted, and each hook is approved
