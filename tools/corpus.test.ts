// flow/tools/corpus.test.ts — the Bash corpus on disk, held to what its README promises.
//
// The scorer is proved on hand-made entries in domain.test.ts. This file asks about the REAL
// fixture, the way pages.test.ts asks about the real pages: every entry well-formed, ten per
// stratum, every parsing trap the audit found present often enough to move a number, and the
// baseline able to run over all of it. A label edited into a shape the scorer would drop, or a trap
// that quietly left the sample, fails here rather than as a percentage that shifted for no reason.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseline, MECHANISMS, parseCorpus, scoreCorpus, TRAPS } from "./domain.ts";

const CORPUS = join(resolve(import.meta.dirname, ".."), "__fixtures__", "bash-corpus", "corpus.json");
const { entries, problems } = parseCorpus(JSON.parse(readFileSync(CORPUS, "utf8")));

describe("the Bash corpus on disk", () => {
  it("parses with no malformed entry", () => {
    expect(problems).toStrictEqual([]);
    expect(entries).toHaveLength(150);
  });

  it("holds ten commands for every stratum the README lists", () => {
    for (const m of MECHANISMS) expect([m, entries.filter((e) => e.mechanism === m).length]).toStrictEqual([m, 10]);
  });

  it("carries every parsing trap at least eight times", () => {
    for (const t of TRAPS) expect(entries.filter((e) => e.traps.includes(t)).length, t).toBeGreaterThanOrEqual(8);
  });

  it("labels at least one read and one write, so both columns of the table mean something", () => {
    expect(entries.some((e) => e.reads.length > 0)).toBe(true);
    expect(entries.some((e) => e.writes.length > 0)).toBe(true);
  });

  it("is scored end to end by the baseline without a throw", async () => {
    const report = await scoreCorpus("baseline", entries, baseline);
    expect(report.errors).toStrictEqual([]);
    expect(report.total.entries).toBe(150);
    expect(report.byMechanism).toHaveLength(MECHANISMS.length);
  });
});
