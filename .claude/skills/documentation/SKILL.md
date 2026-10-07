---
name: documentation
description: Use whenever writing or rewriting documentation for people — anything under docs/user, a README, a guide, a reference page, a tutorial, a how-to, an explanation, a check or pack page, or a release's migration guide under docs/user/migrations. Triggers on "write the docs", "rewrite this page", "document this", "update the guide", "write the migration guide", before `just release`, or any edit to a page a human reads. The Diátaxis method, quadrant by quadrant, plus the plain-language rules every quadrant obeys.
---

# Writing documentation — the Diátaxis method

Before writing, run the compass on the page, and on any paragraph in doubt. Two questions:
does it inform **action** (doing) or **cognition** (knowing)? Does it serve **acquisition**
of skill (study) or **application** of skill (work)?

| informs | serves | so it is |
|---|---|---|
| action | acquisition | a **tutorial** |
| action | application | a **how-to guide** |
| cognition | application | **reference** |
| cognition | acquisition | **explanation** |

One page, one quadrant. Content that belongs elsewhere is linked, not included. A page that
needs two quadrants is two pages, or one section per quadrant with the quadrant named.

## Tutorial

A learning experience under a tutor's guidance. First person plural.

- "We …" — affirms the relationship between tutor and learner.
- "In this tutorial, we will …" — says what the learner will accomplish.
- "First, do x. Now, do y. Now that you have done y, do z." — no room for ambiguity or doubt.
- "We must always do x before we do y because … (see Explanation for more details)." — minimal
  explanation, in the most basic language possible.
- "The output should look something like …" — clear expectations.
- "Notice that … Remember that … Let's check …" — clues that confirm they are on track.
- End by describing, and mildly admiring, what the learner has accomplished.

Deliver visible results early and often. Focus on the concrete. Ruthlessly minimise
explanation. Ignore options and alternatives. Aspire to perfect reliability: it works every
time, for every learner.

## How-to guide

Directions to a result, for someone who already has the skill. Second person, conditional
imperatives.

- "This guide shows you how to …" — states the task or problem.
- "If you want x, do y. To achieve w, do z." — conditional imperatives.
- "Refer to the x reference guide for a full list of options." — keeps it uncluttered.
- Title it with what it does: "How to integrate application performance monitoring".

Address real-world complexity. Omit the unnecessary. Describe a logical sequence. Seek flow.
No teaching, no explanation, no discussion: only what the reader must do.

## Reference

Technical description of the machinery and how to operate it. Austere, neutral, factual.
Describe and only describe.

- "Django's default logging configuration inherits Python's defaults." — states a fact.
- "Sub-commands are: a, b, c, d, e, f" — lists commands, options, flags, limits, errors.
- "You must use a. You must not apply b unless c." — warns where needed.

Adopt standard patterns, so each item is where the reader expects, in a shape they know.
Mirror the structure of the product. Examples illustrate; they never instruct or explain.

## Explanation

A discursive treatment of a subject that permits reflection. Its title takes an implicit
"about".

- "The reason for x is because historically, y …" — reasoning.
- "W is better than z, because …" — judgement, admitted as such.
- "An x in system y is analogous to a w in system z. However …" — context.
- "Some users prefer w (because z). This can be a good approach, but …" — alternatives weighed.
- "An x interacts with a y as follows: …" — mechanism, to clarify causation.

Make connections. Provide context. Admit opinion and perspective. Consider alternatives and
counter-examples. Keep it bounded: no instructions, no reference tables.

## Migration guides

A how-to guide with a fixed shape: `docs/user/migrations/<version>.md` says what a repo that
uses flow must change to upgrade to `<version>` from the release before it. Its reader is
usually an agent in that other repo, pointed at the page and told to migrate. Every step
must be one it can detect, apply and check without reading flow's source.

`just release` refuses until the page for the version it would cut exists (`just release-dry`
prints that version), and the house pack refuses a commit whose `package.json` version has no
page. Add the page to the table in `docs/user/migrations/index.md`.

To find what changed, read `git log --format='%h %s%n%b' v<previous>..HEAD`, the `BREAKING
CHANGE` footers, and `git diff v<previous> HEAD -- index.ts packs/index.ts flow.ts` plus
`HOOK_REGISTRATIONS` and `PRE_COMMIT` in `adapter/domain.ts`. Those cover the grammar and
pack exports, the CLI, the session hook registrations and the pre-commit hook. A change
belongs on the page when it changes something in the other repo: a config that no longer
loads, an import, an entry id an `override` lists, a parameter, `.claude/settings.json`,
`.githooks/pre-commit`, or a rule that now blocks or passes differently.

The page, in this order:

```
# Upgrade to <version>

From <previous> · <release date, or "unreleased"> · [all guides](./index.md)

<One paragraph: what this release changes for a repo that uses flow, and whether it needs any
change. "No changes needed" is a valid answer, and is stated here.>

## 1 · Install <version>
<The install commands, for a dev dependency and for a global install.>

## 2 · Required changes
### 2.1 · <What to change, imperative>
**Applies if:** <a command or grep the reader runs, and the output that means yes>
**Change:** <the exact before → after>
**Why:** <one sentence>

## 3 · What now blocks or passes differently
<Each behaviour change with no config change: what is refused or allowed now that was not,
and what to do if a commit or a tool call is now refused.>

## 4 · Optional
<New features worth adopting: one line each, with the snippet.>

## 5 · Verify
<`flow status` green, `flow test` all green, and the gate over the whole tree, using the
command spelling this version has.>
```

A section with nothing in it says "None." rather than disappearing, so a reader knows it was
checked. A version range is applied one guide at a time, oldest first; say so only in the
index.

## In every quadrant

- State mechanisms, not metaphors. Say what is called, with what, and what is returned;
  what a glob matches; what a command does to which path; what a list holds.
- The words below are banned when their subject is a rule, check, guard, breadcrumb, moment
  or the program. This is a literal list, not an illustration. Use the replacement.

  | banned | write instead |
  |---|---|
  | asks, asks for, is asked | is called with |
  | names (a rule names a file) | matches, lists |
  | fires (a breadcrumb fires) | is shown; runs |
  | sees, can see, is seen | is in the snapshot; is recorded; is detected; is given |
  | touches, is touched | matches; is written; is read |
  | carries | includes; has |
  | hands, is handed | is passed; is called with |
  | answers | returns |
  | knows, wants, offends, the offence | say the mechanism |
  | in flight | not yet finished |
  | closes the gap, the floor, the door, wears | say the mechanism |

  Two spellings stay, because they are the docs' own standard pattern or are literal:
  "fires at `write`" means the rule runs at that moment, and every check page header uses
  it; "a tool call names a file" and "the input names its actor" are literal, because the
  call or input carries that path or field as data.
- Define a term in the sentence where it first appears, in ordinary words: pass, block,
  glob, category, moment, snapshot, revert, harness.
- One level per sentence. A shell command, a glob, a function's return value, a setting and
  a test input are different things; do not move between them inside one sentence.
- Keep every number, quantity and name exactly as the source states it. Drift is about
  200,000 tokens of session, not the file; `.git` and `node_modules` are the two excluded
  paths; a term the source defines keeps that definition.
- Prefer the literal over the elegant. No aphorisms; no sentence doing two jobs; no em-dash
  carrying a second clause that changes the sentence's condition.
- Before returning, reread your text once against the banned-word table and once for
  numbers. Fix what you find; then return.
- Test: a reader who knows nothing about this codebase can act on the page after one
  reading. A sentence they would have to reread is wrong.
