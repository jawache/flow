// flow/adapter/product.test.ts — `flow init`, `flow status` and `flow uninstall`, end to end,
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
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, lstatSync, symlinkSync } from "node:fs";
import { join } from "node:path";
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

const settings = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as Record<string, unknown>;

/** The events flow init registers, in the order it writes and prints them. */
const REGISTERED = ["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop"];

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
    expect(first.stdout).toContain(".githooks/pre-commit");
    expect(first.stdout).toContain("core.hooksPath");
    expect(first.stdout).toContain("SessionStart");
  });

  it("leaves a config, a gate, a state directory and a resolvable @jawache/flow", () => {
    expect(existsSync(join(repo, "flow.config.ts"))).toBe(true);
    expect(existsSync(join(repo, ".flow"))).toBe(true);
    expect(readFileSync(join(repo, ".githooks", "pre-commit"), "utf8")).toContain("flow hook commit");
    expect(lstatSync(join(repo, "node_modules", "@jawache", "flow")).isSymbolicLink()).toBe(true);
    expect(git(repo, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");
  });

  it("registers the events flow answers, and not Notification", () => {
    const hooks = settings()["hooks"] as Record<string, unknown>;
    expect(first.stdout).toContain(LISTED);
    expect(Object.keys(hooks)).toEqual(REGISTERED);
    expect(JSON.stringify(hooks["PostToolUse"]), "every tool can change the tree").toContain('"matcher":"*"');
    expect(JSON.stringify(hooks)).toContain("flow hook stop");
    expect(JSON.stringify(hooks["SubagentStop"]), "a subagent's hand-back is its own event").toContain("flow hook subagent-stop");
    expect(Object.keys(hooks)).not.toContain("Notification");
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
  });

  it("blocks the force-push it bans — UAT step 3", () => {
    const answer = hook(repo, "pre-tool-use", pre("Bash", { command: "git push --force origin main" }, "demo-1"), {
      home,
    });
    expect(answer.code).toBe(2);
    expect(answer.stderr).toContain("demo.noForcePush");
    expect(answer.stderr).toContain("Force-pushing rewrites history");
  });

  it("refuses the commit of a marked file at git's own hook, and passes the same commit once it is clean — UAT step 4", () => {
    const marked = join(repo, "secret.txt");
    // Built rather than written, for the same reason the config builds it: this file must not carry
    // the marker either, or the suite would refuse its own commit.
    const MARKER = ["DO", "NOT", "COMMIT"].join("-");
    writeFileSync(marked, `${MARKER} — an api key would go here\n`);
    git(repo, ["add", "secret.txt"]);

    const refused = git(repo, ["commit", "-m", "test: a marked file"]);
    expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
    expect(refused.stderr).toContain("demo.noMarkedFiles");
    expect(refused.stderr).toContain("carries the marker");

    writeFileSync(marked, "an api key would go here\n");
    git(repo, ["add", "secret.txt"]);
    const passed = git(repo, ["commit", "-m", "test: a clean file"]);
    expect(passed.code, passed.stdout + passed.stderr).toBe(0);
  });
});

describe("flow status", () => {
  it("lists every rule by moment, with its scope and the category it binds to — UAT step 7", () => {
    const said = flow(repo, ["status"]);
    expect(said.code, said.stdout + said.stderr).toBe(0);
    expect(said.stdout).toContain("flow is ON");
    expect(said.stdout, "flow's own self-protection is bound by default").toContain("flow.orientation");
    expect(said.stdout).toContain("demo.noForcePush");
    expect(said.stdout).toContain("for subagent");
    expect(said.stdout).toContain("categories subagent");
    expect(said.stdout).toContain("green — every rule loads");
  });

  it("hands the same answer over as data", () => {
    const read = JSON.parse(flow(repo, ["status", "--json"]).stdout) as {
      green: boolean;
      categories: string[];
      fittings: { id: string; ok: boolean }[];
    };
    expect(read.green).toBe(true);
    expect(read.categories).toEqual(["subagent"]);
    expect(read.fittings.every((f) => f.ok)).toBe(true);
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
      expect(said.stdout).toContain("✓ binary: the hooks and the gate run the flow in node_modules/@jawache/flow");
      expect(said.code, said.stdout).toBe(0);

      const MARKER = ["DO", "NOT", "COMMIT"].join("-");
      writeFileSync(join(local, "secret.txt"), `${MARKER} — an api key would go here\n`);
      runGit(local, ["add", "secret.txt"], world);
      const refused = runGit(local, ["commit", "-m", "test: a marked file"], world);
      expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
      expect(refused.stderr, "flow refused it, not `flow: not found` and not the other flow").toContain("demo.noMarkedFiles");

      const written = JSON.parse(readFileSync(join(local, ".claude", "settings.json"), "utf8")) as {
        hooks: Record<string, { hooks: { command: string }[] }[]>;
      };
      const registered = written.hooks["PreToolUse"]?.[0]?.hooks[0]?.command;
      expect(registered).toBe('f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook pre-tool-use; exec flow hook pre-tool-use');
      const answered = sh(local, registered ?? "", world, JSON.stringify(pre("Bash", { command: "git push --force origin main" }, "dev-dep-1")));
      expect(answered.code, answered.stderr).toBe(2);
      expect(answered.stderr).toContain("demo.noForcePush");
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

      const MARKER = ["DO", "NOT", "COMMIT"].join("-");
      writeFileSync(join(below, "secret.txt"), `${MARKER} — an api key would go here\n`);
      git(below, ["add", "secret.txt"]);
      const refused = git(below, ["commit", "-m", "test: a marked file"]);
      expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
      expect(refused.stderr, "the PATH's flow refused it").toContain("demo.noMarkedFiles");

      const registered = (settings()["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["PreToolUse"]?.[0]?.hooks[0]?.command;
      expect(registered).toContain("; exec flow hook pre-tool-use");
      const answered = sh(below, registered ?? "", { home, bin }, JSON.stringify(pre("Bash", { command: "git push --force origin main" }, "fallback-1")));
      expect(answered.code, answered.stderr).toBe(2);
      expect(answered.stderr).toContain("demo.noForcePush");
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

  it("goes red on the registration an older flow wrote, and widens it in place when init runs again", () => {
    const older = settingsHome();
    try {
      const current = settings() as { hooks: Record<string, unknown> };
      const { PostToolUseFailure: _dropped, ...rest } = current.hooks;
      writeFileSync(
        join(older, "settings.json"),
        JSON.stringify({
          hooks: {
            ...rest,
            PostToolUse: [{ matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] }],
          },
        }),
      );
      const red = flow(repo, ["status"], older);
      expect(red.code).toBe(1);
      expect(red.stdout).toContain("does not call flow for PostToolUseFailure");
      expect(red.stdout).toContain("calls flow for PostToolUse on some tools only");
      expect(red.stdout).toContain("Re-run `flow init` to widen it.");

      const again = flow(repo, ["init"], older);
      expect(again.code).toBe(0);
      // The older flow wrote the bare command too, so the one entry is widened and rewritten at once.
      expect(again.stdout).toContain(
        "PostToolUse (widened to every tool, now runs the flow in node_modules/@jawache/flow first) · PostToolUseFailure",
      );
      const hooks = (JSON.parse(readFileSync(join(older, "settings.json"), "utf8")) as { hooks: Record<string, unknown[]> }).hooks;
      expect(hooks["PostToolUse"], "one entry, widened — never a second one beside it").toHaveLength(1);
      expect(JSON.stringify(hooks["PostToolUse"])).toContain(
        JSON.stringify('f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook post-tool-use; exec flow hook post-tool-use'),
      );
      expect(flow(repo, ["status"], older).code).toBe(0);
    } finally {
      rmSync(older, { recursive: true, force: true });
    }
  });

  // THE FILE AN INIT BEFORE 0.3.0 WROTE: every registration but SubagentStop. Status names the one
  // missing, and init adds it.
  it("goes red on a file without SubagentStop, and adds it when init runs again", () => {
    const older = settingsHome();
    try {
      const current = settings() as { hooks: Record<string, unknown> };
      const { SubagentStop: _dropped, ...rest } = current.hooks;
      writeFileSync(join(older, "settings.json"), JSON.stringify({ hooks: rest }));

      const red = flow(repo, ["status"], older);
      expect(red.code).toBe(1);
      expect(red.stdout).toContain(`✗ hooks: ${join(older, "settings.json")} does not call flow for SubagentStop — re-run \`flow init\`.`);

      const again = flow(repo, ["init"], older);
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(again.stdout).toContain(`+ ${join(older, "settings.json")} — SubagentStop\n`);
      expect(flow(repo, ["status"], older).code).toBe(0);
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

  it("never overwrites a pre-commit hook somebody else put there", () => {
    const theirs = newRepo();
    try {
      mkdirSync(join(theirs, ".githooks"), { recursive: true });
      writeFileSync(join(theirs, ".githooks", "pre-commit"), "#!/bin/sh\nnpm test\n", { mode: 0o755 });
      const said = flow(theirs, ["init"]);
      expect(readFileSync(join(theirs, ".githooks", "pre-commit"), "utf8")).toBe("#!/bin/sh\nnpm test\n");
      expect(said.stdout).toContain("kept");
      expect(said.stdout).toContain("flow hook commit");
    } finally {
      rmSync(theirs, { recursive: true, force: true });
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

/** The fenced block in the README that opens with this line. */
const quoted = (opening: string): string => fenced(join(PACKAGE, "README.md"), opening);

/** Code with its indentation taken off every line — a block quoted at the margin, compared. */
const unindented = (code: string): string =>
  code
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

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

describe("the README's example", () => {
  it("quotes a rule from the config `flow init` writes, and the refusal it really prints", () => {
    const shown = newRepo();
    const firstTime = mkdtempSync(join(tmpdir(), "flow-readme-"));
    try {
      expect(flow(shown, ["init"], firstTime).code).toBe(0);
      const written = unindented(readFileSync(join(shown, "flow.config.ts"), "utf8"));
      expect(written, "the rule is the demo's own, word for word").toContain(unindented(quoted("noForcePush: guardrail()")));

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

describe("a repo whose package.json lists flow", () => {
  it("creates .claude/settings.json inside the repo on the first run, when it has no .claude/ folder, and the machine-wide file is untouched", () => {
    const listed = newRepo();
    const machine = settingsHome();
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      const machineBefore = `${JSON.stringify({ theme: "dark" }, null, 2)}\n`;
      writeFileSync(join(machine, "settings.json"), machineBefore);
      expect(existsSync(join(listed, ".claude")), "no .claude/ folder before init").toBe(false);

      const init = flow(listed, ["init"], machine);
      expect(init.code, init.stdout + init.stderr).toBe(0);
      expect(init.stdout).toContain(`+ .claude/settings.json — ${LISTED}`);

      const written = JSON.parse(readFileSync(join(listed, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
      expect(Object.keys(written["hooks"] as object)).toEqual(REGISTERED);
      expect(readFileSync(join(machine, "settings.json"), "utf8"), "the machine-wide file, byte for byte").toBe(machineBefore);
    } finally {
      for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gets the hooks in its own .claude/settings.json, keeping its keys, and the machine-wide file is untouched", () => {
    const listed = newRepo();
    const machine = settingsHome();
    try {
      const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
      writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      mkdirSync(join(listed, ".claude"), { recursive: true });
      writeFileSync(join(listed, ".claude", "settings.json"), `${JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }, null, 2)}\n`);
      const machineBefore = `${JSON.stringify({ theme: "dark" }, null, 2)}\n`;
      writeFileSync(join(machine, "settings.json"), machineBefore);

      const init = flow(listed, ["init"], machine);
      expect(init.code, init.stdout + init.stderr).toBe(0);
      expect(init.stdout).toContain(`+ .claude/settings.json — ${LISTED}`);

      const written = JSON.parse(readFileSync(join(listed, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
      expect(written["permissions"], "the key already in the repo's file is kept").toEqual({ allow: ["Bash(ls:*)"] });
      expect(Object.keys(written["hooks"] as object)).toEqual(REGISTERED);
      expect(readFileSync(join(machine, "settings.json"), "utf8"), "the machine-wide file, byte for byte").toBe(machineBefore);

      const said = flow(listed, ["status"], machine);
      expect(said.stdout).toContain(`✓ hooks: .claude/settings.json — ${LISTED}`);
      expect(said.code, said.stdout).toBe(0);
    } finally {
      for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
    }
  });
  // ONE RUN PER HOOK: the host merges only identical commands across its two settings files, so an
  // older flow's bare command left in the machine-wide file would run flow a second time.
  it("brings an older flow's commands in the machine-wide file up to the repo's, keeping the rest, and status names a command it left", () => {
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
      writeFileSync(join(machine, "settings.json"), `${JSON.stringify(older, null, 2)}\n`);

      const init = flow(listed, ["init"], machine);
      expect(init.code, init.stdout + init.stderr).toBe(0);
      expect(init.stdout).toContain(
        `+ ${join(machine, "settings.json")} — PreToolUse · Stop (an older flow's command, now the same as .claude/settings.json's, so each hook runs once)`,
      );

      type Hooks = Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
      const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { theme?: string; hooks: Hooks };
      const repo = read(join(listed, ".claude", "settings.json")).hooks;
      const after = read(join(machine, "settings.json"));
      expect(after.theme, "every other key is kept").toBe("dark");
      expect(Object.keys(after.hooks), "no registration is added there").toEqual(["PreToolUse", "Stop"]);
      expect(after.hooks["PreToolUse"]?.[0]?.hooks[0]?.command).toBe(repo["PreToolUse"]?.[0]?.hooks[0]?.command);
      expect(after.hooks["Stop"]?.[0]?.hooks[0]?.command).toBe(repo["Stop"]?.[0]?.hooks[0]?.command);
      expect(after.hooks["Stop"]?.[1], "another tool's hook is kept as it was").toEqual({ hooks: [{ type: "command", command: "say done" }] });

      const green = flow(listed, ["status"], machine);
      expect(green.stdout).toContain("✓ hooks: .claude/settings.json — ");
      expect(green.code, green.stdout).toBe(0);
      expect(flow(listed, ["init"], machine).stdout, "a second run has nothing to bring up to date").not.toContain(join(machine, "settings.json"));

      // A command with more in it is somebody's own: init leaves it, and status says it runs twice.
      after.hooks["Stop"] = [{ hooks: [{ type: "command", command: "FLOW_DEBUG=1 flow hook stop" }] }];
      writeFileSync(join(machine, "settings.json"), `${JSON.stringify(after, null, 2)}\n`);
      const red = flow(listed, ["status"], machine);
      expect(red.stdout).toContain(
        `✗ hooks: ${join(machine, "settings.json")} also calls flow for Stop with a command of its own, so Claude Code runs it beside .claude/settings.json's command and each of those hooks fires twice. Make it the same command as .claude/settings.json's, or remove it from that file.`,
      );
      expect(red.code).toBe(1);
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
  /** git and nothing else on the PATH: a commit that still called flow would fail with `flow: not found`. */
  const noFlow = (where: string): Ran => {
    const gitOnly = runGit(where, ["--exec-path"]).stdout.trim();
    expect(existsSync(join(gitOnly, "flow")), "the PATH this commit is given has no flow").toBe(false);
    writeFileSync(join(where, "after.txt"), "committed with flow gone\n");
    runGit(where, ["add", "after.txt"], { home, path: gitOnly });
    return runGit(where, ["commit", "-m", "test: flow is gone"], { home, path: gitOnly });
  };

  it("removes the gate, core.hooksPath, .githooks/, .flow/ and the link from a fresh repo, keeps the config, and a commit then needs no flow", () => {
    const fresh = newRepo();
    try {
      expect(flow(fresh, ["init"]).code).toBe(0);
      const said = flow(fresh, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout.trim().split("\n")).toEqual([
        "flow uninstall — removed:",
        "  - .githooks/pre-commit",
        "  - core.hooksPath (it was .githooks)",
        "  - .githooks/",
        "  - .flow/ — flow's state and logs",
        "  - node_modules/@jawache/flow — the link `flow init` made",
        "  · kept flow.config.ts and the packs it imports — `flow init` wires this repo again.",
        `  · ${join(home, "settings.json")} still holds flow's hooks, and every repo on this machine runs them — \`flow uninstall --machine\` removes them.`,
        "  next: `flow uninstall --machine` once no repo on this machine needs flow, then `npm uninstall -g @jawache/flow` — removes the hooks, then the package.",
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
      expect(said.stdout).toContain("  - .claude/settings.json — SessionStart · PreToolUse · PostToolUse · PostToolUseFailure · Stop · SubagentStop");
      expect(said.stdout.trim().split("\n").at(-1)).toBe("  next: `npm uninstall @jawache/flow` — removes the package.");
      const after = JSON.parse(readFileSync(join(listed, ".claude", "settings.json"), "utf8")) as Record<string, unknown>;
      expect(after, "flow's six are gone, the empty events with them, and every other key and hook stays").toEqual({
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
      writeFileSync(join(theirs, ".githooks", "pre-commit"), own, { mode: 0o755 });
      expect(flow(theirs, ["init"]).code).toBe(0);
      // What init's report tells them to do: add the two lines to the end of it.
      writeFileSync(
        join(theirs, ".githooks", "pre-commit"),
        `${own}f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit\nexec flow hook commit\n`,
      );

      const said = flow(theirs, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain("  - flow's lines from .githooks/pre-commit — the rest of the hook is kept");
      expect(said.stdout).toContain("  · kept core.hooksPath at .githooks — git still runs the hooks there: pre-commit.");
      expect(readFileSync(join(theirs, ".githooks", "pre-commit"), "utf8"), "their hook, as they wrote it").toBe(own);
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
      writeFileSync(join(shared, ".githooks", "commit-msg"), "#!/bin/sh\necho msg-hook-ran\n", { mode: 0o755 });
      expect(flow(shared, ["init"]).code).toBe(0);

      const said = flow(shared, ["uninstall"]);
      expect(said.code, said.stdout + said.stderr).toBe(0);
      expect(said.stdout).toContain("  - .githooks/pre-commit");
      expect(said.stdout).toContain("  · kept core.hooksPath at .githooks — git still runs the hooks there: commit-msg.");
      expect(existsSync(join(shared, ".githooks", "pre-commit"))).toBe(false);
      expect(existsSync(join(shared, ".githooks", "commit-msg"))).toBe(true);
      expect(git(shared, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");

      const committed = noFlow(shared);
      expect(committed.code, committed.stdout + committed.stderr).toBe(0);
      expect(committed.stdout + committed.stderr, "git still runs the other hook").toContain("msg-hook-ran");
    } finally {
      rmSync(shared, { recursive: true, force: true });
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
      expect(said.stdout).toMatch(/^ {2}✗ could not delete \.githooks\/pre-commit: /m);
      expect(existsSync(join(hooksDir, "pre-commit")), "the gate the disk would not let go").toBe(true);
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
      for (const kept of [".githooks/pre-commit", ".flow"]) expect(existsSync(join(wired, kept)), `${kept} is still there`).toBe(true);
    } finally {
      rmSync(wired, { recursive: true, force: true });
    }
  });

  // THE MACHINE-WIDE FILE: every repo on the machine reads it, so only `--machine` writes it. Each
  // case points CLAUDE_CONFIG_DIR at its own throwaway folder, holding a hook of the user's own
  // beside the six flow init registers there.
  describe("--machine", () => {
    const theirs = { hooks: [{ type: "command", command: "say done" }] };
    const own = { permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [theirs] } };
    /** A throwaway machine-wide folder whose settings file holds the user's own hook, and then flow's. */
    const machineWithFlow = (): { machine: string; file: string } => {
      const machine = settingsHome();
      const file = join(machine, "settings.json");
      writeFileSync(file, `${JSON.stringify(own, null, 2)}\n`);
      const global = newRepo();
      try {
        expect(flow(global, ["init"], machine).code).toBe(0);
      } finally {
        rmSync(global, { recursive: true, force: true });
      }
      expect(Object.keys((JSON.parse(readFileSync(file, "utf8")) as { hooks: object }).hooks).sort(), "flow's six are in it").toEqual([...REGISTERED].sort());
      return { machine, file };
    };

    it("a global install: a plain run leaves the machine-wide file byte for byte and names --machine; --machine then takes flow's six out and keeps the user's hook", () => {
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
          "  next: `flow uninstall --machine` once no repo on this machine needs flow, then `npm uninstall -g @jawache/flow` — removes the hooks, then the package.",
        );

        const said = flow(global, ["uninstall", "--machine"], machine);
        expect(said.code, said.stdout + said.stderr).toBe(0);
        expect(said.stdout).toContain(`  - ${file} — ${LISTED}`);
        expect(said.stdout.trim().split("\n").at(-1)).toBe("  next: `npm uninstall -g @jawache/flow` — removes the package.");
        expect(JSON.parse(readFileSync(file, "utf8")), "flow's six are gone, and the user's hook and keys stay").toEqual(own);
        expect(flow(global, ["uninstall", "--machine"], machine).stdout, "a second run").toContain("nothing of flow's here to remove");
      } finally {
        for (const dir of [global, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });

    it("a dev dependency: a plain run leaves the machine-wide file byte for byte and says nothing of it; --machine cleans it beside the repo's own", () => {
      const listed = newRepo();
      const { machine, file } = machineWithFlow();
      try {
        const pkg = { name: "consumer", version: "1.0.0", devDependencies: { "@jawache/flow": "*" } };
        writeFileSync(join(listed, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
        expect(flow(listed, ["init"], machine).code).toBe(0);
        const before = readFileSync(file, "utf8");

        const plain = flow(listed, ["uninstall"], machine);
        expect(plain.code, plain.stdout + plain.stderr).toBe(0);
        expect(readFileSync(file, "utf8"), "without --machine, the machine-wide file is unchanged").toBe(before);
        expect(plain.stdout).not.toContain(file);

        expect(flow(listed, ["init"], machine).code).toBe(0);
        const said = flow(listed, ["uninstall", "--machine"], machine);
        expect(said.code, said.stdout + said.stderr).toBe(0);
        expect(said.stdout).toContain(`  - .claude/settings.json — ${LISTED}`);
        expect(said.stdout).toContain(`  - ${file} — ${LISTED}`);
        expect(JSON.parse(readFileSync(file, "utf8")), "flow's six are gone, and the user's hook and keys stay").toEqual(own);
      } finally {
        for (const dir of [listed, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });

    it("writes nothing to a machine-wide file that would not parse, says so, and answers 1", () => {
      const global = newRepo();
      const machine = settingsHome();
      const file = join(machine, "settings.json");
      try {
        expect(flow(global, ["init"], machine).code).toBe(0);
        const unparseable = `${readFileSync(file, "utf8")}// a comment\n`;
        writeFileSync(file, unparseable);

        const said = flow(global, ["uninstall", "--machine"], machine);
        expect(said.code).toBe(1);
        expect(said.stdout).toContain(`  ✗ ${file} is not valid JSON`);
        expect(said.stdout).toContain("run `flow uninstall --machine` again.");
        expect(said.stdout, "the repo's own steps still ran").toContain("  - .githooks/pre-commit");
        expect(readFileSync(file, "utf8"), "the file nobody could parse is not written").toBe(unparseable);
      } finally {
        for (const dir of [global, machine]) rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("lists a step it could not do, still does the others, and answers 1", () => {
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
      expect(said.stdout, "the other steps still ran").toContain("  - .githooks/pre-commit");
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
      expect(existsSync(join(bare, ".githooks", "pre-commit")), "the wiring is the same").toBe(true);
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
// THE PRINCIPLE, ruled with the human on 2026-09-09: a GENERATED page is captured from the code
// (that is `just docs-packs` and its drift gate); a HAND-WRITTEN page is pinned by a test that
// fails when it and the binary disagree. The README's transcripts had that already, and were the
// only pages that had not drifted — the Getting started tutorial claimed a scaffold that stopped
// existing at the split, and the exit-code table published a 1/2 split the binary never made.
//
// The three substitutions above are this file's, and docs/user/tutorials/getting-started.md quotes
// the same spellings.

/** The fenced block on a docs page that opens with this line, as text. */
const paged = (page: string, opening: string): string => fenced(join(PACKAGE, "docs", "user", page), opening);

describe("the Getting started tutorial's transcripts", () => {
  it("are what `flow init`, `flow status`, `flow test` and both refusals really print", () => {
    const mine = newRepo();
    const firstTime = mkdtempSync(join(tmpdir(), "flow-quickstart-"));
    const page = (opening: string): string => paged(join("tutorials", "getting-started.md"), opening);
    const said = (args: readonly string[], stdin = ""): string => {
      const ran = runFlow(mine, args, { home: firstTime, bin }, stdin);
      return asQuoted(ran.stdout || ran.stderr, mine, firstTime);
    };
    try {
      expect(said(["init"]), "§2").toBe(page("flow init — created:"));
      expect(said(["status"]), "§3").toBe(page("flow is ON —"));

      // §4 — the gate's refusal, driven the way the page drives it.
      writeFileSync(join(mine, "bad.txt"), "DO-NOT-COMMIT here\n");
      runGit(mine, ["add", "bad.txt"]);
      expect(said(["hook", "commit"]), "§4").toBe(page("flow — commit blocked:"));

      // §5 — a banned command, on the rail the host sends it on.
      const forced = JSON.stringify(pre("Bash", { command: "git push --force origin main" }));
      expect(said(["hook", "pre-tool-use"], forced), "§5").toBe(page("flow — command blocked before it ran:"));

      // §6 — the census the page quotes as a comment beside the command.
      expect(page("flow test").split("\n").at(-1), "§6").toBe(`# ${said(["test"])}`);
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
      const good = readFileSync(config, "utf8");
      writeFileSync(config, good.replace('pass: ["git push origin main"]', 'pass: ["git push --force origin main"]'));
      expect(code(["test"]), "a case that should pass, failing").toBe(1);
      writeFileSync(config, good);

      // ── 2 · something refused: a rule blocked …
      writeFileSync(join(repo, "bad.txt"), "DO-NOT-COMMIT here\n");
      runGit(repo, ["add", "bad.txt"]);
      expect(code(["hook", "commit"]), "a rule blocked at the gate").toBe(2);
      const forced = JSON.stringify(pre("Bash", { command: "git push --force origin main" }));
      expect(code(["hook", "pre-tool-use"], forced), "a rule blocked at a hook").toBe(2);
      runGit(repo, ["reset", "bad.txt"]);

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
