// flow/packs/machine.test.ts — THE MACHINE TEST. Every pack the package ships, bound at once in a
// repo that has never heard of flow, and driven until each rail actually refuses.
//
// It answers ONE question — "did we break anything?" — and it answers it with an exit code, which
// is why it is one command (`just test-packs`) and not a reading exercise. `flow test` proves the
// rules in YOUR config; this proves the ten the package ships, in a repo that is not this one.
//
// THE STRANGER'S REPO IS THE POINT. Every parameter below is somebody else's: the tooling is one
// shell script rather than a justfile, the pure home is `core/`, the repo's own pack lives in
// `rules/`. A copy of this repo's flow.config.ts would prove only that our own spelling still
// works, and the defect these packs were extracted out of (F2) was exactly one repo's spelling
// baked into a pack — so the fixture is written by someone flow has never met.
//
// FIVE MOMENTS, DRIVEN LIVE, one refusal each: write · delete · command · commit · turn-end. Four
// come from a shipped pack; turn-end comes from the stranger's own, because NO pack in the package
// carries a turn-end rule and inventing one to make a table symmetrical would be a rule nobody
// asked for. The rail is real either way, and this is what proves it.
//
// THE CENSUS is what makes a deleted case visible. `flow status --json` gives the exact entry list
// and one `flow test` per pack gives its case count, both pinned below: remove a block case from
// any pack and this exits non-zero naming that pack. It is the same discipline index.test.ts
// applies to the export list — a change here is deliberate or it is a bug.
//
// NOTHING OUTSIDE THE TEMP DIRECTORIES IS TOUCHED. `CLAUDE_CONFIG_DIR` is the host's own override
// for where settings live, and pointing it at a temp folder is what lets init's registration half
// run for real — the seam is the product's, not the suite's. Same road as product.test.ts, one
// scale up.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const BINARY = join(PACKAGE, "dist", "flow.mjs");

// ── the stranger, and what it calls things ───────────────────────────────────
//
// One shell script for the whole toolchain, `core/` for the pure home, `rules/` for the pack it
// writes itself. Not one of those names is this repo's, and that is the fixture's whole job.

/** Every pack the package ships, as a stranger's config binds it — with its census pinned. */
interface Shipped {
  /** The pack's exported name, which is also the prefix of every entry id it contributes. */
  readonly pack: string;
  /** The binding line, parameters and all, exactly as it appears in the config. */
  readonly bind: string;
  /** What `flow test` runs over this pack alone. Pinned: a deleted case shows up here, by name. */
  readonly cases: number;
  /** The guardrails those cases cover — the disabled ones are loaded but not run. */
  readonly guardrails: number;
  /**
   * Cases that FAIL in a stranger's repo, named one by one.
   *
   * Not a tolerance and not a skip: the set is compared exactly, so a third failure is a red run
   * and a fix that makes one of these pass is ALSO a red run, asking for this line to be deleted.
   * Every entry here is a defect this command found and nothing else did — see the note on `fcis`.
   */
  readonly red?: readonly string[];
}

const SHIPPED: readonly Shipped[] = [
  { pack: "docs", bind: "pack(docs)", cases: 3, guardrails: 2 },
  {
    pack: "fcis",
    bind: `pack(fcis, { files: ["core/**/*.ts"], homes: ["core/**"], coverage: "./ci.sh coverage" })`,
    cases: 15,
    guardrails: 7,
    // FOUND BY THIS COMMAND, on its first run, and left visible rather than papered over.
    //
    // Both entries scope themselves on the caller's globs (`whenAdded: repo.files`, `changed:
    // repo.homes`) and then prove themselves with a case whose path is written out as
    // `cli/pure/a.ts` — one repo's spelling of a pure home, inside the pack. In a repo that spells
    // it any other way the block case's file is out of scope, the check correctly passes it, and
    // the case fails: `flow test` is RED in a stranger's repo, for both entries, on day one.
    //
    // It is the same defect F2 extracted six of, one layer further in — the scan read `.on(…)`
    // scopes and stopped short of the `.test()` fixtures, and F2's own notes called these paths
    // cosmetic. They are not: they decide whether the pack's proof runs at all.
    //
    // The FIX is a pack change (the cases need a path derived from the parameter, the way the
    // scopes already are) and pack content is not this phase's to edit, so it is raised rather
    // than made. Delete these two lines the moment it lands.
    red: ["fcis.pureCovered · block case 1", "fcis.newPureFileNeedsReason · block case 1"],
  },
  { pack: "git", bind: `pack(git, { release: "./ci.sh release" })`, cases: 30, guardrails: 7 },
  { pack: "guard", bind: `pack(guard, { packs: ["rules/**"] })`, cases: 2, guardrails: 1 },
  { pack: "justfile", bind: `pack(justfile, { exempt: [] })`, cases: 6, guardrails: 2 },
  { pack: "node", bind: "pack(node)", cases: 7, guardrails: 2 },
  {
    pack: "secrets",
    bind: `pack(secrets, { dx: "./ci.sh dx", encrypt: "./ci.sh seal", names: "./ci.sh names" })`,
    cases: 5,
    guardrails: 3,
  },
  { pack: "tdd", bind: `pack(tdd, { run: "./ci.sh test" })`, cases: 12, guardrails: 6 },
  { pack: "typescript", bind: `pack(typescript, { typecheck: "./ci.sh types", lint: "./ci.sh lint" })`, cases: 9, guardrails: 4 },
  { pack: "work", bind: "pack(work)", cases: 16, guardrails: 5 },
];

/** The stranger's own pack — the eleventh binding, and the only turn-end rule in the config. */
const HOUSE: Shipped = { pack: "house", bind: "pack(house)", cases: 2, guardrails: 1 };

/**
 * The stranger's own pack, in the folder the stranger chose.
 *
 * ONE RULE, and it is at turn-end deliberately: not one of the ten shipped packs carries a
 * turn-end guardrail, so the rail would otherwise go undriven here — and "no pack ships one" is a
 * fact about the packs, not about the moment. This is also what `guard`'s `packs: ["rules/**"]`
 * parameter is pointed at, so the delete refusal below is protecting a file that really exists.
 */
const HOUSE_PACK = `// rules/house.ts — this repo's own pack. Everything else comes from @jawache/flow/packs.
import { definePack, guardrail, turnEnd } from "@jawache/flow";

export const house = definePack("house", {
  ranSomething: guardrail()
    .at(turnEnd)
    .description("A turn that edited all the way through and ran nothing hands back untested work.")
    .check((ctx) => {
      const did = ctx.turn ?? [];
      return did.length > 3 && did.every((action) => action.did === "edit")
        ? ctx.fail(\`\${did.length} edits, nothing run\`)
        : ctx.ok();
    })
    .message("You edited all turn and ran nothing. Run ./ci.sh test before you hand back.")
    .test({
      pass: [{ actions: [] }],
      block: [
        {
          actions: [
            { did: "edit", path: "core/a.ts" },
            { did: "edit", path: "core/b.ts" },
            { did: "edit", path: "core/c.ts" },
            { did: "edit", path: "core/d.ts" },
          ],
        },
      ],
    }),
});
`;

/** The whole guard of a repo that binds everything flow ships, plus the one pack it writes itself. */
const CONFIG = `// flow.config.ts — this repo's whole guard.
import { defineConfig, pack } from "@jawache/flow";
import { docs, fcis, git, guard, justfile, node, secrets, tdd, typescript, work } from "@jawache/flow/packs";
import { house } from "./rules/house.ts";

export default defineConfig([
${SHIPPED.map((s) => `  ${s.bind},`).join("\n")}
  ${HOUSE.bind},
]);
`;

/** One pack alone, so `flow test` can be asked about it by itself. */
const only = (entry: Shipped): string =>
  entry.pack === HOUSE.pack
    ? `import { defineConfig, pack } from "@jawache/flow";\nimport { house } from "../rules/house.ts";\nexport default defineConfig([${entry.bind}]);\n`
    : `import { defineConfig, pack } from "@jawache/flow";\nimport { ${entry.pack} } from "@jawache/flow/packs";\nexport default defineConfig([${entry.bind}]);\n`;

/** The stranger's entire toolchain: one script, one job per argument. */
const CI_SH = `#!/bin/sh
# Every gate this repo runs, behind one verb. The config hands the spelling to the packs.
case "$1" in
  test|types|lint|coverage) exit 0 ;;
  *) echo "no such job: $1" >&2; exit 1 ;;
esac
`;

/**
 * EVERY ENTRY THE CONFIG BINDS, exactly — the other half of the census.
 *
 * Pinned as a list rather than counted, because a count says "one fewer" and a list says which.
 * An entry that quietly stops being bound — a pack that drops one, a rename that misses a
 * re-export — is caught here by name.
 */
const ENTRIES: readonly string[] = [
  "docs.docs",
  "docs.docsShape",
  "docs.noMarkdownInUserDocs",
  "docs.userDocsStyle",
  "fcis.fcis",
  "fcis.newPureFileNeedsReason",
  "fcis.noLogicInTypesOrIndex",
  "fcis.noShellInPure",
  "fcis.noSideEffectsInPure",
  "fcis.noThrowInPure",
  "fcis.pureCovered",
  "fcis.pureExportsTested",
  "fcis.pureHasTest",
  "fcis.strictLayout",
  "git.conventionalCommitFormat",
  "git.noAiAttributionInCommits",
  "git.noForcePush",
  "git.noGitDiscard",
  "git.noShellSubstitutionInProse",
  "git.node.noHandEditedVersion",
  "git.node.versionIsSemver",
  "git.orientation",
  "guard.editingTheGuardrails",
  "guard.noDeleteGuardrails",
  "guard.orientation",
  "house.ranSomething",
  "justfile.justfileDocs",
  "justfile.node.noPackageScripts",
  "justfile.orientation",
  "justfile.toolsHome",
  "node.dependencies",
  "node.lockfileInStep",
  "node.newDependencyNeedsReason",
  "secrets.dxSeam",
  "secrets.envEncrypted",
  "secrets.noKeysFileInCommits",
  "secrets.noSecretsInCommits",
  "secrets.orientation",
  "tdd.commitRunsTests",
  "tdd.testingStrategy",
  "tdd.vitest",
  "tdd.vitestIdioms.noEmptyTest",
  "tdd.vitestIdioms.noMockInternal",
  "tdd.vitestIdioms.noNetworkStubs",
  "tdd.vitestIdioms.noOnlyInTests",
  "typescript.commitRunsEslint",
  "typescript.commitRunsTsc",
  "typescript.eslintFromBase",
  "typescript.strictTypesNoInvalidStates",
  "typescript.tsconfigFromBase",
  "work.checkersDoNotWrite",
  "work.noAgentInboxItems",
  "work.noShellSubstitutionInProse",
  "work.planIsTheParents",
  "work.ticksAreTheChilds",
];

// ── the road ─────────────────────────────────────────────────────────────────

interface Ran {
  stdout: string;
  stderr: string;
  code: number;
}

let home: string;
/** A directory holding one `flow` shim, so git's own hook can find the binary under test. */
let bin: string;
let repo: string;
let scaffolded: Ran;

/** The report this command prints. Every line is something that was driven, not something claimed. */
const report: string[] = [];

/** The built binary, in the stranger's repo, with the throwaway host settings and the shim on PATH. */
function flow(args: readonly string[], stdin = ""): Ran {
  const result = spawnSync("node", [BINARY, ...args], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_PROJECT_DIR: repo,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    },
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

function git(args: readonly string[]): Ran {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

/** A harness payload, on the rail the harness would send it on. */
const hook = (event: string, payload: Record<string, unknown>): Ran => flow(["hook", event], JSON.stringify(payload));

const pre = (tool: string, input: Record<string, unknown>): Record<string, unknown> => ({
  session_id: "machine-1",
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: input,
});

/** A `flow test` run, read back: its headline as numbers, and every case that failed, by name. */
function ran(said: Ran): { cases: number; guardrails: number; red: string[] } {
  // Two headlines, because a green run and a red one say it differently — "15 cases over 7
  // guardrails, all green" and "2 of 15 cases failed, over 7 guardrails".
  const m = /flow test — (?:\d+ of )?(\d+) cases (?:over|failed, over) (\d+) guardrails/.exec(said.stdout);
  expect(m, `flow test said something else entirely:\n${said.stdout}${said.stderr}`).not.toBeNull();
  const red = said.stdout
    .split("\n")
    .flatMap((line) => /^\s+✗ (\S+ · \w+ case \d+)\s*$/.exec(line)?.[1] ?? []);
  return { cases: Number(m?.[1]), guardrails: Number(m?.[2]), red };
}

/** What one live refusal proved, for the report. */
function refusal(moment: string, said: Ran, entry: string): void {
  expect(said.code, `${moment} was not refused:\n${said.stdout}${said.stderr}`).toBe(2);
  expect(said.stderr, `${moment} refused, but not by ${entry}`).toContain(entry);
  report.push(`    ${moment.padEnd(9)} ✗ ${entry}`);
}

beforeAll(() => {
  // The BUILT bundles, deliberately: `@jawache/flow` and `@jawache/flow/packs` resolve to
  // dist/index.mjs and dist/packs.mjs through the link `flow init` makes, so this is the only
  // place the packs subpath export is exercised as an INSTALL rather than as a source import.
  const built = spawnSync("node", [join(PACKAGE, "esbuild.mjs")], { encoding: "utf8" });
  expect(built.status, built.stderr).toBe(0);

  home = mkdtempSync(join(tmpdir(), "flow-machine-home-"));
  bin = mkdtempSync(join(tmpdir(), "flow-machine-bin-"));
  writeFileSync(join(bin, "flow"), `#!/bin/sh\nexec node ${JSON.stringify(BINARY)} "$@"\n`, { mode: 0o755 });

  repo = mkdtempSync(join(tmpdir(), "flow-machine-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);

  // 1 — the scaffold. Everything after this point is the stranger writing their own guard over it.
  scaffolded = flow(["init"]);

  writeFileSync(join(repo, "ci.sh"), CI_SH, { mode: 0o755 });
  mkdirSync(join(repo, "rules"), { recursive: true });
  writeFileSync(join(repo, "rules", "house.ts"), HOUSE_PACK);
  writeFileSync(join(repo, "flow.config.ts"), CONFIG);
  mkdirSync(join(repo, "probe"), { recursive: true });
  for (const entry of [...SHIPPED, HOUSE]) writeFileSync(join(repo, "probe", `${entry.pack}.config.ts`), only(entry));
});

afterAll(() => {
  process.stdout.write(`\n${report.join("\n")}\n\n`);
  for (const dir of [repo, home, bin]) rmSync(dir, { recursive: true, force: true });
});

describe("the machine test", () => {
  it("scaffolds and arms a repo that has never heard of flow", () => {
    expect(scaffolded.code, scaffolded.stdout + scaffolded.stderr).toBe(0);
    for (const created of ["flow.config.ts", ".githooks/pre-commit", "node_modules/@jawache/flow", "core.hooksPath"])
      expect(scaffolded.stdout).toContain(created);
    report.push("flow packs — the machine test, in a repo that has never heard of flow", "", "  scaffold   flow init armed the gate, the link and the four registrations");
  });

  it("binds every pack the package ships, and exactly these entries", () => {
    const said = flow(["status", "--json"]);
    const read = JSON.parse(said.stdout) as {
      green: boolean;
      moments: { moments: { entries: { id: string; pack: string }[] }[]; totals: Record<string, number> };
    };
    const entries = read.moments.moments.flatMap((m) => m.entries);
    const ids = [...new Set(entries.map((e) => e.id))].sort();

    // The exact list, not a count: "one fewer" is a puzzle, "guard.noDeleteGuardrails is gone" is
    // an answer.
    expect(ids).toEqual([...ENTRIES]);
    expect([...new Set(entries.map((e) => e.pack))].sort()).toEqual([...SHIPPED.map((s) => s.pack), HOUSE.pack].sort());
    expect(read.green, `flow status is not green:\n${flow(["status"]).stdout}`).toBe(true);
    expect(said.code).toBe(0);

    const totals = read.moments.totals;
    report.push(
      `  bind       ${SHIPPED.length} shipped packs + the repo's own · ${ids.length} entries ` +
        `(${totals["guardrails"]} guardrails · ${totals["breadcrumbs"]} breadcrumbs · ${totals["disabled"]} disabled)`,
      `             ${[...SHIPPED.map((s) => s.pack), `${HOUSE.pack} (this repo's own)`].join(" · ")}`,
      "  status     green — every rule resolves and can fire, every fitting is in place",
    );
  });

  it("runs every pack's own cases, and each pack's count is exactly what it was", () => {
    // PER PACK, so a deleted case NAMES the pack it was deleted from. One config each, so the
    // number that moves is attributable — the whole-config run below can only say "one fewer".
    const measured = [...SHIPPED, HOUSE].map((entry) => {
      const said = flow(["test", join("probe", `${entry.pack}.config.ts`)]);
      const { cases, guardrails, red } = ran(said);
      return { pack: entry.pack, cases, guardrails, ...(red.length > 0 ? { red } : {}) };
    });
    expect(measured).toEqual([...SHIPPED, HOUSE].map(({ pack, cases, guardrails, red }) => ({ pack, cases, guardrails, ...(red ? { red } : {}) })));

    // …and the same run over the whole config: the cases add up (a case that moved between packs
    // shows here), and nothing fails that the pinned census did not already name.
    const whole = ran(flow(["test"]));
    const total = [...SHIPPED, HOUSE].reduce((sum, entry) => sum + entry.cases, 0);
    const known = [...SHIPPED, HOUSE].flatMap((entry) => entry.red ?? []);
    expect(whole.cases).toBe(total);
    expect([...whole.red].sort()).toEqual([...known].sort());

    report.push(
      known.length === 0
        ? `  cases      ${total} green over ${measured.reduce((sum, m) => sum + m.guardrails, 0)} guardrails`
        : `  cases      ${total - known.length} of ${total} green — ${known.length} KNOWN RED, named and pinned:`,
      ...known.map((name) => `             ✗ ${name}`),
      ...(known.length === 0
        ? []
        : [
            "             both prove themselves with a case naming `cli/pure/…`, so they cannot pass",
            "             in a repo that spells its pure home any other way. Found by this command;",
            "             the fix is a pack change, raised at F3 rather than made here.",
          ]),
      "  live",
    );
  });

  it("refuses the write — the stranger's own pure home, from a parameter", () => {
    // `core/**` is nothing this pack ever heard of: it is the `files` parameter reaching the scope,
    // live, on the rail rather than in a case.
    refusal(
      "write",
      hook("pre-tool-use", pre("Write", { file_path: join(repo, "core/clock.ts"), content: "export const now = () => new Date();\n" })),
      "fcis.noSideEffectsInPure",
    );
  });

  it("refuses the delete — the guard surface named by a parameter", () => {
    // One Bash call, two moments: the command itself, and the file the `rm` would take. `rules/`
    // is the stranger's pack folder, handed to the guard pack as `packs`.
    refusal("delete", hook("pre-tool-use", pre("Bash", { command: "rm rules/house.ts" })), "guard.noDeleteGuardrails");
  });

  it("refuses the command", () => {
    refusal("command", hook("pre-tool-use", pre("Bash", { command: "git push --force origin main" })), "git.noForcePush");
  });

  it("refuses the commit, at git's own hook, and passes the same commit once it is clean", () => {
    // ASSEMBLED, never written whole: spelled out, this file would carry a live-key shape and the
    // rule it is testing would refuse the commit that adds it. The pack's own block case is built
    // the same way, for the same reason.
    const KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const notes = join(repo, "deploy-notes.txt");
    writeFileSync(notes, `the old prod key was ${KEY}\n`);
    git(["add", "deploy-notes.txt"]);

    const refused = git(["commit", "-m", "chore: deploy notes"]);
    expect(refused.code, "git refuses when the gate exits non-zero").not.toBe(0);
    expect(refused.stderr).toContain("secrets.noSecretsInCommits");
    report.push("    commit    ✗ secrets.noSecretsInCommits (at git's own pre-commit hook)");

    // …and the gate is not simply refusing everything: the same commit lands once the shape is
    // gone, with every exec-shaped rule in the config (the suite, the typecheck, the lint) really
    // running the stranger's own script.
    writeFileSync(notes, "the old prod key was rotated on Tuesday\n");
    git(["add", "deploy-notes.txt"]);
    const passed = git(["commit", "-m", "chore: deploy notes"]);
    expect(passed.code, passed.stdout + passed.stderr).toBe(0);
    report.push("               …and the clean commit lands, gates run");
  });

  it("refuses the turn-end — the one moment no shipped pack carries", () => {
    // The turn is read off the transcript the host writes, so the transcript is what has to exist:
    // a typed prompt, then four edits and nothing run.
    mkdirSync(join(repo, ".t"), { recursive: true });
    const transcript = join(repo, ".t", "machine-2.jsonl");
    const edit = (path: string): unknown => ({ type: "tool_use", name: "Edit", input: { file_path: join(repo, path) } });
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "tidy the core" } }),
        JSON.stringify({
          type: "assistant",
          message: { content: [edit("core/a.ts"), edit("core/b.ts"), edit("core/c.ts"), edit("core/d.ts")] },
        }),
        "",
      ].join("\n"),
    );

    refusal(
      "turn-end",
      hook("stop", { session_id: "machine-2", hook_event_name: "Stop", transcript_path: transcript }),
      "house.ranSomething",
    );
    report.push(
      "               (no shipped pack carries a turn-end rule — this repo's own proves the rail)",
      "",
      "  ✔ every pack binds, loads and fires.",
    );
  });
});
