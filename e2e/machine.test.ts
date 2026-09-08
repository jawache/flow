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
// NOTHING OUTSIDE THE TEMP DIRECTORIES IS TOUCHED, and none of that plumbing is here: the
// throwaway repo, the built binary and the host's own `CLAUDE_CONFIG_DIR` and PATH seams are
// flow/harness.ts, which product.test.ts and live.test.ts drive too. Literally the same road as
// product.test.ts, one scale up.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildBundles,
  cleanBundles,
  fixturePack,
  newRepo,
  pre,
  settingsHome,
  shimBin,
  flow as runFlow,
  git as runGit,
  hook as sendHook,
  type Ran,
} from "./harness.ts";
import { bindLine, EXAMPLE } from "../tools/domain.ts";

// ── the stranger, and what it calls things ───────────────────────────────────
//
// One shell script for the whole toolchain, `core/` for the pure home, `rules/` for the pack it
// writes itself. Not one of those names is this repo's, and that is the fixture's whole job.
//
// THE SPELLINGS ARE THE SHARED ONES — `EXAMPLE` in tools/domain.ts, the same values every pack page
// is rendered with. One list, because the alternative is a page documenting a binding nothing has
// ever run and a test driving a binding nobody has read. Two packs are bound differently here on
// purpose, and each says so at its own line.

/** Every pack the package ships, as a stranger's config binds it — with its census pinned. */
interface Shipped {
  /** The pack's exported name, which is also the prefix of every entry id it contributes. */
  readonly pack: string;
  /** What this repo binds it with. `undefined` binds it bare. */
  readonly params: Readonly<Record<string, unknown>> | undefined;
  /** What `flow test` runs over this pack alone. Pinned: a deleted case shows up here, by name. */
  readonly cases: number;
  /** The guardrails those cases cover — the disabled ones are loaded but not run. */
  readonly guardrails: number;
}

/** The config line one binding is written as — the generator's, so the page prints what runs here. */
const bind = (entry: Shipped): string => bindLine(entry.pack, entry.params);

const SHIPPED: readonly Shipped[] = [
  // BARE, where the page binds `root` and `allow`. Every parameter the docs pack takes is optional,
  // and a pack in that state must stay bindable with no object at all — a config that had already
  // bound it refuses to load, fail-closed, the day the pack gains its first parameter otherwise.
  // Nothing else in this file drives that path: `node` and `work` take no parameters to begin with.
  { pack: "docs", params: undefined, cases: 3, guardrails: 2 },
  // `example` is the field this command's first run earned. Two of the pack's entries narrow
  // inside their own check (`changed`, `whenAdded`) rather than through `.on(…)`, and both used
  // to prove themselves with `cli/pure/a.ts` written out — one repo's spelling, inside the pack.
  // Bound here, against `core/`, their block cases fell outside the check's narrowing, were
  // correctly passed, and FAILED: `flow test` red on day one in every repo that spells its pure
  // home differently. Nothing else in the suite could see it, because nothing else binds a pack
  // as a stranger.
  { pack: "fcis", params: EXAMPLE.fcis, cases: 15, guardrails: 7 },
  { pack: "flow", params: EXAMPLE.flow, cases: 2, guardrails: 1 },
  { pack: "git", params: EXAMPLE.git, cases: 51, guardrails: 7 },
  // `recipes` bound, so the entry that only exists when a repo has one is driven here too.
  { pack: "justfile", params: EXAMPLE.justfile, cases: 15, guardrails: 3 },
  { pack: "node", params: undefined, cases: 14, guardrails: 2 },
  { pack: "secrets", params: EXAMPLE.secrets, cases: 6, guardrails: 3 },
  { pack: "tdd", params: EXAMPLE.tdd, cases: 12, guardrails: 6 },
  // NO SHARED BASE, where the page names both — `eslintFromBase` exists only when a repo names an
  // eslint base, so the page has to name one or that rule is invisible to a reader, and this has to
  // name none or the no-base path the F2 ruling created is driven nowhere. The two gate recipes are
  // the shared ones.
  { pack: "typescript", params: { typecheck: EXAMPLE.typescript.typecheck, lint: EXAMPLE.typescript.lint }, cases: 7, guardrails: 3 },
  { pack: "work", params: undefined, cases: 16, guardrails: 5 },
];
/** The stranger's own pack — the eleventh binding, and the only turn-end rule in the config. */
const HOUSE: Shipped = { pack: "house", params: undefined, cases: 2, guardrails: 1 };

/**
 * The stranger's own pack, in the folder the stranger chose.
 *
 * ONE RULE, and it is at turn-end deliberately: not one of the ten shipped packs carries a
 * turn-end guardrail, so the rail would otherwise go undriven here — and "no pack ships one" is a
 * fact about the packs, not about the moment. This is also what `flow`'s `packs: ["rules/**"]`
 * parameter is pointed at, so the delete refusal below is protecting a file that really exists.
 *
 * It is the fixture `live.test.ts` drives too (flow/__fixtures__/repo-pack.ts), with its import
 * repointed at the bare specifier — which is the one this repo can resolve, because `flow init`
 * linked it.
 */
const HOUSE_PACK = fixturePack("repo-pack", "@jawache/flow");

/** The whole guard of a repo that binds everything flow ships, plus the one pack it writes itself. */
const CONFIG = `// flow.config.ts — this repo's whole guard.
import { defineConfig, pack } from "@jawache/flow";
import { docs, fcis, flow, git, justfile, node, secrets, tdd, typescript, work } from "@jawache/flow/packs";
import { house } from "./rules/house.ts";

export default defineConfig([
${SHIPPED.map((s) => `  ${bind(s)},`).join("\n")}
  ${bind(HOUSE)},
]);
`;

/** One pack alone, so `flow test` can be asked about it by itself. */
const only = (entry: Shipped): string =>
  entry.pack === HOUSE.pack
    ? `import { defineConfig, pack } from "@jawache/flow";\nimport { house } from "../rules/house.ts";\nexport default defineConfig([${bind(entry)}]);\n`
    : `import { defineConfig, pack } from "@jawache/flow";\nimport { ${entry.pack} } from "@jawache/flow/packs";\nexport default defineConfig([${bind(entry)}]);\n`;

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
  "fcis.noShellInPure",
  "fcis.noSideEffectsInPure",
  "fcis.noThrowInPure",
  "fcis.pureCovered",
  "fcis.pureExportsTested",
  "fcis.pureHasTest",
  "flow.editingTheGuardrails",
  "flow.noDeleteGuardrails",
  "flow.orientation",
  "git.conventionalCommitFormat",
  "git.noAiAttributionInCommits",
  "git.noForcePush",
  "git.noGitDiscard",
  "git.noShellSubstitutionInProse",
  "git.node.noHandEditedVersion",
  "git.node.versionIsSemver",
  "git.orientation",
  "house.ranSomething",
  "justfile.justfileDocs",
  "justfile.node.noPackageScripts",
  "justfile.orientation",
  "justfile.toolsHome",
  "justfile.useTheRecipe",
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
  "typescript.strictTypesNoInvalidStates",
  "typescript.tsconfigStrict",
  "work.checkersDoNotWrite",
  "work.noAgentInboxItems",
  "work.noShellSubstitutionInProse",
  "work.planIsTheParents",
  "work.ticksAreTheChilds",
];

// ── the road ─────────────────────────────────────────────────────────────────

let home: string;
/** A directory holding one `flow` shim, so git's own hook can find the binary under test. */
let bin: string;
let repo: string;
let scaffolded: Ran;

/** The report this command prints. Every line is something that was driven, not something claimed. */
const report: string[] = [];

/**
 * THE STEPS THE ROAD IS MADE OF, and the ones that actually finished.
 *
 * A failed run still prints whatever the steps AFTER the failure managed to push, which reads as a
 * complete report with a hole in it — the worst of the three possible outputs. So each step signs
 * its own name, and `afterAll` says which never did.
 */
const STEPS = ["scaffold", "bind", "cases", "write", "delete", "command", "commit", "turn-end"] as const;
const finished = new Set<string>();
const step = (name: (typeof STEPS)[number], ...lines: string[]): void => {
  finished.add(name);
  report.push(...lines);
};

/** The built binary, in the stranger's repo, with the throwaway host settings and the shim on PATH. */
const flow = (args: readonly string[], stdin = ""): Ran => runFlow(repo, args, { home, bin }, stdin);
const git = (args: readonly string[]): Ran => runGit(repo, args, { home, bin });
const hook = (event: string, payload: Record<string, unknown>): Ran => sendHook(repo, event, payload, { home, bin });
const inThisSession = (tool: string, input: Record<string, unknown>): Record<string, unknown> =>
  pre(tool, input, "machine-1");

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
function refusal(moment: (typeof STEPS)[number], said: Ran, entry: string): void {
  expect(said.code, `${moment} was not refused:\n${said.stdout}${said.stderr}`).toBe(2);
  expect(said.stderr, `${moment} refused, but not by ${entry}`).toContain(entry);
  step(moment, `    ${moment.padEnd(9)} ✗ ${entry}`);
}

beforeAll(() => {
  // The BUILT bundles, deliberately: `@jawache/flow` and `@jawache/flow/packs` resolve to
  // dist/index.mjs and dist/packs.mjs through the link `flow init` makes, so this is the only
  // place the packs subpath export is exercised as an INSTALL rather than as a source import.
  const built = buildBundles();
  expect(built.code, built.stderr).toBe(0);

  home = settingsHome("flow-machine-home-");
  bin = shimBin("flow-machine-bin-");
  repo = newRepo("flow-machine-");

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
  // PRINTED ONLY WHEN ASKED. This file is in the flow project (`just test` and `just test-flow`
  // run it, and the commit gate runs those), so an unconditional report is twenty lines of ASCII
  // in the middle of somebody else's suite output. `just test-packs` — the door this command is
  // named at — sets the variable; every other runner gets the exit code and vitest's own failure
  // report, which is what it came for.
  if (process.env["FLOW_MACHINE_REPORT"]) {
    const missing = STEPS.filter((name) => !finished.has(name));
    const hole =
      missing.length === 0
        ? []
        : ["", `  … report TRUNCATED — ${missing.join(", ")} did not finish. The failure is above; the lines here are the steps that did.`];
    process.stdout.write(`\n${[...report, ...hole].join("\n")}\n\n`);
  }
  for (const dir of [repo, home, bin]) rmSync(dir, { recursive: true, force: true });
  cleanBundles();
});

describe("the machine test", () => {
  it("scaffolds and arms a repo that has never heard of flow", () => {
    expect(scaffolded.code, scaffolded.stdout + scaffolded.stderr).toBe(0);
    for (const created of ["flow.config.ts", ".githooks/pre-commit", "node_modules/@jawache/flow", "core.hooksPath"])
      expect(scaffolded.stdout).toContain(created);
    step("scaffold", "flow packs — the machine test, in a repo that has never heard of flow", "", "  scaffold   flow init armed the gate, the link and the four registrations");
  });

  it("binds every pack the package ships, and exactly these entries", () => {
    const said = flow(["status", "--json"]);
    const read = JSON.parse(said.stdout) as {
      green: boolean;
      moments: { moments: { entries: { id: string; pack: string }[] }[]; totals: Record<string, number> };
    };
    const entries = read.moments.moments.flatMap((m) => m.entries);
    const ids = [...new Set(entries.map((e) => e.id))].sort();

    // The exact list, not a count: "one fewer" is a puzzle, "flow.noDeleteGuardrails is gone" is
    // an answer.
    expect(ids).toEqual([...ENTRIES]);
    expect([...new Set(entries.map((e) => e.pack))].sort()).toEqual([...SHIPPED.map((s) => s.pack), HOUSE.pack].sort());
    expect(read.green, `flow status is not green:\n${flow(["status"]).stdout}`).toBe(true);
    expect(said.code).toBe(0);

    const totals = read.moments.totals;
    step(
      "bind",
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
      // Every case of every pack, green under somebody else's parameters. A pack whose own case
      // only passes in the repo that wrote it is a pack that does not travel, and that is exactly
      // what this command exists to catch — it caught two on its first run.
      expect(red, `${entry.pack} failed its own cases:\n${said.stdout}`).toEqual([]);
      return { pack: entry.pack, cases, guardrails };
    });
    expect(measured).toEqual([...SHIPPED, HOUSE].map(({ pack, cases, guardrails }) => ({ pack, cases, guardrails })));

    // …and the same run over the whole config: green, and the cases add up — which is the
    // arithmetic that catches a case moving between packs rather than disappearing.
    const said = flow(["test"]);
    expect(said.code, said.stdout + said.stderr).toBe(0);
    expect(said.stdout).toContain("all green");
    const total = [...SHIPPED, HOUSE].reduce((sum, entry) => sum + entry.cases, 0);
    expect(ran(said).cases).toBe(total);

    step("cases", `  cases      ${total} green over ${measured.reduce((sum, m) => sum + m.guardrails, 0)} guardrails, pack by pack`, "  live");
  });

  it("refuses the write — the stranger's own pure home, from a parameter", () => {
    // `core/**` is nothing this pack ever heard of: it is the `files` parameter reaching the scope,
    // live, on the rail rather than in a case.
    refusal(
      "write",
      hook("pre-tool-use", inThisSession("Write", { file_path: join(repo, "core/clock.ts"), content: "export const now = () => new Date();\n" })),
      "fcis.noSideEffectsInPure",
    );
  });

  it("refuses the delete — the guard surface named by a parameter", () => {
    // One Bash call, two moments: the command itself, and the file the `rm` would take. `rules/`
    // is the stranger's pack folder, handed to the flow pack as `packs`.
    refusal("delete", hook("pre-tool-use", inThisSession("Bash", { command: "rm rules/house.ts" })), "flow.noDeleteGuardrails");
  });

  it("refuses the command", () => {
    refusal("command", hook("pre-tool-use", inThisSession("Bash", { command: "git push --force origin main" })), "git.noForcePush");
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
    step("commit", "    commit    ✗ secrets.noSecretsInCommits (at git's own pre-commit hook)");

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
