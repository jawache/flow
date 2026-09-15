// flow/adapter/claude.ts — the adapter's SHELL: the live side of Claude Code, wired.
//
// Everything it acts on was decided somewhere else. The dialect is next door in domain.ts (a
// payload's meaning, a transcript's meaning, what a refusal looks like); the judgement is the
// engine's (`guard`, `brief`); the rules are the config's. This file opens files, runs commands,
// asks git what it knows, and hands the answers over. It makes no decisions a reader has to reason
// about — which is what makes the two questions of §7 it owns ("which repo is this", "where is the
// session log") the only harness knowledge that had to live in a shell.
//
// THREE ENTRY POINTS, and they are the whole live surface:
//
//   runHook(event)   one of the five registered hooks — stdin in, a HookResult out
//   runCommit(files) the git pre-commit gate, handed the staged set
//   realWorld(root)  the `World` a check reaches through: exec · fs · git
//
// IT FAILS IN TWO DIRECTIONS ON PURPOSE, and the split is the whole doctrine:
//
//   THE GUARD fails LOUD. A config that will not load, a classifier that throws, a check that
//   crashes, a bound command that is missing — every one of them BLOCKS, carrying the reason. The
//   engine decides that; this file just does not soften it. 2026-08-22 is why: this repo's own
//   config was broken for a day, the fault notice fired on every hook, and the human never saw one.
//
//   THE TELEMETRY fails SAFE and silent. A log that cannot be written must never be the reason a
//   write is refused — `.flow/` answers with a boolean and this file does not look. State is a
//   de-duplication convenience, and losing it re-shows a breadcrumb, which is the harmless
//   direction.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadConfig,
  type Category,
  type ExecResult,
  type FlowConfig,
  refusalText,
  type LoadResult,
  type Settings,
  type TurnAction,
  type World,
} from "../language/domain.ts";
import {
  afterCompaction,
  brief,
  categoriesIn,
  fault,
  guard,
  recorder,
  runRows,
  type Block,
  type Identity,
  type Marks,
  type Notice,
  type Outcome,
  type RecordedStep,
  type Row,
} from "../engine/domain.ts";
import { quoteArg } from "../checks/domain.ts";
import {
  appendRows,
  appendSteps,
  commitAttribution,
  isOff,
  isRecording,
  loadState,
  saveState,
  stickyIdentity,
  writeMarker,
} from "../engine/state.ts";
import {
  ALLOW,
  CONFIG_FILE,
  configLoadFault,
  configSurface,
  branchFromHead,
  faultText,
  hermeticEnv,
  isHookEvent,
  loadsAsStrippedModule,
  relativise,
  sessionFactsFrom,
  sidecarPath,
  refused,
  toEvent,
  toResult,
  tokensFromTranscript,
  toolRow,
  turnActions,
  whileBroken,
  type AdapterEvent,
  type Answer,
  type EventWorld,
  type HookEvent,
  type HookPayload,
  type HookResult,
  type Refused,
  type Shown,
} from "./domain.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORLD — what a check reaches through, and the only place flow runs anything
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** How much of a tool's output a check may be handed. Generous — a failing suite is verbose. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/**
 * Run one command the way a check means it — through a shell, in the repo, hermetically.
 *
 * `bash -lc` because the commands checks build are shell text, not argv: `just test && npx tsc`, a
 * heredoc writing dependency-cruiser's config, a pipeline. The old engine ran its tools the same
 * way, and the login shell is what makes a version manager's PATH available to a gate that git
 * spawned.
 *
 * A MISSING BINARY IS `{ code: 127 }`, NEVER A THROW, and the fail-loud proof stands on it: the
 * engine turns a non-zero exit into a block naming the entry and the command, so `just` not being
 * installed refuses the commit instead of passing it. bash answers 127 itself; the only case left
 * is bash being unspawnable, which is the same fact one level up and is answered the same way.
 */
export function runCommand(command: string, root: string): ExecResult {
  const result = spawnSync("bash", ["-lc", command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    // Git's hook variables would aim any nested `git` at the in-progress commit. See GIT_HOOK_ENV.
    env: hermeticEnv(process.env),
  });
  if (result.error) return { stdout: "", stderr: `flow could not run a command: ${result.error.message}`, code: 127 };
  // `status` is null when a signal killed the process. That is a failure, and 1 says so — the one
  // code that must never be invented is 0.
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1 };
}

/** A repo-relative path, made absolute. Every path a check sees is relative; disk is not. */
function inRepo(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** A file's text, or null when it is not there / not readable. */
export function readText(root: string, path: string): string | null {
  try {
    return readFileSync(inRepo(root, path), "utf8");
  } catch {
    return null;
  }
}

/** Lines of output that are paths — git's plainest answer shape, and the only one flow parses. */
function pathLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * THE WORLD a check reads through — the three capabilities, live.
 *
 * The whole promise of `.test()` cases rests on this object being interchangeable with the recorded
 * one a case drives: same three methods, same shapes, and the check cannot tell which it has. That
 * is also what F5's replay is: a third implementation of this interface, reading a fixture.
 *
 * git is asked in PATH LISTS and never in a status format. The old engine parsed
 * `git status --porcelain=v1` with a fixed-width slice and had a war story about eating the first
 * character of a path; the checks now ask questions whose answers are one path per line, so there
 * is no column to slice and no porcelain parser anywhere in flow.
 */
export function realWorld(root: string): World {
  return {
    exec: (command: string): Promise<ExecResult> => Promise.resolve(runCommand(command, root)),
    fs: {
      read: (path: string): Promise<string> => Promise.resolve(readText(root, path) ?? ""),
      exists: (path: string): Promise<boolean> => Promise.resolve(existsSync(inRepo(root, path))),
    },
    git: {
      diff: (path?: string): Promise<string> =>
        Promise.resolve(runCommand(path ? `git diff -- ${quoteArg(path)}` : "git diff", root).stdout),
      stagedFiles: (): Promise<string[]> =>
        Promise.resolve(pathLines(runCommand("git diff --cached --name-only --diff-filter=ACM", root).stdout)),
    },
  };
}

/**
 * The branch this checkout has out, read from its own `HEAD` — no subprocess, and none wanted.
 *
 * The marker is keyed on the branch because a worktree IS a branch: `git worktree add` refuses to
 * check the same one out twice, so two worktrees committing at once cannot clobber each other's
 * answer and mis-attribute a commit.
 *
 * A LINKED WORKTREE keeps its `.git` as a FILE naming the real gitdir, and that indirection is the
 * whole reason this is more than one read: resolve it, or every worktree reports the main
 * checkout's branch and the collision the naming scheme prevents comes straight back. Outside a git
 * repo there is one checkout and the bare marker name is correct.
 */
export function currentBranch(root: string): string | null {
  try {
    const dotgit = join(root, ".git");
    const gitdir = statSync(dotgit).isDirectory()
      ? dotgit
      : resolve(root, /gitdir:\s*(.+)/.exec(readFileSync(dotgit, "utf8"))?.[1]?.trim() ?? "");
    return branchFromHead(readFileSync(join(gitdir, "HEAD"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * WHO LAST WORKED IN THIS WORKTREE, and what they were wearing — the marker the write rail leaves,
 * read the one way.
 *
 * Both surfaces that ask outside a session ask it: the commit gate, deciding whether an
 * actor-scoped rule applies to a commit nobody is in the room for, and `flow status`, naming the
 * session a person is about to join. Asked twice in two places, the two could come to disagree about
 * who is here — and a rule that fires at the gate for a wearer status never showed is the exact
 * surprise the marker exists to prevent.
 *
 * `agent` is null when the marker is missing, stale or malformed, and then the wearer wears NOTHING
 * rather than a guess: there is no transcript and no sidecar out here, so the stored verdict is the
 * only truthful answer there can be.
 */
export function wearer(root: string): {
  readonly branch: string | null;
  readonly session: string;
  readonly agent: string | null;
  readonly wearing: readonly string[];
} {
  const branch = currentBranch(root);
  const { session, agent } = commitAttribution(root, branch);
  return { branch, session, agent, wearing: agent === null ? [] : (loadState(root, session, agent).categories ?? []) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONFIG — which repo this is, and what it has turned on
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The repo the session is standing in — the FOURTH question of §7.
 *
 * The hook's own cwd is not guaranteed to be the project: the host sets `CLAUDE_PROJECT_DIR` for
 * exactly this, and cwd is the fallback that keeps the git gate (spawned inside the repo) working.
 */
export function projectRoot(cwd: string): string {
  return process.env["CLAUDE_PROJECT_DIR"] || cwd;
}

/**
 * Teach this process to load the guarded repo's TypeScript itself — CALLED ONCE, before any config
 * is imported, and the reason flow works in a repo that is not `type: "module"`.
 *
 * `module.registerHooks` is node's synchronous, in-thread loader hook (node >= 22.15, and flow's
 * floor is 24). The load hook is handed a url and returns the source and the format to evaluate it
 * as, so `loadsAsStrippedModule` picks out the consumer's own `.ts` files and this hands node the
 * type-stripped text as `module`. The nearest `package.json` never gets a say, which is the whole
 * point: a config is written in `import` statements and a guard may not require a repo to change
 * its own module system to be guarded.
 *
 * WHY THE SOURCE IS READ HERE rather than asked of `nextLoad`: node decides the format BEFORE the
 * hook chain returns, and `nextLoad(url, { ...context, format: "module" })` is not a request to
 * strip — it hands the raw TypeScript to the ESM compiler, which dies on the first `interface`.
 * Measured on node v24.1.0 while this was written; the failure is a `SyntaxError: Unexpected strict
 * mode reserved word`, pointing at a line that is valid TypeScript.
 *
 * IDEMPOTENT because two registrations would strip every config twice, and because the binary has
 * more than one door onto a config file (`flow test` loads one by path, the live rails load the
 * repo's own).
 *
 * `stripTypeScriptTypes` in `strip` mode erases types and rewrites nothing, so a line number in a
 * stack trace is still the line in the file; `sourceUrl` is what keeps the file's own name on it.
 */
let hooked = false;
export function loadConsumerTypeScript(): void {
  if (hooked) return;
  hooked = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (!loadsAsStrippedModule(url)) return nextLoad(url, context);
      const source = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url }),
      };
    },
  });
}

/**
 * What this repo's config amounts to. Three outcomes, and they are three different facts.
 *
 * `none` is a repo that has never heard of flow, and it must be SILENT: the hooks are registered
 * once in the host's settings and fire in every repo the agent visits, so a missing config is the
 * ordinary case and blocking on it would make flow unusable the moment it was installed.
 *
 * `broken` is the opposite fact and gets the opposite answer: a config file that is THERE and will
 * not even import is a guard that cannot run, which is what fail-loud exists for. (A config that
 * imports and then will not load is the engine's own path — `load.ok === false` — and refuses with
 * the same shape from inside `guard`.)
 */
export type Regime =
  | { readonly kind: "none" }
  | { readonly kind: "loaded"; readonly config: FlowConfig; readonly load: LoadResult }
  | { readonly kind: "broken"; readonly message: string };

export async function loadRegime(root: string): Promise<Regime> {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { kind: "none" };
  try {
    const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
    const config = module.default as FlowConfig | undefined;
    if (!config || typeof config !== "object" || !Array.isArray(config.bindings))
      return {
        kind: "broken",
        message: `flow: ${CONFIG_FILE} has no default export from \`defineConfig([…])\` — that call IS the config, and its result is what flow reads.`,
      };
    return { kind: "loaded", config, load: loadConfig(config) };
  } catch (error) {
    // `configLoadFault`, not a sentence of its own: the same breakage reaches a person through
    // `flow test` and through a blocked hook, and a guard that describes it two ways is a guard
    // nobody learns to read. It is also where the node floor is named, once.
    return { kind: "broken", message: configLoadFault(CONFIG_FILE, (error as Error).message, process.versions.node) };
  }
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN — one payload, from stdin to an exit code
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Everything one hook run may need to know about the world — and every answer that costs something
 * is a FUNCTION, asked at most once.
 *
 * The transcript is why. It is a couple of megabytes on a working session and a hook fires on every
 * single tool call, so reading it eagerly would put a multi-megabyte read and parse in front of
 * every write the agent makes. Three answers come out of that one file and each rail needs a
 * different subset of them: the write rail needs none.
 */
interface Session {
  readonly root: string;
  readonly id: string;
  readonly agent: string;
  readonly branch: string | null;
  /** The transcript's own path, as the host named it. Empty when the payload carried none. */
  readonly transcriptPath: string;
  readonly transcript: () => string | null;
  readonly tokens: () => number;
  readonly turn: () => readonly TurnAction[];
}

/** Ask once, remember the answer. A hook is one short-lived process, so this lives and dies with it. */
function once<T>(answer: () => T): () => T {
  let held: { value: T } | null = null;
  return (): T => {
    held ??= { value: answer() };
    return held.value;
  };
}

/** What the payload says about this session, with the expensive answers left unasked. */
function sessionOf(payload: HookPayload, root: string): Session {
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  const transcript = once((): string | null => (transcriptPath === "" ? null : readText(root, transcriptPath)));
  return {
    root,
    id: typeof payload.session_id === "string" && payload.session_id !== "" ? payload.session_id : "unknown",
    agent: typeof payload.agent_id === "string" && payload.agent_id !== "" ? payload.agent_id : "main",
    branch: currentBranch(root),
    transcriptPath,
    transcript,
    tokens: once((): number => {
      const text = transcript();
      return text === null ? 0 : tokensFromTranscript(text);
    }),
    turn: once((): readonly TurnAction[] => {
      const text = transcript();
      return text === null ? [] : turnActions(text, root);
    }),
  };
}

/**
 * Who this session × agent is, read once and then remembered on disk.
 *
 * The sidecar is the answer when there is one, and the transcript's head is consulted only for the
 * generic buckets a recipe declares — that order is `spawnedAs`'s and is enforced there. What this
 * owes is the evidence, gathered from the two files the host wrote.
 *
 * NO CATEGORIES, NO QUESTION. A config that declares none has nobody to be, so the transcript is
 * never opened and no state file is written to remember an empty answer — which is the common case
 * in a repo whose rules are not actor-scoped, and it is the difference between a hook that reads
 * two megabytes per tool call and one that reads nothing.
 */
function identityOf(session: Session, payload: HookPayload, categories: readonly Category[]): Identity {
  if (categories.length === 0) return { wearing: [], faults: [], fresh: false };
  const sidecar = session.transcriptPath === "" ? null : sidecarPath(session.transcriptPath);
  const facts = sessionFactsFrom({
    payload,
    transcript: session.transcript(),
    sidecar: sidecar === null ? null : readText(session.root, sidecar),
  });
  return stickyIdentity(session.root, session.id, session.agent, facts, categories);
}

/** The world a payload is read against — disk, and the turn, asked only if the moment needs them. */
function eventWorld(root: string, session: Session): EventWorld {
  return { root, read: (path: string) => readText(root, path), turn: session.turn };
}

/** A note's prose: inline, or the repo file it named. The shell resolves it; a pure home cannot. */
function prose(root: string, notice: Notice): string {
  if (notice.text !== undefined) return notice.text;
  return notice.file === undefined ? "" : (readText(root, notice.file) ?? "");
}

/** How many things one event was about — what the log row means by `subjects`. */
function subjectCount(event: AdapterEvent): number {
  return event.rail === "guard" && event.moment === "commit" ? (event.staged?.length ?? 0) : 1;
}

/**
 * ONE payload, judged. The live half of the pipeline, in the order the pieces become knowable.
 *
 * The shape is deliberately flat rather than a hook function per event: the events differ in what
 * they CARRY (toEvent's job) and in how their answer is rendered (toResult's job), and the middle —
 * load, classify, run, log — is identical for all five. The old engine had five files here, and the
 * off switch, the session marker and the fault handling were each written out four or five times
 * with small differences nobody had chosen.
 */
export async function runHook(hook: HookEvent, payload: HookPayload, root: string): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return ALLOW;

  const off = isOff(root);
  const session = sessionOf(payload, root);

  // THE SESSION MARKER, written on every tool call: the commit gate is spawned by git, outside any
  // session, so this is the only way a later `git commit` can attribute its refusals to the chat
  // that caused them. Best-effort by construction — `writeMarker` answers a boolean.
  if (hook === "pre-tool-use" && !off && session.id !== "unknown")
    writeMarker(root, session.id, session.agent, session.branch);

  // THE CONFIG WILL NOT LOAD, either way it can fail to. `kind: "broken"` is a module that would
  // not import; a LoadResult carrying refusals is a module that imported and whose grammar was
  // refused. They were two branches with two behaviours until the F3 read found that only the first
  // reached the repair exception — so a deleted `.message(…)`, which is the break both the README
  // and the guidebook tell a reader to make, locked the agent out of its own repair. One sentence,
  // one answer, one place. They are asked in sequence only because the second needs the LoadResult
  // the first does not have; `outage` is the answer both of them give.
  const outage = (sentence: string): HookResult => {
    if (off) return ALLOW;
    // The config's TEXT, not its module: the module is the thing that will not load, and the
    // surface a repair may reach is whatever this config imports. Read once, here, and only here.
    const surface = configSurface(readText(root, CONFIG_FILE));
    const answer = whileBroken(toEvent(hook, payload, eventWorld(root, session)), surface, sentence);
    const result = toResult(hook, answer);
    // TURN-END IS TOLD RATHER THAN HELD. `whileBroken` says why; this is the only place that can
    // write it, because the Stop rail has no context channel and `toResult` speaks only the two the
    // host reads. Exit 0 — the turn ends, and the sentence goes where a human and the log see it.
    return answer.told === null || result.exitCode !== 0 ? result : { ...result, stderr: `${answer.told}\n` };
  };
  if (regime.kind === "broken") return outage(regime.message);

  const { load, config } = regime;
  if (!load.ok) return outage(refusalText(load.refusals));

  const entries = load.entries;
  const identity = identityOf(session, payload, categoriesIn(entries));

  const events = toEvent(hook, payload, eventWorld(root, session));
  const rows: Row[] = [];

  // The flight recorder goes FIRST, so the tool row precedes the guardrail rows about the same call
  // and the stream reads in the order things happened.
  if (hook === "pre-tool-use" && !off) {
    const row = toolRow(payload, root);
    if (row) rows.push(row);
  }

  // RECORDING is a second, independent stream and it is deliberately not gated on `off`: turning
  // the guard off to reproduce something and finding the recorder off with it is the one moment
  // this seam exists for. It is gated on the switch alone, and on nothing else.
  const steps: RecordedStep[] = [];
  const taping = isRecording(root);

  const answer = await judge({ events, session, load, settings: config.settings, identity, off, hook, payload, rows, steps: taping ? steps : null });
  if (!off) appendRows({ root, session: session.id, branch: session.branch }, rows);
  if (taping) appendSteps(root, session.id, steps);
  return toResult(hook, answer);
}

/** The middle of the run: every event through the engine, and the rows that record what happened. */
async function judge(args: {
  readonly events: readonly AdapterEvent[];
  readonly session: Session;
  readonly load: LoadResult;
  readonly settings: Settings;
  readonly identity: Identity;
  readonly off: boolean;
  readonly hook: HookEvent;
  readonly payload: HookPayload;
  readonly rows: Row[];
  /** Where the replayable steps go, or null when this repo is not recording. */
  readonly steps: RecordedStep[] | null;
}): Promise<Answer> {
  const { events, session, load, settings, identity, off, hook, payload, rows, steps } = args;
  const blocked: Refused[] = [];
  const shown: Shown[] = [];
  const world = realWorld(session.root);

  // A COMPACTION is the boundary where the agent stops knowing what it was told, so every area note
  // has to be earned again. The host announces it on the session rail (`source: "compact"`), which
  // is why flow registers no compaction hook of its own — a second registration on one moment is
  // the duplicate the hook grammar exists to prevent.
  const compacted = hook === "session-start" && payload.source === "compact";
  // READ AFTER the identity was settled, deliberately: `stickyIdentity` writes the classification
  // into this same file, and the save at the end of this function carries `stored` forward whole. A
  // read taken before it would write the categories back out of existence on the next breadcrumb.
  const stored = loadState(session.root, session.id, session.agent);
  let marks: Marks = compacted && load.ok ? afterCompaction(stored.marks, load.entries) : stored.marks;
  if (compacted && !off) rows.push({ kind: "compaction" });
  if (compacted) steps?.push({ rail: "compaction" });

  for (const event of events) {
    if (event.rail === "guard") {
      // The recorder wraps the world rather than replacing it: what a check reached for is kept as
      // it was answered AT THAT INSTANT — the file's bytes then, the command's real exit code —
      // because re-deriving it tomorrow answers differently, and a recording that cannot reproduce
      // yesterday's block is not a recording.
      const tape = steps === null ? null : recorder(world);
      const outcome = await guard({
        load,
        event: {
          moment: event.moment,
          file: event.file,
          command: event.command,
          staged: event.staged,
          turn: event.turn,
          wearing: identity.wearing,
        },
        world: tape?.world ?? world,
        faults: identity.faults,
        off,
      });
      steps?.push({
        rail: "guard",
        moment: event.moment,
        ...(event.file === undefined ? {} : { file: event.file }),
        ...(event.command === undefined ? {} : { command: event.command }),
        ...(event.staged === undefined ? {} : { staged: event.staged }),
        ...(event.turn === undefined ? {} : { turn: event.turn }),
        wearing: identity.wearing,
        world: tape?.taken() ?? {},
      });
      for (const effect of outcome.effects)
        if (effect.do === "block") blocked.push({ moment: event.moment, block: effect });
      if (!off) rows.push(...runRows(event.moment, outcome, subjectCount(event)));
      continue;
    }

    steps?.push({
      rail: "brief",
      moment: event.moment,
      ...(event.path === undefined ? {} : { path: event.path }),
      wearing: identity.wearing,
      tokens: session.tokens(),
    });
    const briefing = brief({
      load,
      event: { moment: event.moment, path: event.path, wearing: identity.wearing, tokens: session.tokens() },
      marks,
      settings,
      off,
    });
    const notices: Notice[] = [];
    const unshown: string[] = [];
    for (const notice of briefing.notices) {
      const body = prose(session.root, notice);
      if (body.trim() === "") {
        // A note whose prose could not be resolved was never shown, so it must not be MARKED shown —
        // that would silence it for the rest of the session and hide the broken `file:` completely.
        if (notice.entry !== null) unshown.push(notice.entry);
        continue;
      }
      notices.push(notice);
      shown.push({ entry: notice.entry, cause: notice.cause, body });
    }
    marks = marksWithout(briefing.marks, marks, unshown);
    // A note that SHOWED is a row; a touch where nothing showed is not. The `tool` row already
    // records that the call happened, and a run row per touch with no tallies in it would double
    // the log to say the same thing twice.
    if (!off && notices.length > 0)
      rows.push(...runRows(event.moment, { effects: notices, tallies: [] } satisfies Outcome, 1));
  }

  if (!off && marks !== stored.marks) saveState(session.root, session.id, session.agent, { ...stored, marks });
  return { refused: blocked, shown };
}

/** The marks the briefing produced, with the notes that could not be shown put back as they were. */
function marksWithout(briefed: Marks, before: Marks, unshown: readonly string[]): Marks {
  if (unshown.length === 0) return briefed;
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(briefed)) if (!unshown.includes(id)) out[id] = at;
  for (const id of unshown) {
    const was = before[id];
    if (was !== undefined) out[id] = was;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMIT GATE — the moment no harness delivers
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Every `at(commit)` guardrail over the staged set — the half of the promise the PreToolUse rail
 * cannot make.
 *
 * It fires with no agent in the room: a human commit, a merge, CI. That is why it is a verb of the
 * binary rather than a hook, why it is in `DELIVERS` even though the harness supplies nothing here,
 * and why every harness gets the gates for free.
 *
 * WHO IT IS comes from the marker the PreToolUse rail left — session AND agent — so a commit's rows
 * land in the session that caused them and an actor-scoped rule fires at this moment as honestly as
 * at any other. The classification itself is never re-derived here: there is no transcript and no
 * sidecar outside a session, so the STORED verdict is the only truthful answer, and a fresh commit
 * on a stale or absent marker wears nothing rather than wearing a guess.
 */
export async function runCommit(root: string, files: readonly string[]): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return ALLOW;
  if (isOff(root)) return ALLOW;
  // THE GATE USES THE ENGINE'S OWN FAULT, not `whileBroken` next door, and the difference is the
  // point rather than an oversight: `whileBroken` exists to carve out the repair and to let a turn
  // end, and the commit moment has neither. Nothing written under the repair exception may reach a
  // commit until the config loads green, so this rail stays fully shut however the config broke —
  // the import fault here, and a load refusal through `guard()`'s own `!load.ok` branch below.
  if (regime.kind === "broken") return refused([{ moment: "commit", block: fault(regime.message) }]) ?? ALLOW;
  if (files.length === 0) return ALLOW;

  const { branch, session, wearing } = wearer(root);
  const { load } = regime;
  // The gate is where the expensive checks live — a suite, a type-check, a whole dependency
  // cruise — so it is also where a recording is worth the most: replaying a refused commit is the
  // one thing you cannot do by re-running it, because the working tree has moved on since.
  const tape = isRecording(root) ? recorder(realWorld(root)) : null;
  const outcome = await guard({
    load,
    event: { moment: "commit", staged: files, wearing },
    world: tape?.world ?? realWorld(root),
    off: false,
  });
  if (tape !== null)
    appendSteps(root, session, [{ rail: "guard", moment: "commit", staged: files, wearing, world: tape.taken() }]);
  appendRows({ root, session, branch }, runRows("commit", outcome, files.length));

  const blocks: Refused[] = outcome.effects
    .filter((effect): effect is Block => effect.do === "block")
    .map((block) => ({ moment: "commit", block }));
  return refused(blocks) ?? ALLOW;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STDIN — the first question of §7, and the one the old engine got wrong quietly
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What came in on stdin: a payload, or which of the two ways reading it failed. */
export type PayloadRead =
  | { readonly ok: true; readonly payload: HookPayload }
  | { readonly ok: false; readonly why: "unreadable" | "unparseable"; readonly detail: string };

/**
 * Read the payload, and REPORT which of three things happened.
 *
 * This used to return a payload and swallow every failure into `{}`, on the reasoning that every
 * hook answers safely from nothing. That is right for a hook handed nothing and wrong for one that
 * could not SEE what it was handed: a PreToolUse rail holding an empty payload has no tool call to
 * judge, so it allows — and the guard could not tell "there was nothing to guard" from "I could not
 * read what I was guarding", and let the tool call through either way.
 *
 * Throwing instead does NOT fix it, and that is the trap worth stating: the caller's outer catch
 * allows too. The read has to report, and each event has to answer in the way that suits it.
 */
export function readPayload(): PayloadRead {
  // HAND-RUN: a person typing `flow hook stop` has no payload and must not block on stdin forever.
  if (process.stdin.isTTY) return { ok: true, payload: {} };
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch (error) {
    // The errno is the actionable half, and only the errno: a raw error string can carry a
    // stack-shaped prefix, and this text goes in front of the model.
    return { ok: false, why: "unreadable", detail: (error as NodeJS.ErrnoException).code ?? "unknown error" };
  }
  // GENUINELY EMPTY — the host sent nothing, or stdin was /dev/null. Safe, and the only one of the
  // three that keeps the old behaviour.
  if (raw.trim() === "") return { ok: true, payload: {} };
  let held: unknown;
  try {
    held = JSON.parse(raw);
  } catch {
    return { ok: false, why: "unparseable", detail: `${raw.length} bytes on stdin, and not JSON` };
  }
  if (!held || typeof held !== "object" || Array.isArray(held)) {
    const what = held === null ? "null" : Array.isArray(held) ? "an array" : typeof held;
    return { ok: false, why: "unparseable", detail: `JSON, but ${what} — a payload is an object` };
  }
  return { ok: true, payload: held as HookPayload };
}

/**
 * A hook, end to end: read stdin, run it, and answer the way THIS event must when the read failed.
 *
 * `pre-tool-use` is the rail that GUARDS, so it fails CLOSED — a payload it cannot read is a tool
 * call it cannot judge, and "I could not look" must never be spelled the same way as "I looked and
 * it was fine". The other four annotate, and breaking a session over a hook that only adds a
 * breadcrumb would be the cure killing the patient — so they SPEAK on stderr and allow, because
 * silence is precisely what let the old swallow go unnoticed.
 *
 * Everything is wrapped: a hook that throws is a hook that wedges a session, and an unknown event
 * is silence rather than a usage message in front of the model.
 */
export async function hookEntry(event: string, cwd: string): Promise<HookResult> {
  try {
    if (!isHookEvent(event)) return ALLOW;
    const read = readPayload();
    if (!read.ok) {
      const text = faultText(event, read.why, read.detail);
      return event === "pre-tool-use"
        ? { stdout: "", stderr: `\n${text}\n`, exitCode: 2 }
        : { stdout: "", stderr: `${text}\n`, exitCode: 0 };
    }
    return await runHook(event, read.payload, projectRoot(cwd));
  } catch (error) {
    // The guard broke in a way nothing above predicted. It is still not allowed to wedge the
    // session, so it says so and allows — the same answer the annotating rails give a fault.
    return { stdout: "", stderr: `[flow hook ${event}] the guard itself failed — ${(error as Error).message}\n`, exitCode: 0 };
  }
}

/** The git gate, end to end. Paths arrive repo-relative from git; a stray absolute one is folded. */
export async function commitEntry(files: readonly string[], cwd: string): Promise<HookResult> {
  const root = resolve(cwd);
  return runCommit(
    root,
    files.map((file) => relativise(file, root)),
  );
}
