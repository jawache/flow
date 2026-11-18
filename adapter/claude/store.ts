// flow/adapter/claude/store.ts — Claude Code's transcript store, read after the fact.
//
// Claude Code keeps one folder per working directory, and this opens it. Read-only, always: nothing
// here creates, moves or deletes anything under `~/.claude`, and nothing caches — the files are
// appended to live by the very session doing the reading, so the only honest read is a fresh one.
// What the folder's layout means (`classifyStore`) and what a transcript says are decided in
// domain.ts; this opens files.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readText } from "../shell.ts";
import type { SpawnMeta, Store, StoredTranscript } from "../harness.ts";
import { classifyStore, projectFolderName, spawnMeta } from "./domain.ts";


/**
 * Where this harness keeps a working directory's conversations.
 *
 * Under the host's own folder, and `CLAUDE_CONFIG_DIR` moves that folder — the host honours it for
 * the store as it does for settings.json, so a store read from `~/.claude` regardless would be
 * somebody else's. A `home` passed in is taken as the user's home and wins: that is a test naming
 * its own world.
 */
export function projectDir(cwd: string, home?: string): string {
  const root = home === undefined ? process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude") : join(home, ".claude");
  return join(root, "projects", projectFolderName(cwd));
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
export function readStore(cwd: string, home?: string): Store {
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
    jsonl: readText("", held.file) ?? "",
    meta: held.ref.meta === null ? null : spawnMeta(readText("", join(dir, held.ref.meta))),
  };
}
