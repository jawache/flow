// flow/tools/domain.ts — the pure half of the tools: what a markdown page's links and front matter
// say, the release's migration guide and the package's own links, and — in its own section at the
// foot — the score a Bash path extractor gets against the hand-labelled corpus.
//
// PURE, and gated as this repo's pure home is: the shells beside it read the files and print;
// everything below is text in, text out, which is what makes it assertable in a unit test rather
// than by eye.

// String algebra, and the one module a pure home may reach beyond its own: the corpus score
// resolves every path against the command's cwd before comparing.
import { posix } from "node:path";

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
 * WHICH LINES OF A PAGE SIT IN A FENCED BLOCK, the fences themselves included. A fence closes on a
 * line holding nothing but a run of backticks at least as long as the one that opened it, so a
 * block that shows a fence of its own survives intact.
 */
function inFence(lines: readonly string[]): boolean[] {
  let open = "";
  return lines.map((line) => {
    const fence = /^ {0,3}(`{3,})/.exec(line);
    if (open === "") {
      if (fence === null) return false;
      open = fence[1] ?? "";
      return true;
    }
    if (fence !== null && (fence[1] ?? "").length >= open.length && line.trim() === fence[1]) open = "";
    return true;
  });
}

/**
 * A PAGE WITH ITS FENCED BLOCKS BLANKED. Inside a fence a `#` is a shell comment and a `[x](y)` is
 * a line of someone's config — neither is a heading or a link, and a sweep that read them as such
 * would go red over a page that is perfectly correct.
 */
function withoutFences(markdown: string): string {
  const lines = markdown.split("\n");
  const fenced = inFence(lines);
  return lines.map((line, at) => (fenced[at] === true ? "" : line)).join("\n");
}

/**
 * EVERY LINE OF CODE A PAGE SHOWS, its fenced blocks run together with the fences dropped — the
 * other half of `withoutFences`, read by the sweep that holds a page's examples to the real API.
 */
export function fencedCode(markdown: string): string {
  const lines = markdown.split("\n");
  const fenced = inFence(lines);
  return lines.filter((line, at) => fenced[at] === true && !/^ {0,3}`{3,}/.test(line)).join("\n");
}

/** One `import { … } from "…"` in a page's code: the module, and each name as that module exports it. */
interface CodeImport {
  readonly from: string;
  readonly names: readonly string[];
}

/** The names in a `{ … }` list, as the module exports them: a `type` marker and an `as` alias dropped. */
function specifierNames(list: string): string[] {
  return list
    .split(",")
    .map((held) => (held.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "").trim())
    .filter((name) => name !== "");
}

/** Every named import in some code, one line or spread over several. */
export function codeImports(code: string): CodeImport[] {
  return [...code.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].map((found) => ({
    from: found[2] ?? "",
    names: specifierNames(found[1] ?? ""),
  }));
}

/**
 * EVERY NAME A DOOR FILE EXPORTS, types included — read off its `export { … }` lists, because a
 * type is a promise of the door too and leaves nothing behind at runtime to read it back by.
 */
export function exportedNames(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((found) => specifierNames(found[1] ?? ""));
}

/**
 * The check each `.check(name(…))` in some code asks for, by the name it is called by. A check
 * written inline — `.check(async (ctx) => …)` — names nothing, so it is not in the list.
 */
export function checksCalled(code: string): string[] {
  return [...code.matchAll(/\.check\(\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((found) => found[1] ?? "").filter((name) => name !== "async" && name !== "function");
}

/** Every check some code defines for itself: `const name = defineCheck(…)`. */
export function checksDefined(code: string): string[] {
  return [...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*defineCheck\s*\(/g)].map((found) => found[1] ?? "");
}

/** Every named import in some code from `@jawache/flow` or one of its subpath doors. */
export function flowImports(code: string): CodeImport[] {
  return codeImports(code).filter((found) => found.from === "@jawache/flow" || found.from.startsWith("@jawache/flow/"));
}

/** What a page's examples are held to: every door with the names it exports, and the stock checks by name. */
export interface Api {
  readonly doors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stockChecks: ReadonlySet<string>;
}

/**
 * EVERY WAY A PAGE'S EXAMPLES HAVE FALLEN BEHIND THE API, one line per fault: an import from a
 * door that does not exist, a name the door does not export, and a `.check(name(…))` that is
 * neither a stock check nor one the same code defines with `defineCheck`.
 */
export function exampleFaults(code: string, api: Api): string[] {
  const defined = new Set(checksDefined(code));
  return [
    ...flowImports(code).flatMap(({ from, names }) => {
      const exported = api.doors.get(from);
      if (exported === undefined) return [`${from} — no such door`];
      return names.filter((name) => !exported.has(name)).map((name) => `${name} — ${from} does not export it`);
    }),
    ...checksCalled(code)
      .filter((name) => !api.stockChecks.has(name) && !defined.has(name))
      .map((name) => `.check(${name}(…)) — neither a stock check nor a defineCheck on this page`),
  ];
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
 * THE FRONT MATTER A PAGE OPENS WITH, as its fields, or null when the page does not open with one.
 *
 * Read back by the sweep over docs/user/, which holds every page — generated and hand-written —
 * to the same opening. One `key: value` per line is all the pages use, so that is all it reads; a
 * value keeps its quotes, because the sweep asks which fields are there, not what they say.
 */
export function frontMatterFields(markdown: string): ReadonlyMap<string, string> | null {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown);
  if (block === null) return null;
  const fields = new Map<string, string>();
  for (const line of (block[1] ?? "").split("\n")) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (field !== null) fields.set(field[1] ?? "", field[2] ?? "");
  }
  return fields;
}

// ── what the three markup checkers were, and why they are gone ───────────────
//
// `unbalanced`, `unescapedInCode` and `unknownElements` lived here while docs/user/ was HTML. Each
// asked what a PARSER would do rather than what the text said, and the one that earned them found a
// live fault: `new-dep: <name> — <why>` sat unescaped inside a code block on a how-to page about
// requiring a reason in the commit message, a parser read the two placeholders as
// unknown ELEMENTS, and every reader was taught `put new-dep:  —  in the message`. Every byte of
// the file was exactly as its author typed it.
//
// Markdown cannot lose a word that way: inside a fence or a backtick span nothing is markup, and a
// `<word>` in prose is text. So the three are retired rather than ported, and what replaces them is
// the fault markdown DOES have — an anchor that resolves to nothing, because a markdown anchor is
// derived from a heading rather than written on one. That is `localLinks` and `headingSlugs` above,
// swept over the real folder by tools/pages.test.ts.

// ══ THE BASH CORPUS SCORE ═══════════════════════════════════════════════════
//
// How well a function names what a Bash command touches, measured. `flow facts` counts the files a session
// read, and under auto mode most reads are a Bash `cat`, `grep` or `sed -n` whose payload names no
// path. Any mechanism that claims to recover those paths — a table of literal
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RELEASE'S MIGRATION GUIDE — the page a guarded repo's agent follows to upgrade
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// ONE PAGE PER RELEASE, named by the version it upgrades TO, and a release is refused without it:
// `just release` asks before it writes a byte (release-guide.ts), and the house pack asks again of
// any commit that stages package.json. A guide written later is written from memory.

/** Where the guide for upgrading to `version` lives. */
export function migrationGuide(version: string): string {
  return `docs/user/migrations/${version}.md`;
}

/** The version `commit-and-tag-version --dry-run` would cut, read off its own report — or null. */
export function nextVersion(dryRun: string): string | null {
  return /bumping version in package\.json from \S+ to (\S+)/.exec(dryRun)?.[1] ?? null;
}

// ══ THE PACKAGE'S OWN LINKS — every page npm uploads, followed inside it; why: tools/package.test.ts ══

/** The paths `npm pack --dry-run --json` would upload, read off its report: none when it cannot be read, and no entry without a path. */
export function packedFiles(report: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(report);
  } catch {
    return [];
  }
  // npm up to 11 prints a list of packages; npm 12 prints an object keyed by each package's name.
  const packages: unknown[] = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? Object.values(parsed) : [];
  const first: unknown = packages[0];
  const files: unknown = typeof first === "object" && first !== null && "files" in first ? first.files : undefined;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: unknown) => (typeof file === "object" && file !== null && "path" in file && typeof file.path === "string" ? [file.path] : []));
}

/** `canonicalFiles` → `canonical-files`, which is what the stock check's page is called. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * EVERY LINK A SHIPPED PAGE MAKES TO A FILE THE PACKAGE LEAVES OUT, one line each naming the page,
 * the link as written and where it lands. The pages are the shipped markdown files, each read
 * through `read`. A link to a folder holds when the package ships anything under it; a link that
 * climbs out of the package never holds.
 */
export function unshippedLinks(shipped: readonly string[], read: (page: string) => string): string[] {
  const files = new Set(shipped);
  const lands = (target: string): boolean => files.has(target) || shipped.some((file) => file.startsWith(`${target}/`));
  return shipped
    .filter((file) => file.endsWith(".md"))
    .flatMap((page) =>
      localLinks(read(page))
        .filter((link) => link.path !== "")
        .flatMap((link) => {
          const target = posix.normalize(posix.join(posix.dirname(page), decoded(link.path))).replace(/\/$/, "");
          const outside = target === ".." || target.startsWith("../");
          return !outside && lands(target) ? [] : [`${page} → ${link.path} (${outside ? "outside the package" : `${target} is not in the package`})`];
        }),
    );
}

/** A link's path with its %-escapes undone, or as written when they do not decode. */
function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
