import type { SpawnMeta, Store, StoredTranscript } from "../harness.ts";
/** The folder Codex keeps its own files in. `CODEX_HOME` moves it. A `home` passed in is taken as the user's home and wins. */
export declare function codexHome(home?: string): string;
/** What Codex has recorded on this machine. The folder is shared by every project, so the caller keeps the rollouts whose own `cwd` is its repo. */
export declare function readStore(_cwd: string, home?: string): Store;
/** One rollout's bytes. Codex writes no sidecar. */
export declare function readTranscript(_dir: string, held: StoredTranscript): {
    jsonl: string;
    meta: SpawnMeta | null;
};
