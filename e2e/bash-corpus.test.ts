// flow/e2e/bash-corpus.test.ts — read detection, scored on the hand-labelled corpus and pinned.
//
// The yardstick read detection is held to is `__fixtures__/bash-corpus/`: 150 real commands, each
// labelled by hand with what it reads. `just score-bash` prints the table; this runs the SAME scorer
// (tools/domain.ts) over the shipped read detection (`bashReads` over the parse's steps) and pins
// every row of it, per mechanism and per parsing trap, at the numbers it scored when it moved onto
// the parse (#45) — which were the hand-written lexer's own, row for row. A change may find more
// and be wrong less; one that finds less, or names more paths nobody labelled, fails here naming
// the row.
//
// It lives in e2e/ for the fence's sake, not because it is slow: the import fence keeps tools/ and
// adapter/ apart in both directions, and e2e/ is the one place allowed to reach both.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bashReads } from "../adapter/domain.ts";
import { parseShellSteps } from "../language/domain.ts";
import { parseCorpus, scoreCorpus, type Row, type Targets } from "../tools/domain.ts";

const CORPUS = join(import.meta.dirname, "..", "__fixtures__", "bash-corpus", "corpus.json");

/** The home the labels spell `~` as: that of the machine they were recorded on, not this one. */
const RECORDED_HOME = "/Users/jawache";

/**
 * The shipped read detection as an extractor. A root of "" makes every absolute path "inside", so
 * paths outside any repo are scored too; a search's paths are reads to the corpus, whose labels
 * count a directory listed or walked as read.
 */
function shipped(command: string, cwd: string): Targets {
  const got = bashReads(parseShellSteps(command), { cwd, root: "", home: RECORDED_HOME });
  return { reads: [...got.reads, ...got.searched].map((path) => `/${path}`), writes: [] };
}

/**
 * Every row of the table, as it scored at #45: the labelled reads found, and the reads named that
 * nobody labelled (counted against precision). A row's found may rise and its wrong may fall.
 */
const PINNED: Readonly<Record<string, { readonly found: number; readonly wrong: number }>> = {
  cat: { found: 21, wrong: 0 },
  head: { found: 29, wrong: 1 },
  tail: { found: 14, wrong: 0 },
  "sed -n": { found: 11, wrong: 0 },
  grep: { found: 20, wrong: 0 },
  rg: { found: 20, wrong: 0 },
  find: { found: 24, wrong: 0 },
  ls: { found: 27, wrong: 0 },
  redirect: { found: 21, wrong: 0 },
  heredoc: { found: 1, wrong: 0 },
  "sed -i": { found: 18, wrong: 0 },
  "python heredoc": { found: 5, wrong: 0 },
  "cp/mv": { found: 25, wrong: 0 },
  just: { found: 4, wrong: 0 },
  work: { found: 1, wrong: 0 },
  "quoted-operator": { found: 87, wrong: 1 },
  "heredoc-body": { found: 19, wrong: 0 },
  cd: { found: 96, wrong: 1 },
  $VAR: { found: 51, wrong: 0 },
  "2>&1": { found: 43, wrong: 0 },
  all: { found: 241, wrong: 1 },
};

describe("read detection on the hand-labelled Bash corpus", () => {
  it("scores at least what it scored at #45, per mechanism, per trap and in all", async () => {
    const { entries, problems } = parseCorpus(JSON.parse(readFileSync(CORPUS, "utf8")));
    expect(problems).toStrictEqual([]);
    const report = await scoreCorpus("shipped", entries, shipped);
    expect(report.errors).toStrictEqual([]);
    const rows: readonly Row[] = [...report.byMechanism, ...report.byTrap, report.total];
    // Every pinned row is scored, and every scored row is pinned: a new mechanism or trap in the
    // corpus is a row somebody has to pin on purpose.
    expect(rows.map((row) => row.label).sort()).toStrictEqual(Object.keys(PINNED).sort());
    for (const row of rows) {
      const pin = PINNED[row.label];
      const wrong = row.reads.charged - row.reads.hit;
      expect(row.reads.hit, `${row.label}: labelled reads found`).toBeGreaterThanOrEqual(pin?.found ?? Infinity);
      expect(wrong, `${row.label}: reads named that nobody labelled`).toBeLessThanOrEqual(pin?.wrong ?? -1);
    }
  });
});
