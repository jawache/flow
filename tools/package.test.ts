// flow/tools/package.test.ts — every page the npm package ships, followed from inside the package.
//
// tools/pages.test.ts follows every link in the REPO, and it was green while 0.3.0 shipped broken:
// the migration guides tell an agent to follow them from node_modules, and their links led into
// ../checks/ and ../reference/, which the repo has and the package's `files` allowlist left out
// (#144). So this asks npm itself what it would upload — `npm pack --dry-run`, the same list
// `just release-check` prints — and follows every link in every shipped page against that list.
// It runs in the whole suite, so the commit gate and `just release-check` both refuse a release
// whose pages link to a file the package leaves out. The checker's own cases, the planted link
// among them, are in domain.test.ts.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packedFiles, unshippedLinks } from "./domain.ts";

const PACKAGE = resolve(import.meta.dirname, "..");

describe("the npm package — every page it ships, as an agent follows it from node_modules", () => {
  // --ignore-scripts: what is asked is the file list, and nothing a lifecycle script might do.
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PACKAGE, encoding: "utf8" });
  const shipped = packedFiles(pack.stdout);

  it("lists what npm would upload", () => {
    expect(pack.status, pack.stderr).toBe(0);
    expect(shipped).toEqual(expect.arrayContaining(["CHANGELOG.md", "docs/user/checks/ban-commands.md", "docs/user/reference/ctx.md", "docs/user/migrations/index.md"]));
  });

  it("has no shipped page linking to a file the package leaves out", () => {
    expect(pack.status, pack.stderr).toBe(0);
    expect(shipped.filter((file) => file.endsWith(".md")).length).toBeGreaterThan(20);
    const faults = unshippedLinks(shipped, (page) => readFileSync(join(PACKAGE, page), "utf8"));
    expect(faults, `a shipped page links to a file the package leaves out:\n  ${faults.join("\n  ")}`).toStrictEqual([]);
  });
});
