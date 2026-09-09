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
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, lstatSync, symlinkSync } from "node:fs";
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
  shimBin,
  flow as runFlow,
  git as runGit,
  type Ran,
} from "./harness.ts";

let home: string;
/** A directory holding one `flow` shim, so git's own hook can find the binary under test. */
let bin: string;

/** The built binary, in a given repo, with the throwaway host settings and the shim on PATH. */
const flow = (repo: string, args: readonly string[], settingsFolder: string = home): Ran =>
  runFlow(repo, args, { home: settingsFolder, bin });

const git = (repo: string, args: readonly string[]): Ran => runGit(repo, args, { home, bin });

const newRepo = (): string => freshRepo("flow-init-");

const settings = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as Record<string, unknown>;

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
//
// "This checkout" is TWO paths, and the second is the suite's own doing: the package under test is
// built into a throwaway root so a test run never rewrites the live guard, so the link `flow init`
// reports points there rather than at the checkout. A reader following the README has one of them
// and it is spelled the same way.

const DEMO_REPO = "/tmp/flow-demo";
const CHECKOUT = "…/flow";

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
    .replaceAll(realpathSync(builtPackage()), CHECKOUT)
    .replaceAll(builtPackage(), CHECKOUT)
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

// ── the hand-written pages, pinned to the binary ─────────────────────────────
//
// THE PRINCIPLE, ruled with the human on 2026-09-09: a GENERATED page is captured from the code
// (that is `just docs-packs` and its drift gate); a HAND-WRITTEN page is pinned by a test that
// fails when it and the binary disagree. The README's two transcripts had that already, and were
// the only pages that had not drifted — the quick start claimed a scaffold that stopped existing
// at the split, and the exit-code table published a 1/2 split the binary never made.
//
// The three substitutions above are this file's, and the quick start quotes the same spellings.

/** The `<pre><code>` block on a docs page that opens with this line, as text. */
function paged(page: string, opening: string): string {
  const html = readFileSync(join(PACKAGE, "docs", "user", page), "utf8");
  const found = html
    .split("<pre><code>")
    .slice(1)
    .map((part) => part.slice(0, part.indexOf("</code></pre>")))
    .map((body) => body.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&"))
    .find((body) => body.trimStart().startsWith(opening));
  expect(found, `${page} has no block starting "${opening}"`).toBeDefined();
  return (found as string).trim();
}

describe("the quick start's transcripts", () => {
  // The page stands in for two paths — the reader's repo and this checkout — and for the host's
  // config directory, exactly as the README does.
  const asPaged = (output: string, repo: string, settingsHome: string): string =>
    output
      .replaceAll(realpathSync(repo), "…/my-repo")
      .replaceAll(repo, "…/my-repo")
      .replaceAll(realpathSync(builtPackage()), CHECKOUT)
      .replaceAll(builtPackage(), CHECKOUT)
      .replaceAll(PACKAGE.replace(/\/$/, ""), CHECKOUT)
      .replaceAll(settingsHome, "~/.claude")
      .trim();

  it("are what `flow init`, `flow status`, `flow test` and both refusals really print", () => {
    const mine = newRepo();
    const firstTime = mkdtempSync(join(tmpdir(), "flow-quickstart-"));
    const page = (opening: string): string => paged("01-quick-start.html", opening);
    const said = (args: readonly string[], stdin = ""): string => {
      const ran = runFlow(mine, args, { home: firstTime, bin }, stdin);
      return asPaged(ran.stdout || ran.stderr, mine, firstTime);
    };
    try {
      expect(said(["init"]), "§2").toBe(page("flow init — created:"));
      expect(said(["status"]), "§3").toBe(page("flow is ON —"));

      // §4 — the gate's refusal, driven the way the page drives it.
      writeFileSync(join(mine, "bad.txt"), "DO-NOT-COMMIT here\n");
      runGit(mine, ["add", "bad.txt"]);
      expect(said(["commit", "bad.txt"]), "§4").toBe(page("flow — commit blocked:"));

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

describe("the README's exit-code table", () => {
  /** The table's rows, as `{ "0": "yes — …" }` — the codes it publishes and what it says they mean. */
  function published(): Record<string, string> {
    const text = readFileSync(join(PACKAGE, "README.md"), "utf8");
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
      expect(code(["commit", "bad.txt"]), "a rule blocked at the gate").toBe(2);
      const forced = JSON.stringify(pre("Bash", { command: "git push --force origin main" }));
      expect(code(["hook", "pre-tool-use"], forced), "a rule blocked at a hook").toBe(2);
      runGit(repo, ["reset", "bad.txt"]);

      // … or the config would not load, BOTH ways it can fail to. This is the row that was wrong:
      // status answered 1 for a grammar refusal and 2 for an import fault, one fact under two codes.
      for (const [how, broken] of [
        ["will not import", 'import { nope } from "./missing.ts";\nexport default nope;\n'],
        ["the grammar refuses it", good.replace(/\n\s*\.message\([^\n]*\n/, "\n")],
      ] as const) {
        writeFileSync(config, broken);
        for (const verb of [["status"], ["test"], ["commit", "flow.config.ts"]])
          expect(code(verb), `${verb[0] as string}, ${how}`).toBe(2);
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
