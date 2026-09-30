[flow packs](./index.md) › work

# The `work` pack

6 guardrails · 0 breadcrumbs · fires at: command · write · delete · takes 1 parameter

The WORK LIFECYCLE's rungs: who is acting, and what each rung may do.

A pack for repos that run the `work` lifecycle skill — spec · plan · start · build · review ·
reflect · complete. It names the three rungs the lifecycle has (parent · builder · checker),
binds one rule per rung to keep them from doing each other's jobs, and adds the two rules about
the commands that write the journal: the inbox is the human's queue, and prose recorded through
a shell is prose the shell can rewrite first.

IT IMPORTS NOTHING FROM WORK. It is a plain consumer of flow's public door, exactly like every
other pack here, and it knows the work CLI only as command strings on a rail. That is what lets
flow ship it without depending on the tool it is about.

flow ships no category names and never will: what a rung is called is a property of the way a
team works, not of a guard engine. These three are the WORK lifecycle's, defined here beside the
rules that bind to them — a builder may not do a parent's job, a checker may not write.

Generated from `packs/work.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 1 parameter. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `writers` | `readonly Writer[]` | The rungs allowed to change files in a worktree, turning on ONE WRITER: a write or a delete by any other actor is refused — an Edit before it lands, anything else put back after.<br><br>OPTIONAL, and with no list there is no entry at all. One writer is for a worktree several agents share with one builder in it; in a repo where a helper agent of any other kind is expected to write, it would refuse that helper's every change, so it is off until a repo asks. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { work } from "@jawache/flow/packs";

export default defineConfig([pack(work, { writers: ["builder", "parent"] })]);
```

To turn one entry off, say so in the config: `override(work.planIsTheParents).disabled("why")`. It is a committed change, so a reviewer sees it.

## What to install first

The `work` CLI and its lifecycle skill. Every rule here reads a `work …` command line,
so in a repo that does not run the lifecycle they are five rules that can never fire.

## Adopting it

Bind it only in a repo whose tasks are actually run through the lifecycle. The three rung
rules are scoped to categories this pack defines, so they judge nobody until a session is
classified as a builder or a checker — a human at a keyboard is neither. Name `writers` to let
only those rungs change files in the worktree.

## Entries

- [`work.planIsTheParents`](#workplanistheparents--guardrail) · guardrail · A builder owns its phase, not the plan — the verdict, the amendment and the cost record are the parent's.
- [`work.checkersDoNotWrite`](#workcheckersdonotwrite--guardrail) · guardrail · A verifier and the review lenses sit at a boundary they must not write to.
- [`work.ticksAreTheChilds`](#workticksarethechilds--guardrail) · guardrail · The parent records verdicts; a box is ticked by the child that built it, with its evidence.
- [`work.noAgentInboxItems`](#worknoagentinboxitems--guardrail) · guardrail · The inbox is the human's speccing queue — an agent raises a finding in chat, never files one.
- [`work.noShellSubstitutionInProse`](#worknoshellsubstitutioninprose--guardrail) · guardrail · A backtick inside a double-quoted argument of a work verb that records prose is live command substitution, not Markdown.
- [`work.builderWrites`](#workbuilderwrites--guardrail) · guardrail · Only the named rungs change files in this worktree — a checker or a stray helper hands its finding back.

## `work.planIsTheParents` — guardrail

A builder owns its phase, not the plan — the verdict, the amendment and the cost record are the parent's.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** `builder`
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:^|[\\n;&|(]\\s*)\\s*work\\s+plan\\s+(?:verdict|amend)\\b",
    "(?:^|[\\n;&|(]\\s*)\\s*work\\s+(?:save|task)\\b",
    "(?:^|[\\n;&|(]\\s*)\\s*work\\s+cost\\s+record\\b"
  ]
}
```

</details>

### What the agent reads when refused

```
You are a builder, and this command is the parent's. Yours: `work plan status` · `work plan tick` · `work plan decision`.
A verdict or an amendment needs the whole plan in view, and you can only see one phase. `work cost record` is worse than refused — it would succeed: every record is an INCREMENT since the last stamp, so filing one mid-phase bills the phase before yours for work it never did.
What you have is an ask. Say it to the parent — what you hit, what your boxes do not cover, what you would do — and carry on with the boxes that are yours while you wait.
```

### Proved by

**passes**

- running `work plan status --json`
- running `work plan tick F7.B1 --evidence diff:abc123`
- running `work cost`

**blocks**

- running `work plan verdict F7 --pass --cite x`
- running `work save`
- running `work cost record F7`

## `work.checkersDoNotWrite` — guardrail

A verifier and the review lenses sit at a boundary they must not write to.

- **Refuses at** a file is written or edited
- **Watches** not scoped by path
- **Categories** `checker`
- **Check** written inline in this pack

### What the agent reads when refused

```
You were spawned to JUDGE this work, and a judge that edits the thing it is judging has destroyed the evidence. Report what you found — PASS or FAIL with citations — and let the rung that owns the code change it. (The verifier's own tool list already withholds Edit and Write; this is the half that holds for every review lens too, and it holds at the rail rather than in a frontmatter list somebody can widen.)
```

### Proved by

**passes**

- *no pass case declared*

**blocks**

- writing `src/thing.ts` — `x`

## `work.ticksAreTheChilds` — guardrail

The parent records verdicts; a box is ticked by the child that built it, with its evidence.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** `parent`
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:^|[\\n;&|(]\\s*)\\s*work\\s+plan\\s+tick\\b"
  ]
}
```

</details>

### What the agent reads when refused

```
A box is ticked by the rung that built it. You are supervising: you did not do the work, so you cannot supply the evidence, and a tick whose proof came from reading a report is exactly the provenance the journal exists to prevent. If a child left a box unticked, that is the finding — record the verdict on it.
```

### Proved by

**passes**

- running `work plan verdict F7 --pass --cite x`

**blocks**

- running `work plan tick F7.B1 --evidence diff:abc`

## `work.noAgentInboxItems` — guardrail

The inbox is the human's speccing queue — an agent raises a finding in chat, never files one.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:^|[\\n;&|(]\\s*)\\s*work\\s+inbox\\s+new\\b"
  ]
}
```

</details>

### What the agent reads when refused

```
`work inbox new` is the human's own door, and this command rail is only ever crossed by an agent — a person typing in a terminal has no hooks in front of them. So the fact that this fired means an agent is filing.
The inbox is a SPECCING QUEUE, not a findings drawer: every item in it is something its owner has decided to think about, and an item nobody chose to add is a decision taken away from them and returned as a chore. Work is born through `/work spec`, which only a clear human instruction opens.
What you have is a finding. Say it in the chat — headline, why it matters, what you would do — and let the human decide whether it becomes an item, a spec, or nothing.
```

### Proved by

**passes**

- running `work inbox list`
- running `echo "the human runs work inbox new themselves" >> note.md`

**blocks**

- running `work inbox new --summary "a thing"`
- running `echo hi && work inbox new --summary x`

## `work.noShellSubstitutionInProse` — guardrail

A backtick inside a double-quoted argument of a work verb that records prose is live command substitution, not Markdown.

- **Refuses at** a shell command is about to run
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`banCommands`](../checks/ban-commands.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "(?:work\\s+(?:plan|task|recap|record|spec|complete)\\b)[^\"`]*(?:\"(?:(?!<<-?')[^\"])*\"[^\"`]*)*\"(?:(?!<<-?')[^\"])*`"
  ]
}
```

</details>

### What the agent reads when refused

```
You are recording prose through a shell command, and a backtick inside a DOUBLE-quoted argument is not Markdown — the shell RUNS it and splices its output into your text before the command ever sees it.
On an append-only record there is no undo: no amend, no redact. And once the binary has argv the splice has already happened, so this is the only moment it can be caught.
Fix: SINGLE-quote the argument (backticks are literal there), or feed the prose on stdin with a QUOTED heredoc — `git commit -F -` plus `<<'EOF'`, which this rule treats as safe.
ALREADY single-quoted and still blocked? Then your PROSE carries an unbalanced double quote before the backtick, and the matcher cannot tell that quote from a real open argument. Nothing would splice — this one is the rule's cost, not your mistake. Balance the quote, drop it, or use the heredoc; do not go back to double quotes to make it pass.
```

### Proved by

**passes**

- running `work plan decision 'chose the `chain` builder' --chose x --reverse y`
- running `work plan status --json`

**blocks**

- running `work plan decision "chose the `chain` builder" --chose x --reverse y`

## `work.builderWrites` — guardrail

Only the named rungs change files in this worktree — a checker or a stray helper hands its finding back.

- **Refuses at** a file is written or edited · a file is deleted
- **Watches** not scoped by path
- **Categories** every session
- **Check** [`oneWriter`](../checks/one-writer.md)

<details><summary>settings</summary>

```
{
  "writers": [
    "builder",
    "parent"
  ]
}
```

</details>

### What the agent reads when refused

```
Only the builder changes files in this worktree — hand your finding back instead of fixing it.
```

### Proved by

**passes**

- writing `src/x.ts` as `builder`

**blocks**

- writing `src/x.ts` as `checker`

## Where each part of this page comes from

| On the page | In the pack | Read how |
| --- | --- | --- |
| Lead, and the parameters table | The doc comment on `definePack`, and the doc comment on each member of the parameter interface | JSDoc, read with the TypeScript compiler API |
| The named sections above the entries | An `@install`, `@setup` or `@adopt` tag on that same doc comment. A tag nobody uses renders nothing. | JSDoc tags |
| Entry id, kind, moments, globs, categories, description | The entry itself — `.at()` `.on()` `.description()` | Loaded: the same data the engine runs |
| Why it exists | The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason. | JSDoc |
| What the agent reads | `.text()` or `.message()`, verbatim | Loaded |
| Check and its settings | The check the entry asks, and the options it was given | The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied. |
| Proved by, and what each case was told | `.test({ pass, block })` — the event, and the `world` the case supplies for whatever the check reads | Loaded |

---

flow docs · [the packs](./index.md) · `work` · generated page, do not edit
