// flow/adapter/codex/store.ts — Codex's transcript store, read after the fact.
//
// Codex keeps every session of the machine under `~/.codex/sessions/<year>/<month>/<day>/`, one rollout
// each. Read-only, always: nothing here creates, moves or deletes anything under `~/.codex`, and nothing
// caches. What a rollout's first record means (`classifyStore`) and what the rest says are decided in
// domain.ts; this opens files.

import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readText, storedTranscripts } from "../shell.ts";
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

/** The first record of a file, up to a megabyte: where Codex says whose rollout this is. Empty when it cannot be read. */
function firstRecord(file: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const chunk = Buffer.alloc(64 * 1024);
    let text = "";
    while (text.length < 1024 * 1024 && !text.includes("\n")) {
      const got = readSync(fd, chunk, 0, chunk.length, null);
      if (got === 0) break;
      text += chunk.subarray(0, got).toString("utf8");
    }
    return text.split("\n")[0] ?? "";
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** What Codex has recorded on this machine. The folder is shared by every project, so the caller keeps the rollouts whose own `cwd` is its repo. */
export function readStore(_cwd: string, home?: string): Store {
  const dir = join(codexHome(home), "sessions");
  if (!existsSync(dir)) return { dir, exists: false, transcripts: [], ignored: [] };
  const { transcripts, ignored } = classifyStore(listing(dir).map((path) => ({ path, first: path.endsWith(".jsonl") ? firstRecord(join(dir, path)) : "" })));
  return { dir, exists: true, transcripts: storedTranscripts(dir, transcripts), ignored };
}

/** One rollout's bytes. Codex writes no sidecar. */
export function readTranscript(_dir: string, held: StoredTranscript): { jsonl: string; meta: SpawnMeta | null } {
  return { jsonl: readText("", held.file) ?? "", meta: null };
}
