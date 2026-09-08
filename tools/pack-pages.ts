// flow/tools/pack-pages.ts — the shell that turns the ten packs into ten pages.
//
// `just docs-packs` writes them; `just docs-packs --check` regenerates into memory and compares,
// which is what the commit gate runs. Everything it decides is in tools/domain.ts; this file reads
// the world and writes to it, and that is the whole split.
//
// TWO READERS OF ONE PACK, and they answer different halves:
//
//   · THE LOADER — `loadConfig(defineConfig([pack(x, params)]))`, the same call the engine makes.
//     Every fact the engine runs on comes from here: the ids, the moments, the globs, the
//     categories, the message or text verbatim, the cases. Nothing on the page is a paraphrase of
//     something the loader could have said.
//   · THE PARSER — the TypeScript compiler API over the pack's source. It reads the two things a
//     loaded pack cannot carry: the DOC COMMENTS (the pack's lead, its parameters, and why each
//     entry exists) and the `.check(…)` argument as written, settings and all.
//
// PARAMETERS ARE A STRANGER'S. A parameterised pack has no entries until something binds it, so
// the page is rendered with the example bindings below — one shell script for the toolchain,
// `core/` for the pure home, `rules/` for the repo's own pack. Not one of those names is this
// repo's, which is the same discipline the machine test holds: a page rendered with our own
// spelling would teach a reader that the spelling is the pack's.

import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { defineConfig, loadConfig, pack, type Cases, type EntrySpec, type GuardrailSpec, type PackBinding } from "../index.ts";
import { docs, fcis, flow, git, justfile, node, secrets, tdd, typescript, work } from "../packs/index.ts";
import {
  caseLine,
  caseWorld,
  DOC_BLOCKS,
  kebab,
  renderPackPage,
  renderPacksIndex,
  settingsJson,
  type CaseFact,
  type DocBlock,
  type EntryDoc,
  type PackDoc,
  type ParamDoc,
} from "./domain.ts";

/** Where the pages are written, under the user docs. */
const OUT = join("docs", "user", "packs");

/** The stock checks with a reference page. A pack's own check gets no link — there is no page. */
const REFERENCED = new Set(
  existsSync(join("docs", "user", "checks")) ? readdirSync(join("docs", "user", "checks")).map((file) => file.replace(/\.html$/, "")) : [],
);

/** One pack, and the example parameters every entry on its page is rendered with. */
interface Shipped {
  readonly name: string;
  /** The binding itself, written out — so the compiler checks the example against the pack. */
  readonly binding: PackBinding;
  /** The same parameters as data, for the config line the page prints. */
  readonly params: Readonly<Record<string, unknown>> | undefined;
}

// THE STRANGER'S SPELLINGS: one shell script for the whole toolchain, `core/` for the pure home,
// `rules/` for the pack the repo writes itself. Declared once each and used twice — bound, so the
// compiler proves the example is a legal binding, and printed, so the page shows what was bound.
const DOCS = { root: "documentation", allow: ["README.md"] };
const FCIS = { files: ["core/**/*.ts"], homes: ["core/**"], coverage: "./ci.sh coverage", example: "core/clock.ts" };
const FLOW = { packs: ["rules/**"] };
const GIT = { release: "./ci.sh release" };
const JUSTFILE = { exempt: [], recipes: { "npx vitest": "./ci.sh test" } };
const SECRETS = { dx: "./ci.sh dx", encrypt: "./ci.sh seal", names: "./ci.sh names" };
const TDD = { run: "./ci.sh test" };
const TYPESCRIPT = { typecheck: "./ci.sh types", lint: "./ci.sh lint", tsconfigBase: "./tsconfig.base.json", eslintBase: "./eslint.config.base.js" };

const SHIPPED: readonly Shipped[] = [
  { name: "docs", binding: pack(docs, DOCS), params: DOCS },
  { name: "fcis", binding: pack(fcis, FCIS), params: FCIS },
  { name: "flow", binding: pack(flow, FLOW), params: FLOW },
  { name: "git", binding: pack(git, GIT), params: GIT },
  { name: "justfile", binding: pack(justfile, JUSTFILE), params: JUSTFILE },
  { name: "node", binding: pack(node), params: undefined },
  { name: "secrets", binding: pack(secrets, SECRETS), params: SECRETS },
  { name: "tdd", binding: pack(tdd, TDD), params: TDD },
  { name: "typescript", binding: pack(typescript, TYPESCRIPT), params: TYPESCRIPT },
  { name: "work", binding: pack(work), params: undefined },
];

// ── the parser half ──────────────────────────────────────────────────────────

/** What the source says about one pack, over and above what loading it says. */
interface Parsed {
  readonly lead: string;
  /** The `@install` / `@setup` / `@adopt` tags on the pack's own doc comment. */
  readonly blocks: readonly DocBlock[];
  readonly params: readonly ParamDoc[];
  /** Doc comment per entry, by dotted key. */
  readonly why: ReadonlyMap<string, string>;
  /** `.check(…)`'s argument as written, by dotted key. */
  readonly check: ReadonlyMap<string, string>;
}

/** A node's doc comment — the free prose only. The named tags are read by `docTags`. */
function docComment(node: ts.Node): string {
  return ts
    .getJSDocCommentsAndTags(node)
    .flatMap((doc) => (ts.isJSDoc(doc) ? [ts.getTextOfJSDocComment(doc.comment) ?? ""] : []))
    .join("\n")
    .trim();
}

/**
 * The named blocks on a doc comment — `@install`, `@setup`, `@adopt` and nothing else.
 *
 * The tag set is the page's, declared once in tools/domain.ts, so a tag nobody rendered cannot sit
 * in a pack looking like documentation. An unknown tag is left where it is: TypeScript's own
 * `@param` and `@see` are none of this file's business.
 */
function docTags(node: ts.Node): DocBlock[] {
  const known = new Set(DOC_BLOCKS.map((block) => block.tag));
  return ts
    .getJSDocCommentsAndTags(node)
    .flatMap((doc) => (ts.isJSDoc(doc) ? [...(doc.tags ?? [])] : []))
    .flatMap((tag) => {
      const name = tag.tagName.text;
      return known.has(name) ? [{ tag: name, body: (ts.getTextOfJSDocComment(tag.comment) ?? "").trim() }] : [];
    });
}

/**
 * The object literal a `definePack` call states its entries with, through the factory if there is
 * one — and through the factory's BODY when it has one.
 *
 * A parameterised pack that defaults a value writes `(repo) => { const x = repo.x ?? "…"; return
 * {…}; }` rather than `(repo) => ({…})`, and a reader that only understood the second form found no
 * entries at all in those packs: every doc comment and every check name silently missing from the
 * page, with the loaded half still there to make it look complete.
 */
function entriesObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const arg = call.arguments[1];
  if (arg === undefined) return undefined;
  if (ts.isObjectLiteralExpression(arg)) return arg;
  if (!ts.isArrowFunction(arg)) return undefined;
  if (ts.isBlock(arg.body)) {
    const returned = arg.body.statements.find((statement) => ts.isReturnStatement(statement));
    const expression = returned?.expression;
    if (expression === undefined) return undefined;
    const held = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
    return ts.isObjectLiteralExpression(held) ? held : undefined;
  }
  const body = ts.isParenthesizedExpression(arg.body) ? arg.body.expression : arg.body;
  return ts.isObjectLiteralExpression(body) ? body : undefined;
}

/** The name of the interface a parameterised pack's factory takes, if it takes one. */
function paramTypeName(call: ts.CallExpression): string {
  const arg = call.arguments[1];
  if (arg === undefined || !ts.isArrowFunction(arg)) return "";
  const type = arg.parameters[0]?.type;
  return type !== undefined && ts.isTypeReferenceNode(type) ? type.typeName.getText() : "";
}

/**
 * Walk the entry tree, collecting the doc comment and the check expression under each dotted key.
 *
 * The keys are the loader's keys — a nested group contributes `group.entry`, which is exactly the
 * spelling `LoadedEntry.key` carries, so the two halves of the page join with no mapping table.
 */
function walk(obj: ts.ObjectLiteralExpression, prefix: string, why: Map<string, string>, check: Map<string, string>): void {
  for (const property of obj.properties) {
    // A SPREAD is how a pack makes an entry conditional — `...(map ? { entry: … } : {})` — and the
    // entries inside one are entries like any other. Both arms are walked: only one of them is in
    // the loaded pack, and the page joins on the key, so the arm that did not bind contributes
    // nothing.
    if (ts.isSpreadAssignment(property)) {
      // Unwrapped first: the shape is `...(cond ? { … } : {})`, so the spread's own expression is
      // the parentheses, not the conditional inside them.
      const inner = ts.isParenthesizedExpression(property.expression) ? property.expression.expression : property.expression;
      const arms = ts.isConditionalExpression(inner) ? [inner.whenTrue, inner.whenFalse] : [inner];
      for (const arm of arms) {
        const held = ts.isParenthesizedExpression(arm) ? arm.expression : arm;
        if (ts.isObjectLiteralExpression(held)) walk(held, prefix, why, check);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const key = `${prefix}${property.name.getText()}`;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      walk(property.initializer, `${key}.`, why, check);
      continue;
    }
    const doc = docComment(property);
    if (doc !== "") why.set(key, doc);
    // The sentence is a chain of calls, read from the outside in: `.test(…)` wraps `.message(…)`
    // wraps `.check(…)`, so walking down the callee side reaches every verb that was spoken.
    let node: ts.Node = property.initializer;
    while (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "check") {
        const argument = node.arguments[0];
        if (argument !== undefined) check.set(key, argument.getText());
      }
      node = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
    }
  }
}

/** Everything the source of one pack says that loading it cannot. */
function parse(file: string): Parsed {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const why = new Map<string, string>();
  const check = new Map<string, string>();
  let lead = "";
  let wanted = "";
  let tags: DocBlock[] = [];

  ts.forEachChild(source, (node) => {
    if (!ts.isVariableStatement(node)) return;
    const initializer = node.declarationList.declarations[0]?.initializer;
    if (initializer === undefined || !ts.isCallExpression(initializer)) return;
    if (initializer.expression.getText() !== "definePack") return;
    lead = docComment(node);
    tags = docTags(node);
    wanted = paramTypeName(initializer);
    const object = entriesObject(initializer);
    if (object !== undefined) walk(object, "", why, check);
  });

  // The parameter interface is found by NAME, off the factory's own signature — never by taking
  // the file's only interface, because a pack is free to declare others (`Suite` sits beside a
  // private one in more than one of them).
  const params: ParamDoc[] = [];
  if (wanted !== "")
    ts.forEachChild(source, (node) => {
      if (!ts.isInterfaceDeclaration(node) || node.name.text !== wanted) return;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        params.push({ name: member.name.getText(), type: member.type?.getText() ?? "unknown", why: docComment(member) });
      }
    });

  return { lead, blocks: tags, params, why, check };
}

// ── joining the two halves ───────────────────────────────────────────────────

/** The stock check a `.check(…)` argument calls, when it calls one — `canonicalFiles({…})`. */
function checkName(expression: string): string {
  return /^([A-Za-z][A-Za-z0-9]*)\(/.exec(expression)?.[1] ?? "";
}

/** A parameters object as the config line that supplies it. */
function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value !== null && typeof value === "object")
    return `{ ${Object.entries(value)
      .map(([key, held]) => `${key}: ${literal(held)}`)
      .join(", ")} }`;
  return JSON.stringify(value);
}

/** Every case an entry carries, pass side then block side, as the lines a reader scans. */
function caseLines(cases: Cases | undefined): EntryDoc["cases"] {
  const side = (kind: "pass" | "block"): EntryDoc["cases"] =>
    (cases?.[kind] ?? []).map((fact) => ({ kind, line: caseLine(fact as CaseFact), given: caseWorld(fact as CaseFact) }));
  return [...side("pass"), ...side("block")];
}

/** The prose an entry shows — a guardrail's refusal message, or a breadcrumb's text. */
function says(spec: EntrySpec): string {
  return spec.kind === "guardrail" ? (spec.message ?? "") : (spec.text ?? spec.file ?? "");
}

/** One pack, read both ways and joined into the model the page is rendered from. */
function read(shipped: Shipped): PackDoc {
  const parsed = parse(join("packs", `${shipped.name}.ts`));
  const load = loadConfig(defineConfig([shipped.binding]));
  if (!load.ok) throw new Error(`${shipped.name} does not load: ${load.refusals.map((r) => r.detail).join("; ")}`);

  const entries: EntryDoc[] = load.entries.map((entry) => {
    const named = checkName(parsed.check.get(entry.key) ?? "");
    return {
      id: entry.id,
      key: entry.key,
      kind: entry.spec.kind,
      description: entry.spec.description ?? "",
      why: parsed.why.get(entry.key) ?? "",
      at: entry.spec.at ?? [],
      on: entry.spec.on ?? [],
      ignore: entry.spec.ignore ?? [],
      categories: entry.categories,
      settings: settingsJson(entry.settings),
      checkName: named,
      reference: REFERENCED.has(kebab(named)),
      says: says(entry.spec),
      cases: caseLines((entry.spec as GuardrailSpec).test),
      disabled: entry.spec.disabled === undefined ? "" : (entry.spec.disabled.reason ?? "no reason given"),
    };
  });

  return {
    name: shipped.name,
    lead: parsed.lead,
    blocks: parsed.blocks,
    params: parsed.params,
    bind: shipped.params === undefined ? `pack(${shipped.name})` : `pack(${shipped.name}, ${literal(shipped.params)})`,
    entries,
  };
}

// ── writing, and refusing drift ──────────────────────────────────────────────

/** Every page this command owns, by filename — the whole of what `--check` compares. */
function pages(): Map<string, string> {
  const read_ = SHIPPED.map(read);
  const out = new Map<string, string>();
  for (const doc of read_) out.set(`${doc.name}.html`, renderPackPage(doc));
  out.set("index.html", renderPacksIndex(read_));
  return out;
}

const written = pages();
const checking = process.argv.includes("--check");

if (checking) {
  // A MISSING FOLDER IS DRIFT, not a crash: `docs-packs --check` runs at the commit gate, and the
  // one thing it must never do is fail in a way that reads as a broken tool rather than as a page
  // nobody generated.
  const onDisk = new Set(
    existsSync(OUT)
      ? readdirSync(OUT, { withFileTypes: true })
          .filter((f) => f.isFile())
          .map((f) => f.name)
      : [],
  );
  const stale = [...written].filter(([name, html]) => !onDisk.has(name) || readFileSync(join(OUT, name), "utf8") !== html).map(([name]) => name);
  const orphans = [...onDisk].filter((name) => !written.has(name));
  if (stale.length === 0 && orphans.length === 0) {
    process.stdout.write(`docs-packs — ${written.size} pages, all current with packs/\n`);
  } else {
    for (const name of stale) process.stderr.write(`  ✗ ${join(OUT, name)} has drifted from its pack\n`);
    for (const name of orphans) process.stderr.write(`  ✗ ${join(OUT, name)} belongs to no pack\n`);
    process.stderr.write("Run `just docs-packs` and commit the regenerated pages — the pack is the source, the page is the print.\n");
    process.exitCode = 1;
  }
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [name, html] of written) writeFileSync(join(OUT, name), html);
  process.stdout.write(`docs-packs — ${written.size} pages written to ${OUT}/\n`);
}
