# flow — the guidebook

docs/user/00 · how to guard a project, by situation · 2026-09-28

An agent working in your codebase makes confident mistakes, and it makes them at predictable moments: it edits a file nobody should touch, runs a command that deletes history, commits a dependency without telling you. flow stops each of these at the moment it happens — a command before it runs, an edit before it lands or, when it arrived through a shell command, the moment it has, and a commit before it closes — instead of leaving them for you to find at review. What a rule refuses never persists. This book assumes you know nothing about the system. It takes you from an unguarded repo to a guarded one, and every example runs as printed.

- [1 · The model in sixty seconds](#1--the-model-in-sixty-seconds)
- [2 · Guard a repo, from nothing](#2--guard-a-repo-from-nothing)
- [3 · The demo config, read line by line](#3--the-demo-config-read-line-by-line)
- [4 · The cookbook — “I want to…”](#4--the-cookbook--i-want-to)
- [5 · Rules bound to WHO, not what](#5--rules-bound-to-who-not-what)
- [6 · Testing your rules](#6--testing-your-rules)
- [7 · Fail loud — and the one repair exception](#7--fail-loud--and-the-one-repair-exception)
- [8 · What the guard sees — every change to the tree](#8--what-the-guard-sees--every-change-to-the-tree)
- [9 · Packs, and sharing across repos](#9--packs-and-sharing-across-repos)
- [10 · The vocabulary](#10--the-vocabulary)

## 1 · The model in sixty seconds

**flow gives an agent two kinds of guidance, and nothing in between.** A **breadcrumb** steers: a note that appears in the agent's session when it touches an area — “this code runs in a Worker, no Node natives”. A **guardrail** blocks: a check that refuses a write, a command, or a commit, and says why. There are no warnings — a rule either blocks, or it is a breadcrumb.

**`flow.config.ts` is the whole guard.** It is one TypeScript file at the repo root, and a rule not reachable from it does not run. There is no rule library on the machine, nothing resolves at run time, and nothing defaults: what the file says is exactly what fires. Because it is code, a misspelled verb is a red squiggle in your editor, and a rule that cannot compile never loads.

The file binds **packs** and speaks **overrides**, and those are the only two verbs it has:

```
import { defineConfig, override, pack } from "@jawache/flow";
import { git } from "@jawache/flow/packs";
import { house } from "./guards/house.ts";

export default defineConfig([
  pack(git, { release: "just release" }),           // bind a pack, and every entry in it
  pack(house),
  override(git.noForcePush).disabled("scratch repo — history is disposable here"),
]);
```

`pack(x)` binds a pack and all its entries. `override(x.entry)` speaks only what it changes — a different `.on(…)`, a different `.message(…)`, or `.disabled("why")` — and everything it does not say comes from the pack. An override **replaces** the key it names: a narrowed `.on(…)` is the whole list, never a merge, so a re-scope never quietly re-inherits the pack's defaults beside it.

**A pack is just code.** It is an ordinary TypeScript module — one you wrote in `guards/`, or one you installed from npm — of identical shape. Publishing a pack is promotion, not a rewrite (§9).

A guardrail fires at one or more **moments**. A breadcrumb has its own four:

| Moment | For | When |
| --- | --- | --- |
| `session` | breadcrumb | a chat starts, resumes, or is compacted |
| `touch` | breadcrumb | a tool call first names a matching file — through the Read tool, or through a shell command that reads it — then again after drift |
| `write` | guardrail | a file is created or changed. An Edit is judged before it lands, in memory; any other change is judged the moment it has landed, and undone if refused. Either way a refused write never persists (§8) |
| `command` | either | before a shell command runs — a guardrail refuses it, a breadcrumb says what you should know before it runs |
| `delete` | guardrail | a file is removed — judged before an `rm` runs, or the moment any other removal has landed, and restored if refused |
| `commit` | guardrail | the git pre-commit gate, over the staged set — this one fires for humans too |
| `turn-end` | either | when the agent hands back |

The commit moment is delivered by git's own pre-commit hook, not by any harness — which is why every harness gets the gate for free. In code, moments are imported symbols (`session · touch · write · command · deletion · commit · turnEnd`); `deletion` and `turnEnd` are spelled that way because `delete` is a reserved word, but the moment is still “delete”.

## 2 · Guard a repo, from nothing

```
npm i -g @jawache/flow   # once per machine; or `npm i -D @jawache/flow` and `npx flow`, per repo
cd my-repo
flow init            # writes flow.config.ts, .githooks/pre-commit, .flow/, and the hook registrations
```

`flow init` writes a demo `flow.config.ts` you can read in one screen, arms the commit gate, and registers the four session hooks so a coding agent in this repo asks flow first. It never writes over a config or a hook you already have, and re-running it adds only what is missing. `flow init --empty` gives you the same wiring with an empty config, for a repo that knows what it wants. Then:

```
flow status          # is the guard working here? what is bound, and what is not wired yet
flow test            # do the rules do what they claim? every rule's own cases, driven
```

`flow status` is the one report that matters: every rule resolved and able to fire, grouped by moment, plus every fitting the config needs — the config loads, the gate is armed, the hooks are registered. Green means guarded; every red line names its own fix, and the command exits non-zero, so a setup script can just ask.

## 3 · The demo config, read line by line

Open the `flow.config.ts` that `flow init` wrote. It is ordinary code, and it is the whole guard. It binds two packs: `flow`, flow's own self-protection, which brings the orientation note, the nudge when you edit the guard and the refusal to delete it; and a `demo` pack of three guardrails written out in front of you:

```
// flow.config.ts — this repo's whole guard, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Everything below is ordinary code: a pack is a
// module, a check is a function of its ctx, and a category is a name with its recognizer aboard.
// Nothing defaults — an absent key is absent — so a mistake fails in your editor, not at 3am.
//
//   flow status   what is bound, at which moments, and what is not wired yet
//   flow test     every rule's own cases, run

import { command, commit, defineCategory, defineConfig, definePack, guardrail, pack } from "@jawache/flow";
import { flow } from "@jawache/flow/packs";

// A category is a name and the HOST-WRITTEN evidence that recognises it — never a claim a session
// made about itself. This one is "the harness wrote a sidecar for you", which is what a spawned
// subagent is and a chat is not.
const subagent = defineCategory("subagent", (facts) => facts.subagent);

// Spelled in pieces on purpose. Written whole it would appear in this very file, and the gate below
// greps staged content — so the demo would refuse the commit that added it.
const MARKER = ["DO", "NOT", "COMMIT"].join("-");

export const demo = definePack("demo", {
  noForcePush: guardrail()
    .at(command)
    .check((ctx) =>
      /git\s+push\b[^\n]*(--force|(^|\s)-f(\s|$))/.test(ctx.command ?? "")
        ? ctx.fail("rewrites history other clones already have")
        : ctx.ok(),
    )
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),

  // No .on() here, and that is the sentence rather than an omission: an entry that names no paths is
  // about THE COMMIT, so it is asked once and handed the whole staged set. (Name paths with .on()
  // and the gate asks it once per staged file in scope instead, handing over each file.)
  noMarkedFiles: guardrail()
    .at(commit)
    .check(async (ctx) => {
      for (const path of ctx.staged ?? [])
        if ((await ctx.fs.read(path)).includes(MARKER)) return ctx.fail(path + " carries the marker");
      return ctx.ok();
    })
    .message("A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.")
    .test({
      pass: [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
      block: [{ staged: ["a.txt"], world: { fs: { "a.txt": MARKER } } }],
    }),

  // The same act, a different wearer, a different answer — a rule bound to WHO rather than to what.
  chatCommits: guardrail()
    .at(commit)
    .for(subagent)
    .check((ctx) => ctx.fail((ctx.staged ?? []).length + " staged file(s)"))
    .message("A subagent does not commit — hand the change back to the chat that spawned it.")
    .test({ pass: [], block: [{ staged: ["a.txt"] }] }),
});

export default defineConfig([
  // flow's own self-protection: what is steering you, a nudge when you edit it, and no deleting it.
  // Its packs list is where YOUR OWN packs live. Everything here is in this file, so it is empty —
  // move a pack out to a folder of its own and add that folder's glob, or the nudge and the delete
  // refusal stop covering it.
  pack(flow, { packs: [] }),
  pack(demo),
]);
```

Five things to take from it, and then you can write your own:

- **A sentence says everything, and defaults nothing.** `.at(…)` when it fires · `.on(…)`/`.ignore(…)` which files · `.for(…)` which actor · `.check(…)` the question · `.message(…)` what the blocked person reads · `.test({ pass, block })` what proves it. Say a verb twice and the compiler stops you; miss a `.message(…)` and it will not load.
- **A check is a function of `ctx`**, and it reaches the world only through it — `ctx.command`, `ctx.staged`, `ctx.file`, `ctx.fs`, `ctx.exec`, `ctx.git` — answering with `ctx.ok()` or `ctx.fail(detail)`. That one rule is what lets the same check run live, run in a test case, and replay from a recording with no repo at all.
- **Scope is the sentence.** `noMarkedFiles` names no `.on(…)`, so it is about *the commit* — asked once, handed the whole staged set. Name paths with `.on(…)` and the gate asks the rule once per staged file in scope instead, handing over each file.
- **A category reads host-written evidence.** `subagent` recognises itself from a sidecar the harness wrote, never from anything the session claimed — because a permission that rests on a claim rests on a lie (§5).
- **Every rule carries its own cases.** `.test({ pass, block })` is not decoration: a rule with no block case does not load (§6).

## 4 · The cookbook — “I want to…”

Most rules are a **stock check** plus a sentence. flow ships thirteen — a banned shape in a file, a banned command, a protected path, a JSON invariant, an import fence, a gate that runs a tool, and more — each with its own [page](./index.md#the-stock-checks--one-page-each). You import the check and hand it to `.check(…)`. Put your rules in a pack in `guards/`:

```
// guards/house.ts — the rules of this house
import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

export const house = definePack("house", {
  // …entries…
});
```

### …ban a word or pattern in some files

```
noTodo: guardrail()
  .at(write, commit)
  .on("src/**/*.ts")
  .check(textBan({ ban: ["\\bTODO\\b"] }))
  .message("No TODOs — do it now, or track it properly.")
  .test({ pass: [{ path: "src/x.ts", content: "const x = 1;" }], block: [{ path: "src/x.ts", content: "// TODO: later" }] }),
```

Each regex is tried against each line; matching is case-sensitive. For code *shapes* prefer `astGrep`, which parses the syntax tree and cannot false-match inside a string or a comment.

### …block a dangerous command

```
noDbReset: guardrail()
  .at(command)
  .check(banCommands({ ban: ["drizzle-kit\\s+drop", "wrangler\\s+d1\\s+delete"] }))
  .message("Destructive DB command — this goes through a release script, never by hand.")
  .test({ pass: ["drizzle-kit generate"], block: ["drizzle-kit drop"] }),
```

The whole command line is the subject — a command is one subject however many lines it occupies, so a pattern may span a newline. The body a heredoc carries is not part of the line: a script that merely mentions a banned command is not a use of it. Command rules take no `.on(…)`: the patterns *are* the scope.

### …protect files nobody should touch

```
keepGenerated: guardrail()
  .at(write, deletion, commit)
  .on("src/generated/**", "src/generated")
  .check(protectedPath({}))
  .message("Machine-written — edit the source the header names, then re-run the build.")
  .test({ block: [{ path: "src/generated/api.ts", content: "" }] }),
```

The `.on(…)` set *is* the protected set — touching a match is the violation. Name the bare folder too, or an `rm -rf` of the directory slips past the file globs. For an append-only folder (migrations: new files fine, existing ones untouchable), pass `protectedPath({ existingOnly: true })`. A protected-path rule is block-only: everything in its scope must be refused, so there is nothing to pass. A shell edit of a protected file is reverted the moment it lands (§8).

### …run my test suite / typecheck / any tool as a gate

```
testsGreen: guardrail()
  .at(commit)
  .check(execPasses({ run: "just test", changed: ["src/**"] }))
  .message("The suite is red — fix it, then commit.")
  .test({
    pass:  [{ staged: ["README.md"] }],                                          // nothing in src/** moved — the gate does not run
    block: [{ staged: ["src/a.ts"], world: { exec: { "just test": { code: 1, stdout: "1 failing" } } } }],
  }),
```

Exit 0 passes; anything else blocks and shows the tool's failing lines. `changed` is optional — run only when that area moved. If `run` contains `{files}`, flow substitutes the changed set.

### …make two things always change together

```
schemaAndMigration: guardrail()
  .at(commit)
  .check(changeTogether({ groups: [{ if: ["src/db/schema.ts"], thenAny: ["src/db/migrations/**"] }] }))
  .message("Schema changed but no migration is staged with it.")
  .test({
    pass: [{ staged: ["src/db/schema.ts", "src/db/migrations/003.ts"] }],
    block: [{ staged: ["src/db/schema.ts"] }],
  }),
```

### …pin a fact inside a JSON file

```
strictStaysOn: guardrail()
  .at(write, commit)
  .on("tsconfig.json")
  .check(jsonInvariant({ assert: [{ path: "compilerOptions.strict", equals: true, required: true }] }))
  .message("Strictness is load-bearing — a red squiggle is a defect found, not a setting to relax.")
  .test({
    pass:  [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":true}}' }],
    block: [{ path: "tsconfig.json", content: '{"compilerOptions":{"strict":false}}' }],
  }),
```

The checks are `equals`, `matches`, `keysPrefixedWith` and `required`. Set `required: true` on any path that must exist — without it a missing path skips silently.

### …require a sibling test for every module

```
pureHasTest: guardrail()
  .at(write, commit)
  .on("src/domain/**/*.ts")
  .ignore("**/*.test.ts")
  .check(siblingExists({ sibling: "{dir}/{name}.test.ts" }))
  .message("Test-first: the sibling test is missing. Write the failing test, then the code.")
  .test({
    pass:  [{ path: "src/domain/x.ts", content: "", world: { fs: { "src/domain/x.test.ts": "" } } }],
    block: [{ path: "src/domain/x.ts", content: "" }],
  }),
```

`{dir}` `{name}` `{base}` `{path}` expand from the touched file. To also require every export be referenced in that test, add a second rule with `symbolsInSibling` (TypeScript only — a cheap nudge, not coverage).

### …require a reason in the commit message

Some acts should not be blocked — they should just never be silent. Adding a dependency is the classic case: `commitReason` makes the act legal when the message explains it, and the explanation lands in the git history where the next reviewer reads it.

```
newDependency: guardrail()
  .at(command)
  .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
  .message("Adding a dependency is fine; adding it silently is not — put `new-dep: <name> — <why>` in the message.")
  .test({
    // the case records the git answers the check reaches for — the staged, added and untracked sets
    pass: [{ command: "git commit -m 'feat: x\\n\\nnew-dep: zod — checked ajv'", world: { exec: {
      "git diff HEAD --name-only": { stdout: "package.json" },
      "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
      "git ls-files --others --exclude-standard": { stdout: "" },
    } } }],
    block: [{ command: 'git commit -m "feat: x"', world: { exec: {
      "git diff HEAD --name-only": { stdout: "package.json" },
      "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
      "git ls-files --others --exclude-standard": { stdout: "" },
    } } }],
  }),
```

It fires at `command`, not `commit`: git runs the pre-commit gate *before* the message exists, so the only place a message can be read is the typed command. That also bounds what the rule sees — a commit from an editor, or by a human in a terminal, never passes the command moment. It polices agent-typed commits, which is the audience.

### …let only the builder change files

```
builderWrites: guardrail()
  .at(write, deletion)
  .check(oneWriter({ writers: ["builder", "parent"] }))
  .message("Only the builder changes files in this worktree — hand your finding back instead of fixing it.")
  .test({
    pass:  [{ path: "src/x.ts", content: "", actor: ["builder"] }],
    block: [{ path: "src/x.ts", content: "", actor: ["checker"] }],
  }),
```

For a worktree shared by several agents. `writers` names the categories that may change files; every other actor's write is refused — before it lands if it came through Edit, reverted if it came through a shell command (§8). The case names its actor beside the file.

### …steer without blocking

```
workerRuntime: breadcrumb()
  .at(touch)
  .on("src/pages/api/**")
  .text("This code runs in a Worker: no Node natives, env per request, gate auth first."),
```

A touch breadcrumb shows the first time a matching file is touched, then again after about 200,000 tokens of session drift. A `session` breadcrumb shows at every session start. General and specific notes stack — write a broader note plus finer ones.

### …write a check no stock one expresses

When the check needs real logic — read a companion file, hold an invariant no stock check covers — write your own with `defineCheck`. It is the same contract the stock checks are built on. The [authoring page](./03-authoring-scripts.md) is the whole of it.

## 5 · Rules bound to WHO, not what

A **category** is a name with its recognizer aboard, and `.for(category)` binds a rule to an actor. The demo's `chatCommits` refuses a commit from a subagent and lets the same commit from the main chat through — same act, different wearer, different answer.

```
const subagent = defineCategory("subagent", (facts) => facts.subagent);
```

The recognizer reads **host-written evidence** — a sidecar the harness wrote, the brief a spawn was given — and never a claim the session made about itself, because a permission that rests on a claim rests on a lie. For classifying by the agent a spawn was registered as, the stock `spawnedAs("builder")` is the path that cannot be got wrong; `defineCategory` is the escape hatch for everything else.

## 6 · Testing your rules

**Every rule carries its own cases, and a rule with no block case does not load.** That is the whole point: a rule whose block case passes is a rule that catches nothing, and `flow test` is what says so. Cases are data, driven through the same `ctx` the live rails build:

```
.test({
  pass:  ["git push origin main"],                       // a bare string is the command / file body
  block: ["git push --force origin main"],
})

.test({
  pass:  [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],   // or a full canned ctx
  block: [{ staged: ["a.txt"], world: { fs: { "a.txt": "SECRET" } } }],
})
```

A case supplies the world as data: `file`/`content` for a content rule, `command` for a command rule, `staged` for a commit rule, and a `world` with `fs`/`exec`/`git` answers for a rule that reaches further. `flow test` runs every bound rule's cases and reports one line. After a green run, flip a case so it should go red and watch it fail — a test that cannot fail proves nothing.

## 7 · Fail loud — and the one repair exception

**If `flow.config.ts` will not load, every gated moment refuses, loudly, until you fix it.** A guard that fails open is a guard that lies about being there. Delete a `.message(…)` and save: your editor goes red on the line, and the next write or command in a session is refused with the load error on screen. `flow status` prints the fault and names the entry:

```
flow 0.0.1 — the config will not load, so every guardrail and breadcrumb here is OFF.
  …
  ✗ missing-mandatory: `demo.noMarkedFiles` never said .message(…). Nothing in this grammar defaults — an absent key is absent, not a fallback.
1 red line — flow is NOT fully in force here.
```

The one exception is the repair itself: while the config is broken, a write to `flow.config.ts` — or to a pack it imports, whatever you called that folder — still goes through. That surface is read out of the config's own relative import lines, as text, because the module is the thing that will not load. Without the exception, the rule demanding a fix would also forbid it, and anything with a hook in front of it — an agent, the gate — would be locked out of its own repair. Commands stay refused, and so does the commit gate, so nothing written under the exception reaches a commit until the config loads green again.

## 8 · What the guard sees — every change to the tree

**A guardrail judges what changed on disk, not which tool changed it.** Before every tool call flow takes a content snapshot of the working tree; after the call it diffs the two. Every file the call added or changed is handed to the write rules with its real content, every file it removed to the delete rules, and every path it touched fires its breadcrumb. It does not matter whether the change came from the Edit tool, a heredoc, `sed -i`, a python script, a `just` recipe, an MCP tool or a subagent: the guard never looks at the command, so there is no second mechanism to reach for.

Two paths, one contract. An Edit or Write is judged **before it lands**: the would-be file is checked in memory, and a refusal means nothing touched disk. Everything else is judged **the moment it has landed**, and a refusal is undone: the offending files go back to their pre-call content, byte for byte, and the agent is told — beside the tool's own result — which rule refused and why. Either way, **a refused write never persists.** A rule author never needs to know which path ran: the check gets a path and content, and its message reads the same.

The two refusals wear different banners, so the log says which happened:

```
flow — blocked before the write landed:          an Edit, judged in memory — disk untouched
flow — write reverted after it landed:           a shell edit, undone from the snapshot

✗ house.noTodo · src/b.ts
  No TODOs in src/ — do it now, or track it properly.
    line 3 says TODO

src/b.ts is back to its previous content. Adjust the change so it passes and write it again — through Edit, which is judged before it lands.
```

**What a revert undoes, and what it does not.** By default only the files that failed a rule are put back; the other files the same command wrote are kept, and the message lists them. A repo that prefers “refused means the call never happened” sets `revert: "call"` in the config's settings, and the whole delta of the call is undone. Neither scope reaches side effects: a test run that read the bad content, a commit, a push or a migration the same command performed are not undone, and the message says so.

**Several agents, one worktree.** Within one session the harness runs writing tool calls one at a time, so a revert only ever touches that call's own files. Across a parent and its subagents, calls do overlap. flow sees the overlap from its own log — a snapshot with no matching diff is a call still in flight — and under overlap it never reverts a whole call, only the offending files, naming the calls that were in flight. A command started in the background returns before its process finishes; the writes it makes afterwards are reported and never reverted, because they belong to no call in the log. To say who may write at all, the [`oneWriter`](./checks/one-writer.md) check names the categories that may change files and refuses every other actor's write — a verifier that “fixes” a typo is reverted, with a message naming the writer.

**Reads through the shell.** A breadcrumb is guidance, so `touch` fires on the files a shell command reads too — `cat`, `head`, `sed -n`, `grep` on a path — before the command's output comes back. That detection is best-effort: a script that computes its own paths is not seen. The floor is the diff: a file that changes without ever having been touched gets its breadcrumb at the change, late but not lost.

**What `flow status` and `flow facts` add.** `status` names the session's permission mode and, under Claude Code's auto mode, whether the session is being steered toward shell edits. `facts` counts shell writes and shell reads beside the tool-call edits, with their paths, so the lead and coverage numbers stop under-counting.

**The edges.** Files outside the repo are not watched. Files under `.git` and `node_modules` are outside the snapshot; everything else is inside it, gitignored or not, unless the config's `snapshotIgnore` says otherwise. A file created and deleted within one command leaves no trace to judge. A command you type yourself with `!` is yours, not the agent's.

## 9 · Packs, and sharing across repos

**A pack is a module, so sharing one is a move, not a rewrite.** Rules start in a repo's `guards/`. When a second repo wants them, the pack file moves to an npm package and both repos `import` it — the entries are unchanged, and the config still binds it with one `pack(…)` line. There is nothing on the machine to resolve against and no library to keep in sync: the pack is the code you already read.

So every pack sits in one of two tiers, and the tier is just where its file lives. **Yours** — a pack about your repo's own terrain, its project map or house rules, which travels nowhere and stays in `guards/`. **Publishable** — general discipline worth handing to a second repo, which promotes to a package. Nothing changes about the rules when a pack moves tier; only the import path does.

Where two repos disagree, the second one **overrides** rather than forking the rule — a different scope, a different message, or off on the record:

```
export default defineConfig([
  pack(tdd),
  override(tdd.commitRunsTests).on("src/**"),                       // this repo's scope
  override(tdd.coverageGate).disabled("no coverage bar here yet"),  // visible opt-out
]);
```

A pack that needs a repo fact to work declares it as a mandatory typed parameter, so binding it without that fact does not compile — a pack cannot silently apply another repo's assumptions. `flow status` prints an override's reason beside the entry, so the divergence is visible rather than buried.

## 10 · The vocabulary

|  |  |
| --- | --- |
| **entry** | one breadcrumb or guardrail, named inside its pack |
| **pack** | a TypeScript module grouping entries — `definePack("name", { … })`; in `guards/` or installed from npm, identical shape |
| **bind** | `pack(x)` in `flow.config.ts` — turn a pack's entries on |
| **override** | `override(pack.entry).<key>(…)` — change one thing about a bound entry; each key replaces the pack's whole value |
| **moment** | when a rule fires: `session · touch · write · command · delete · commit · turn-end` |
| **observed** | a change the guard sees after the tool call that made it — a shell edit, a script, a recipe — judged by the same rules as an Edit, and undone if refused |
| **actor** | the categories a session wears, read from host-written evidence; `.for(…)` binds a rule to one, `ctx.actor` lets a check read them |
| **check** | a function of `ctx` answering `ctx.ok()` or `ctx.fail(detail)` — a stock one, or your own via `defineCheck` |
| **ctx** | the only door a check has to the world: the event facts (`file · command · staged · actor`) and the effects (`fs · exec · git`) |
| **category** | a name with its recognizer — `defineCategory` — read from host-written evidence, bound with `.for(…)` |
| **case** | a canned `ctx` that must pass or must block, carried on the entry as `.test({ pass, block })`; a rule with no block case does not load |
| **fitting** | what `flow status` checks beyond the rules: the config loads, the gate is armed, the hooks are registered |

---

docs/user/00 · Every example on this page is executed against the built binary. The exhaustive account — every key, every accepted value — is the [config reference](./02-entry-reference.md); each stock check has its own [page](./index.md#the-stock-checks--one-page-each).
