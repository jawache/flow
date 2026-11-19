// flow/adapter/hook.test.ts — the hook run every harness shares, against a real disk.

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realPath } from "./hook.ts";

describe("a path made real, as far as it exists", () => {
  it("resolves the links in the part on disk and keeps the missing tail as named", () => {
    // Made real first, so the one link on the way is the test's own, on any platform: macOS
    // reaches its temp folder through a link of its own, and a test leaning on it proves nothing
    // on Linux.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "flow-real-")));
    try {
      mkdirSync(join(dir, "real"));
      symlinkSync(join(dir, "real"), join(dir, "link"));
      expect(realPath(join(dir, "link", "not", "yet.ts"))).toBe(join(dir, "real", "not", "yet.ts"));
      expect(realPath(join(dir, "link"))).toBe(join(dir, "real"));
      expect(realPath(join(dir, "not", "yet.ts")), "nothing to resolve: as named").toBe(join(dir, "not", "yet.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
