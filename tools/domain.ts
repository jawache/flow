// flow/tools/domain.ts — the pack page, as a pure function of what a pack says.
//
// ONE PAGE PER PACK, and it is the surface a pack is read on. A pack file is not a document: the
// sentence spreads a rule's content over `.at()`, `.on()`, `.check()`, `.message()` and
// `.test()`, its context sits in comments with no agreed shape, and the prose is wrapped however
// the author's editor felt. Reading ten of those to answer "what does this pack actually say to a
// stranger" is what the review found unaffordable. So the facts are LOADED (the same data the
// engine runs) and the human context comes from the file's doc comments, and this file turns the
// pair into one page.
//
// PURE, and gated as this repo's pure home is: the shell beside it (pack-pages.ts) reads the
// files, parses the TypeScript and writes the HTML; everything below is text in, text out. That
// is what makes a page assertable in a unit test rather than by eye.
//
// DETERMINISTIC — no date, no commit sha, no host path anywhere in the output. The page is
// drift-checked at the commit gate by regenerating it and comparing, so a byte that changes on
// its own is a gate that goes red for a reason nobody can fix.

// ── the model a page is rendered from ────────────────────────────────────────

/** One `.test({ pass, block })` case, already reduced to the line a reader sees. */
export interface CaseLine {
  readonly kind: "pass" | "block";
  readonly line: string;
}

/** One entry of a pack, as the page shows it. */
export interface EntryDoc {
  /** `pack.key` — the id the engine logs and a refusal names. */
  readonly id: string;
  /** The dotted path within the pack; the page's anchor. */
  readonly key: string;
  readonly kind: "guardrail" | "breadcrumb";
  readonly description: string;
  /**
   * WHY THE ENTRY EXISTS, from the doc comment on its key — the one thing no loaded field holds.
   *
   * Empty is a real answer and the page says so out loud rather than hiding the gap: mandatory on
   * a breadcrumb, whose text is instructions and never explains itself, and optional on a
   * guardrail, whose refusal message usually carries its own reason.
   */
  readonly why: string;
  /** The moments it fires at, in the spelling the grammar uses. */
  readonly at: readonly string[];
  readonly on: readonly string[];
  readonly ignore: readonly string[];
  /** Empty means every category. */
  readonly categories: readonly string[];
  /** The settings the check was CONFIGURED with, resolved — one row per option. */
  readonly settings: readonly SettingRow[];
  /** The check's name, as the pack spells it; the reference link is built from it. */
  readonly checkName: string;
  /** `.text()` or `.message()`, verbatim. This is the whole point of the page. */
  readonly says: string;
  readonly cases: readonly CaseLine[];
  /** Why the pack ships it turned off, when it does. */
  readonly disabled: string;
}

/** One option a check was configured with, ready to print. */
export interface SettingRow {
  readonly key: string;
  /** The value, already flattened to text — a scalar, a joined list, or a JSON block. */
  readonly value: string;
  /** True when the value is a structure and belongs in a code block rather than on the line. */
  readonly block: boolean;
}

/** One named block of a pack's doc comment — an `@install`, `@setup` or `@adopt` tag. */
export interface DocBlock {
  readonly tag: string;
  readonly body: string;
}

/** One parameter the pack takes, from the doc comment on its interface member. */
export interface ParamDoc {
  readonly name: string;
  readonly type: string;
  readonly why: string;
}

/** A whole pack, as the page shows it. */
export interface PackDoc {
  readonly name: string;
  /** The doc comment on `definePack` — the pack's lead. Empty is shown as a gap. */
  readonly lead: string;
  readonly params: readonly ParamDoc[];
  /** The named blocks the pack's doc comment carries, in the order the tag set declares them. */
  readonly blocks: readonly DocBlock[];
  /** The example binding line, parameters and all, exactly as a config would write it. */
  readonly bind: string;
  readonly entries: readonly EntryDoc[];
}

// ── a case, as one line ──────────────────────────────────────────────────────

/**
 * One canned event, in the shape the grammar's `Case` union really has.
 *
 * Declared HERE rather than imported, because this file is a pure home and a pure home reaches
 * nothing: the shell hands over plain data. The union is small and the four dialects are what the
 * page has to name, so restating them is a smaller cost than the import would be.
 */
export type CaseFact =
  | string
  | {
      readonly command?: string;
      readonly path?: string;
      readonly content?: string;
      readonly staged?: readonly string[];
      readonly actions?: readonly unknown[];
    };

/**
 * A case as the one line a reader scans — "writing `docs/user/guide.md`", "running `git push
 * --force`".
 *
 * The canned world a case carries (recorded `exec` answers, files, a diff) is deliberately NOT
 * shown: it is scaffolding for the runner, and a page that printed it would bury the fact the
 * case is making.
 */
export function caseLine(fact: CaseFact): string {
  if (typeof fact === "string") return `running \`${fact}\``;
  if (fact.command !== undefined) return `running \`${fact.command}\``;
  if (fact.path !== undefined) return `writing \`${fact.path}\`${fact.content === undefined || fact.content === "" ? "" : ` — \`${oneLine(fact.content)}\``}`;
  if (fact.staged !== undefined) return `committing ${fact.staged.map((f) => `\`${f}\``).join(", ")}`;
  if (fact.actions !== undefined) return `a turn with ${fact.actions.length} recorded action${fact.actions.length === 1 ? "" : "s"}`;
  return "an event with no facts";
}

/** A file body on one line, short enough to sit in a list item. */
function oneLine(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

// ── a check's settings, as rows ──────────────────────────────────────────────

/** A scalar, printed as a reader sees it — never `[object Object]`, never a quoted string. */
function scalar(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** Is this a value that fits on the line — a scalar, or a list of them? */
function flat(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((held) => held === null || typeof held !== "object");
  return value === null || typeof value !== "object";
}

/**
 * The options a check was configured with, flattened into printable rows.
 *
 * RESOLVED VALUES, and that is the whole point: what reaches the page is the glob a parameter
 * supplied and the recipe a repo named, not the expression that produced them. A structure — an
 * ast-grep rule, a fence's layers — cannot be a line, so it becomes a JSON block; everything else
 * is a line, because a line is what a reader can compare between two entries.
 */
export function settingRows(settings: unknown): SettingRow[] {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return [];
  return Object.entries(settings).map(([key, value]) => {
    if (Array.isArray(value) && value.length === 0) return { key, value: "none", block: false };
    if (flat(value)) return { key, value: (Array.isArray(value) ? value.map(scalar).join(" · ") : scalar(value)), block: false };
    return { key, value: JSON.stringify(value, null, 2), block: true };
  });
}

// ── the words the page puts on a moment ──────────────────────────────────────

/**
 * WHAT A MOMENT MEANS, in a sentence — because `at: ["touch"]` is the grammar's word and not the
 * reader's. A stranger reading a pack page has never seen the moment table.
 */
const WHEN: Readonly<Record<string, string>> = {
  session: "once, at the start of a session",
  touch: "the first time in a session a file it watches is touched",
  "turn-end": "when the agent's turn ends",
  write: "a file is written or edited",
  delete: "a file is deleted",
  command: "a shell command is about to run",
  commit: "the commit gate, over the staged set",
};

/** The moments of an entry, spelled for a reader rather than for the engine. */
export function whenText(at: readonly string[]): string {
  const said = at.map((m) => WHEN[m] ?? m);
  return said.length === 0 ? "—" : said.join(" · ");
}

// ── HTML ─────────────────────────────────────────────────────────────────────

/** Every character that could close a tag or open an entity. Prose is full of all of them. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A doc comment as HTML: escaped, backticks turned into code, blank lines into paragraphs.
 *
 * The two conversions are the whole of the markup this page understands, and they are here
 * because a doc comment is written for a reader of the SOURCE — where `\`.on(…)\`` is code and a
 * blank line is a paragraph — and a page that dropped both would read as one long blob. Prose the
 * AGENT is shown (`.text()`, `.message()`) never goes through here: that is quoted verbatim,
 * backticks and all, because the page's job there is to show exactly what the model receives.
 */
export function prose(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => `<p>${esc(para).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`)
    .join("\n");
}

/** One line of prose — escaped, with backticks as code, and no paragraph wrapper. */
export function line(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * A lead's first sentence, for the listing page.
 *
 * Split on a full stop followed by a space, so `docs/user/` and `0.1.0` survive it — the naive
 * split on "." turns half of this fleet's prose into fragments.
 */
export function firstSentence(text: string): string {
  const end = /\.(\s|$)/.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
}

/** A list of globs as inline code, or the em dash that means "the whole repo". */
function globs(list: readonly string[]): string {
  return list.length === 0 ? "—" : list.map((g) => `<code>${esc(g)}</code>`).join(" · ");
}

/**
 * The check the entry asks, and the settings it was configured with — as VALUES.
 *
 * The name comes from the pack's own source and links to the check's reference page; the settings
 * are read back off the check itself, so what prints is what the rule really watches. The page
 * showed the `.check(…)` source until the first read of these pages, and `noGitDiscard({})` as the
 * whole description of a rule is what that was worth.
 */
function checkBlock(entry: EntryDoc): string {
  if (entry.checkName === "") return "<em>a check written inline in this pack</em>";
  const named = `<a href="../checks/${kebab(entry.checkName)}.html"><code>${esc(entry.checkName)}</code></a>`;
  if (entry.settings.length === 0) return `${named} — <span class="none">no options; the sentence's own scope is the whole rule</span>`;
  const rows = entry.settings.map((row) =>
    row.block
      ? `<div class="set"><b>${esc(row.key)}</b><pre><code>${esc(row.value)}</code></pre></div>`
      : `<div class="set"><b>${esc(row.key)}</b> <code>${esc(row.value)}</code></div>`,
  );
  return `${named}\n      ${rows.join("\n      ")}`;
}

/** `canonicalFiles` → `canonical-files`, which is what the stock check's page is called. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** The pass/block pair, as two boxes. An empty side says so rather than rendering nothing. */
function casesBlock(cases: readonly CaseLine[]): string {
  const side = (kind: "pass" | "block"): string => {
    const lines = cases.filter((c) => c.kind === kind).map((c) => `<li>${line(c.line)}</li>`);
    const body = lines.length === 0 ? `<li class="none">no ${kind} case declared</li>` : lines.join("");
    return `<div class="case ${kind === "pass" ? "ok" : "stop"}"><b>${kind === "pass" ? "passes" : "blocks"}</b><ul>${body}</ul></div>`;
  };
  return `<div class="cases">${side("pass")}${side("block")}</div>`;
}

/** One `<dt>/<dd>` pair, dropped entirely when there is nothing to say. */
function fact(label: string, value: string): string {
  return value === "" ? "" : `      <dt>${label}</dt><dd>${value}</dd>\n`;
}

function entrySection(entry: EntryDoc): string {
  const rail = entry.kind === "guardrail";
  const badge = rail ? '<span class="badge rail">guardrail</span>' : '<span class="badge crumb">breadcrumb</span>';
  const facts = [
    fact(rail ? "Refuses at" : "Shown when", esc(whenText(entry.at))),
    fact("Watches", globs(entry.on)),
    entry.ignore.length === 0 ? "" : fact("Ignores", globs(entry.ignore)),
    fact("Categories", entry.categories.length === 0 ? "every session" : entry.categories.map((c) => `<code>${esc(c)}</code>`).join(" · ")),
    rail ? fact("Check", checkBlock(entry)) : "",
    entry.disabled === "" ? "" : fact("Off by default", esc(entry.disabled)),
  ].join("");

  const why =
    entry.why === ""
      ? entry.kind === "breadcrumb"
        ? '    <h3>Why it exists</h3>\n    <div class="why gap"><p>Not stated. A breadcrumb owes a doc comment on its key saying what goes wrong in the repo without it.</p></div>\n'
        : ""
      : `    <h3>Why it exists</h3>\n    <div class="why">${prose(entry.why)}</div>\n`;

  const says =
    entry.says === ""
      ? ""
      : `    <h3>What the agent reads${rail ? " when refused" : ""}</h3>\n    <div class="says">${esc(entry.says)}</div>\n`;

  const proved = rail ? `    <h3>Proved by</h3>\n${casesBlock(entry.cases)}\n` : "";

  return [
    `  <section class="entry" id="${esc(entry.key)}">`,
    `    <h2><code>${esc(entry.id)}</code>${badge}</h2>`,
    `    <p class="desc">${line(entry.description)}</p>`,
    `    <dl class="facts">\n${facts}    </dl>`,
    why + says + proved,
    "  </section>",
  ].join("\n");
}

/** The table of contents — every entry, its kind, and what it is for, in one screen. */
function toc(entries: readonly EntryDoc[]): string {
  const rows = entries.map(
    (e) =>
      `    <li><span class="id"><a href="#${esc(e.key)}">${esc(e.id)}</a></span>` +
      `<span class="badge ${e.kind === "guardrail" ? "rail" : "crumb"}">${e.kind}</span>` +
      `<span class="d">${line(e.description)}</span></li>`,
  );
  return `  <ul class="toc">\n${rows.join("\n")}\n  </ul>`;
}

/** The parameters table, or the sentence that says there are none. */
function params(doc: PackDoc): string {
  if (doc.params.length === 0) return "  <p>The pack takes no parameters. In <code>flow.config.ts</code>:</p>";
  const rows = doc.params.map(
    (p) =>
      `      <tr><td><code>${esc(p.name)}</code></td><td><code>${esc(p.type)}</code></td><td>${p.why === "" ? '<em class="none">not documented — the interface member owes a doc comment</em>' : prose(p.why)}</td></tr>`,
  );
  return [
    `  <p>The pack takes ${doc.params.length} parameter${doc.params.length === 1 ? "" : "s"} — facts about the repo it cannot know:</p>`,
    "  <table>",
    "    <thead><tr><th>Parameter</th><th>Type</th><th>What it is</th></tr></thead>",
    `    <tbody>\n${rows.join("\n")}\n    </tbody>`,
    "  </table>",
    "  <p>Bound with a stranger's values, this is the whole binding — and it is what every glob, recipe and message on this page was rendered with:</p>",
  ].join("\n");
}

/**
 * THE NAMED BLOCKS a pack's doc comment may carry, in the order the page prints them.
 *
 * Three tags and no more, because each answers a question a reader asks in a fixed order — what do
 * I have to install before a rule here can pass, what has to exist in the repo, and what happens
 * on the first run. Everything else a pack has to say is its lead, or an entry's own why. A tag
 * nobody uses renders nothing, so a pack that needs none reads exactly as it does today.
 */
export const DOC_BLOCKS: readonly { readonly tag: string; readonly title: string }[] = [
  { tag: "install", title: "What to install first" },
  { tag: "setup", title: "What the repo needs in place" },
  { tag: "adopt", title: "Adopting it" },
];

/** The named blocks this pack filled in, as their own sections, in the tag set's order. */
function blocks(doc: PackDoc): string {
  const said = DOC_BLOCKS.flatMap((known) => {
    const held = doc.blocks.find((block) => block.tag === known.tag);
    return held === undefined || held.body === ""
      ? []
      : [`  <h2 id="${esc(known.tag)}">${esc(known.title)}</h2>\n${prose(held.body)}`];
  });
  return said.join("\n\n");
}

/** The counts line under the title: what is in the pack, and where it fires. */
function census(doc: PackDoc): string {
  const rails = doc.entries.filter((e) => e.kind === "guardrail").length;
  const crumbs = doc.entries.length - rails;
  const moments = [...new Set(doc.entries.flatMap((e) => e.at))];
  const takes = doc.params.length === 0 ? "takes no parameters" : `takes ${doc.params.length} parameter${doc.params.length === 1 ? "" : "s"}`;
  return `${rails} guardrail${rails === 1 ? "" : "s"} · ${crumbs} breadcrumb${crumbs === 1 ? "" : "s"} · fires at: ${moments.join(" · ")} · ${takes}`;
}

const STYLE = `  :root{
    --ink:#1a1a1a; --mut:#666; --line:#e2e6ea; --bg:#f7f8fa; --card:#fff; --soft:#eef1f4;
    --parent:#2a6fb0; --stop:#b3261e; --ok:#2f8f4e; --crumb:#6d5bb0;
    --okbg:#e9f3ec; --stopbg:#fdeceb; --crumbbg:#efeafb; --railbg:#fff8e6; --gapbg:#fdf6e3;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif}
  main{max-width:52rem;margin:0 auto;padding:2.6rem 1.4rem 6rem}
  a{color:var(--parent);text-decoration:none} a:hover{text-decoration:underline}
  code{font-family:ui-monospace, Menlo, monospace;font-size:.86em;background:var(--soft);padding:.03em .32em;border-radius:4px}
  pre{background:#1e2227;color:#e6e9ec;border-radius:10px;padding:.9rem 1.1rem;overflow-x:auto;font:.85rem/1.55 ui-monospace, Menlo, monospace;margin:.6rem 0}
  pre code{background:none;padding:0;font-size:1em;color:inherit}
  h1{font-size:1.7rem;font-weight:900;letter-spacing:-.02em;margin:0}
  h1 code{font-size:.9em}
  h2{font-size:1.25rem;font-weight:800;margin:2.2rem 0 .4rem;padding-top:1.2rem;border-top:2px solid var(--line)}
  h3{font:700 .74rem system-ui;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:1.3rem 0 .3rem}
  .scope{color:var(--mut);font-size:.9rem;margin:.35rem 0 0;font-family:ui-monospace, Menlo, monospace}
  .lead{font-size:1.08rem;font-weight:600;color:#2c322b;margin:1.2rem 0 1rem;line-height:1.55}
  .lead.gap{font-weight:400;color:var(--mut);font-style:italic}
  table{border-collapse:collapse;width:100%;margin:.6rem 0;font-size:.92rem;background:var(--card)}
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);background:var(--soft)}
  .badge{display:inline-block;font:700 .68rem ui-monospace, Menlo, monospace;padding:.12rem .5rem;border-radius:999px;vertical-align:middle;margin-left:.4rem;letter-spacing:.02em}
  .badge.rail{background:var(--railbg);color:#8a6d00;border:1px solid #e6cf8a}
  .badge.crumb{background:var(--crumbbg);color:var(--crumb);border:1px solid #cfc3ea}
  .entry{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.4rem 1.2rem;margin:1rem 0;scroll-margin-top:1rem}
  .entry h2{border:0;margin:0;padding:0;font-size:1.15rem}
  .entry .desc{margin:.3rem 0 0;color:#39404a}
  .entry .facts{display:grid;grid-template-columns:8.5rem 1fr;gap:.25rem .8rem;font-size:.9rem;margin:.7rem 0 .2rem}
  .entry .facts dt{color:var(--mut);font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;padding-top:.2rem}
  .entry .facts dd{margin:0}
  .entry .facts pre{margin:.2rem 0}
  .set{margin:.15rem 0}
  .set b{font-weight:700;font-size:.82rem;color:#4a5260;font-family:ui-monospace, Menlo, monospace}
  .why{border-left:4px solid var(--parent);background:#eef4fa;padding:.6rem .9rem;border-radius:0 8px 8px 0;margin:.8rem 0;font-size:.95rem}
  .why.gap{border-left-color:#c2a33a;background:var(--gapbg);color:#6b5a1e;font-style:italic}
  .why p:first-child{margin-top:0} .why p:last-child{margin-bottom:0}
  .says{background:#fbfbf7;border:1px dashed #cfc7a8;border-radius:8px;padding:.7rem 1rem;margin:.5rem 0;font-size:.93rem;white-space:pre-wrap;font-family:ui-monospace, Menlo, monospace;line-height:1.55}
  .cases{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:.4rem 0}
  .case{border-radius:8px;padding:.6rem .8rem;font-size:.88rem}
  .case.ok{background:var(--okbg);border:1px solid #bcd9c5}
  .case.stop{background:var(--stopbg);border:1px solid #f0bfbb}
  .case b{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.25rem}
  .case.ok b{color:var(--ok)} .case.stop b{color:var(--stop)}
  .case ul{margin:0;padding-left:1.1rem} .case li{margin:.15rem 0}
  .toc{margin:.5rem 0 0;padding:0;list-style:none}
  .toc li{padding:.35rem 0;border-bottom:1px solid var(--line);display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
  .toc li .id{font-family:ui-monospace, Menlo, monospace;font-weight:700;min-width:15rem}
  .toc li .d{color:#39404a;font-size:.92rem;flex:1}
  .gen{background:var(--soft);border-radius:8px;padding:.5rem .9rem;font-size:.82rem;color:var(--mut);margin:1.2rem 0 0}
  .none{color:var(--mut);font-style:italic}
  footer{margin-top:3rem;color:var(--mut);font-size:.85rem;border-top:1px solid var(--line);padding-top:1rem}
  @media (max-width:640px){.cases{grid-template-columns:1fr}.entry .facts{grid-template-columns:1fr}}`;

/** The `<head>` every generated page shares, title apart. */
function head(title: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${esc(title)}</title>`,
    "<style>",
    STYLE,
    "</style>",
    "</head>",
    "<body>",
    "<main>",
  ].join("\n");
}

/** Where every part of the page came from — the page explaining itself, once, at the bottom. */
const PROVENANCE = [
  '  <h2 id="source">Where each part of this page comes from</h2>',
  "  <table>",
  "    <thead><tr><th>On the page</th><th>In the pack</th><th>Read how</th></tr></thead>",
  "    <tbody>",
  "      <tr><td>Lead, and the parameters table</td><td>The doc comment on <code>definePack</code>, and the doc comment on each member of the parameter interface</td><td>JSDoc, read with the TypeScript compiler API</td></tr>",
  "      <tr><td>Entry id, kind, moments, globs, categories, description</td><td>The sentence — <code>.at()</code> <code>.on()</code> <code>.description()</code></td><td>Loaded, the same data the engine runs</td></tr>",
  "      <tr><td>Why it exists</td><td>The doc comment on the entry's key — mandatory on a breadcrumb, optional on a guardrail whose message already carries its reason</td><td>JSDoc</td></tr>",
  "      <tr><td>What the agent reads</td><td><code>.text()</code> or <code>.message()</code>, verbatim</td><td>Loaded</td></tr>",
  "      <tr><td>Check and its settings</td><td><code>.check(…)</code>'s argument, verbatim</td><td>Source text, so the settings are the rule's own and not a paraphrase</td></tr>",
  "      <tr><td>Proved by</td><td><code>.test({ pass, block })</code></td><td>Loaded</td></tr>",
  "    </tbody>",
  "  </table>",
].join("\n");

/**
 * ONE PACK, ONE PAGE.
 *
 * The order is the order a stranger needs it in: what the pack is, how it is bound, the whole list
 * at a glance, then every entry in full. Nothing here is written by hand anywhere else — the page
 * is regenerated and byte-compared at the commit gate, so a hand edit is refused.
 */
export function renderPackPage(doc: PackDoc): string {
  return [
    head(`The ${doc.name} pack — flow`),
    `  <p class="scope"><a href="./index.html">flow packs</a> › ${esc(doc.name)}</p>`,
    `  <h1>The <code>${esc(doc.name)}</code> pack</h1>`,
    `  <p class="scope">${esc(census(doc))}</p>`,
    "",
    doc.lead === ""
      ? '  <p class="lead gap">This pack has no lead. A doc comment on <code>definePack</code> is what says, in a paragraph, what the pack is for.</p>'
      : `  <div class="lead">${prose(doc.lead)}</div>`,
    "",
    `  <p class="gen">Generated from <code>packs/${esc(doc.name)}.ts</code> by <code>just docs-packs</code>. Edit the pack, not this page; the commit gate refuses a page that has drifted from its pack.</p>`,
    "",
    '  <h2 id="binding">Binding it</h2>',
    params(doc),
    `<pre><code>${esc(bindingSnippet(doc))}</code></pre>`,
    `  <p>Any entry below can be turned off in the config, as a committed change visible in review: <code>override(${esc(doc.name)}.${esc(doc.entries[0]?.key ?? "entry")}).disabled("why")</code>.</p>`,
    "",
    blocks(doc),
    "",
    '  <h2 id="entries">Entries</h2>',
    toc(doc.entries),
    "",
    doc.entries.map(entrySection).join("\n\n"),
    "",
    PROVENANCE,
    "",
    `  <footer>flow docs · <a href="./index.html">the packs</a> · <code>${esc(doc.name)}</code> · generated page, do not edit</footer>`,
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** The config lines that bind this pack, ready to paste. */
export function bindingSnippet(doc: PackDoc): string {
  return [
    'import { defineConfig, pack } from "@jawache/flow";',
    `import { ${doc.name} } from "@jawache/flow/packs";`,
    "",
    `export default defineConfig([${doc.bind}]);`,
  ].join("\n");
}

/** The front page of the set: every pack, its size, and what it is about. */
export function renderPacksIndex(docs: readonly PackDoc[]): string {
  const rows = docs.map((d) => {
    const rails = d.entries.filter((e) => e.kind === "guardrail").length;
    const crumbs = d.entries.length - rails;
    const lead = d.lead === "" ? '<em class="none">no lead yet</em>' : line(firstSentence(d.lead));
    return `      <tr><td><a href="./${esc(d.name)}.html"><code>${esc(d.name)}</code></a></td><td>${rails} · ${crumbs}</td><td>${d.params.length === 0 ? "—" : d.params.map((p) => `<code>${esc(p.name)}</code>`).join(" ")}</td><td>${lead}</td></tr>`;
  });
  return [
    head("The packs — flow"),
    '  <p class="scope"><a href="../index.html">flow</a> › packs</p>',
    "  <h1>The packs</h1>",
    `  <p class="scope">${docs.length} packs · one page each · generated by <code>just docs-packs</code></p>`,
    "",
    `  <p class="lead">Everything <code>@jawache/flow/packs</code> ships. A pack is content written in the grammar — a list of claims about a repo — and binding one is a single line in <code>flow.config.ts</code>. An unbound pack costs nothing.</p>`,
    "",
    "  <table>",
    "    <thead><tr><th>Pack</th><th>Rails · crumbs</th><th>Parameters</th><th>What it is about</th></tr></thead>",
    `    <tbody>\n${rows.join("\n")}\n    </tbody>`,
    "  </table>",
    "",
    '  <p class="gen">Generated from <code>packs/*.ts</code> by <code>just docs-packs</code>. Edit the packs, not these pages; the commit gate refuses a page that has drifted.</p>',
    "",
    "  <footer>flow docs · <a href=\"../index.html\">all user docs</a> · generated page, do not edit</footer>",
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
