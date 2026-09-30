// flow/tools/score-bash.ts — the shell that scores a Bash path extractor against the corpus.
//
// `just score-bash` prints the table for the baseline; `just score-bash <name>` for another
// extractor in the list below; `--misses` adds every entry where it missed a labelled path or named
// one nobody labelled. Everything it decides is in tools/domain.ts; this file reads the fixture,
// picks the extractor and prints.
//
// AN EXTRACTOR IS ADDED HERE BY NAME, so a bake-off is one table per name over the same 150
// commands and nothing else moves.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { functionsExtractor, grammarExtractor, literalExtractor } from "./bash-reads.ts";
import { baseline, parseCorpus, renderMisses, renderReport, scoreCorpus, type Extractor } from "./domain.ts";

const CORPUS = join(resolve(import.meta.dirname, ".."), "__fixtures__", "bash-corpus", "corpus.json");

// The corpus was recorded on one machine and its labels spell `~` as that home; the bake-off's three
// candidates are told the home of whoever runs them, which is the same machine in practice.
const EXTRACTORS: Readonly<Record<string, Extractor>> = {
  baseline,
  literal: literalExtractor(homedir()),
  grammar: grammarExtractor(homedir()),
  functions: functionsExtractor(homedir()),
};

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--")) ?? "baseline";
const extract = EXTRACTORS[name];

if (extract === undefined) {
  process.stderr.write(`No extractor called ${name}. Known: ${Object.keys(EXTRACTORS).join(", ")}.\n`);
  process.exitCode = 2;
} else {
  const { entries, problems } = parseCorpus(JSON.parse(readFileSync(CORPUS, "utf8")));
  if (problems.length > 0) {
    // REFUSED RATHER THAN SCORED. A malformed label moves a percentage without saying so.
    for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
    process.stderr.write(`${CORPUS} has ${problems.length} malformed entries; fix them before scoring.\n`);
    process.exitCode = 1;
  } else {
    const report = await scoreCorpus(name, entries, extract);
    process.stdout.write(renderReport(report));
    if (args.includes("--misses")) process.stdout.write("\n" + renderMisses(report));
  }
}
