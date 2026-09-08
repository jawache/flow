// flow/tools/parse.ts — the half of a pack that loading it cannot answer, read off the source.
//
// A loaded pack carries everything the engine runs on. It does NOT carry the two things a reader
// needs most: the DOC COMMENTS (the pack's lead, what each parameter is, why each entry exists) and
// the NAME of the check an entry asks, which by the time it is loaded is an anonymous closure. Both
// are in the file, so both are read with the TypeScript compiler API.
//
// SPLIT OUT OF THE GENERATOR so it can be driven by fixture rather than by regenerating ten pages
// and reading them: `parseSource` takes a name and the text, which is the whole of what the AST
// walk needs, and `parse` is the one line of disk around it. The shapes below are subtle — a
// factory with a body, a conditional spread — and each of them has already been wrong once.

import { readFileSync } from "node:fs";
import ts from "typescript";
import { DOC_BLOCKS, type DocBlock, type ParamDoc } from "./domain.ts";

/** What the source says about one pack, over and above what loading it says. */
export interface Parsed {
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
 * One tag's body, read off the SOURCE with the comment gutter taken away — `@setup ` and the
 * leading ` * ` of every line after it, and nothing else.
 *
 * TypeScript's own `getTextOfJSDocComment` gives the words back with the leading whitespace of
 * every line thrown away. For prose that is invisible; for the one thing a named block now carries
 * — a file the reader is meant to copy, inside a fence — it is the difference between a config
 * somebody can paste and a flat wall of JSON. So the gutter is stripped here, one space after the
 * asterisk, and every space beyond it is the author's.
 */
function tagBody(tag: ts.JSDocTag): string {
  return tag
    .getText()
    .replace(/^@\w+[ \t]*/, "")
    .split("\n")
    .map((held) => held.replace(/^[ \t]*\*[ \t]?/, ""))
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
      return known.has(name) ? [{ tag: name, body: tagBody(tag) }] : [];
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
export function entriesObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
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
export function walk(obj: ts.ObjectLiteralExpression, prefix: string, why: Map<string, string>, check: Map<string, string>): void {
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

/** Everything the source of one pack says that loading it cannot, from the text of the file. */
export function parseSource(file: string, text: string): Parsed {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
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

/** The same, off disk. */
export function parse(file: string): Parsed {
  return parseSource(file, readFileSync(file, "utf8"));
}
