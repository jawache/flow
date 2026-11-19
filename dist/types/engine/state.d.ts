import type { Category, SessionFacts } from "../language/domain.ts";
import { type AgentOf, type Attribution, type Identity, type RecordedStep, type Recording, type Row, type SessionRows, type SessionState } from "./domain.ts";
/**
 * Create `.flow/`, self-ignored, and answer whether it is there.
 *
 * The `.gitignore` is written by whoever gets there first rather than by an install step, because
 * the first writer is usually a hook: a repo whose guard ran before anyone typed a flow command
 * would otherwise find a directory of telemetry sitting in `git status`. It is idempotent and it
 * covers itself — `*` ignores the ignore file too.
 */
export declare function ensureFlowDir(root: string): boolean;
/**
 * Is the guard switched off here?
 *
 * Fail-safe in the ON direction, deliberately: any error reading the marker is treated as "on", so
 * a filesystem hiccup can never silence a gate. The only thing that turns flow off is a file that
 * is definitely there.
 */
export declare function isOff(root: string): boolean;
/** This session × agent's stored state. Absent, unreadable or corrupt → nothing known. */
export declare function loadState(root: string, session: string, agent: string): SessionState;
/**
 * Change this session × agent's state, so that two hooks running at once cannot drop each other's
 * change: the lock is taken, the file is read AFTER it, `change` is applied to what is there, and the
 * result is written whole to a temporary file and renamed over the old one. The caller's function
 * decides and does no IO, because it runs while others wait. Returns the state written, or what
 * was read when the write failed. Never throws, as the note at the top of this file says.
 */
export declare function updateState(root: string, session: string, agent: string, change: (state: SessionState) => SessionState): SessionState;
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
export declare function stickyIdentity(root: string, session: string, agent: string, facts: SessionFacts, categories: readonly Category[], remember?: boolean): Identity;
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
 * Append rows to this session's stream, stamping each with the time, the next event index and the
 * agent it came from.
 *
 * The FIRST write creates the file with its meta row, which is the fail-loud "armed" marker — a
 * present-but-quiet log and a missing one are different facts, and a reader that cannot tell them
 * apart reports an armed guard as an absent one.
 */
export declare function appendRows(ctx: LogContext, rows: readonly Row[]): boolean;
/** Every row in one stream file, in the order it was written. Unreadable → nothing. */
export declare function readRowsFile(file: string): Row[];
/** Every row of one session's stream. */
export declare function readRows(root: string, session: string): Row[];
/**
 * Every session that has a stream here, oldest file first.
 *
 * `commit` is included: its rows still count toward what an entry has done, and only the SESSION
 * count excludes it — a shared file is not a chat, and the metrics say so where it matters.
 */
export declare function sessionIds(root: string): string[];
/** The whole recorded history of a repo — every stream, read. */
export declare function readHistory(root: string): SessionRows[];
/**
 * The conversations already dealt with. Existence is the fact; a marker means READ, never merely
 * seen. Unreadable or absent is an empty set, which re-offers history — the harmless direction.
 */
export declare function alreadyRead(root: string): Set<string>;
/**
 * Mark conversations read, so the backlog starts after them next time.
 *
 * Only ANALYSED ids are ever passed — never the deferred ones — which is what keeps "a marker
 * means read" true and stops a capped run declaring skipped history done. Bookkeeping, so it
 * answers with a count rather than throwing, like every other writer in this file.
 */
export declare function markRead(root: string, ids: readonly string[]): number;
/**
 * Is this repo capturing replayable recordings?
 *
 * Fail-safe in the OFF direction, which is the opposite of the kill switch's and right for the
 * opposite reason: a filesystem hiccup must never silence a gate, and it must never start writing
 * a megabyte of transcript nobody asked for either.
 */
export declare function isRecording(root: string): boolean;
/**
 * Append steps to this session's recording. Best-effort, like every other writer in this file.
 *
 * The header is written by whoever gets there first, exactly as the log's meta row is — the first
 * writer is a hook, and a recording that only became valid once somebody ran a command would miss
 * the opening of every session.
 */
export declare function appendSteps(root: string, session: string, steps: readonly RecordedStep[]): boolean;
/** One recording, read off disk. A file that is not there is an empty one, never an error. */
export declare function loadRecording(file: string): Recording;
/**
 * Leave the live session × agent where the commit gate can find it.
 *
 * The gate is spawned by git, outside any session, so it cannot know which chat a commit belongs to
 * — nor which of that chat's actors was working, which is a second question and the one that
 * decides whether an actor-scoped rule can fire at the commit moment. Written on every edit, so the
 * marker tracks the session's latest activity and its timestamp is what `attribution` judges
 * freshness by.
 */
export declare function writeMarker(root: string, session: string, who: AgentOf, branch: string | null, at?: Date): boolean;
/** Who this worktree's commit belongs to — the fresh marker's session × agent and its type, or `commit`. */
export declare function commitAttribution(root: string, branch: string | null, nowMs?: number): Attribution;
