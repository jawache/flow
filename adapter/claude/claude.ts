// flow/adapter/claude/claude.ts — the Claude Code adapter's SHELL: the live side of Claude Code, wired.
//
// Everything it acts on was decided somewhere else. The dialect is next door in domain.ts (a
// payload's meaning, a transcript's meaning, what a refusal looks like); the judgement is the
// engine's (`guard`, `brief`); the rules are the config's. This file opens files, runs commands,
// asks git what it knows, and hands the answers over. It makes no decisions a reader has to reason
// about.
//
// It is the one file that hands the rest of flow a `Harness` (../harness.ts), as `claudeCode`: flow.ts
// chooses it, and nothing else outside this folder imports it.
//
// THE LIVE SURFACE:
//
//   runHook(event)   one of the hook events flow answers — stdin in, a HookResult out
//   hookEntry(event) a hook end to end: read stdin, run it, answer the way the event must
//
// THE GUARD fails LOUD and THE TELEMETRY fails SAFE, as in shell.ts, which holds the git gate and
// the world a check reaches through.

import { spawnSync } from "node:child_process";
import { existsSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isatty } from "node:tty";
import { basename, dirname, join } from "node:path";
import { type Category, refusalText, type LoadResult, type Settings, type TurnAction } from "../../language/domain.ts";
import { afterCompaction, brief, categoriesIn, guard, recorder, runRows, type AgentOf, type Identity, type Marks, type Notice, type Outcome, type RecordedStep, type Row, type SessionState } from "../../engine/domain.ts";
import { appendRows, appendSteps, isOff, isRecording, loadState, saveState, stickyIdentity, writeMarker } from "../../engine/state.ts";
import { ALLOW, hermeticEnv, type AdapterEvent, type Refused } from "../domain.ts";
import { agentOf, agentSettingOf, awaitsBrief, holdsForBrief, isHookEvent, nothingBound, outsideOf, ownTranscriptPath, reachesAnotherWorktree, readFault, ridesRefusal, sessionFactsFrom, shellReadRows, toEvent, toResult, tokensFromTranscript, toolRow, turnActions, type Answer, type EventWorld, type HookEvent, type HookPayload, type Shown, untoldWorktrees, whileBroken, workedPaths, worktreeFolders } from "./domain.ts";
import type { Harness, HookResult } from "../harness.ts";
import { DELIVERS, HOOK_COSTS, HOOK_EVENTS, HOOK_REGISTRATIONS, HOST_SURFACE, REPO_SETTINGS, bareRegistrations, listsFlow, machineDiffers, parseEvents, registeredEvents, settingsFileFor, spawnMeta, spawnsIn, staleRegistrations, steerOf, transcriptHead, withMachineCommandsUpToDate, withRegistrations, withoutRegistrations } from "./domain.ts";
import { configRoot, readStore, readTranscript } from "./store.ts";
import { currentBranch, loadRegime, readText, realWorld } from "../shell.ts";


// ════════════════════════════════════════════════════════════════════════════════════════════════
// GIT — one command, run directly
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** How much output one git command may carry. */
const MAX_OUTPUT = 256 * 1024 * 1024;

/** One git command, run DIRECTLY — no shell, so no login profile on a path that runs every call. */
function runGit(root: string, args: readonly string[]): { readonly ok: boolean; readonly stdout: Buffer; readonly stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    maxBuffer: MAX_OUTPUT,
    // Git's hook variables are stripped (see GIT_HOOK_ENV), so a call made inside a commit hook
    // never aims at the commit's own index.
    env: hermeticEnv(process.env),
  });
  if (result.error) return { ok: false, stdout: Buffer.alloc(0), stderr: result.error.message };
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr.toString("utf8").trim() };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ANOTHER WORKTREE — the folders git lists for this repository, read only when a call leaves root
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A path with its links resolved, as far as it exists on disk, and the rest as named. git lists a
 * worktree by its real path, and a temp folder on macOS is reached through a link (`/var` is
 * `/private/var`), so both sides are made real before they are compared.
 */
export function realPath(path: string): string {
  const tail: string[] = [];
  let head = path;
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const up = dirname(head);
      if (up === head) return path;
      tail.unshift(basename(head));
      head = up;
    }
  }
}

/**
 * Every working folder of the guarded folder's repository, as `git worktree list` lists them, made
 * real. None when git cannot say, such as outside a repository: then no path is in a worktree, and
 * nothing is told. The caller asks only for a call that may reach another worktree
 * (`reachesAnotherWorktree`), so an ordinary call never pays for this git call.
 */
function repoWorktrees(root: string): string[] {
  const listed = runGit(root, ["worktree", "list", "--porcelain"]);
  return listed.ok ? worktreeFolders(listed.stdout.toString("utf8")).map(realPath) : [];
}

/** Does this folder hold a `.git`, file or folder: the mark of a repository's own working folder? */
function holdsGit(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

/**
 * Does git name the guarded folder's repository for this folder? Asked of the nearest folder that
 * exists, since a command may run in one it is about to make. A folder git does not know is not.
 * Each answer, and the guarded folder's own, is asked once per hook.
 */
function sameRepository(root: string): (folder: string) => boolean {
  const common = (dir: string): string | null => {
    let at = dir;
    while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
    const asked = runGit(at, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return asked.ok ? realPath(asked.stdout.toString("utf8").trim()) : null;
  };
  let own: string | null | undefined;
  const answers = new Map<string, boolean>();
  return (folder) => {
    own ??= common(root);
    const known = answers.get(folder);
    if (known !== undefined) return known;
    const answer = own !== null && common(folder) === own;
    answers.set(folder, answer);
    return answer;
  };
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
 * different subset of them: the command rail needs none.
 */
interface Session {
  readonly root: string;
  readonly id: string;
  /** Which agent the call came from, and its type when the host said. */
  readonly who: AgentOf;
  readonly branch: string | null;
  /** This agent's own transcript: a subagent's own, never its parent's. */
  readonly transcript: () => string | null;
  readonly tokens: () => number;
  readonly turn: () => readonly TurnAction[];
  /** The agent the session itself runs as, from the parent's transcript; null when it runs as none. */
  readonly sessionAgent: () => string | null;
}

/** Is this a tool call's own hook: before it runs, or after it? */
function isCall(hook: HookEvent): boolean {
  return hook === "pre-tool-use" || hook === "post-tool-use";
}

/** Ask once, remember the answer. A hook is one short-lived process, so this lives and dies with it. */
function once<T>(answer: () => T): () => T {
  let held: { value: T } | null = null;
  return (): T => {
    held ??= { value: answer() };
    return held.value;
  };
}

/**
 * What the payload says about this session, with the expensive answers left unasked.
 *
 * A subagent's call carries its PARENT's `transcript_path`, so the transcript this agent's brief,
 * tokens and turn are read from is the subagent's own one under it, found by its `agent_id`.
 */
function sessionOf(payload: HookPayload, root: string): Session {
  const path = ownTranscriptPath(payload);
  const transcript = once((): string | null => (path === null ? null : readText(root, path)));
  return {
    root,
    id: typeof payload.session_id === "string" && payload.session_id !== "" ? payload.session_id : "unknown",
    who: agentOf(payload),
    branch: currentBranch(root),
    transcript,
    tokens: once((): number => {
      const text = transcript();
      return text === null ? 0 : tokensFromTranscript(text);
    }),
    turn: once((): readonly TurnAction[] => {
      const text = transcript();
      return text === null ? [] : turnActions(text, root);
    }),
    // The PARENT's transcript, `transcript_path` as sent: the session's own agent is its record.
    sessionAgent: once((): string | null => {
      const sent = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
      const text = sent === "" ? null : readText(root, sent);
      return text === null ? null : agentSettingOf(text);
    }),
  };
}

/**
 * Who this session × agent is, read once and then remembered on disk.
 *
 * The agent type in the hook message is the answer when there is one, and the transcript's head is
 * consulted only for the generic buckets a recipe declares — that order is `spawnedAs`'s and is
 * enforced there. What this owes is the evidence: the message, and this agent's own transcript.
 *
 * NO CATEGORIES, NO QUESTION. A config that declares none has nobody to be, so the transcript is
 * never opened and no state file is written to remember an empty answer — which is the common case
 * in a repo whose rules are not actor-scoped, and it is the difference between a hook that reads
 * two megabytes per tool call and one that reads nothing.
 *
 * A subagent starting before its brief can be read (`briefPending`) is classified without it, and
 * that reading is not remembered: its first tool call reads the brief and settles who it is.
 */
function identityOf(session: Session, payload: HookPayload, categories: readonly Category[], briefPending: boolean): Identity {
  if (categories.length === 0) return { wearing: [], faults: [], fresh: false };
  const facts = sessionFactsFrom({ payload, transcript: session.transcript() });
  return stickyIdentity(session.root, session.id, session.who.agent, facts, categories, !briefPending);
}

/**
 * The other worktrees of the repository this call worked in that this session and agent has not
 * been told about, now remembered as told; null when there are none. The paths are the file an edit
 * tool wrote, or the folders a shell command ran in (`workedPaths`). git is asked only when one of
 * them may be in another worktree.
 */
function worktreesToTell(session: Session, payload: HookPayload): { root: string; worktrees: string[] } | null {
  const root = realPath(session.root);
  // Each folder once: a command can return to one with `cd -`, and two names can be one folder.
  const paths = [...new Set([...new Set(workedPaths(payload, session.root, homedir()))].map(realPath))];
  if (!reachesAnotherWorktree(paths, root, holdsGit)) return null;
  const stored = loadState(session.root, session.id, session.who.agent);
  const told = stored.worktrees ?? [];
  const worktrees = untoldWorktrees({ paths, root, worktrees: repoWorktrees(session.root), told });
  if (worktrees.length === 0) return null;
  saveState(session.root, session.id, session.who.agent, { ...stored, worktrees: [...told, ...worktrees] });
  return { root, worktrees };
}

/** The world a payload is read against — disk, and the turn, asked only if the moment needs them. */
function eventWorld(root: string, session: Session, heldForBrief?: boolean): EventWorld {
  return {
    root,
    read: (path: string) => readText(root, path),
    turn: session.turn,
    sessionAgent: session.sessionAgent,
    home: homedir(),
    heldForBrief,
  };
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
 * load, classify, run, log — is identical for all of them. The old engine had five files here, and the
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
  if (isCall(hook) && !off && session.id !== "unknown") writeMarker(root, session.id, session.who, session.branch);

  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
  const afterCall = hook === "post-tool-use" && !off && tool !== "";

  // THE CONFIG WILL NOT LOAD. `kind: "broken"` is a module that would not import; a LoadResult
  // carrying refusals is a module that imported and whose grammar was refused. Both are the same
  // fact, "flow is off", and get the same answer: `whileBroken` refuses nothing and hands the agent
  // the load error. They are asked in sequence only because the second needs the LoadResult the
  // first does not have.
  const outage = (sentence: string): HookResult => {
    if (off) return ALLOW;
    // A tool other than Bash is first seen after it ran, so that is where the agent is told.
    const events = toEvent(hook, payload, eventWorld(root, session));
    const seen: AdapterEvent[] = afterCall && tool !== "Bash" ? [{ rail: "brief", moment: "session" }, ...events] : events;
    const answer = whileBroken(seen, sentence);
    const result = toResult(hook, answer);
    // TURN-END IS TOLD RATHER THAN HELD. `whileBroken` says why; this is the only place that can
    // write it, because a note on the hand-back rails would keep the agent working, and `toResult`
    // speaks only the two the host reads. Exit 0 — the turn ends, and the sentence goes where a
    // human and the log see it.
    return answer.told === null ? result : { ...result, stderr: `${answer.told}\n` };
  };
  if (regime.kind === "broken") return outage(regime.message);

  const { load, config } = regime;
  if (!load.ok) return outage(refusalText(load.refusals));
  // RECORDING is a second, independent stream and it is deliberately not gated on `off`: turning
  // the guard off to reproduce something and finding the recorder off with it is the one moment
  // this seam exists for. It is gated on the switch alone, and on nothing else.
  const taping = isRecording(root);
  // NOTHING BOUND HERE, NOTHING READ: a hand-back with no turn-end entry to run is answered before
  // either transcript is opened, unless it is being recorded.
  if (nothingBound(hook, load.entries, taping)) return ALLOW;

  const entries = load.entries;
  // A SUBAGENT STARTING BEFORE ITS BRIEF IS WRITTEN: who it is is read without remembering it, and
  // its notes bound to a category wait for its first tool call. Asked once, for both.
  const briefPending = awaitsBrief(hook, session.transcript());
  const identity = identityOf(session, payload, categoriesIn(entries), briefPending);
  // ANOTHER WORKTREE, after the call: the agent is told once that flow does not guard it. Asked
  // before the state is read, which `judge` saves again with its marks.
  const unguarded = afterCall ? worktreesToTell(session, payload) : null;
  // READ AFTER the identity was settled, deliberately: `stickyIdentity` writes the classification
  // into this same file, and `judge` saves `stored` forward whole. A read taken before it would
  // write the categories back out of existence on the next breadcrumb.
  const stored = loadState(root, session.id, session.who.agent);

  const events = toEvent(hook, payload, eventWorld(root, session, stored.heldForBrief === true));
  const rows: Row[] = [];

  // The flight recorder goes FIRST, so the tool row precedes the guardrail rows about the same call
  // and the stream reads in the order things happened. A shell command is recorded before it runs,
  // because one the guard refuses never reaches PostToolUse; every other call is recorded after.
  if (isCall(hook) && !off && (hook === "pre-tool-use") === (tool === "Bash")) {
    const row = toolRow(payload, root);
    if (row) rows.push(row);
    if (hook === "pre-tool-use") rows.push(...shellReadRows(payload, root, homedir()));
  }

  const steps: RecordedStep[] = [];

  const answer = await judge({ events, session, stored, load, settings: config.settings, identity, briefPending, off, hook, payload, rows, steps: taping ? steps : null });
  if (!off) appendRows({ root, session: session.id, branch: session.branch, who: session.who }, rows);
  if (taping) appendSteps(root, session.id, steps);
  return toResult(hook, unguarded === null ? answer : { ...answer, unguarded });
}

/** The middle of the run: every event through the engine, and the rows that record what happened. */
async function judge(args: {
  readonly events: readonly AdapterEvent[];
  readonly session: Session;
  /** This session × agent's state, as it stood once the identity was settled. */
  readonly stored: SessionState;
  readonly load: LoadResult;
  readonly settings: Settings;
  readonly identity: Identity;
  /** A subagent starting before its brief can be read (`awaitsBrief`). */
  readonly briefPending: boolean;
  readonly off: boolean;
  readonly hook: HookEvent;
  readonly payload: HookPayload;
  readonly rows: Row[];
  /** Where the replayable steps go, or null when this repo is not recording. */
  readonly steps: RecordedStep[] | null;
}): Promise<Answer> {
  const { events, session, stored, load, settings, identity, briefPending, off, hook, payload, rows, steps } = args;
  const blocked: Refused[] = [];
  const shown: Shown[] = [];
  const world = realWorld(session.root);
  const inRepository = sameRepository(session.root);

  // A COMPACTION is the boundary where the agent stops knowing what it was told, so every area note
  // has to be earned again. The host announces it on the session rail (`source: "compact"`), which
  // is why flow registers no compaction hook of its own — a second registration on one moment is
  // the duplicate the hook grammar exists to prevent.
  const compacted = hook === "session-start" && payload.source === "compact";
  // THE NOTES HELD FOR THE BRIEF: held by a subagent's start that judged them without it, and let
  // go by the first call that judges them again. A refused call judges none, so they stay held.
  let held = stored.heldForBrief === true;
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
      const outside = outsideOf(event, session.root, holdsGit, inRepository);
      const outcome = await guard({
        load,
        event: {
          moment: event.moment,
          command: event.command,
          commands: event.commands,
          staged: event.staged,
          turn: event.turn,
          wearing: identity.wearing,
          outside,
        },
        world: tape?.world ?? world,
        faults: identity.faults,
        off,
      });
      steps?.push({
        rail: "guard",
        moment: event.moment,
        ...(event.command === undefined ? {} : { command: event.command }),
        ...(event.staged === undefined ? {} : { staged: event.staged }),
        ...(event.turn === undefined ? {} : { turn: event.turn }),
        // Where the line started rides with the answer, so a replay parses it to the same folders.
        ...(outside.length === 0 ? {} : { outside, ...(event.start === undefined ? {} : { start: event.start }) }),
        wearing: identity.wearing,
        world: tape?.taken() ?? {},
      });
      for (const effect of outcome.effects)
        if (effect.do === "block")
          blocked.push({ moment: event.moment, block: effect });
      if (!off) rows.push(...runRows(event.moment, outcome, subjectCount(event)));
      continue;
    }

    // A REFUSED CALL CARRIES NO NOTES, and this is the one place it is kept from them: a note is not
    // judged for it, so `toResult` is handed none, and nothing is marked shown to stay silent until
    // drift. A blocked `cat` whose file is next read by the retried command then briefs on the
    // retry, which is the call that runs. A held TURN is the exception: its note is judged, and
    // `toResult` passes it to the agent with the refusal.
    if (blocked.length > 0 && !ridesRefusal(event.moment)) continue;
    if (event.moment === "session") held = briefPending && load.ok && holdsForBrief(load.entries);
    const outside = outsideOf(event, session.root, holdsGit, inRepository);
    steps?.push({
      rail: "brief",
      moment: event.moment,
      ...(event.path === undefined ? {} : { path: event.path }),
      ...(event.command === undefined ? {} : { command: event.command }),
      ...(outside.length === 0 ? {} : { outside }),
      wearing: identity.wearing,
      tokens: session.tokens(),
    });
    const briefing = brief({
      load,
      event: {
        moment: event.moment,
        path: event.path,
        command: event.command,
        wearing: identity.wearing,
        tokens: session.tokens(),
        outside,
      },
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

  if (!off && (marks !== stored.marks || held !== (stored.heldForBrief === true)))
    saveState(session.root, session.id, session.who.agent, { ...stored, marks, heldForBrief: held ? true : undefined });
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
// STDIN — the first question of §7, and the one the old engine got wrong quietly
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What came in on stdin: a payload, or which of the two ways reading it failed. */
export type PayloadRead =
  | { readonly ok: true; readonly payload: HookPayload }
  | { readonly ok: false; readonly why: "unreadable" | "unparseable"; readonly detail: string };

/** What `readStdin` sleeps on between tries: nothing ever wakes it, so each wait runs its full timeout. */
const NAP = new Int32Array(new SharedArrayBuffer(4));

/** How long one EAGAIN waits before the next try: the host's next write is usually milliseconds away. */
const STDIN_NAP_MS = 5;

/**
 * Every byte on fd 0, to the end of the stream.
 *
 * `readFileSync(0)` gives up the first time a NON-BLOCKING stdin is empty, with EAGAIN, and empty
 * there means "the host has not written the next piece yet", not "there is no more". A payload far
 * larger than a pipe's buffer arrives in pieces, so it is exactly the payload that read loses (#12).
 * This one waits for the next piece instead, and the thread SLEEPS between tries rather than
 * spinning. Every other error is thrown, for `readPayload` to report.
 */
function readStdin(): string {
  const pieces: Buffer[] = [];
  const piece = Buffer.alloc(64 * 1024);
  for (;;) {
    let got: number;
    try {
      got = readSync(0, piece, 0, piece.length, null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(NAP, 0, 0, STDIN_NAP_MS);
      continue;
    }
    if (got === 0) return Buffer.concat(pieces).toString("utf8");
    pieces.push(Buffer.from(piece.subarray(0, got)));
  }
}

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
function readPayload(): PayloadRead {
  // HAND-RUN: a person typing `flow hook stop` has no payload and must not block on stdin forever.
  // Asked of fd 0 itself, never of `process.stdin`: merely reading that property opens a stream on
  // fd 0 and the stream makes it NON-BLOCKING (#12). `isatty(0)` leaves fd 0 blocking, so on an
  // ordinary pipe the read below never meets EAGAIN and its wait loop is not needed.
  if (isatty(0)) return { ok: true, payload: {} };
  let raw: string;
  try {
    raw = readStdin();
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
 * it was fine". The after-call rails JUDGE too — every change a call made reaches the rules there —
 * so a payload they cannot read is a call whose changes nobody judged, and they report it with exit
 * 2, which on those rails reaches the model beside the result and blocks nothing. The rest only add
 * a breadcrumb, and breaking a session over one would be the cure killing the patient, so they SPEAK
 * on stderr and allow. `readFault` next door is where that split is decided.
 *
 * Everything is wrapped: a hook that throws is a hook that wedges a session, and an unknown event
 * is silence rather than a usage message in front of the model.
 */
async function hookEntry(event: string, cwd: string): Promise<HookResult> {
  try {
    if (!isHookEvent(event)) return ALLOW;
    const read = readPayload();
    if (!read.ok) {
      return readFault(event, read.why, read.detail);
    }
    return await runHook(event, read.payload, projectRoot(cwd));
  } catch (error) {
    // The guard broke in a way nothing above predicted. It is still not allowed to wedge the
    // session, so it says so and allows — the same answer the annotating rails give a fault.
    return { stdout: "", stderr: `[flow hook ${event}] the guard itself failed — ${(error as Error).message}\n`, exitCode: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HARNESS — Claude Code, as the rest of flow sees it
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The host's machine-wide settings file. `CLAUDE_CONFIG_DIR` is the host's own documented override,
 * honoured here rather than hard-coding a home, because it is also the seam that lets `flow init` be
 * driven over a throwaway directory instead of somebody's real setup.
 */
function machineSettingsPath(): string {
  return join(configRoot(), "settings.json");
}

/** Claude Code. The one value flow.ts chooses, and what the rest of flow is handed in its place. */
export const claudeCode: Harness = {
  name: "Claude Code",
  events: HOOK_EVENTS,
  delivers: DELIVERS,
  run: hookEntry,
  machineSettingsPath,
  registering: {
    repoFile: REPO_SETTINGS,
    hostSurface: HOST_SURFACE,
    hooks: HOOK_COSTS,
    registrations: HOOK_REGISTRATIONS,
    settingsFileFor,
    listsFlow,
    registeredEvents,
    staleRegistrations,
    bareRegistrations,
    machineDiffers,
    withRegistrations,
    withoutRegistrations,
    withMachineCommandsUpToDate,
  },
  transcripts: {
    readStore,
    readTranscript,
    events: parseEvents,
    head: transcriptHead,
    spawns: spawnsIn,
    spawnMeta,
    steer: steerOf,
  },
};
