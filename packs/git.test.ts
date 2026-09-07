// flow/packs/git.test.ts — the pure helpers this pack's three git checks are built from.
//
// THE PACK'S RULES ARE NOT TESTED HERE. Every entry in `git.ts` carries its own
// `.test({ pass, block })` cases and `flow test` drives them through the same ctx the live rails
// build; a second suite over the same claims would be a second place for them to be right.
//
// What a case cannot reach is the INSIDE of a helper. A case drives one command through one check
// and reads one verdict, so the shapes that never reach a verdict — the restore form that touches
// nothing, the version line that was only reformatted, the release header that ought to be allowed
// and was not — are invisible to it. Each `it` below is one of those, and two of them are recorded
// faults: a `chore:` with no release scope was licensed to hand-edit the version for months, and
// `release(scope)!:` was documented as legal while the expression refused it.

import { describe, it, expect } from "vitest";
import { changesVersion, discardPaths, dirtyIn, isConventional, isReleaseCommit } from "./git.ts";

describe("discardPaths", () => {
  it("says nothing about a command that destroys nothing", () => {
    expect(discardPaths("git status")).toEqual([]);
    expect(discardPaths("git checkout main")).toEqual([]); // branch switching, not a pathspec
    expect(discardPaths("ls -la")).toEqual([]);
  });

  it("reads the -- pathspec form of checkout, and only that form", () => {
    expect(discardPaths("git checkout -- src/a.ts src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(discardPaths("git checkout feature-branch")).toEqual([]);
  });

  it("treats `restore --staged` alone as touching no working tree", () => {
    expect(discardPaths("git restore --staged a.ts")).toEqual([]);
    // …but --staged AND --worktree does overwrite the tree.
    expect(discardPaths("git restore --staged --worktree a.ts")).toEqual(["a.ts"]);
    expect(discardPaths("git restore a.ts")).toEqual(["a.ts"]);
  });

  it("skips restore's -s/--source VALUE, which is a commit and never a path", () => {
    expect(discardPaths("git restore -s HEAD~2 a.ts")).toEqual(["a.ts"]);
    expect(discardPaths("git restore --source main a.ts")).toEqual(["a.ts"]);
  });

  it("reads `reset --hard` as the whole tree, since it has no pathspec form that discards", () => {
    expect(discardPaths("git reset --hard")).toEqual(["."]);
    expect(discardPaths("git reset --soft HEAD~1")).toEqual([]);
  });

  it("reads clean's force flags, bundled or long, and defaults to the whole tree", () => {
    expect(discardPaths("git clean -fd")).toEqual(["."]);
    expect(discardPaths("git clean --force src/")).toEqual(["src/"]);
    expect(discardPaths("git clean -n")).toEqual([]); // a dry run destroys nothing
  });

  it("reads every invocation on the line, because a newline separates commands too", () => {
    expect(discardPaths("git status\ngit checkout -- a.ts")).toEqual(["a.ts"]);
    expect(discardPaths("git checkout -- a.ts && git reset --hard")).toEqual(["a.ts", "."]);
  });
});

describe("dirtyIn", () => {
  const porcelain = [" M tracked.ts", "?? untracked.ts", "A  staged.ts"].join("\n");

  it("reads the paths out of porcelain lines, tracked work only by default", () => {
    expect(dirtyIn(porcelain, false)).toEqual(["tracked.ts", "staged.ts"]);
  });

  // `git clean` exists to delete untracked files, so for it the untracked half IS the loss.
  // Everywhere else those files survive the command and counting them blocks a safe one.
  it("counts untracked files too when the command is a clean", () => {
    expect(dirtyIn(porcelain, true)).toEqual(["tracked.ts", "untracked.ts", "staged.ts"]);
  });

  it("says nothing about a clean tree", () => {
    expect(dirtyIn("", false)).toEqual([]);
  });
});

describe("isConventional", () => {
  it("accepts a header with a type from the given set, with or without a scope or a bang", () => {
    const types = ["feat", "fix"];
    expect(isConventional("feat: a thing", types)).toBe(true);
    expect(isConventional("fix(cli): a thing", types)).toBe(true);
    expect(isConventional("feat(cli)!: a thing", types)).toBe(true);
  });

  it("refuses a type outside the set, a missing description, and a missing colon", () => {
    const types = ["feat", "fix"];
    expect(isConventional("chore: a thing", types)).toBe(false);
    expect(isConventional("feat:", types)).toBe(false);
    expect(isConventional("feat a thing", types)).toBe(false);
  });

  it("judges the FIRST line, because the body is prose and may say anything", () => {
    expect(isConventional("feat: a thing\n\nnot a header at all", ["feat"])).toBe(true);
    expect(isConventional("not a header\n\nfeat: a thing", ["feat"])).toBe(false);
  });

  it("escapes the type words, so one carrying a metacharacter matches only itself", () => {
    expect(isConventional("a.c: x", ["a.c"])).toBe(true);
    expect(isConventional("abc: x", ["a.c"])).toBe(false);
  });
});

describe("isReleaseCommit", () => {
  it("accepts the release shapes, scope or no scope, bang or no bang", () => {
    expect(isReleaseCommit("release: 1.2.3")).toBe(true);
    expect(isReleaseCommit("release(flow): 1.2.3")).toBe(true);
    expect(isReleaseCommit("release(flow)!: 2.0.0")).toBe(true);
    expect(isReleaseCommit("chore(release): 1.2.3")).toBe(true);
  });

  // THE HOLE. The scope group was optional on both alternatives, so a bare `chore:` matched — and
  // every `chore: tidy the readme` in a repo's history was licensed to hand-edit the version, which
  // is the one thing this predicate exists to refuse.
  it("refuses a bare chore, which is not a release however it is worded", () => {
    expect(isReleaseCommit("chore: tidy the readme")).toBe(false);
    expect(isReleaseCommit("chore(deps): bump")).toBe(false);
  });

  // THE LIE. `release(scope)!:` was documented as legal and could not match, because the scope
  // group demanded the word "release" inside its own parentheses.
  it("accepts a scoped release naming the package rather than the word release", () => {
    expect(isReleaseCommit("release(work): 0.4.0")).toBe(true);
  });

  it("judges the first line only, and reads the type case-insensitively", () => {
    expect(isReleaseCommit("Release: 1.0.0")).toBe(true);
    expect(isReleaseCommit("feat: x\n\nrelease: 1.0.0")).toBe(false);
  });
});

describe("changesVersion", () => {
  const diff = (...lines: string[]): string => lines.join("\n");

  it("sees a version VALUE change, in JSON and in TOML alike", () => {
    expect(changesVersion(diff('-  "version": "1.2.3"', '+  "version": "1.2.4"'))).toBe(true);
    expect(changesVersion(diff('-version = "1.2.3"', '+version = "1.2.4"'))).toBe(true);
  });

  // Adding a key after the version rewrites its line — it gains a comma — and a rule that fired on
  // every reformat is a rule whose message people stop reading.
  it("says nothing when the value on both sides is the same, however the line moved", () => {
    expect(changesVersion(diff('-  "version": "1.2.3"', '+  "version": "1.2.3",'))).toBe(false);
  });

  it("says nothing about a diff that never mentions a version", () => {
    expect(changesVersion(diff('-  "name": "a"', '+  "name": "b"'))).toBe(false);
  });

  it("ignores the +++ / --- headers, which are filenames rather than lines of the file", () => {
    expect(changesVersion(diff('+++ b/version = "9.9.9"', '--- a/x'))).toBe(false);
  });

  it("catches a version ADDED where there was none", () => {
    expect(changesVersion(diff('+  "version": "0.1.0"'))).toBe(true);
  });

  it("reads a prerelease suffix as part of the value", () => {
    expect(changesVersion(diff('-  "version": "1.0.0"', '+  "version": "1.0.0-rc.1"'))).toBe(true);
  });
});
