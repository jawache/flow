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
  caseLine,
  caseWorld,
  DOC_BLOCKS,
  esc,
  firstSentence,
  kebab,
  line,
  prose,
  renderPackPage,
  renderPacksIndex,
  settingsJson,
  whenText,
  type CaseFact,
  type CaseLine,
  type DocBlock,
  type EntryDoc,
  type PackDoc,
  type ParamDoc,
} from "./domain.ts";

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
    { kind: "pass", line: caseLine({ path: "docs/user/index.html", content: "" }), given: [] },
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

describe("a case as one line", () => {
  it("names what the event was, in the dialect of its moment", () => {
    expect(caseLine("git push --force")).toBe("running `git push --force`");
    expect(caseLine({ command: "git commit -m x" })).toBe("running `git commit -m x`");
    expect(caseLine({ path: "a.ts", content: "" })).toBe("writing `a.ts`");
    expect(caseLine({ path: "a.ts", content: "const x = 1;" })).toBe("writing `a.ts` — `const x = 1;`");
    expect(caseLine({ staged: ["a.ts", "b.ts"] })).toBe("committing `a.ts`, `b.ts`");
    expect(caseLine({ actions: [1] })).toBe("a turn with 1 recorded action");
    expect(caseLine({ actions: [1, 2] })).toBe("a turn with 2 recorded actions");
    expect(caseLine({})).toBe("an event with no facts");
  });

  it("shortens a file body rather than pasting a whole fixture into a list item", () => {
    const long: CaseFact = { path: "a.ts", content: `${"x".repeat(200)}\n\n  y` };
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
    const clean: CaseFact = { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: "" } } } };
    const dirty: CaseFact = { command: "git checkout -- src/x.ts", world: { exec: { "git status --porcelain": { stdout: " M src/x.ts" } } } };
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

describe("text into HTML", () => {
  it("escapes everything that could close a tag or open an entity", () => {
    expect(esc('<a href="x"> & </a>')).toBe("&lt;a href=&quot;x&quot;&gt; &amp; &lt;/a&gt;");
  });

  it("turns backticks into code and blank lines into paragraphs", () => {
    expect(prose("one `x`\n\ntwo")).toBe("<p>one <code>x</code></p>\n<p>two</p>");
    expect(line("a `b` c")).toBe("a <code>b</code> c");
  });

  it("takes a first sentence without breaking on a path or a version", () => {
    expect(firstSentence("Two doors. And more.")).toBe("Two doors.");
    expect(firstSentence("It writes docs/user/index.html and stops. Then more.")).toBe("It writes docs/user/index.html and stops.");
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

  // ONE SHAPE FOR EVERY CHECK: the options object as JSON, behind a collapsed toggle. Pulled apart
  // per option it read as two different kinds of thing — a labelled list here, JSON there — and
  // neither said what it was.
  it("carries the facts a reader cannot get anywhere else — the message verbatim, the settings as JSON", () => {
    expect(html).toContain("docs/ holds exactly two doors: `user/` and `agent/`.");
    expect(html).toContain('<details class="settings"><summary>settings</summary>');
    expect(html).toContain("&quot;root&quot;: &quot;docs&quot;");
    expect(html).toContain("&quot;folders&quot;: [");
    expect(html).toContain('href="../checks/canonical-files.html"');
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
    expect(page).toContain("&quot;language&quot;: &quot;tsx&quot;");
    expect(page).toContain("&quot;kind&quot;: &quot;call_expression&quot;");
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
    expect(page).toContain('<span class="given">given <code>git status --porcelain</code> exits 0</span>');
    expect(page).toContain("exits 0 and says <code>M src/x.ts</code>");
  });

  it("shows both sides of every case, and says which side is empty", () => {
    expect(html).toContain("writing <code>docs/user/index.html</code>");
    expect(html).toContain("writing <code>docs/notes/scratch.md</code>");
    // A guardrail proved only by refusals — common, and the empty side is stated rather than left
    // blank, because a blank box reads as "the page forgot" instead of "the pack never said".
    const oneSided: EntryDoc = { ...rail, cases: [{ kind: "block", line: "writing `docs/user/guide.md`", given: [] }] };
    expect(renderPackPage({ ...doc, entries: [oneSided] })).toContain("no pass case declared");
  });

  it("counts what is in the pack and where it fires", () => {
    expect(html).toContain("1 guardrail · 1 breadcrumb · fires at: write · commit · touch · takes no parameters");
  });

  // The human read git.html and could not: six banned patterns and eleven commit types arrived as
  // one dotted line each, pushed right by an indent column. Every fact is a plain left-aligned
  // line now, and a list is a list.
  it("keeps the facts on plain lines rather than in an indented table", () => {
    expect(html).toContain('<p class="fact"><b>Watches</b>');
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("<dt>");
  });

  it("prints the scope, the categories and the reason an entry ships off", () => {
    expect(html).toContain("<code>docs/**</code>");
    expect(html).toContain("<code>docs/user/legacy/**</code>");
    expect(html).toContain("<code>supervised</code>");
    expect(html).toContain("every session");
    expect(html).toContain("shipped off — nothing to watch until a repo has both doors");
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
    expect(page).toContain("<code>noGitDiscard</code>");
    expect(page).toContain("(written in this pack)");
    expect(page).not.toContain("no-git-discard.html");
  });

  it("names a check written inline rather than pretending the entry has no check", () => {
    const inline: EntryDoc = { ...rail, settings: "", checkName: "" };
    expect(renderPackPage({ ...doc, entries: [inline] })).toContain("written inline in this pack");
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
    expect(page).toContain('pack(tdd, { run: &quot;./ci.sh test&quot; })');
  });

  it("says 'parameter' rather than 'parameters' when there is one", () => {
    expect(renderPackPage({ ...doc, params: [param] })).toContain("takes 1 parameter.");
  });

  it("carries no date, no sha and no host path — the drift check compares bytes", () => {
    expect(html).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(html).not.toContain("/Users/");
  });
});

describe("the listing page", () => {
  it("gives one row per pack, with its size, its parameters and its first sentence", () => {
    const index = renderPacksIndex([doc, { ...doc, name: "tdd", lead: "", params: [param] }]);
    expect(index).toContain('href="./docs.html"');
    expect(index).toContain("1 · 1");
    expect(index).toContain("Two audiences, one folder.");
    expect(index).toContain("no lead yet");
    expect(index).toContain("<code>run</code>");
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

describe("the model", () => {
  it("is plain data — a case line is a kind, a sentence and what the case was told", () => {
    const one: CaseLine = { kind: "pass", line: "writing `a.ts`", given: [] };
    expect(one.kind).toBe("pass");
  });

  it("declares the tag set once, and the page renders them in that order", () => {
    expect(DOC_BLOCKS.map((block) => block.tag)).toEqual(["install", "setup", "adopt"]);
  });
});
