// flow/adapter/domain.test.ts — the product's pure home, with no harness in the room.
//
// What `flow init`, `flow uninstall`, `flow status` and `flow facts` decide, the git gate, and the
// reading of a conversation once it is events. The harness a verb is handed comes from
// `__fixtures__/host.ts`, so this file names none; what is one harness's own — its payloads, its
// settings file, its transcripts — is proved in that harness's folder.
import { describe, it, expect } from "vitest";
import { type Bound, type Row } from "../engine/domain.ts";
import { missingGrammarText } from "../checks/domain.ts";
import { matchAny } from "../glob.ts";
import { host } from "../__fixtures__/host.ts";
import { ADD_THE_GATE_LINE, CONFIG_FILE, type Candidate, GATE_LOCAL_LINE, GATE_PATH, GATE_RUN_LINE, GIT_HOOK_ENV, HOOKS_DIR, HOOKS_UNKNOWN, type HooksFolder, type InitFacts, LOCAL_BIN, MACHINE_FLAG, NODE_FLOOR, NOT_INSTALLED, type OtherHooks, PACKAGE_BIN, PACKAGE_DIR, PRE_COMMIT, SET_HOOKS_PATH, type StatusFacts, UPDATE_THE_GATE_LINE, type UninstallFacts, armsFlow, armsOldFlow, classifyBash, commitScope, configImports, configLoadFault, flowLinesOf, gateWithoutFlow, guardPaths, health, hermeticEnv, hooksDirOf, hostPath, initCode, initLines, isCorrection, joinSpawn, listed, loadsAsStrippedModule, mergeNarratives, narrative, notInstalledLines, otherHooks, pathLines, planInit, planUninstall, preCommitOf, recipeTools, repoFirst, scaffold, selectSessions, snip, stagedChanges, status, statusCode, statusLines, strip, text, treeChanges, uncoveredAreas, uninstallCode, uninstallLines, uninstallRefusal, wantsColour, weakenedAfterBlock } from "./domain.ts";
import { type ToolAction, type TranscriptEvent } from "./harness.ts";



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
    action: (({ Write: "write", Edit: "edit", MultiEdit: "edit", Read: "read", Bash: "shell" }) as Record<string, ToolAction>)[name] ?? "other",
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
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", action: "shell", input: { command: "cat src/a.ts src/c.ts" }, path: "", reads: ["src/a.ts", "src/c.ts"] };
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
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", action: "shell", input: { command: "cat src/a.ts" }, path: "", reads: ["src/a.ts"] };
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
    const dirs = [`/repo/${LOCAL_BIN}`, "/node_modules/.bin", "/opt/homebrew/bin", "/usr/bin"];
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
  const red = (over: Partial<StatusFacts>): string => statusLines(status(statusFacts(over))).join("\n");

  it("a repo with no config at all", () => {
    const s = status(statusFacts({ hasConfig: false, load: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s).join("\n")).toContain("flow init");
  });

  it("a config that will not load — every refusal, and every rail off until it is fixed", () => {
    const s = status(
      statusFacts({
        load: { ok: false, refusals: [{ code: "no-block-cases", entry: "demo.x", detail: "`demo.x` has no block case." }] },
      }),
    );
    expect(s.green).toBe(false);
    const said = statusLines(s).join("\n");
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
    expect(statusLines(s)).toHaveLength(1);
    expect(statusLines(s)[0]).toContain("OFF");
    expect(statusLines(s)[0]).toContain(".flow/off");
  });

  it("counts the reds it found, so a caller's exit code and the page agree", () => {
    const s = status(statusFacts({ gateText: null, hooksPath: null, hooksFolder: FRESH_CLONE }));
    expect(s.green).toBe(false);
    expect(statusLines(s).at(-1)).toContain("2 red lines");
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
      expect(statusLines(s).at(-1)?.startsWith("green"), JSON.stringify(shape)).toBe(s.green);
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


describe("the narrative — the pairing, and the pointers it produces", () => {
  it("reads typed prompts, tool calls and their results, each with its line", () => {
    const file = store(
      { type: "user", message: { content: "<system-reminder>injected</system-reminder>" } },
      spoke("please fix the build"),
      spokeBack([used("Bash", { command: "just test" }, "toolu_1")], "2026-01-01T09:00:00.000Z"),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }] } },
      spokeBack([used("Edit", { file_path: "/repo/src/a.ts" }, "toolu_2")]),
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ text: "boom" }], is_error: true }] },
      },
    );
    expect(host.transcripts.events(file, "/repo")).toEqual([
      // The injected reminder is NOT a prompt: the harness talking to itself is not the human.
      { line: 2, kind: "prompt", text: "please fix the build" },
      { line: 3, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "toolu_1", name: "Bash", action: "shell", input: { command: "just test" }, path: "" },
      { line: 4, kind: "result", id: "toolu_1", content: "ok", failed: false },
      {
        line: 5,
        kind: "use",
        ts: "2026-01-01T00:00:00.000Z",
        id: "toolu_2",
        name: "Edit",
        action: "edit",
        input: { file_path: "/repo/src/a.ts" },
        path: "src/a.ts",
      },
      { line: 6, kind: "result", id: "toolu_2", content: "boom", failed: true },
    ]);
  });

  it("carries the repo files a Bash call reads, from the directory the record says it ran in", () => {
    const file = store(
      { ...spokeBack([used("Bash", { command: "cat a.ts; rg x lib; cat /etc/hosts" })]), cwd: "/repo/src" },
      spokeBack([used("Bash", { command: "cat a.ts" }, "t2")]),
      spokeBack([used("Bash", { command: "cat ~/a.ts" }, "t3")]),
    );
    const uses = host.transcripts.events(file, "/repo", "/repo/home");
    // Only files read by name: a searched directory is not a file, and outside the repo is not an area.
    expect(uses[0]).toMatchObject({ name: "Bash", reads: ["src/a.ts"] });
    // No `cwd` on the record: the call is taken to have run at the root.
    expect(uses[1]).toMatchObject({ reads: ["a.ts"] });
    expect(uses[2]).toMatchObject({ reads: ["home/a.ts"] });
    // With no repo to be relative to there is nothing to count in.
    expect(host.transcripts.events(file)[0]).not.toHaveProperty("reads");
  });

  it("a result carrying an object rather than text is still readable", () => {
    const file = store({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: { n: 1 } }] } });
    expect(host.transcripts.events(file)[0]).toMatchObject({ kind: "result", content: '{"n":1}', failed: false });
  });

  it("leaves a background task's notice out of the prompts, so its result is never read as the human's correction", () => {
    // The host writes the notice as a user line. The agent's own result is inside it, and reads as
    // pushback as often as not: "instead", "rather than", "undo". Either mark is a notice.
    const file = store(
      spoke("no, revert that"),
      spoke("<task-notification>\n<result>Used a map instead of a list.</result>\n</task-notification>"),
      { ...spoke("Agent finished: it chose a set instead."), origin: { kind: "task-notification" } },
    );
    const read = narrative(host.transcripts.events(file));
    expect(read.prompts).toEqual([{ line: 1, text: "no, revert that" }]);
    expect(read.corrections).toEqual([{ line: 1, text: "no, revert that" }]);
  });

  it("spots the human pushing back — a heuristic, which is why every finding cites its line", () => {
    expect(isCorrection("actually, revert that")).toBe(true);
    expect(isCorrection("you forgot the test")).toBe(true);
    // `no,` — the commonest spelling of pushback there is, and the one the ported regex could
    // never match: its alternative ended in a punctuation class and was then asked for a word
    // boundary, which a comma followed by a space can never be. A dead alternative in a detector
    // is the spec's own P2 shape, so the anchoring moved outside the class.
    expect(isCorrection("no, the other one")).toBe(true);
    expect(isCorrection("wait, that is not it")).toBe(true);
    expect(isCorrection("please add a test for the parser")).toBe(false);
    expect(isCorrection("the manifest has no, or few, entries")).toBe(true);
  });

  it("shortens for printing, and MARKS the cut so a truncated line never reads as a whole one", () => {
    expect(snip("  a\n  b  ")).toBe("a b");
    expect(snip("abcdefghij", 5)).toBe("abcd…");
    expect(strip("[31mred[0m")).toBe("red");
    expect(strip(undefined)).toBe("");
  });
});

describe("the reading — the join, the coverage answer, and the lines a person reads", () => {
  const bound: Bound[] = [
    { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["write"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    { kind: "guardrail", id: "core.off", pack: "core", at: ["write"], on: ["docs/**"], for: [], description: null, says: null, disabled: "superseded" },
  ];

  it("joins a subagent's two host-written records, and keeps what only one of them knows", () => {
    const spawns = new Map([
      ["toolu_9", { toolUseId: "toolu_9", asked: "general-purpose", description: "Build F5", ts: "2026-01-01T10:00:00.000Z", line: 12 }],
    ]);
    // A builder hidden inside a generic bucket: the parent CLAIMED general-purpose, the host WROTE
    // builder, and only one of those is evidence.
    expect(
      joinSpawn({ session: "s1", agent: "agent-1", meta: host.transcripts.spawnMeta('{"agentType":"builder","toolUseId":"toolu_9","model":"opus"}'), spawns }),
    ).toEqual({
      session: "s1",
      agent: "agent-1",
      agentType: "builder",
      description: "Build F5",
      model: "opus",
      asked: "general-purpose",
      at: "2026-01-01T10:00:00.000Z",
      line: 12,
    });

    // No sidecar at all: spawned, as what we cannot say — and nothing is invented to fill it.
    expect(joinSpawn({ session: "s1", agent: "agent-2", meta: null, spawns })).toEqual({
      session: "s1",
      agent: "agent-2",
      agentType: null,
      description: null,
      model: null,
      asked: null,
      at: null,
      line: null,
    });

    // A sidecar whose id names no block in the parent: what it alone knows still crosses.
    const orphan = joinSpawn({ session: "s1", agent: "agent-3", meta: host.transcripts.spawnMeta('{"agentType":"verifier","toolUseId":"toolu_x"}'), spawns });
    expect(orphan).toMatchObject({ agentType: "verifier", asked: null, line: null });
  });

  it("answers coverage from the TRANSCRIPT, which reaches conversations the record cannot", () => {
    expect(uncoveredAreas({ "src/a.ts": 3, "docs/x.md": 9, "README.md": 1 }, bound)).toEqual([
      // `docs/**` is watched by an entry that is TURNED OFF, so it is not watched.
      { path: "docs/x.md", touches: 9 },
      { path: "README.md", touches: 1 },
    ]);
    expect(uncoveredAreas({}, bound)).toEqual([]);
  });
});

describe("planInit — when git already runs other hooks", () => {
  const block = (plan: ReturnType<typeof planInit>): string[] => {
    const said = initLines(plan, []);
    const at = said.findIndex((line) => line.startsWith(NOT_INSTALLED));
    return at === -1 ? [] : said.slice(at);
  };

  describe("a husky repo whose .husky/pre-commit does not call flow", () => {
    const plan = planInit({ ...bare, ...husky("#!/bin/sh\nnpm test\n") });

    it("leaves core.hooksPath alone, and still writes every other file", () => {
      expect(plan.hooksPath).toBe(false);
      expect(plan.config?.path).toBe("flow.config.ts");
      expect(plan.gate?.path, "the second fix moves hooks in beside this gate").toBe(GATE_PATH);
      expect(plan.flowDir).toBe(true);
      expect(plan.registered).toEqual(REGISTERED_EVENTS);
      expect(initLines(plan, []).join("\n")).not.toContain(`+ ${SET_HOOKS_PATH}`);
    });

    it("ends with the block: the folder git runs hooks from, and both fixes", () => {
      const said = initLines(plan, []);
      const lines = block(plan);
      expect(lines, "the block is the end of the output").toStrictEqual(notInstalledLines({ dir: ".husky/_", preCommit: ".husky/pre-commit", fix: "add" }));
      expect(said[said.length - lines.length - 1], "set apart from the report by a blank line").toBe("");
      const text = lines.join("\n");
      expect(text).toContain("Git runs hooks from .husky/_");
      expect(text).toContain("Add these two lines to the end of .husky/pre-commit:");
      expect(text).toContain(GATE_LOCAL_LINE);
      expect(text).toContain(GATE_RUN_LINE);
      expect(text).toContain(`move those hooks into ${HOOKS_DIR}/`);
      expect(text).toContain(SET_HOOKS_PATH);
    });

    it("answers 1, whatever else landed", () => {
      expect(initCode(plan, [])).toBe(1);
    });

    it("followed to the letter, the first fix wires it", () => {
      const lines = block(plan);
      const at = lines.findIndex((line) => line.includes("Add these two lines to the end of .husky/pre-commit:"));
      const added = lines.slice(at + 1, at + 3).map((line) => line.trim());
      const followed = `#!/bin/sh\nnpm test\n${added.join("\n")}\n`;
      expect(planInit({ ...bare, ...husky(followed) }).otherHooks?.fix).toBeNull();
    });
  });

  describe("when git could not name the folder it runs hooks from", () => {
    // That folder may be husky's, so setting core.hooksPath over it is the very switch-off this guards.
    for (const hooksPath of [".husky/_", HOOKS_DIR, null]) {
      const plan = planInit({ ...bare, hooksPath, hooksFolder: null });

      it(`leaves core.hooksPath alone (set to ${String(hooksPath)}), and says what status says`, () => {
        expect(plan.hooksPath).toBe(false);
        expect(plan.hooksUnknown).toBe(true);
        const said = initLines(plan, []);
        expect(said.join("\n")).not.toContain(`+ ${SET_HOOKS_PATH}`);
        expect(said).toContain(`  ✗ ${HOOKS_UNKNOWN}`);
        expect(plan.gate?.path, "every other file is still written").toBe(GATE_PATH);
      });

      it(`answers 1, since flow cannot tell it is installed (core.hooksPath ${String(hooksPath)})`, () => {
        expect(initCode(plan, [])).toBe(1);
      });
    }

    it("never reads as unknown outside git, or when git named the folder", () => {
      expect(planInit({ ...bare, isGit: false, hooksFolder: null }).hooksUnknown).toBe(false);
      expect(planInit(bare).hooksUnknown).toBe(false);
      expect(planInit(bare).hooksPath, "a fresh clone still gets core.hooksPath").toBe(true);
    });
  });

  it("run again with nothing left to write, it never says the repo is set up above a block saying it is not", () => {
    const again = planInit({
      ...bare,
      ...husky("#!/bin/sh\nnpm test\n"),
      hasConfig: true,
      gateText: PRE_COMMIT,
      hasFlowDir: true,
      resolves: true,
      settings: host.registering.withRegistrations({}).settings,
    });
    const said = initLines(again, []).join("\n");
    expect(said).not.toContain("already set up");
    expect(said).toContain("nothing new to write");
    expect(said).toContain(NOT_INSTALLED);
    expect(initCode(again, [])).toBe(1);
  });

  it("run again with nothing left to write while git cannot name its hooks folder, it never says the repo is set up", () => {
    const again = planInit({
      ...bare,
      hooksFolder: null,
      hasConfig: true,
      gateText: PRE_COMMIT,
      hasFlowDir: true,
      resolves: true,
      settings: host.registering.withRegistrations({}).settings,
    });
    const said = initLines(again, []).join("\n");
    expect(said).not.toContain("already set up");
    expect(said).toContain("nothing new to write");
    expect(initCode(again, [])).toBe(1);
  });

  it("a repo with a hook in .git/hooks names that folder and its pre-commit", () => {
    const plan = planInit({ ...bare, ...gitHooks(["pre-push", "post-checkout"], "#!/bin/sh\nnpm test\n") });
    expect(plan.hooksPath).toBe(false);
    expect(block(plan)[0]).toContain("Git runs hooks from .git/hooks");
    expect(block(plan).join("\n")).toContain("Add these two lines to the end of .git/hooks/pre-commit:");
    expect(initCode(plan, [])).toBe(1);
  });

  describe("a pre-commit hook git runs itself, and the execute bit git needs to run it", () => {
    /** The first fix: the lines from the block's third up to the second fix. */
    const firstFix = (plan: ReturnType<typeof planInit>): string[] => {
      const lines = block(plan);
      return lines.slice(2, lines.findIndex((line) => line.startsWith("  - Or move")));
    };

    it("Git LFS's hooks and no pre-commit yet: create it as an executable shell script", () => {
      const plan = planInit({ ...bare, ...gitHooks(["pre-push", "post-checkout"]) });
      expect(block(plan)[0]).toBe(
        `${NOT_INSTALLED}. Git runs hooks from .git/hooks, and there is no .git/hooks/pre-commit, so no commit runs flow's gate.`,
      );
      expect(firstFix(plan)).toStrictEqual([
        "  - Create .git/hooks/pre-commit with these three lines, then run `chmod +x .git/hooks/pre-commit` so git runs it:",
        "      #!/bin/sh",
        `      ${GATE_LOCAL_LINE}`,
        `      ${GATE_RUN_LINE}`,
      ]);
      expect(block(plan).join("\n"), "the second fix is unchanged").toContain(`move those hooks into ${HOOKS_DIR}/`);
      expect(initCode(plan, [])).toBe(1);
    });

    it("followed to the letter, creating it wires it", () => {
      const created = `${firstFix(planInit({ ...bare, ...gitHooks(["pre-push"]) }))
        .slice(1)
        .map((line) => line.trim())
        .join("\n")}\n`;
      const plan = planInit({ ...bare, ...gitHooks(["pre-push", "pre-commit"], created, true) });
      expect(plan.otherHooks?.fix).toBeNull();
      expect(block(plan)).toStrictEqual([]);
      expect(initCode(plan, [])).toBe(0);
    });

    it("a hook that calls flow without the execute bit: not installed, and it says the file must be executable", () => {
      const plan = planInit({ ...bare, ...gitHooks(["pre-push", "pre-commit"], WIRED, false) });
      expect(block(plan)[0]).toBe(
        `${NOT_INSTALLED}. Git runs hooks from .git/hooks, and .git/hooks/pre-commit calls flow but is not executable, so git ignores it and no commit runs flow's gate.`,
      );
      expect(firstFix(plan)).toStrictEqual(["  - Make .git/hooks/pre-commit executable, so git runs it: `chmod +x .git/hooks/pre-commit`"]);
      expect(initLines(plan, []).join("\n"), "never the quiet note that it calls flow").not.toContain("· git runs hooks from");
      expect(initCode(plan, [])).toBe(1);
    });

    it("a hook that neither calls flow nor has the execute bit: both, in the one fix", () => {
      const plan = planInit({ ...bare, ...gitHooks(["pre-commit"], "#!/bin/sh\nnpm test\n", false) });
      expect(block(plan)[0]).toContain(".git/hooks/pre-commit does not call flow and is not executable, so git ignores it");
      expect(firstFix(plan)[0]).toBe(
        "  - Add these two lines to the end of .git/hooks/pre-commit, then run `chmod +x .git/hooks/pre-commit` so git runs it:",
      );
    });

    it("the chmod to paste leaves a plain path as it is, and single-quotes one the shell would split or expand", () => {
      const chmodOf = (dir: string): string[] =>
        firstFix(planInit({ ...bare, hooksFolder: { dir, files: ["pre-commit"], preCommitText: WIRED, preCommitExecutable: false } }));
      const said = (dir: string, typed: string): string[] => [`  - Make ${dir}/pre-commit executable, so git runs it: \`chmod +x ${typed}\``];
      expect(chmodOf("/main/.git/hooks"), "a worktree's shared folder").toStrictEqual(said("/main/.git/hooks", "/main/.git/hooks/pre-commit"));
      const spaced = "/Users/me/My Projects/app/.git/hooks";
      expect(chmodOf(spaced), "a space, as under ~/My Projects/").toStrictEqual(said(spaced, `'${spaced}/pre-commit'`));
      expect(chmodOf("/it's/$HOME/hooks"), "a quote and a $").toStrictEqual(said("/it's/$HOME/hooks", `'/it'\\''s/$HOME/hooks/pre-commit'`));
    });

    it("husky's .husky/pre-commit, with no execute bit, still counts once it calls flow, and its fix is unchanged", () => {
      expect(initCode(planInit({ ...bare, ...husky(WIRED) }), [])).toBe(0);
      for (const preCommit of [null, "npm test\n"])
        expect(firstFix(planInit({ ...bare, ...husky(preCommit) })), String(preCommit)).toStrictEqual([
          "  - Add these two lines to the end of .husky/pre-commit:",
          `      ${GATE_LOCAL_LINE}`,
          `      ${GATE_RUN_LINE}`,
        ]);
    });
  });

  it("once the hook git runs calls flow, no block, a quiet note, and 0", () => {
    const plan = planInit({ ...bare, ...husky(WIRED) });
    expect(plan.hooksPath, "still never set over husky's").toBe(false);
    expect(block(plan)).toStrictEqual([]);
    expect(initLines(plan, []).join("\n")).toContain("· git runs hooks from .husky/_, and .husky/pre-commit calls flow");
    expect(initCode(plan, [])).toBe(0);
  });

  describe("in a terminal", () => {
    const plan = planInit({ ...bare, ...husky(null) });
    const BOLD_RED = "\u001b[1;31m";
    const RESET = "\u001b[0m";

    it("the block is bold red, line by line, and nothing else is", () => {
      const said = initLines(plan, [], true);
      const at = said.findIndex((line) => line.includes(NOT_INSTALLED));
      expect(said.slice(at)).toStrictEqual(
        notInstalledLines({ dir: ".husky/_", preCommit: ".husky/pre-commit", fix: "add" }).map((line) => `${BOLD_RED}${line}${RESET}`),
      );
      expect(said.slice(0, at).join("\n"), "the report above it stays plain").not.toContain("\u001b[");
    });

    it("is plain when colour is off, and a repo without the block never carries a colour code", () => {
      expect(initLines(plan, [], false).join("\n")).not.toContain("\u001b[");
      expect(initLines(planInit(bare), [], true).join("\n")).not.toContain("\u001b[");
    });

    it("colour is on only in a terminal, and NO_COLOR set to anything but empty turns it off", () => {
      expect(wantsColour(true, undefined)).toBe(true);
      expect(wantsColour(false, undefined), "piped, or written to a file").toBe(false);
      expect(wantsColour(true, "1")).toBe(false);
      expect(wantsColour(true, "0"), "any value, per no-color.org").toBe(false);
      expect(wantsColour(true, ""), "an empty NO_COLOR is unset, per no-color.org").toBe(true);
    });
  });

  it("a repo with no other hooks gets exactly what it got before: the setting, no block, 0", () => {
    const plan = planInit(bare);
    expect(plan.hooksPath).toBe(true);
    expect(block(plan)).toStrictEqual([]);
    expect(initLines(plan, []).join("\n")).not.toContain("git runs hooks from");
    expect(initCode(plan, [])).toBe(0);
    expect(initCode(plan, ["could not write .githooks/pre-commit: EACCES"]), "a failure is still a 1").toBe(1);
  });
});

describe("planInit — the second run", () => {
  const already = planInit({
    ...bare,
    hasConfig: true,
    gateText: PRE_COMMIT,
    hasFlowDir: true,
    hooksPath: HOOKS_DIR,
    hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], preCommitText: PRE_COMMIT, preCommitExecutable: true },
    resolves: true,
    settings: host.registering.withRegistrations({}).settings,
  });

  it("adds nothing at all", () => {
    expect(already.config).toBeNull();
    expect(already.gate).toBeNull();
    expect(already.flowDir).toBe(false);
    expect(already.link).toBeNull();
    expect(already.hooksPath).toBe(false);
    expect(already.settings).toBeNull();
    expect(already.registered).toEqual([]);
  });

  it("says so in one line rather than printing an empty list", () => {
    expect(initLines(already, []).join("\n")).toContain("already set up");
  });
});

describe("the guard's own files — the repo's half read out of the config's text, and the host's", () => {
  // The config as this repo writes it, and as a broken one still reads: the imports survive
  // whatever went wrong two hundred lines below them.
  const CONFIG = [
    `import { defineConfig, pack } from "@jawache/flow";`,
    `import { flow } from "@jawache/flow/packs";`,
    `import { house } from "./guards/house.ts";`,
    ``,
    `export default defineConfig([pack(flow), pack(house)]);`,
  ].join("\n");

  it("is the config, the packs it imports and the host's half, and nothing else", () => {
    // MEMBERSHIP, never order: the one caller asks whether a path is in the list, so an order
    // pinned here would break on a reshuffle that changes nothing a user sees.
    const paths = guardPaths(CONFIG, host.registering.hostSurface);
    expect(paths, "the host's half is there, whole").toEqual(expect.arrayContaining([...host.registering.hostSurface]));
    expect(matchAny(CONFIG_FILE, paths)).toBe(true);
    expect(matchAny("guards/house.ts", paths)).toBe(true);
    expect(matchAny("guards/git.ts", paths), "the folder comes with the file").toBe(true);
    expect(matchAny("guards/nested/deep.ts", paths)).toBe(true);
    expect(matchAny("src/a.ts", paths)).toBe(false);
    expect(matchAny("cli/work.ts", paths)).toBe(false);
    // Not a suffix match: a file that merely ENDS with the config's name is somebody else's.
    expect(matchAny("vendor/flow.config.ts", paths)).toBe(false);
    expect(matchAny("src/guards/thing.ts", paths), "the folder is where the import said").toBe(false);
  });

  it("follows whatever the repo called the folder, and reaches nothing when the config names nothing", () => {
    // The whole point of reading the text: `guards/` is one repo's name for it, and the engine
    // knows no folder name of its own.
    const theirs = guardPaths(`import { house } from "./.guard/house.ts";`, host.registering.hostSurface);
    expect(matchAny(".guard/house.ts", theirs)).toBe(true);
    expect(matchAny(".guard/helpers/text.ts", theirs)).toBe(true);
    expect(matchAny("guards/house.ts", theirs)).toBe(false);
    // A config with every rule written inline imports no pack, so the repo's half is the config alone.
    const inline = guardPaths(`import { defineConfig } from "@jawache/flow";`, host.registering.hostSurface);
    expect(new Set(inline)).toStrictEqual(new Set([CONFIG_FILE, ...host.registering.hostSurface]));
    expect(new Set(guardPaths(null, host.registering.hostSurface))).toStrictEqual(new Set([CONFIG_FILE, ...host.registering.hostSurface]));
  });

  it("reads the TEXT, not the module — which is the only reader a broken config has", () => {
    // Package specifiers are somebody else's source, never this repo's guard; `../` climbs out
    // of the root, where repo-relative paths cannot follow.
    expect(configImports(CONFIG)).toStrictEqual(["guards/house.ts"]);
    expect(configImports(`import x from "../outside/y.ts";`)).toStrictEqual([]);
    expect(configImports(`const m = await import("./late/pack.ts");`)).toStrictEqual(["late/pack.ts"]);
    expect(configImports(`export { a } from "./again.ts";\nimport { b } from "./again.ts";`)).toStrictEqual(["again.ts"]);
    // The file below is not typescript at all any more, and its import line still answers.
    expect(configImports(`import { house } from "./guards/house.ts";\nthis is not typescript(((`)).toStrictEqual([
      "guards/house.ts",
    ]);
    // A `from '…'` phrase inside a QUOTED MESSAGE is harvested too, and that is the accepted
    // behaviour rather than a miss: separating a real import from a sentence that quotes one takes
    // a parser, and the file being asked about may be one that will not parse. Pinned here because
    // it only ever WIDENS the guard's paths, so the cost is one extra path reported as a guard file.
    expect(configImports(`.message("write it as: import { x } from './guards/x.ts'")`)).toStrictEqual(["guards/x.ts"]);
  });
});

describe("the binary fitting — can the hooks and the gate find flow", () => {
  const binary = (modules: boolean, path: boolean, over: Partial<StatusFacts> = {}) => {
    const s = status(statusFacts({ binary: { listed: modules, copy: modules, path }, ...over }));
    return { fitting: s.fittings.find((f) => f.id === "binary"), green: s.green, lines: statusLines(s) };
  };

  it("fixes its two old shapes as fixtures: a gate without the PATH line, and the bare registration", () => {
    expect(armsFlow(PATH_ONLY_GATE)).toBe(true);
    expect(PATH_ONLY_GATE).not.toContain(PACKAGE_BIN);
    expect(host.registering.bareRegistrations(BARE_SETTINGS)).toEqual(host.registering.registrations.map((r) => r.event));
  });

  it("names the PATH when only the PATH has one, in the tutorial's words", () => {
    const { lines, green } = binary(false, true);
    expect(lines).toContain("  ✓ binary: the hooks and the gate run the flow on the PATH");
    expect(green).toBe(true);
  });

  // THE DEV DEPENDENCY: today's gate and registrations run the repo's own package first, so the
  // repo's copy answers them with no flow on the PATH, and wins over one that is there.
  it("names node_modules/@jawache/flow when the repo has its own, whatever the PATH holds", () => {
    for (const path of [false, true]) {
      const { lines, green } = binary(true, path);
      expect(lines).toContain("  ✓ binary: the hooks and the gate run the flow in node_modules/@jawache/flow");
      expect(green).toBe(true);
    }
  });

  it("judges a gate older `flow init` wrote by the PATH alone, and says how to bring it up to date", () => {
    const { fitting, green } = binary(true, false, { gateText: PATH_ONLY_GATE });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toBe(
      "the flow in node_modules/@jawache/flow is not on the PATH, and the gate looks for flow on the PATH alone, so git refuses every commit — " +
        'add `f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit` to .githooks/pre-commit above the line that runs flow; ' +
        "or install it for every repo with `npm i -g @jawache/flow`.",
    );
    expect(green).toBe(false);
    expect(binary(true, false, { gateText: OLD_GATE }).fitting?.detail, "the old verb's gate too").toContain("the gate looks for flow on the PATH alone");
  });

  // THE LINE, NOT THE TEXT: a gate that runs another tool from node_modules/.bin, with no PATH
  // line, still finds flow on the PATH alone — and git fails every commit with `flow: not found`.
  it("judges a gate that names node_modules/.bin only for another tool by the PATH alone", () => {
    const lintFirst = "#!/bin/sh\nnode_modules/.bin/lint-staged && flow hook commit\n";
    expect(armsFlow(lintFirst)).toBe(true);
    const { fitting, green } = binary(true, false, { gateText: lintFirst });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the gate looks for flow on the PATH alone");
    expect(fitting?.detail).toContain(`add \`${GATE_LOCAL_LINE}\` to .githooks/pre-commit`);
    expect(green).toBe(false);
    expect(binary(true, false, { gateText: `#!/bin/sh\n  ${GATE_LOCAL_LINE}\nnode_modules/.bin/lint-staged && flow hook commit\n` }).fitting?.ok,
      "the line itself, indented, puts the repo's copy first").toBe(true);
  });

  it("judges registrations in the old shape by the PATH alone, and names `flow init` as the fix", () => {
    const { fitting, green } = binary(true, false, { settings: BARE_SETTINGS });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the hooks look for flow on the PATH alone, so every hook fails with `flow: not found`");
    expect(fitting?.detail).toContain("re-run `flow init`");
    expect(fitting?.detail).not.toContain("the gate");
    expect(green).toBe(false);
  });

  it("names both when both are old", () => {
    const { fitting } = binary(true, false, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS });
    expect(fitting?.detail).toContain("the hooks and the gate look for flow on the PATH alone");
    expect(fitting?.detail).toContain("every hook fails with `flow: not found` and git refuses every commit");
  });

  it("is green over old callers when the PATH has one, and says which copy each runs", () => {
    expect(binary(true, true, { settings: BARE_SETTINGS }).fitting).toEqual({
      id: "binary",
      ok: true,
      detail: "the hooks run the flow on the PATH, and the gate the flow in node_modules/@jawache/flow",
    });
    expect(binary(true, true, { gateText: PATH_ONLY_GATE }).fitting?.detail).toBe(
      "the hooks run the flow in node_modules/@jawache/flow, and the gate the flow on the PATH",
    );
    expect(binary(false, true, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS }).fitting?.detail).toBe(
      "the hooks and the gate run the flow on the PATH",
    );
  });

  // ONE RULE FOR STATUS AND INIT: a red line whose fix is `flow init` must be one init can carry out.
  it("judges registrations by the rule init rewrites by — a prefixed by-name command is somebody's own", () => {
    const theirs = registrationsAs((command) => command.replace(/^.* flow /, "FLOW_DEBUG=1 flow "));
    expect(host.registering.withRegistrations(theirs).added, "init has nothing to rewrite").toEqual([]);
    expect(binary(true, false, { settings: theirs }).fitting?.ok, "so status names no fix init would not make").toBe(true);
  });

  it("does not judge a registration with a path to the binary by the PATH — it names its own copy", () => {
    const pinned = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/flow hook stop" }] }] },
    };
    expect(binary(true, false, { settings: pinned }).fitting?.ok).toBe(true);
  });

  it("judges a gate and registrations not there yet as `flow init` will write them — their own fittings are red", () => {
    const { fitting, green } = binary(true, false, { gateText: null, settings: {} });
    expect(fitting?.ok).toBe(true);
    expect(green, "the commit-gate and hooks lines are").toBe(false);
  });

  // INIT'S LINK, in a repo that does not list flow, is the flow that ran init — not the repo's own.
  // Judged by the PATH, the tutorial's global install reads "on the PATH"; with nothing there, it is
  // red on the safe side, and says the link is what runs until it breaks.
  it("judges a copy the repo does not list by the PATH: green with one there, and a red line naming the link without", () => {
    const linked = (path: boolean) => status(statusFacts({ binary: { listed: false, copy: true, path } }));
    expect(statusLines(linked(true))).toContain("  ✓ binary: the hooks and the gate run the flow on the PATH");
    const red = linked(false);
    expect(red.fittings.find((f) => f.id === "binary")).toEqual({
      id: "binary",
      ok: false,
      detail:
        "this repo's package.json does not list @jawache/flow, so node_modules/@jawache/flow is the link `flow init` made to the flow that ran it, " +
        "and no flow is on the PATH. The hooks and the gate run that link only while it resolves, and once it breaks every hook fails " +
        "with `flow: not found` and git refuses every commit — install it for this repo with `npm i -D @jawache/flow`, or for every repo with `npm i -g @jawache/flow`.",
    });
    expect(red.green).toBe(false);
    const listedNotInstalled = status(statusFacts({ binary: { listed: true, copy: false, path: false } })).fittings.find((f) => f.id === "binary");
    expect(listedNotInstalled?.detail, "listed, but not installed yet").toContain(`no flow in ${PACKAGE_DIR} or on the PATH`);
  });

  it("is a red line naming both installs when neither has one, and status is not green", () => {
    for (const over of [{}, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS }]) {
      const { fitting, green, lines } = binary(false, false, over);
      expect(fitting?.ok).toBe(false);
      expect(fitting?.detail).toContain(`no flow in ${PACKAGE_DIR} or on the PATH`);
      expect(fitting?.detail).toContain("npm i -D @jawache/flow");
      expect(fitting?.detail).toContain("npm i -g @jawache/flow");
      expect(green).toBe(false);
      expect(lines.at(-1)).toContain("1 red line");
    }
  });
});

describe("status — does git run the commit gate", () => {
  const judged = (over: Partial<StatusFacts>) => {
    const s = status(statusFacts(over));
    // As printed: a detail of several lines is several lines on the page.
    const line = statusLines(s).join("\n").split("\n").find((said) => said.includes(" hooks-path: "));
    return { s, fitting: s.fittings.find((f) => f.id === "hooks-path"), line, code: statusCode(s) };
  };
  /** Husky's setup: git runs `.husky/_`, and a person edits `.husky/pre-commit`. */
  const husky = (preCommitText: string | null): Partial<StatusFacts> => ({
    hooksPath: ".husky/_",
    hooksFolder: { dir: ".husky/_", files: ["h", "husky.sh", "pre-commit"], preCommitText, preCommitExecutable: false },
  });

  it("flow's own .githooks is green, as it always read", () => {
    const { s, line } = judged({});
    expect(line).toBe(`  ✓ hooks-path: core.hooksPath = ${HOOKS_DIR}`);
    expect(s.green).toBe(true);
  });

  it("counts `.githooks/`, `./.githooks` and an absolute path to it as flow's own, as init does", () => {
    for (const set of [".githooks/", "./.githooks", "/repo/.githooks"]) {
      const { s, line } = judged({ hooksPath: set, hooksFolder: { dir: hooksDirOf("/repo", set), files: ["pre-commit"], preCommitText: PRE_COMMIT, preCommitExecutable: true } });
      expect(line, set).toBe(`  ✓ hooks-path: core.hooksPath = ${HOOKS_DIR}`);
      expect(s.green, set).toBe(true);
    }
  });

  describe("other hooks that do not call flow", () => {
    it("husky's: red, in the words of init's block — the folder and both fixes — and exits 1", () => {
      const { s, fitting, line, code } = judged(husky("npm test\n"));
      const other = { dir: ".husky/_", preCommit: ".husky/pre-commit", fix: "add" } as const;
      expect(fitting).toStrictEqual({ id: "hooks-path", ok: false, detail: notInstalledLines(other).join("\n") });
      expect(line).toBe(`  ✗ hooks-path: ${NOT_INSTALLED}. Git runs hooks from .husky/_, and .husky/pre-commit does not call flow, so no commit runs flow's gate.`);
      const said = statusLines(s).join("\n");
      // Every later line of the block sits under the row, four in, its own indent kept after that.
      const page = said.split("\n");
      const at = page.findIndex((l) => l.includes(" hooks-path: "));
      expect(page.slice(at + 1, at + 6)).toStrictEqual(notInstalledLines(other).slice(1).map((l) => `    ${l}`));
      expect(said).toContain("Add these two lines to the end of .husky/pre-commit:");
      expect(said).toContain(GATE_RUN_LINE);
      expect(said).toContain(`move those hooks into ${HOOKS_DIR}/`);
      expect(said).toContain(SET_HOOKS_PATH);
      expect(s.green).toBe(false);
      expect(code).toBe(1);
    });

    it("a hook in .git/hooks, with core.hooksPath unset: red, naming that folder and its pre-commit", () => {
      const { fitting, code } = judged({ hooksPath: null, hooksFolder: { ...FRESH_CLONE, files: [...FRESH_CLONE.files, "pre-push"] } });
      expect(fitting?.ok).toBe(false);
      expect(fitting?.detail).toContain("Git runs hooks from .git/hooks, and there is no .git/hooks/pre-commit");
      expect(fitting?.detail).toContain("Create .git/hooks/pre-commit with these three lines, then run `chmod +x .git/hooks/pre-commit`");
      expect(code).toBe(1);
    });

    it("a pre-commit in .git/hooks that calls flow without the execute bit: red, saying it must be executable", () => {
      const lfs: HooksFolder = { dir: ".git/hooks", files: ["pre-push", "pre-commit"], preCommitText: PRE_COMMIT, preCommitExecutable: false };
      const { fitting, code } = judged({ hooksPath: null, hooksFolder: lfs });
      expect(fitting).toStrictEqual({
        id: "hooks-path",
        ok: false,
        detail: notInstalledLines({ dir: ".git/hooks", preCommit: ".git/hooks/pre-commit", fix: "chmod" }).join("\n"),
      });
      expect(fitting?.detail).toContain("calls flow but is not executable, so git ignores it");
      expect(code).toBe(1);
      expect(judged({ hooksPath: null, hooksFolder: { ...lfs, preCommitExecutable: true } }).fitting?.ok, "and green once it is").toBe(true);
    });
  });

  it("other hooks whose pre-commit calls flow: green, naming the folder and the hook", () => {
    const { s, line, code } = judged(husky(`#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`));
    expect(line).toBe("  ✓ hooks-path: git runs hooks from .husky/_, and .husky/pre-commit calls flow");
    expect(s.green).toBe(true);
    expect(code).toBe(0);
  });

  it("no other hooks and core.hooksPath unset: the red line it always was, with the setting to make", () => {
    const { fitting } = judged({ hooksPath: null, hooksFolder: FRESH_CLONE });
    expect(fitting).toStrictEqual({
      id: "hooks-path",
      ok: false,
      detail: `core.hooksPath is unset — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    });
    expect(fitting?.detail).not.toContain(NOT_INSTALLED);
  });

  it("when git could not name its hooks folder, red and cannot judge — never advice to set core.hooksPath", () => {
    for (const hooksPath of [".husky/_", HOOKS_DIR, null]) {
      const { fitting } = judged({ hooksPath, hooksFolder: null });
      expect(fitting?.ok, String(hooksPath)).toBe(false);
      expect(fitting?.detail, String(hooksPath)).toBe(HOOKS_UNKNOWN);
      expect(fitting?.detail, String(hooksPath)).not.toContain("core.hooksPath");
    }
  });
});
const store = (...records: Record<string, unknown>[]): string => records.map((r) => JSON.stringify(r)).join("\n");

const spokeBack = (blocks: unknown[], ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "assistant",
  timestamp: ts,
  message: { content: blocks },
});

const spoke = (prose: string, ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "user",
  timestamp: ts,
  message: { content: prose },
});

const used = (name: string, input: Record<string, unknown>, id = "toolu_1"): Record<string, unknown> => ({
  type: "tool_use",
  id,
  name,
  input,
});

describe("weakened after a block — whichever tool changed the guard", () => {
  const rows: Row[] = [{ kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "deny" }];
  const guarded = (name: string, action: "edit" | "write" | "read"): TranscriptEvent => ({
    line: 9,
    kind: "use",
    ts: "2026-01-01T10:00:30.000Z",
    id: "b",
    name,
    action,
    input: {},
    path: "flow.config.ts",
  });

  it("counts a MultiEdit after a block as it counts an Edit", () => {
    expect(weakenedAfterBlock(rows, [guarded("MultiEdit", "edit")], ["flow.config.ts"])).toHaveLength(1);
  });

  it("counts a whole-file write, and not a read", () => {
    expect(weakenedAfterBlock(rows, [guarded("Write", "write")], ["flow.config.ts"])).toHaveLength(1);
    expect(weakenedAfterBlock(rows, [guarded("Read", "read")], ["flow.config.ts"])).toHaveLength(0);
  });
});
