// flow/adapter/product.ts — the shell behind the two verbs a PERSON types: `flow init` and
// `flow status`.
//
// It is the sibling of claude.ts, which is the shell behind the two the HARNESS invokes, and it is
// split from it for the reason the whole package is split: what a hook does on every tool call and
// what a person does once at setup have nothing in common but the words they share.
//
// It reaches the world — disk, git, the host's settings file, node's own resolver — and decides
// nothing. What to write given what is already there, and what to SAY given what loaded, are
// `planInit` and `status` next door in domain.ts, where every branch has a test.
//
// WHERE THE SETTINGS LIVE. The host reads `~/.claude/settings.json`, and `CLAUDE_CONFIG_DIR` is its
// own documented override — honoured here rather than hard-coding a home, because it is also the
// seam that lets this file be driven over a throwaway directory instead of somebody's real setup.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version.ts";
import { ensureFlowDir, isOff, loadState } from "../engine/state.ts";
import { commitAttribution } from "../engine/state.ts";
import { FLOW_DIR } from "../engine/domain.ts";
import {
  CONFIG_FILE,
  configLoadFault,
  initLines,
  planInit,
  status,
  statusLines,
  type InitFacts,
  type InitPlan,
  type StatusFacts,
} from "./domain.ts";
import { currentBranch, loadRegime } from "./claude.ts";

/** What a verb answers with. The same three edges a hook answers on, minus the decision object. */
export interface VerbResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const GATE = join(".githooks", "pre-commit");

/** A file's text, or null. Every read here is a fact-gathering read: absence is an answer. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The host's settings file — `CLAUDE_CONFIG_DIR` first, because that is the host's own override. */
export function settingsFile(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(env["CLAUDE_CONFIG_DIR"] || join(home, ".claude"), "settings.json");
}

/**
 * WHERE THIS BINARY'S PACKAGE IS — found by walking up for its own package.json, never computed
 * from a fixed number of `..`s.
 *
 * The distance from this module to the package root is not the same in the two things flow runs as:
 * from `adapter/product.ts` it is two levels, and from the bundled `dist/flow.mjs` it is one. A
 * literal `new URL("../../")` would therefore be right in the suite and wrong in the shipped binary
 * — silently, because it would still name a real directory.
 */
export function packageRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  let at = dirname(from);
  for (let up = 0; up < 6; up++) {
    const manifest = textOf(join(at, "package.json"));
    if (manifest !== null) {
      try {
        if ((JSON.parse(manifest) as { name?: unknown }).name === "@jawache/flow") return at;
      } catch {
        /* an unreadable package.json on the way up is not ours; keep walking */
      }
    }
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return null;
}

/** Does `@jawache/flow` resolve from this repo? What a `flow.config.ts` import will ask node. */
function resolves(root: string): boolean {
  try {
    createRequire(join(root, "noop.js")).resolve("@jawache/flow");
    return true;
  } catch {
    return false;
  }
}

/** `git config core.hooksPath`, as git itself answers it. Unset is a null, never an empty string. */
function hooksPath(root: string): string | null {
  try {
    const said = execFileSync("git", ["-C", root, "config", "--get", "core.hooksPath"], { encoding: "utf8" }).trim();
    return said === "" ? null : said;
  } catch {
    return null;
  }
}

/** Whatever JSON is in that file, or null — an unparseable settings file registers nothing. */
function parsedFile(path: string): unknown {
  const text = textOf(path);
  if (text === null || text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Who last worked in this worktree, and what they wear — the marker the write rail leaves. */
function liveSession(root: string): StatusFacts["session"] {
  const { session, agent } = commitAttribution(root, currentBranch(root));
  // `commitAttribution` answers with its fallback when the marker is missing, stale or malformed,
  // and that fallback is not a session: reporting it would name a chat that never existed.
  if (agent === null) return null;
  return { id: session, agent, wearing: loadState(root, session, agent).categories ?? [] };
}

// ── init ─────────────────────────────────────────────────────────────────────

/** Everything init found, before it wrote anything. */
function initFacts(root: string, empty: boolean): InitFacts {
  const settingsPath = settingsFile();
  return {
    root,
    empty,
    isGit: existsSync(join(root, ".git")),
    hasConfig: existsSync(join(root, CONFIG_FILE)),
    gateText: textOf(join(root, GATE)),
    hasFlowDir: existsSync(join(root, FLOW_DIR)),
    hooksPath: hooksPath(root),
    settingsPath,
    settings: parsedFile(settingsPath),
    resolves: resolves(root),
    packageRoot: packageRoot() ?? "",
  };
}

/**
 * The plan, performed. Every step is best-effort and every failure is COLLECTED rather than thrown:
 * a partial setup is the interesting case, and a person needs the list of what did land beside the
 * one thing that did not.
 */
function perform(root: string, plan: InitPlan): string[] {
  const failures: string[] = [];
  const attempt = (what: string, act: () => void): void => {
    try {
      act();
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`);
    }
  };

  for (const write of [plan.config, plan.gate]) {
    if (write === null) continue;
    attempt(`could not write ${write.path}`, () => {
      const file = join(root, write.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, write.body);
      if (write.mode !== undefined) chmodSync(file, write.mode);
    });
  }

  // `.flow/` self-ignores, so it never appears in `git status` and the repo needs no .gitignore edit
  // at all — which is why init writes no line into a file it does not own.
  if (plan.flowDir) attempt(`could not create ${FLOW_DIR}/`, () => void ensureFlowDir(root));

  if (plan.link !== null)
    attempt("could not link @jawache/flow", () => {
      const scope = join(root, "node_modules", "@jawache");
      mkdirSync(scope, { recursive: true });
      symlinkSync(plan.link as string, join(scope, "flow"), "dir");
    });

  if (plan.settings !== null)
    attempt(`could not write ${plan.settings.path}`, () => {
      mkdirSync(dirname(plan.settings?.path ?? ""), { recursive: true });
      writeFileSync(plan.settings?.path ?? "", `${JSON.stringify(plan.settings?.value, null, 2)}\n`);
    });

  // LAST, and after the gate file: `core.hooksPath` is what makes the hook run at all, so pointing
  // git at a directory before the hook is in it would leave a window where a commit runs nothing.
  if (plan.hooksPath)
    attempt("could not set core.hooksPath", () =>
      execFileSync("git", ["-C", root, "config", "core.hooksPath", ".githooks"], { stdio: "ignore" }),
    );

  return failures;
}

/** `flow init [--empty]` — make this repo drivable, and say exactly what was created. */
export function runInit(cwd: string, args: readonly string[]): VerbResult {
  const root = resolve(cwd);
  const plan = planInit(initFacts(root, args.includes("--empty")));
  const failures = perform(root, plan);
  return {
    stdout: `${initLines(plan, failures).join("\n")}\n`,
    stderr: "",
    // A setup command that could not finish must not answer 0 — a script chaining `flow init && …`
    // is asking exactly the question the failures answer.
    exitCode: failures.length === 0 ? 0 : 1,
  };
}

// ── status ───────────────────────────────────────────────────────────────────

/** `flow status` — is flow working here, and what will meet me. Green means guarded. */
export async function runStatus(cwd: string, args: readonly string[]): Promise<VerbResult> {
  const root = resolve(cwd);
  const configPath = join(root, CONFIG_FILE);
  const regime = await loadRegime(root);

  // A config that is THERE and will not even import is not something status can report on — there
  // are no entries to list and no fitting can make up for it. Exit 2, the same code `flow test`
  // uses, because "your rules are broken" and "your rules are not fully in force" are different
  // answers and a caller must be able to tell them apart.
  if (regime.kind === "broken")
    return {
      stdout: "",
      stderr: `${configLoadFault(CONFIG_FILE, regime.message, process.versions.node)}\n`,
      exitCode: 2,
    };

  const settingsPath = settingsFile();
  const facts: StatusFacts = {
    root,
    version: VERSION,
    off: isOff(root),
    configPath,
    hasConfig: regime.kind === "loaded",
    load: regime.kind === "loaded" ? regime.load : null,
    gateText: textOf(join(root, GATE)),
    hooksPath: hooksPath(root),
    settingsPath,
    settings: parsedFile(settingsPath),
    session: liveSession(root),
  };

  const answer = status(facts);
  if (args.includes("--json"))
    return { stdout: `${JSON.stringify(answer, null, 2)}\n`, stderr: "", exitCode: answer.green ? 0 : 1 };
  return { stdout: `${statusLines(answer).join("\n")}\n`, stderr: "", exitCode: answer.green ? 0 : 1 };
}
