---
name: review
description: Use when the work daemon types `[work] /review <issue>` into a daily review issue in this repo, or when the human asks for "the daily review" or "review yesterday's issues". Reads every project's issues that finished the day before, and posts one report of the few things that cost a lot.
file: SKILL
when: the line `[work] /review <issue>`, typed each weekday morning into a new issue
brief: the review's own issue
writes: the report page in the issue's record · one question card · an issue in a project's Backlog, on the human's "file"
guards: none
---

# The daily review

Purpose. The human runs many issues a day across several projects, each built by agents. Each issue is finished and paid for, and nobody reads across them. This review reads every issue that finished the day before, in every project, and tells the human where the same result could have cost far less. Its output is one report page and one card. The human reads the card in a minute, and answers each finding with "file", "discuss" or "skip".

It answers three questions about the day:

1. Where did work cost far more than it needed, and what shows the cheaper way?
2. Was the intent of each guardrail and breadcrumb met?
3. Where did two instructions pull against each other?

A finding passes two tests before it is shown.

**The first test: did it cost a lot?** In money, or in the human's time. Something quick that repeats does not pass.

**The second test: what is the lowest rung that removes its cause?**

| Rung | The fix | Example |
| --- | --- | --- |
| 1 | Remove the cause: a setting, a default, a fix to a tool | each worktree gets its own port |
| 2 | A recipe or a script | a test recipe that takes one test's name |
| 3 | A guardrail, or the words of its refusal | a refusal that names the recipe to run |
| 4 | Breadcrumb or skill text | a clause in a skill file |
| 5 | A change to the process | a new status or stop |

A lower rung does the same thing on every run. Text an agent reads may not, and each addition is read by every later session. A trial of a text change costs $20 to $40.

Most days have little to say. A report with no finding is a valid result.

The numbers come from `flow facts` (this repo's `docs/user/reference/facts.md`) and from each issue's record in work. The look of the page is the brand in `docs/agent/brand/DESIGN.md`.

## Rules

- `DRV-R1` Take every number from `flow facts` or from an issue's record. Do not write a number of your own.
- `DRV-R2` Show a finding only when it passes the first test.
- `DRV-R3` Name a finding's root cause before you name a fix.
  why: "a guardrail refused 41 times" is a count, and the fix follows from why it kept happening.
- `DRV-R4` If you have not confirmed the cause, say so, and offer no issue for that finding.
- `DRV-R5` Propose the lowest rung that removes the cause.
- `DRV-R6` If you propose a higher rung, say why the rung below cannot remove it.
- `DRV-R7` Propose rung 4 only when the waste is about $50 or more over a month or two.
  why: the trial alone costs $20 to $40.
- `DRV-R8` Never propose rung 5. Show it as an observation with its numbers.
- `DRV-R9` When a guardrail refused often, find why the refused act keeps happening before you count the guardrail as working.
- `DRV-R10` If an intent was not met for a good reason, do not report it.
- `DRV-R11` Do not report a round between the human and an agent. The human was there.
- `DRV-R12` If the human's frustration has the same cause on several days, raise it as a finding.
- `DRV-R13` Say how sure you are of each finding: what is counted, and what is your reading.
- `DRV-R14` Never file an issue until the human replies "file" with the finding's number.

## Steps

- `DRV-S1` List the issues that finished yesterday in every project. → P-ISSUES
- `DRV-S2` Run `flow facts` for each of those issues. → P-FACTS
- `DRV-S3` Read each issue's cost per stage, its cards and its waits from its record. → P-RECORD
- `DRV-S4` Find where requests fell between a failed test run and the next passing one, and what turned the runs red.
- `DRV-S5` Find each agent that ran on a model the project's `work.yml` does not name for it.
- `DRV-S6` For each guardrail that refused, read what the agent did next, and judge the intent. (R9, R10)
- `DRV-S7` Read the skill clauses an agent was following where it struggled, and look for two that conflict.
- `DRV-S8` Read the last five reviews' records for a cause of frustration that repeats. (R11, R12)
- `DRV-S9` Before you believe a candidate, open the transcript lines `flow facts` cites for it.
- `DRV-S10` Put each candidate through the two tests. (R2–R8)
- `DRV-S11` Write the report to `<record>artifacts/report.html`. Read `templates/report.html`, then write the page in its shape. (R1, R13)
- `DRV-S12` Post one question card. Read `templates/card.md`, then write it in its shape.
- `DRV-S13` On "file <n>", file that finding's issue in its project's Backlog. → P-FILE (R14)
- `DRV-S14` On "discuss <n>", talk it through in this session. On "skip <n>", do nothing.
- `DRV-S15` When every finding has an answer, move the review's issue to Done.

## Procedures

### P-ISSUES

1. `work repo list` prints each project's path and record.
2. In each record, an issue finished yesterday when its `log.jsonl` has a `Moved to Done.` event dated yesterday.

### P-FACTS

1. An issue's worktree is `<project path>.worktrees/<its branch>`. It may have been removed.
2. In the project's checkout: `flow facts --worktree <that path> --all --json`.

### P-RECORD

1. Cost per stage is the first line under `## Cost` in the issue's `issue.md`.
2. A card is a `question` line of `log.jsonl`. Its wait is the time to the `answer` line whose `of` is the card's `at`.

### P-FILE

1. In the finding's project: `work issue new --title "<the title the report offered>" --body -`, with the finding's rows as the body.
2. Write the new issue's id on the card's thread as an FYI.
