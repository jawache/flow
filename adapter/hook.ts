// flow/adapter/hook.ts — THE HOOK RUN: one payload from a harness, from stdin to an exit code.
//
// What every harness shares. A harness is handed in as a `Harness` (harness.ts): it says which
// payloads are its own, where its repo is, and how its transcript reads. The judgement is the
// engine's (`guard`, `brief`); the meaning of a payload and the shape of an answer are in domain.ts;
// the rules are the config's. This file opens files, runs commands, asks git what it knows, and
// hands the answers over. It makes no decisions a reader has to reason about, and it names no
// harness.
//
// THE LIVE SURFACE:
//
//   runHook(harness, event, payload)   one of the hook events flow answers — a payload in, a HookResult out
//   hookEntry(harnesses, event, cwd)   a hook end to end: read stdin, find the harness, run it, answer the way the event must
//
// THE GUARD fails LOUD and THE TELEMETRY fails SAFE, as in shell.ts, which holds the git gate and
// the world a check reaches through.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isatty } from "node:tty";
import { basename, dirname, join, posix } from "node:path";
import { type Category, refusalText, type LoadResult, type Settings, type TurnAction } from "../language/domain.ts";
import { afterCompaction, brief, categoriesIn, DELETED, guard, recorder, runRows, type AgentOf, type Identity, type Marks, type Notice, type Outcome, type RecordedStep, type Row, type Tree } from "../engine/domain.ts";
import { appendRows, appendSteps, isOff, isRecording, loadState, readRows, stickyIdentity, updateState, writeMarker } from "../engine/state.ts";
import { agentOf, ALLOW, awaitsBrief, changeEvents, changeRow, commitRange, editedFile, folderChanges, foldersToLook, hermeticEnv, holdsForBrief, isHookEvent, namedChange, nothingBound, outsideOf, opensCall, reachesAnotherWorktree, readFault, ridesRefusal, sessionFactsFrom, shellChangesOf, shellReadRows, statusPaths, toEvent, toResult, toolRow, whileBroken, withShellChanges, workedPaths, worktreeFolders, worktreesWorkedIn, type AdapterEvent, type Answer, type BriefAdapterEvent, type EventWorld, type HookEvent, type Refused, type Shown } from "./domain.ts";
import type { Harness, HookPayload, HookResult } from "./harness.ts";
import { currentBranch, loadRegime, readText, realWorld } from "./shell.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GIT — one command, run directly
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One git command, run DIRECTLY — no shell, so no login profile on a path that runs every call. */
function runGit(root: string, args: readonly string[]): { readonly ok: boolean; readonly stdout: Buffer; readonly stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    // Git's hook variables are stripped (see GIT_HOOK_ENV), so a call made inside a commit hook
    // never aims at the commit's own index.
    env: hermeticEnv(process.env),
  });
  if (result.error) return { ok: false, stdout: Buffer.alloc(0), stderr: result.error.message };
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr.toString("utf8").trim() };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WORKING FOLDERS — the folders git lists for this repository, read only when a call leaves root
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
  readonly harness: Harness;
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
function sessionOf(harness: Harness, payload: HookPayload, root: string): Session {
  const { transcripts } = harness;
  const path = transcripts.own(payload);
  const transcript = once((): string | null => (path === null ? null : readText(root, path)));
  const id = typeof payload.session_id === "string" && payload.session_id !== "" ? payload.session_id : "unknown";
  const who = agentOf(payload);
  return {
    harness,
    root,
    id,
    who,
    branch: currentBranch(root),
    transcript,
    tokens: once((): number => {
      const text = transcript();
      return text === null ? 0 : transcripts.tokens(text);
    }),
    // The transcript says what the edit tools changed and which commands ran; the log says which
    // files each command changed. `ctx.turn` is the two together.
    turn: once((): readonly TurnAction[] => {
      const text = transcript();
      const actions = text === null ? [] : transcripts.turn(text, root);
      return withShellChanges(actions, shellChangesOf(readRows(root, id), who.agent));
    }),
    // The PARENT's transcript, `transcript_path` as sent: the session's own agent is its record.
    sessionAgent: once((): string | null => {
      const sent = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
      const text = sent === "" ? null : readText(root, sent);
      return text === null ? null : transcripts.sessionAgent(text);
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
  const transcript = session.transcript();
  const facts = sessionFactsFrom({ payload, head: transcript === null ? "" : session.harness.transcripts.brief(transcript) });
  return stickyIdentity(session.root, session.id, session.who.agent, facts, categories, !briefPending);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHANGED PATHS — git's list of changed paths, taken before and after a call
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The decision, which paths a call changed, is `changedBy` and `folderChanges` (domain.ts). What is
// here asks git and hashes the files it lists, and keeps what it found as the "before" of the next
// call. Nothing of a file's content is stored, only its hash.

/** Files over this size are told apart by their size and modification time, not read. */
const HASH_LIMIT_BYTES = 32 * 1024 * 1024;

/** A listed path's content, as a hash: `DELETED` when the file is gone, and a link by where it points. */
function hashOf(file: string): string {
  try {
    const found = lstatSync(file);
    if (found.isSymbolicLink()) return `link:${readlinkSync(file)}`;
    if (found.size > HASH_LIMIT_BYTES) return `big:${found.size}:${found.mtimeMs}`;
    return createHash("sha1").update(readFileSync(file)).digest("hex");
  } catch {
    return DELETED;
  }
}

/**
 * What git lists as changed in one working folder now: the commit it has out, and a hash of each
 * listed path. Null when git cannot say, such as a folder that is not a repository. An ignored file is
 * not listed.
 */
function takeTree(folder: string): Tree | null {
  const status = runGit(folder, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!status.ok) return null;
  const head = runGit(folder, ["rev-parse", "--verify", "-q", "HEAD"]);
  const files: Record<string, string> = {};
  for (const path of statusPaths(status.stdout.toString("utf8"))) files[path] = hashOf(join(folder, path));
  return { head: head.ok ? head.stdout.toString("utf8").trim() : null, files };
}

/** The files of the commits made between two looks at a folder, or none when it made none. */
function committedBetween(folder: string, before: Tree, after: Tree): string[] {
  const range = commitRange(before, after);
  if (range === null) return [];
  const listed = runGit(folder, ["diff", "--name-only", "-z", range]);
  return listed.ok ? listed.stdout.toString("utf8").split("\0").filter((path) => path !== "") : [];
}

/**
 * The working folders a call worked in: the guarded folder, and each other worktree of the
 * repository that an edit tool wrote in or a shell command ran in (`workedPaths`). git is asked for
 * the worktrees only when one of the paths may be in another worktree.
 */
function workedFolders(session: Session, payload: HookPayload): string[] {
  const root = realPath(session.root);
  // Each folder once: a command can return to one with `cd -`, and two names can be one folder.
  const paths = [...new Set([...new Set(workedPaths(payload, session.root, homedir()))].map(realPath))];
  const others = reachesAnotherWorktree(paths, root, holdsGit) ? worktreesWorkedIn({ paths, root, worktrees: repoWorktrees(session.root) }) : [];
  return [root, ...others];
}

/** Each of these folders, as git lists it now. A folder git cannot read is left out. */
function lookAt(folders: readonly string[]): Map<string, Tree> {
  const looked = new Map<string, Tree>();
  for (const folder of folders) {
    const tree = takeTree(folder);
    if (tree !== null) looked.set(folder, tree);
  }
  return looked;
}

/** What this agent last saw in these folders, now what git lists: the "before" of its next call. */
function remember(session: Session, looked: ReadonlyMap<string, Tree>): void {
  if (looked.size === 0) return;
  updateState(session.root, session.id, session.who.agent, (state) => ({ ...state, trees: { ...state.trees, ...Object.fromEntries(looked) } }));
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

/**
 * ONE payload, judged. The live half of the pipeline, in the order the pieces become knowable.
 *
 * The shape is deliberately flat rather than a hook function per event: the events differ in what
 * they CARRY (toEvent's job) and in how their answer is rendered (toResult's job), and the middle —
 * load, classify, run, log — is identical for all of them. The old engine had five files here, and the
 * off switch, the session marker and the fault handling were each written out four or five times
 * with small differences nobody had chosen.
 */
export async function runHook(harness: Harness, hook: HookEvent, payload: HookPayload, root: string): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return ALLOW;

  const off = isOff(root);
  const session = sessionOf(harness, payload, root);

  // THE SESSION MARKER, written on every tool call: the commit gate is spawned by git, outside any
  // session, so this is the only way a later `git commit` can attribute its refusals to the chat
  // that caused them. Best-effort by construction — `writeMarker` answers a boolean.
  if (isCall(hook) && !off && session.id !== "unknown") writeMarker(root, session.id, session.who, session.branch);

  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";

  // THE CONFIG WILL NOT LOAD. `kind: "broken"` is a module that would not import; a LoadResult
  // carrying refusals is a module that imported and whose grammar was refused. Both are the same
  // fact, "flow is off", and get the same answer: `whileBroken` refuses nothing and hands the agent
  // the load error. They are asked in sequence only because the second needs the LoadResult the
  // first does not have.
  const outage = (sentence: string): HookResult => {
    if (off) return ALLOW;
    // A tool other than Bash is first seen after it ran, so that is where the agent is told.
    const answer = whileBroken(toEvent(hook, payload, eventWorld(root, session)), sentence, opensCall(hook, tool));
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
  // WHAT GIT LISTS AS CHANGED, in each working folder the call worked in. Before a shell command it
  // is the "before" of that call, kept for the hook that follows it. After any call it is the
  // "after", compared in `judge` with the "before": a shell command's own, or the last look for a
  // tool with no hook before it. A session's start is a look too, so a change made before the first
  // call is not that call's.
  const looked = lookAt(off ? [] : foldersToLook(hook, tool, () => workedFolders(session, payload), realPath(root)));
  if (hook === "pre-tool-use") remember(session, looked);

  // READ AFTER the identity was settled, deliberately: `stickyIdentity` writes the classification
  // into this same file.
  const stored = loadState(root, session.id, session.who.agent);
  const events = toEvent(hook, payload, eventWorld(root, session, stored.heldForBrief === true));
  const rows: Row[] = [];

  // The flight recorder goes FIRST, so the tool row precedes the guardrail rows about the same call
  // and the stream reads in the order things happened. A shell command is recorded before it runs,
  // because one the guard refuses never reaches PostToolUse; every other call is recorded after.
  if (isCall(hook) && !off && opensCall(hook, tool)) {
    const row = toolRow(payload, root);
    if (row) rows.push(row);
    if (hook === "pre-tool-use") rows.push(...shellReadRows(payload, root, homedir()));
  }

  const steps: RecordedStep[] = [];

  const answer = await judge({ events, session, load, settings: config.settings, identity, briefPending, off, hook, payload, rows, steps: taping ? steps : null, looked });
  if (!off) appendRows({ root, session: session.id, harness: harness.id, branch: session.branch, who: session.who }, rows);
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
  /** A subagent starting before its brief can be read (`awaitsBrief`). */
  readonly briefPending: boolean;
  readonly off: boolean;
  readonly hook: HookEvent;
  readonly payload: HookPayload;
  readonly rows: Row[];
  /** Where the replayable steps go, or null when this repo is not recording. */
  readonly steps: RecordedStep[] | null;
  /** What git lists as changed in each working folder now, taken before the call's events were read. */
  readonly looked: ReadonlyMap<string, Tree>;
}): Promise<Answer> {
  const { events, session, load, settings, identity, briefPending, off, hook, payload, rows, steps, looked } = args;
  const blocked: Refused[] = [];
  const shown: Shown[] = [];
  const world = realWorld(session.root);
  const inRepository = sameRepository(session.root);

  // A COMPACTION is the boundary where the agent stops knowing what it was told, and it removes
  // every breadcrumb's text from its context. The host announces it on the session rail (`source:
  // "compact"`), which is why flow registers no compaction hook of its own — a second registration
  // on one moment is the duplicate the hook grammar exists to prevent.
  const compacted = hook === "session-start" && payload.source === "compact";
  if (compacted && !off) rows.push({ kind: "compaction" });
  if (compacted) steps?.push({ rail: "compaction" });

  for (const event of events) {
    if (event.rail !== "guard") continue;
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
      ...(event.turn === undefined ? {} : { turn: event.turn }),
      // Where the line started rides with the answer, so a replay parses it to the same folders.
      ...(outside.length === 0 ? {} : { outside, ...(event.start === undefined ? {} : { start: event.start }) }),
      wearing: identity.wearing,
      world: tape?.taken() ?? {},
    });
    for (const effect of outcome.effects)
      if (effect.do === "block")
        blocked.push({ moment: event.moment, block: effect });
    if (!off) rows.push(...runRows(event.moment, outcome, 1));
  }

  const briefEvents = events.filter((event): event is BriefAdapterEvent => event.rail === "brief");
  if (off || (briefEvents.length === 0 && looked.size === 0)) return { refused: blocked, shown };

  // THE BREADCRUMBS, under the state's lock. Two hooks of one agent can run at once — it made two
  // calls together — and each reads the marks, decides, and writes them: without the lock the second
  // write drops the first's marks, and the same breadcrumb is shown again. The files the call
  // changed are found in here too, from the "before" the state holds, so two hooks cannot each find
  // the same change.
  updateState(session.root, session.id, session.who.agent, (state) => {
    let marks: Marks = compacted ? afterCompaction() : state.marks;
    // THE NOTES HELD FOR THE BRIEF: held by a subagent's start that judged them without it, and let
    // go by the first call that judges them again. A refused call judges none, so they stay held.
    let held = state.heldForBrief === true;

    const all = [...briefEvents];
    if (hook === "post-tool-use") {
      const written = editedFile(payload);
      const edited = written === null ? null : realPath(posix.resolve(session.root, written));
      const found: string[] = [];
      for (const [folder, after] of looked) {
        const before = state.trees?.[folder] ?? null;
        const committed = before === null ? [] : committedBetween(folder, before, after);
        found.push(...folderChanges({ before, after, committed, named: namedChange(edited, folder) }));
      }
      const changed = [...new Set(found)];
      const row = changeRow(typeof payload.tool_name === "string" ? payload.tool_name : "", changed);
      if (row !== null) rows.push(row);
      all.push(...changeEvents(changed, load.ok ? load.entries : []));
    }

    for (const event of all) {
      // A REFUSED CALL CARRIES NO NOTES, and this is the one place it is kept from them: a note is not
      // judged for it, so `toResult` is handed none, and nothing is marked shown to stay silent until
      // drift. A held TURN is the exception: its note is judged, and `toResult` passes it to the
      // agent with the refusal.
      if (blocked.length > 0 && !ridesRefusal(event.moment)) continue;
      if (event.moment === "session") held = briefPending && load.ok && holdsForBrief(load.entries);
      steps?.push({
        rail: "brief",
        moment: event.moment,
        ...(event.path === undefined ? {} : { path: event.path }),
        ...(event.command === undefined ? {} : { command: event.command }),
        wearing: identity.wearing,
        tokens: session.tokens(),
      });
      const briefing = brief({
        load,
        event: { moment: event.moment, path: event.path, command: event.command, wearing: identity.wearing, tokens: session.tokens() },
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
        shown.push({ entry: notice.entry, cause: notice.cause, moment: notice.moment, body });
      }
      marks = marksWithout(briefing.marks, marks, unshown);
      // A note that SHOWED is a row; a call where nothing showed is not. The `tool` row already
      // records that the call happened, and a run row per call with no tallies in it would double
      // the log to say the same thing twice.
      if (notices.length > 0) rows.push(...runRows(event.moment, { effects: notices, tallies: [] } satisfies Outcome, 1));
    }

    return { ...state, marks, trees: looked.size === 0 ? state.trees : { ...state.trees, ...Object.fromEntries(looked) }, heldForBrief: held ? true : undefined };
  });
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
export async function hookEntry(harnesses: readonly Harness[], event: string, cwd: string): Promise<HookResult> {
  try {
    if (!isHookEvent(event)) return ALLOW;
    const read = readPayload();
    if (!read.ok) {
      return readFault(event, read.why, read.detail);
    }
    const harness = harnesses.find((candidate) => candidate.claims(read.payload)) ?? harnesses[0];
    if (harness === undefined) return ALLOW;
    return await runHook(harness, event, read.payload, harness.projectRoot(cwd));
  } catch (error) {
    // The guard broke in a way nothing above predicted. It is still not allowed to wedge the
    // session, so it says so and allows — the same answer the annotating rails give a fault.
    return { stdout: "", stderr: `[flow hook ${event}] the guard itself failed — ${(error as Error).message}\n`, exitCode: 0 };
  }
}
