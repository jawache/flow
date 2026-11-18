// flow/adapter/product.ts — the shell behind the verbs a PERSON types: `flow init`, `flow status`
// and `flow uninstall`.
//
// It is the sibling of the harness's own shell, which is behind the verb the HARNESS invokes, and it
// is split from it for the reason the whole package is split: what a hook does on every tool call and
// what a person does once at setup have nothing in common but the words they share. It is handed
// the harness as a `Harness` (harness.ts) and names none.
//
// It reaches the world — disk, git, the host's settings file, node's own resolver — and decides
// nothing. What to write given what is already there, what to remove, and what to SAY given what
// loaded, are `planInit`, `planUninstall` and `status` next door in domain.ts, where every branch
// has a test.
//
// WHERE THE SETTINGS LIVE. In the repo, whatever the repo is: each harness keeps flow's hooks in its own
// file there (`registering.repoFile`), and nothing in this file writes a machine-wide one. The
// machine-wide file is read, to warn that flow 0.3's hooks are in it, and `flow uninstall --machine`
// removes what 0.3 wrote there.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version.ts";
import { ensureFlowDir, isOff, readHistory, readRows } from "../engine/state.ts";
import { FLOW_DIR } from "../engine/domain.ts";
import {
  CONFIG_FILE,
  GATE_PATH,
  OLD_GATE_PATH,
  HOOKS_DIR,
  hooksDirOf,
  initCode,
  initLines,
  lastMode,
  PACKAGE_BIN,
  PACKAGE_DIR,
  planUninstall,
  uninstallCode,
  uninstallLines,
  uninstallRefusal,
  MACHINE_FLAG,
  hostPath,
  planInit,
  commitMsgOf,
  aboutToWrite,
  harnessArg,
  harnessPrompt,
  harnessQuestion,
  isYes,
  lastHookRan,
  listsFlow,
  chooseHarnesses,
  defaultHarnesses,
  warningLines,
  status,
  statusCode,
  statusLines,
  wantsColour,
  type Found,
  type HooksFolder,
  type InitFacts,
  type InitHarness,
  type InitPlan,
  type StatusFacts,
  type StatusHarness,
  type UninstallFacts,
  type UninstallHarness,
  type UninstallPlan,
} from "./domain.ts";
import type { Harness } from "./harness.ts";
import { grammarsAt, loadRegime, readText, wearer } from "./shell.ts";

/** What a verb answers with. The same three edges a hook answers on, minus the decision object. */
export interface VerbResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The machine-wide settings file of a harness, read: its path, its JSON (null when there is none), and whether it would not parse. */
function readMachineFile(root: string, harness: Harness): { path: string; settings: unknown; unreadable: boolean } {
  const path = harness.machineSettingsPath();
  const read = parsedFile(root, path);
  return { path, settings: read.value, unreadable: read.unreadable };
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
 * The folder git runs hooks from, what is in it, and the commit-msg hook a person edits for it.
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
  const commitMsg = commitMsgOf(dir);
  return { dir, files, commitMsgText: readText(root, commitMsg), commitMsgExecutable: executable(resolve(root, commitMsg)) };
}

/**
 * Whatever JSON is in that file, and WHY there is none when there is none.
 *
 * The two silences are different and both callers need them apart: ABSENT is a file init may
 * create, UNREADABLE is a file init must not touch. Returning one null for both is how a settings
 * file holding a stray comma or a `//` comment gets replaced by flow's registrations and nothing
 * else — every other key in it belonging to somebody, and no safe merge into bytes nobody parsed.
 *
 * `root` is what a repo-relative path is read against: a harness's settings file in the repo is
 * one. The machine-wide settings file is absolute and passes straight through, which is the
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
 * marker a tool call leaves, and the mode its last call recorded.
 */
function liveSession(root: string, harness: Harness): StatusFacts["session"] {
  const { session, who, wearing } = wearer(root);
  // `wearer` answers with the attribution's fallback when the marker is missing, stale or malformed,
  // and that fallback is not a session: reporting it would name a chat that never existed.
  if (who === null) return null;
  const { agent } = who;
  const mode = lastMode(readRows(root, session));
  return { id: session, agent, wearing, mode, steer: mode === "auto" ? harness.transcripts.steer(transcriptOf(root, session, agent, harness)) : null };
}

/** That agent's own transcript from the host's store, or nothing when the store does not hold it. */
function transcriptOf(root: string, session: string, agent: string, harness: Harness): string {
  const { transcripts } = harness;
  const store = transcripts.readStore(root);
  const id = agent === "main" ? null : agent;
  const held = store.transcripts.find((t) => t.ref.session === session && t.ref.agent === id);
  return held === undefined ? "" : transcripts.readTranscript(store.dir, held).jsonl;
}

// ── init ─────────────────────────────────────────────────────────────────────

/** Everything init found, before it wrote anything, for the harnesses chosen. */
function initFacts(root: string, empty: boolean, chosen: readonly Harness[]): InitFacts {
  return {
    harnesses: chosen.map((harness): InitHarness => {
      const read = parsedFile(root, harness.registering.repoFile);
      const machine = readMachineFile(root, harness);
      return {
        harness,
        settings: read.value,
        settingsUnreadable: read.unreadable,
        machine: { path: machine.path, settings: machine.settings },
      };
    }),
    root,
    empty,
    isGit: existsSync(join(root, ".git")),
    hasConfig: existsSync(join(root, CONFIG_FILE)),
    gateText: readText(root, GATE_PATH),
    oldGateText: readText(root, OLD_GATE_PATH),
    hasFlowDir: existsSync(join(root, FLOW_DIR)),
    hooksPath: hooksPath(root),
    hooksFolder: hooksFolder(root),
    resolves: resolves(root),
    listed: listsFlow(readText(root, "package.json")),
    packageRoot: packageRoot(),
  };
}

/** Is a program in a folder on the `PATH` this command was run with, less what npm added for this run? */
function onPath(root: string, program: string): boolean {
  return hostPath((process.env["PATH"] ?? "").split(delimiter), root).some((dir) => executable(join(dir, program)));
}

/** Each harness, with whether its folder is in the repo and its program is on the `PATH`. */
function findHarnesses(root: string, harnesses: readonly Harness[]): Found[] {
  return harnesses.map((harness) => ({
    harness,
    folder: existsSync(join(root, harness.detect.folder)),
    program: onPath(root, harness.detect.program),
  }));
}

/**
 * A run of best-effort steps: `attempt` runs one, and a step that throws is COLLECTED in `failures`
 * as "what: why" rather than ending the run. Init and uninstall both carry out their plans this way.
 */
function steps(): { readonly failures: string[]; readonly attempt: (what: string, act: () => void) => void } {
  const failures: string[] = [];
  const attempt = (what: string, act: () => void): void => {
    try {
      act();
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`);
    }
  };
  return { failures, attempt };
}

/**
 * The plan, performed. Every step is best-effort and every failure is COLLECTED rather than thrown:
 * a partial setup is the interesting case, and a person needs the list of what did land beside the
 * one thing that did not.
 */
function perform(root: string, plan: InitPlan): string[] {
  const { failures, attempt } = steps();

  for (const write of [plan.config, plan.gate]) {
    if (write === null) continue;
    attempt(`could not write ${write.path}`, () => {
      const file = join(root, write.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, write.body);
      if (write.mode !== undefined) chmodSync(file, write.mode);
    });
  }

  // The pre-0.4 gate goes after the new one is in place, so a commit never runs with neither.
  const { oldGate } = plan;
  if (oldGate !== null)
    attempt(`could not ${oldGate.body === null ? "delete" : "rewrite"} ${oldGate.path}`, () => {
      const file = join(root, oldGate.path);
      if (oldGate.body === null) unlinkSync(file);
      else writeFileSync(file, oldGate.body);
    });

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

  // Each harness's own file in the repo, and no file outside it.
  for (const { path, value } of plan.settings) {
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

/** A person at a terminal: what is asked of them, and where what is said to them goes. */
export interface Terminal {
  readonly ask: (question: string) => Promise<string>;
  readonly say: (text: string) => void;
}

/**
 * `flow init [--empty] [--harness <names>]` — make this repo drivable, and say exactly what was created.
 *
 * With a `terminal` it is interactive: it prompts for the harnesses, prints each warning, lists what
 * it is about to write and asks for a yes. Without one, as when an agent or a script runs it, it
 * prompts for nothing: `--harness` names the harnesses, else the detected ones, else every one.
 */
export async function runInit(cwd: string, args: readonly string[], harnesses: readonly Harness[], terminal: Terminal | null): Promise<VerbResult> {
  const root = resolve(cwd);
  const found = findHarnesses(root, harnesses);
  let typed = harnessArg(args);
  if (typed === null && terminal !== null) {
    terminal.say(`${harnessPrompt(found, defaultHarnesses(found)).join("\n")}\n`);
    const answer = (await terminal.ask(harnessQuestion(found))).trim();
    typed = answer === "" ? null : answer;
  }
  const chosen = chooseHarnesses(found, typed);
  if (!chosen.ok) return { stdout: "", stderr: `${chosen.refusal}\n`, exitCode: 1 };
  const { ids } = chosen;
  const plan = planInit(initFacts(root, args.includes("--empty"), harnesses.filter((harness) => ids.includes(harness.id))));
  const warned = warningLines(plan);
  const colour = wantsColour(process.stdout.isTTY, process.env["NO_COLOR"]);
  if (terminal !== null) {
    if (warned.length > 0) terminal.say(`${warned.join("\n")}\n`);
    terminal.say(`${aboutToWrite(plan).join("\n")}\n`);
    if (!isYes(await terminal.ask("Write these? [Y/n] "))) return { stdout: "flow init — nothing was written.\n", stderr: "", exitCode: 1 };
  }
  const failures = perform(root, plan);
  return {
    // `flow.ts` writes this to the process's own stdout, so that is the terminal asked about.
    // `isTTY` is undefined, not false, on a stream that is not a terminal, whatever its type says.
    // In a terminal the warnings were said above, before the yes.
    stdout: `${[...(terminal === null ? warned : []), ...initLines(plan, failures, colour)].join("\n")}\n`,
    stderr: "",
    exitCode: initCode(plan, failures),
  };
}

// ── uninstall ────────────────────────────────────────────────────────────────

/**
 * The repo's top folder, as git prints it, when `root` is a folder below it; null at the top folder
 * or outside a repo. Both sides are real paths, so a symlinked temp folder compares equal.
 */
function subfolderOf(root: string): string | null {
  try {
    const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return top === "" || realpathSync(top) === realpathSync(root) ? null : top;
  } catch {
    return null;
  }
}

/** Everything uninstall found, before it removed anything. */
function uninstallFacts(root: string, machineFlag: boolean, harnesses: readonly Harness[]): UninstallFacts {
  const top = subfolderOf(root);
  let hooksDir: string[] | null;
  try {
    hooksDir = readdirSync(join(root, HOOKS_DIR));
  } catch {
    hooksDir = null;
  }
  return {
    harnesses: harnesses.map((harness): UninstallHarness => {
      const settings = parsedFile(root, harness.registering.repoFile);
      return { harness, settings: settings.value, settingsUnreadable: settings.unreadable, machineFile: readMachineFile(root, harness) };
    }),
    hasConfig: existsSync(join(root, CONFIG_FILE)),
    gateText: readText(root, GATE_PATH),
    oldGateText: readText(root, OLD_GATE_PATH),
    hooksPath: hooksPath(root),
    subfolderOf: top,
    hooksDir,
    // At the top folder: from a subfolder, git names flow's own `.githooks` by a path init does not.
    hooksFolder: hooksFolder(top ?? root),
    hasFlowDir: existsSync(join(root, FLOW_DIR)),
    linked: lstatSync(join(root, PACKAGE_DIR), { throwIfNoEntry: false })?.isSymbolicLink() ?? false,
    machineFlag,
  };
}

/** Remove a folder only when it is empty, and say nothing when it is not: it holds somebody's files. */
function removeIfEmpty(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    /* not empty, or not there: either way it is not flow's to remove */
  }
}

/**
 * The plan, carried out: the gate first, then the hooks path that points git at it, then the
 * folders, the link and the settings files. Every step is attempted, and every failure is COLLECTED
 * rather than thrown, so a person reads what did go beside the one thing that did not.
 */
function performUninstall(root: string, plan: UninstallPlan): string[] {
  const { failures, attempt } = steps();

  for (const gate of [plan.gate, plan.oldGate])
    if (gate !== null)
      attempt(`could not ${gate.body === null ? "delete" : "rewrite"} ${gate.path}`, () => {
        const file = join(root, gate.path);
        if (gate.body === null) unlinkSync(file);
        else writeFileSync(file, gate.body);
      });

  if (plan.hooksPath)
    attempt("could not unset core.hooksPath", () =>
      execFileSync("git", ["-C", root, "config", "--unset", "core.hooksPath"], { stdio: "ignore" }),
    );

  // rmdir, never a recursive remove: a file that turned up since the plan was made stops it.
  if (plan.hooksDir)
    attempt(`could not delete ${HOOKS_DIR}/`, () => {
      rmdirSync(join(root, HOOKS_DIR));
    });

  if (plan.flowDir)
    attempt(`could not delete ${FLOW_DIR}/`, () => {
      rmSync(join(root, FLOW_DIR), { recursive: true, force: true });
    });

  if (plan.link)
    attempt(`could not delete ${PACKAGE_DIR}`, () => {
      unlinkSync(join(root, PACKAGE_DIR));
      // The folders init made to hold the link go with it, when nothing else is in them.
      removeIfEmpty(join(root, "node_modules", "@jawache"));
      removeIfEmpty(join(root, "node_modules"));
    });

  // Repo-relative for a harness's own file, absolute for a machine-wide one.
  for (const settings of [...plan.settings, ...plan.machine]) {
    attempt(`could not write ${settings.path}`, () => {
      writeFileSync(resolve(root, settings.path), `${JSON.stringify(settings.value, null, 2)}\n`);
    });
  }

  return failures;
}

/**
 * `flow uninstall [--machine]` — remove what `flow init` wrote in this repo, but the config, and say
 * exactly what went. `--machine` takes flow's hooks out of the machine-wide settings files too.
 */
export function runUninstall(cwd: string, args: readonly string[], harnesses: readonly Harness[]): VerbResult {
  const refusal = uninstallRefusal(args);
  if (refusal !== null) return { stdout: "", stderr: `${refusal}\n`, exitCode: 2 };
  const root = resolve(cwd);
  const plan = planUninstall(uninstallFacts(root, args.includes(MACHINE_FLAG), harnesses));
  const failures = performUninstall(root, plan);
  return { stdout: `${uninstallLines(plan, failures).join("\n")}\n`, stderr: "", exitCode: uninstallCode(plan, failures) };
}

// ── status ───────────────────────────────────────────────────────────────────

/** `flow status` — is flow working here, and what will meet me. Green means guarded. */
export async function runStatus(cwd: string, args: readonly string[], harnesses: readonly Harness[]): Promise<VerbResult> {
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

  const history = readHistory(root);
  const facts: StatusFacts = {
    harnesses: harnesses.map((harness): StatusHarness => ({
      harness,
      settings: parsedFile(root, harness.registering.repoFile).value,
      lastRan: lastHookRan(history, harness.id),
    })),
    now: Date.now(),
    root,
    version: VERSION,
    off: isOff(root),
    configPath,
    hasConfig: regime.kind === "loaded",
    load: regime.kind === "loaded" ? regime.load : null,
    gateText: readText(root, GATE_PATH),
    oldGateText: readText(root, OLD_GATE_PATH),
    hooksPath: hooksPath(root),
    hooksFolder: hooksFolder(root),
    grammars:
      regime.kind === "loaded"
        ? grammarsAt(regime.config.settings, root).map((grammar) => ({
            name: grammar.name,
            libraryPath: grammar.libraryPath,
            present: existsSync(grammar.libraryPath),
          }))
        : [],
    session: liveSession(root, harnesses[0] as Harness),
    binary: {
      listed: listsFlow(readText(root, "package.json")),
      copy: existsSync(join(root, PACKAGE_BIN)),
      path: onPath(root, "flow"),
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
