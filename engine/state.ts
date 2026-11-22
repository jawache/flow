// flow/engine/state.ts — the engine's one shell: `.flow/` on disk.
//
// Every decision it acts on lives next door in domain.ts — where the directory is, what a state
// file means, how a row is numbered, which session a commit belongs to. This file opens, reads,
// appends and writes, and does nothing a reader has to reason about.
//
// IT NEVER THROWS. That is the opposite of the doctrine everywhere else in flow, and the exception
// is narrow and deliberate: state is a de-duplication convenience, so losing it re-shows a
// breadcrumb and re-reads a classification, which is the harmless direction. A log that cannot be
// written must never be the reason a write, a command or a commit is refused — the whole argument
// for failing loud is that a rule which does not run should be loud, and a marks file is not a
// rule. Every function here answers with a fallback and a boolean instead.
//
// It knows no harness. The branch, the session id and the agent id are arguments, because the
// place they are discovered is the adapter and the fence says the engine may not look there.

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Category, SessionFacts } from "../language/domain.ts";
import {
  FLOW_GITIGNORE,
  attribution,
  cutOutput,
  flowDir,
  identify,
  lockIsStale,
  lockPath,
  logFile,
  markerPath,
  metaRow,
  nextSeq,
  outputFile,
  offPath,
  readDir,
  readMarkPath,
  readRecording,
  readState,
  recordPath,
  recordingFile,
  recordingHeader,
  statePath,
  type AgentOf,
  type Attribution,
  type Block,
  type Identity,
  type RecordedStep,
  type Recording,
  type Row,
  type SessionMarker,
  type SessionRows,
  type SessionState,
} from "./domain.ts";

/**
 * Create `.flow/`, self-ignored, and answer whether it is there.
 *
 * The `.gitignore` is written by whoever gets there first rather than by an install step, because
 * the first writer is usually a hook: a repo whose guard ran before anyone typed a flow command
 * would otherwise find a directory of telemetry sitting in `git status`. It is idempotent and it
 * covers itself — `*` ignores the ignore file too.
 */
export function ensureFlowDir(root: string): boolean {
  try {
    const dir = flowDir(root);
    mkdirSync(dir, { recursive: true });
    const ignore = `${dir}/.gitignore`;
    if (!existsSync(ignore)) writeFileSync(ignore, FLOW_GITIGNORE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is the guard switched off here?
 *
 * Fail-safe in the ON direction, deliberately: any error reading the marker is treated as "on", so
 * a filesystem hiccup can never silence a gate. The only thing that turns flow off is a file that
 * is definitely there.
 */
export function isOff(root: string): boolean {
  try {
    return existsSync(offPath(root));
  } catch {
    return false;
  }
}

// ── one session × agent's state ──────────────────────────────────────────────

/** This session × agent's stored state. Absent, unreadable or corrupt → nothing known. */
export function loadState(root: string, session: string, agent: string): SessionState {
  try {
    return readState(readFileSync(statePath(root, session, agent), "utf8"));
  } catch {
    return readState(null);
  }
}

/** What `updateState` sleeps on between tries: nothing ever wakes it, so each wait runs its full timeout. */
const NAP = new Int32Array(new SharedArrayBuffer(4));

/** How long one try at the lock waits before the next, and how many tries: about three seconds in all. */
const LOCK_NAP_MS = 5;
const LOCK_TRIES = 600;

/**
 * Take the lock beside a state file, or give up on it. True when it is held.
 *
 * A folder is the lock, because `mkdirSync` is atomic and fails when it exists. A lock older than
 * `LOCK_STALE_MS` is a hook that died holding it, and is taken over. Giving up is not an error: state
 * is a de-duplication convenience (see the note at the top of this file), so a hook that cannot get
 * the lock goes on without it, and at worst shows a breadcrumb twice.
 */
function takeLock(lock: string): boolean {
  for (let tries = 0; tries < LOCK_TRIES; tries++) {
    try {
      mkdirSync(lock);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    }
    try {
      if (lockIsStale(Date.now() - statSync(lock).mtimeMs)) rmSync(lock, { recursive: true, force: true });
    } catch {
      /* the holder let go between the two calls, which is what the next try finds out */
    }
    Atomics.wait(NAP, 0, 0, LOCK_NAP_MS);
  }
  return false;
}

/**
 * Change this session × agent's state, so that two hooks running at once cannot drop each other's
 * change: the lock is taken, the file is read AFTER it, `change` is applied to what is there, and the
 * result is written whole to a temporary file and renamed over the old one. The caller's function
 * decides and does no IO, because it runs while others wait. Returns the state written, or what
 * was read when the write failed. Never throws, as the note at the top of this file says.
 */
export function updateState(root: string, session: string, agent: string, change: (state: SessionState) => SessionState): SessionState {
  const file = statePath(root, session, agent);
  const lock = lockPath(root, session, agent);
  ensureFlowDir(root);
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    return change(loadState(root, session, agent));
  }
  const held = takeLock(lock);
  try {
    const next = change(loadState(root, session, agent));
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next));
      renameSync(temporary, file);
    } catch {
      /* a dropped write re-shows a breadcrumb, the harmless direction */
    }
    return next;
  } finally {
    if (held) rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Who this session × agent is, read once and then remembered — the sticky verdict, tied to disk.
 *
 * The two halves are proved separately next door and here; this is the ONE place they meet, so
 * there is no second spelling of "look it up, and if it was fresh, write it down". A caller that
 * assembled it by hand would eventually be a caller that forgot the write, and a classification
 * that silently re-derives every hook is the flapping identity the sticky rule exists to prevent.
 *
 * `remember` false reads the verdict without writing it down: the caller knows the evidence is not
 * all there yet, such as a subagent starting before its brief is written.
 */
export function stickyIdentity(
  root: string,
  session: string,
  agent: string,
  facts: SessionFacts,
  categories: readonly Category[],
  remember = true,
): Identity {
  const seen = identify(loadState(root, session, agent).categories, facts, categories);
  // A fault means we do not know, so nothing is stored: the next hook tries again rather than
  // inheriting an answer that was never reached.
  if (remember && seen.fresh && seen.faults.length === 0)
    updateState(root, session, agent, (stored) => ({ ...stored, categories: seen.wearing }));
  return seen;
}

// ── the event log ────────────────────────────────────────────────────────────

// `seq` is read back from the log's own tail rather than kept in a counter file, and the last 4KB
// is plenty — a row is a few hundred bytes. The answer is then cached per file for the life of the
// process, which is what keeps a commit gate writing three hundred rows from re-reading the tail
// three hundred times.
const TAIL_BYTES = 4096;
const seqCache = new Map<string, number>();

function tailOf(file: string): string {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const want = Math.min(size, TAIL_BYTES);
    if (want <= 0) return "";
    const buffer = Buffer.alloc(want);
    fd = openSync(file, "r");
    readSync(fd, buffer, 0, want, size - want);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null)
      try {
        closeSync(fd);
      } catch {
        /* the read already answered; a failed close is not the caller's problem */
      }
  }
}

export interface LogContext {
  readonly root: string;
  readonly session: string;
  /** The harness the session runs under, for the stream's meta row. The shared `commit` stream is no harness's, and names none. */
  readonly harness?: string;
  /** The branch this worktree has out, for the stream's meta row. The adapter knows it; this does not. */
  readonly branch: string | null;
  /** The agent every row came from, stamped beside the time. */
  readonly who: AgentOf;
  /** Injected, because a clock inside a decision is a decision nobody can test. */
  readonly now?: () => Date;
}

/**
 * Keep all of a refused tool's output in `.flow/output/<entry id>.log`, for each block whose
 * refusal cut lines. A refusal that showed it whole writes nothing. A write that fails is lost
 * quietly: the refusal is the answer, and the file is only the rest of it.
 */
export function keepOutputs(root: string, blocks: readonly Block[]): void {
  for (const block of blocks) {
    if (block.entry === null || block.output === undefined || cutOutput(block.output).cut === 0) continue;
    try {
      const file = join(root, outputFile(block.entry));
      ensureFlowDir(root);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, block.output);
    } catch {
      // see above
    }
  }
}

/**
 * Append rows to this session's stream, stamping each with the time, the next event index and the
 * agent it came from.
 *
 * The FIRST write creates the file with its meta row, which is the fail-loud "armed" marker — a
 * present-but-quiet log and a missing one are different facts, and a reader that cannot tell them
 * apart reports an armed guard as an absent one.
 */
export function appendRows(ctx: LogContext, rows: readonly Row[]): boolean {
  try {
    if (rows.length === 0) return true;
    const { root, session, harness, branch, who } = ctx;
    const clock = ctx.now ?? ((): Date => new Date());
    const file = logFile(root, session);
    ensureFlowDir(root);
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) {
      writeFileSync(file, `${JSON.stringify(metaRow(session, branch, root, clock().toISOString(), harness))}\n`);
      seqCache.set(file, 1);
    }
    let seq = seqCache.get(file) ?? nextSeq(tailOf(file));
    let text = "";
    for (const row of rows) {
      text += `${JSON.stringify({ ts: clock().toISOString(), seq, agent: who.agent, agentType: who.agentType, ...row })}\n`;
      seq += 1;
    }
    seqCache.set(file, seq);
    appendFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

/** Every row in one stream file, in the order it was written. Unreadable → nothing. */
export function readRowsFile(file: string): Row[] {
  const out: Row[] = [];
  try {
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Row;
        if (typeof row.kind === "string") out.push(row);
      } catch {
        continue; // a hand-edited or half-written line is not the rest of the history's problem
      }
    }
  } catch {
    /* no log is an empty history, never an error */
  }
  return out;
}

/** Every row of one session's stream. */
export function readRows(root: string, session: string): Row[] {
  return readRowsFile(logFile(root, session));
}

/**
 * Every session that has a stream here, oldest file first. A `dir` is read in place of `.flow/log/`.
 *
 * `commit` is included: its rows still count toward what an entry has done, and only the SESSION
 * count excludes it — a shared file is not a chat, and the metrics say so where it matters.
 */
export function sessionIds(root: string, dir?: string): string[] {
  try {
    return readdirSync(dir ?? join(flowDir(root), "log"))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .sort();
  } catch {
    return [];
  }
}

/** The whole recorded history of a repo — every stream, read. A `dir` is a copy of `.flow/log/` kept elsewhere, read in its place. */
export function readHistory(root: string, dir: string = join(flowDir(root), "log")): SessionRows[] {
  return sessionIds(root, dir).map((session) => ({ session, rows: readRowsFile(join(dir, `${session}.jsonl`)) }));
}

// ── what the archival side has already read ──────────────────────────────────

/**
 * The conversations already dealt with. Existence is the fact; a marker means READ, never merely
 * seen. Unreadable or absent is an empty set, which re-offers history — the harmless direction.
 */
export function alreadyRead(root: string): Set<string> {
  try {
    return new Set(readdirSync(readDir(root)).filter((name) => !name.startsWith(".")));
  } catch {
    return new Set();
  }
}

/**
 * Mark conversations read, so the backlog starts after them next time.
 *
 * Only ANALYSED ids are ever passed — never the deferred ones — which is what keeps "a marker
 * means read" true and stops a capped run declaring skipped history done. Bookkeeping, so it
 * answers with a count rather than throwing, like every other writer in this file.
 */
export function markRead(root: string, ids: readonly string[]): number {
  try {
    ensureFlowDir(root);
    mkdirSync(readDir(root), { recursive: true });
  } catch {
    return 0;
  }
  let wrote = 0;
  for (const id of ids) {
    try {
      writeFileSync(readMarkPath(root, id), "");
      wrote += 1;
    } catch {
      /* one bad id is not the rest of the backlog's problem */
    }
  }
  return wrote;
}

// ── the recording seam ───────────────────────────────────────────────────────

/**
 * Is this repo capturing replayable recordings?
 *
 * Fail-safe in the OFF direction, which is the opposite of the kill switch's and right for the
 * opposite reason: a filesystem hiccup must never silence a gate, and it must never start writing
 * a megabyte of transcript nobody asked for either.
 */
export function isRecording(root: string): boolean {
  try {
    return existsSync(recordPath(root));
  } catch {
    return false;
  }
}

/**
 * Append steps to this session's recording. Best-effort, like every other writer in this file.
 *
 * The header is written by whoever gets there first, exactly as the log's meta row is — the first
 * writer is a hook, and a recording that only became valid once somebody ran a command would miss
 * the opening of every session.
 */
export function appendSteps(root: string, session: string, steps: readonly RecordedStep[]): boolean {
  try {
    if (steps.length === 0) return true;
    const file = recordingFile(root, session);
    ensureFlowDir(root);
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, `${JSON.stringify(recordingHeader(session))}\n`);
    appendFileSync(file, `${steps.map((step) => JSON.stringify(step)).join("\n")}\n`);
    return true;
  } catch {
    return false;
  }
}

/** One recording, read off disk. A file that is not there is an empty one, never an error. */
export function loadRecording(file: string): Recording {
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
  try {
    return readRecording(readFileSync(file, "utf8"), name);
  } catch {
    return readRecording("", name);
  }
}

// ── the commit gate's marker ─────────────────────────────────────────────────

/**
 * Leave the live session × agent where the commit gate can find it.
 *
 * The gate is spawned by git, outside any session, so it cannot know which chat a commit belongs to
 * — nor which of that chat's actors was working, which is a second question and the one that
 * decides whether an actor-scoped rule can fire at the commit moment. Written on every edit, so the
 * marker tracks the session's latest activity and its timestamp is what `attribution` judges
 * freshness by.
 */
export function writeMarker(
  root: string,
  session: string,
  who: AgentOf,
  branch: string | null,
  at: Date = new Date(),
): boolean {
  try {
    ensureFlowDir(root);
    const marker = { session, agent: who.agent, agentType: who.agentType, ts: at.toISOString() };
    writeFileSync(markerPath(root, branch), `${JSON.stringify(marker)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Who this worktree's commit belongs to — the fresh marker's session × agent and its type, or `commit`. */
export function commitAttribution(root: string, branch: string | null, nowMs: number = Date.now()): Attribution {
  let marker: unknown = null;
  try {
    marker = JSON.parse(readFileSync(markerPath(root, branch), "utf8"));
  } catch {
    /* missing or corrupt → the fallback, which is what attribution does with null */
  }
  return attribution(marker as SessionMarker | null, "commit", nowMs);
}
