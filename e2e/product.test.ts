// flow/e2e/product.test.ts — `flow init`, `flow status` and `flow uninstall`, end to end,
// through the BUILT BINARY, over a throwaway repo.
//
// It is the sibling of live.test.ts and is written for the same reason: the decisions are proved
// next door as functions, and what this file proves is the WIRING — that the scaffold init writes is
// a config that actually loads, that its cases actually pass, that the gate it arms actually refuses
// a commit, and that a second run adds nothing.
//
// UAT act A, in other words, driven by a machine. The one thing it cannot stand in for is a person
// watching a live agent read the breadcrumb; everything else on that list is here.
//
// NOTHING OUTSIDE THE TEMP DIRECTORIES IS TOUCHED. `CLAUDE_CONFIG_DIR` is the host's own override
// for where settings live, and pointing it at a temp folder is what lets init's registration half be
// driven for real instead of mocked — the seam is the product's, not the suite's.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, existsSync, lstatSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  PACKAGE,
  buildBundles,
  builtPackage,
  cleanBundles,
  hook,
  newRepo as freshRepo,
  pre,
  settingsHome,
  sh,
  shimBin,
  stageGuardDeletion,
  BREAKS,
  bindInConfig,
  fixturePack,
  flow as runFlow,
  git as runGit,
  type Ran,
} from "./harness.ts";

let home: string;
/**
 * A directory holding one `flow` shim, which runs the build under test: the PATH's flow. A repo
 * `flow init` linked runs its own node_modules/@jawache/flow first, the same build, so the shim is
 * the fallback half of the gate and the hooks, and it keeps the machine's own flow out of every run.
 */
let bin: string;

/** The built binary, in a given repo, with the throwaway host settings and the shim on PATH. */
const flow = (repo: string, args: readonly string[], settingsFolder: string = home): Ran =>
  runFlow(repo, args, { home: settingsFolder, bin });

const git = (repo: string, args: readonly string[]): Ran => runGit(repo, args, { home, bin });

const newRepo = (): string => freshRepo("flow-init-");

/** The hooks file flow init wrote inside a repo, parsed. */
const settings = (at: string = repo): Record<string, unknown> =>
  JSON.parse(readFileSync(join(at, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;

/** The events flow init registers, in the order it writes and prints them. */
const REGISTERED = ["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"];

/** The same, as init and status print them. */
const LISTED = REGISTERED.join(" · ");

let repo: string;
let first: Ran;

beforeAll(() => {
  const built = buildBundles();
  expect(built.code, built.stderr).toBe(0);

  home = settingsHome();
  bin = shimBin();

  repo = newRepo();
  first = flow(repo, ["init"]);
});

afterAll(() => {
  for (const dir of [repo, home, bin]) rmSync(dir, { recursive: true, force: true });
  cleanBundles();
});

describe("flow init — a repo that has never heard of flow", () => {
  it("reports exactly what it created, and answers 0", () => {
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.stdout).toContain("flow.config.ts");
    expect(first.stdout).toContain(".githooks/commit-msg");
    expect(first.stdout).toContain("core.hooksPath");
    expect(first.stdout).toContain("SessionStart");
  });

  it("leaves a config, a gate, a state directory and a resolvable @jawache/flow", () => {
    expect(existsSync(join(repo, "flow.config.ts"))).toBe(true);
    expect(existsSync(join(repo, ".flow"))).toBe(true);
    expect(readFileSync(join(repo, ".githooks", "commit-msg"), "utf8")).toContain("flow hook commit");
    expect(lstatSync(join(repo, "node_modules", "@jawache", "flow")).isSymbolicLink()).toBe(true);
    expect(git(repo, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");
  });

  // What 0.3 wrote: the gate in git's pre-commit hook, which runs before git has the message.
  const GATE_03 = (extra: string): string =>
    `#!/bin/sh\n# The flow commit gate.\n${extra}f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit\nexec flow hook commit\n`;

  it("takes flow's lines out of the pre-commit hook an older flow wrote, and deletes it when they were all of it", () => {
    const older = newRepo();
    try {
      mkdirSync(join(older, ".githooks"), { recursive: true });
      writeFileSync(join(older, ".githooks", "pre-commit"), GATE_03(""), { mode: 0o755 });
      const said = flow(older, ["init"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain(".githooks/pre-commit deleted");
      expect(existsSync(join(older, ".githooks", "pre-commit"))).toBe(false);
      expect(readFileSync(join(older, ".githooks", "commit-msg"), "utf8")).toContain('flow hook commit "$1"');
      expect(flow(older, ["init"]).stdout, "a second run has nothing left to take out").toContain("already set up");
    } finally {
      rmSync(older, { recursive: true, force: true });
    }
  });

  it("registers the events flow answers, and not Notification", () => {
    const hooks = settings()["hooks"] as Record<string, unknown>;
    expect(first.stdout).toContain(LISTED);
    expect(Object.keys(hooks)).toEqual(REGISTERED);
    expect(JSON.stringify(hooks["PreToolUse"]), "flow refuses a command before it runs, and nothing else").toContain('"matcher":"Bash"');
    expect(JSON.stringify(hooks["PostToolUse"]), "any tool's call can name a file").toContain('"matcher":"*"');
    expect(Object.keys(hooks), "no hook after a failed call").not.toContain("PostToolUseFailure");
    expect(JSON.stringify(hooks)).toContain("flow hook stop");
    expect(JSON.stringify(hooks["SubagentStop"]), "a subagent's hand-back is its own event").toContain("flow hook subagent-stop");
    expect(Object.keys(hooks)).not.toContain("Notification");
  });

  // THE JOURNEY: with no terminal, in a repo with no package.json, init prompts for nothing and
  // writes every registration inside the repo — and nothing in the harness's own home folder.
  it("with no terminal, writes .claude/settings.json in the repo and nothing in the harness's home folder", () => {
    const scratch = newRepo();
    const emptyHome = settingsHome();
    try {
      expect(existsSync(join(scratch, "package.json")), "no package.json to say flow is a dependency").toBe(false);
      const ran = flow(scratch, ["init"], emptyHome);
      expect(ran.code, ran.stdout + ran.stderr).toBe(0);
      expect(Object.keys(settings(scratch)["hooks"] as object)).toEqual(REGISTERED);
      expect(readdirSync(emptyHome), "the harness's home folder is still empty").toEqual([]);
      expect(ran.stdout, "the warnings come before anything is written, and are not a prompt").toContain("  ! flow is not a dev dependency of this repo");
    } finally {
      for (const dir of [scratch, emptyHome]) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`--harness claude-code` names the harness and registers it", () => {
    const named = newRepo();
    try {
      const ran = flow(named, ["init", "--harness", "claude-code"]);
      expect(ran.code, ran.stdout + ran.stderr).toBe(0);
      expect(existsSync(join(named, ".claude", "settings.json"))).toBe(true);
    } finally {
      rmSync(named, { recursive: true, force: true });
    }
  });

  it("keeps .flow/ out of git by itself, with no edit to a file it does not own", () => {
    expect(git(repo, ["status", "--porcelain"]).stdout).not.toContain(".flow");
    expect(existsSync(join(repo, ".gitignore")), "no .gitignore was written — .flow/ ignores itself").toBe(false);
  });
});

describe("the scaffolded config", () => {
  it("LOADS, and every one of its rules passes its own cases — UAT step 8", () => {
    const tested = flow(repo, ["test"]);
    expect(tested.code, tested.stdout + tested.stderr).toBe(0);
    expect(tested.stdout).toContain("all green");
    // `--all` is the same run with the installed packs' cases in it, and it is green too.
    const everything = flow(repo, ["test", "--all"]);
    expect(everything.code, everything.stdout + everything.stderr).toBe(0);
    expect(everything.stdout).toContain("all green");
  });

  it("blocks `flow uninstall` from an agent — UAT step 3", () => {
    const answer = hook(repo, "pre-tool-use", pre("Bash", { command: "flow uninstall" }, "demo-1"), {
      home,
    });
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("flow.noUninstall");
    expect(answer.stderr).toContain("removes this repo's guard");
  });

  it("refuses at git's own hook the commit that deletes flow.config.ts, and passes the same commit once the file stays — UAT step 4", () => {
    stageGuardDeletion(repo, { home });

    const refused = git(repo, ["commit", "-m", "test: delete the guard"]);
    expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
    expect(refused.stderr).toContain("flow.noDeleteGuardrails");

    git(repo, ["add", "flow.config.ts"]);
    writeFileSync(join(repo, "note.txt"), "a note\n");
    git(repo, ["add", "note.txt"]);
    const passed = git(repo, ["commit", "-m", "test: a note"]);
    expect(passed.code, passed.stdout + passed.stderr).toBe(0);
  });
});

describe("flow status", () => {
  it("lists every rule by moment, with its scope and the category it binds to — UAT step 7", () => {
    const said = flow(repo, ["status"]);
    expect(said.code, said.stdout + said.stderr).toBe(0);
    expect(said.stdout).toContain("flow is ON");
    expect(said.stdout, "flow's own self-protection is bound by default").toContain("flow.orientation");
    expect(said.stdout).toContain("flow.noUninstall");
    expect(said.stdout).toContain("flow.noDeleteGuardrails");
    expect(said.stdout).toContain("green — every rule loads");
  });

  it("hands the same answer over as data", () => {
    const read = JSON.parse(flow(repo, ["status", "--json"]).stdout) as {
      green: boolean;
      categories: string[];
      fittings: { id: string; ok: boolean }[];
    };
    expect(read.green).toBe(true);
    expect(read.categories).toEqual([]);
    expect(read.fittings.every((f) => f.ok)).toBe(true);
  });

  it("has one line for each registered harness, and says when one of its hooks last ran, in the text and as data", () => {
    const mine = newRepo();
    try {
      expect(flow(mine, ["init"]).code).toBe(0);
      expect(flow(mine, ["status"]).stdout).toContain("✓ claude-code: registered · no hook has run here");

      const ran = hook(mine, "pre-tool-use", pre("Bash", { command: "ls" }, "status-1"), { home, bin });
      expect(ran.code, ran.stderr).toBe(0);
      const said = flow(mine, ["status"]);
      expect(said.stdout).toContain("✓ claude-code: registered · last hook ran just now");
      const read = JSON.parse(flow(mine, ["status", "--json"]).stdout) as { fittings: { id: string; ok: boolean; lastRan?: string | null }[] };
      const line = read.fittings.find((f) => f.id === "claude-code");
      expect(line?.ok).toBe(true);
      expect(Date.now() - Date.parse(line?.lastRan ?? ""), "the time the log wrote, which is within the minute").toBeLessThan(60_000);
    } finally {
      rmSync(mine, { recursive: true, force: true });
    }
  });

  it("goes red, with the fix, when the gate is not armed", () => {
    const bare = newRepo();
    try {
      const said = flow(bare, ["status"]);
      expect(said.code).toBe(1);
      expect(said.stdout).toContain("flow init");
      expect(said.stdout).toContain("red line");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  // THE SHELL'S OWN LOOKUP, end to end. The PATH holds git's exec-path folder and nothing else: git,
  // which status asks about the hooks path, and no `flow` — the machine's PATH cannot promise that.
  // The repo does not list @jawache/flow, so the link `flow init` makes is the running flow, not the
  // repo's own copy, and status judges it by the PATH alone: red on the safe side, naming the link.
  it("goes red on the binary, and exits 1, when the repo has no flow of its own and the PATH has none", () => {
    const stranded = newRepo();
    try {
      expect(flow(stranded, ["init"]).code).toBe(0);
      const gitOnly = runGit(stranded, ["--exec-path"]).stdout.trim();
      expect(existsSync(join(gitOnly, "flow")), "the PATH this run is given has no flow").toBe(false);
      expect(existsSync(join(stranded, "package.json")), "nor does the repo list flow").toBe(false);
      const said = runFlow(stranded, ["status"], { home, path: gitOnly });
      expect(said.stdout).toContain(
        "✗ binary: this repo's package.json does not list @jawache/flow, so node_modules/@jawache/flow is the link `flow init` made to the flow that ran it, and no flow is on the PATH.",
      );
      expect(said.stdout).toContain("1 red line");
      expect(said.code).toBe(1);
    } finally {
      rmSync(stranded, { recursive: true, force: true });
    }
  });

  // A DEV DEPENDENCY ALONE, end to end: the repo lists @jawache/flow, its package is in
  // node_modules/@jawache/flow (the link `flow init` makes, as `npm link` would), and the PATH holds
  // git, node and nothing else. The gate and the registrations run that package's own file, so status
  // names it, git's own hook runs it, and a registered command answers through a shell.
  it("names node_modules/@jawache/flow on the green binary line, and the gate and a hook run that copy, with no flow on the PATH", () => {
    const local = newRepo();
    const nodeOnly = mkdtempSync(join(tmpdir(), "flow-node-"));
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(local, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      expect(flow(local, ["init"], home).code).toBe(0);
      expect(existsSync(join(local, "node_modules", "@jawache", "flow", "dist", "flow.mjs")), "the repo's own package").toBe(true);
      // A `flow` in node_modules/.bin that is not flow, as Facebook's flow-bin installs: never run.
      mkdirSync(join(local, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(local, "node_modules", ".bin", "flow"), "#!/bin/sh\necho not-flow\nexit 0\n", { mode: 0o755 });
      symlinkSync(process.execPath, join(nodeOnly, "node"));
      // git, node, and the system's own folders for the shell flow runs git through — no flow in any.
      const path = [runGit(local, ["--exec-path"]).stdout.trim(), nodeOnly, "/usr/bin", "/bin"];
      for (const dir of path) expect(existsSync(join(dir, "flow")), `${dir} has no flow`).toBe(false);
      const world = { home, path: path.join(":") };

      const said = runFlow(local, ["status"], world);
      expect(said.stdout).toContain("✓ binary: the hooks run this repo's own flow");
      expect(said.code, said.stdout).toBe(0);

      stageGuardDeletion(local, world);
      const refused = runGit(local, ["commit", "-m", "test: delete the guard"], world);
      expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
      expect(refused.stderr, "flow refused it, not `flow: not found` and not the other flow").toContain("flow.noDeleteGuardrails");

      const written = JSON.parse(readFileSync(join(local, ".claude", "settings.json"), "utf8")) as {
        hooks: Record<string, { hooks: { command: string }[] }[]>;
      };
      const registered = written.hooks["PreToolUse"]?.[0]?.hooks[0]?.command;
      expect(registered).toBe('f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook pre-tool-use; exec flow hook pre-tool-use');
      const answered = sh(local, registered ?? "", world, JSON.stringify(pre("Bash", { command: "flow uninstall" }, "dev-dep-1")));
      expect(answered.code, answered.stderr).toBe(2);
      expect(answered.stderr).toContain("flow.noUninstall");
    } finally {
      for (const dir of [local, nodeOnly]) rmSync(dir, { recursive: true, force: true });
    }
  });

  // THE FALLBACK HALF, end to end: `; exec flow hook …`. Every other repo here has init's link, so
  // the repo-first half always answers. This one resolves @jawache/flow from a folder above it, as a
  // monorepo's package would, so init links nothing, the repo has no node_modules/@jawache/flow of
  // its own, and the gate and a hook run the flow on the PATH: the shim, which runs the build under
  // test. (Removing init's link instead would leave the config unable to import @jawache/flow.)
  it("runs the flow on the PATH when the repo has no @jawache/flow of its own: the gate refuses, and a hook answers 2", () => {
    const above = mkdtempSync(join(tmpdir(), "flow-above-"));
    try {
      mkdirSync(join(above, "node_modules", "@jawache"), { recursive: true });
      symlinkSync(builtPackage(), join(above, "node_modules", "@jawache", "flow"), "dir");
      const below = join(above, "repo");
      mkdirSync(below);
      for (const args of [["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]]) git(below, args);

      const init = flow(below, ["init"]);
      expect(init.code, init.stdout + init.stderr).toBe(0);
      expect(existsSync(join(below, "node_modules")), "init links nothing: @jawache/flow resolves from above").toBe(false);
      expect(flow(below, ["status"]).stdout).toContain("✓ binary: the hooks and the gate run the flow on the PATH");

      stageGuardDeletion(below, { home, bin });
      const refused = git(below, ["commit", "-m", "test: delete the guard"]);
      expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
      expect(refused.stderr, "the PATH's flow refused it").toContain("flow.noDeleteGuardrails");

      const registered = (settings(below)["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["PreToolUse"]?.[0]?.hooks[0]?.command;
      expect(registered).toContain("; exec flow hook pre-tool-use");
      const answered = sh(below, registered ?? "", { home, bin }, JSON.stringify(pre("Bash", { command: "flow uninstall" }, "fallback-1")));
      expect(answered.code, answered.stderr).toBe(2);
      expect(answered.stderr).toContain("flow.noUninstall");
    } finally {
      rmSync(above, { recursive: true, force: true });
    }
  });

  it("refuses, loudly, over a config that will not even import — UAT step 5", () => {
    const broken = newRepo();
    try {
      flow(broken, ["init"]);
      writeFileSync(join(broken, "flow.config.ts"), 'import { nope } from "./missing.ts";\nexport default nope;\n');
      const said = flow(broken, ["status"]);
      expect(said.code, "exit 2 — your rules are broken, not merely not in force").toBe(2);
      expect(said.stderr).toContain("flow.config.ts could not be loaded");
      // ONCE, and that is the assertion. `loadRegime` already builds the whole sentence with
      // `configLoadFault`; status used to wrap it a second time, so the reader met the prefix twice
      // and the one fault read as two.
      expect(said.stderr.match(/could not be loaded/g), said.stderr).toHaveLength(1);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("flow init, run again", () => {
  it("adds nothing, changes nothing, and says so", () => {
    const before = JSON.stringify(settings());
    const again = flow(repo, ["init"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("already set up");
    expect(JSON.stringify(settings()), "the host's file is untouched, byte for byte").toBe(before);
  });

  it("goes red on the registrations an older flow wrote, and brings them up to date in place when init runs again", () => {
    const older = newRepo();
    try {
      expect(flow(older, ["init"]).code).toBe(0);
      const current = settings(older) as { hooks: Record<string, unknown> };
      writeFileSync(
        join(older, ".claude", "settings.json"),
        JSON.stringify({
          hooks: {
            ...current.hooks,
            PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook pre-tool-use" }] }],
            PostToolUse: [{ matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] }],
            PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook post-tool-use-failure" }] }],
          },
        }),
      );
      const red = flow(older, ["status"]);
      expect(red.code).toBe(1);
      expect(red.stdout).toContain("calls flow for PreToolUse · PostToolUse · PostToolUseFailure the way an older flow registered them");
      expect(red.stdout).toContain("Re-run `flow init` to bring them up to date.");

      const again = flow(older, ["init"]);
      expect(again.code).toBe(0);
      // The older flow wrote the bare command too, so each entry is rewritten at once.
      expect(again.stdout).toContain("PreToolUse (matcher brought up to date, now runs the flow in node_modules/@jawache/flow first)");
      expect(again.stdout).toContain("PostToolUse (matcher brought up to date, now runs the flow in node_modules/@jawache/flow first)");
      expect(again.stdout).toContain("PostToolUseFailure (removed: flow no longer registers it)");
      const hooks = (settings(older) as { hooks: Record<string, unknown[]> }).hooks;
      expect(hooks["PostToolUse"], "one entry, brought up to date — never a second one beside it").toHaveLength(1);
      expect(JSON.stringify(hooks["PreToolUse"])).toContain('"matcher":"Bash"');
      expect(JSON.stringify(hooks["PostToolUse"])).toContain(
        JSON.stringify('f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook post-tool-use; exec flow hook post-tool-use'),
      );
      expect(Object.keys(hooks), "the hook after a failed call is gone").toEqual(REGISTERED);
      expect(flow(older, ["status"]).code).toBe(0);
    } finally {
      rmSync(older, { recursive: true, force: true });
    }
  });

  // THE FILE AN INIT BEFORE 0.3.0 WROTE: every registration but SubagentStop. Status names the one
  // missing, and init adds it.
  it("goes red on a file without SubagentStop, and adds it when init runs again", () => {
    const older = newRepo();
    try {
      expect(flow(older, ["init"]).code).toBe(0);
      const current = settings(older) as { hooks: Record<string, unknown> };
      const { SubagentStop: _dropped, ...rest } = current.hooks;
      writeFileSync(join(older, ".claude", "settings.json"), JSON.stringify({ hooks: rest }));

      const red = flow(older, ["status"]);
      expect(red.code).toBe(1);
      expect(red.stdout).toContain("✗ claude-code: .claude/settings.json does not call flow for SubagentStop — re-run `flow init`.");

      const again = flow(older, ["init"]);
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(again.stdout).toContain("+ .claude/settings.json — SubagentStop\n");
      expect(flow(older, ["status"]).code).toBe(0);
    } finally {
      rmSync(older, { recursive: true, force: true });
    }
  });

  it("replaces a dangling @jawache/flow link, which is one way nothing resolves", () => {
    const stale = newRepo();
    try {
      const scope = join(stale, "node_modules", "@jawache");
      mkdirSync(scope, { recursive: true });
      symlinkSync(join(stale, "no-such-checkout"), join(scope, "flow"), "dir");
      const said = flow(stale, ["init"]);
      expect(said.code).toBe(0);
      expect(said.stdout).toContain("node_modules/@jawache/flow →");
      expect(said.stdout).not.toContain("could not link");
      expect(existsSync(join(scope, "flow", "package.json")), "the link now resolves to a package").toBe(true);
    } finally {
      rmSync(stale, { recursive: true, force: true });
    }
  });

  it("never overwrites a commit-msg hook somebody else put there", () => {
    const theirs = newRepo();
    try {
      mkdirSync(join(theirs, ".githooks"), { recursive: true });
      writeFileSync(join(theirs, ".githooks", "commit-msg"), "#!/bin/sh\nnpm test\n", { mode: 0o755 });
      const said = flow(theirs, ["init"]);
      expect(readFileSync(join(theirs, ".githooks", "commit-msg"), "utf8")).toBe("#!/bin/sh\nnpm test\n");
      expect(said.stdout).toContain("kept");
      expect(said.stdout).toContain("flow hook commit");
    } finally {
      rmSync(theirs, { recursive: true, force: true });
    }
  });
});

// ── when git already runs other hooks ───────────────────────────────────────
//
// Git runs hooks from one folder. Pointing it at `.githooks` over husky's, or over a hook in
// `.git/hooks`, turns those off without a word, so init leaves them alone and says loudly that flow
// is not installed until the commit-msg hook git runs calls it.

/** The words the block opens with, as the docs fix them. */
const NOT_INSTALLED = "FLOW IS NOT INSTALLED";

/** The two lines the block tells a person to add to that commit-msg hook, as it printed them. */
const linesToAdd = (stdout: string, commitMsg: string): string[] => {
  const lines = stdout.split("\n");
  const at = lines.findIndex((line) => line.includes(`Add these two lines to the end of ${commitMsg}:`));
  expect(at, "the block names the hook to add them to").not.toBe(-1);
  return lines.slice(at + 1, at + 3).map((line) => line.trim());
};

/**
 * A repo set up the way husky 9 sets one up: `core.hooksPath` is `.husky/_`, whose `commit-msg` is
 * a stub that runs `.husky/commit-msg`, the file a person edits.
 */
function huskyRepo(commitMsg: string): string {
  const repo = newRepo();
  mkdirSync(join(repo, ".husky", "_"), { recursive: true });
  writeFileSync(join(repo, ".husky", "_", "commit-msg"), '#!/bin/sh\nexec sh -e "$(dirname "$0")/../commit-msg" "$@"\n', { mode: 0o755 });
  writeFileSync(join(repo, ".husky", "commit-msg"), commitMsg);
  git(repo, ["config", "core.hooksPath", ".husky/_"]);
  return repo;
}

/** The three lines the block tells a person to create a missing commit-msg hook with, as it printed them. */
const linesToCreate = (stdout: string, commitMsg: string): string[] => {
  const lines = stdout.split("\n");
  const at = lines.findIndex((line) => line.includes(`Create ${commitMsg} with these three lines`));
  expect(at, "the block says to create the hook").not.toBe(-1);
  return lines.slice(at + 1, at + 4).map((line) => line.trim());
};

/** A repo whose only hook is the `pre-push` Git LFS installs in `.git/hooks`: no commit-msg there. */
function lfsRepo(): string {
  const repo = newRepo();
  writeFileSync(join(repo, ".git", "hooks", "pre-push"), '#!/bin/sh\ngit lfs pre-push "$@"\n', { mode: 0o755 });
  return repo;
}

/** The block, from its first line to the end of the output, or nothing when there is none. */
const blockOf = (stdout: string): string => {
  const at = stdout.indexOf(NOT_INSTALLED);
  return at === -1 ? "" : stdout.slice(at);
};

describe("flow init, when git already runs other hooks", () => {
  it("leaves husky's core.hooksPath alone, writes every other file, ends with the block, and answers 1", () => {
    const husky = huskyRepo("npm test\n");
    try {
      const said = flow(husky, ["init"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      expect(git(husky, ["config", "--get", "core.hooksPath"]).stdout.trim(), "husky's setting, as it was").toBe(".husky/_");
      expect(said.stdout).not.toContain("+ git config core.hooksPath");
      expect(readFileSync(join(husky, ".husky", "commit-msg"), "utf8"), "husky's hook, untouched").toBe("npm test\n");
      expect(readFileSync(join(husky, ".githooks", "commit-msg"), "utf8")).toContain("flow hook commit");
      expect(existsSync(join(husky, "flow.config.ts"))).toBe(true);
      expect(existsSync(join(husky, ".flow"))).toBe(true);

      const block = blockOf(said.stdout);
      expect(block, "the block is the end of the output").not.toBe("");
      expect(block).toContain("Git runs hooks from .husky/_");
      expect(block).toContain("Add these two lines to the end of .husky/commit-msg:");
      expect(block).toContain("exec flow hook commit");
      expect(block).toContain("move those hooks into .githooks/");
      expect(block).toContain("git config core.hooksPath .githooks");
      expect(said.stdout, "not a terminal, so no colour").not.toContain("\u001b[");
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("counts flow installed once .husky/commit-msg calls it: no block, 0, and husky's hook runs the gate", () => {
    const husky = huskyRepo("npm test\n");
    try {
      const first = flow(husky, ["init"]);
      expect(first.code).toBe(1);
      // Followed to the letter: the two lines the block printed, appended to husky's hook.
      writeFileSync(join(husky, ".husky", "commit-msg"), `echo husky ran\n${linesToAdd(first.stdout, ".husky/commit-msg").join("\n")}\n`);
      expect(statSync(join(husky, ".husky", "commit-msg")).mode & 0o111, "husky's stub runs it with sh, so it needs no execute bit").toBe(0);

      const again = flow(husky, ["init"]);
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(again.stdout).not.toContain(NOT_INSTALLED);
      expect(again.stdout).toContain("git runs hooks from .husky/_, and .husky/commit-msg calls flow");
      expect(git(husky, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".husky/_");

      // Wired, the gate really runs through husky's stub: the scaffold's delete refusal fires.
      stageGuardDeletion(husky, { home, bin });
      const refused = git(husky, ["commit", "-m", "test: delete the guard"]);
      expect(refused.code, "git refuses when husky's hook runs the gate").not.toBe(0);
      expect(refused.stderr).toContain("flow.noDeleteGuardrails");
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("leaves a hook in .git/hooks alone, names that folder, and answers 1", () => {
    const lfs = lfsRepo();
    try {
      const said = flow(lfs, ["init"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      expect(git(lfs, ["config", "--get", "core.hooksPath"]).code, "still unset").toBe(1);
      const block = blockOf(said.stdout);
      expect(block).toContain("Git runs hooks from .git/hooks, and there is no .git/hooks/commit-msg");
      expect(block).toContain("Create .git/hooks/commit-msg with these three lines, then run `chmod +x .git/hooks/commit-msg` so git runs it:");
      expect(existsSync(join(lfs, ".git", "hooks", "commit-msg")), "init creates nothing in another tool's folder").toBe(false);
    } finally {
      rmSync(lfs, { recursive: true, force: true });
    }
  });

  it("with no commit-msg in .git/hooks, the first fix followed to the letter installs flow, and the gate refuses", () => {
    const lfs = lfsRepo();
    try {
      const first = flow(lfs, ["init"]);
      expect(first.code).toBe(1);
      // As printed: the three lines into the file, then the chmod the block names.
      const hook = join(lfs, ".git", "hooks", "commit-msg");
      writeFileSync(hook, `${linesToCreate(first.stdout, ".git/hooks/commit-msg").join("\n")}\n`);
      chmodSync(hook, 0o755);

      const again = flow(lfs, ["init"]);
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(again.stdout).not.toContain(NOT_INSTALLED);
      expect(again.stdout).toContain("git runs hooks from .git/hooks, and .git/hooks/commit-msg calls flow");
      expect(flow(lfs, ["status"]).code).toBe(0);

      stageGuardDeletion(lfs, { home, bin });
      const refused = git(lfs, ["commit", "-m", "test: delete the guard"]);
      expect(refused.code, "git refuses when its own commit-msg runs the gate").not.toBe(0);
      expect(refused.stderr).toContain("flow.noDeleteGuardrails");
    } finally {
      rmSync(lfs, { recursive: true, force: true });
    }
  });

  it("a .git/hooks/commit-msg that calls flow without the execute bit is not installed: git ignores it", () => {
    const lfs = lfsRepo();
    try {
      const first = flow(lfs, ["init"]);
      // The rehearsal's slip: flow's lines in the file, and no chmod.
      const hook = join(lfs, ".git", "hooks", "commit-msg");
      writeFileSync(hook, `${linesToCreate(first.stdout, ".git/hooks/commit-msg").join("\n")}\n`, { mode: 0o644 });

      const said = flow(lfs, ["init"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      const block = blockOf(said.stdout);
      expect(block).toContain(".git/hooks/commit-msg calls flow but is not executable, so git ignores it");
      expect(block).toContain("Make .git/hooks/commit-msg executable, so git runs it: `chmod +x .git/hooks/commit-msg`");
      expect(said.stdout).not.toContain("· git runs hooks from");

      const status = flow(lfs, ["status"]);
      expect(status.code).toBe(1);
      expect(hooksPathOf(status.stdout)).toContain(`✗ git hook: ${NOT_INSTALLED}. Git runs hooks from .git/hooks, and .git/hooks/commit-msg calls flow but is not executable`);

      // What the red line is about: git really does commit past it.
      stageGuardDeletion(lfs, { home, bin });
      const passed = git(lfs, ["commit", "-m", "test: delete the guard"]);
      expect(passed.code, "git ignores a hook that is not executable").toBe(0);
      expect(passed.stderr).toContain("not set as executable");

      chmodSync(hook, 0o755);
      expect(flow(lfs, ["init"]).code, "the chmod the block names installs it").toBe(0);
    } finally {
      rmSync(lfs, { recursive: true, force: true });
    }
  });

  it("in a git worktree, names the main checkout's .git/hooks by its full path, and answers 1", () => {
    // A worktree's `.git` is a file, and git runs hooks from the main checkout's shared folder.
    const main = lfsRepo();
    const tree = join(mkdtempSync(join(tmpdir(), "flow-wt-")), "tree");
    try {
      git(main, ["commit", "-q", "--allow-empty", "-m", "chore: a commit to branch from"]);
      expect(git(main, ["worktree", "add", "-q", tree]).code).toBe(0);
      const said = flow(tree, ["init"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      expect(git(tree, ["config", "--get", "core.hooksPath"]).code, "still unset").toBe(1);
      const hooks = join(realpathSync(main), ".git", "hooks");
      const block = blockOf(said.stdout);
      expect(block).toContain(`Git runs hooks from ${hooks}, and there is no ${hooks}/commit-msg`);
      expect(block).toContain(`Create ${hooks}/commit-msg with these three lines, then run \`chmod +x ${hooks}/commit-msg\` so git runs it:`);
      expect(existsSync(join(hooks, "commit-msg")), "init creates nothing in another tool's folder").toBe(false);
    } finally {
      rmSync(main, { recursive: true, force: true });
      rmSync(dirname(tree), { recursive: true, force: true });
    }
  });

  it("a fresh `git init`, whose .git/hooks holds only samples, gets the setting, no block, and 0", () => {
    const hooks = readdirSync(join(repo, ".git", "hooks"));
    expect(hooks.length, "git init wrote its samples").toBeGreaterThan(0);
    expect(hooks.every((name) => name.endsWith(".sample"))).toBe(true);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("+ git config core.hooksPath .githooks");
    expect(first.stdout).not.toContain(NOT_INSTALLED);
  });
});

/** Status's git hook line as printed, with the lines its detail runs on to, up to the next fitting. */
const hooksPathOf = (stdout: string): string => {
  const at = stdout.search(/[✓✗] git hook: /);
  expect(at, "status prints a git hook line").not.toBe(-1);
  const next = stdout.slice(at).search(/\n {2}[✓✗] /);
  return stdout.slice(at, next === -1 ? undefined : at + next).trim();
};

describe("flow status, when git already runs other hooks", () => {
  type Read = { green: boolean; fittings: { id: string; ok: boolean; detail: string }[] };

  it("a husky repo whose .husky/commit-msg does not call flow: red, init's words, exit 1, and the same as data", () => {
    const husky = huskyRepo("npm test\n");
    try {
      expect(flow(husky, ["init"]).code).toBe(1);
      const said = flow(husky, ["status"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      const line = hooksPathOf(said.stdout);
      expect(line).toMatch(/^✗ git hook: FLOW IS NOT INSTALLED\. Git runs hooks from \.husky\/_/);
      expect(line).toContain("Add these two lines to the end of .husky/commit-msg:");
      expect(line).toContain("exec flow hook commit");
      expect(line).toContain("git config core.hooksPath .githooks");

      const json = flow(husky, ["status", "--json"]);
      expect(json.code).toBe(1);
      expect(json.stdout, "no colour codes in the data").not.toContain("\u001b");
      const read = JSON.parse(json.stdout) as Read;
      expect(read.green).toBe(false);
      const fitting = read.fittings.find((f) => f.id === "git hook");
      expect(fitting?.ok).toBe(false);
      expect(fitting?.detail.startsWith(`${NOT_INSTALLED}. Git runs hooks from .husky/_`)).toBe(true);
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("a husky repo whose .husky/commit-msg calls flow: green, and exit 0", () => {
    const husky = huskyRepo("npm test\n");
    try {
      const first = flow(husky, ["init"]);
      writeFileSync(join(husky, ".husky", "commit-msg"), `npm test\n${linesToAdd(first.stdout, ".husky/commit-msg").join("\n")}\n`);
      const said = flow(husky, ["status"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(hooksPathOf(said.stdout)).toBe("✓ git hook: git runs hooks from .husky/_, and .husky/commit-msg calls flow");
      expect(said.stdout).not.toContain(NOT_INSTALLED);
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("a hook in .git/hooks: red, naming that folder, and exit 1", () => {
    const lfs = lfsRepo();
    try {
      expect(flow(lfs, ["init"]).code).toBe(1);
      const said = flow(lfs, ["status"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      const line = hooksPathOf(said.stdout);
      expect(line).toContain(`✗ git hook: ${NOT_INSTALLED}. Git runs hooks from .git/hooks`);
      expect(line).toContain("Create .git/hooks/commit-msg with these three lines");
    } finally {
      rmSync(lfs, { recursive: true, force: true });
    }
  });

  it("core.hooksPath spelled `.githooks/`, `./.githooks` or as an absolute path is flow's own: green", () => {
    const spelled = newRepo();
    try {
      expect(flow(spelled, ["init"]).code).toBe(0);
      for (const set of [".githooks/", "./.githooks", join(realpathSync(spelled), ".githooks")]) {
        git(spelled, ["config", "core.hooksPath", set]);
        const said = flow(spelled, ["status"]);
        expect(said.code, `${set}\n${said.stdout}`).toBe(0);
        expect(hooksPathOf(said.stdout), set).toBe("✓ git hook: .githooks/commit-msg runs flow, and core.hooksPath = .githooks");
      }
    } finally {
      rmSync(spelled, { recursive: true, force: true });
    }
  });

  it("no other hooks and core.hooksPath unset: the red line it always was", () => {
    const bare = newRepo();
    try {
      const said = flow(bare, ["status"]);
      expect(said.code).toBe(1);
      expect(hooksPathOf(said.stdout)).toContain(
        "core.hooksPath is unset — run `git config core.hooksPath .githooks`. It is per-clone, so every fresh checkout needs it.",
      );
      expect(said.stdout).not.toContain(NOT_INSTALLED);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

// ── the README's example ─────────────────────────────────────────────────────
//
// A front page is a promise about what you will see, and a hand-copied one starts drifting the first
// time a sentence is reworded — silently, because nothing reads it. The README's example rule is
// pinned to the config `flow init` writes, and the refusal under it to the binary: the README is
// the expected value and the real run is the actual.
//
// THE THREE SUBSTITUTIONS are all paths and are named here: the repo, the host's config directory
// and this checkout are different on every machine, so a page quotes a settled spelling of each
// and this puts it back before comparing. Nothing else is touched — every word is the binary's.
//
// "This checkout" is TWO paths, and the second is the suite's own doing: the package under test is
// built into a throwaway root so a test run never rewrites the live guard, so the link `flow init`
// reports points there rather than at the checkout. A reader following a page has one of them and
// it is spelled the same way.

const REPO = "…/my-repo";
const CHECKOUT = "…/flow";

/** The fenced block in a page that opens with this line, whatever language its fence names. */
function fenced(file: string, opening: string): string {
  const found = readFileSync(file, "utf8")
    .split(/^```[^\n]*$/m)
    .filter((_part, at) => at % 2 === 1)
    .find((body) => body.trimStart().startsWith(opening));
  expect(found, `${file} has no fenced block starting "${opening}"`).toBeDefined();
  return (found as string).trim();
}

/**
 * One machine's output, in the spelling a page quotes.
 *
 * ONE spelling of each path for every page — a second copy of this function differing in one string
 * is how the Getting started tutorial's transcripts drifted for a release in the first place.
 */
function asQuoted(output: string, repo: string, settingsHome: string): string {
  return output
    .replaceAll(realpathSync(repo), REPO)
    .replaceAll(repo, REPO)
    .replaceAll(realpathSync(builtPackage()), CHECKOUT)
    .replaceAll(builtPackage(), CHECKOUT)
    .replaceAll(PACKAGE.replace(/\/$/, ""), CHECKOUT)
    .replaceAll(settingsHome, "~/.claude")
    .trim();
}

/** The fenced block in the README that opens with this line. */
const quoted = (opening: string): string => fenced(join(PACKAGE, "README.md"), opening);

/** Code with its indentation taken off every line: a block quoted at the margin, compared. */
const unindented = (code: string): string =>
  code
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

describe("the README's example", () => {
  // The scaffold binds only the shipped pack, so the rule the README shows lives in the config the
  // Getting started tutorial has the reader write. That config is the one the README's rule is held to.
  it("quotes a rule from the tutorial's config, and the refusal it really prints", () => {
    const shown = newRepo();
    const firstTime = mkdtempSync(join(tmpdir(), "flow-readme-"));
    try {
      expect(flow(shown, ["init"], firstTime).code).toBe(0);
      const written = paged(join("tutorials", "getting-started.md"), "import { banCommands");
      expect(unindented(written), "the rule is the tutorial's own, word for word").toContain(unindented(quoted("noForcePush: guardrail()")));
      writeFileSync(join(shown, "flow.config.ts"), `${written}\n`);

      const forced = JSON.stringify(pre("Bash", { command: "git push --force origin main" }));
      const ran = runFlow(shown, ["hook", "pre-tool-use"], { home: firstTime, bin }, forced);
      expect(ran.code).toBe(2);
      expect(asQuoted(ran.stderr, shown, firstTime)).toBe(quoted("flow — command blocked before it ran:"));
    } finally {
      for (const dir of [shown, firstTime]) rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the guarded repo's own module system ─────────────────────────────────────
//
// THE TABLE THAT WOULD HAVE CAUGHT IT. Node decides a `.ts` file's module system from the nearest
// `package.json`, and `flow.config.ts` is written in `import` statements — so before flow loaded its
// own config, `npm init && npx flow init` produced a repo whose guard could not be loaded at all.
// Found by installing the 0.1.0 tarball into a throwaway repo on the eve of publishing, and missed
// by every suite for one reason: the harness's repos have no package.json, which is the one shape
// node falls back to syntax detection for, and the only two real repos flow had ever run in were
// both `type: "module"`.
//
// FOUR SHAPES, and they fail in three different ways without the hook — worth knowing, because the
// middle two look alike and are not:
//
// · ABSENT — no package.json. Node has no declared type, so it detects the syntax and loads it.
//   Green before the fix, and the reason this went unseen: it is what `newRepo` builds.
// · NO TYPE FIELD — node detects the syntax and loads it, then warns MODULE_TYPELESS_PACKAGE_JSON
//   on stderr, EVERY RUN. Not a failure to load; a failure to stay quiet, on the one stream a
//   guard's refusals are read on and on a binary that fires on every tool call.
// · COMMONJS — the hard one, and the ordinary case: `npm init` writes `"type": "commonjs"`
//   verbatim (checked on npm 11.4.1), so this is what a person gets, not an exotic choice. The
//   config does not load: `Cannot use import statement outside a module`, exit 2, no guard at all.
// · MODULE — always worked. flow's own repo and the work repo, which is why nobody noticed.
//
// All four must init, load, go green and say NOTHING on stderr. A fifth shape is one row.

describe("a repo whose machine-wide settings hold flow 0.3's hooks", () => {
  // flow 0.3 wrote to the machine-wide file. 0.4 never writes there: init says its hooks are in it,
  // leaves it byte for byte, and names the command that removes them.
  it("warns that flow 0.3's hooks are in the machine-wide file, with the command that removes them, and leaves that file byte for byte", () => {
    const listed = newRepo();
    const machine = settingsHome();
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      const older = {
        theme: "dark",
        hooks: {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook pre-tool-use" }] }],
          Stop: [{ hooks: [{ type: "command", command: "flow hook stop" }] }, { hooks: [{ type: "command", command: "say done" }] }],
        },
      };
      const machineBefore = `${JSON.stringify(older, null, 2)}\n`;
      writeFileSync(join(machine, "settings.json"), machineBefore);

      const init = flow(listed, ["init"], machine);
      expect(init.code, init.stdout + init.stderr).toBe(0);
      expect(init.stdout).toContain(
        `  ! ${join(machine, "settings.json")} also holds flow's hooks, which flow 0.3 wrote, so each hook would run twice. Remove them with \`flow uninstall --machine\`, then run \`flow init\` again.`,
      );
      expect(init.stdout.indexOf("also holds flow's hooks"), "said before the list of what was created").toBeLessThan(init.stdout.indexOf("flow init — created:"));
      expect(init.stdout).not.toContain("is not a dev dependency");
      expect(readFileSync(join(machine, "settings.json"), "utf8"), "the machine-wide file, byte for byte").toBe(machineBefore);
      expect(Object.keys(settings(listed)["hooks"] as object), "the repo's own file holds every registration").toEqual(REGISTERED);
    } finally {
      for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── flow uninstall ───────────────────────────────────────────────────────────
//
// THE REVERSE OF INIT, through the built binary: each case runs `flow init` over a throwaway repo,
// then `flow uninstall`, then a commit with no `flow` on the PATH. That last commit is the whole
// point of the verb: after it, `npm uninstall` leaves nothing behind that fails with `flow: not found`.

describe("flow uninstall", () => {
  /**
   * git and the system's own tools on the PATH, and no flow: a commit that still called flow would
   * fail with `flow: not found`. The system folders are there for a hook that needs `sh`, as husky's
   * stub does.
   */
  const noFlow = (where: string): Ran => {
    const noFlowPath = [runGit(where, ["--exec-path"]).stdout.trim(), "/usr/bin", "/bin"];
    for (const dir of noFlowPath) expect(existsSync(join(dir, "flow")), `the PATH this commit is given has no flow, in ${dir}`).toBe(false);
    const path = noFlowPath.join(delimiter);
    writeFileSync(join(where, "after.txt"), "committed with flow gone\n");
    runGit(where, ["add", "after.txt"], { home, path });
    return runGit(where, ["commit", "-m", "test: flow is gone"], { home, path });
  };

  it("removes the gate, core.hooksPath, .githooks/, .flow/ and the link from a fresh repo, keeps the config, and a commit then needs no flow", () => {
    const fresh = newRepo();
    try {
      expect(flow(fresh, ["init"]).code).toBe(0);
      const said = flow(fresh, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout.trim().split("\n")).toEqual([
        "flow uninstall — removed:",
        "  - .githooks/commit-msg",
        "  - core.hooksPath (it was .githooks)",
        "  - .githooks/",
        "  - .flow/ — flow's state and logs",
        "  - node_modules/@jawache/flow — the link `flow init` made",
        `  - .claude/settings.json — ${LISTED}`,
        `  - .codex/hooks.json — ${LISTED}`,
        "  · kept flow.config.ts and the packs it imports — `flow init` wires this repo again.",
        "  next: `npm uninstall @jawache/flow` — removes the package.",
      ]);
      expect(git(fresh, ["config", "--get", "core.hooksPath"]).stdout, "core.hooksPath is unset").toBe("");
      for (const gone of [".githooks", ".flow", "node_modules"]) expect(existsSync(join(fresh, gone)), `${gone} is gone`).toBe(false);
      expect(existsSync(join(fresh, "flow.config.ts")), "the config stays").toBe(true);

      const committed = noFlow(fresh);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
      expect(flow(fresh, ["uninstall"]).stdout, "a second run").toContain("nothing of flow's here to remove");
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("takes flow's hooks out of a dev dependency's .claude/settings.json, keeps its other keys, and names the repo's npm uninstall", () => {
    const listed = newRepo();
    const machine = settingsHome();
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      mkdirSync(join(listed, ".claude"), { recursive: true });
      const theirs = { hooks: [{ type: "command", command: "say done" }] };
      writeFileSync(
        join(listed, ".claude", "settings.json"),
        `${JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [theirs] } }, null, 2)}\n`,
      );
      expect(flow(listed, ["init"], machine).code).toBe(0);

      const said = flow(listed, ["uninstall"], machine);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain("  - .claude/settings.json — SessionStart · SubagentStart · PreToolUse · PostToolUse · Stop · SubagentStop");
      expect(said.stdout.trim().split("\n").at(-1)).toBe("  next: `npm uninstall @jawache/flow` — removes the package.");
      const after = JSON.parse(readFileSync(join(listed, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
      expect(after, "flow's registrations are gone, the empty events with them, and every other key and hook stays").toEqual({
        permissions: { allow: ["Bash(ls:*)"] },
        hooks: { Stop: [theirs] },
      });

      const committed = noFlow(listed);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
    } finally {
      for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes only flow's two lines out of a gate somebody wrote, and keeps core.hooksPath for it", () => {
    const theirs = newRepo();
    try {
      const own = "#!/bin/sh\n# my own checks\necho mine-ran\n";
      mkdirSync(join(theirs, ".githooks"), { recursive: true });
      writeFileSync(join(theirs, ".githooks", "commit-msg"), own, { mode: 0o755 });
      expect(flow(theirs, ["init"]).code).toBe(0);
      // What init's report tells them to do: add the two lines to the end of it.
      writeFileSync(
        join(theirs, ".githooks", "commit-msg"),
        `${own}f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit\nexec flow hook commit\n`,
      );

      const said = flow(theirs, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain("  - flow's lines from .githooks/commit-msg — the rest of the hook is kept");
      expect(said.stdout).toContain("  · kept core.hooksPath at .githooks — git still runs the hooks there: commit-msg.");
      expect(readFileSync(join(theirs, ".githooks", "commit-msg"), "utf8"), "their hook, as they wrote it").toBe(own);
      expect(git(theirs, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");

      const committed = noFlow(theirs);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
      expect(committed.stdout + committed.stderr, "git still runs their hook").toContain("mine-ran");
    } finally {
      rmSync(theirs, { recursive: true, force: true });
    }
  });

  it("deletes flow's gate but keeps core.hooksPath and .githooks/ while the folder holds another hook", () => {
    const shared = newRepo();
    try {
      mkdirSync(join(shared, ".githooks"), { recursive: true });
      writeFileSync(join(shared, ".githooks", "pre-commit"), "#!/bin/sh\necho msg-hook-ran\n", { mode: 0o755 });
      expect(flow(shared, ["init"]).code).toBe(0);

      const said = flow(shared, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain("  - .githooks/commit-msg");
      expect(said.stdout).toContain("  · kept core.hooksPath at .githooks — git still runs the hooks there: pre-commit.");
      expect(existsSync(join(shared, ".githooks", "commit-msg"))).toBe(false);
      expect(existsSync(join(shared, ".githooks", "pre-commit"))).toBe(true);
      expect(git(shared, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");

      const committed = noFlow(shared);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
      expect(committed.stdout + committed.stderr, "git still runs the other hook").toContain("msg-hook-ran");
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  });

  // `core.hooksPath` IS THE WHOLE REPO'S, wherever the command is typed. Only a run at the repo's
  // top folder unsets it: from a subfolder it would leave the gate behind with nothing pointing git
  // at it, and every commit unguarded.
  it("run from a subfolder, keeps core.hooksPath and the gate, and names the top folder to run it in", () => {
    const nested = newRepo();
    try {
      expect(flow(nested, ["init"]).code).toBe(0);
      const sub = join(nested, "sub");
      mkdirSync(sub);

      const said = flow(sub, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      const top = git(nested, ["rev-parse", "--show-toplevel"]).stdout.trim();
      expect(said.stdout.trim().split("\n")[0]).toBe("flow uninstall — removed nothing from this folder.");
      expect(said.stdout).toContain(
        `  · kept core.hooksPath at .githooks — git reads it for the whole repo, and this run is in a subfolder. Run \`flow uninstall\` in ${top} to remove it with the gate.`,
      );
      expect(said.stdout, "the hooks folder is read at the top folder, so flow's own gate is not taken for another tool's hook").not.toContain(
        "still calls flow",
      );
      expect(git(nested, ["config", "--get", "core.hooksPath"]).stdout.trim(), "the repo's hooks path stays").toBe(".githooks");
      expect(existsSync(join(nested, ".githooks", "commit-msg")), "the gate stays").toBe(true);

      const removed = flow(nested, ["uninstall"]);
      expect(removed.stdout, "from the top folder, it all goes").toContain("  - core.hooksPath (it was .githooks)");
    } finally {
      rmSync(nested, { recursive: true, force: true });
    }
  });

  // ANOTHER FOLDER'S PRE-COMMIT HOOK, such as husky's: `flow init` told the person to add flow's two
  // lines to it, and never edits it, so neither does uninstall. It names the hook and its lines, and
  // a person who follows the report commits with flow gone.

  /** The lines the report names under the hook it kept, as it printed them. */
  const linesToDelete = (stdout: string, commitMsg: string): string[] => {
    const lines = stdout.split("\n");
    const at = lines.findIndex((line) => line.startsWith(`  · ${commitMsg} still calls flow`));
    expect(at, "the report names the hook").not.toBe(-1);
    const named: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (!line.startsWith("      ")) break;
      named.push(line.trim());
    }
    return named;
  };

  it("leaves a husky .husky/commit-msg that calls flow byte for byte, names it and flow's two lines, and following the report commits with flow gone", () => {
    const husky = huskyRepo("echo husky ran\n");
    try {
      const first = flow(husky, ["init"]);
      const wiredHook = `echo husky ran\n${linesToAdd(first.stdout, ".husky/commit-msg").join("\n")}\n`;
      writeFileSync(join(husky, ".husky", "commit-msg"), wiredHook);
      expect(flow(husky, ["init"]).code, "installed through husky").toBe(0);

      const said = flow(husky, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(readFileSync(join(husky, ".husky", "commit-msg"), "utf8"), "husky's hook, byte for byte").toBe(wiredHook);
      expect(git(husky, ["config", "--get", "core.hooksPath"]).stdout.trim(), "husky's setting, as it was").toBe(".husky/_");
      const named = linesToDelete(said.stdout, ".husky/commit-msg");
      expect(named, "the two lines init told them to add").toEqual(linesToAdd(first.stdout, ".husky/commit-msg"));
      expect(said.stdout.trim().split("\n").at(-1)).toBe(
        "  next: delete flow's lines from .husky/commit-msg, then `npm uninstall @jawache/flow` — removes the package.",
      );

      // Skipped, the report is right: husky's hook still calls the flow that is gone.
      const skipped = noFlow(husky);
      expect(skipped.code, "a commit before the lines go fails").not.toBe(0);
      expect(skipped.stderr).toContain("flow: not found");

      // Followed: the named lines out of the hook, and nothing else.
      const theirs = wiredHook.split("\n").filter((line) => !named.includes(line.trim())).join("\n");
      writeFileSync(join(husky, ".husky", "commit-msg"), theirs);
      const committed = noFlow(husky);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
      expect(committed.stdout + committed.stderr, "husky's own hook still runs").toContain("husky ran");
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("says nothing of a husky .husky/commit-msg that does not call flow, and leaves it byte for byte", () => {
    const husky = huskyRepo("echo husky ran\n");
    try {
      expect(flow(husky, ["init"]).code, "not installed: the hook does not call flow").toBe(1);
      const said = flow(husky, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).not.toContain(".husky/commit-msg");
      expect(said.stdout.trim().split("\n").at(-1)).toBe(
        "  next: `npm uninstall @jawache/flow` — removes the package.",
      );
      expect(readFileSync(join(husky, ".husky", "commit-msg"), "utf8")).toBe("echo husky ran\n");
      expect(noFlow(husky).code, "a commit then needs no flow").toBe(0);
    } finally {
      rmSync(husky, { recursive: true, force: true });
    }
  });

  it("leaves a .git/hooks/commit-msg that calls flow byte for byte, and names it and its lines", () => {
    const lfs = lfsRepo();
    try {
      const first = flow(lfs, ["init"]);
      const hook = join(lfs, ".git", "hooks", "commit-msg");
      const wiredHook = `${linesToCreate(first.stdout, ".git/hooks/commit-msg").join("\n")}\n`;
      writeFileSync(hook, wiredHook, { mode: 0o755 });
      expect(flow(lfs, ["init"]).code, "installed through .git/hooks").toBe(0);

      const said = flow(lfs, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(readFileSync(hook, "utf8"), "git's own hook, byte for byte").toBe(wiredHook);
      expect(linesToDelete(said.stdout, ".git/hooks/commit-msg"), "flow's two lines, not the shebang").toEqual(
        linesToCreate(first.stdout, ".git/hooks/commit-msg").slice(1),
      );
      expect(said.stdout.trim().split("\n").at(-1)).toMatch(/^ {2}next: delete flow's lines from \.git\/hooks\/commit-msg, then /);
    } finally {
      rmSync(lfs, { recursive: true, force: true });
    }
  });

  // THE SHELL'S OWN FAILURE PATH: a removal the disk refuses. Root deletes through any mode, so the
  // case cannot be staged there.
  it.skipIf(process.getuid?.() === 0)("lists a removal the disk refused, names it, still removes the rest, and answers 1", () => {
    const locked = newRepo();
    const hooksDir = join(locked, ".githooks");
    try {
      expect(flow(locked, ["init"]).code).toBe(0);
      chmodSync(hooksDir, 0o555);

      const said = flow(locked, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(1);
      expect(said.stdout).toMatch(/^ {2}✗ could not delete \.githooks\/commit-msg: /m);
      expect(existsSync(join(hooksDir, "commit-msg")), "the gate the disk would not let go").toBe(true);
      expect(existsSync(join(locked, ".flow")), "the other steps still ran").toBe(false);
    } finally {
      chmodSync(hooksDir, 0o755);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it("refuses an argument it does not know with exit 2 and the usage line, and removes nothing", () => {
    const wired = newRepo();
    try {
      expect(flow(wired, ["init"]).code).toBe(0);
      const said = flow(wired, ["uninstall", "--dry-run"]);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe("flow uninstall — unknown argument `--dry-run`; nothing was removed.\nusage: flow uninstall [--machine]\n");
      expect(said.stdout).toBe("");
      for (const kept of [".githooks/commit-msg", ".flow"]) expect(existsSync(join(wired, kept)), `${kept} is still there`).toBe(true);
    } finally {
      rmSync(wired, { recursive: true, force: true });
    }
  });

  // THE MACHINE-WIDE FILE: every repo on the machine reads it, so only `--machine` writes it. Each
  // case points CLAUDE_CONFIG_DIR at its own throwaway folder, holding a hook of the user's own
  // beside the ones flow init registers there.
  describe("--machine", () => {
    const theirs = { hooks: [{ type: "command", command: "say done" }] };
    const own = { permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [theirs] } };
    /**
     * A throwaway machine-wide folder whose settings file holds the user's own hook, and then flow
     * 0.3's registrations: what 0.3 wrote there, and what 0.4 never writes.
     */
    const machineWithFlow = (): { machine: string; file: string } => {
      const machine = settingsHome();
      const file = join(machine, "settings.json");
      const donor = newRepo();
      try {
        expect(flow(donor, ["init"]).code).toBe(0);
        const registered = (settings(donor)["hooks"] ?? {}) as Record<string, unknown[]>;
        writeFileSync(file, `${JSON.stringify({ ...own, hooks: { ...registered, Stop: [theirs, ...(registered["Stop"] ?? [])] } }, null, 2)}\n`);
      } finally {
        rmSync(donor, { recursive: true, force: true });
      }
      expect(Object.keys((JSON.parse(readFileSync(file, "utf8")) as { hooks: object }).hooks).sort(), "flow's registrations are in it").toEqual([...REGISTERED].sort());
      return { machine, file };
    };

    it("a plain run leaves the machine-wide file byte for byte and names --machine; --machine then takes flow's registrations out and keeps the user's hook", () => {
      const global = newRepo();
      const { machine, file } = machineWithFlow();
      try {
        expect(flow(global, ["init"], machine).code).toBe(0);
        const before = readFileSync(file, "utf8");

        const plain = flow(global, ["uninstall"], machine);
        expect(plain.code, plain.stdout + plain.stderr).toBe(0);
        expect(readFileSync(file, "utf8"), "without --machine, the machine-wide file is unchanged").toBe(before);
        expect(plain.stdout).toContain(`  · ${file} still holds flow's hooks, and every repo on this machine runs them — \`flow uninstall --machine\` removes them.`);
        expect(plain.stdout.trim().split("\n").at(-1)).toBe(
          "  next: `flow uninstall --machine` once no repo on this machine needs flow, then `npm uninstall @jawache/flow` — removes the hooks, then the package.",
        );

        const said = flow(global, ["uninstall", "--machine"], machine);
        expect(said.code, said.stdout + said.stderr).toBe(0);
        expect(said.stdout).toContain(`  - ${file} — ${LISTED}`);
        expect(said.stdout.trim().split("\n").at(-1)).toBe("  next: `npm uninstall @jawache/flow` — removes the package.");
        expect(JSON.parse(readFileSync(file, "utf8")), "flow's registrations are gone, and the user's hook and keys stay").toEqual(own);
        expect(flow(global, ["uninstall", "--machine"], machine).stdout, "a second run").toContain("nothing of flow's here to remove");
      } finally {
        for (const dir of [global, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });

    it("cleans the repo's own file beside the machine-wide one, whatever the repo's package.json lists", () => {
      const listed = newRepo();
      const { machine, file } = machineWithFlow();
      try {
        const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
        writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
        expect(flow(listed, ["init"], machine).code).toBe(0);
        const said = flow(listed, ["uninstall", "--machine"], machine);
        expect(said.code, said.stdout + said.stderr).toBe(0);
        expect(said.stdout).toContain(`  - .claude/settings.json — ${LISTED}`);
        expect(said.stdout).toContain(`  - ${file} — ${LISTED}`);
        expect(JSON.parse(readFileSync(file, "utf8")), "flow's registrations are gone, and the user's hook and keys stay").toEqual(own);
      } finally {
        for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });

    it("writes nothing to a machine-wide file that would not parse, says so, and answers 1", () => {
      const global = newRepo();
      const { machine, file } = machineWithFlow();
      try {
        expect(flow(global, ["init"], machine).code).toBe(0);
        const unparseable = `${readFileSync(file, "utf8")}// a comment\n`;
        writeFileSync(file, unparseable);

        const said = flow(global, ["uninstall", "--machine"], machine);
        expect(said.code).toBe(1);
        expect(said.stdout).toContain(`  ✗ ${file} is not valid JSON`);
        expect(said.stdout).toContain("run `flow uninstall --machine` again.");
        expect(said.stdout, "the repo's own steps still ran").toContain("  - .githooks/commit-msg");
        expect(readFileSync(file, "utf8"), "the file nobody could parse is not written").toBe(unparseable);
      } finally {
        for (const dir of [global, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("a dev dependency's .claude/settings.json that would not parse is not written, and answers 1", () => {
    const broken = newRepo();
    const machine = settingsHome();
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(broken, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      expect(flow(broken, ["init"], machine).code).toBe(0);
      const unparseable = `${readFileSync(join(broken, ".claude", "settings.json"), "utf8")}// a comment\n`;
      writeFileSync(join(broken, ".claude", "settings.json"), unparseable);

      const said = flow(broken, ["uninstall"], machine);
      expect(said.code).toBe(1);
      expect(said.stdout).toContain("✗ .claude/settings.json is not valid JSON");
      expect(said.stdout, "the other steps still ran").toContain("  - .githooks/commit-msg");
      expect(existsSync(join(broken, ".flow"))).toBe(false);
      expect(readFileSync(join(broken, ".claude", "settings.json"), "utf8"), "the file nobody could parse is not written").toBe(unparseable);
    } finally {
      for (const dir of [broken, machine]) rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the repo's package.json type", () => {
  const SHAPES = [
    { what: "absent", json: null },
    { what: "no type field — loads by detection, but node warns every run", json: { name: "consumer", version: "1.0.0" } },
    { what: "commonjs — verbatim what `npm init` writes", json: { name: "consumer", version: "1.0.0", type: "commonjs" } },
    { what: "module", json: { name: "consumer", version: "1.0.0", type: "module" } },
  ] as const;

  for (const shape of SHAPES) {
    it(`does not decide whether the guard runs — ${shape.what}`, () => {
      const repo = newRepo();
      try {
        if (shape.json) writeFileSync(join(repo, "package.json"), `${JSON.stringify(shape.json, null, 2)}\n`);
        expect(flow(repo, ["init"]).code, "init").toBe(0);

        // The whole point, and the exact line that was red: the scaffolded config LOADS.
        const said = flow(repo, ["status"]);
        expect(said.stdout, "status").toContain("green — every rule loads");
        expect(said.stderr, "nothing on stderr — not node's ESM complaint, not an ExperimentalWarning").toBe("");
        expect(said.code, "status exit").toBe(0);

        // And its rules really run, which is a different fact from the config importing.
        expect(flow(repo, ["test"]).stdout, "test").toContain("all green");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });
  }

  it("loads a pack the config imports from a plain .ts file beside it", () => {
    // The config is never alone: a repo's own pack sits next door and is reached by a relative
    // import, so it is loaded through the same hook and has to be stripped the same way. A fix that
    // only handled the entry file would pass every row above and break the first real repo.
    const repo = newRepo();
    try {
      // `commonjs`, deliberately — the shape that does not load at all, so this row fails when the
      // hook stops covering a config's relative imports rather than only its entry file.
      const pkg = { name: "c", version: "1.0.0", type: "commonjs" };
      writeFileSync(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      expect(flow(repo, ["init"]).code).toBe(0);

      // THE FIXTURE the other two suites drive (flow/__fixtures__/repo-pack.ts), written here as a
      // repo's own pack is: a `.ts` file next door, reached by a relative import. It carries an
      // interface and an annotated function for this row's sake — plain JavaScript syntax would
      // prove the file was reached and nothing about the stripping. `@jawache/flow` is the
      // specifier because `flow init` linked it, this repo having no dependency of its own.
      mkdirSync(join(repo, "guards"), { recursive: true });
      writeFileSync(join(repo, "guards", "house.ts"), fixturePack("repo-pack", "@jawache/flow"));
      writeFileSync(
        join(repo, "flow.config.ts"),
        bindInConfig(readFileSync(join(repo, "flow.config.ts"), "utf8"), {
          above: `import { house } from "./guards/house.ts";`,
          bind: "pack(house)",
        }),
      );
      const said = flow(repo, ["status"]);
      expect(said.stdout, "the repo's own pack is bound").toContain("house.ranSomething");
      expect(said.stdout).toContain("green — every rule loads");
      expect(said.stderr, "silent, as every row above").toBe("");
      expect(said.code).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("flow init --empty", () => {
  it("leaves the wiring and no opinions", () => {
    const bare = newRepo();
    try {
      expect(flow(bare, ["init", "--empty"]).code).toBe(0);
      const config = readFileSync(join(bare, "flow.config.ts"), "utf8");
      expect(config).toContain("defineConfig([])");
      expect(config).not.toContain("definePack");
      expect(existsSync(join(bare, ".githooks", "commit-msg")), "the wiring is the same").toBe(true);
      // It loads and binds nothing, which is a different fact from not loading.
      const said = flow(bare, ["status"]);
      expect(said.stdout).toContain("0 guardrails");
      expect(said.code).toBe(0);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

// ── the hand-written pages, pinned to the binary ─────────────────────────────
//
// THE PRINCIPLE, ruled with the human on 2026-09-09: a HAND-WRITTEN page is pinned by a test that
// fails when it and the binary disagree. The README's transcripts had that already, and were the
// only pages that had not drifted — the Getting started tutorial claimed a scaffold that stopped
// existing at the split, and the exit-code table published a 1/2 split the binary never made.
//
// The three substitutions above are this file's, and docs/user/tutorials/getting-started.md quotes
// the same spellings.

/** The fenced block on a docs page that opens with this line, as text. */
const paged = (page: string, opening: string): string => fenced(join(PACKAGE, "docs", "user", page), opening);

// The tutorial is pinned outside the commit gate: it runs only under FLOW_TUTORIAL, which
// `just test-tutorial` sets. The docs are written before the code, so a docs commit that changes
// the tutorial's transcripts must not be refused for the binary not printing them yet; the pin has
// to hold once the build is done, in the full suite and before a release.
describe.runIf(process.env["FLOW_TUTORIAL"])("the Getting started tutorial's transcripts", () => {
  it("are what `flow init`, `flow status`, `flow test` and both refusals really print", () => {
    const mine = newRepo();
    // STEP 1 OF THE PAGE: `npm init -y` and `npm i -D --allow-git=root github:jawache/flow#v…`. The repo lists flow
    // as a dev dependency and holds it in node_modules, here the build under test, so `flow init`
    // writes no link and warns of no missing install, as it does on a repo that followed step 1.
    writeFileSync(join(mine, "package.json"), JSON.stringify({ name: "my-repo", devDependencies: { "@jawache/flow": "github:jawache/flow" } }));
    mkdirSync(join(mine, "node_modules", "@jawache"), { recursive: true });
    symlinkSync(builtPackage(), join(mine, "node_modules", "@jawache", "flow"), "dir");
    const firstTime = mkdtempSync(join(tmpdir(), "flow-quickstart-"));
    const page = (opening: string): string => paged(join("tutorials", "getting-started.md"), opening);
    const said = (args: readonly string[], stdin = ""): string => {
      const ran = runFlow(mine, args, { home: firstTime, bin }, stdin);
      return asQuoted(ran.stdout || ran.stderr, mine, firstTime);
    };
    try {
      expect(said(["init"]), "§2").toBe(page("! Codex:"));
      // §3 — "Replace the file with this": the page's own config, then the status it quotes.
      writeFileSync(join(mine, "flow.config.ts"), `${page("import { banCommands")}\n`);
      expect(said(["status"]), "§4 status").toBe(page("flow is ON —"));

      // §5 — "See a commit refused": a file that breaks house.noTodo, then a message that breaks house.header.
      mkdirSync(join(mine, "src"));
      writeFileSync(join(mine, "src", "a.ts"), "// TODO: later\n");
      runGit(mine, ["add", "src/a.ts"]);
      expect(said(["hook", "commit"]), "§5 noTodo").toBe(page("flow — commit blocked:\n\n✗ house.noTodo"));
      writeFileSync(join(mine, "src", "a.ts"), "export const a = 1;\n");
      runGit(mine, ["add", "src/a.ts"]);
      const message = join(mine, "msg.txt");
      writeFileSync(message, "wip\n");
      expect(said(["hook", "commit", message]), "§5 header").toBe(page("flow — commit blocked:\n\n✗ house.header"));

      // §6 — "See a command refused": the force-push the page names, on the rail the host sends it on.
      const forced = JSON.stringify(pre("Bash", { command: "git push --force origin main" }));
      expect(said(["hook", "pre-tool-use"], forced), "§6").toBe(page("flow — command blocked before it ran:"));

      // §7 — "See a breadcrumb shown": after the first change under src/, once.
      const changed = JSON.stringify({ ...pre("Write", { file_path: join(mine, "src", "a.ts"), content: "export const a = 1;\n" }, "tutorial-1"), cwd: mine });
      const shown = runFlow(mine, ["hook", "post-tool-use"], { home: firstTime, bin }, changed);
      const context = (JSON.parse(shown.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
      expect(context, "§7").toBe(page("# breadcrumb: house.sourceLayout"));
      expect(runFlow(mine, ["hook", "post-tool-use"], { home: firstTime, bin }, changed).stdout, "§7, a second change").toBe("");

      // §8 — the census the page quotes as a comment beside the command.
      expect(page("npx flow test").split("\n").at(-1), "§8").toBe(`# ${said(["test"])}`);
    } finally {
      for (const dir of [mine, firstTime]) rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the command reference's exit-code table", () => {
  /** The table's rows, as `{ "0": "passed — …" }` — the codes it publishes and what it says they mean. */
  function published(): Record<string, string> {
    const text = readFileSync(join(PACKAGE, "docs", "user", "reference", "cli.md"), "utf8");
    const table = text.slice(text.indexOf("## Exit codes"));
    const rows = [...table.matchAll(/^\| `(\d)` \| (.+?) \|$/gm)];
    expect(rows.length, "the exit-code table has three rows").toBe(3);
    return Object.fromEntries(rows.map((row) => [row[1] as string, row[2] as string]));
  }

  it("publishes exactly the codes the binary answers with, on every path it names", () => {
    const table = published();
    expect(Object.keys(table).sort()).toStrictEqual(["0", "1", "2"]);

    // THE ROW HAS TO NAME THE RIGHT CAUSES, not just the right number. The fault this pin exists
    // for was a row that read "the answer is no — a rule refused, or a fitting is missing" beside
    // the `1`, when a refusing rule has always answered 2. A pin over the codes alone would have
    // watched that sentence for another year.
    expect(table["1"], "1 is the two verbs you ASK").toMatch(/flow status/);
    expect(table["1"]).toMatch(/flow test/);
    expect(table["1"], "a refusing rule is not a 1, and never was").not.toMatch(/\brule\b/);
    expect(table["2"], "2 is every refusal").toMatch(/\brule\b/);
    expect(table["2"]).toMatch(/config/);
    expect(table["2"]).toMatch(/verb/);

    const repo = newRepo();
    const home = mkdtempSync(join(tmpdir(), "flow-codes-"));
    const codeIn = (where: string, args: readonly string[], stdin = ""): number => runFlow(where, args, { home, bin }, stdin).code;
    const code = (args: readonly string[], stdin = ""): number => codeIn(repo, args, stdin);
    const config = join(repo, "flow.config.ts");
    try {
      flow(repo, ["init"], home);

      // ── 0 · nothing refused, every fitting in place
      expect(code(["status"]), "green status").toBe(0);
      expect(code(["test"]), "every case green").toBe(0);

      // ── 1 · the two verbs you ASK: a fitting missing, or a case that fails
      const unwired = newRepo();
      expect(codeIn(unwired, ["status"]), "no config at all — a fitting is missing").toBe(1);
      rmSync(unwired, { recursive: true, force: true });
      // The scaffold binds a pack that is not this file's to break, so the breakers below get a
      // config with a pack of its own written inline, and the shipped one beside it.
      const good = [
        'import { banCommands, command, defineConfig, definePack, guardrail, pack } from "@jawache/flow";',
        'import { flow } from "@jawache/flow/packs";',
        'export const demo = definePack("demo", {',
        "  noForcePush: guardrail()",
        "    .at(command)",
        '    .check(banCommands({ ban: ["git push --force"] }))',
        '    .message("Force-pushing rewrites history.")',
        '    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),',
        "});",
        "export default defineConfig([pack(flow), pack(demo)]);",
        "",
      ].join("\n");
      writeFileSync(config, good.replace('pass: ["git push origin main"]', 'pass: ["git push --force origin main"]'));
      expect(code(["test"]), "a case that should pass, failing").toBe(1);
      writeFileSync(config, good);

      // ── 2 · something refused: a rule blocked …
      stageGuardDeletion(repo, { home, bin });
      expect(code(["hook", "commit"]), "a rule blocked at the gate").toBe(2);
      const forced = JSON.stringify(pre("Bash", { command: "flow uninstall" }));
      expect(code(["hook", "pre-tool-use"], forced), "a rule blocked at a hook").toBe(2);
      runGit(repo, ["add", "flow.config.ts"]);

      // … or the config would not load — EVERY way it can fail to, from the table `live.test.ts`
      // drives through the hook rail. This is the row that was wrong: status answered 1 for a
      // grammar refusal and 2 for an import fault, which is one fact wearing two codes.
      for (const [how, breaker] of Object.entries(BREAKS)) {
        writeFileSync(config, breaker(good));
        for (const verb of [["status"], ["test"], ["hook", "commit"]])
          expect(code(verb), `${verb.join(" ")}, ${how}`).toBe(2);
      }
      writeFileSync(config, good);

      // … or a verb was misused.
      expect(code(["wibble"]), "a verb that does not exist").toBe(2);
      expect(code([]), "no verb at all — the usage banner").toBe(2);
    } finally {
      for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true });
    }
  });
});
