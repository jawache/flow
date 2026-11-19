import type { SpawnMeta, Store, StoredTranscript } from "../harness.ts";
/**
 * The folder Claude Code keeps its own files in: settings, projects. `CLAUDE_CONFIG_DIR` moves it, and
 * the host honours that for the store as it does for settings.json, so one read from `~/.claude`
 * regardless would be somebody else's. A `home` passed in is taken as the user's home and wins: that is
 * a test naming its own world.
 */
export declare function configRoot(home?: string): string;
/**
 * Where this harness keeps a working directory's conversations.
 * One folder per working directory, under `projects/` in `configRoot`.
 */
export declare function projectDir(cwd: string, home?: string): string;
/** What the harness has recorded for this working directory. A missing folder is a fact, not an error. */
export declare function readStore(cwd: string, home?: string): Store;
/** One transcript's bytes, and the sidecar beside it if there is one. */
export declare function readTranscript(dir: string, held: StoredTranscript): {
    jsonl: string;
    meta: SpawnMeta | null;
};
