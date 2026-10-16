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
// WHERE THE SETTINGS LIVE. A repo whose package.json lists `@jawache/flow` keeps flow's hooks in its
// own `.claude/settings.json`; every other repo uses the machine-wide file — `settingsFileFor` in
// domain.ts decides which. The machine-wide file is `~/.claude/settings.json`, and
// `CLAUDE_CONFIG_DIR` is the host's own documented override — honoured here rather than
// hard-coding a home, because it is also the seam that lets this file be driven over a throwaway
// directory instead of somebody's real setup.

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version.ts";
import { ensureFlowDir, isOff, readRows } from "../engine/state.ts";
import { FLOW_DIR } from "../engine/domain.ts";
import {
  CONFIG_FILE,
  GATE_PATH,
  HOOKS_DIR,
  hooksDirOf,
  initCode,
  initLines,
  lastMode,
  literalScopes,
  listsFlow,
  PACKAGE_BIN,
  hostPath,
  pathLines,
  planInit,
  preCommitOf,
  settingsFileFor,
  status,
  statusCode,
  statusLines,
  steerOf,
  wantsColour,
  type HooksFolder,
  type InitFacts,
  type InitPlan,
  type StatusFacts,
} from "./domain.ts";
import { grammarsAt, loadRegime, readText, wearer } from "./claude.ts";
import { readStore, readTranscript } from "./archive.ts";

/** What a verb answers with. The same three edges a hook answers on, minus the decision object. */
export interface VerbResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * The settings file flow's hooks live in for this repo — the repo's own when its package.json lists
 * flow, else the host's machine-wide file, `CLAUDE_CONFIG_DIR` first because that is the host's own
 * override. `settingsFileFor` decides; this only reads.
 */
function settingsFile(root: string): string {
  return settingsFileFor(readText(root, "package.json"), machineSettingsPath());
}

/** The host's machine-wide settings file, `CLAUDE_CONFIG_DIR` first. */
function machineSettingsPath(): string {
  return join(process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude"), "settings.json");
}

/**
 * The machine-wide file, parsed, when flow's hooks are in the repo's own — the one place a hook
 * there could run flow a second time — and null when `settingsPath` is the machine-wide file.
 */
function machineFile(root: string, settingsPath: string): { path: string; settings: unknown; unreadable: boolean } | null {
  const machine = machineSettingsPath();
  if (settingsPath === machine) return null;
  const read = parsedFile(root, machine);
  return { path: machine, settings: read.value, unreadable: read.unreadable };
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
function packageRoot(): string | null {
  let at = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up++) {
    const manifest = readText(at, "package.json");
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

/**
 * Can this user run the file at that path? What git asks before it runs a hook, and what a shell
 * looking `flow` up by name asks of each folder on the PATH.
 */
function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
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

/**
 * The folder git runs hooks from, what is in it, and the pre-commit hook a person edits for it.
 *
 * `git rev-parse --git-path hooks` is git's own answer: `core.hooksPath` when it is set, with `~`
 * expanded, and `.git/hooks` when it is not. That is the shared git directory in a worktree, whose
 * `.git` is a file. `hooksDirOf` spells it the way a person would type it. Null when git cannot say.
 */
function hooksFolder(root: string): HooksFolder | null {
  let said: string;
  try {
    said = execFileSync("git", ["-C", root, "rev-parse", "--git-path", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  if (said === "") return null;
  const dir = hooksDirOf(root, said);
  const at = resolve(root, dir);
  let files: string[] = [];
  try {
    files = readdirSync(at, { withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    /* no folder there yet: git runs nothing from it */
  }
  const preCommit = preCommitOf(dir);
  return { dir, files, preCommit: readText(root, preCommit), preCommitExecutable: executable(resolve(root, preCommit)) };
}

/**
 * What git ignores in this repo — the edge of the snapshot, which is git's view of the tree.
 *
 * Two questions, both answered one path per line: the ignored paths that exist (a whole ignored
 * directory is one line, with its trailing `/`, so `node_modules/` costs one line and not a walk),
 * and which of the paths the rules name outright git WOULD ignore, which catches a `.env` that has
 * not been written yet. flow's own `.flow/` is left out: it ignores itself, and no rule is about it.
 * Not a git repo, or git unable to answer, is an empty list — status has its own lines for those.
 */
function ignoredPaths(root: string, literals: readonly string[]): string[] {
  const listed = spawnSync("git", ["-C", root, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], {
    encoding: "utf8",
  });
  const named =
    literals.length === 0
      ? null
      : spawnSync("git", ["-C", root, "check-ignore", "--stdin"], { encoding: "utf8", input: `${literals.join("\n")}\n` });
  const all = [...(listed.status === 0 ? pathLines(listed.stdout) : []), ...pathLines(named?.stdout ?? null)];
  return [...new Set(all)].filter((path) => path !== `${FLOW_DIR}/` && !path.startsWith(`${FLOW_DIR}/`));
}

/**
 * Whatever JSON is in that file, and WHY there is none when there is none.
 *
 * The two silences are different and both callers need them apart: ABSENT is a file init may
 * create, UNREADABLE is a file init must not touch. Returning one null for both is how a settings
 * file holding a stray comma or a `//` comment gets replaced by flow's registrations and nothing
 * else — every other key in it belonging to somebody, and no safe merge into bytes nobody parsed.
 *
 * `root` is what a repo-relative path is read against: a dev dependency's `.claude/settings.json`
 * is one. The machine-wide settings file is absolute and passes straight through, which is the
 * same rule every other read in the package follows.
 */
function parsedFile(root: string, path: string): { readonly value: unknown; readonly unreadable: boolean } {
  const text = readText(root, path);
  if (text === null || text.trim() === "") return { value: null, unreadable: false };
  try {
    return { value: JSON.parse(text) as unknown, unreadable: false };
  } catch {
    return { value: null, unreadable: true };
  }
}

/**
 * Who last worked in this worktree, what they wear, and the permission mode they run under — the
 * marker the write rail leaves, and the mode its last call recorded.
 */
function liveSession(root: string): StatusFacts["session"] {
  const { session, who, wearing } = wearer(root);
  // `wearer` answers with the attribution's fallback when the marker is missing, stale or malformed,
  // and that fallback is not a session: reporting it would name a chat that never existed.
  if (who === null) return null;
  const { agent } = who;
  const mode = lastMode(readRows(root, session));
  return { id: session, agent, wearing, mode, steer: mode === "auto" ? steerOf(transcriptOf(root, session, agent)) : null };
}

/** That agent's own transcript from the host's store, or nothing when the store does not hold it. */
function transcriptOf(root: string, session: string, agent: string): string {
  const store = readStore(root);
  const stem = agent === "main" ? null : `agent-${agent}`;
  const held = store.transcripts.find((t) => t.ref.session === session && t.ref.agent === stem);
  return held === undefined ? "" : readTranscript(store.dir, held).jsonl;
}

// ── init ─────────────────────────────────────────────────────────────────────

/** Everything init found, before it wrote anything. */
function initFacts(root: string, empty: boolean): InitFacts {
  const settingsPath = settingsFile(root);
  const read = parsedFile(root, settingsPath);
  return {
    root,
    empty,
    isGit: existsSync(join(root, ".git")),
    hasConfig: existsSync(join(root, CONFIG_FILE)),
    gateText: readText(root, GATE_PATH),
    hasFlowDir: existsSync(join(root, FLOW_DIR)),
    hooksPath: hooksPath(root),
    hooksFolder: hooksFolder(root),
    settingsPath,
    settings: read.value,
    settingsUnreadable: read.unreadable,
    machine: machineFile(root, settingsPath),
    resolves: resolves(root),
    packageRoot: packageRoot(),
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
      const at = join(scope, "flow");
      // The plan says link because nothing resolves — and a DANGLING symlink at this path is one
      // way nothing resolves: a link an earlier tool wrote to a checkout that has since moved.
      // Replacing it is the same act as creating it. A real directory or a live link is left
      // alone and the refusal below names the path, because that is somebody's install.
      if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() && !existsSync(at)) unlinkSync(at);
      symlinkSync(plan.link as string, at, "dir");
    });

  // Repo-relative for a dev dependency's own file, absolute for the machine-wide one.
  for (const settings of [plan.settings, plan.machine]) {
    if (settings === null) continue;
    const { path, value } = settings;
    attempt(`could not write ${path}`, () => {
      const file = resolve(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    });
  }

  // LAST, and after the gate file: `core.hooksPath` is what makes the hook run at all, so pointing
  // git at a directory before the hook is in it would leave a window where a commit runs nothing.
  if (plan.hooksPath)
    attempt("could not set core.hooksPath", () =>
      execFileSync("git", ["-C", root, "config", "core.hooksPath", HOOKS_DIR], { stdio: "ignore" }),
    );

  return failures;
}

/** `flow init [--empty]` — make this repo drivable, and say exactly what was created. */
export function runInit(cwd: string, args: readonly string[]): VerbResult {
  const root = resolve(cwd);
  const plan = planInit(initFacts(root, args.includes("--empty")));
  const failures = perform(root, plan);
  return {
    // `flow.ts` writes this to the process's own stdout, so that is the terminal asked about.
    stdout: `${initLines(plan, failures, wantsColour(process.stdout.isTTY, process.env["NO_COLOR"])).join("\n")}\n`,
    stderr: "",
    exitCode: initCode(plan, failures),
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
  //
  // `regime.message` is ALREADY the whole sentence: `loadRegime` builds it with `configLoadFault`,
  // which is the point of that message being made in exactly one place. Wrapping it a second time
  // here printed the prefix twice — "flow: flow.config.ts could not be loaded — flow: flow.config.ts
  // could not be loaded — Cannot find module …" — which reads as two faults, not one.
  if (regime.kind === "broken") return { stdout: "", stderr: `${regime.message}\n`, exitCode: 2 };

  const settingsPath = settingsFile(root);
  const facts: StatusFacts = {
    root,
    version: VERSION,
    off: isOff(root),
    configPath,
    hasConfig: regime.kind === "loaded",
    load: regime.kind === "loaded" ? regime.load : null,
    gateText: readText(root, GATE_PATH),
    hooksPath: hooksPath(root),
    hooksFolder: hooksFolder(root),
    settingsPath,
    settings: parsedFile(root, settingsPath).value,
    machine: machineFile(root, settingsPath),
    grammars:
      regime.kind === "loaded"
        ? grammarsAt(regime.config.settings, root).map((grammar) => ({
            name: grammar.name,
            libraryPath: grammar.libraryPath,
            present: existsSync(grammar.libraryPath),
          }))
        : [],
    session: liveSession(root),
    ignored: ignoredPaths(root, literalScopes(regime.kind === "loaded" ? regime.load : null)),
    snapshotInclude: regime.kind === "loaded" ? (regime.config.settings.snapshotInclude ?? []) : [],
    binary: {
      listed: listsFlow(readText(root, "package.json")),
      copy: existsSync(join(root, PACKAGE_BIN)),
      path: hostPath((process.env["PATH"] ?? "").split(delimiter), root).some((dir) => executable(join(dir, "flow"))),
    },
  };

  // ONE CODE FOR A CONFIG THAT WILL NOT LOAD, however it broke — `statusCode` says why. The branch
  // above already answers 2 for a config that will not import; a config the GRAMMAR refused used to
  // come through here as a 1, which is the same fact wearing the other code.
  const answer = status(facts);
  const exitCode = statusCode(answer);
  if (args.includes("--json")) return { stdout: `${JSON.stringify(answer, null, 2)}\n`, stderr: "", exitCode };
  return { stdout: `${statusLines(answer).join("\n")}\n`, stderr: "", exitCode };
}
