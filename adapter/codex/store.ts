// flow/adapter/codex/store.ts — Codex's transcript store, read after the fact.
//
// Codex keeps every session of the machine under `~/.codex/sessions/<year>/<month>/<day>/`, one rollout
// each. Read-only, always: nothing here creates, moves or deletes anything under `~/.codex`, and nothing
// caches. What a rollout's name means (`classifyStore`) and what it says are decided in domain.ts; this
// opens files.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readText } from "../shell.ts";
import type { SpawnMeta, Store, StoredTranscript } from "../harness.ts";
import { classifyStore } from "./domain.ts";

/** The folder Codex keeps its own files in. `CODEX_HOME` moves it. A `home` passed in is taken as the user's home and wins. */
export function codexHome(home?: string): string {
  return home === undefined ? process.env["CODEX_HOME"] || join(homedir(), ".codex") : join(home, ".codex");
}

/** Every file under `dir`, as paths relative to it, found by walking the year, month and day folders. */
function listing(dir: string, within = ""): string[] {
  let entries;
  try {
    entries = readdirSync(join(dir, within), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => (entry.isDirectory() ? listing(dir, `${within}${entry.name}/`) : [`${within}${entry.name}`])).sort();
}

/** What Codex has recorded on this machine. The folder is shared by every project, so the caller keeps the rollouts whose own `cwd` is its repo. */
export function readStore(_cwd: string, home?: string): Store {
  const dir = join(codexHome(home), "sessions");
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

/** One rollout's bytes. Codex writes no sidecar. */
export function readTranscript(_dir: string, held: StoredTranscript): { jsonl: string; meta: SpawnMeta | null } {
  return { jsonl: readText("", held.file) ?? "", meta: null };
}
