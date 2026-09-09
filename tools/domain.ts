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

// TYPE-ONLY, and that is what lets a pure home import at all: the grammar's own vocabulary for a
// case and for an entry's sentence, erased at compile time and therefore not an edge the import
// fence has to carve an exception for. It is imported rather than restated because a restatement
// is a second declaration of the same union that nothing keeps in step — the page would go on
// rendering an arm the grammar had dropped, and would render nothing for one it had gained.
import type { Case, CaseWorld, Cases, EntrySpec } from "../index.ts";

// ── the model a page is rendered from ────────────────────────────────────────

/** One `.test({ pass, block })` case, already reduced to the lines a reader sees. */
export interface CaseLine {
  readonly kind: "pass" | "block";
  readonly line: string;
  /**
   * What the case CANNED for whatever the check reaches for — a command's answer, a file's body,
   * the diff, the staged set. One phrase each.
   *
   * Without it a page lies by omission: `noGitDiscard` shows `git checkout -- src/x.ts` twice
   * under "passes" and once under "blocks", because what separates them is a `git status` answer
   * the case supplied and the page dropped.
   */
  readonly given: readonly string[];
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
  /**
   * The options the check was configured with, resolved and pretty-printed as JSON. Empty when the
   * check took none, or was not made by `defineCheck` at all.
   */
  readonly settings: string;
  /** The check's name, as the pack spells it. */
  readonly checkName: string;
  /**
   * Does a stock-check reference page exist for it? A pack may write its own check — `noGitDiscard`
   * and `conventionalCommit` are two — and a link to a page nobody wrote is worse than no link.
   */
  readonly reference: boolean;
  /** `.text()` or `.message()`, verbatim. This is the whole point of the page. */
  readonly says: string;
  readonly cases: readonly CaseLine[];
  /** Why the pack ships it turned off, when it does. */
  readonly disabled: string;
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

/**
 * A DOC COMMENT WHOSE FENCE NEVER CLOSES, named — or an empty string when every one of them does.
 *
 * The failure this exists for is silent and it has already happened once. A JSDoc block ends at the
 * next line beginning with an `@`, so a copyable recipe whose body starts `@dotenvx run …` cut the
 * secrets pack's `@setup` in half: the page rendered, the drift gate compared it happily, and the
 * file a reader was meant to copy was two lines long. An odd fence is what that always looks like,
 * whatever caused it, so it is refused rather than rendered.
 *
 * The shell throws on this. Pure code here returns the sentence and decides nothing else.
 */
export function fenceFault(doc: PackDoc): string {
  const held: readonly { readonly what: string; readonly text: string }[] = [
    { what: "its lead", text: doc.lead },
    ...doc.blocks.map((block) => ({ what: `its @${block.tag} block`, text: block.body })),
    ...doc.params.map((param) => ({ what: `the doc on its ${param.name} parameter`, text: param.why })),
    ...doc.entries.map((entry) => ({ what: `the why on ${entry.key}`, text: entry.why })),
  ];
  const open = held.find((one) => (one.text.match(/```/g) ?? []).length % 2 === 1);
  return open === undefined
    ? ""
    : `the ${doc.name} pack: ${open.what} opens a \`\`\` fence that never closes. A doc comment ends at the next line starting with an @, so a fenced block that carries one is cut off there — take the @ off that line.`;
}

// ── the stranger's spellings ─────────────────────────────────────────────────

/**
 * THE EXAMPLE PARAMETERS every parameterised pack is bound with, for the whole repo.
 *
 * One shell script for the toolchain, `core/` for the pure home, `rules/` for the pack the repo
 * writes itself, `documentation/` for the docs folder. Not one of those names is this repo's, and
 * that is the point twice over: a page rendered with our own spelling teaches a reader that the
 * spelling is the pack's, and a machine test bound with it proves only that our own spelling still
 * works.
 *
 * DECLARED ONCE because there are two readers of it and they must not drift: `tools/pack-pages.ts`
 * binds these to render every glob and command on a pack's page, and `e2e/machine.test.ts` writes
 * them into a stranger's config and drives every rail against them. Two copies is a page that
 * documents a binding no test has ever run.
 *
 * Three packs are deliberately bound differently by the machine test, each saying so where it does
 * it: `docs` bare, because a pack whose parameters are all optional must stay bindable with no
 * object at all; `secrets` bare, because both of its command names now default to dotenvx's own
 * spelling and the default is the path a repo that has wrapped nothing takes; and `typescript`
 * with no shared base, because the rule that demands one exists only when a base is named and the
 * no-base path is the one a stranger takes. Each of the three is a wrapper or a base a real repo
 * would have, which is why the PAGE names it and the test does not.
 */
export const EXAMPLE = {
  docs: { root: "documentation", allow: ["README.md"] },
  fcis: { files: ["core/**/*.ts"], homes: ["core/**"], coverage: "./ci.sh coverage", example: "core/clock.ts" },
  flow: { packs: ["rules/**"] },
  git: { release: "./ci.sh release" },
  justfile: { exempt: [], recipes: { "npx vitest": "./ci.sh test" } },
  secrets: { dx: "./ci.sh dx", encrypt: "./ci.sh seal" },
  tdd: { run: "./ci.sh test" },
  typescript: { typecheck: "./ci.sh types", lint: "./ci.sh lint", tsconfigBase: "./tsconfig.base.json", eslintBase: "./eslint.config.base.js" },
} as const;

/** A JavaScript identifier, which is what decides whether an object key needs quoting. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A parameters object as the source that would supply it.
 *
 * KEYS ARE QUOTED WHEN THEY HAVE TO BE. The justfile pack's `recipes` map is keyed by a command
 * pattern — `"npx vitest"` — and printed bare it made the one thing this page exists to give a
 * reader, a config they can paste, a syntax error. The machine test writes the same text into a
 * real config file now, so a key that needs quoting and does not get it fails a suite rather than
 * sitting on a page.
 */
export function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value !== null && typeof value === "object")
    return `{ ${Object.entries(value)
      .map(([key, held]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${literal(held)}`)
      .join(", ")} }`;
  return JSON.stringify(value);
}

/** The `pack(…)` call that binds one pack with the parameters given, exactly as a config writes it. */
export function bindLine(name: string, params: unknown): string {
  return params === undefined ? `pack(${name})` : `pack(${name}, ${literal(params)})`;
}

// ── a case, as one line ──────────────────────────────────────────────────────

/**
 * A case as the one line a reader scans — "writing `docs/user/guide.md`", "running `git push
 * --force`".
 *
 * One arm per dialect the grammar's `Case` union has, and the union is what makes the list
 * exhaustive: a dialect added there stops compiling here rather than falling through to a sentence
 * that says nothing.
 */
export function caseLine(fact: Case): string {
  if (typeof fact === "string") return `running \`${fact}\``;
  if ("command" in fact) return `running \`${fact.command}\``;
  if ("path" in fact) return `writing \`${fact.path}\`${fact.content === "" ? "" : ` — \`${oneLine(fact.content)}\``}`;
  if ("staged" in fact) return `committing ${fact.staged.map((f) => `\`${f}\``).join(", ")}`;
  return `a turn with ${fact.actions.length} recorded action${fact.actions.length === 1 ? "" : "s"}`;
}

/**
 * A CREDENTIAL SHAPE, cut down to its first few characters wherever one appears in a fixture.
 *
 * The secrets pack proves `noSecretsInCommits` with a case whose canned world holds an AWS key
 * shape, assembled from pieces in the pack source so that committing the pack does not trip its own
 * rule. This page prints canned worlds — so the first time it did, it wrote that shape out whole
 * into a committed HTML file and the same rule refused the commit, correctly. Masking here is not
 * tidiness: a document carrying a live-key shape is what the rule exists to prevent, and a
 * generated page is a document.
 *
 * An unbroken run of 16 or more token characters carrying BOTH a letter and a digit — which is
 * what every one of those shapes is, and what an ordinary long identifier is not:
 * `optionalDependencies` and `DOTENV_PUBLIC_KEY` are letters alone and stay whole. Redaction is
 * VISIBLE — the run keeps its first four characters and an ellipsis — so a reader can still see
 * which shape the case is about.
 */
function redact(text: string): string {
  return text.replace(/[A-Za-z0-9_+/-]{16,}/g, (run) =>
    /[A-Za-z]/.test(run) && /[0-9]/.test(run) ? `${run.slice(0, 4)}…` : run,
  );
}

/** A file body on one line, short enough to sit in a list item, and never a live-key shape. */
function oneLine(content: string): string {
  const flat = redact(content).replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

/**
 * The world a case canned, as the phrases that explain its verdict.
 *
 * A check reads the event AND whatever it reaches for, and the reach is what a case answers in its
 * `world`. Dropped from the page, two cases with the same command sit in opposite columns with
 * nothing between them — which is precisely what the first read of these pages found. An exit code
 * of 0 is said out loud for the same reason: "succeeds" is the fact the case is making.
 */
export function caseWorld(fact: Case): string[] {
  if (typeof fact === "string" || fact.world === undefined) return [];
  const world: CaseWorld = fact.world;
  const said: string[] = [];
  for (const [command, answer] of Object.entries(world.exec ?? {})) {
    const output = oneLine(`${answer.stdout ?? ""} ${answer.stderr ?? ""}`);
    said.push(`\`${command}\` exits ${answer.code ?? 0}${output === "" ? "" : ` and says \`${output}\``}`);
  }
  for (const [path, content] of Object.entries(world.fs ?? {}))
    said.push(content === "" ? `\`${path}\` is empty` : `\`${path}\` holds \`${oneLine(content)}\``);
  if (world.gitDiff !== undefined) said.push(world.gitDiff === "" ? "the diff is empty" : `the diff is \`${oneLine(world.gitDiff)}\``);
  if (world.staged !== undefined) said.push(`the staged set is ${world.staged.map((file) => `\`${file}\``).join(", ")}`);
  return said;
}

/** Every case an entry carries, pass side then block side, as the lines a reader scans. */
export function caseLines(cases: Cases | undefined): readonly CaseLine[] {
  const side = (kind: "pass" | "block"): CaseLine[] =>
    (cases?.[kind] ?? []).map((fact) => ({ kind, line: caseLine(fact), given: caseWorld(fact) }));
  return [...side("pass"), ...side("block")];
}

/** The prose an entry shows — a guardrail's refusal message, or a breadcrumb's text. */
export function says(spec: EntrySpec): string {
  return spec.kind === "guardrail" ? (spec.message ?? "") : (spec.text ?? spec.file ?? "");
}

/** The stock check a `.check(…)` argument calls, when it calls one — `canonicalFiles({…})`. */
export function checkName(expression: string): string {
  return /^([A-Za-z][A-Za-z0-9]*)\(/.exec(expression)?.[1] ?? "";
}

// ── a check's settings ──────────────────────────────────────────────────────

/**
 * The options a check was configured with, as the JSON a reader can check against the pack.
 *
 * ONE SHAPE FOR EVERY CHECK, and the reason is what the first two attempts were: the settings were
 * pulled apart per option, some into labelled lists and some left as JSON, so `banCommands` and
 * `jsonInvariant` printed as two different kinds of thing and neither said what it was. What every
 * check really has is one options object; printing it whole means a reader learns the shape once.
 *
 * RESOLVED, so what appears is the glob a parameter supplied and the recipe a repo named, never
 * the expression that produced them. An empty object is "no options" — a rule whose whole content
 * is its scope and its message.
 */
export function settingsJson(settings: unknown): string {
  // `undefined` never reaches JSON.stringify with a value it cannot print: a check's options are
  // an object or they are nothing, and both nothings answer the same way here.
  if (settings === null || settings === undefined) return "";
  const printed = JSON.stringify(settings, null, 2);
  return printed === "{}" ? "" : printed;
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
 * A FENCED BLOCK — three backticks, an optional language, the lines, three backticks. Lazy in the
 * middle, so a doc comment holding two fences renders two code boxes rather than one.
 */
const FENCE = /```[^\n]*\n([\s\S]*?)\n?```/g;

/**
 * A doc comment as HTML: escaped, backticks turned into code, blank lines into paragraphs, and a
 * fenced block as code.
 *
 * The conversions are the whole of the markup this page understands, and they are here because a
 * doc comment is written for a reader of the SOURCE — where `\`.on(…)\`` is code and a blank line
 * is a paragraph — and a page that dropped them would read as one long blob. Prose the AGENT is
 * shown (`.text()`, `.message()`) never goes through here: that is quoted verbatim, backticks and
 * all, because the page's job there is to show exactly what the model receives.
 *
 * THE FENCE IS WHAT COPYABLE TEXT NEEDS. A pack that names a file it does not ship — a shared
 * tsconfig, the recipes behind an env seam — puts that file on its own page, and a file down the
 * paragraph path arrives with its lines run together and its quotes rewritten. Inside a fence only
 * escaping happens: a backtick there is a backtick, not the start of a `<code>`. An UNCLOSED fence
 * is not a fence and stays the prose it was, rather than swallowing the rest of the block into a
 * code box that never ends.
 */
export function prose(text: string): string {
  const said: string[] = [];
  let at = 0;
  for (const fence of text.matchAll(FENCE)) {
    said.push(paragraphs(text.slice(at, fence.index)), `<pre><code>${esc(fence[1] ?? "")}</code></pre>`);
    at = fence.index + fence[0].length;
  }
  said.push(paragraphs(text.slice(at)));
  return said.filter((held) => held !== "").join("\n");
}

/** The plain half — blank lines into paragraphs, backticks into code, and nothing for whitespace. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .flatMap((para) => (para.trim() === "" ? [] : [`<p>${line(para.trim())}</p>`]))
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

/** A list of globs as inline code, or the plain words for an entry that is not path-scoped. */
function globs(list: readonly string[]): string {
  return list.length === 0 ? "not scoped by path" : list.map((g) => `<code>${esc(g)}</code>`).join(" · ");
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
  if (entry.checkName === "") return '    <p class="fact"><b>Check</b> written inline in this pack</p>\n';
  const named = entry.reference
    ? `<a href="../checks/${kebab(entry.checkName)}.html"><code>${esc(entry.checkName)}</code></a>`
    : `<code>${esc(entry.checkName)}</code> <span class="none">(written in this pack)</span>`;
  if (entry.settings === "") return `    <p class="fact"><b>Check</b> ${named} — no options</p>\n`;
  // COLLAPSED BY DEFAULT. The settings are the rule's exact content and a reader wants them one
  // entry at a time; open on every entry, a page of twelve rules is a page of JSON.
  return (
    `    <p class="fact"><b>Check</b> ${named}</p>\n` +
    `    <details class="settings"><summary>settings</summary><pre><code>${esc(entry.settings)}</code></pre></details>\n`
  );
}


/** `canonicalFiles` → `canonical-files`, which is what the stock check's page is called. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** The pass/block pair, as two boxes. An empty side says so rather than rendering nothing. */
function casesBlock(cases: readonly CaseLine[]): string {
  const side = (kind: "pass" | "block"): string => {
    const lines = cases
      .filter((c) => c.kind === kind)
      .map((c) => {
        const given = c.given.length === 0 ? "" : `<span class="given">given ${c.given.map(line).join(" · ")}</span>`;
        return `<li>${line(c.line)}${given}</li>`;
      });
    const body = lines.length === 0 ? `<li class="none">no ${kind} case declared</li>` : lines.join("");
    return `<div class="case ${kind === "pass" ? "ok" : "stop"}"><b>${kind === "pass" ? "passes" : "blocks"}</b><ul>${body}</ul></div>`;
  };
  return `<div class="cases">${side("pass")}${side("block")}</div>`;
}

/** One fact line — a short label, then the value. Left-aligned, no indent column. */
function fact(label: string, value: string): string {
  return value === "" ? "" : `    <p class="fact"><b>${label}</b> ${value}</p>\n`;
}

function entrySection(entry: EntryDoc): string {
  const rail = entry.kind === "guardrail";
  const badge = rail ? '<span class="badge rail">guardrail</span>' : '<span class="badge crumb">breadcrumb</span>';
  const facts = [
    fact(rail ? "Refuses at" : "Shown when", esc(whenText(entry.at))),
    fact("Watches", globs(entry.on)),
    entry.ignore.length === 0 ? "" : fact("Ignores", globs(entry.ignore)),
    fact("Categories", entry.categories.length === 0 ? "every session" : entry.categories.map((c) => `<code>${esc(c)}</code>`).join(" · ")),
    entry.disabled === "" ? "" : fact("Off by default", esc(entry.disabled)),
    rail ? checkBlock(entry) : "",
  ].join("");

  const why =
    entry.why === ""
      ? entry.kind === "breadcrumb"
        ? '    <h3>Why it exists</h3>\n    <div class="why gap"><p>Not stated. Add a doc comment on the entry\'s key saying what goes wrong without it.</p></div>\n'
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
    facts.trimEnd(),
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
  if (doc.params.length === 0) return "  <p>The pack takes no parameters. Example config:</p>";
  const rows = doc.params.map(
    (p) =>
      `      <tr><td><code>${esc(p.name)}</code></td><td><code>${esc(p.type)}</code></td><td>${p.why === "" ? '<em class="none">Not documented. Add a doc comment on the interface member.</em>' : prose(p.why)}</td></tr>`,
  );
  return [
    `  <p>The pack takes ${doc.params.length} parameter${doc.params.length === 1 ? "" : "s"}. These are facts the pack cannot know about your repo:</p>`,
    "  <table>",
    "    <thead><tr><th>Parameter</th><th>Type</th><th>What it is</th></tr></thead>",
    `    <tbody>\n${rows.join("\n")}\n    </tbody>`,
    "  </table>",
    "  <p>Example config. The values are examples, and every glob and command on this page was rendered with them:</p>",
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
  .fact{margin:.25rem 0;font-size:.9rem;color:#39404a}
  .fact b{color:var(--mut);font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-right:.35rem}
  .settings{margin:.25rem 0 .4rem}
  .settings summary{cursor:pointer;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);font-weight:700}
  .settings pre{margin:.3rem 0 0}
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
  .case ul{margin:0;padding-left:1.1rem} .case li{margin:.3rem 0}
  .given{display:block;font-size:.82rem;color:#5c6470;margin-top:.1rem}
  .toc{margin:.5rem 0 0;padding:0;list-style:none}
  .toc li{padding:.35rem 0;border-bottom:1px solid var(--line);display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
  .toc li .id{font-family:ui-monospace, Menlo, monospace;font-weight:700;min-width:15rem}
  .toc li .d{color:#39404a;font-size:.92rem;flex:1}
  .gen{background:var(--soft);border-radius:8px;padding:.5rem .9rem;font-size:.82rem;color:var(--mut);margin:1.2rem 0 0}
  .none{color:var(--mut);font-style:italic}
  footer{margin-top:3rem;color:var(--mut);font-size:.85rem;border-top:1px solid var(--line);padding-top:1rem}
  @media (max-width:640px){.cases{grid-template-columns:1fr}}`;

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
  "      <tr><td>The named sections above the entries</td><td>An <code>@install</code>, <code>@setup</code> or <code>@adopt</code> tag on that same doc comment. A tag nobody uses renders nothing.</td><td>JSDoc tags</td></tr>",
  "      <tr><td>Entry id, kind, moments, globs, categories, description</td><td>The entry itself — <code>.at()</code> <code>.on()</code> <code>.description()</code></td><td>Loaded: the same data the engine runs</td></tr>",
  "      <tr><td>Why it exists</td><td>The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason.</td><td>JSDoc</td></tr>",
  "      <tr><td>What the agent reads</td><td><code>.text()</code> or <code>.message()</code>, verbatim</td><td>Loaded</td></tr>",
  "      <tr><td>Check and its settings</td><td>The check the entry asks, and the options it was given</td><td>The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied.</td></tr>",
  "      <tr><td>Proved by, and what each case was told</td><td><code>.test({ pass, block })</code> — the event, and the <code>world</code> the case supplies for whatever the check reads</td><td>Loaded</td></tr>",
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
      ? '  <p class="lead gap">No lead. Add a doc comment on <code>definePack</code> saying what this pack is for.</p>'
      : `  <div class="lead">${prose(doc.lead)}</div>`,
    "",
    `  <p class="gen">Generated from <code>packs/${esc(doc.name)}.ts</code> by <code>just docs-packs</code>. Edit the pack, not this page. The commit gate refuses a page that has drifted.</p>`,
    "",
    '  <h2 id="binding">Binding it</h2>',
    params(doc),
    `<pre><code>${esc(bindingSnippet(doc))}</code></pre>`,
    `  <p>To turn one entry off, say so in the config: <code>override(${esc(doc.name)}.${esc(doc.entries[0]?.key ?? "entry")}).disabled("why")</code>. It is a committed change, so a reviewer sees it.</p>`,
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
    `  <p class="lead">The ten packs <code>@jawache/flow/packs</code> ships. Each is a list of rules about a repo. Binding one is a single line in <code>flow.config.ts</code>, and a pack you do not bind does nothing.</p>`,
    "",
    "  <table>",
    "    <thead><tr><th>Pack</th><th>Guardrails · breadcrumbs</th><th>Parameters</th><th>What it is about</th></tr></thead>",
    `    <tbody>\n${rows.join("\n")}\n    </tbody>`,
    "  </table>",
    "",
    '  <p class="gen">Generated from <code>packs/*.ts</code> by <code>just docs-packs</code>. Edit the packs, not these pages. The commit gate refuses a page that has drifted.</p>',
    "",
    "  <footer>flow docs · <a href=\"../index.html\">all user docs</a> · generated page, do not edit</footer>",
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ── the page as MARKUP: what a browser will make of what we wrote ────────────
//
// The pages under docs/user/ are the surface flow is read on, and half of them are hand-written
// rather than generated — so nothing regenerates them and nothing compared them with anything.
// F3 found the cost live: `new-dep: <name> — <why>` sat unescaped inside a code block on the
// guidebook, a parser read the two placeholders as unknown ELEMENTS, and every reader was taught
// `put new-dep:  —  in the message`. The words the sentence existed to teach were the words the
// browser deleted, and every byte of the file was exactly as its author typed it.
//
// So these three ask what a PARSER will do, not what the text says. They are here in the pure
// home because that is what makes them assertable over a fixture as well as over the real folder.

/** Elements that carry no closing tag, plus the doctype, which is not one. */
const VOID_ELEMENTS = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);

/** Elements an HTML parser closes for you, so an unclosed one is legal markup and not a fault. */
const SELF_CLOSING_IN_PRACTICE = new Set("li p td th tr thead tbody option dt dd".split(" "));

/** Every element name HTML actually has, for the sweep below. Anything else renders as nothing. */
const HTML_ELEMENTS = new Set(
  ("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr " +
    "svg path circle rect line polyline polygon g text defs marker").split(" "),
);

/** `<style>` and `<script>` bodies are not markup — blanked, keeping the line count for the report. */
function withoutRawText(html: string): string {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => block.replace(/[^\n]/g, " "));
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

/**
 * Tags that never close, and closing tags that shut the wrong thing.
 *
 * A page whose markup does not balance still renders — that is the trouble with it. The parser
 * silently reshapes the tree, and what a reader loses is whatever fell inside the element that
 * should have ended, with no error anywhere to say so.
 */
export function unbalanced(html: string): string[] {
  const text = withoutRawText(html);
  const faults: string[] = [];
  const open: { name: string; line: number }[] = [];
  for (const tag of text.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const name = (tag[2] ?? "").toLowerCase();
    if (VOID_ELEMENTS.has(name) || tag[3] === "/") continue;
    const at = lineOf(text, tag.index);
    if (tag[1] === "") {
      open.push({ name, line: at });
      continue;
    }
    while (open.length > 0 && open.at(-1)?.name !== name && SELF_CLOSING_IN_PRACTICE.has(open.at(-1)?.name ?? "")) open.pop();
    const top = open.at(-1);
    if (top === undefined || top.name !== name)
      faults.push(`line ${at}: </${name}> closes ${top === undefined ? "nothing" : `<${top.name}> opened at line ${top.line}`}`);
    else open.pop();
  }
  for (const stray of open) if (!SELF_CLOSING_IN_PRACTICE.has(stray.name)) faults.push(`line ${stray.line}: <${stray.name}> never closed`);
  return faults;
}

/**
 * A `<` inside a code element that the author meant as text.
 *
 * Inside `<code>` every angle bracket must already be an entity, because that is the one place a
 * page prints the shapes a reader is meant to TYPE — a placeholder, a generic, a shell redirect.
 * The innermost code element is the subject, so a `<code>` legitimately nested in a `<pre>` is not
 * mistaken for the fault.
 */
export function unescapedInCode(html: string): string[] {
  const text = withoutRawText(html);
  const faults: string[] = [];
  for (const block of text.matchAll(/<code\b[^>]*>((?:(?!<\/?code\b)[\s\S])*?)<\/code>/gi)) {
    const body = block[1] ?? "";
    for (const bracket of body.matchAll(/</g)) {
      const at = bracket.index;
      faults.push(
        `line ${lineOf(text, block.index + at)}: unescaped \`<\` inside <code> — ${JSON.stringify(body.slice(Math.max(0, at - 25), at + 35))}`,
      );
    }
  }
  return faults;
}

/**
 * A `<word>` that is not an HTML element, anywhere on the page.
 *
 * This is the fault that shipped. The parser accepts an unknown element without complaint and
 * renders it as nothing at all, so the page looks finished and the words are gone — and the words
 * in question are placeholders, which is to say the part a reader most needs.
 */
export function unknownElements(html: string): string[] {
  const text = withoutRawText(html);
  return [...text.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)]
    .filter((tag) => !HTML_ELEMENTS.has((tag[1] ?? "").toLowerCase()))
    .map((tag) => `line ${lineOf(text, tag.index)}: ${tag[0]} — not an element, so it renders as nothing`);
}

/** Every relative href and src on a page — what the caller has to find on disk. */
export function localLinks(html: string): string[] {
  return [...withoutRawText(html).matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((link) => (link[1] ?? "").split("#")[0] ?? "")
    .filter((path) => path !== "" && !/^(https?:|mailto:|data:)/.test(path));
}
