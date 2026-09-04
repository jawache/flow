// flow/adapter/claude.test.ts — the live World, against a real disk and a real git repo.
//
// This is the half of the adapter that cannot be a unit test of a decision, because there is no
// decision in it: it runs commands, opens files and asks git. So it is proved the way the other
// shell in this package is — over a temp repo, asserting what actually comes back.
//
// Three things here are load-bearing and were, until this file, asserted by nothing:
//
//   THE 127 ANSWER      a missing binary must come back as `{ code: 127 }` and never as a throw.
//                       The engine's whole fail-loud proof for a bound command that does not exist
//                       is a test against a RECORDED 127; if the live exec threw instead, that
//                       proof would be about a world flow does not have.
//   THE HERMETIC ENV    the gate runs inside git's pre-commit hook, so a check that shells out
//                       inherits GIT_INDEX_FILE and friends — and any nested `git` then aims at the
//                       in-progress commit.
//   THE BRANCH READ     a linked worktree's `.git` is a FILE naming the real gitdir. Miss the
//                       indirection and every worktree reports the main checkout's branch, which is
//                       exactly the collision the marker's naming scheme exists to prevent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentBranch, loadRegime, projectRoot, readText, realWorld, runCommand } from "./claude.ts";

let repo: string;

const git = (...args: string[]): void => {
  spawnSync("git", args, { cwd: repo });
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "flow-world-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("ctx.exec, live", () => {
  it("runs in the repo and answers with stdout, stderr and the exit code", () => {
    writeFileSync(join(repo, "here.txt"), "yes");
    expect(runCommand("cat here.txt", repo)).toStrictEqual({ stdout: "yes", stderr: "", code: 0 });
    expect(runCommand("exit 3", repo).code).toBe(3);
  });

  it("answers a MISSING BINARY with 127 rather than throwing — the fail-loud proof stands on it", () => {
    // A bound command that does not exist must refuse the rail, not sail through it. The engine
    // turns a non-zero exit into a block naming the entry and the command; a throw here would be
    // swallowed as "the check threw" and the reason would be lost.
    const missing = runCommand("definitely-not-a-real-binary-xyz --version", repo);
    expect(missing.code).toBe(127);
    expect(missing.stderr.toLowerCase()).toContain("command not found");
  });

  it("strips git's hook plumbing, so a tool it runs cannot touch the in-progress commit", () => {
    process.env["GIT_INDEX_FILE"] = "/somewhere/.git/index";
    process.env["FLOW_TEST_KEEP"] = "kept";
    try {
      const seen = runCommand('echo "${GIT_INDEX_FILE:-stripped} ${FLOW_TEST_KEEP:-lost}"', repo);
      expect(seen.stdout.trim()).toBe("stripped kept");
    } finally {
      delete process.env["GIT_INDEX_FILE"];
      delete process.env["FLOW_TEST_KEEP"];
    }
  });
});

describe("ctx.fs and ctx.git, live", () => {
  it("reads a file by its repo-relative name, and says honestly when there is none", async () => {
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    const world = realWorld(repo);
    expect(await world.fs.exists("a.ts")).toBe(true);
    expect(await world.fs.exists("nope.ts")).toBe(false);
    expect(await world.fs.read("a.ts")).toBe("export const a = 1;\n");
    expect(readText(repo, "nope.ts")).toBeNull();
    expect(readText(repo, join(repo, "a.ts")), "an absolute path is already absolute").toBe("export const a = 1;\n");
  });

  it("asks git in PATH LISTS — the answer needs no format knowledge, so no parser exists", async () => {
    writeFileSync(join(repo, "a.ts"), "one\n");
    writeFileSync(join(repo, "b.ts"), "two\n");
    git("add", "a.ts", "b.ts");
    const world = realWorld(repo);
    expect(await world.git.stagedFiles()).toStrictEqual(["a.ts", "b.ts"]);
    git("commit", "-qm", "first");
    writeFileSync(join(repo, "a.ts"), "one changed\n");
    expect(await world.git.diff("a.ts")).toContain("one changed");
    expect(await world.git.stagedFiles(), "nothing staged is an empty list, not an error").toStrictEqual([]);
  });
});

describe("which branch this checkout has out", () => {
  it("reads it from HEAD, before there is any commit to rev-parse", () => {
    // An unborn branch is every repo's own first commit, and `git rev-parse HEAD` fails outright
    // there — which would leave the very first marker keyed on no branch at all.
    expect(currentBranch(repo)).toBe("main");
  });

  it("follows a LINKED WORKTREE's .git file to its own gitdir, not the main checkout's", () => {
    writeFileSync(join(repo, "a.ts"), "one\n");
    git("add", "a.ts");
    git("commit", "-qm", "first");
    const linked = join(repo, "..", `wt-${Date.now()}`);
    spawnSync("git", ["worktree", "add", "-q", "-b", "side", linked], { cwd: repo });
    try {
      expect(currentBranch(linked), "a worktree IS a branch — the marker is keyed on it").toBe("side");
      expect(currentBranch(repo)).toBe("main");
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", linked], { cwd: repo });
      rmSync(linked, { recursive: true, force: true });
    }
  });

  it("answers null outside a git repo rather than throwing", () => {
    const bare = mkdtempSync(join(tmpdir(), "flow-nogit-"));
    expect(currentBranch(bare)).toBeNull();
    rmSync(bare, { recursive: true, force: true });
  });
});

describe("which repo, and what it has turned on", () => {
  it("prefers the host's own project directory over the hook's cwd", () => {
    process.env["CLAUDE_PROJECT_DIR"] = "/the/project";
    try {
      expect(projectRoot("/somewhere/else")).toBe("/the/project");
    } finally {
      delete process.env["CLAUDE_PROJECT_DIR"];
    }
    expect(projectRoot("/somewhere/else")).toBe("/somewhere/else");
  });

  // One config per test, because each gets its own repo and therefore its own path: node caches a
  // module by URL, so re-writing one file and importing it again in the same process answers with
  // the first version. It never matters live — a hook is one process, one import — but a test that
  // wrote three configs to one path would be asserting the loader's cache, not the loader.

  it("says nothing at all about a repo that has never heard of flow", async () => {
    expect((await loadRegime(repo)).kind).toBe("none");
  });

  it("calls a config that will not import BROKEN, carrying the reason", async () => {
    writeFileSync(join(repo, "flow.config.ts"), "this is not typescript(((\n");
    const regime = await loadRegime(repo);
    expect(regime.kind).toBe("broken");
    if (regime.kind === "broken") expect(regime.message).toContain("could not be loaded");
  });

  it("calls a module that exports the wrong thing broken, not loaded", async () => {
    writeFileSync(join(repo, "flow.config.ts"), "export default { nothing: true };\n");
    const regime = await loadRegime(repo);
    expect(regime.kind).toBe("broken");
    if (regime.kind === "broken") expect(regime.message).toContain("defineConfig");
  });

  it("loads a real config into a regime the engine can run", async () => {
    const door = new URL("../index.ts", import.meta.url).pathname;
    writeFileSync(
      join(repo, "flow.config.ts"),
      `import { defineConfig } from ${JSON.stringify(door)};\nexport default defineConfig([]);\n`,
    );
    const regime = await loadRegime(repo);
    expect(regime.kind).toBe("loaded");
    if (regime.kind === "loaded") expect(regime.load.ok).toBe(true);
  });
});
