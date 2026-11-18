// flow/adapter/domain.test.ts — the product's pure home, with no harness in the room.
//
// What `flow init`, `flow uninstall`, `flow status` and `flow facts` decide, the git gate, and the
// reading of a conversation once it is events. The harness a verb is handed comes from
// `__fixtures__/host.ts`, so this file names none; what is one harness's own — its payloads, its
// settings file, its transcripts — is proved in that harness's folder.
import { describe, it, expect } from "vitest";
import { type Row } from "../engine/domain.ts";
import { missingGrammarText } from "../checks/domain.ts";
import { host } from "../__fixtures__/host.ts";
import type { TranscriptEvent } from "./harness.ts";
import { CONFIG_FILE, listed, repoFirst, text, LOCAL_BIN, PACKAGE_DIR, PACKAGE_BIN, NOT_INSTALLED, HOOKS_UNKNOWN, GIT_HOOK_ENV, hermeticEnv, health, selectSessions, classifyBash, mergeNarratives, narrative, recipeTools, type Candidate, NODE_FLOOR, configLoadFault, loadsAsStrippedModule, hostPath, pathLines, stagedChanges, treeChanges, commitScope, armsOldFlow, UPDATE_THE_GATE_LINE, PRE_COMMIT, GATE_LOCAL_LINE, GATE_RUN_LINE, HOOKS_DIR, GATE_PATH, SET_HOOKS_PATH, ADD_THE_GATE_LINE, armsFlow, scaffold, planInit, initLines, planUninstall, uninstallLines, uninstallCode, uninstallRefusal, MACHINE_FLAG, gateWithoutFlow, flowLinesOf, type UninstallFacts, hooksDirOf, otherHooks, preCommitOf, status, statusLines, type HooksFolder, type OtherHooks, type InitFacts, type StatusFacts } from "./domain.ts";



describe("the environment a check's command sees", () => {
  it("strips git's hook plumbing, and keeps everything else", () => {
    // The gate runs inside the pre-commit hook and inherits these; a nested `git` would then aim at
    // the in-progress commit. It was the tool-gate rule's own business until ctx.exec became the
    // one door.
    const env = hermeticEnv({ PATH: "/usr/bin", GIT_INDEX_FILE: "/repo/.git/index", HOME: "/home/me" });
    expect(env).toStrictEqual({ PATH: "/usr/bin", HOME: "/home/me" });
    expect(GIT_HOOK_ENV).toContain("GIT_DIR");
  });
});

describe("the justfile — a bypass is DERIVED from the repo's own recipes", () => {
  const justfile = ["# a comment", "test:", "    npx vitest run", "    @just lint", "lint:", "    eslint .", "[private]"].join("\n");


  it("reads each recipe body's command words, minus the shell noise", () => {
    // `npx vitest run` names `vitest`, not `npx`. The ported reader took the first word, found a
    // launcher in its own noise list, and dropped the line — so in a repo that drives everything
    // through npx (this one) the tool set came back empty and the bypass section was silently off.
    expect(recipeTools(justfile).sort()).toEqual(["eslint", "vitest"]);
    // With no justfile there is nothing to bypass, so the detection switches itself off rather
    // than falling back to a hardcoded list that would be wrong in every other repo.
    expect(recipeTools("")).toEqual([]);
  });

  it("reads a recipe body whole, so a loop over several lines is commands, and an assignment is no tool", () => {
    const looped = ["check:", "    for f in a b; do \\", "      npx tsc -p $f; \\", "    done", "    FLOW_MACHINE_REPORT=1 npx vitest run", "    @-rm -rf dist"].join("\n");
    expect(recipeTools(looped).sort()).toEqual(["rm", "tsc", "vitest"]);
    // A body that does not parse whole is read line by line, and a line that does not parse names nothing.
    expect(recipeTools(["a:", '    printf "unclosed', "    eslint ."].join("\n"))).toEqual(["eslint"]);
  });

  it("judges a line that holds a heredoc: the commands around it count, the body it is fed does not", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("cat > notes.md <<'EOF'\nnpx vitest run\nEOF\nnpx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("git commit -F - <<'EOF'\nfix: run eslint\nEOF", tools)).toEqual({ recipes: [], bypasses: [], commits: true });
    expect(classifyBash("python3 - <<'PY'\nimport os\nPY\njust test", tools)).toEqual({ recipes: ["test"], bypasses: [], commits: false });
    // A body a shell reads is commands, and runs.
    expect(classifyBash("bash <<'EOF'\neslint .\nEOF", tools).bypasses).toEqual(["eslint"]);
    // A tool named inside another command's quoted argument is not run.
    expect(classifyBash('gh issue create --body "ran npx vitest run"', tools).bypasses).toEqual([]);
    expect(classifyBash('echo "x', tools), "a line that does not parse").toEqual({ recipes: [], bypasses: [], commits: false });
  });

  it("tells a recipe call from going round it, and leaves a heredoc alone", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("just test && just lint", tools)).toEqual({ recipes: ["test", "lint"], bypasses: [], commits: false });
    expect(classifyBash("npx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    // A tool run by its path is the tool.
    expect(classifyBash("node_modules/.bin/vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("./node_modules/.bin/eslint .", tools)).toEqual({ recipes: [], bypasses: ["eslint"], commits: false });
    expect(classifyBash("just test-vitest", tools)).toEqual({ recipes: ["test-vitest"], bypasses: [], commits: false });
    expect(classifyBash("git commit -m x", tools).commits).toBe(true);
    // Authoring a file whose body mentions a tool is not running that tool.
    expect(classifyBash("cat <<'EOF' > x\neslint .\nEOF", tools)).toEqual({ recipes: [], bypasses: [], commits: false });
    // A here-string is not a heredoc: the line is still read.
    expect(classifyBash("grep -c x <<< foo && npx vitest run", tools).bypasses).toEqual(["vitest"]);
  });
});

describe("the narrative reading — stats, loops, retries, and what was touched", () => {
  const call = (name: string, input: Record<string, unknown>, line: number): TranscriptEvent => ({
    line,
    kind: "use",
    ts: null,
    id: `t${line}`,
    name,
    input,
    path: typeof input["file_path"] === "string" ? input["file_path"] : "",
  });

  it("counts the work, and cites where the human pushed back", () => {
    const read = narrative(
      [
        { line: 1, kind: "prompt", text: "add the parser" },
        { line: 2, kind: "prompt", text: "no, revert that" },
        call("Write", { file_path: "src/a.ts" }, 3),
        call("Edit", { file_path: "src/a.ts" }, 4),
        call("Read", { file_path: "src/b.ts" }, 5),
        call("Bash", { command: "git commit -m x" }, 6),
      ],
      [],
    );
    expect(read.stats).toMatchObject({ edits: 1, writes: 1, commits: 1 });
    expect(read.prompts.map((p) => p.line)).toEqual([1, 2]);
    expect(read.corrections.map((p) => p.text)).toEqual(["no, revert that"]);
    expect(read.touched).toEqual({ "src/a.ts": 2, "src/b.ts": 1 });
  });

  it("counts a file read through the shell as touched, like a Read", () => {
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", input: { command: "cat src/a.ts src/c.ts" }, path: "", reads: ["src/a.ts", "src/c.ts"] };
    const read = narrative([cat, call("Read", { file_path: "src/a.ts" }, 2)], []);
    expect(read.touched).toEqual({ "src/a.ts": 2, "src/c.ts": 1 });
  });

  it("a file edited five times in a row is a LOOP; four is just work", () => {
    const edits = (n: number): TranscriptEvent[] =>
      Array.from({ length: n }, (_, i) => call("Edit", { file_path: "src/a.ts" }, i + 1));
    expect(narrative(edits(4)).loops).toEqual([]);
    expect(narrative(edits(5)).loops).toEqual([{ path: "src/a.ts", count: 5, from: 1, to: 5 }]);
    // A path outside the repo breaks the run rather than extending it — it is not this tree's file.
    expect(narrative([...edits(3), call("Edit", { file_path: "/tmp/x" }, 9), ...edits(3)]).loops).toEqual([]);
  });

  it("the same command three times is a RETRY, with every line it happened on", () => {
    const runs = Array.from({ length: 3 }, (_, i) => call("Bash", { command: "just test" }, i + 1));
    expect(narrative(runs).retries).toEqual([{ command: "just test", count: 3, lines: [1, 2, 3] }]);
    expect(narrative(runs.slice(0, 2)).retries).toEqual([]);
  });

  it("records a bypass at the site it happened, so the coach reads the line", () => {
    const read = narrative([call("Bash", { command: "npx vitest run" }, 7)], ["vitest"]);
    expect(read.stats.bypasses).toEqual({ vitest: 1 });
    expect(read.bypassSites).toEqual([{ line: 7, tool: "vitest", text: "npx vitest run" }]);
  });

  it("merges several readings into ONE list, each pointer tagged with its own transcript", () => {
    const one = narrative([{ line: 1, kind: "prompt", text: "no, undo it" }, call("Edit", { file_path: "a.ts" }, 2)]);
    const two = narrative([call("Edit", { file_path: "a.ts" }, 3)]);
    const merged = mergeNarratives([
      { session: "s1", read: one },
      { session: "s2", read: two },
    ]);
    expect(merged.stats.edits).toBe(2);
    expect(merged.touched).toEqual({ "a.ts": 2 });
    expect(merged.corrections).toEqual([{ line: 1, text: "no, undo it", session: "s1" }]);
    expect(mergeNarratives([]).stats).toEqual({ edits: 0, writes: 0, shellWrites: 0, shellReads: 0, commits: 0, recipes: {}, bypasses: {} });
  });

  it("counts shell writes from the conversation's own stream, and shell reads from its transcript", () => {
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", input: { command: "cat src/a.ts" }, path: "", reads: ["src/a.ts"] };
    const heredoc = call("Bash", { command: "python3 - <<'EOF'\nopen('src/b.ts','w')\nEOF" }, 2);
    const rows: Row[] = [
      { kind: "tool", tool: "Bash", command: "python3 - <<'EOF'" },
      { kind: "write", tool: "Bash", path: "src/b.ts", change: "modified" },
      { kind: "write", tool: "Bash", path: "src/b.ts", change: "modified" },
      { kind: "write", tool: "Bash", path: "/tmp/outside", change: "created" },
      { kind: "read", tool: "Bash", path: "src/a.ts" },
    ];
    const read = narrative([cat, heredoc], [], rows);
    expect(read.stats).toMatchObject({ edits: 0, writes: 0, shellWrites: 2, shellReads: 1 });
    expect(read.shell).toEqual({ writes: { "src/b.ts": 2 }, reads: { "src/a.ts": 1 } });
    expect(read.touched).toEqual({ "src/a.ts": 1, "src/b.ts": 2 });
    // No stream is no shell writes — the transcript cannot say what a command changed.
    expect(narrative([cat, heredoc]).stats.shellWrites).toBe(0);

    const merged = mergeNarratives([
      { session: "s1", read },
      { session: "s2", read },
    ]);
    expect(merged.stats).toMatchObject({ shellWrites: 4, shellReads: 2 });
    expect(merged.shell).toEqual({ writes: { "src/b.ts": 4 }, reads: { "src/a.ts": 2 } });
  });
});

describe("selecting which conversations a run covers", () => {
  const at = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    id,
    bytes: 100,
    mtimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
    started: null,
    branch: null,
    ...over,
  });

  const newest = at("new", { started: "2026-03-01T00:00:00.000Z" });
  const middle = at("mid", { started: "2026-02-01T00:00:00.000Z", bytes: 900 });
  const oldest = at("old", { started: "2026-01-01T00:00:00.000Z" });

  it("subtracts what is already done, and orders newest first", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(["mid"]));
    expect(picked.analyse.map((c) => c.id)).toEqual(["new", "old"]);
    expect(picked.counts).toEqual({ backlog: 2, analysed: 2, excluded: 0 });
  });

  it("orders heaviest-first when asked — wasted effort concentrates in the big conversations", () => {
    expect(selectSessions([oldest, newest, middle], new Set(), { largest: true }).analyse.map((c) => c.id)).toEqual([
      "mid",
      "new",
      "old",
    ]);
  });

  it("a limit DEFERS rather than drops, so a capped run cannot declare skipped history done", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { limit: 1 });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded).toEqual([
      { id: "mid", reason: "limit" },
      { id: "old", reason: "limit" },
    ]);
    expect(selectSessions([oldest, newest], new Set(), { limit: 1, all: true }).analyse).toHaveLength(2);
  });

  it("a date floor defers everything older, naming each one", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { since: Date.parse("2026-02-15T00:00:00.000Z") });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded.map((e) => e.reason)).toEqual(["since", "since"]);
  });

  it("falls back to the file's own mtime when the conversation never stamped a start", () => {
    const dated = at("dated", { started: null, mtimeMs: Date.parse("2026-05-01T00:00:00.000Z") });
    expect(selectSessions([newest, dated], new Set()).analyse[0]?.id).toBe("dated");
  });
});

describe("the health line above every number", () => {
  it("an unarmed record BLOCKS the reading rather than reporting zeroes", () => {
    const said = health({ armed: false, rows: 0, withRecord: 0, analysed: 3 });
    expect(said.blocked).toContain("NOT ARMED");
    expect(said.warn).toEqual([]);
  });

  it("armed but silent for what was read is a warning, not a verdict", () => {
    expect(health({ armed: true, rows: 0, withRecord: 1, analysed: 1 }).warn[0]).toContain("holds no events");
    expect(health({ armed: true, rows: 0, withRecord: 0, analysed: 2 }).warn[0]).toContain("narrative only");
    expect(health({ armed: true, rows: 12, withRecord: 1, analysed: 1 })).toEqual({ blocked: null, warn: [] });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCT SURFACE — what `flow init` writes, and what `flow status` says
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Both verbs are decisions about the world rather than reads of it: what to write given what is
// already there, and what to SAY given what loaded. The shell next door (product.ts) stats, writes
// and spawns; every branch below is asserted here, where it costs a millisecond.

describe("the config load's one fault sentence", () => {
  it("turns a type-stripping parse error into the machine fact it really is", () => {
    const said = configLoadFault("flow.config.ts", "Unexpected token ':'", "22.4.0");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(`Node >= ${NODE_FLOOR}`);
    expect(said).toContain("22.4.0");
    expect(said, "the original is kept — the rewrite adds a cause, it does not hide one").toContain(
      "Unexpected token",
    );
  });

  it("leaves an ordinary failure alone — a missing import is not a version problem", () => {
    const said = configLoadFault("flow.config.ts", "Cannot find package 'left-pad'", "24.1.0");
    expect(said).toContain("Cannot find package 'left-pad'");
    expect(said).not.toContain(`Node >= ${NODE_FLOOR}`);
  });
});

describe("which modules flow strips and evaluates itself", () => {
  const url = (path: string): string => `file://${path}`;

  it("takes the guarded repo's own TypeScript — the config, and what it imports", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/guards/house.ts"))).toBe(true);
  });

  it("leaves node_modules alone, because node refuses to strip there and that refusal is not flow's to overrule", () => {
    expect(loadsAsStrippedModule(url("/repo/node_modules/some-pkg/index.ts"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/node_modules/@scope/pkg/deep/src/x.ts"))).toBe(false);
  });

  it("leaves everything that is not a .ts file, declarations included", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.js"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/flow.config.mjs"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/types/x.d.ts")), "types all the way down, evaluating to nothing").toBe(false);
  });

  it("answers only for file urls — an http or data specifier is nothing flow put there", () => {
    expect(loadsAsStrippedModule("data:text/typescript,export default 1")).toBe(false);
    expect(loadsAsStrippedModule("https://example.com/config.ts")).toBe(false);
    expect(loadsAsStrippedModule("node:fs")).toBe(false);
  });

  it("reads past a query or a fragment, which a cache-busting import adds", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts?v=2"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts#frag"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/x.js?name=y.ts")), "the query is not the extension").toBe(false);
  });
});

/** The events flow registers, in its order. Pinned once, by the test that names exactly what is registered. */
const REGISTERED_EVENTS = host.registering.registrations.map((r) => r.event);

/** flow's registrations, each running the command `as` makes of today's one. */
const registrationsAs = (as: (command: string) => string): { hooks: Record<string, unknown[]> } => ({
  hooks: Object.fromEntries(
    host.registering.registrations.map((r) => [
      r.event,
      [{ ...(r.matcher === undefined ? {} : { matcher: r.matcher }), hooks: [{ type: "command", command: as(r.command) }] }],
    ]),
  ),
});

/** The registrations an older `flow init` wrote: each the bare `flow hook <event>`. */
const BARE_SETTINGS = registrationsAs((command) => command.replace(/^.* flow /, "flow "));

const OLD_GATE = '#!/bin/sh\nstaged=$(git diff --cached --name-only --diff-filter=ACMR)\n[ -z "$staged" ] && exit 0\nexec flow commit $staged\n';

describe("the git gate flow arms", () => {
  it("calls `flow hook commit` and passes nothing — no list, no filter, no early exit", () => {
    expect(PRE_COMMIT.startsWith("#!")).toBe(true);
    expect(PRE_COMMIT, "flow asks git; the hook does not").not.toContain("git diff");
    expect(PRE_COMMIT).not.toContain("exit 0");
  });

  // A DEV DEPENDENCY GUARDS THE REPO: git hands its hooks the PATH it was given, and a repo with
  // flow only as a dev dependency has none there, so the gate runs the repo's own package first.
  it("runs the repo's own @jawache/flow first, then the flow on the PATH", () => {
    const lines = PRE_COMMIT.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
    expect(lines).toEqual([GATE_LOCAL_LINE, GATE_RUN_LINE]);
    expect(GATE_LOCAL_LINE).toBe('f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit');
    expect(GATE_RUN_LINE).toBe("exec flow hook commit");
  });

  it("names one hooks directory, and one gate inside it", () => {
    expect(GATE_PATH).toBe(`${HOOKS_DIR}/pre-commit`);
    expect(SET_HOOKS_PATH, "the report's line and the fitting's fix are one sentence").toContain(HOOKS_DIR);
    expect(PRE_COMMIT, "the hook's own comment tells you what arms it").toContain(SET_HOOKS_PATH);
  });

  it("recognises a gate that runs flow, one that runs the OLD verb, and one that runs something else", () => {
    expect(armsFlow(PRE_COMMIT)).toBe(true);
    expect(armsFlow(OLD_GATE), "flow's own gate from before `flow hook commit`").toBe(false);
    expect(armsOldFlow(OLD_GATE)).toBe(true);
    expect(armsOldFlow(PRE_COMMIT), "the current gate is not the old one, whatever its comment says").toBe(false);
    expect(armsFlow("#!/bin/sh\n# flow hook commit runs here one day\nnpm test\n"), "a comment runs nothing").toBe(false);
    expect(armsFlow('#!/bin/sh\nwork guard commit "$@"\n'), "the old engine's gate").toBe(false);
    expect(armsOldFlow('#!/bin/sh\nwork guard commit "$@"\n')).toBe(false);
    expect(armsFlow(null)).toBe(false);
    expect(armsOldFlow(null)).toBe(false);
  });

  it("reads `flow hook commit [--all]`, refuses a file list, and drops the old verb's list", () => {
    expect(commitScope([], false)).toBe("staged");
    expect(commitScope(["--all"], false)).toBe("all");
    expect(commitScope(["src/a.ts"], false), "a second source of the staged set").toBeNull();
    expect(commitScope(["--all", "src/a.ts"], false)).toBeNull();
    expect(commitScope(["src/a.ts", "src/b.ts"], true), "an older hook's `flow commit $staged`").toBe("staged");
  });
});

describe("the scaffolded config", () => {
  it("is a readable demo: the four ruled entries, a category, and one pack", () => {
    const demo = scaffold(false);
    expect(demo).toContain('from "@jawache/flow"');
    expect(demo).toContain("definePack");
    expect(demo).toContain("defineCategory");
    expect(demo).toContain("--force");
    expect(demo).toContain("subagent");
    expect(demo.split("\n").length, "one screen — the whole claim of the demo").toBeLessThan(80);
  });

  it("never contains the marker its own gate refuses — a config that blocks itself", () => {
    // The gate greps staged content for a marker, and the config is a staged file. Spelled whole it
    // would refuse the commit that added it, which is the exact self-reference this demo is here to
    // teach: the entry builds the word rather than writing it.
    expect(scaffold(false)).not.toContain("DO-NOT-COMMIT");
  });

  it("is an empty config, and nothing else, when asked for one", () => {
    const bare = scaffold(true);
    expect(bare).toContain("defineConfig([])");
    expect(bare).not.toContain("definePack");
  });
});

// ── init ─────────────────────────────────────────────────────────────────────

const bare: InitFacts = {
  harness: host,
  root: "/repo",
  empty: false,
  isGit: true,
  hasConfig: false,
  gateText: null,
  hasFlowDir: false,
  hooksPath: null,
  hooksFolder: { dir: ".git/hooks", files: ["pre-commit.sample", "pre-push.sample"], preCommitText: null, preCommitExecutable: false },
  settingsPath: "/home/host/settings.json",
  settings: {},
  settingsUnreadable: false,
  machine: null,
  resolves: false,
  packageRoot: "/checkout/flow",
};

/** Flow's two lines at the end of somebody's pre-commit hook: what the block asks a person to add. */
const WIRED = `#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`;

/**
 * A repo husky set up: git runs `.husky/_`, and a person edits `.husky/pre-commit`, which husky's
 * stub runs with `sh`, so it carries no execute bit here.
 */
const husky = (preCommitText: string | null): Partial<InitFacts> => ({
  hooksPath: ".husky/_",
  hooksFolder: { dir: ".husky/_", files: ["h", "husky.sh", "pre-commit", "pre-push"], preCommitText, preCommitExecutable: false },
});

/** A repo with a hook of its own in `.git/hooks`, which git runs while `core.hooksPath` is unset. */
const gitHooks = (files: readonly string[], preCommitText: string | null = null, preCommitExecutable = preCommitText !== null): Partial<InitFacts> => ({
  hooksFolder: { dir: ".git/hooks", files: ["pre-commit.sample", ...files], preCommitText, preCommitExecutable },
});

describe("other hooks — what counts, and the pre-commit hook a person edits", () => {
  const folder = (files: readonly string[], dir = ".git/hooks", preCommitText: string | null = null, preCommitExecutable = preCommitText !== null): HooksFolder => ({
    dir,
    files,
    preCommitText,
    preCommitExecutable,
  });

  it("a fresh `git init` has only sample hooks, and they do not count", () => {
    expect(otherHooks(null, folder(["pre-commit.sample", "pre-push.sample", "update.sample"]))).toBeNull();
    expect(otherHooks(null, folder([])), "nor does an empty or missing folder").toBeNull();
  });

  it("any other file in .git/hooks counts, not only a pre-commit: Git LFS installs pre-push", () => {
    expect(otherHooks(null, folder(["pre-push.sample", "pre-push"]))).toStrictEqual({
      dir: ".git/hooks",
      preCommit: ".git/hooks/pre-commit",
      fix: "create",
    });
  });

  it("a core.hooksPath anywhere but .githooks counts, whatever is in it", () => {
    expect(otherHooks(".husky/_", folder([], ".husky/_"))?.dir).toBe(".husky/_");
    expect(otherHooks("hooks", folder([], "hooks"))?.preCommit).toBe("hooks/pre-commit");
  });

  it("flow's own .githooks is not other hooks, whatever .git/hooks holds", () => {
    expect(otherHooks(HOOKS_DIR, folder(["pre-commit"], HOOKS_DIR))).toBeNull();
  });

  it("compares the folder git resolved, so any spelling of .githooks is flow's own", () => {
    for (const set of [".githooks/", "./.githooks", "/repo/.githooks"])
      expect(otherHooks(set, folder(["pre-commit"], hooksDirOf("/repo", set))), set).toBeNull();
  });

  it("names the folder repo-relative when it is inside the repo, and absolute when it is not", () => {
    expect(hooksDirOf("/repo", ".husky/_")).toBe(".husky/_");
    expect(hooksDirOf("/repo", ".git/hooks")).toBe(".git/hooks");
    expect(hooksDirOf("/repo", "..foo/hooks"), "a name that starts with .. is still inside").toBe("..foo/hooks");
    expect(hooksDirOf("/repo", "../sibling/hooks"), "a sibling of the repo is outside it").toBe("/sibling/hooks");
    expect(hooksDirOf("/wt", "/main/.git/hooks"), "a worktree's shared folder").toBe("/main/.git/hooks");
    expect(hooksDirOf("/repo", "."), "the repo root itself is not a folder inside it").toBe("/repo");
  });

  it("is wired once the pre-commit hook a person edits calls flow, and a comment naming it does not", () => {
    expect(otherHooks(".husky/_", folder([], ".husky/_", WIRED))?.fix).toBeNull();
    expect(otherHooks(".husky/_", folder([], ".husky/_", "#!/bin/sh\n# flow hook commit\nnpm test\n"))?.fix).not.toBeNull();
  });

  describe("a pre-commit hook git runs itself counts only with the execute bit, as git runs it", () => {
    const lfs = (preCommit: string | null, executable: boolean): OtherHooks | null =>
      otherHooks(null, folder(["pre-push", ...(preCommit === null ? [] : ["pre-commit"])], ".git/hooks", preCommit, executable));

    it("calls flow but is not executable: git ignores it, so not wired, and the fix is the execute bit", () => {
      expect(lfs(WIRED, false)).toStrictEqual({ dir: ".git/hooks", preCommit: ".git/hooks/pre-commit", fix: "chmod" });
      expect(otherHooks("hooks", folder([], "hooks", WIRED, false))?.fix, "a core.hooksPath folder's own pre-commit too").toBe("chmod");
    });

    it("calls flow and is executable: wired", () => {
      expect(lfs(WIRED, true)).toStrictEqual({ dir: ".git/hooks", preCommit: ".git/hooks/pre-commit", fix: null });
    });

    it("not there yet: the fix is to create it", () => {
      expect(lfs(null, false)?.fix).toBe("create");
    });

    it("does not call flow: the two lines, and the execute bit too when it lacks one", () => {
      expect(lfs("#!/bin/sh\nnpm test\n", true)?.fix).toBe("add");
      expect(lfs("#!/bin/sh\nnpm test\n", false)?.fix).toBe("add-and-chmod");
    });

    it("husky's .husky/pre-commit needs no execute bit: its stub runs it with sh", () => {
      expect(otherHooks(".husky/_", folder([], ".husky/_", WIRED, false))).toStrictEqual({
        dir: ".husky/_",
        preCommit: ".husky/pre-commit",
        fix: null,
      });
      expect(otherHooks(".husky/_", folder([], ".husky/_", null, false))?.fix, "and is never created: the stub skips a missing hook").toBe("add");
    });
  });

  it("husky's stub folder `.husky/_` maps to `.husky/pre-commit`; any other folder to its own", () => {
    expect(preCommitOf(".husky/_")).toBe(".husky/pre-commit");
    expect(preCommitOf(".husky/_/")).toBe(".husky/pre-commit");
    expect(preCommitOf(".husky"), "husky 5 to 8 pointed git at .husky itself").toBe(".husky/pre-commit");
    expect(preCommitOf(".git/hooks")).toBe(".git/hooks/pre-commit");
    expect(preCommitOf("/main/.git/hooks"), "a worktree's shared folder is absolute").toBe("/main/.git/hooks/pre-commit");
  });

  it("init's plan carries it, and a repo with no other hooks plans none", () => {
    expect(planInit(bare).otherHooks).toBeNull();
    expect(planInit({ ...bare, ...husky(null) }).otherHooks).toStrictEqual({ dir: ".husky/_", preCommit: ".husky/pre-commit", fix: "add" });
    expect(planInit({ ...bare, ...gitHooks(["pre-push"]) }).otherHooks?.dir).toBe(".git/hooks");
    expect(planInit({ ...bare, ...husky(null), isGit: false }).otherHooks, "outside git there are no hooks to keep").toBeNull();
    expect(planInit({ ...bare, hooksPath: ".husky/_", hooksFolder: null }).otherHooks, "nor when git could not say").toBeNull();
  });
});

describe("planInit — a repo that has never heard of flow", () => {
  const plan = planInit(bare);

  it("writes the config, the gate, the state directory and the link", () => {
    expect(plan.config?.path).toBe("flow.config.ts");
    expect(plan.gate?.path).toBe(GATE_PATH);
    expect(plan.flowDir).toBe(true);
    expect(plan.link).toBe("/checkout/flow");
    expect(plan.hooksPath).toBe(true);
    expect(plan.registered).toEqual(REGISTERED_EVENTS);
  });

  it("reports every write, and nothing it did not do", () => {
    const said = initLines(plan, []).join("\n");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(GATE_PATH);
    expect(said).toContain(".flow/");
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow status");
  });
});

describe("planInit — a repo that already has a pre-commit hook", () => {
  const theirs = planInit({ ...bare, gateText: "#!/bin/sh\nnpm test\n" });

  it("NEVER overwrites it, and says what to add by hand", () => {
    expect(theirs.gate).toBeNull();
    const said = initLines(theirs, []).join("\n");
    expect(said).toContain("kept");
    expect(said, "the same instruction status gives, in the same words").toContain(ADD_THE_GATE_LINE);
  });

  // FOLLOWED TO THE LETTER, the advice must leave a dev-dependency repo able to commit: both lines,
  // the one that puts the repo's own flow first and the one that runs it.
  it("names both of the gate's lines, and a hook that follows it is armed and finds the repo's own flow", () => {
    expect(ADD_THE_GATE_LINE).toContain(GATE_LOCAL_LINE);
    expect(ADD_THE_GATE_LINE).toContain(GATE_RUN_LINE);
    const followed = `#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`;
    expect(armsFlow(followed)).toBe(true);
    const fitting = status(statusFacts({ gateText: followed, binary: { listed: true, copy: true, path: false } })).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok, fitting?.detail).toBe(true);
  });

  it("never overwrites flow's OLD gate either, and says which line to replace", () => {
    const old = planInit({ ...bare, gateText: OLD_GATE });
    expect(old.gate).toBeNull();
    expect(old.gateOld).toBe(true);
    const said = initLines(old, []).join("\n");
    expect(said, "the same instruction status gives, in the same words").toContain(UPDATE_THE_GATE_LINE);
    expect(said).not.toContain(ADD_THE_GATE_LINE);
    expect(planInit({ ...bare, gateText: PRE_COMMIT }).gateKept, "today's gate is simply kept").toBe(false);
  });

  // THE SAME GAP AS A HOOK THAT NEVER RAN FLOW: the old verb's line, replaced by the run line alone,
  // still finds flow on the PATH alone. Followed to the letter, the advice runs the repo's own first.
  it("names both of the gate's lines for the old verb too, and a gate that follows it finds the repo's own flow", () => {
    expect(UPDATE_THE_GATE_LINE).toContain(GATE_LOCAL_LINE);
    expect(UPDATE_THE_GATE_LINE).toContain(GATE_RUN_LINE);
    const followed = OLD_GATE.replace(/^exec flow commit .*$/m, `${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}`);
    expect(armsFlow(followed)).toBe(true);
    expect(armsOldFlow(followed)).toBe(false);
    const fitting = status(statusFacts({ gateText: followed, binary: { listed: true, copy: true, path: false } })).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok, fitting?.detail).toBe(true);
  });
});

// ── status ───────────────────────────────────────────────────────────────────

const noteAtTurnEnd = { kind: "breadcrumb", at: ["turn-end"], text: "late" } as const;

const statusFacts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  harness: host,
  root: "/repo",
  version: "1.2.3",
  off: false,
  configPath: "/repo/flow.config.ts",
  hasConfig: true,
  load: { ok: true, entries: [] },
  gateText: PRE_COMMIT,
  hooksPath: HOOKS_DIR,
  hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], preCommitText: PRE_COMMIT, preCommitExecutable: true },
  settingsPath: "/home/host/settings.json",
  settings: host.registering.withRegistrations({}).settings,
  machine: null,
  grammars: [],
  session: null,
  ignored: [],
  snapshotInclude: [],
  binary: { listed: false, copy: false, path: true },
  ...over,
});

/** A fresh clone's hooks folder: `core.hooksPath` unset, and `.git/hooks` holding only git's samples. */
const FRESH_CLONE: HooksFolder = { dir: ".git/hooks", files: ["pre-commit.sample", "pre-push.sample"], preCommitText: null, preCommitExecutable: false };

/** The gate an older `flow init` wrote: today's, without the line that runs the repo's own package first. */
const PATH_ONLY_GATE = PRE_COMMIT.replace(`${GATE_LOCAL_LINE}\n`, "");

describe("gateWithoutFlow — the commit gate with flow's lines taken out", () => {
  it("deletes the gate today's flow writes, and the gates earlier releases wrote", () => {
    expect(gateWithoutFlow(PRE_COMMIT)).toEqual({ delete: true });
    expect(gateWithoutFlow(PATH_ONLY_GATE), "0.2.2's gate").toEqual({ delete: true });
    expect(gateWithoutFlow(OLD_GATE), "the gate before `flow hook commit`").toEqual({ delete: true });
  });

  it("takes flow's lines out of a hook of somebody's own, and keeps the rest of it", () => {
    const theirs = "#!/bin/sh\n# run the tests first\nnpm test || exit 1\n";
    expect(gateWithoutFlow(`${theirs}${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`)).toEqual({ delete: false, body: theirs });
    expect(gateWithoutFlow(`${theirs}flow hook commit\n\n`), "0.2.2's advice").toEqual({ delete: false, body: theirs });
    expect(gateWithoutFlow(`${theirs}flow commit $(git diff --cached --name-only)\n`), "0.1's advice").toEqual({
      delete: false,
      body: theirs,
    });
  });

  it("leaves a hook with no line of flow's, and a line somebody spelled their own way", () => {
    expect(gateWithoutFlow(null)).toBeNull();
    expect(gateWithoutFlow("#!/bin/sh\nnpm test\n")).toBeNull();
    expect(gateWithoutFlow("#!/bin/sh\n# exec flow hook commit\n"), "a comment runs nothing").toBeNull();
    expect(gateWithoutFlow("#!/bin/sh\nnpx flow hook commit\n")).toBeNull();
  });
});

/** The machine-wide settings file, absolute, as the shell hands it over. */
const MACHINE_SETTINGS = "/home/me/host/settings.json";

/**
 * A repo `flow init` set up with a global flow: the gate, the hooks path, the state directory and the
 * link, and flow's hooks in the machine-wide file beside a key of the person's own.
 */
const wired: UninstallFacts = {
  harness: host,
  hasConfig: true,
  gateText: PRE_COMMIT,
  hooksPath: HOOKS_DIR,
  subfolderOf: null,
  hooksDir: ["pre-commit"],
  hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], preCommitText: PRE_COMMIT, preCommitExecutable: true },
  hasFlowDir: true,
  linked: true,
  listed: false,
  settings: null,
  settingsUnreadable: false,
  machineFlag: false,
  machineFile: { path: MACHINE_SETTINGS, settings: host.registering.withRegistrations({ theme: "dark" }).settings, unreadable: false },
};

describe("planUninstall — a repo flow init set up", () => {
  const plan = planUninstall(wired);

  it("removes the gate, the hooks path, the folder, the state directory and the link, and keeps the config", () => {
    expect(plan.gate).toEqual({ path: GATE_PATH, body: null });
    expect(plan.hooksPath).toBe(true);
    expect(plan.hooksDir).toBe(true);
    expect(plan.flowDir).toBe(true);
    expect(plan.link).toBe(true);
    expect(plan.settings, "a global install's hooks are in the machine-wide file, which plain uninstall leaves").toBeNull();
    expect(plan.keptConfig).toBe(true);
  });

  it("reports each removal, the config it kept, and ends with the global package's npm uninstall", () => {
    const bare = planUninstall({ ...wired, machineFile: { ...wired.machineFile, settings: null } });
    expect(uninstallLines(bare, [])).toEqual([
      "flow uninstall — removed:",
      `  - ${GATE_PATH}`,
      "  - core.hooksPath (it was .githooks)",
      "  - .githooks/",
      "  - .flow/ — flow's state and logs",
      "  - node_modules/@jawache/flow — the link `flow init` made",
      "  · kept flow.config.ts and the packs it imports — `flow init` wires this repo again.",
      "  next: `npm uninstall -g @jawache/flow` — removes the package.",
    ]);
    expect(uninstallCode(bare, [])).toBe(0);
  });

  it("says the machine-wide file still holds flow's hooks, and names --machine beside the report and in its last line", () => {
    expect(plan.machineHolds).toBe(MACHINE_SETTINGS);
    expect(uninstallLines(plan, []).slice(-2)).toEqual([
      `  · ${MACHINE_SETTINGS} still holds flow's hooks, and every repo on this machine runs them — \`flow uninstall --machine\` removes them.`,
      "  next: `flow uninstall --machine` once no repo on this machine needs flow, then `npm uninstall -g @jawache/flow` — removes the hooks, then the package.",
    ]);
    expect(uninstallCode(plan, []), "a hint, not a failure").toBe(0);
  });

  it("says nothing of the machine-wide file when --machine cleans it, when it holds none of flow's, when it will not parse, or when the hooks are the repo's own", () => {
    expect(planUninstall({ ...wired, machineFlag: true }).machineHolds).toBeNull();
    expect(planUninstall({ ...wired, machineFile: { ...wired.machineFile, settings: { theme: "dark" } } }).machineHolds).toBeNull();
    expect(planUninstall({ ...wired, machineFile: { ...wired.machineFile, settings: null, unreadable: true } }).machineHolds).toBeNull();
    expect(planUninstall({ ...wired, listed: true }).machineHolds, "a dev dependency's hooks are in the repo's own file").toBeNull();
    expect(uninstallLines(planUninstall({ ...wired, machineFlag: true }), []).at(-1)).toBe("  next: `npm uninstall -g @jawache/flow` — removes the package.");
  });

  it("says there is nothing to remove in a repo flow never touched", () => {
    const none = planUninstall({ ...wired, hasConfig: false, gateText: null, hooksPath: null, hooksDir: null, hasFlowDir: false, linked: false });
    expect(uninstallLines(none, [])[0]).toBe("flow uninstall — nothing of flow's here to remove.");
  });

  it("lists a step that failed, and answers 1", () => {
    const plan = planUninstall(wired);
    const said = uninstallLines(plan, [`could not delete ${GATE_PATH}: EACCES`]);
    expect(said.at(-2)).toBe(`  ✗ could not delete ${GATE_PATH}: EACCES`);
    expect(said.at(-1)).toContain("next:");
    expect(uninstallCode(plan, ["x"])).toBe(1);
  });
});

describe("planUninstall — hooks of somebody's own", () => {
  it("keeps core.hooksPath and the folder while another hook is in it, and names that hook", () => {
    const plan = planUninstall({ ...wired, hooksDir: ["commit-msg", "pre-commit"] });
    expect(plan.gate?.body).toBeNull();
    expect(plan.hooksPath).toBe(false);
    expect(plan.hooksDir).toBe(false);
    expect(uninstallLines(plan, []).join("\n")).toContain("kept core.hooksPath at .githooks — git still runs the hooks there: commit-msg.");
  });

  it("keeps a gate with lines of its own, rewritten, and the hooks path that runs it", () => {
    const plan = planUninstall({ ...wired, gateText: `#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n` });
    expect(plan.gate).toEqual({ path: GATE_PATH, body: "#!/bin/sh\nnpm test\n" });
    expect(plan.hooksPath).toBe(false);
    expect(plan.hookCallsFlow, "nothing left calls flow").toBeNull();
    const said = uninstallLines(plan, []).join("\n");
    expect(said).toContain(`  - flow's lines from ${GATE_PATH} — the rest of the hook is kept`);
    expect(said).toContain("git still runs the hooks there: pre-commit.");
  });

  it("names a gate line flow did not write that still calls flow, and puts deleting it first in the next line", () => {
    const plan = planUninstall({ ...wired, gateText: "#!/bin/sh\nnpm test\nnpx flow hook commit\n", machineFile: { ...wired.machineFile, settings: null } });
    expect(plan.gate).toBeNull();
    expect(plan.hookCallsFlow).toEqual({ path: GATE_PATH, lines: ["npx flow hook commit"] });
    const said = uninstallLines(plan, []);
    expect(said).toContain(
      `  · ${GATE_PATH} still calls flow, and flow takes out only the lines it wrote there itself. Delete this line from it yourself, or every commit fails with \`flow: not found\` once flow is gone:`,
    );
    expect(said).toContain("      npx flow hook commit");
    expect(said.at(-1)).toBe(`  next: delete flow's lines from ${GATE_PATH}, then \`npm uninstall -g @jawache/flow\` — removes the package.`);
  });

  it("keeps core.hooksPath when the run is in a subfolder, says so, and names the top folder to run it in", () => {
    const plan = planUninstall({ ...wired, subfolderOf: "/home/me/repo", gateText: null, hooksDir: null, hasFlowDir: false, linked: false });
    expect(plan.hooksPath).toBe(false);
    expect(plan.hooksDir).toBe(false);
    expect(plan.hooksPathFrom).toBe("/home/me/repo");
    const said = uninstallLines(plan, []);
    expect(said[0], "it saw flow's hooks path, so it does not say there is nothing of flow's").toBe("flow uninstall — removed nothing from this folder.");
    expect(said).toContain(
      "  · kept core.hooksPath at .githooks — git reads it for the whole repo, and this run is in a subfolder. Run `flow uninstall` in /home/me/repo to remove it with the gate.",
    );
    expect(said.at(-1)).toBe("  next: `flow uninstall` in /home/me/repo — removes the gate and core.hooksPath.");
  });

  it("unsets core.hooksPath at the top folder when .githooks/ is already gone", () => {
    const plan = planUninstall({ ...wired, gateText: null, hooksDir: null });
    expect(plan.hooksPath).toBe(true);
    expect(plan.hooksPathFrom).toBeNull();
    expect(uninstallLines(plan, [])).toContain("  - core.hooksPath (it was .githooks)");
  });

  it("names no top folder for a subfolder run when core.hooksPath points somewhere else", () => {
    expect(planUninstall({ ...wired, subfolderOf: "/home/me/repo", hooksPath: ".husky/_" }).hooksPathFrom).toBeNull();
  });

  it("leaves a core.hooksPath that points somewhere else", () => {
    const plan = planUninstall({ ...wired, hooksPath: ".husky/_" });
    expect(plan.hooksPath).toBe(false);
    expect(plan.hooksKept).toEqual([]);
    expect(plan.hooksDir, "the folder flow wrote still goes").toBe(true);
  });
});

// ── another folder's pre-commit hook ──
//
// Git runs husky's hooks, or a hook in `.git/hooks`, and the pre-commit hook a person edits for it
// was told by `flow init` to call flow. Uninstall never edits that hook: it names it and its lines.

/** The two lines `flow init` tells a person to add to a hook it does not write. */
const FLOWS_TWO = `${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`;

/** A husky repo after `flow init`: git runs `.husky/_`, whose stub runs `.husky/pre-commit`. */
const huskyRepo = (preCommitText: string): UninstallFacts => ({
  ...wired,
  hooksPath: ".husky/_",
  hooksFolder: { dir: ".husky/_", files: ["pre-commit"], preCommitText, preCommitExecutable: false },
});

describe("flowLinesOf — a hook's lines that call flow", () => {
  it("names flow's two lines, today's and an older release's, trimmed, and nothing of the hook's own", () => {
    expect(flowLinesOf(`npm test\n  ${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`)).toEqual([GATE_LOCAL_LINE, GATE_RUN_LINE]);
    expect(flowLinesOf("npm test\nflow commit $(git diff --cached --name-only)\n")).toEqual(["flow commit $(git diff --cached --name-only)"]);
    expect(flowLinesOf("npx flow hook commit\n"), "a line somebody spelled their own way still calls flow").toEqual(["npx flow hook commit"]);
  });

  it("names none in a hook that does not call flow, a comment, or no hook", () => {
    expect(flowLinesOf("npm test\n# exec flow hook commit\n")).toEqual([]);
    expect(flowLinesOf("echo workflow hook committed\n")).toEqual([]);
    expect(flowLinesOf(null)).toEqual([]);
  });
});

describe("planUninstall — another folder's pre-commit hook that calls flow", () => {
  it("leaves the hook as it is, names it and flow's two lines, and says to delete them before npm uninstall", () => {
    const plan = planUninstall({ ...huskyRepo(`npm test\n${FLOWS_TWO}`), machineFile: { ...wired.machineFile, settings: null } });
    expect(plan.hookCallsFlow).toEqual({ path: ".husky/pre-commit", lines: [GATE_LOCAL_LINE, GATE_RUN_LINE] });
    expect(plan.gate, "the .githooks gate init wrote beside it still goes").toEqual({ path: GATE_PATH, body: null });
    const said = uninstallLines(plan, []);
    const at = said.findIndex((line) => line.startsWith("  · .husky/pre-commit still calls flow"));
    expect(said.slice(at, at + 3)).toEqual([
      "  · .husky/pre-commit still calls flow, and flow takes out only the lines it wrote there itself. " +
        "Delete these lines from it yourself, or every commit fails with `flow: not found` once flow is gone:",
      `      ${GATE_LOCAL_LINE}`,
      `      ${GATE_RUN_LINE}`,
    ]);
    expect(said.at(-1)).toBe("  next: delete flow's lines from .husky/pre-commit, then `npm uninstall -g @jawache/flow` — removes the package.");
    expect(uninstallCode(plan, []), "a step for the person, not a failure").toBe(0);
  });

  it("puts the hook's lines first in a next line that also names --machine", () => {
    expect(uninstallLines(planUninstall(huskyRepo(FLOWS_TWO)), []).at(-1)).toBe(
      "  next: delete flow's lines from .husky/pre-commit, then `flow uninstall --machine` once no repo on this machine needs flow, then `npm uninstall -g @jawache/flow` — removes the hooks, then the package.",
    );
  });

  it("names a .git/hooks/pre-commit that calls flow, with the one line it holds", () => {
    const plan = planUninstall({
      ...wired,
      hooksPath: null,
      hooksFolder: { dir: ".git/hooks", files: ["pre-commit", "pre-push"], preCommitText: `#!/bin/sh\n${GATE_RUN_LINE}\n`, preCommitExecutable: true },
    });
    expect(plan.hookCallsFlow).toEqual({ path: ".git/hooks/pre-commit", lines: [GATE_RUN_LINE] });
    expect(uninstallLines(plan, []).join("\n")).toContain("Delete this line from it yourself");
  });

  it("names the hook by its full path when the run is in a subfolder", () => {
    expect(planUninstall({ ...huskyRepo(FLOWS_TWO), subfolderOf: "/home/me/repo" }).hookCallsFlow?.path).toBe("/home/me/repo/.husky/pre-commit");
  });

  it("says nothing of a hook that does not call flow, and the next line is the npm uninstall alone", () => {
    const plan = planUninstall({ ...huskyRepo("npm test\n"), machineFile: { ...wired.machineFile, settings: null } });
    expect(plan.hookCallsFlow).toBeNull();
    const said = uninstallLines(plan, []);
    expect(said.join("\n")).not.toContain(".husky/pre-commit");
    expect(said.at(-1)).toBe("  next: `npm uninstall -g @jawache/flow` — removes the package.");
  });

  it("says nothing of flow's own .githooks gate, nor of a folder git could not name", () => {
    expect(planUninstall(wired).hookCallsFlow).toBeNull();
    expect(planUninstall({ ...huskyRepo(FLOWS_TWO), hooksFolder: null }).hookCallsFlow).toBeNull();
  });

  it("names the hook git runs over a .githooks gate that also still calls flow", () => {
    const both = planUninstall({ ...huskyRepo(FLOWS_TWO), gateText: "#!/bin/sh\nnpx flow hook commit\n" });
    expect(both.hookCallsFlow?.path).toBe(".husky/pre-commit");
  });
});

describe("uninstallRefusal — the arguments flow uninstall takes", () => {
  it("takes none, or --machine", () => {
    expect(uninstallRefusal([])).toBeNull();
    expect(uninstallRefusal([MACHINE_FLAG])).toBeNull();
  });

  it("refuses an argument it does not know, rather than going ahead without it, and ends with the usage line", () => {
    for (const args of [["--dry-run"], ["--help"], ["now"], [MACHINE_FLAG, "--help"]]) {
      const word = args.at(-1) ?? "";
      const said = uninstallRefusal(args);
      expect(said).toContain(`unknown argument \`${word}\`; nothing was removed.`);
      expect(said?.split("\n").at(-1)).toBe("usage: flow uninstall [--machine]");
    }
  });
});

describe("hostPath — the PATH git and the host hand their hooks", () => {
  // `npx flow status` and `npm run` put the repo's node_modules/.bin, and every ancestor's, on the
  // PATH of this one run. Counted, a dev dependency's flow is "on the PATH" though git never sees it.
  it("drops the node_modules/.bin npm adds for one run: the repo's own, and an ancestor's", () => {
    const dirs = ["/repo/node_modules/.bin", "/node_modules/.bin", "/opt/homebrew/bin", "/usr/bin"];
    expect(hostPath(dirs, "/repo")).toEqual(["/opt/homebrew/bin", "/usr/bin"]);
    expect(hostPath(["/work/node_modules/.bin/"], "/work/repo"), "a trailing slash is the same folder").toEqual([]);
  });

  it("drops npx's cache of a package it fetched", () => {
    expect(hostPath(["/home/u/.npm/_npx/1a2b3c/node_modules/.bin", "/usr/bin"], "/repo")).toEqual(["/usr/bin"]);
  });

  it("keeps another repo's node_modules/.bin — someone put it on the PATH, so the hooks have it too", () => {
    expect(hostPath(["/elsewhere/node_modules/.bin", "/repo-two/node_modules/.bin"], "/repo")).toEqual([
      "/elsewhere/node_modules/.bin",
      "/repo-two/node_modules/.bin",
    ]);
  });

  it("drops the empty entries a PATH can hold", () => {
    expect(hostPath(["", "/usr/bin", ""], "/repo")).toEqual(["/usr/bin"]);
  });

  // THE FALSE GREEN B5 closes: an old gate and old registrations, flow only as a dev dependency, and
  // status run through npx. The npx folder is not the PATH, so the line is red.
  it("leaves an old gate and old registrations red under npx, with flow only as a dev dependency", () => {
    const holdsFlow = new Set(["/repo/node_modules/.bin"]);
    const onPath = hostPath(["/repo/node_modules/.bin", "/usr/bin"], "/repo").some((dir) => holdsFlow.has(dir));
    const fitting = status(
      statusFacts({ gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS, binary: { listed: true, copy: true, path: onPath } }),
    ).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the hooks and the gate look for flow on the PATH alone");
  });
});

describe("the grammar fitting", () => {
  it("says nothing at all when the config declares no grammar", () => {
    expect(status(statusFacts()).fittings.map((f) => f.id)).not.toContain("grammars");
  });

  it("is green when every declared library is built, and names them", () => {
    const green = status(statusFacts({ grammars: [{ name: "astro", libraryPath: "/repo/grammars/astro.dylib", present: true }] }));
    const fitting = green.fittings.find((f) => f.id === "grammars");
    expect(fitting?.ok).toBe(true);
    expect(fitting?.detail).toContain("astro");
    expect(green.green).toBe(true);
  });

  // THE RED LINE, and the whole reason the fitting exists: a declared grammar whose library is not
  // there is a repo where every rule on that language refuses. Green there would be the exact lie
  // this package was written to delete — a rule that loads, reports armed, and checks nothing.
  it("is a red line naming the FILE when a declared library is missing", () => {
    const red = status(statusFacts({ grammars: [{ name: "astro", libraryPath: "/repo/grammars/astro.dylib", present: false }] }));
    const fitting = red.fittings.find((f) => f.id === "grammars");
    expect(fitting?.ok).toBe(false);
    // The same sentence the resolver gives when a rule on that language is reached — pinned at both
    // ends, because two accounts of one fact is how the worse one survives.
    expect(fitting?.detail).toBe(missingGrammarText("astro", "/repo/grammars/astro.dylib"));
    expect(red.green).toBe(false);
  });
});

/** One loaded entry, as the load hands it over — the shape `status` reads. */
const loaded = (id: string, spec: Record<string, unknown>, categories: readonly string[] = []) => ({
  id,
  pack: id.split(".")[0] as string,
  key: id.split(".").slice(1).join("."),
  spec: spec as never,
  source: {},
  categories,
  phases: [],
});

describe("status — the red lines, each carrying its fix", () => {
  const red = (over: Partial<StatusFacts>): string => statusLines(status(statusFacts(over)), host.delivers).join("\n");

  it("a repo with no config at all", () => {
    const s = status(statusFacts({ hasConfig: false, load: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s, host.delivers).join("\n")).toContain("flow init");
  });

  it("a config that will not load — every refusal, and every rail off until it is fixed", () => {
    const s = status(
      statusFacts({
        load: { ok: false, refusals: [{ code: "no-block-cases", entry: "demo.x", detail: "`demo.x` has no block case." }] },
      }),
    );
    expect(s.green).toBe(false);
    const said = statusLines(s, host.delivers).join("\n");
    expect(said).toContain("has no block case");
    expect(said, "no moment table under a headline saying nothing is armed").not.toContain("commit  ");
  });

  it("an unarmed git gate", () => {
    expect(red({ gateText: null })).toContain("flow init");
    const theirs = red({ gateText: "#!/bin/sh\nnpm test\n" });
    expect(theirs).toContain("does not call flow");
    expect(theirs, "the same instruction init gives, in the same words").toContain(ADD_THE_GATE_LINE);
    const old = red({ gateText: OLD_GATE });
    expect(old, "an old gate still runs, and misses every deletion").toContain("calls the old `flow commit`");
    expect(old, "the same instruction init gives, in the same words").toContain(UPDATE_THE_GATE_LINE);
  });

  it("a hooksPath git was never told about — the one a fresh clone always needs", () => {
    expect(red({ hooksPath: null, hooksFolder: FRESH_CLONE })).toContain(SET_HOOKS_PATH);
  });

  it("a host that is not registered to call flow at all", () => {
    const said = red({ settings: {} });
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow init");
  });

  it("the kill switch, which is not a fault and outranks everything below it", () => {
    const s = status(statusFacts({ off: true }));
    expect(statusLines(s, host.delivers)).toHaveLength(1);
    expect(statusLines(s, host.delivers)[0]).toContain("OFF");
    expect(statusLines(s, host.delivers)[0]).toContain(".flow/off");
  });

  it("counts the reds it found, so a caller's exit code and the page agree", () => {
    const s = status(statusFacts({ gateText: null, hooksPath: null, hooksFolder: FRESH_CLONE }));
    expect(s.green).toBe(false);
    expect(statusLines(s, host.delivers).at(-1)).toContain("2 red lines");
  });

  it("closes on the same answer the exit code is taken from — never a green page that exits 1", () => {
    // One decision, read twice. Every shape below is a different route to not-green, and the close
    // has to follow `green` rather than re-deriving it from the parts.
    const shapes: Partial<StatusFacts>[] = [
      {},
      { gateText: null },
      { hasConfig: false, load: null },
      { settings: {} },
      { load: { ok: true, entries: [loaded("demo.late", noteAtTurnEnd)] } },
      { load: { ok: false, refusals: [{ code: "no-block-cases", entry: "demo.x", detail: "no block case" }] } },
    ];
    for (const shape of shapes) {
      const s = status(statusFacts(shape));
      expect(statusLines(s, host.delivers).at(-1)?.startsWith("green"), JSON.stringify(shape)).toBe(s.green);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELTA — what a call changed, judged, and what is put back
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("stagedChanges — one question to git, and every staged change comes back with what it is", () => {
  it("splits git's -z answer into what the commit holds, what is new, and what it removes", () => {
    // `--no-renames` already split the rename: its old path is a D, its new one an A.
    const z = ["A", "m/2.sql", "M", "src/a.ts", "D", "m/1.sql", "A", "m/1b.sql", "D", "a path with spaces.sql", "T", "bin/x", ""].join("\0");
    expect(stagedChanges(z)).toEqual({
      files: ["m/2.sql", "src/a.ts", "m/1b.sql", "bin/x"],
      added: ["m/2.sql", "m/1b.sql"],
      unchanged: [],
      deleted: ["m/1.sql", "a path with spaces.sql"],
    });
  });

  it("reads nothing staged as an empty commit", () => {
    expect(stagedChanges("")).toEqual({ files: [], added: [], unchanged: [], deleted: [] });
  });
});

describe("treeChanges — the whole tree as one commit, against the last commit's own list", () => {
  const ran = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
  const unasked = (): boolean => {
    throw new Error("HEAD was asked about although the tree answered");
  };

  it("marks what the last commit lacks as new, what it has as it was as unchanged, and what is gone as removed", () => {
    const tree = ran(["m/1.sql", "m/3.sql", "m/gone.sql", "src/a.ts", ""].join("\0"));
    // The diff names the edited file and the removed one; m/2.sql is untracked, so it names neither.
    const differs = ran(["src/a.ts", "m/gone.sql", ""].join("\0"));
    expect(treeChanges(["m/1.sql", "m/2.sql", "m/3.sql", "src/a.ts"], tree, differs, unasked)).toEqual({
      files: ["m/1.sql", "m/2.sql", "m/3.sql", "src/a.ts"],
      added: ["m/2.sql"],
      unchanged: ["m/1.sql", "m/3.sql"],
      deleted: ["m/gone.sql"],
    });
  });

  it("names no file unchanged when the diff failed, so every committed file still reads as an edit", () => {
    const tree = ran(["m/1.sql", ""].join("\0"));
    expect(treeChanges(["m/1.sql"], tree, ran("", 128), unasked)).toEqual({ files: ["m/1.sql"], added: [], unchanged: [], deleted: [] });
  });

  it("treats every file as new before the first commit, when there is no HEAD to list", () => {
    expect(treeChanges(["m/1.sql"], ran("", 128), ran("", 128), () => false)).toEqual({
      files: ["m/1.sql"],
      added: ["m/1.sql"],
      unchanged: [],
      deleted: [],
    });
  });

  it("says nothing is known when git failed for any other reason, so a check refuses rather than allows", () => {
    expect(treeChanges(["m/1.sql"], ran("", 127), ran("", 127), () => true)).toEqual({
      files: ["m/1.sql"],
      added: undefined,
      unchanged: [],
      deleted: [],
    });
  });
});

describe("pathLines — git's one-path-per-line answer", () => {
  it("keeps each path, trimmed, and drops the blank lines", () => {
    expect(pathLines(" a.ts\n\nsrc/b c.ts \n")).toStrictEqual(["a.ts", "src/b c.ts"]);
    expect(pathLines(null), "a command that never ran").toStrictEqual([]);
  });
});

describe("the names flow's own files go by", () => {
  it("spells the config once", () => {
    expect(CONFIG_FILE).toBe("flow.config.ts");
  });

  it("runs the repo's own package by its binary, never a flow in node_modules/.bin", () => {
    expect(PACKAGE_BIN).toBe(`${PACKAGE_DIR}/dist/flow.mjs`);
    expect(PACKAGE_BIN).not.toContain(LOCAL_BIN);
  });

  it("says out loud when git's hooks cannot be wired", () => {
    expect(NOT_INSTALLED).toBe("FLOW IS NOT INSTALLED");
    expect(HOOKS_UNKNOWN).toContain("git rev-parse --git-path hooks");
  });
});

describe("the small spellings every shell leans on", () => {
  it("stringifies a scalar and nothing else, so an object where a path belongs is no path", () => {
    expect(text("a")).toBe("a");
    expect(text(3)).toBe("3");
    expect(text(true)).toBe("true");
    expect(text({ file: "a" })).toBe("");
    expect(text(undefined)).toBe("");
  });

  it("lists paths as a sentence reads them", () => {
    expect(listed([])).toBe("");
    expect(listed(["a"])).toBe("a");
    expect(listed(["a", "b"])).toBe("a and b");
    expect(listed(["a", "b", "c"])).toBe("a, b and c");
  });

  it("runs the repo's own package first, naming the repo as the caller says it", () => {
    expect(repoFirst("$PWD", "hook commit")).toBe(`f="$PWD/${PACKAGE_BIN}"; [ -f "$f" ] && exec node "$f" hook commit`);
  });
});
