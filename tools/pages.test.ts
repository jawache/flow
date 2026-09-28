// flow/tools/pages.test.ts — every page under docs/user/, through a reader's eyes.
//
// THE PHASE PROOF, PINNED. F3's proof line was "every command executes as written and every page
// renders", and the render half was a script run once from a scratchpad. That is exactly the shape
// the whole phase found wrong everywhere else: a claim nothing reads goes on being made after it
// stops being true. So the sweep is a test, and it walks the real folder rather than a fixture —
// the fixtures live next door in domain.test.ts and prove the checkers; this proves the pages.
//
// WHAT IT ASKS, now that the pages are markdown. A markdown page cannot lose a word to a parser the
// way an HTML one could — the fault that earned this file was a placeholder eaten as an unknown
// element, and inside a fence or a backtick span nothing is markup. What markdown has instead is an
// anchor nobody wrote: `#checks` was an id on a heading and is now DERIVED from the heading's text,
// so a link can resolve to a file that exists and a heading that does not, with nothing about
// either page looking wrong. Both halves of every link are checked here for that reason.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { headingSlugs, localLinks } from "./domain.ts";

const PACKAGE = resolve(import.meta.dirname, "..");
const DOCS = join(PACKAGE, "docs", "user");

/** Every .md under docs/user/, generated and hand-written alike — both kinds are read here. */
function pages(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const at = join(dir, name);
      return statSync(at).isDirectory() ? pages(at) : name.endsWith(".md") ? [at] : [];
    })
    .sort();
}

const all = pages(DOCS);

describe("docs/user — every page, as a reader would follow it", () => {
  it("has pages at all, so a folder that moved fails loudly rather than passing empty", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("is markdown all the way through — no .html page survives under docs/user", () => {
    const html = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const at = join(dir, name);
        return statSync(at).isDirectory() ? html(at) : name.endsWith(".html") ? [relative(PACKAGE, at)] : [];
      });
    expect(html(DOCS)).toStrictEqual([]);
  });

  it.each(all.map((file) => [relative(PACKAGE, file), file] as const))("%s — every link resolves", (_name, file) => {
    // ONE ASSERTION CARRYING BOTH HALVES, so a page with two broken links reports two: a
    // per-link assertion would stop at the first and hide whatever came after it.
    const faults = localLinks(readFileSync(file, "utf8")).flatMap((link) => {
      const target = link.path === "" ? file : resolve(dirname(file), link.path);
      if (!existsSync(target)) return [`${link.path} — no such file`];
      if (link.anchor === "") return [];
      return headingSlugs(readFileSync(target, "utf8")).includes(link.anchor)
        ? []
        : [`${link.path}#${link.anchor} — the file is there, no heading makes that anchor`];
    });
    expect(faults, `${relative(PACKAGE, file)}\n  ${faults.join("\n  ")}`).toStrictEqual([]);
  });
});
