---
summary: "about flow: the two kinds of guidance, why the commit is the centre, where a rule goes, the one file and its packs"
---

# How flow works

flow refuses an agent's mistake at the commit, refuses a short list of commands outright, and steers the rest with notes.

An agent working in your codebase makes confident mistakes. It commits code that fails the lint, writes a dependency in without telling you, or force-pushes over history. flow judges at two moments:

- **A commit** is refused before git records it, on the staged files and the message.
- **A command** is refused before it runs, when it is one you named.

Everything else an agent does, flow leaves alone or answers with a note.

## Two kinds of guidance, and nothing in between

- **A breadcrumb** steers. It is a note shown to the agent: at the start of a session, when a file in an area changes, before a command, or at turn-end. One example is "this code runs in a Worker, no Node natives".
- **A guardrail** blocks. It is a check that refuses a commit or a command, or holds a turn open, and says why.

There are no warnings. A rule either blocks or it is a breadcrumb. In our view a warning is a third kind that an agent learns to read past, which is why flow does not have one.

## Why the commit is the centre

An agent changes files through many doors: an edit tool, `sed -i`, a heredoc, a script, a recipe. Under some harnesses every write is a shell command. A rule that judges each write as it lands has to work out what a shell line changed, and it is wrong whenever it cannot fully read the line.

A commit has none of that. Git holds the staged files and the message whole, whatever tool wrote them. A rule at the commit judges real content, once, at the point where work becomes history. It runs for every harness, and for a person committing in a terminal.

So content rules live at the commit: the lint, the tests, the coverage bar, a banned pattern, a protected file, the format of the message. An agent may write a file that breaks a rule, and it finds out when it commits. Until then the mistake is in the working tree, where it is recoverable.

## Where a rule goes

| Kind of thing | Where it goes |
| --- | --- |
| Cannot be undone and leaves the machine, such as a force-push | A guardrail at `command` |
| Content quality, and anything said in a commit message | A guardrail at `commit` |
| A preferred way of working | A breadcrumb at `session`, or a redirect at `command` |
| A recoverable mistake, such as discarding your own edits | Nothing, or a breadcrumb |
| Who may do what | The agent's tool list, in the harness, or a guardrail bound to that type of agent |

A command guardrail is for an exact command you can name in words. A rule that has to guess what a shell line does is a rule for the commit, or a breadcrumb.

## `flow.config.ts` is the whole guard

`flow.config.ts` is one TypeScript file at the repo root, and a rule that cannot be reached from it does not run. There is no rule library on the machine, and nothing resolves at run time. No rule is on unless the file binds it, so the file lists exactly what runs.

The file is code for a reason. A misspelled verb is a red squiggle in your editor, and a rule that cannot compile never loads. The mistake shows where you write it, before anything runs.

## Packs and overrides

The file has two verbs: it binds **packs**, and it states **overrides**. That is what keeps it short: the rules are in the packs, and the config is the list of them.

```
import { defineConfig, override, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";
import { house } from "./guards/house.ts";

export default defineConfig([
  pack(flow),                                         // bind a pack, and every entry in it
  pack(house),
  override(house.noForcePush).disabled("scratch repo — history is disposable here"),
]);
```

- **`pack(x)`** binds a pack and every entry in it.
- **`override(x.entry)`** states only what it changes, such as a different `.on(…)`, a different `.message(…)`, or `.disabled("why")`. Everything it leaves out comes from the pack. It can never change the entry's `.check(…)` or `.test(…)`.

An override replaces the key it names. A narrowed `.on(…)` is the whole list, never a merge. Where two repos disagree about one entry, the second one overrides it instead of forking the pack. The override is a committed line in its config, so the difference between the repos stays visible, and `flow status` prints the reason for an entry turned off with `.disabled("why")`.

## A pack is just code

A pack is an ordinary TypeScript module. flow ships one, `flow`, which protects the guard itself. Every other pack is yours:

- **In `guards/`.** A pack about your repo's own terrain, such as its house rules.
- **In a package of its own.** Rules worth giving to a second repo. Each repo installs the package and imports the pack.

Nothing about the rules changes when a pack moves from one to the other. Only the import path changes. A pack that needs a fact about the repo declares it as a mandatory typed parameter, so a pack cannot apply another repo's assumptions without saying so. [How to write your own check, and share rules as a pack](../how-to/write-your-own-check.md) gives the steps.

## A sentence states the whole rule

```
noForcePush: guardrail()
  .at(command)
  .check(banCommands({ ban: ["git push --force", "git push -f"] }))
  .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
  .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
```

- **Each verb is one part of the rule.** `.at(…)` is when it runs, `.on(…)` and `.ignore(…)` are which files, `.for(…)` is which actor, `.check(…)` is the question, `.message(…)` is what the blocked agent reads, and `.test({ pass, block })` is what proves it. A verb written twice is a compile error.
- **A check is a function of `ctx`,** and it reaches the world only through it. Because of that one rule, the same check runs live, runs in a test case, and replays from a recording with no repo at all.
- **A category reads evidence the harness wrote.** [Rules bound to who](./rules-bound-to-who.md) explains why.
- **Every rule has its own cases.** A guardrail with no block case does not load, because a block case is what proves it catches something.

## Two harnesses, one config

flow plugs into a harness, the program that runs the agent, and into git. The harness calls flow at a session's start, before a shell command, after a tool call and at turn-end. Git calls flow at the commit. flow runs under Claude Code and Codex, and the same `flow.config.ts` guards a repository under both.

---

[Index](../index.md) · when each rule runs: [the moments](../reference/moments.md) · every verb: [the config reference](../reference/config.md) · what flow can and cannot see: [what flow sees](./what-flow-sees.md) · try it: [getting started](../tutorials/getting-started.md)
