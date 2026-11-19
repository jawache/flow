import type { Harness } from "../harness.ts";
/**
 * The repo the session is standing in — the FOURTH question of §7.
 *
 * The hook's own cwd is not guaranteed to be the project: the host sets `CLAUDE_PROJECT_DIR` for
 * exactly this, and cwd is the fallback that keeps the git gate (spawned inside the repo) working.
 */
export declare function projectRoot(cwd: string): string;
/** Claude Code. The one value flow.ts chooses, and what the rest of flow is handed in its place. */
export declare const claudeCode: Harness;
