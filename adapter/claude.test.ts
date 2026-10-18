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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  currentBranch,
  callLog,
  finishSnapshot,
  loadRegime,
  observeDelta,
  projectRoot,
  readText,
  realWorld,
  revertChanges,
  runCommand,
  runHook,
  takeSnapshot,
} from "./claude.ts";
import { CALL_LIFETIME_MS, overlapping } from "./domain.ts";

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

  it("leaves out each file that matches HEAD after the call, whichever way it got there, and sees every other change", () => {
    // `old` holds a file main does not, and its own copy of a.ts.
    git("stash", "-q");
    git("switch", "-qc", "old");
    writeFileSync(join(repo, "legacy.ts"), "// from before the rule\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 'old';\n");
    git("add", "legacy.ts", "a.ts");
    git("commit", "-qm", "old");
    git("switch", "-q", "main");
    takeSnapshot(repo, "toolu_8", [], who);
    spawnSync("bash", ["-c", "git switch -q old && echo '// mine' >> a.ts && echo scratch > notes.md"], { cwd: repo });
    const there = observeDelta(repo, "toolu_8", []);
    if (!there.ok) throw new Error(there.fault);
    expect(there.changes, "legacy.ts is old's own copy; a.ts and notes.md are the call's").toStrictEqual([
      { path: "a.ts", before: "export const a = 1;\n", after: "export const a = 'old';\n// mine\n" },
      { path: "notes.md", before: null, after: "scratch\n" },
    ]);
    takeSnapshot(repo, "toolu_9", [], who);
    spawnSync("bash", ["-c", "git checkout -q -- a.ts && rm notes.md && git switch -q main"], { cwd: repo });
    const back = observeDelta(repo, "toolu_9", []);
    expect(back.ok && back.changes, "every file is main's again; notes.md was in no commit, so its removal is the call's").toStrictEqual([
      { path: "notes.md", before: "scratch\n", after: null },
    ]);
  });

  it("judges every change a call commits itself, and leaves out a reset or a fast-forward to a commit the repo had", () => {
    git("stash", "-q");
    const call = (key: string, command: string): ReturnType<typeof observeDelta> => {
      takeSnapshot(repo, key, [], who);
      expect(spawnSync("bash", ["-c", command], { cwd: repo }).status, command).toBe(0);
      return observeDelta(repo, key, []);
    };
    // The files match the commit the call lands on — but the call made that commit, and skipped the gate doing it.
    const made = call("toolu_11", "echo '// TODO' >> a.ts && rm gone.ts && git add a.ts gone.ts && git commit -qm mine --no-verify");
    expect(made.ok && made.changes, "a commit the call made vouches for nothing").toStrictEqual([
      { path: "a.ts", before: "export const a = 1;\n", after: "export const a = 1;\n// TODO\n" },
      { path: "gone.ts", before: "export const gone = 1;\n", after: null },
    ]);
    git("branch", "mine");
    expect(call("toolu_12", "git reset -q --hard HEAD~1"), "back to a commit main had").toMatchObject({ ok: true, changes: [] });
    expect(call("toolu_13", "git merge -q --ff-only mine"), "forward to a commit a branch had").toMatchObject({ ok: true, changes: [] });
  });

  it("leaves out what a pull brings in: a remote branch reaches the commit it lands on", () => {
    git("stash", "-q");
    const upstream = mkdtempSync(join(tmpdir(), "flow-upstream-"));
    try {
      spawnSync("git", ["clone", "-q", repo, upstream]);
      writeFileSync(join(upstream, "a.ts"), "export const a = 'theirs'; // TODO\n");
      writeFileSync(join(upstream, "pulled.ts"), "// TODO: from upstream\n");
      spawnSync("bash", ["-c", "git add a.ts pulled.ts && git -c user.name=u -c user.email=u@e commit -qm upstream && git rm -q gone.ts && git -c user.name=u -c user.email=u@e commit -qm gone"], {
        cwd: upstream,
      });
      git("remote", "add", "origin", upstream);
      takeSnapshot(repo, "toolu_14", [], who);
      expect(spawnSync("git", ["pull", "-q", "--ff-only", "origin", "main"], { cwd: repo }).status).toBe(0);
      expect(read("pulled.ts"), "the pull landed").toBe("// TODO: from upstream\n");
      expect(observeDelta(repo, "toolu_14", [])).toMatchObject({ ok: true, changes: [] });
    } finally {
      rmSync(upstream, { recursive: true, force: true });
    }
  });

  it("refuses and puts back the removal of an uncommitted .env snapshotInclude lists, made by a route other than rm", async () => {
    // No commit holds .env, so its removal is the call's to answer for, whatever HEAD does.
    const door = new URL("../index.ts", import.meta.url).pathname;
    writeFileSync(
      join(repo, "flow.config.ts"),
      `import { defineConfig, definePack, deletion, guardrail, pack, protectedPath, write } from ${JSON.stringify(door)};
const demo = definePack("demo", {
  keepEnv: guardrail()
    .at(write, deletion)
    .on(".env")
    .check(protectedPath({ existingOnly: true }))
    .message("The .env stays.")
    .test({ pass: [{ path: ".env", content: "new" }], block: [{ path: ".env", content: "x", world: { fs: { ".env": "old" } } }] }),
});
export default defineConfig([pack(demo)], { snapshotInclude: [".env"] });
`,
    );
    const command = "python3 -c \"import os; os.remove('.env')\"";
    const payload = { session_id: "s1", tool_name: "Bash", tool_input: { command }, tool_use_id: "toolu_env", cwd: repo };
    expect((await runHook("pre-tool-use", payload, repo)).exitCode).toBe(0);
    expect(spawnSync("bash", ["-c", command], { cwd: repo }).status).toBe(0);
    expect(existsSync(join(repo, ".env")), "the script removed it").toBe(false);
    const answer = await runHook("post-tool-use", payload, repo);
    expect(answer.exitCode).toBe(2);
    expect(answer.stderr).toContain("✗ demo.keepEnv · .env");
    expect(read(".env"), "written back, byte for byte").toBe("TOKEN=old\n");
  });

  // #146: a call that changes what the snapshot can see. Each rule here refuses any write to .env.
  const keepEnvConfig = `import { defineConfig, definePack, deletion, guardrail, pack, protectedPath, write } from ${JSON.stringify(new URL("../index.ts", import.meta.url).pathname)};
const demo = definePack("demo", {
  keepEnv: guardrail()
    .at(write, deletion)
    .on(".env")
    .check(protectedPath({}))
    .message("The .env stays.")
    .test({ pass: [{ path: "a.ts", content: "new" }], block: [{ path: ".env", content: "x" }] }),
});
export default defineConfig([pack(demo)]);
`;

  /** One Bash call through both rails: the snapshot before it, `act` as the call, the judgement after. */
  const hookCall = async (key: string, act: () => void): Promise<Awaited<ReturnType<typeof runHook>>> => {
    const payload = { session_id: "s1", tool_name: "Bash", tool_input: { command: "a shell edit" }, tool_use_id: key, cwd: repo };
    expect((await runHook("pre-tool-use", payload, repo)).exitCode).toBe(0);
    act();
    return runHook("post-tool-use", payload, repo);
  };
  const unjudged = "flow had no earlier copy of .env: it entered the snapshot during this call, so this call did not judge it.";

  // In-process the config module is cached, so a call that edits snapshotInclude is driven through
  // the snapshot itself, with the include each side was taken with: the old before, the new after.
  it("#146: a call that adds .env to snapshotInclude does not see the .env that was already there as created", () => {
    takeSnapshot(repo, "toolu_146a", [], who);
    const delta = observeDelta(repo, "toolu_146a", [".env"]);
    if (!delta.ok) throw new Error(delta.fault);
    expect(delta.changes, "the call never touched .env").toStrictEqual([]);
    expect(delta.entered, "it entered the snapshot").toStrictEqual([".env"]);
    expect(read(".env")).toBe("TOKEN=old\n");
  });

  it("#146: a call that takes .env out of snapshotInclude does not remove it", () => {
    takeSnapshot(repo, "toolu_146c", [".env"], who);
    const delta = observeDelta(repo, "toolu_146c", []);
    if (!delta.ok) throw new Error(delta.fault);
    expect(delta.changes, "no removal for a delete rule to judge").toStrictEqual([]);
    expect(read(".env"), "still on disk").toBe("TOKEN=old\n");
  });

  it("#146: a call that adds .env to snapshotInclude and creates it still makes a creation", () => {
    unlinkSync(join(repo, ".env"));
    takeSnapshot(repo, "toolu_146d", [], who);
    writeFileSync(join(repo, ".env"), "TOKEN=new\n");
    const delta = observeDelta(repo, "toolu_146d", [".env"]);
    if (!delta.ok) throw new Error(delta.fault);
    expect(delta.changes, "it was not on disk before the call").toStrictEqual([{ path: ".env", before: null, after: "TOKEN=new\n" }]);
    expect(delta.entered).toStrictEqual([]);
  });

  it("#146: a call that un-ignores .env in .gitignore leaves the .env that was already there, and says so", async () => {
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    const answer = await hookCall("toolu_146b", () => { writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n"); });
    expect(read(".env"), `the call never touched .env; flow said:\n${answer.stderr}`).toBe("TOKEN=old\n");
    expect(answer.exitCode, "nothing judged .env, so nothing refused it").toBe(0);
    expect(answer.stdout, "the agent is told the file entered the snapshot unjudged").toContain(unjudged);
  });

  it("#146: the next call's edit to a file that entered the snapshot is judged", async () => {
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    expect((await hookCall("toolu_146e1", () => { writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n"); })).exitCode).toBe(0);
    const answer = await hookCall("toolu_146e2", () => { writeFileSync(join(repo, ".env"), "TOKEN=leaked\n"); });
    expect(answer.exitCode).toBe(2);
    expect(answer.stderr).toContain("✗ demo.keepEnv · .env");
    expect(answer.stderr).not.toContain("no earlier copy");
    expect(read(".env"), "put back to the copy the first call recorded").toBe("TOKEN=old\n");
  });

  it("#146: a call that un-ignores a .env it also creates is judged, and the creation undone", async () => {
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    unlinkSync(join(repo, ".env"));
    const answer = await hookCall("toolu_146f", () => {
      writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n");
      writeFileSync(join(repo, ".env"), "TOKEN=new\n");
    });
    expect(answer.exitCode).toBe(2);
    expect(answer.stderr).toContain("✗ demo.keepEnv · .env");
    expect(answer.stderr).toContain(".env is gone again — the call created it.");
    expect(existsSync(join(repo, ".env"))).toBe(false);
  });

  // Pinned on #173 (row 1 skipped): flow has no copy of the hidden .env, so judging the rewrite
  // could only end in deleting it. It enters unjudged, as rewritten; the next change is judged.
  it("#146: a call that un-ignores an existing .env and rewrites it lets it enter unjudged, as rewritten", async () => {
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    const answer = await hookCall("toolu_146i", () => {
      writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n");
      writeFileSync(join(repo, ".env"), "TOKEN=new\n");
    });
    expect(answer.exitCode, `nothing judged .env; flow said:\n${answer.stderr}`).toBe(0);
    expect(answer.stdout, "the agent is told the file entered the snapshot unjudged").toContain(unjudged);
    expect(read(".env"), "the call's content stays: flow had nothing to put back").toBe("TOKEN=new\n");
  });

  it("#146: a call that adds a visible .env to .gitignore leaves it on disk, and no delete rule is called on it", async () => {
    writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n");
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    const answer = await hookCall("toolu_146g", () => { writeFileSync(join(repo, ".gitignore"), ".env\nsecret.key\nbuild/\n"); });
    expect(answer.exitCode, `the deletion rule on .env was not called; flow said:\n${answer.stderr}`).toBe(0);
    expect(read(".env")).toBe("TOKEN=old\n");
  });

  it("#146: a call that adds .env to .gitignore and rewrites it has the rewrite judged by the write rules", async () => {
    writeFileSync(join(repo, ".gitignore"), "secret.key\nbuild/\n");
    writeFileSync(join(repo, "flow.config.ts"), keepEnvConfig);
    const answer = await hookCall("toolu_146h", () => {
      writeFileSync(join(repo, ".gitignore"), ".env\nsecret.key\nbuild/\n");
      writeFileSync(join(repo, ".env"), "TOKEN=leaked\n");
    });
    expect(answer.exitCode, "hiding the file does not hide the edit").toBe(2);
    expect(answer.stderr).toContain("flow — write reverted after it landed");
    expect(answer.stderr).toContain("✗ demo.keepEnv · .env");
    expect(answer.stderr, "a write put back, not a removal restored").toContain(".env is back to its previous content.");
    expect(read(".env")).toBe("TOKEN=old\n");
  });

  it("judges every change in a repo with no commit yet — there is no HEAD to match", () => {
    const fresh = mkdtempSync(join(tmpdir(), "flow-unborn-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: fresh });
      writeFileSync(join(fresh, "a.ts"), "one\n");
      takeSnapshot(fresh, "toolu_10", [], who);
      unlinkSync(join(fresh, "a.ts"));
      writeFileSync(join(fresh, "b.ts"), "new\n");
      const delta = observeDelta(fresh, "toolu_10", []);
      if (!delta.ok) throw new Error(delta.fault);
      expect(delta.changes).toStrictEqual([
        { path: "a.ts", before: "one\n", after: null },
        { path: "b.ts", before: null, after: "new\n" },
      ]);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
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

  it("reports a snapshot recorded with no hidden list as unreadable — it cannot tell a creation from a file that entered (#146)", () => {
    takeSnapshot(repo, "toolu_nolist", [], who);
    const record = join(repo, ".flow", "snapshots", "toolu_nolist.json");
    const { hidden, ...meta } = JSON.parse(readFileSync(record, "utf8")) as Record<string, unknown>;
    expect(Array.isArray(hidden), "the snapshot records the list beside the tree").toBe(true);
    writeFileSync(record, JSON.stringify(meta));
    writeFileSync(join(repo, "new.ts"), "x\n");
    const delta = observeDelta(repo, "toolu_nolist", []);
    expect(delta.ok).toBe(false);
    if (!delta.ok) expect(delta.fault).toContain("is unreadable");
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

  it("marks a call finished once it is over, and forgets it once nothing in flight can overlap it", () => {
    takeSnapshot(repo, "toolu_7", [], who);
    const meta = JSON.parse(readFileSync(join(repo, ".flow", "snapshots", "toolu_7.json"), "utf8")) as Record<string, unknown>;
    expect(meta).toMatchObject({ session: "s1", agent: "main", tool: "Bash" });
    expect(typeof meta["tree"]).toBe("string");
    finishSnapshot(repo, "toolu_7");
    expect(readdirSync(join(repo, ".flow", "snapshots")), "nothing in flight, so nothing to keep").toStrictEqual([]);
  });

  it("keeps the log a later diff reads: a call in flight, and one that finished while it ran", () => {
    takeSnapshot(repo, "toolu_long", [], { session: "s1", agent: "main", tool: "Bash" });
    takeSnapshot(repo, "toolu_short", [], { session: "s1", agent: "sub1", tool: "Bash" });
    finishSnapshot(repo, "toolu_short");
    const log = callLog(repo);
    expect(log.map((call) => [call.key, call.agent, call.done !== undefined]).sort()).toStrictEqual([
      ["toolu_long", "main", false],
      ["toolu_short", "sub1", true],
    ]);
    const long = log.find((call) => call.key === "toolu_long");
    expect(long && overlapping(long, log).map((call) => call.key), "it finished inside the long call's window").toStrictEqual(["toolu_short"]);
    expect(readdirSync(join(repo, ".flow", "snapshots")).sort(), "the short call's indexes are gone").toStrictEqual([
      "toolu_long.index",
      "toolu_long.json",
      "toolu_short.json",
    ]);
    finishSnapshot(repo, "toolu_long");
    expect(callLog(repo), "nothing in flight any more, so the log empties").toStrictEqual([]);
  });

  it("keeps a call an hour gone with no finish for the day's sweep, which takes it, and it pins no other record", () => {
    const dir = join(repo, ".flow", "snapshots");
    takeSnapshot(repo, "toolu_dead", [], { session: "killed", agent: "sub9", tool: "Bash" });
    const held = JSON.parse(readFileSync(join(dir, "toolu_dead.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "toolu_dead.json"), JSON.stringify({ ...held, at: Date.now() - CALL_LIFETIME_MS - 60_000 }));
    takeSnapshot(repo, "toolu_next", [], who);
    finishSnapshot(repo, "toolu_next");
    expect(readdirSync(dir).sort(), "the dead call's snapshot stays; the call that finished after it goes").toStrictEqual([
      "toolu_dead.index",
      "toolu_dead.json",
    ]);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000);
    for (const name of ["toolu_dead.json", "toolu_dead.index"]) utimesSync(join(dir, name), dayAgo, dayAgo);
    takeSnapshot(repo, "toolu_later", [], who);
    expect(readdirSync(dir).sort(), "a day on, the next snapshot's sweep takes the dead call's files").toStrictEqual([
      "toolu_later.index",
      "toolu_later.json",
    ]);
  });

  it("checks a call approved after an hour at the prompt, though another agent's call finished while it waited", async () => {
    const door = new URL("../index.ts", import.meta.url).pathname;
    writeFileSync(
      join(repo, "flow.config.ts"),
      `import { defineConfig, definePack, guardrail, pack, protectedPath, write } from ${JSON.stringify(door)};
const demo = definePack("demo", {
  keepA: guardrail()
    .at(write)
    .on("a.ts")
    .check(protectedPath({ existingOnly: true }))
    .message("a.ts stays.")
    .test({ pass: [{ path: "b.ts", content: "new" }], block: [{ path: "a.ts", content: "x", world: { fs: { "a.ts": "old" } } }] }),
});
export default defineConfig([pack(demo)]);
`,
    );
    const dir = join(repo, ".flow", "snapshots");
    const waited = { session_id: "s1", tool_name: "Bash", tool_input: { command: "echo late > a.ts" }, tool_use_id: "toolu_waited", cwd: repo };
    expect((await runHook("pre-tool-use", waited, repo)).exitCode).toBe(0);
    const held = JSON.parse(readFileSync(join(dir, "toolu_waited.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "toolu_waited.json"), JSON.stringify({ ...held, at: Date.now() - CALL_LIFETIME_MS - 60_000 }));
    const other = { session_id: "s1", agent_id: "sub1", tool_name: "Bash", tool_input: { command: "true" }, tool_use_id: "toolu_other", cwd: repo };
    expect((await runHook("pre-tool-use", other, repo)).exitCode).toBe(0);
    expect((await runHook("post-tool-use", other, repo)).exitCode).toBe(0);
    expect(existsSync(join(dir, "toolu_waited.json")), "the other call's finish leaves the waiting call's snapshot").toBe(true);
    writeFileSync(join(repo, "a.ts"), "late\n");
    const answer = await runHook("post-tool-use", waited, repo);
    expect(answer.stderr).not.toContain("No snapshot was taken");
    expect(answer.exitCode).toBe(2);
    expect(answer.stderr).toContain("✗ demo.keepA · a.ts");
    expect(read("a.ts"), "written back from its snapshot").toBe("export const a = 2; // staged\n");
  });

  it("leaves a record it cannot read out of the log rather than failing the diff", () => {
    mkdirSync(join(repo, ".flow", "snapshots"), { recursive: true });
    writeFileSync(join(repo, ".flow", "snapshots", "half.json"), "{ not json");
    writeFileSync(join(repo, ".flow", "snapshots", "odd.json"), "[1]");
    expect(callLog(repo)).toStrictEqual([]);
    expect(callLog(join(repo, "nowhere"))).toStrictEqual([]);
  });
});
