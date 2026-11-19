export declare function escapeRe(s: string): string;
/**
 * Is that a REGULAR EXPRESSION where this dialect wants a glob?
 *
 * It lives beside `escapeRe` because it is that function read backwards: these are the shapes
 * `escapeRe` turns into literals, which is how a pattern written as a regex comes to match nothing
 * at all while reading as a fence. Four of them — a leading `^`, a `(?` group, a `|`, a trailing `$`
 * — and nothing broader is claimed: this is not a regex detector, it is the list of characters whose
 * meaning is silently lost here.
 *
 * ANY `|` COUNTS, with no carve-out for a backslash before it. The dialect has no escape character:
 * `\|` is a literal backslash followed by a pipe, and a path with either in it is not a path anyone
 * has. A carve-out would only ever wave through the thing it was meant to catch.
 *
 * It was found the hard way — a repo's fence, brought across from an engine whose layers WERE
 * regexes, loaded green and refused nothing for a week.
 */
export declare function notAGlob(entry: string): boolean;
/** One piece of a glob. The whole dialect: `**` · `*` · `?` · `{a,b}` · literal text. */
export type GlobToken = {
    readonly kind: "literal";
    readonly text: string;
}
/** `*` — anything within one path segment. */
 | {
    readonly kind: "star";
}
/** `**` — anything, across segments. Consumes a `/` immediately after it. */
 | {
    readonly kind: "globstar";
}
/** `?` — exactly one character, not a separator. */
 | {
    readonly kind: "single";
}
/** `{a,b}` — one of these literals. */
 | {
    readonly kind: "options";
    readonly options: readonly string[];
};
/**
 * Read a glob as tokens.
 *
 * An UNCLOSED `{` is a literal brace rather than an error or a swallowed rest-of-string. It cannot
 * throw (this is a pure home) and refusing would mean every caller needs a failure path for a glob
 * that is almost certainly just a brace in a filename; reading it literally is what the shell does
 * too.
 */
export declare function tokenizeGlob(glob: string): GlobToken[];
/**
 * One token → its regex source.
 *
 * Every construct emits something with NO quantifier of its own beyond a bare `.*` or `[^/]*`, and
 * an alternation carries none at all — which is what keeps the output inside dependency-cruiser's
 * ReDoS guard (it rejects grouped and nested quantifiers, never a plain group). The two emitters
 * differ only in how they anchor the whole string, never in what a token means.
 */
export declare function globTokenToRegExp(token: GlobToken): string;
/** A glob → an anchored RegExp. Supports `**` (across /), `*` (within a segment), `?`, `{a,b}`. */
export declare function globToRegExp(glob: string): RegExp;
export declare function matchGlob(path: string, glob: string): boolean;
export declare function matchAny(path: string, globs: readonly string[] | null | undefined): boolean;
export interface FileParts {
    dir: string;
    base: string;
    name: string;
    path: string;
}
export declare function fileParts(file: string): FileParts;
export declare function expandTemplate(tpl: string, file: string): string;
