import { expect, test } from "vitest";
import { escapeRe, globToRegExp, matchGlob, matchAny, fileParts, expandTemplate } from "./glob.ts";

test("escapeRe neutralises every regex metacharacter", () => {
  expect(escapeRe("a.b*c")).toBe("a\\.b\\*c");
  expect(new RegExp("^" + escapeRe("a+b(c)") + "$").test("a+b(c)")).toBeTruthy();
});

test("globToRegExp: * stays inside a segment, ** crosses separators", () => {
  expect(globToRegExp("src/*.ts").test("src/a.ts")).toBeTruthy();
  expect(!globToRegExp("src/*.ts").test("src/deep/a.ts")).toBeTruthy();
  expect(globToRegExp("src/**/*.ts").test("src/deep/nested/a.ts")).toBeTruthy();
  // `**/` collapses, so the glob also matches a file directly under src/.
  expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBeTruthy();
});

test("globToRegExp: ? matches one non-separator character", () => {
  expect(globToRegExp("a?.ts").test("ab.ts")).toBeTruthy();
  expect(!globToRegExp("a?.ts").test("a/.ts")).toBeTruthy();
});

test("globToRegExp: {a,b} alternation — the brace support that makes this THE glob engine", () => {
  const re = globToRegExp("**/*.{ts,tsx,mts}");
  expect(re.test("src/a.ts")).toBeTruthy();
  expect(re.test("src/a.tsx")).toBeTruthy();
  expect(re.test("deep/nested/a.mts")).toBeTruthy();
  expect(!re.test("src/a.js")).toBeTruthy();
});

test("matchGlob answers one glob; matchAny answers a list", () => {
  expect(matchGlob("package.json", "package.json")).toBe(true);
  expect(matchGlob("src/a.ts", "**/*.md")).toBe(false);
  expect(matchAny("src/a.ts", ["**/*.md", "**/*.ts"])).toBe(true);
  expect(matchAny("src/a.ts", ["**/*.md"])).toBe(false);
});

test("matchAny treats a missing glob list as matching nothing", () => {
  expect(matchAny("src/a.ts", null)).toBe(false);
  expect(matchAny("src/a.ts", undefined)).toBe(false);
  expect(matchAny("src/a.ts", [])).toBe(false);
});

test("fileParts splits a path into dir/base/name/path", () => {
  expect(fileParts("a/b/x.ts")).toStrictEqual({ dir: "a/b", base: "x.ts", name: "x", path: "a/b/x" });
});

test("fileParts: a bare filename has dir '.' and path === name", () => {
  expect(fileParts("x.ts")).toStrictEqual({ dir: ".", base: "x.ts", name: "x", path: "x" });
});

test("fileParts: a dotfile keeps its whole name (the leading dot is not an extension)", () => {
  expect(fileParts(".gitignore")).toStrictEqual({ dir: ".", base: ".gitignore", name: ".gitignore", path: ".gitignore" });
});

test("expandTemplate fills {dir} {name} {base} {path}", () => {
  expect(expandTemplate("{dir}/{name}.test.ts", "a/b/x.ts")).toBe("a/b/x.test.ts");
  expect(expandTemplate("{base}", "a/b/x.ts")).toBe("x.ts");
  expect(expandTemplate("{path}.snap", "a/b/x.ts")).toBe("a/b/x.snap");
});

// The sign selector's cases, moved here when its second glob implementation was deleted: one
// engine now answers both, so these are the same assertions with the arguments the other way up.
test("matchGlob: **/ spans zero or more directories — the flat-file fix, now on the one engine", () => {
  expect(matchGlob("src/content/writing/a.md", "src/content/**/*.md")).toBe(true);
  expect(matchGlob("src/content/talks/a.mdx", "src/content/talks/**/*.mdx")).toBe(true);
  expect(matchGlob("src/content/a/b/c.md", "src/content/**/*.md")).toBe(true);
  expect(matchGlob("src/content/a/c.mdx", "src/content/**/*.md")).toBe(false);
  expect(matchGlob("src/lib/x/y.ts", "src/lib/**")).toBe(true);
  expect(matchGlob("work.yaml", "work.yaml")).toBe(true);
});
