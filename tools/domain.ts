// flow/tools/domain.ts — the pure half of the tools: the pack page, as a pure function of what a
// pack says, and — in its own section at the foot — the score a Bash path extractor gets against
// the hand-labelled corpus.
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
// files, parses the TypeScript and writes the markdown; everything below is text in, text out. That
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

// String algebra, and the one module a pure home may reach beyond its own: the corpus score
// resolves every path against the command's cwd before comparing.
import { posix } from "node:path";

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
  work: { writers: ["builder", "parent"] },
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
  return `${eventLine(fact)}${fact.actor === undefined ? "" : ` ${actorLine(fact.actor)}`}`;
}

/** The event half of a case's line — what it did, before who did it. */
function eventLine(fact: Exclude<Case, string>): string {
  if ("command" in fact) return `running \`${fact.command}\``;
  if ("path" in fact) return `writing \`${fact.path}\`${fact.content === "" ? "" : ` — \`${oneLine(fact.content)}\``}`;
  if ("staged" in fact) return `committing ${fact.staged.map((f) => `\`${f}\``).join(", ")}`;
  return `a turn with ${fact.actions.length} recorded action${fact.actions.length === 1 ? "" : "s"}`;
}

/**
 * Who a case's canned session was. Two cases writing the same file sit in opposite columns when
 * only the actor differs, and a page that dropped it would show nothing between them.
 */
function actorLine(actor: readonly string[]): string {
  return actor.length === 0 ? "by an actor with no category" : `as ${actor.map((name) => `\`${name}\``).join(" + ")}`;
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

// ── markdown ─────────────────────────────────────────────────────────────────

/**
 * A HEADING'S ANCHOR, spelled the way GitHub spells it — lowercased, punctuation dropped, spaces
 * turned into hyphens.
 *
 * It is here rather than in the shell because it is what makes a link on one page land on a heading
 * of another: the table of contents on a pack's page points at its own entry headings, and the
 * hand-written pages point at each other's sections. GitHub derives the anchor from the heading
 * text, so a page that spells it any other way links to nothing at all — silently, which is the
 * fault this whole folder exists to refuse.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Every heading a page carries, as its anchor — code fences skipped, where a `#` is not a heading. */
export function headingSlugs(markdown: string): string[] {
  return [...withoutFences(markdown).matchAll(/^#{1,6} +(.+)$/gm)].map((found) => headingSlug((found[1] ?? "").trim()));
}

/**
 * A PAGE WITH ITS FENCED BLOCKS BLANKED. Inside a fence a `#` is a shell comment and a `[x](y)` is
 * a line of someone's config — neither is a heading or a link, and a sweep that read them as such
 * would go red over a page that is perfectly correct.
 */
function withoutFences(markdown: string): string {
  let open = "";
  return markdown
    .split("\n")
    .map((line) => {
      const fence = /^ {0,3}(`{3,})/.exec(line);
      if (open === "") {
        if (fence === null) return line;
        open = fence[1] ?? "";
        return "";
      }
      if (fence !== null && (fence[1] ?? "").length >= open.length && line.trim() === fence[1]) open = "";
      return "";
    })
    .join("\n");
}

/** One link a page makes: where it points, and the heading it expects to find there. */
export interface PageLink {
  /** The relative path, or empty for a link into the page's own headings. */
  readonly path: string;
  /** The `#anchor`, without the hash, or empty when the link names a whole page. */
  readonly anchor: string;
}

/**
 * EVERY LOCAL LINK A PAGE MAKES — markdown links and the inline HTML a markdown page still carries.
 *
 * The anchor comes back beside the path because a markdown anchor is derived from a heading rather
 * than written on one: `index.md#checks` resolves to a file that exists and a heading that does
 * not, and nothing about the page looks wrong. So the sweep beside this asks for both halves.
 */
export function localLinks(markdown: string): PageLink[] {
  const text = withoutFences(markdown);
  const targets = [
    ...[...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((found) => found[1] ?? ""),
    ...[...text.matchAll(/(?:href|src)="([^"]+)"/g)].map((found) => found[1] ?? ""),
  ];
  return targets
    .filter((target) => !/^(https?:|mailto:|data:)/.test(target))
    .map((target) => ({ path: target.split("#")[0] ?? "", anchor: target.split("#")[1] ?? "" }))
    .filter((link) => link.path !== "" || link.anchor !== "");
}

/**
 * A VERBATIM BLOCK, fenced with enough backticks to survive its own content.
 *
 * What goes through here is prose the AGENT is shown — `.text()`, `.message()` — and the page's job
 * with it is to show exactly what the model receives, backticks and all. A fence is the one
 * markdown construct that promises that; three backticks around a message that carries three of
 * its own would end the block in the middle of it, so the fence is always one longer than the
 * longest run inside.
 */
function fenced(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((run) => run[0].length);
  const fence = "`".repeat(Math.max(2, ...runs) + 1);
  return `${fence}\n${text}\n${fence}`;
}

/**
 * A doc comment in a TABLE CELL — its paragraphs joined by a line break, because a cell holds one
 * line and nothing else.
 *
 * The inline HTML is deliberate: markdown has no multi-paragraph cell, and the choice is between a
 * `<br>` and dropping half of what the pack's author wrote. Copyable text never comes through here
 * — a file a pack names goes in its `@setup` block, which is prose on the page and keeps its fence.
 */
function proseCell(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => para.trim().replace(/\s+/g, " "))
    .filter((para) => para !== "")
    .join("<br><br>");
}

/** One cell, safe to sit in a row: a `|` of its own would end the cell early. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

/** A table, header row and all. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
  return [row(head), `|${" --- |".repeat(head.length)}`, ...rows.map(row)].join("\n");
}

/** A list of globs as inline code, or the plain words for an entry that is not path-scoped. */
function globs(list: readonly string[]): string {
  return list.length === 0 ? "not scoped by path" : list.map((glob) => `\`${glob}\``).join(" · ");
}

/** `canonicalFiles` → `canonical-files`, which is what the stock check's page is called. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * The check the entry asks, and the settings it was configured with — as VALUES.
 *
 * The name comes from the pack's own source and links to the check's reference page; the settings
 * are read back off the check itself, so what prints is what the rule really watches. The page
 * showed the `.check(…)` source until the first read of these pages, and `noGitDiscard({})` as the
 * whole description of a rule is what that was worth.
 */
function checkFact(entry: EntryDoc): string {
  if (entry.checkName === "") return "**Check** written inline in this pack";
  const named = entry.reference
    ? `[\`${entry.checkName}\`](../checks/${kebab(entry.checkName)}.md)`
    : `\`${entry.checkName}\` *(written in this pack)*`;
  return entry.settings === "" ? `**Check** ${named} — no options` : `**Check** ${named}`;
}

/**
 * The settings, COLLAPSED BY DEFAULT — the one construct markdown has none of, kept as the HTML a
 * markdown page may carry.
 *
 * The settings are the rule's exact content and a reader wants them one entry at a time; open on
 * every entry, a page of twelve rules is a page of JSON.
 */
function settingsBlock(entry: EntryDoc): string {
  return entry.settings === "" ? "" : `<details><summary>settings</summary>\n\n${fenced(entry.settings)}\n\n</details>`;
}

/** The pass/block pair, as two lists. An empty side says so rather than rendering nothing. */
function casesBlock(cases: readonly CaseLine[]): string {
  const side = (kind: "pass" | "block"): string => {
    const lines = cases
      .filter((one) => one.kind === kind)
      .map((one) => (one.given.length === 0 ? `- ${one.line}` : `- ${one.line}\n  - given ${one.given.join(" · ")}`));
    const body = lines.length === 0 ? `- *no ${kind} case declared*` : lines.join("\n");
    return `**${kind === "pass" ? "passes" : "blocks"}**\n\n${body}`;
  };
  return `${side("pass")}\n\n${side("block")}`;
}

/** One entry, in full — the facts, then why it exists, what it says, and what proves it. */
function entrySection(entry: EntryDoc): string {
  const rail = entry.kind === "guardrail";
  const facts = [
    `**${rail ? "Refuses at" : "Shown when"}** ${whenText(entry.at)}`,
    `**Watches** ${globs(entry.on)}`,
    entry.ignore.length === 0 ? "" : `**Ignores** ${globs(entry.ignore)}`,
    `**Categories** ${entry.categories.length === 0 ? "every session" : entry.categories.map((one) => `\`${one}\``).join(" · ")}`,
    entry.disabled === "" ? "" : `**Off by default** ${entry.disabled}`,
    rail ? checkFact(entry) : "",
  ].filter((line) => line !== "");

  const why =
    entry.why === ""
      ? entry.kind === "breadcrumb"
        ? "### Why it exists\n\n*Not stated. Add a doc comment on the entry's key saying what goes wrong without it.*"
        : ""
      : `### Why it exists\n\n${entry.why.trim()}`;

  return [
    `## \`${entry.id}\` — ${entry.kind}`,
    entry.description,
    facts.map((line) => `- ${line}`).join("\n"),
    rail ? settingsBlock(entry) : "",
    why,
    entry.says === "" ? "" : `### What the agent reads${rail ? " when refused" : ""}\n\n${fenced(entry.says)}`,
    rail ? `### Proved by\n\n${casesBlock(entry.cases)}` : "",
  ]
    .filter((block) => block !== "")
    .join("\n\n");
}

/** The table of contents — every entry, its kind, and what it is for, in one screen. */
function toc(entries: readonly EntryDoc[]): string {
  return entries
    .map((entry) => `- [\`${entry.id}\`](#${headingSlug(`\`${entry.id}\` — ${entry.kind}`)}) · ${entry.kind} · ${entry.description}`)
    .join("\n");
}

/** The parameters table, or the sentence that says there are none. */
function params(doc: PackDoc): string {
  if (doc.params.length === 0) return "The pack takes no parameters. Example config:";
  const rows = doc.params.map((param) => [
    `\`${param.name}\``,
    `\`${param.type}\``,
    param.why === "" ? "*Not documented. Add a doc comment on the interface member.*" : proseCell(param.why),
  ]);
  return [
    `The pack takes ${doc.params.length} parameter${doc.params.length === 1 ? "" : "s"}. These are facts the pack cannot know about your repo:`,
    table(["Parameter", "Type", "What it is"], rows),
    "Example config. The values are examples, and every glob and command on this page was rendered with them:",
  ].join("\n\n");
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
  return DOC_BLOCKS.flatMap((known) => {
    const held = doc.blocks.find((block) => block.tag === known.tag);
    return held === undefined || held.body === "" ? [] : [`## ${known.title}\n\n${held.body.trim()}`];
  }).join("\n\n");
}

/** The counts line under the title: what is in the pack, and where it fires. */
function census(doc: PackDoc): string {
  const rails = doc.entries.filter((entry) => entry.kind === "guardrail").length;
  const crumbs = doc.entries.length - rails;
  const moments = [...new Set(doc.entries.flatMap((entry) => entry.at))];
  const takes = doc.params.length === 0 ? "takes no parameters" : `takes ${doc.params.length} parameter${doc.params.length === 1 ? "" : "s"}`;
  return `${rails} guardrail${rails === 1 ? "" : "s"} · ${crumbs} breadcrumb${crumbs === 1 ? "" : "s"} · fires at: ${moments.join(" · ")} · ${takes}`;
}

/** Where every part of the page came from — the page explaining itself, once, at the bottom. */
const PROVENANCE = [
  "## Where each part of this page comes from",
  table(
    ["On the page", "In the pack", "Read how"],
    [
      [
        "Lead, and the parameters table",
        "The doc comment on `definePack`, and the doc comment on each member of the parameter interface",
        "JSDoc, read with the TypeScript compiler API",
      ],
      [
        "The named sections above the entries",
        "An `@install`, `@setup` or `@adopt` tag on that same doc comment. A tag nobody uses renders nothing.",
        "JSDoc tags",
      ],
      [
        "Entry id, kind, moments, globs, categories, description",
        "The entry itself — `.at()` `.on()` `.description()`",
        "Loaded: the same data the engine runs",
      ],
      [
        "Why it exists",
        "The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason.",
        "JSDoc",
      ],
      ["What the agent reads", "`.text()` or `.message()`, verbatim", "Loaded"],
      [
        "Check and its settings",
        "The check the entry asks, and the options it was given",
        "The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied.",
      ],
      [
        "Proved by, and what each case was told",
        "`.test({ pass, block })` — the event, and the `world` the case supplies for whatever the check reads",
        "Loaded",
      ],
    ],
  ),
].join("\n\n");

/**
 * ONE PACK, ONE PAGE.
 *
 * The order is the order a stranger needs it in: what the pack is, how it is bound, the whole list
 * at a glance, then every entry in full. Nothing here is written by hand anywhere else — the page
 * is regenerated and byte-compared at the commit gate, so a hand edit is refused.
 */
export function renderPackPage(doc: PackDoc): string {
  return `${[
    `[flow packs](./index.md) › ${doc.name}`,
    `# The \`${doc.name}\` pack`,
    census(doc),
    doc.lead === "" ? "*No lead. Add a doc comment on `definePack` saying what this pack is for.*" : doc.lead.trim(),
    "Generated from `packs/" + doc.name + ".ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.",
    "## Binding it",
    params(doc),
    fenced(bindingSnippet(doc)),
    `To turn one entry off, say so in the config: \`override(${doc.name}.${doc.entries[0]?.key ?? "entry"}).disabled("why")\`. It is a committed change, so a reviewer sees it.`,
    blocks(doc),
    "## Entries",
    toc(doc.entries),
    ...doc.entries.map(entrySection),
    PROVENANCE,
    "---",
    `flow docs · [the packs](./index.md) · \`${doc.name}\` · generated page, do not edit`,
  ]
    .filter((block) => block !== "")
    .join("\n\n")}\n`;
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
  const rows = docs.map((doc) => {
    const rails = doc.entries.filter((entry) => entry.kind === "guardrail").length;
    return [
      `[\`${doc.name}\`](./${doc.name}.md)`,
      `${rails} · ${doc.entries.length - rails}`,
      doc.params.length === 0 ? "—" : doc.params.map((param) => `\`${param.name}\``).join(" "),
      doc.lead === "" ? "*no lead yet*" : firstSentence(doc.lead.trim()).replace(/\s+/g, " "),
    ];
  });
  return `${[
    "[flow](../index.md) › packs",
    "# The packs",
    `${docs.length} packs · one page each · generated by \`just docs-packs\``,
    "The ten packs `@jawache/flow/packs` ships. Each is a list of rules about a repo. Binding one is a single line in `flow.config.ts`, and a pack you do not bind does nothing.",
    table(["Pack", "Guardrails · breadcrumbs", "Parameters", "What it is about"], rows),
    "Generated from `packs/*.ts` by `just docs-packs`. Edit the packs, not these pages. The commit gate refuses a page that has drifted.",
    "---",
    "flow docs · [all user docs](../index.md) · generated page, do not edit",
  ].join("\n\n")}\n`;
}

// ── what the three markup checkers were, and why they are gone ───────────────
//
// `unbalanced`, `unescapedInCode` and `unknownElements` lived here while docs/user/ was HTML. Each
// asked what a PARSER would do rather than what the text said, and the one that earned them found a
// live fault: `new-dep: <name> — <why>` sat unescaped inside a code block on the guidebook, a parser
// read the two placeholders as unknown ELEMENTS, and every reader was taught `put new-dep:  —  in
// the message`. Every byte of the file was exactly as its author typed it.
//
// Markdown cannot lose a word that way: inside a fence or a backtick span nothing is markup, and a
// `<word>` in prose is text. So the three are retired rather than ported, and what replaces them is
// the fault markdown DOES have — an anchor that resolves to nothing, because a markdown anchor is
// derived from a heading rather than written on one. That is `localLinks` and `headingSlugs` above,
// swept over the real folder by tools/pages.test.ts.

// ══ THE BASH CORPUS SCORE ═══════════════════════════════════════════════════
//
// How well a function names what a Bash command touches, measured. A breadcrumb fires on first
// contact with an area, and under auto mode most contact is a Bash `cat`, `grep` or `sed -n` whose
// payload names no path. Any mechanism that claims to recover those paths — a table of literal
// arguments, a shell grammar, shell functions shadowing the read commands — is an EXTRACTOR:
// `(command, cwd) → {reads, writes}`. What follows scores one against
// `__fixtures__/bash-corpus/corpus.json`, 150 real commands labelled by hand, and says per mechanism
// and per parsing trap how much it found (recall) and how much of what it said was true
// (precision). The choice between mechanisms is then a table, not an argument. The shell is
// score-bash.ts: it reads the fixture, picks the extractor and prints.
//
// ASYNC ON PURPOSE. An extractor that shadows `cat` with a shell function only learns its paths by
// running the command, so the scorer awaits whatever it is handed. A plain function works as is.

/** The strata the corpus was drawn from, in the order its README lists them. */
export const MECHANISMS = [
  "cat",
  "head",
  "tail",
  "sed -n",
  "grep",
  "rg",
  "find",
  "ls",
  "redirect",
  "heredoc",
  "sed -i",
  "python heredoc",
  "cp/mv",
  "just",
  "work",
] as const;

/** The parsing traps the transcript audit found, each tagged on the entries that carry it. */
export const TRAPS = ["quoted-operator", "heredoc-body", "cd", "$VAR", "2>&1"] as const;

/** The two halves of a command's effect on the tree. */
export type Half = "reads" | "writes";
const HALVES: readonly Half[] = ["reads", "writes"];

/** One hand-labelled command. The README beside the fixture says how each field was decided. */
export interface CorpusEntry {
  readonly id: string;
  readonly mechanism: string;
  readonly traps: readonly string[];
  readonly cwd: string;
  readonly command: string;
  /** Paths read or searched; relative to `cwd` when under it, absolute otherwise. */
  readonly reads: readonly string[];
  /** Paths created, changed, moved or deleted, spelled the same way. */
  readonly writes: readonly string[];
  /**
   * The halves whose list is only what the line lets anyone know — a recipe, an unseen script or a
   * computed loop touches more. There, a prediction nobody labelled is not charged as wrong.
   */
  readonly opaque?: readonly Half[];
}

/** What an extractor answers for one command. Relative paths are taken against the command's cwd. */
export interface Targets {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

/** The thing being measured. It may throw; a throw scores as an empty answer and is reported. */
export type Extractor = (command: string, cwd: string) => Targets | Promise<Targets>;

/** One half of one or many commands, counted. */
export interface Tally {
  /** Paths the labels hold. */
  readonly expected: number;
  /** Paths the extractor named that the labels also hold. */
  readonly hit: number;
  /** Predictions counted against precision — every one, except unlabelled ones on an opaque half. */
  readonly charged: number;
}

/** One command, scored: the counts and the paths behind them, so a miss can be read and fixed. */
export interface EntryScore {
  readonly id: string;
  readonly mechanism: string;
  readonly traps: readonly string[];
  readonly reads: Tally;
  readonly writes: Tally;
  readonly missed: Targets;
  readonly extra: Targets;
}

/** A line of the report: every entry that shares a mechanism, a trap, or all of them. */
export interface Row {
  readonly label: string;
  readonly entries: number;
  readonly reads: Tally;
  readonly writes: Tally;
}

export interface Report {
  readonly name: string;
  readonly total: Row;
  readonly byMechanism: readonly Row[];
  readonly byTrap: readonly Row[];
  readonly entries: readonly EntryScore[];
  /** Entries where the extractor threw, with what it said. They scored as an empty answer. */
  readonly errors: readonly { readonly id: string; readonly message: string }[];
}

// ── reading the fixture ─────────────────────────────────────────────────────

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * The fixture, checked field by field. Every problem is named with the entry it sits on; an entry
 * with a problem is left out rather than scored on a guess, so a corrupted label cannot quietly
 * move a percentage.
 */
export function parseCorpus(raw: unknown): { entries: CorpusEntry[]; problems: string[] } {
  if (!Array.isArray(raw)) return { entries: [], problems: ["the corpus is not a JSON array"] };
  const entries: CorpusEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, index) => {
    const e = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : `#${index}`;
    const wrong: string[] = [];
    if (typeof e.id !== "string") wrong.push("no id");
    else if (seen.has(e.id)) wrong.push("a duplicate id");
    if (typeof e.mechanism !== "string" || !(MECHANISMS as readonly string[]).includes(e.mechanism)) wrong.push("an unknown mechanism");
    if (!isStringList(e.traps) || !e.traps.every((t) => (TRAPS as readonly string[]).includes(t))) wrong.push("an unknown trap");
    if (typeof e.cwd !== "string" || !e.cwd.startsWith("/")) wrong.push("a cwd that is not absolute");
    if (typeof e.command !== "string" || e.command === "") wrong.push("no command");
    if (!isStringList(e.reads)) wrong.push("reads that are not a list of paths");
    if (!isStringList(e.writes)) wrong.push("writes that are not a list of paths");
    if (e.opaque !== undefined && (!isStringList(e.opaque) || !e.opaque.every((h) => h === "reads" || h === "writes"))) {
      wrong.push("an opaque that names neither reads nor writes");
    }
    if (typeof e.id === "string") seen.add(e.id);
    if (wrong.length > 0) problems.push(`${id}: ${wrong.join(", ")}`);
    else entries.push(e as unknown as CorpusEntry);
  });
  return { entries, problems };
}

// ── scoring ─────────────────────────────────────────────────────────────────

/**
 * A path as the scorer compares it: absolute, against the command's cwd, with no trailing slash
 * and no `.` or `..` segments. `~` is not expanded — the scorer does not know whose home it is, so
 * an extractor answers with the path already expanded.
 */
export function normalise(cwd: string, path: string): string {
  return posix.resolve(cwd, path);
}

function tallyHalf(expected: readonly string[], predicted: readonly string[], opaque: boolean) {
  const want = new Set(expected);
  const said = new Set(predicted);
  const hits = [...said].filter((p) => want.has(p));
  return {
    tally: { expected: want.size, hit: hits.length, charged: opaque ? hits.length : said.size },
    missed: [...want].filter((p) => !said.has(p)),
    extra: [...said].filter((p) => !want.has(p)),
  };
}

/** One entry against one answer. Both sides are normalised against the entry's cwd first. */
export function scoreEntry(entry: CorpusEntry, got: Targets): EntryScore {
  const [reads, writes] = HALVES.map((half) =>
    tallyHalf(
      entry[half].map((p) => normalise(entry.cwd, p)),
      got[half].map((p) => normalise(entry.cwd, p)),
      entry.opaque?.includes(half) ?? false,
    ),
  ) as [ReturnType<typeof tallyHalf>, ReturnType<typeof tallyHalf>];
  return {
    id: entry.id,
    mechanism: entry.mechanism,
    traps: entry.traps,
    reads: reads.tally,
    writes: writes.tally,
    missed: { reads: reads.missed, writes: writes.missed },
    extra: { reads: reads.extra, writes: writes.extra },
  };
}

const ZERO: Tally = { expected: 0, hit: 0, charged: 0 };
const add = (a: Tally, b: Tally): Tally => ({ expected: a.expected + b.expected, hit: a.hit + b.hit, charged: a.charged + b.charged });

/** Every entry the filter keeps, summed into one row. */
export function scoreRow(label: string, scores: readonly EntryScore[]): Row {
  return {
    label,
    entries: scores.length,
    reads: scores.reduce((t, s) => add(t, s.reads), ZERO),
    writes: scores.reduce((t, s) => add(t, s.writes), ZERO),
  };
}

/** Run the extractor over every entry and fold the answers into the report. */
export async function scoreCorpus(name: string, corpus: readonly CorpusEntry[], extract: Extractor): Promise<Report> {
  const entries: EntryScore[] = [];
  const errors: { id: string; message: string }[] = [];
  for (const entry of corpus) {
    let got: Targets = { reads: [], writes: [] };
    try {
      got = await extract(entry.command, entry.cwd);
    } catch (error) {
      errors.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
    }
    entries.push(scoreEntry(entry, got));
  }
  return {
    name,
    total: scoreRow("all", entries),
    byMechanism: MECHANISMS.map((m) => scoreRow(m, entries.filter((e) => e.mechanism === m))).filter((r) => r.entries > 0),
    byTrap: TRAPS.map((t) => scoreRow(t, entries.filter((e) => e.traps.includes(t)))).filter((r) => r.entries > 0),
    entries,
    errors,
  };
}

// ── printing ────────────────────────────────────────────────────────────────

/** `hit/of pct` — or a dash when there is nothing to divide by, which is not the same as 0%. */
export function rate(hit: number, of: number): string {
  if (of === 0) return "—";
  return `${hit}/${of} ${Math.round((100 * hit) / of)}%`;
}

const SCORE_HEAD = ["", "n", "read recall", "read precision", "write recall", "write precision"];

function scoreCells(r: Row): string[] {
  return [r.label, String(r.entries), rate(r.reads.hit, r.reads.expected), rate(r.reads.hit, r.reads.charged), rate(r.writes.hit, r.writes.expected), rate(r.writes.hit, r.writes.charged)];
}

function aligned(rows: readonly string[][]): string[] {
  const width = SCORE_HEAD.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows.map((r) => r.map((cell, c) => (c === 0 ? cell.padEnd(width[c] ?? 0) : cell.padStart(width[c] ?? 0))).join("  ").trimEnd());
}

/** The report as a reader sees it: one table by mechanism, one by trap, the total, any throws. */
export function renderReport(report: Report): string {
  const lines = [`Bash corpus — ${report.name}, ${report.total.entries} commands`, ""];
  lines.push(...aligned([SCORE_HEAD, ...report.byMechanism.map(scoreCells), scoreCells(report.total)]));
  lines.push("", "by trap");
  lines.push(...aligned([SCORE_HEAD, ...report.byTrap.map(scoreCells)]));
  if (report.errors.length > 0) {
    lines.push("", `the extractor threw on ${report.errors.length}, scored as an empty answer:`);
    for (const e of report.errors) lines.push(`  ${e.id}  ${e.message}`);
  }
  return lines.join("\n") + "\n";
}

/** Every entry with something missed or something extra, the paths spelled out — the worklist. */
export function renderMisses(report: Report): string {
  const lines: string[] = [];
  for (const e of report.entries) {
    const parts = HALVES.flatMap((half) => [
      ...e.missed[half].map((p) => `    missed ${half.slice(0, -1)}  ${p}`),
      ...e.extra[half].map((p) => `    extra  ${half.slice(0, -1)}  ${p}`),
    ]);
    if (parts.length > 0) lines.push(`${e.id} [${e.mechanism}]`, ...parts);
  }
  return lines.length === 0 ? "nothing missed, nothing extra\n" : lines.join("\n") + "\n";
}

// ── the baseline ────────────────────────────────────────────────────────────

/**
 * THE FLOOR, deliberately naive: split the whole command on whitespace, strip quote marks, and call
 * the word after `>` or `>>` a write and every other word that looks like a path a read. It knows
 * no command, no quote, no heredoc and no `cd` — every trap in the corpus is a trap for it — so
 * whatever a real mechanism scores is read against what knowing nothing already gets.
 */
export function baseline(command: string): Targets {
  const words = command.split(/\s+/).map((w) => w.replace(/^['"]+|['"]+$/g, "")).filter((w) => w !== "");
  const reads: string[] = [];
  const writes: string[] = [];
  words.forEach((word, i) => {
    const glued = /^>>?(.+)$/.exec(word);
    if (glued?.[1] !== undefined) writes.push(glued[1]);
    else if (words[i - 1] === ">" || words[i - 1] === ">>") writes.push(word);
    else if (!word.startsWith("-") && !word.includes(">") && (word.includes("/") || /\.\w+$/.test(word))) reads.push(word);
  });
  return { reads, writes };
}
