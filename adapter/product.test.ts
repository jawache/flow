// flow/adapter/product.test.ts — `flow init` and `flow status`, end to end, through the BUILT
// BINARY, over a throwaway repo.
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
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const BINARY = join(PACKAGE, "dist", "flow.mjs");

let home: string;
/** A directory holding one `flow` shim, so git's own hook can find the binary under test. */
let bin: string;

interface Ran {
  stdout: string;
  stderr: string;
  code: number;
}

/** The built binary, in a given repo, with the throwaway host settings and the shim on PATH. */
function flow(repo: string, args: readonly string[], settingsHome: string = home): Ran {
  const result = spawnSync("node", [BINARY, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: settingsHome, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

function git(repo: string, args: readonly string[]): Ran {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

/** A fresh git repo with nothing in it — the stranger's repo of UAT step 1. */
function newRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "flow-init-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  return repo;
}

const settings = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as Record<string, unknown>;

let repo: string;
let first: Ran;

beforeAll(() => {
  // The BUILT bundles, deliberately: the library bundle is what a scaffolded config resolves to, and
  // a package that only works from source is the failure this whole build step exists to catch.
  const built = spawnSync("node", [join(PACKAGE, "esbuild.mjs")], { encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);

  home = mkdtempSync(join(tmpdir(), "flow-home-"));
  bin = mkdtempSync(join(tmpdir(), "flow-bin-"));
  writeFileSync(join(bin, "flow"), `#!/bin/sh\nexec node ${JSON.stringify(BINARY)} "$@"\n`, { mode: 0o755 });

  repo = newRepo();
  first = flow(repo, ["init"]);
});

afterAll(() => {
  for (const dir of [repo, home, bin]) rmSync(dir, { recursive: true, force: true });
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
    expect(readFileSync(join(repo, ".githooks", "pre-commit"), "utf8")).toContain("flow commit");
    expect(lstatSync(join(repo, "node_modules", "@jawache", "flow")).isSymbolicLink()).toBe(true);
    expect(git(repo, ["config", "--get", "core.hooksPath"]).stdout.trim()).toBe(".githooks");
  });

  it("registers the four events flow answers, and not Notification", () => {
    const hooks = settings()["hooks"] as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionStart", "Stop"]);
    expect(JSON.stringify(hooks)).toContain("flow hook stop");
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
    const answer = spawnSync(
      "node",
      [BINARY, "hook", "pre-tool-use"],
      {
        cwd: repo,
        encoding: "utf8",
        input: JSON.stringify({
          session_id: "demo-1",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "git push --force origin main" },
        }),
        env: { ...process.env, CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: repo },
      },
    );
    expect(answer.status).toBe(2);
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
    expect(said.stdout).toContain("demo.orientation");
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

  it("refuses, loudly, over a config that will not even import — UAT step 5", () => {
    const broken = newRepo();
    try {
      flow(broken, ["init"]);
      writeFileSync(join(broken, "flow.config.ts"), 'import { nope } from "./missing.ts";\nexport default nope;\n');
      const said = flow(broken, ["status"]);
      expect(said.code, "exit 2 — your rules are broken, not merely not in force").toBe(2);
      expect(said.stderr).toContain("flow.config.ts could not be loaded");
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

  it("never overwrites a pre-commit hook somebody else put there", () => {
    const theirs = newRepo();
    try {
      mkdirSync(join(theirs, ".githooks"), { recursive: true });
      writeFileSync(join(theirs, ".githooks", "pre-commit"), "#!/bin/sh\nnpm test\n", { mode: 0o755 });
      const said = flow(theirs, ["init"]);
      expect(readFileSync(join(theirs, ".githooks", "pre-commit"), "utf8")).toBe("#!/bin/sh\nnpm test\n");
      expect(said.stdout).toContain("kept");
      expect(said.stdout).toContain("flow commit");
    } finally {
      rmSync(theirs, { recursive: true, force: true });
    }
  });
});

// ── the README's two transcripts ─────────────────────────────────────────────
//
// A quickstart is a promise about what you will see, and a hand-copied one starts drifting the first
// time a sentence is reworded — silently, because nothing reads it. These two blocks are pinned to
// the binary instead: the README is the expected value and the real run is the actual.
//
// THE THREE SUBSTITUTIONS are all paths and are named here: the repo, the host's config directory
// and this checkout are different on every machine, so the README quotes a settled spelling of each
// and this puts it back before comparing. Nothing else is touched — every word is the binary's.

const DEMO_REPO = "/tmp/flow-demo";
const CHECKOUT = "…/work/flow";

/** The fenced block in the README that opens with this line. */
function quoted(opening: string): string {
  const text = readFileSync(join(PACKAGE, "README.md"), "utf8");
  const block = text.split("```").find((part) => part.trimStart().startsWith(opening));
  expect(block, `the README has no fenced block starting "${opening}"`).toBeDefined();
  return (block as string).trim();
}

/** One machine's output, in the spelling the README quotes. */
function asQuoted(output: string, repo: string, settingsHome: string): string {
  return output
    .replaceAll(realpathSync(repo), DEMO_REPO)
    .replaceAll(repo, DEMO_REPO)
    .replaceAll(PACKAGE.replace(/\/$/, ""), CHECKOUT)
    .replaceAll(settingsHome, "~/.claude")
    .trim();
}

describe("the README's quickstart", () => {
  it("quotes what `flow init` and `flow status` really print, word for word", () => {
    // A HOST THAT HAS NEVER HEARD OF FLOW, as well as a repo: the registrations are written once per
    // machine, so re-using this file's shared home would drop the settings line the README shows and
    // make the quickstart's first run unreproducible for the reader having it.
    const shown = newRepo();
    const firstTime = mkdtempSync(join(tmpdir(), "flow-readme-"));
    try {
      expect(asQuoted(flow(shown, ["init"], firstTime).stdout, shown, firstTime)).toBe(quoted("flow init — created:"));
      expect(asQuoted(flow(shown, ["status"], firstTime).stdout, shown, firstTime)).toBe(quoted("flow is ON —"));
    } finally {
      for (const dir of [shown, firstTime]) rmSync(dir, { recursive: true, force: true });
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
