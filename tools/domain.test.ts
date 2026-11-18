// flow/tools/domain.test.ts — the markdown a page holds to, the release's migration guide, the
// package's own links and the Bash corpus score, asserted as text.

import { describe, expect, it } from "vitest";
import {
  migrationGuide,
  nextVersion,
  installScripts,
  checksCalled,
  checksDefined,
  codeImports,
  exampleFaults,
  exportedNames,
  fencedCode,
  flowImports,
  frontMatterFields,
  headingSlug,
  headingSlugs,
  kebab,
  localLinks,
  packedFiles,
  unshippedLinks,
  baseline,
  MECHANISMS,
  normalise,
  parseCorpus,
  rate,
  renderMisses,
  renderReport,
  scoreCorpus,
  scoreEntry,
  scoreRow,
  TRAPS,
  type CorpusEntry,
  type PageLink,
} from "./domain.ts";

describe("reading a page's front matter back", () => {
  it("returns each field a page opens with", () => {
    const fields = frontMatterFields('---\nsummary: "a: b"\nkind: how-to\n---\n\n# Title\n');
    expect(fields).toStrictEqual(new Map([["summary", '"a: b"'], ["kind", "how-to"]]));
  });

  it("is null for a page that does not open with front matter, even one with a rule further down", () => {
    expect(frontMatterFields("# Title\n\n---\n\nsummary: x\n---\n")).toBeNull();
  });
});

describe("what a reader will make of a markdown page", () => {
  describe("headingSlug — the anchor GitHub derives from a heading", () => {
    it("lowercases, drops the punctuation and hyphenates what is left", () => {
      expect(headingSlug("The stock checks — one page each")).toBe("the-stock-checks--one-page-each");
      expect(headingSlug("`docs.docsShape` — guardrail")).toBe("docsdocsshape--guardrail");
      expect(headingSlug("4 · The cookbook — “I want to…”")).toBe("4--the-cookbook--i-want-to");
    });
  });

  describe("headingSlugs — every anchor a page offers", () => {
    it("reads a heading at any level, and no `#` inside a fence", () => {
      expect(headingSlugs("# One\n\n```sh\n# not a heading\n```\n\n### Two words\n")).toStrictEqual(["one", "two-words"]);
    });
  });

  describe("localLinks — what has to be on disk, and the heading it points at", () => {
    it("returns both halves of a local link, and drops the external", () => {
      const links: readonly PageLink[] = localLinks('[a](./a.md#top) [b](https://x.dev) [c](#here)\n<img src="i.png">');
      expect(links).toStrictEqual([
        { path: "./a.md", anchor: "top" },
        { path: "", anchor: "here" },
        { path: "i.png", anchor: "" },
      ]);
    });

    it("reads no link inside a fenced block, where a `[x](y)` is somebody's config", () => {
      expect(localLinks("before\n\n```\n[a](./gone.md)\n```\n\nafter\n")).toStrictEqual([]);
    });

    // A FENCE CLOSES ONLY ON ONE AT LEAST AS LONG, which is how a page prints a message that
    // carries a fence of its own. Read the inner one as the end and the rest of the block becomes
    // prose the sweep then judges.
    it("closes a fence only on one at least as long as the one that opened it", () => {
      expect(localLinks("````\n```\n[a](./gone.md)\n```\n````\n")).toStrictEqual([]);
    });
  });

  describe("reading a page's examples — the code its fences hold", () => {
    it("keeps every fenced line, indented under a list item or not, and drops the prose and the fences", () => {
      expect(fencedCode("prose\n\n```ts\nconst a = 1;\n```\n\n1. Step\n\n   ```ts\n   const b = 2;\n   ```\n")).toBe("const a = 1;\n   const b = 2;");
    });

    it("reads each named import as the module exports it, over one line or several", () => {
      const code = 'import { a, type B, c as d } from "@jawache/flow";\nimport {\n  e,\n  f,\n} from \'@jawache/flow/packs\';\nimport type { G } from "x";';
      expect(codeImports(code)).toStrictEqual([
        { from: "@jawache/flow", names: ["a", "B", "c"] },
        { from: "@jawache/flow/packs", names: ["e", "f"] },
        { from: "x", names: ["G"] },
      ]);
    });

    it("reads a door file's exports, types included, and no name a comment mentions", () => {
      const door = '// export { gone } from "./x.ts";\nexport {\n  a, // the first\n  type B,\n} from "./a.ts";\n/* export { alsoGone } */\nexport { c } from "./c.ts";\nexport type { D } from "./d.ts";';
      expect(exportedNames(door)).toStrictEqual(["a", "B", "c", "D"]);
    });

    it("names the check each `.check(…)` asks for, and none for a check written inline", () => {
      const code = ".check(textBan({ ban: [] }))\n.check( mine({}) )\n.check(async (ctx) => ctx.ok())\n.check(function (ctx) { return ctx.ok(); })";
      expect(checksCalled(code)).toStrictEqual(["textBan", "mine"]);
    });

    it("names every check the code defines for itself", () => {
      expect(checksDefined("const mine = defineCheck((_o) => (ctx) => ctx.ok());\nexport const other = defineCheck(() => (ctx) => ctx.ok());\nconst notOne = guardrail();")).toStrictEqual(["mine", "other"]);
    });

    it("keeps only the imports from @jawache/flow and its subpath doors", () => {
      expect(flowImports('import { a } from "@jawache/flow";\nimport { b } from "@jawache/flow/packs";\nimport { c } from "@jawache/flowers";\nimport { d } from "node:fs";')).toStrictEqual([
        { from: "@jawache/flow", names: ["a"] },
        { from: "@jawache/flow/packs", names: ["b"] },
      ]);
    });
  });

  describe("exampleFaults — a page's examples against the API they teach", () => {
    const api = { doors: new Map([["@jawache/flow", new Set(["textBan", "defineCheck", "guardrail"])]]), stockChecks: new Set(["textBan"]) };

    it("passes a stock check, and a check the same code defines", () => {
      const code = 'import { defineCheck, guardrail, textBan } from "@jawache/flow";\nconst mine = defineCheck(() => (ctx) => ctx.ok());\nguardrail().check(textBan({})).check(mine({}));';
      expect(exampleFaults(code, api)).toStrictEqual([]);
    });

    it("names an import from a door that does not exist", () => {
      expect(exampleFaults('import { x } from "@jawache/flow/checks";', api)).toStrictEqual(["@jawache/flow/checks — no such door"]);
    });

    it("names each import the door does not export", () => {
      expect(exampleFaults('import { textBan, textBanned } from "@jawache/flow";', api)).toStrictEqual(["textBanned — @jawache/flow does not export it"]);
    });

    it("names a check that is neither stock nor defined on the page", () => {
      expect(exampleFaults("guardrail().check(gone({}));", api)).toStrictEqual([".check(gone(…)) — neither a stock check nor a defineCheck on this page"]);
    });
  });
});

// ══ THE BASH CORPUS SCORE ═══════════════════════════════════════════════════
//
// The numbers a bake-off is decided on, so what is proved here is that each number means what its
// column says: a path spelled two ways is one path, an opaque half does not charge a guess the
// labels could not judge, a throw is an empty answer that is reported, and nothing divides by zero.

/** One entry, with whatever the case needs changed. */
function entry(fields: Partial<CorpusEntry> = {}): CorpusEntry {
  return { id: "c1", mechanism: "cat", traps: [], cwd: "/repo", command: "cat a.ts", reads: ["a.ts"], writes: [], ...fields };
}

describe("the Bash corpus score", () => {
  describe("normalise", () => {
    it("resolves a relative path against the cwd and drops a trailing slash and dot segments", () => {
      expect(normalise("/repo", "src/")).toBe("/repo/src");
      expect(normalise("/repo", "./a/../b.ts")).toBe("/repo/b.ts");
      expect(normalise("/repo", "/tmp/x.log")).toBe("/tmp/x.log");
      expect(normalise("/repo", ".")).toBe("/repo");
    });
  });

  describe("scoreEntry", () => {
    it("counts a path spelled relative and one spelled absolute as the same path", () => {
      const s = scoreEntry(entry({ reads: ["a.ts", "/tmp/b.log"] }), { reads: ["/repo/a.ts", "../tmp/b.log"], writes: [] });
      expect(s.reads).toStrictEqual({ expected: 2, hit: 2, charged: 2 });
      expect(s.missed.reads).toStrictEqual([]);
    });

    it("names what it missed and what it invented, and counts a repeated path once", () => {
      const s = scoreEntry(entry({ reads: ["a.ts", "b.ts"], writes: ["out.txt"] }), { reads: ["a.ts", "a.ts", "c.ts"], writes: [] });
      expect(s.reads).toStrictEqual({ expected: 2, hit: 1, charged: 2 });
      expect(s.missed).toStrictEqual({ reads: ["/repo/b.ts"], writes: ["/repo/out.txt"] });
      expect(s.extra).toStrictEqual({ reads: ["/repo/c.ts"], writes: [] });
    });

    // THE OPAQUE RULE. `just test` writes files nobody can name from the line, so a guess there is
    // not wrong, only unjudged — while a labelled path it missed is still a miss.
    it("does not charge an unlabelled guess on an opaque half, and still counts the labelled miss", () => {
      const s = scoreEntry(entry({ reads: ["a.ts", "b.ts"], opaque: ["reads"] }), { reads: ["a.ts", "coverage/x.json"], writes: ["out"] });
      expect(s.reads).toStrictEqual({ expected: 2, hit: 1, charged: 1 });
      expect(s.writes).toStrictEqual({ expected: 0, hit: 0, charged: 1 });
    });
  });

  describe("scoreRow and rate", () => {
    it("sums the entries a row keeps", () => {
      const a = scoreEntry(entry(), { reads: ["a.ts"], writes: [] });
      const b = scoreEntry(entry({ id: "c2", reads: ["x"] }), { reads: [], writes: ["y"] });
      expect(scoreRow("cat", [a, b])).toStrictEqual({
        label: "cat",
        entries: 2,
        reads: { expected: 2, hit: 1, charged: 1 },
        writes: { expected: 0, hit: 0, charged: 1 },
      });
    });

    it("prints a dash when there is nothing to divide by, which is not 0%", () => {
      expect(rate(0, 0)).toBe("—");
      expect(rate(0, 4)).toBe("0/4 0%");
      expect(rate(2, 3)).toBe("2/3 67%");
    });
  });

  describe("scoreCorpus", () => {
    const corpus = [
      entry(),
      entry({ id: "c2", mechanism: "sed -i", traps: ["cd"], command: "cd x && sed -i '' s/a/b/ f", reads: ["x/f"], writes: ["x/f"] }),
    ];

    it("awaits an async extractor and rows the answers by mechanism and by trap, dropping empty rows", async () => {
      const report = await scoreCorpus("echo", corpus, (command) => Promise.resolve({ reads: command.startsWith("cat") ? ["a.ts"] : ["f"], writes: [] }));
      expect(report.name).toBe("echo");
      expect(report.total.reads).toStrictEqual({ expected: 2, hit: 1, charged: 2 });
      expect(report.byMechanism.map((r) => r.label)).toStrictEqual(["cat", "sed -i"]);
      expect(report.byTrap.map((r) => [r.label, r.entries])).toStrictEqual([["cd", 1]]);
      expect(report.errors).toStrictEqual([]);
    });

    it("scores a throw as an empty answer and reports it, rather than stopping the run", async () => {
      const report = await scoreCorpus("brittle", corpus, (command) => {
        if (command.startsWith("cd")) throw new Error("cannot parse cd");
        return { reads: ["a.ts"], writes: [] };
      });
      expect(report.errors).toStrictEqual([{ id: "c2", message: "cannot parse cd" }]);
      expect(report.entries[1]?.reads).toStrictEqual({ expected: 1, hit: 0, charged: 0 });
    });
  });

  describe("renderReport and renderMisses", () => {
    it("prints a row per mechanism, the total, a row per trap, and any throws", async () => {
      const report = await scoreCorpus("probe", [entry({ traps: ["$VAR"] })], (command) => {
        if (command === "never") return { reads: [], writes: [] };
        throw new Error("boom");
      });
      const text = renderReport(report);
      expect(text).toContain("Bash corpus — probe, 1 commands");
      expect(text).toMatch(/^cat\s+1\s+0\/1 0%\s+—\s+—\s+—$/m);
      expect(text).toMatch(/^all\s+1\s/m);
      expect(text).toMatch(/^\$VAR\s+1\s/m);
      expect(text).toContain("the extractor threw on 1, scored as an empty answer:\n  c1  boom");
    });

    it("prints no throw section when nothing threw", async () => {
      const text = renderReport(await scoreCorpus("quiet", [entry()], () => ({ reads: ["a.ts"], writes: [] })));
      expect(text).not.toContain("threw");
    });

    it("lists every entry with a miss or an invention, and says so when there are none", async () => {
      const misses = renderMisses(await scoreCorpus("m", [entry(), entry({ id: "c2", writes: ["o"] })], () => ({ reads: ["a.ts", "z"], writes: [] })));
      expect(misses).toBe("c1 [cat]\n    extra  read  /repo/z\nc2 [cat]\n    extra  read  /repo/z\n    missed write  /repo/o\n");
      expect(renderMisses(await scoreCorpus("m", [entry()], () => ({ reads: ["a.ts"], writes: [] })))).toBe("nothing missed, nothing extra\n");
    });
  });

  describe("parseCorpus", () => {
    it("keeps a well-formed entry, opaque half and all", () => {
      const raw = [{ ...entry(), opaque: ["writes"], note: "why", source: { session: "s", at: "t" } }];
      expect(parseCorpus(raw).problems).toStrictEqual([]);
      expect(parseCorpus(raw).entries).toHaveLength(1);
    });

    it("refuses a corpus that is not a list", () => {
      expect(parseCorpus({})).toStrictEqual({ entries: [], problems: ["the corpus is not a JSON array"] });
    });

    // A MALFORMED LABEL IS NAMED AND LEFT OUT, never scored on a guess: it would move a percentage
    // and nothing on the table would say why.
    it("names every problem on the entry it sits on and leaves that entry out", () => {
      const raw = [
        entry(),
        entry(),
        { ...entry({ id: "c3", mechanism: "awk", traps: ["glob"], cwd: "repo", command: "" }), reads: "a.ts", writes: [1], opaque: ["both"] },
        null,
      ];
      const { entries, problems } = parseCorpus(raw);
      expect(entries.map((e) => e.id)).toStrictEqual(["c1"]);
      expect(problems).toStrictEqual([
        "c1: a duplicate id",
        "c3: an unknown mechanism, an unknown trap, a cwd that is not absolute, no command, reads that are not a list of paths, writes that are not a list of paths, an opaque that names neither reads nor writes",
        "#3: no id, an unknown mechanism, an unknown trap, a cwd that is not absolute, no command, reads that are not a list of paths, writes that are not a list of paths",
      ]);
    });

    it("knows the fifteen strata and five traps the corpus was drawn on", () => {
      expect(MECHANISMS).toHaveLength(15);
      expect(TRAPS).toStrictEqual(["quoted-operator", "heredoc-body", "cd", "$VAR", "2>&1"]);
    });
  });

  // THE FLOOR. Deliberately naive, and these cases pin that it is: it has no idea what a command
  // is, so a quoted `>` and a path in prose fool it — which is what the corpus measures.
  describe("baseline", () => {
    it("calls the word after a redirect a write and every other path-shaped word a read", () => {
      expect(baseline("cat src/a.ts > out.txt 2>&1")).toStrictEqual({ reads: ["src/a.ts"], writes: ["out.txt"] });
      expect(baseline("echo hi >>log.txt && ls -la docs/")).toStrictEqual({ reads: ["docs/"], writes: ["log.txt"] });
    });

    it("is fooled by quotes and prose, which is the point of it", () => {
      expect(baseline(`grep -n "a > b" "src/x.ts"`)).toStrictEqual({ reads: ["src/x.ts"], writes: ["b"] });
      expect(baseline(`git commit -m "fix README.md"`).reads).toStrictEqual(["README.md"]);
    });
  });
});

describe("the release's migration guide — one page per version, named by the version it upgrades to", () => {
  it("lives under docs/user/migrations, named by the version", () => {
    expect(migrationGuide("0.2.2")).toBe("docs/user/migrations/0.2.2.md");
  });

  it("reads the version a dry run would cut off the tool's own report, and nothing when it names none", () => {
    const dry = "✔ bumping version in package.json from 0.2.1 to 0.2.2\n✔ bumping version in package-lock.json from 0.2.1 to 0.2.2\n";
    expect(nextVersion(dry)).toBe("0.2.2");
    expect(nextVersion("✔ outputting changes to CHANGELOG.md\n")).toBeNull();
  });
});

describe("a tag's package.json — no script npm would run on install", () => {
  it("names each install-time script it carries, and ignores the comment key and every other script", () => {
    expect(installScripts(JSON.stringify({ scripts: { "//": "just", prepare: "x", build: "y", test: "z" } }))).toStrictEqual(["prepare", "build"]);
  });
  it("names none when there are no scripts, and refuses a file it cannot read", () => {
    expect(installScripts(JSON.stringify({ name: "a" }))).toStrictEqual([]);
    expect(installScripts("{")).toStrictEqual(["prepare", "prepack", "build", "install", "postinstall"]);
  });
});

describe("the package's own links — every page npm uploads, followed from inside the tarball", () => {
  const shipped = ["README.md", "CHANGELOG.md", "LICENCE", "dist/flow.mjs", "docs/user/migrations/0.3.0.md", "docs/user/checks/ban-commands.md", "docs/user/how-to/a page.md"];
  /** The shipped files' bodies: the guide under test, and a page with no links for every other one. */
  const reading = (guide: string, page = "docs/user/migrations/0.3.0.md") => (file: string): string => (file === page ? guide : "no links here");

  it("reads the uploaded paths off npm pack's report", () => {
    const report = JSON.stringify([{ name: "@jawache/flow", files: [{ path: "README.md", size: 1, mode: 420 }, { path: "docs/user/index.md", size: 1, mode: 420 }] }]);
    expect(packedFiles(report)).toStrictEqual(["README.md", "docs/user/index.md"]);
  });

  it("reads the same paths off npm 12's report, an object keyed by the package's name", () => {
    const report = JSON.stringify({ "@jawache/flow": { name: "@jawache/flow", files: [{ path: "README.md", size: 1, mode: 420 }, { path: "docs/user/index.md", size: 1, mode: 420 }] } });
    expect(packedFiles(report)).toStrictEqual(["README.md", "docs/user/index.md"]);
  });

  it("reads no path from a report it cannot read, and drops an entry with no path", () => {
    expect(packedFiles("[{}]")).toStrictEqual([]);
    expect(packedFiles("{}")).toStrictEqual([]);
    expect(packedFiles("npm warn not json")).toStrictEqual([]);
    expect(packedFiles(JSON.stringify([{ files: [{ size: 1 }, { path: 7 }, { path: "README.md" }] }]))).toStrictEqual(["README.md"]);
  });

  it("follows links from the markdown pages and nothing else", () => {
    const read = (file: string): string => {
      if (!file.endsWith(".md")) throw new Error(`read ${file}, which is not a page`);
      return "[gone](./gone.md)";
    };
    expect(unshippedLinks(["dist/flow.mjs", "LICENCE", "README.md"], read)).toStrictEqual(["README.md → ./gone.md (gone.md is not in the package)"]);
  });

  it("passes a page whose every link lands on a shipped file or a shipped folder", () => {
    const guide = "[ban](../checks/ban-commands.md#how-a-command-is-matched) [checks](../checks/) [log](../../../CHANGELOG.md) [here](#top) [web](https://x.dev) [space](../how-to/a%20page.md)";
    expect(unshippedLinks(shipped, reading(guide))).toStrictEqual([]);
  });

  it("refuses a planted link to a file the package leaves out, naming the page, the link as written and where it lands", () => {
    const guide = "[ctx](../reference/ctx.md#ctxcommands)\n\n[ok](../checks/ban-commands.md)\n\n[bad](../checks/a%ZZ.md)";
    expect(unshippedLinks(shipped, reading(guide))).toStrictEqual([
      "docs/user/migrations/0.3.0.md → ../reference/ctx.md (docs/user/reference/ctx.md is not in the package)",
      "docs/user/migrations/0.3.0.md → ../checks/a%ZZ.md (docs/user/checks/a%ZZ.md is not in the package)",
    ]);
  });

  it("refuses a link that climbs out of the package altogether", () => {
    expect(unshippedLinks(shipped, reading("[up](../elsewhere.md)", "README.md"))).toStrictEqual(["README.md → ../elsewhere.md (outside the package)"]);
  });
});

describe("a check's page name", () => {
  it("spells a check's page name the way the file is spelled", () => {
    expect(kebab("canonicalFiles")).toBe("canonical-files");
    expect(kebab("astGrep")).toBe("ast-grep");
    expect(kebab("depcruise")).toBe("depcruise");
  });
});
