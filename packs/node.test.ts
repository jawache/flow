// flow/packs/node.test.ts — the pure helper this pack's lockfile rule is built from.
//
// The rule's own cases prove the rule; what they cannot reach is the COMPARISON. `movedDependencies`
// is handed two whole package.json texts and answers which dependency entries differ, and the
// answers that matter are the ones a case never sees: a metadata edit that moved no dependency, a
// brand-new file with no other side, and a file that is not parseable JSON on one side of the
// commit. The first of those is the recorded fault — the file-keyed version of this rule blocked a
// `repository.url` fix on 2026-08-13, which is why the check is keyed on the dependency BLOCKS.

import { describe, it, expect } from "vitest";
import { movedDependencies } from "./node.ts";

const pkg = (o: Record<string, unknown>): string => JSON.stringify(o, null, 2);

describe("movedDependencies", () => {
  it("names a dependency added, removed, or moved to a different version", () => {
    expect(movedDependencies(pkg({ dependencies: {} }), pkg({ dependencies: { zod: "^3.0.0" } }))).toEqual(["zod"]);
    expect(movedDependencies(pkg({ dependencies: { zod: "^3.0.0" } }), pkg({ dependencies: {} }))).toEqual(["zod"]);
    expect(movedDependencies(pkg({ dependencies: { zod: "^3.0.0" } }), pkg({ dependencies: { zod: "^4.0.0" } }))).toEqual([
      "zod",
    ]);
  });

  // THE RECORDED FAULT, and the whole reason this is keyed on the blocks rather than on the file:
  // a metadata edit moves no lockfile, and the file-keyed rule blocked exactly that commit.
  it("says nothing about an edit that touched no dependency block", () => {
    const before = pkg({ name: "flow", repository: { url: "old" }, dependencies: { zod: "^3.0.0" } });
    const after = pkg({ name: "flow", repository: { url: "new" }, dependencies: { zod: "^3.0.0" } });
    expect(movedDependencies(before, after)).toEqual([]);
  });

  it("reads all four dependency blocks, and reports each name once however many it moved in", () => {
    const before = pkg({ dependencies: { a: "1" }, devDependencies: { b: "1" } });
    const after = pkg({
      dependencies: { a: "2" },
      devDependencies: { b: "1" },
      peerDependencies: { c: "1" },
      optionalDependencies: { d: "1" },
    });
    expect(movedDependencies(before, after).sort()).toEqual(["a", "c", "d"]);
  });

  it("reads a name moved BETWEEN blocks as moved, since the lockfile has to follow it", () => {
    const before = pkg({ dependencies: { zod: "^3.0.0" } });
    const after = pkg({ devDependencies: { zod: "^3.0.0" } });
    expect(movedDependencies(before, after)).toEqual(["zod"]);
  });

  it("reads an empty side as a file that did not exist — every dependency on the other side is new", () => {
    expect(movedDependencies("", pkg({ dependencies: { zod: "^3.0.0" } }))).toEqual(["zod"]);
    expect(movedDependencies("   ", pkg({}))).toEqual([]);
  });

  // A file being reshaped into something else is a change we cannot rule out, so it asks rather
  // than staying silent — and it says so in the one string it returns, because a hit that reads as
  // a dependency name would send the reader looking for a package that does not exist.
  it("asks, in as many words, when one side is not parseable JSON", () => {
    const hits = movedDependencies("{ this is not json", pkg({ dependencies: { zod: "^3" } }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("not parseable JSON");
  });
});
