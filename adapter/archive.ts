// flow/adapter/archive.ts — the ARCHIVAL shell: a harness's transcript store, read after the fact.
//
// Its twin, the harness's own shell, is handed a payload and answers in milliseconds. This one is
// handed a repo and asked what happened here — so it opens the harness's store through the
// `Transcripts` the harness gives it (harness.ts), reads flow's recorded rows back, and hands both
// to the layers that decide what they mean. It makes no decisions itself: the store's layout and a
// transcript's narrative are the harness's, the shape of a reading and every number drawn from a
// row are in domain.ts. This opens files.
//
// TWO SOURCES, KEPT STRICTLY APART, because that separation IS the report:
//
//   THE ROWS        flow's own event log. Deterministic ground truth — what fired, what refused,
//                   what was shown and when. Numbers come from here and from nowhere else.
//   THE TRANSCRIPT  the conversation. Counts of what was called, and the line each came from, so a
//                   reader judges the spot, not the label.
//
// SCOPE COMES FROM THE STORE, never from the log. History from before flow was installed is
// precisely what a first reading most wants to see, and a backlog taken from the log could only
// ever show a repo what it already knew.
//
// Read-only over the harness's folder, always: nothing here creates, moves or deletes anything
// in the harness's store, and nothing caches — the files are appended to live by the very session doing
// the reading, so the only honest read is a fresh one.

import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadResult } from "../language/domain.ts";
import { metrics, momentsView, terrain, universe, type Bound, type Row } from "../engine/domain.ts";
import { alreadyRead, markRead, readHistory } from "../engine/state.ts";
import { readText, runCommand } from "./shell.ts";
import type { Harness, Steer, StoredTranscript } from "./harness.ts";
import {
  backedByTranscript,
  belongsToRepo,
  CONFIG_FILE,
  health,
  joinSpawn,
  mergeNarratives,
  modesOf,
  narrative,
  refusalsIn,
  requestsEntry,
  selectSessions,
  uncoveredAreas,
  groupRefusals,
  guardPaths,
  weakenedAfterBlock,
  worktreeFolders,
  type Candidate,
  type Facts,
  type Narrative,
  type RequestsEntry,
  type SelectOpts,
  type Selection,
  type SpawnRecord,
  type Weakening,
} from "./domain.ts";

// ── the whole reading ────────────────────────────────────────────────────────

export interface FactsOpts extends SelectOpts {
  /** Read exactly this conversation, whatever the backlog says. */
  readonly session?: string | null | undefined;
  /** Only conversations recorded on this branch. */
  readonly branch?: string | null | undefined;
  /** Mark what was read, so the backlog starts after it next time. */
  readonly mark?: boolean | undefined;
  /** Read the transcripts kept in this folder, in place of the harness's folder for this worktree. */
  readonly transcripts?: string | null | undefined;
  /** Read the session logs kept in this folder, in place of `.flow/log/`. */
  readonly log?: string | null | undefined;
  readonly home?: string | undefined;
  readonly nowMs?: number | undefined;
}

/** The tracked tree, for the terrain. A repo git cannot answer for has an empty one, not an error. */
function trackedPaths(root: string): string[] {
  const answer = runCommand("git ls-files", root);
  return answer.code === 0 ? answer.stdout.split("\n").filter((line) => line.trim() !== "") : [];
}

/** The other worktrees of this repository that lie under `root`, as git lists them. None when git cannot say. */
function nestedWorktrees(root: string): string[] {
  const listed = runCommand("git worktree list --porcelain", root);
  return listed.code === 0 ? worktreeFolders(listed.stdout).filter((folder) => folder !== root && folder.startsWith(`${root}/`)) : [];
}

/**
 * Everything the record and the conversations say about a repo, assembled.
 *
 * `load` is passed in rather than read here: what an entry watches is the CONFIG's answer, and
 * this file has no business importing one. A regime that will not load is handed over as such,
 * and the universe comes back empty — which is honest, and reads as "nothing is bound" rather
 * than as a crash.
 */
export function facts(root: string, load: LoadResult, harnesses: readonly Harness[], opts: FactsOpts = {}): Facts {
  const home = opts.home ?? homedir();
  const nowMs = opts.nowMs ?? Date.now();
  const stores = harnesses.map((harness) => ({ harness, store: harness.transcripts.readStore(root, opts.home, opts.transcripts ?? undefined) }));
  // The report names the first store that exists, or the first harness's when none does.
  const store = (stores.find((one) => one.store.exists) ?? stores[0])?.store ?? { dir: "", exists: false, transcripts: [], ignored: [] };
  const nested = nestedWorktrees(root);

  // ONE PASS PER FILE, and one read per file. A transcript is a couple of megabytes, there is one
  // per conversation this repo has ever had, and the three opening facts below used to cost three
  // parses each.
  const candidates: Candidate[] = [];
  const held = new Map<string, string>();
  // Each conversation is read through the harness whose store holds it.
  const via = new Map<string, Harness>();
  const children = new Map<string, StoredTranscript[]>();
  const listed = stores.flatMap(({ harness, store: one }) => one.transcripts.map((stored) => ({ harness, stored })));
  for (const { harness, stored } of listed) {
    if (stored.ref.agent !== null) {
      const beside = children.get(stored.ref.session) ?? [];
      beside.push(stored);
      children.set(stored.ref.session, beside);
      continue;
    }
    const jsonl = readText(root, stored.file) ?? "";
    const head = harness.transcripts.head(jsonl);
    // WHICH WORKTREE, answered from inside the records. The store folder's name collapses dots and
    // slashes to dashes, so two checkouts of one repo can share it, and Codex keeps every project in
    // one folder; a conversation recorded in somebody else's checkout is somebody else's.
    // A folder the caller named holds copies, kept elsewhere, of conversations this repo had: all of them are read.
    if (opts.transcripts == null && !belongsToRepo(head.cwd, root, nested)) continue;
    held.set(stored.ref.session, jsonl);
    via.set(stored.ref.session, harness);
    candidates.push({
      id: stored.ref.session,
      bytes: stored.bytes,
      mtimeMs: stored.mtimeMs,
      started: head.started,
      branch: head.branch,
    });
  }

  const scoped = opts.branch ? candidates.filter((c) => c.branch === opts.branch) : candidates;
  const selection: Selection = opts.session
    ? {
        analyse: scoped.filter((c) => c.id === opts.session),
        excluded: [],
        counts: { backlog: scoped.length, analysed: scoped.filter((c) => c.id === opts.session).length, excluded: 0 },
      }
    : selectSessions(scoped, alreadyRead(root), opts);

  // A log with no transcript behind it is no session someone had. With no transcript of this repo to compare with, every log stays.
  // Transcripts copied from elsewhere come from another worktree, so this one's `.flow/log/` is not theirs: with no `log` named, none is read.
  const { kept: history, excluded: withoutTranscript } = backedByTranscript(
    opts.transcripts != null && opts.log == null ? [] : readHistory(root, opts.log ?? undefined),
    candidates.length > 0 ? new Set(candidates.map((c) => c.id)) : null,
  );
  const bySession = new Map(history.map((s) => [s.session, s.rows]));
  const bound: Bound[] = load.ok ? universe(load.entries) : [];
  // What counts as "somebody edited the guard" here: the config, the packs it imports, and the
  // host's registration files. Read from the config's text once, not per session.
  const guarded = guardPaths(readText(root, CONFIG_FILE), harnesses.flatMap((harness) => harness.registering.hostSurface));

  const readings: { session: string; read: Narrative }[] = [];
  const weakened: Weakening[] = [];
  const actors: SpawnRecord[] = [];
  const requests: RequestsEntry[] = [];
  const refused: ReturnType<typeof refusalsIn> = [];
  const ran: { rows: readonly Row[]; steer: Steer | null }[] = [];
  let withRecord = 0;
  for (const candidate of selection.analyse) {
    const rows = bySession.get(candidate.id) ?? [];
    if (rows.length > 0) withRecord += 1;
    const jsonl = held.get(candidate.id) ?? "";
    const harness = via.get(candidate.id) ?? harnesses[0];
    if (harness === undefined) continue;
    const { transcripts } = harness;
    const dir = stores.find((one) => one.harness === harness)?.store.dir ?? store.dir;
    const events = transcripts.events(jsonl, root, home);
    readings.push({ session: candidate.id, read: narrative(events) });
    ran.push({ rows, steer: transcripts.steer(jsonl) });
    weakened.push(...weakenedAfterBlock(rows, events, guarded));

    requests.push(requestsEntry({ session: candidate.id, agent: null, agentType: null }, transcripts.requests(jsonl)));
    refused.push(...refusalsIn({ session: candidate.id, agent: null }, events));

    // THE JOIN, at the one place that has both halves: the parent's own spawn blocks, and the
    // sidecar the host wrote beside each child's transcript.
    const spawns = transcripts.spawns(jsonl);
    for (const child of children.get(candidate.id) ?? []) {
      const spawned = joinSpawn({
        session: candidate.id,
        agent: child.ref.agent ?? "",
        meta: child.ref.meta === null ? null : transcripts.spawnMeta(readText(root, join(dir, child.ref.meta))),
        spawns,
      });
      actors.push(spawned);
      // A subagent's own transcript is read for the same parts as the conversation's.
      const childJsonl = readText(root, child.file) ?? "";
      requests.push(requestsEntry({ session: candidate.id, agent: spawned.agent, agentType: spawned.agentType }, transcripts.requests(childJsonl)));
      refused.push(...refusalsIn({ session: candidate.id, agent: spawned.agent }, transcripts.events(childJsonl, root, home)));
    }
  }

  const recorded = metrics({ sessions: history, entries: bound, nowMs });
  const read = mergeNarratives(readings);
  return {
    host: harnesses.map((harness) => harness.name).join(" · "),
    root,
    store: { dir: store.dir, exists: store.exists, ignored: store.ignored },
    selection,
    coverage: {
      analysed: selection.analyse.length,
      withRecord,
      narrativeOnly: selection.analyse.length - withRecord,
    },
    withoutTranscript,
    health: health({
      armed: history.length + withoutTranscript.length > 0,
      transcripts: candidates.length,
      rows: history.reduce((n, s) => n + s.rows.length, 0),
      withRecord,
      analysed: selection.analyse.length,
    }),
    metrics: recorded,
    moments: momentsView(bound, recorded),
    terrain: terrain({ paths: trackedPaths(root), heat: recorded.heat, entries: bound }),
    narrative: read,
    uncovered: uncoveredAreas(read.touched, bound),
    actors,
    requests,
    refusals: groupRefusals(refused),
    weakened,
    modes: modesOf(ran),
    marked: opts.mark === true ? markRead(root, selection.analyse.map((c) => c.id)) : null,
  };
}
