// flow/tools/pages.test.ts — every page under docs/user/, through a parser's eyes.
//
// THE PHASE PROOF, PINNED. F3's proof line was "every command executes as written and every page
// renders", and the render half was a script run once from a scratchpad. That is exactly the shape
// the whole phase found wrong everywhere else: a claim nothing reads goes on being made after it
// stops being true. So the sweep is a test, and it walks the real folder rather than a fixture —
// the fixtures live next door in domain.test.ts and prove the checkers; this proves the pages.
//
// It found one fault the day it was written, on the guidebook, and the fault had shipped: the
// placeholder `new-dep: <name> — <why>` sat unescaped in a code block, so a parser read the two
// words as unknown elements and deleted them, and the page taught `put new-dep:  —  in the
// message`. Nothing about the file looked wrong. Nothing would have, ever.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { localLinks, unbalanced, unescapedInCode, unknownElements } from "./domain.ts";

const PACKAGE = resolve(import.meta.dirname, "..");
const DOCS = join(PACKAGE, "docs", "user");

/** Every .html under docs/user/, generated and hand-written alike — both kinds are read here. */
function pages(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const at = join(dir, name);
      return statSync(at).isDirectory() ? pages(at) : name.endsWith(".html") ? [at] : [];
    })
    .sort();
}

const all = pages(DOCS);

describe("docs/user — every page, as a browser would read it", () => {
  it("has pages at all, so a folder that moved fails loudly rather than passing empty", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all.map((file) => [relative(PACKAGE, file), file] as const))("%s", (_name, file) => {
    const html = readFileSync(file, "utf8");
    // ONE ASSERTION CARRYING ALL THREE, so a page with two faults reports two: a per-check
    // assertion would stop at the first and hide whatever came after it.
    const faults = [...unbalanced(html), ...unescapedInCode(html), ...unknownElements(html)];
    expect(faults, `${relative(PACKAGE, file)}\n  ${faults.join("\n  ")}`).toStrictEqual([]);
  });

  it.each(all.map((file) => [relative(PACKAGE, file), file] as const))("%s — every link resolves", (_name, file) => {
    const broken = localLinks(readFileSync(file, "utf8")).filter((href) => !existsSync(resolve(dirname(file), href)));
    expect(broken, `${relative(PACKAGE, file)} links to files that are not there`).toStrictEqual([]);
  });
});
