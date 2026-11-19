import type { Harness } from "../harness.ts";
/**
 * The repo a hook stands in: git's top folder for the folder Codex ran the hook in, which may be inside the
 * repo. The folder itself when git cannot say, which keeps a hook run outside any repository answering from
 * where it stands.
 */
export declare function projectRoot(cwd: string): string;
/** Codex. A value flow.ts chooses, and what the rest of flow is handed in its place. */
export declare const codex: Harness;
