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
import { checksCalled, checksDefined, codeImports, exportedNames, fencedCode, frontMatterFields, headingSlugs, kebab, localLinks } from "./domain.ts";
import * as root from "../index.ts";
import * as packs from "../packs/index.ts";

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

// THE README IS THE FRONT DOOR to the same pages, and its links name their files and their headings
// just as a page's do — so it is walked for links beside them. It is not a page under docs/user/,
// so it is held to no front matter.
const README = join(PACKAGE, "README.md");

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

  // THE RULE AGREED ON #18: every page's summary is YAML front matter, and no page carries a date.
  // A date is the one fact on a page that is wrong the day after it is written, and nothing would
  // ever say so — so it is refused as a field and as a value alike.
  it.each(all.map((file) => [relative(PACKAGE, file), file] as const))("%s — opens with a summary in front matter, and no date", (_name, file) => {
    const fields = frontMatterFields(readFileSync(file, "utf8"));
    expect(fields, "the page does not open with a --- front-matter block").not.toBeNull();
    if (fields === null) return;
    expect([...fields.keys()]).toContain("summary");
    const dated = [...fields].filter(([key, value]) => /date|updated|created/i.test(key) || /\b20\d\d-\d\d-\d\d\b/.test(value));
    expect(dated).toStrictEqual([]);
  });

  it.each([README, ...all].map((file) => [relative(PACKAGE, file), file] as const))("%s — every link resolves", (_name, file) => {
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

// THE EXAMPLES, HELD TO THE REAL API. A how-to teaches by its config snippet, and a snippet that
// names a check or an export that was since renamed goes on teaching the old name with nothing
// failing — the page reads as correct to everyone but the reader who copies it. This is the cheap
// half of proving them: every name a page imports from a door is one that door exports, and every
// `.check(name(…))` asks for a stock check or one the same page defines.

/** Each door `@jawache/flow` opens, and every name it exports — read off the source its types come from. */
const doors = new Map(
  Object.entries((JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { exports: Record<string, { types: string }> }).exports).map(
    ([door, target]) => {
      const source = join(PACKAGE, target.types.replace(/^\.\/dist\/types\//, "").replace(/\.d\.ts$/, ".ts"));
      return [door === "." ? "@jawache/flow" : `@jawache/flow/${door.replace(/^\.\//, "")}`, new Set(exportedNames(readFileSync(source, "utf8")))] as const;
    },
  ),
);

/** A stock check: exported from the root door, with its own page under docs/user/checks/. */
const isStockCheck = (name: string): boolean => doors.get("@jawache/flow")?.has(name) === true && existsSync(join(DOCS, "checks", `${kebab(name)}.md`));

// A MIGRATION GUIDE IS LEFT OUT on purpose: its "before" half shows the API as it was, so the names
// it imports are the ones that no longer exist.
const examples = all.filter((file) => !file.startsWith(join(DOCS, "migrations")));
const code = new Map(examples.map((file) => [file, fencedCode(readFileSync(file, "utf8"))]));
const flowImports = (file: string) => codeImports(code.get(file) ?? "").filter((found) => found.from === "@jawache/flow" || found.from.startsWith("@jawache/flow/"));

describe("docs/user — every example, against the API it teaches", () => {
  it("reads every export of both doors, so a name missed by the reader cannot pass for one the door dropped", () => {
    expect([...doors.keys()].sort()).toStrictEqual(["@jawache/flow", "@jawache/flow/packs"]);
    expect(Object.keys(root).filter((name) => doors.get("@jawache/flow")?.has(name) !== true)).toStrictEqual([]);
    expect(Object.keys(packs).filter((name) => doors.get("@jawache/flow/packs")?.has(name) !== true)).toStrictEqual([]);
  });

  it("finds the examples at all, so a fence the reader stopped seeing fails rather than passes empty", () => {
    expect(examples.flatMap(flowImports).length).toBeGreaterThan(30);
    expect(examples.flatMap((file) => checksCalled(code.get(file) ?? "")).length).toBeGreaterThan(20);
  });

  it.each(examples.map((file) => [relative(PACKAGE, file), file] as const))("%s — every name it imports is exported, and every check it asks for exists", (_name, file) => {
    const defined = new Set(checksDefined(code.get(file) ?? ""));
    const faults = [
      ...flowImports(file).flatMap(({ from, names }) => {
        const exported = doors.get(from);
        if (exported === undefined) return [`${from} — no such door`];
        return names.filter((name) => !exported.has(name)).map((name) => `${name} — ${from} does not export it`);
      }),
      ...checksCalled(code.get(file) ?? "")
        .filter((name) => !isStockCheck(name) && !defined.has(name))
        .map((name) => `.check(${name}(…)) — neither a stock check nor a defineCheck on this page`),
    ];
    expect(faults, `${relative(PACKAGE, file)}\n  ${faults.join("\n  ")}`).toStrictEqual([]);
  });
});
