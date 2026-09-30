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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  currentBranch,
  forgetSnapshot,
  loadRegime,
  observeDelta,
  projectRoot,
  readText,
  realWorld,
  revertChanges,
  runCommand,
  takeSnapshot,
} from "./claude.ts";

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

describe("the snapshot — the tree before a call, the tree after it, and the way back", () => {
  const who = { session: "s1", agent: "main", tool: "Bash" };
  const read = (path: string): string | null => readText(repo, path);
  const indexBytes = (): Buffer => readFileSync(join(repo, ".git", "index"));

  beforeEach(() => {
    writeFileSync(join(repo, ".gitignore"), ".env\nsecret.key\nbuild/\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "gone.ts"), "export const gone = 1;\n");
    writeFileSync(join(repo, "untracked.ts"), "not yet added\n");
    writeFileSync(join(repo, ".env"), "TOKEN=old\n");
    writeFileSync(join(repo, "secret.key"), "old key\n");
    git("add", ".gitignore", "a.ts", "gone.ts");
    git("commit", "-qm", "first");
    writeFileSync(join(repo, "a.ts"), "export const a = 2; // staged\n");
    git("add", "a.ts");
  });

  it("sees a changed, a created and a deleted file, with the content either side", () => {
    takeSnapshot(repo, "toolu_1", [], who);
    writeFileSync(join(repo, "a.ts"), "export const a = 3; // TODO\n");
    writeFileSync(join(repo, "new.ts"), "fresh\n");
    unlinkSync(join(repo, "gone.ts"));
    const delta = observeDelta(repo, "toolu_1", []);
    expect(delta.ok).toBe(true);
    if (!delta.ok) return;
    expect(delta.changes).toStrictEqual([
      { path: "a.ts", before: "export const a = 2; // staged\n", after: "export const a = 3; // TODO\n" },
      { path: "gone.ts", before: "export const gone = 1;\n", after: null },
      { path: "new.ts", before: null, after: "fresh\n" },
    ]);
  });

  it("puts every kind of change back byte for byte, and never writes the user's index", () => {
    const staged = indexBytes();
    takeSnapshot(repo, "toolu_2", [], who);
    expect(indexBytes(), "the snapshot is built in a throwaway index").toStrictEqual(staged);
    writeFileSync(join(repo, "a.ts"), "export const a = 3; // TODO\n");
    writeFileSync(join(repo, "untracked.ts"), "changed while untracked\n");
    writeFileSync(join(repo, "new.ts"), "fresh\n");
    unlinkSync(join(repo, "gone.ts"));
    const delta = observeDelta(repo, "toolu_2", []);
    if (!delta.ok) throw new Error(delta.fault);
    expect(revertChanges(repo, delta.before ?? "", delta.changes)).toStrictEqual([]);
    expect(read("a.ts"), "back to the staged content the tree held, not HEAD's").toBe("export const a = 2; // staged\n");
    expect(read("untracked.ts")).toBe("not yet added\n");
    expect(read("gone.ts")).toBe("export const gone = 1;\n");
    expect(existsSync(join(repo, "new.ts")), "a file the call created is removed").toBe(false);
    expect(indexBytes(), "the staging area is exactly as the user left it").toStrictEqual(staged);
    const after = observeDelta(repo, "toolu_2", []);
    expect(after.ok && after.changes, "the tree is the snapshot again").toStrictEqual([]);
  });

  it("records an ignored file snapshotInclude lists, and leaves out one it does not", () => {
    takeSnapshot(repo, "toolu_3", [".env"], who);
    writeFileSync(join(repo, ".env"), "TOKEN=leaked\n");
    writeFileSync(join(repo, "secret.key"), "new key\n");
    mkdirSync(join(repo, "build"));
    writeFileSync(join(repo, "build", "out.js"), "built\n");
    const delta = observeDelta(repo, "toolu_3", [".env"]);
    if (!delta.ok) throw new Error(delta.fault);
    expect(delta.changes, "git ignores secret.key and build/, and nothing listed them").toStrictEqual([
      { path: ".env", before: "TOKEN=old\n", after: "TOKEN=leaked\n" },
    ]);
    expect(revertChanges(repo, delta.before ?? "", delta.changes)).toStrictEqual([]);
    expect(read(".env")).toBe("TOKEN=old\n");
    expect(read("secret.key"), "outside the snapshot, so outside the revert").toBe("new key\n");
  });

  it("sees an included ignored file the call creates, and one it deletes", () => {
    takeSnapshot(repo, "toolu_4", [".env", "config/*.local.json"], who);
    unlinkSync(join(repo, ".env"));
    mkdirSync(join(repo, "config"));
    writeFileSync(join(repo, ".gitignore"), ".env\nsecret.key\nbuild/\nconfig/\n");
    writeFileSync(join(repo, "config", "app.local.json"), "{}\n");
    const delta = observeDelta(repo, "toolu_4", [".env", "config/*.local.json"]);
    if (!delta.ok) throw new Error(delta.fault);
    expect(delta.changes.map((c) => [c.path, c.before === null, c.after === null])).toStrictEqual([
      [".env", false, true],
      [".gitignore", false, false],
      ["config/app.local.json", true, false],
    ]);
  });

  it("reports a snapshot that could not be taken, and one that was never taken — never an empty delta", () => {
    const bare = mkdtempSync(join(tmpdir(), "flow-nogit-"));
    try {
      takeSnapshot(bare, "toolu_5", [], who);
      const unseen = observeDelta(bare, "toolu_5", []);
      expect(unseen.ok).toBe(false);
      if (!unseen.ok) expect(unseen.fault).toContain("could not be taken");
      expect(unseen.ok || unseen.fault).toContain("not a git checkout");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    const never = observeDelta(repo, "toolu_never", []);
    expect(never.ok).toBe(false);
    if (!never.ok) expect(never.fault).toContain("No snapshot was taken before this call");
  });

  it("says which file it could not put back, rather than claiming it did", () => {
    takeSnapshot(repo, "toolu_6", [], who);
    writeFileSync(join(repo, "a.ts"), "changed\n");
    const delta = observeDelta(repo, "toolu_6", []);
    if (!delta.ok) throw new Error(delta.fault);
    const failed = revertChanges(repo, "0000000000000000000000000000000000000000", delta.changes);
    expect(failed.map((f) => f.path)).toStrictEqual(["a.ts"]);
    expect(read("a.ts")).toBe("changed\n");
  });

  it("forgets a call once it is over — no snapshot left to read as in flight", () => {
    takeSnapshot(repo, "toolu_7", [], who);
    const meta = JSON.parse(readFileSync(join(repo, ".flow", "snapshots", "toolu_7.json"), "utf8")) as Record<string, unknown>;
    expect(meta).toMatchObject({ session: "s1", agent: "main", tool: "Bash" });
    expect(typeof meta["tree"]).toBe("string");
    forgetSnapshot(repo, "toolu_7");
    expect(readdirSync(join(repo, ".flow", "snapshots"))).toStrictEqual([]);
  });
});
