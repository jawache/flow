// flow/adapter/archive.ts — the ARCHIVAL shell: the harness's transcript store, read after the fact.
//
// Its twin next door (claude.ts) is handed a payload and answers in milliseconds. This one is
// handed a repo and asked what happened here — so it opens the host's own store, reads flow's
// recorded rows back, and hands both to the layers that decide what they mean. It makes no
// decisions itself: the store's layout, a transcript's narrative, the shape of a reading and every
// number drawn from a row are settled in the two domain files. This opens files.
//
// TWO SOURCES, KEPT STRICTLY APART, because that separation IS the report:
//
//   THE ROWS        flow's own event log. Deterministic ground truth — what fired, what refused,
//                   what was shown and when. Numbers come from here and from nowhere else.
//   THE TRANSCRIPT  the conversation. HEURISTIC — a correction, an edit loop, a bypass — and every
//                   finding carries the line it came from so a reader judges the spot, not the label.
//
// SCOPE COMES FROM THE STORE, never from the log. History from before flow was installed is
// precisely what a first reading most wants to see, and a backlog taken from the log could only
// ever show a repo what it already knew.
//
// Read-only over the harness's folder, always: nothing here creates, moves or deletes anything
// under `~/.claude`, and nothing caches — the files are appended to live by the very session doing
// the reading, so the only honest read is a fresh one.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadResult } from "../language/domain.ts";
import { metrics, momentsView, terrain, universe, type Bound } from "../engine/domain.ts";
import { alreadyRead, markRead, readHistory } from "../engine/state.ts";
import { runCommand } from "./claude.ts";
import {
  CONFIG_FILE,
  classifyStore,
  health,
  joinSpawn,
  mergeNarratives,
  narrative,
  parseEvents,
  projectFolderName,
  recipeTools,
  selectSessions,
  spawnMeta,
  spawnsIn,
  transcriptHead,
  uncoveredAreas,
  guardPaths,
  weakenedAfterBlock,
  type Candidate,
  type Facts,
  type Narrative,
  type SelectOpts,
  type Selection,
  type SpawnMeta,
  type SpawnRecord,
  type TranscriptRef,
  type Weakening,
} from "./domain.ts";

/** A file's text, or null. Every read here is fail-safe: a report with a hole beats no report. */
function textOf(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Where this harness keeps a working directory's conversations. */
export function projectDir(cwd: string, home: string = homedir()): string {
  return join(home, ".claude", "projects", projectFolderName(cwd));
}

/**
 * The flat listing `classifyStore` sorts: every file at the top of the folder, plus every file
 * inside each session's `subagents/`.
 *
 * Walked by the two shapes that exist rather than recursively, because the harness writes exactly
 * two and a general walk over a folder this size would read directories nobody wants.
 */
function listing(dir: string): string[] {
  const read = (at: string): string[] => {
    try {
      return readdirSync(at, { withFileTypes: true }).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    } catch {
      return [];
    }
  };
  const out: string[] = [];
  for (const name of read(dir)) {
    if (!name.endsWith("/")) {
      out.push(name);
      continue;
    }
    const folder = name.slice(0, -1);
    for (const child of read(join(dir, folder, "subagents"))) if (!child.endsWith("/")) out.push(`${folder}/subagents/${child}`);
  }
  return out.sort();
}

/** One conversation in the store, with everything findable about it without opening it twice. */
export interface StoredTranscript {
  readonly ref: TranscriptRef;
  readonly file: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface Store {
  /** Where we looked, whether or not it was there — so a miss can name the path. */
  readonly dir: string;
  readonly exists: boolean;
  readonly transcripts: readonly StoredTranscript[];
  /** Files in the folder that are not transcripts. Reported, never guessed at. */
  readonly ignored: readonly string[];
}

/** What the harness has recorded for this working directory. A missing folder is a fact, not an error. */
export function readStore(cwd: string, home: string = homedir()): Store {
  const dir = projectDir(cwd, home);
  if (!existsSync(dir)) return { dir, exists: false, transcripts: [], ignored: [] };
  const { transcripts, ignored } = classifyStore(listing(dir));
  return {
    dir,
    exists: true,
    transcripts: transcripts.map((ref) => {
      const file = join(dir, ref.path);
      let bytes = 0;
      let mtimeMs = 0;
      try {
        const stat = statSync(file);
        bytes = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        /* a file that vanished between the listing and the stat is still worth naming */
      }
      return { ref, file, bytes, mtimeMs };
    }),
    ignored,
  };
}

/** One transcript's bytes, and the sidecar beside it if there is one. */
export function readTranscript(dir: string, held: StoredTranscript): { jsonl: string; meta: SpawnMeta | null } {
  return {
    jsonl: textOf(held.file) ?? "",
    meta: held.ref.meta === null ? null : spawnMeta(textOf(join(dir, held.ref.meta))),
  };
}

// ── the whole reading ────────────────────────────────────────────────────────

export interface FactsOpts extends SelectOpts {
  /** Read exactly this conversation, whatever the backlog says. */
  readonly session?: string | null | undefined;
  /** Only conversations recorded on this branch. */
  readonly branch?: string | null | undefined;
  /** Mark what was read, so the backlog starts after it next time. */
  readonly mark?: boolean | undefined;
  readonly home?: string | undefined;
  readonly nowMs?: number | undefined;
}

/** The tracked tree, for the terrain. A repo git cannot answer for has an empty one, not an error. */
function trackedPaths(root: string): string[] {
  const answer = runCommand("git ls-files", root);
  return answer.code === 0 ? answer.stdout.split("\n").filter((line) => line.trim() !== "") : [];
}

/**
 * Everything the record and the conversations say about a repo, assembled.
 *
 * `load` is passed in rather than read here: what an entry watches is the CONFIG's answer, and
 * this file has no business importing one. A regime that will not load is handed over as such,
 * and the universe comes back empty — which is honest, and reads as "nothing is bound" rather
 * than as a crash.
 */
export function facts(root: string, load: LoadResult, opts: FactsOpts = {}): Facts {
  const home = opts.home ?? homedir();
  const nowMs = opts.nowMs ?? Date.now();
  const store = readStore(root, home);

  // ONE PASS PER FILE, and one read per file. A transcript is a couple of megabytes, there is one
  // per conversation this repo has ever had, and the three opening facts below used to cost three
  // parses each.
  const candidates: Candidate[] = [];
  const held = new Map<string, string>();
  const children = new Map<string, StoredTranscript[]>();
  for (const stored of store.transcripts) {
    if (stored.ref.agent !== null) {
      const beside = children.get(stored.ref.session) ?? [];
      beside.push(stored);
      children.set(stored.ref.session, beside);
      continue;
    }
    const jsonl = textOf(stored.file) ?? "";
    const head = transcriptHead(jsonl);
    // WHICH WORKTREE, answered from inside the records. The store folder's name collapses dots and
    // slashes to dashes, so two checkouts of one repo can share it; a conversation whose own `cwd`
    // is somebody else's checkout is somebody else's conversation.
    if (head.cwd !== null && head.cwd !== root) continue;
    held.set(stored.ref.session, jsonl);
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

  const history = readHistory(root);
  const bySession = new Map(history.map((s) => [s.session, s.rows]));
  const bound: Bound[] = load.ok ? universe(load.entries) : [];
  const tools = recipeTools(textOf(join(root, "justfile")) ?? "");
  // What counts as "somebody edited the guard" here: the config, the packs it imports, and the
  // host's registration files. Read from the config's text once, not per session.
  const guarded = guardPaths(textOf(join(root, CONFIG_FILE)));

  const readings: { session: string; read: Narrative }[] = [];
  const weakened: Weakening[] = [];
  const actors: SpawnRecord[] = [];
  let withRecord = 0;
  for (const candidate of selection.analyse) {
    const rows = bySession.get(candidate.id) ?? [];
    if (rows.length > 0) withRecord += 1;
    const jsonl = held.get(candidate.id) ?? "";
    const events = parseEvents(jsonl, root, home);
    readings.push({ session: candidate.id, read: narrative(events, tools) });
    weakened.push(...weakenedAfterBlock(rows, events, guarded));

    // THE JOIN, at the one place that has both halves: the parent's own spawn blocks, and the
    // sidecar the host wrote beside each child's transcript.
    const spawns = spawnsIn(jsonl);
    for (const child of children.get(candidate.id) ?? [])
      actors.push({
        ...joinSpawn({
          session: candidate.id,
          agent: child.ref.agent ?? "",
          meta: child.ref.meta === null ? null : spawnMeta(textOf(join(store.dir, child.ref.meta))),
          spawns,
        }),
      });
  }

  const recorded = metrics({ sessions: history, entries: bound, nowMs });
  const read = mergeNarratives(readings);
  return {
    root,
    store: { dir: store.dir, exists: store.exists, ignored: store.ignored },
    selection,
    coverage: {
      analysed: selection.analyse.length,
      withRecord,
      narrativeOnly: selection.analyse.length - withRecord,
    },
    health: health({
      armed: history.length > 0,
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
    weakened,
    marked: opts.mark === true ? markRead(root, selection.analyse.map((c) => c.id)) : null,
  };
}
