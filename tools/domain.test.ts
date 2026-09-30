// flow/tools/domain.test.ts — the pack page, asserted as text.
//
// The page is generated and then byte-compared at the commit gate, so what has to be proved here
// is the OPPOSITE of a snapshot: not "the page still looks like this", which a regeneration would
// make true again by definition, but that each fact a reader relies on reaches the page at all —
// the verbatim message, the settings as written, both sides of every case, and the gaps a pack has
// not filled in yet, said out loud rather than rendered as nothing.

import { describe, expect, it } from "vitest";
import {
  bindingSnippet,
  bindLine,
  caseLine,
  caseLines,
  caseWorld,
  checkName,
  DOC_BLOCKS,
  EXAMPLE,
  fenceFault,
  firstSentence,
  headingSlug,
  headingSlugs,
  kebab,
  literal,
  localLinks,
  renderPackPage,
  renderPacksIndex,
  says,
  settingsJson,
  whenText,
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
  type CaseLine,
  type CorpusEntry,
  type DocBlock,
  type EntryDoc,
  type PackDoc,
  type PageLink,
  type ParamDoc,
} from "./domain.ts";
import type { Case, TurnAction } from "../index.ts";

/** A guardrail with everything filled in — the page's fullest row. */
const rail: EntryDoc = {
  id: "docs.docsShape",
  key: "docsShape",
  kind: "guardrail",
  description: "docs/ holds exactly `user/` and `agent/`.",
  why: "Without it a docs folder becomes a drawer.\n\nA second paragraph, kept apart.",
  at: ["write", "commit"],
  on: ["docs/**"],
  ignore: ["docs/user/legacy/**"],
  categories: ["supervised"],
  settings: settingsJson({ root: "docs", allow: [], folders: ["user", "agent"] }),
  checkName: "canonicalFiles",
  reference: true,
  says: "docs/ holds exactly two doors: `user/` and `agent/`.",
  cases: [
    { kind: "pass", line: caseLine({ path: "docs/user/index.md", content: "" }), given: [] },
    { kind: "block", line: caseLine({ path: "docs/notes/scratch.md", content: "" }), given: [] },
  ],
  disabled: "",
};

/** A breadcrumb with nothing filled in — every gap the page has to admit to, at once. */
const crumb: EntryDoc = {
  id: "docs.docs",
  key: "docs",
  kind: "breadcrumb",
  description: "The two audiences.",
  why: "",
  at: ["touch"],
  on: [],
  ignore: [],
  categories: [],
  settings: "",
  checkName: "",
  reference: false,
  says: "Two audiences, two doors.",
  cases: [],
  disabled: "shipped off — nothing to watch until a repo has both doors",
};

const param: ParamDoc = { name: "run", type: "string", why: "The recipe that runs the suite." };

const doc: PackDoc = { name: "docs", lead: "Two audiences, one folder.", params: [], blocks: [], bind: "pack(docs)", entries: [rail, crumb] };

/** One recorded turn action — the dialect the turn-end moment speaks. */
const edit: TurnAction = { did: "edit", path: "core/clock.ts" };

describe("a doc comment the page could only half read", () => {
  // THE FAILURE THIS EXISTS FOR SHIPPED ONCE, on the way in. A JSDoc block ends at the next line
  // starting with an `@`, so the secrets pack's copyable recipe — whose body began `@dotenvx run`
  // — cut its own `@setup` in half: the page rendered, the drift gate compared it happily, and the
  // file a reader was meant to copy was two lines long. An odd fence is what that always looks
  // like, so it is refused rather than printed.
  it("names the pack and the block whose fence never closes", () => {
    const cut = { ...doc, blocks: [{ tag: "setup", body: "copy this:\n\n```just\ndx env +cmd:" }] };
    expect(fenceFault(cut)).toContain("the docs pack: its @setup block");
    expect(fenceFault(cut)).toContain("take the @ off that line");
  });

  it("says nothing about a pack whose fences close, or one that has no fence at all", () => {
    expect(fenceFault(doc)).toBe("");
    expect(fenceFault({ ...doc, blocks: [{ tag: "setup", body: "copy this:\n\n```just\ndx:\n```" }] })).toBe("");
  });

  // Every doc-comment surface the page renders, not just the named blocks: a lead, a parameter's
  // own doc and an entry's why all reach `prose` by the same road.
  it("reads the lead, the parameters and the entry whys as well as the blocks", () => {
    expect(fenceFault({ ...doc, lead: "```json\n{" })).toContain("its lead");
    expect(fenceFault({ ...doc, params: [{ ...param, why: "```sh\njust dx" }] })).toContain("the doc on its run parameter");
    expect(fenceFault({ ...doc, entries: [{ ...crumb, why: "```sh\njust dx" }] })).toContain("the why on docs");
  });
});

describe("a case as one line", () => {
  it("names what the event was, in the dialect of its moment", () => {
    expect(caseLine("git push --force")).toBe("running `git push --force`");
    expect(caseLine({ command: "git commit -m x" })).toBe("running `git commit -m x`");
    expect(caseLine({ path: "a.ts", content: "" })).toBe("writing `a.ts`");
    expect(caseLine({ path: "a.ts", content: "const x = 1;" })).toBe("writing `a.ts` — `const x = 1;`");
    expect(caseLine({ staged: ["a.ts", "b.ts"] })).toBe("committing `a.ts`, `b.ts`");
    expect(caseLine({ actions: [edit] })).toBe("a turn with 1 recorded action");
    expect(caseLine({ actions: [edit, { did: "run", command: "just test" }] })).toBe("a turn with 2 recorded actions");
  });

  it("shortens a file body rather than pasting a whole fixture into a list item", () => {
    const long: Case = { path: "a.ts", content: `${"x".repeat(200)}\n\n  y` };
    const said = caseLine(long);
    expect(said.length).toBeLessThan(120);
    expect(said).toContain("…");
  });
});

describe("the world a case canned", () => {
  // THE POINT OF THE WHOLE THING: two identical commands in opposite columns, told apart by the
  // answer the case supplied. The page dropped this until the first read of it found `git checkout
  // -- src/x.ts` sitting under both "passes" and "blocks" with nothing between them.
  it("says what a command was answered, so two identical commands are told apart", () => {
    const clean: Case = { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: "" } } } };
    const dirty: Case = { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } } };
    expect(caseWorld(clean)).toEqual(["`git status --porcelain` exits 0"]);
    expect(caseWorld(dirty)).toEqual(["`git status --porcelain` exits 0 and says `M src/x.ts`"]);
  });

  it("says the exit code out loud, because a failing tool is the fact the case is making", () => {
    expect(caseWorld({ staged: ["a.ts"], world: { exec: { "just test": { code: 1, stdout: "1 failed" } } } })).toEqual([
      "`just test` exits 1 and says `1 failed`",
    ]);
  });

  it("reads the other three dialects of a canned world", () => {
    expect(caseWorld({ staged: ["a.ts"], world: { fs: { "a.ts": "export const x = 1;" } } })).toEqual(["`a.ts` holds `export const x = 1;`"]);
    expect(caseWorld({ staged: ["a.ts"], world: { fs: { "a.ts": "" } } })).toEqual(["`a.ts` is empty"]);
    expect(caseWorld({ command: "git commit", world: { gitDiff: "+ version" } })).toEqual(["the diff is `+ version`"]);
    expect(caseWorld({ command: "git commit", world: { gitDiff: "" } })).toEqual(["the diff is empty"]);
    expect(caseWorld({ command: "git commit", world: { staged: ["a.ts", "b.ts"] } })).toEqual(["the staged set is `a.ts`, `b.ts`"]);
  });

  // The page prints canned fixtures, and one of them is an AWS key shape — the secrets pack proves
  // its rule with one. Printed whole, it made the committed HTML a file that pack's own rule
  // refuses, which is how this was found.
  it("cuts a credential shape down, and leaves an ordinary long identifier whole", () => {
    const key = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    expect(caseWorld({ staged: ["a.ts"], world: { fs: { "a.ts": `const k = '${key}';` } } })).toEqual(["`a.ts` holds `const k = 'AKIA…';`"]);
    expect(caseLine({ path: "a.ts", content: `const k = '${key}';` })).toBe("writing `a.ts` — `const k = 'AKIA…';`");
    expect(caseWorld({ staged: ["p.json"], world: { fs: { "p.json": '{"optionalDependencies":{"fsevents":"^2"}}' } } })).toEqual([
      '`p.json` holds `{"optionalDependencies":{"fsevents":"^2"}}`',
    ]);
  });

  it("has nothing to say about a case that canned nothing", () => {
    expect(caseWorld("git push --force")).toEqual([]);
    expect(caseWorld({ path: "a.ts", content: "" })).toEqual([]);
  });
});

describe("the words on a moment", () => {
  it("spells a moment for a reader who has never seen the moment table", () => {
    expect(whenText(["write", "commit"])).toBe("a file is written or edited · the commit gate, over the staged set");
    expect(whenText(["session"])).toContain("start of a session");
    expect(whenText(["touch"])).toContain("first time in a session");
    expect(whenText(["turn-end"])).toContain("turn ends");
    expect(whenText(["delete"])).toContain("deleted");
    expect(whenText(["command"])).toContain("shell command");
  });

  it("says nothing rather than inventing a sentence for a moment it has never heard of", () => {
    expect(whenText([])).toBe("—");
    expect(whenText(["someday"])).toBe("someday");
  });
});

describe("text into markdown", () => {
  // A DOC COMMENT IS ALREADY MARKDOWN, and that is the whole of the conversion now. It was written
  // for a reader of the SOURCE — where `.on(…)` in backticks is code, a blank line is a paragraph
  // and a fenced block is copyable text — so the page carries it through untouched rather than
  // translating it into anything. Prose the AGENT is shown goes in a fence instead: there the
  // page's job is to show exactly what the model receives, backticks and all.
  it("takes a first sentence without breaking on a path or a version", () => {
    expect(firstSentence("Two doors. And more.")).toBe("Two doors.");
    expect(firstSentence("It writes docs/user/index.md and stops. Then more.")).toBe("It writes docs/user/index.md and stops.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
  });

  it("spells a check's page name the way the file is spelled", () => {
    expect(kebab("canonicalFiles")).toBe("canonical-files");
    expect(kebab("astGrep")).toBe("ast-grep");
    expect(kebab("depcruise")).toBe("depcruise");
  });
});

describe("the binding snippet", () => {
  it("is a config a reader can paste, imports and all", () => {
    expect(bindingSnippet(doc)).toContain('import { docs } from "@jawache/flow/packs";');
    expect(bindingSnippet(doc)).toContain("export default defineConfig([pack(docs)]);");
  });
});

describe("a pack's page", () => {
  const html = renderPackPage(doc);

  // ONE SHAPE FOR EVERY CHECK: the options object as JSON, behind a collapsed toggle — the one
  // construct markdown has none of, so it stays the HTML a markdown page may carry. Pulled apart
  // per option it read as two different kinds of thing — a labelled list here, JSON there — and
  // neither said what it was.
  it("carries the facts a reader cannot get anywhere else — the message verbatim, the settings as JSON", () => {
    expect(html).toContain("docs/ holds exactly two doors: `user/` and `agent/`.");
    expect(html).toContain("<details><summary>settings</summary>");
    expect(html).toContain('"root": "docs"');
    expect(html).toContain('"folders": [');
    expect(html).toContain("](../checks/canonical-files.md)");
  });

  // A MESSAGE MAY CARRY A FENCE OF ITS OWN, and three backticks around one would end the block in
  // the middle of it — the page would print half a message and read as finished.
  it("fences a message that carries a fence of its own, without ending the block early", () => {
    const talky: EntryDoc = { ...rail, says: "copy this:\n```sh\njust dx\n```" };
    expect(renderPackPage({ ...doc, entries: [talky] })).toContain("````\ncopy this:\n```sh\njust dx\n```\n````");
  });

  it("says a check has no options rather than printing an empty one", () => {
    const bare: EntryDoc = { ...rail, settings: settingsJson({}), checkName: "protectedPath" };
    const page = renderPackPage({ ...doc, entries: [bare] });
    expect(page).toContain("no options");
    expect(page).not.toContain("<details");
  });

  it("prints a structured setting in the same block as a plain one", () => {
    const nested: EntryDoc = { ...rail, checkName: "astGrep", settings: settingsJson({ language: "tsx", rule: { kind: "call_expression" } }) };
    const page = renderPackPage({ ...doc, entries: [nested] });
    expect(page).toContain('"language": "tsx"');
    expect(page).toContain('"kind": "call_expression"');
    expect(page).toContain("<summary>settings</summary>");
  });

  it("prints the canned world under the case it belongs to", () => {
    const told: EntryDoc = {
      ...rail,
      cases: [
        { kind: "pass", line: "running `git checkout -- src/x.ts`", given: ["`git status --porcelain` exits 0"] },
        { kind: "block", line: "running `git checkout -- src/x.ts`", given: ["`git status --porcelain` exits 0 and says `M src/x.ts`"] },
      ],
    };
    const page = renderPackPage({ ...doc, entries: [told] });
    expect(page).toContain("  - given `git status --porcelain` exits 0\n");
    expect(page).toContain("exits 0 and says `M src/x.ts`");
  });

  it("shows both sides of every case, and says which side is empty", () => {
    expect(html).toContain("writing `docs/user/index.md`");
    expect(html).toContain("writing `docs/notes/scratch.md`");
    // A guardrail proved only by refusals — common, and the empty side is stated rather than left
    // blank, because a blank box reads as "the page forgot" instead of "the pack never said".
    const oneSided: EntryDoc = { ...rail, cases: [{ kind: "block", line: "writing `docs/user/guide.md`", given: [] }] };
    expect(renderPackPage({ ...doc, entries: [oneSided] })).toContain("no pass case declared");
  });

  it("counts what is in the pack and where it fires", () => {
    expect(html).toContain("1 guardrail · 1 breadcrumb · fires at: write · commit · touch · takes no parameters");
  });

  // The human read git.html and could not: six banned patterns and eleven commit types arrived as
  // one dotted line each, pushed right by an indent column. Every fact is a plain line of its own
  // now, and a list is a list.
  it("keeps the facts on plain lines rather than in an indented table", () => {
    expect(html).toContain("- **Watches** ");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("<td>");
  });

  it("prints the scope, the categories and the reason an entry ships off", () => {
    expect(html).toContain("`docs/**`");
    expect(html).toContain("`docs/user/legacy/**`");
    expect(html).toContain("`supervised`");
    expect(html).toContain("every session");
    expect(html).toContain("shipped off — nothing to watch until a repo has both doors");
  });

  it("says an entry is not path-scoped rather than leaving the line blank", () => {
    expect(html).toContain("**Watches** not scoped by path");
  });

  it("says a breadcrumb owes a why when it has none, rather than showing nothing", () => {
    expect(html).toContain("Not stated.");
    expect(html).toContain("Without it a docs folder becomes a drawer.");
    expect(html).toContain("A second paragraph, kept apart.");
  });

  it("admits a missing lead in the reader's face", () => {
    expect(renderPackPage({ ...doc, lead: "" })).toContain("No lead. Add a doc comment");
  });

  // A pack may write its own check — `noGitDiscard`, `conventionalCommit` — and there is no
  // reference page for one. A link to a page nobody wrote is worse than no link.
  it("links a stock check and never invents a page for a pack's own", () => {
    const own: EntryDoc = { ...rail, checkName: "noGitDiscard", reference: false };
    const page = renderPackPage({ ...doc, entries: [own] });
    expect(page).toContain("`noGitDiscard`");
    expect(page).toContain("(written in this pack)");
    expect(page).not.toContain("no-git-discard.md");
  });

  // A guardrail's refusal usually carries its own reason, so the why is optional there and the
  // section is absent rather than filled with an apology — and an entry may have nothing to say at
  // all, which is not the same as a page that forgot to print it.
  it("names a check written inline, and prints no section for a why or a sentence the entry has not got", () => {
    const inline: EntryDoc = { ...rail, settings: "", checkName: "", why: "", says: "" };
    const page = renderPackPage({ ...doc, entries: [inline] });
    expect(page).toContain("written inline in this pack");
    expect(page).not.toContain("### Why it exists");
    expect(page).not.toContain("### What the agent reads");
  });

  it("renders a named doc block as its own section, and an unused tag as nothing", () => {
    const install: DocBlock = { tag: "install", body: "`just`, from https://just.systems." };
    const page = renderPackPage({ ...doc, blocks: [install, { tag: "setup", body: "" }] });
    expect(page).toContain("What to install first");
    expect(page).toContain("from https://just.systems.");
    expect(page).not.toContain("What the repo needs in place");
    expect(renderPackPage(doc)).not.toContain("Adopting it");
  });

  it("tabulates parameters, and marks an undocumented one", () => {
    const bound: PackDoc = {
      ...doc,
      name: "tdd",
      params: [param, { name: "x", type: "string", why: "" }],
      bind: 'pack(tdd, { run: "./ci.sh test" })',
    };
    const page = renderPackPage(bound);
    expect(page).toContain("The pack takes 2 parameters");
    expect(page).toContain("The recipe that runs the suite.");
    expect(page).toContain("Add a doc comment on the interface member.");
    expect(page).toContain('pack(tdd, { run: "./ci.sh test" })');
  });

  // A CELL ENDS AT A `|`, so a parameter whose type is a union would have ended it three columns
  // early — and a table one cell out of line is a table a reader cannot read at all.
  it("escapes a pipe in a cell, and keeps a parameter's paragraphs apart inside one", () => {
    const piped: PackDoc = { ...doc, params: [{ name: "x", type: "string | undefined", why: "One.\n\nOr the other." }] };
    const page = renderPackPage(piped);
    expect(page).toContain("`string \\| undefined`");
    expect(page).toContain("One.<br><br>Or the other.");
  });

  it("says 'parameter' rather than 'parameters' when there is one", () => {
    expect(renderPackPage({ ...doc, params: [param] })).toContain("takes 1 parameter.");
  });

  // THE TABLE OF CONTENTS HAS TO LAND. A markdown anchor is derived from the heading rather than
  // written on it, so the link and the heading are computed from the same sentence or the whole
  // list points at nothing — silently, which is the fault this page's own sweep exists to catch.
  it("links every entry in the contents at an anchor its own heading makes", () => {
    expect(html).toContain("- [`docs.docsShape`](#docsdocsshape--guardrail) · guardrail ·");
    expect(headingSlugs(html)).toContain("docsdocsshape--guardrail");
  });

  it("carries no date, no sha and no host path — the drift check compares bytes", () => {
    expect(html).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(html).not.toContain("/Users/");
  });
});

describe("the listing page", () => {
  it("gives one row per pack, with its size, its parameters and its first sentence", () => {
    const index = renderPacksIndex([doc, { ...doc, name: "tdd", lead: "", params: [param] }]);
    expect(index).toContain("](./docs.md)");
    expect(index).toContain("1 · 1");
    expect(index).toContain("Two audiences, one folder.");
    expect(index).toContain("no lead yet");
    expect(index).toContain("`run`");
  });
});

describe("a check's settings", () => {
  it("are the options object, pretty-printed, whatever the check is", () => {
    expect(settingsJson({ run: "./ci.sh test" })).toBe('{\n  "run": "./ci.sh test"\n}');
    expect(settingsJson({ ban: ["a", "b"] })).toBe('{\n  "ban": [\n    "a",\n    "b"\n  ]\n}');
  });

  it("are nothing at all for a check that took none", () => {
    expect(settingsJson({})).toBe("");
    expect(settingsJson(undefined)).toBe("");
    expect(settingsJson(null)).toBe("");
  });
});

describe("an entry's cases and its sentence", () => {
  it("puts every pass case before every block case, each with what it was told", () => {
    expect(
      caseLines({
        pass: [{ command: "git checkout -- a.ts", world: { exec: { "git status --porcelain": { stdout: "" } } } }],
        block: ["git push --force", { staged: ["a.ts"] }],
      }),
    ).toEqual([
      { kind: "pass", line: "running `git checkout -- a.ts`", given: ["`git status --porcelain` exits 0"] },
      { kind: "block", line: "running `git push --force`", given: [] },
      { kind: "block", line: "committing `a.ts`", given: [] },
    ]);
  });

  it("has nothing to show for an entry that carries no cases at all", () => {
    expect(caseLines(undefined)).toEqual([]);
    expect(caseLines({})).toEqual([]);
  });

  // A guardrail's prose is its refusal and a breadcrumb's is its text, and one breadcrumb points at
  // a file instead. Asked for the wrong one, the page shows a rule with nothing to say.
  it("reads a guardrail's refusal, a breadcrumb's text, and a breadcrumb that points at a file", () => {
    expect(says({ kind: "guardrail", message: "no." })).toBe("no.");
    expect(says({ kind: "guardrail" })).toBe("");
    expect(says({ kind: "breadcrumb", text: "two doors." })).toBe("two doors.");
    expect(says({ kind: "breadcrumb", file: "docs/agent/map.md" })).toBe("docs/agent/map.md");
    expect(says({ kind: "breadcrumb" })).toBe("");
  });

  it("names the stock check a `.check(…)` argument calls, and nothing when it calls none", () => {
    expect(checkName('canonicalFiles({ root: "docs" })')).toBe("canonicalFiles");
    expect(checkName("astGrep({})")).toBe("astGrep");
    expect(checkName("myOwnCheck")).toBe("");
    expect(checkName("")).toBe("");
  });
});

describe("the stranger's binding", () => {
  it("is a config line a reader can paste, whatever the parameters are shaped like", () => {
    expect(bindLine("node", undefined)).toBe("pack(node)");
    expect(bindLine("tdd", { run: "./ci.sh test" })).toBe('pack(tdd, { run: "./ci.sh test" })');
    expect(bindLine("fcis", { files: ["core/**/*.ts"], homes: [] })).toBe('pack(fcis, { files: ["core/**/*.ts"], homes: [] })');
  });

  // The justfile pack's `recipes` map is keyed by a command pattern. Printed bare, the one thing
  // the page exists to hand a reader — a config to paste — was a syntax error.
  it("quotes a key that is not an identifier, and leaves one that is alone", () => {
    expect(literal({ recipes: { "npx vitest": "./ci.sh test" } })).toBe('{ recipes: { "npx vitest": "./ci.sh test" } }');
    expect(literal({ exempt: [], depth: 2, off: false })).toBe("{ exempt: [], depth: 2, off: false }");
  });

  // One list, two readers: the page generator renders every glob and command on a page with these,
  // and the machine test drives a stranger's repo with them. Neither may be our own spelling.
  it("spells nothing the way this repo does", () => {
    const spellings = JSON.stringify(EXAMPLE);
    expect(spellings).not.toContain("just ");
    expect(spellings).not.toContain("glob.ts");
    expect(EXAMPLE.fcis.homes).toEqual(["core/**"]);
    expect(EXAMPLE.justfile.recipes["npx vitest"]).toBe("./ci.sh test");
  });
});

describe("the model", () => {
  it("is plain data — a case line is a kind, a sentence and what the case was told", () => {
    const one: CaseLine = { kind: "pass", line: "writing `a.ts`", given: [] };
    expect(one.kind).toBe("pass");
  });

  it("declares the tag set once, and the page renders them in that order", () => {
    expect(DOC_BLOCKS.map((block) => block.tag)).toEqual(["install", "setup", "adopt"]);
  });
});

// ── the page as MARKDOWN ─────────────────────────────────────────────────────
//
// THE THREE HTML CHECKERS ARE GONE, and what they were is worth saying once: `unbalanced`,
// `unescapedInCode` and `unknownElements` asked what a PARSER would do with a page rather than what
// the text said, because the fault that earned them was silent — `new-dep: <name> — <why>` sat
// unescaped in a code block on the guidebook, the parser read the placeholders as unknown elements
// and deleted them, and the page taught `put new-dep:  —  in the message`.
//
// Markdown cannot lose a word that way. What it can lose is a LINK: an anchor is derived from a
// heading rather than written on one, so `index.md#checks` resolves to a file that exists and a
// heading that does not. These three prove the pair that catches it.

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
