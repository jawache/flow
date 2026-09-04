// flow/glob.ts — THE one shared file, and the only thing in flow that sits outside a layer.
//
//   globToRegExp / matchGlob  — match an entry's `.on()` / `.ignore()` globs against a path.
//   matchAny                  — the same, over a list.
//   expandTemplate            — fill {dir} {name} {base} {path} in a sibling template.
//   escapeRe                  — regex-escape a literal.
//
// WHY IT IS NOT IN A LAYER, when every other decision in this package lives in some layer's
// domain.ts. Three of the four stages genuinely need it and need the SAME one: the checks match
// a file against a sibling template and a changed-set glob; the engine matches an event's path
// against an entry's scope; and the load will one day want to say a glob is malformed. A glob
// that means one thing to a check and another to the engine is a rule that reports on files it
// never judged, which is precisely the class of failure flow exists to delete — so there is one
// engine and it sits above all of them, where the pipeline's one-way fences do not apply because
// it points at nothing.
//
// It is the ONLY file with that status, and the bar for a second one is a second thing that three
// layers must agree on exactly. Everything else that looked shared turned out to be one layer's
// business borrowed by another.
//
// Ported verbatim from signposts' src/util.mjs, by way of the old guard engine — the
// brace-supporting matcher, unchanged, because every glob already written against it must keep
// meaning what it meant.

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── the dialect, parsed once ─────────────────────────────────────────────────
//
// ONE PARSER, TWO EMITTERS, and the split exists because of a bug it now makes impossible.
//
// The depcruise check compiles a layer's globs into dependency-cruiser's own regex schema, which
// is a different TARGET from the RegExp `matchGlob` builds — it must avoid grouped quantifiers
// that trip the tool's ReDoS guard, and a trailing `**` has to leave the end unanchored. That was
// reason enough for it to grow a second glob translator, and the second translator did not speak
// the whole dialect: it escaped `{` and `}` into literals, so a perfectly ordinary layer glob like
// `src/**/*.{ts,tsx}` compiled to a fence matching NOTHING, quietly, and reported healthy. That is
// the exact failure this package exists to delete, reborn inside the code meant to kill it.
//
// So the dialect is TOKENISED here, once, and both callers emit from the same tokens. A construct
// either has a token — in which case every emitter must map it — or it is not in the dialect at
// all. There is nowhere left for a silent divergence to live.

/** One piece of a glob. The whole dialect: `**` · `*` · `?` · `{a,b}` · literal text. */
export type GlobToken =
  | { readonly kind: "literal"; readonly text: string }
  /** `*` — anything within one path segment. */
  | { readonly kind: "star" }
  /** `**` — anything, across segments. Consumes a `/` immediately after it. */
  | { readonly kind: "globstar" }
  /** `?` — exactly one character, not a separator. */
  | { readonly kind: "single" }
  /** `{a,b}` — one of these literals. */
  | { readonly kind: "options"; readonly options: readonly string[] };

/**
 * Read a glob as tokens.
 *
 * An UNCLOSED `{` is a literal brace rather than an error or a swallowed rest-of-string. It cannot
 * throw (this is a pure home) and refusing would mean every caller needs a failure path for a glob
 * that is almost certainly just a brace in a filename; reading it literally is what the shell does
 * too.
 */
export function tokenizeGlob(glob: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let literal = "";
  const flush = (): void => {
    if (literal !== "") tokens.push({ kind: "literal", text: literal });
    literal = "";
  };
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      flush();
      if (glob[i + 1] === "*") {
        tokens.push({ kind: "globstar" });
        i++;
        // `**/` is one token: the separator belongs to the wildcard, or `a/**/b` would demand the
        // slash a `**` matching nothing cannot supply.
        if (glob[i + 1] === "/") i++;
      } else tokens.push({ kind: "star" });
    } else if (c === "?") {
      flush();
      tokens.push({ kind: "single" });
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        literal += c;
        continue;
      }
      flush();
      tokens.push({ kind: "options", options: glob.slice(i + 1, end).split(",") });
      i = end;
    } else literal += c ?? "";
  }
  flush();
  return tokens;
}

/**
 * One token → its regex source.
 *
 * Every construct emits something with NO quantifier of its own beyond a bare `.*` or `[^/]*`, and
 * an alternation carries none at all — which is what keeps the output inside dependency-cruiser's
 * ReDoS guard (it rejects grouped and nested quantifiers, never a plain group). The two emitters
 * differ only in how they anchor the whole string, never in what a token means.
 */
export function globTokenToRegExp(token: GlobToken): string {
  switch (token.kind) {
    case "literal":
      return escapeRe(token.text);
    case "star":
      return "[^/]*";
    case "globstar":
      return ".*";
    case "single":
      return "[^/]";
    case "options":
      return `(${token.options.map(escapeRe).join("|")})`;
  }
}

/** A glob → an anchored RegExp. Supports `**` (across /), `*` (within a segment), `?`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${tokenizeGlob(glob).map(globTokenToRegExp).join("")}$`);
}

export function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchAny(path: string, globs: readonly string[] | null | undefined): boolean {
  return (globs || []).some((g) => matchGlob(path, g));
}

export interface FileParts {
  dir: string;
  base: string;
  name: string;
  path: string;
}

// file "a/b/x.ts" → {dir:"a/b", base:"x.ts", name:"x", path:"a/b/x"}
export function fileParts(file: string): FileParts {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const name = dot > 0 ? base.slice(0, dot) : base;
  const path = dir === "." ? name : `${dir}/${name}`;
  return { dir, base, name, path };
}

export function expandTemplate(tpl: string, file: string): string {
  const p = fileParts(file);
  return tpl.replace(/\{(dir|base|name|path)\}/g, (_, k: string) => p[k as keyof FileParts]);
}
