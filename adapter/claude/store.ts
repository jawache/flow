// flow/adapter/claude/store.ts — Claude Code's transcript store, read after the fact.
//
// Claude Code keeps one folder per working directory, and this opens it. Read-only, always: nothing
// here creates, moves or deletes anything under `~/.claude`, and nothing caches — the files are
// appended to live by the very session doing the reading, so the only honest read is a fresh one.
// What the folder's layout means (`classifyStore`) and what a transcript says are decided in
// domain.ts; this opens files.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readText, storedTranscripts } from "../shell.ts";
import type { SpawnMeta, Store, StoredTranscript } from "../harness.ts";
import { classifyStore, projectFolderName, spawnMeta } from "./domain.ts";


/**
 * The folder Claude Code keeps its own files in: settings, projects. `CLAUDE_CONFIG_DIR` moves it, and
 * the host honours that for the store as it does for settings.json, so one read from `~/.claude`
 * regardless would be somebody else's. A `home` passed in is taken as the user's home and wins: that is
 * a test naming its own world.
 */
export function configRoot(home?: string): string {
  return home === undefined ? process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude") : join(home, ".claude");
}

/**
 * Where this harness keeps a working directory's conversations.
 * One folder per working directory, under `projects/` in `configRoot`.
 */
export function projectDir(cwd: string, home?: string): string {
  return join(configRoot(home), "projects", projectFolderName(cwd));
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


/** What the harness has recorded for this working directory. A missing folder is a fact, not an error. */
export function readStore(cwd: string, home?: string, copy?: string): Store {
  const dir = copy ?? projectDir(cwd, home);
  if (!existsSync(dir)) return { dir, exists: false, transcripts: [], ignored: [] };
  const { transcripts, ignored } = classifyStore(listing(dir));
  return {
    dir,
    exists: true,
    transcripts: storedTranscripts(dir, transcripts),
    ignored,
  };
}

/** One transcript's bytes, and the sidecar beside it if there is one. */
export function readTranscript(dir: string, held: StoredTranscript): { jsonl: string; meta: SpawnMeta | null } {
  return {
    jsonl: readText("", held.file) ?? "",
    meta: held.ref.meta === null ? null : spawnMeta(readText("", join(dir, held.ref.meta))),
  };
}
