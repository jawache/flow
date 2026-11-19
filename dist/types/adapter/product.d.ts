import type { Harness } from "./harness.ts";
/** What a verb answers with. The same three edges a hook answers on, minus the decision object. */
export interface VerbResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
}
/** A person at a terminal: what is asked of them, and where what is said to them goes. */
export interface Terminal {
    readonly ask: (question: string) => Promise<string>;
    readonly say: (text: string) => void;
}
/**
 * `flow init [--empty] [--harness <names>]` — make this repo drivable, and say exactly what was created.
 *
 * With a `terminal` it is interactive: it prompts for the harnesses, prints each warning, lists what
 * it is about to write and asks for a yes. Without one, as when an agent or a script runs it, it
 * prompts for nothing: `--harness` names the harnesses, else the detected ones, else every one.
 */
export declare function runInit(cwd: string, args: readonly string[], harnesses: readonly Harness[], terminal: Terminal | null): Promise<VerbResult>;
/**
 * `flow uninstall [--machine]` — remove what `flow init` wrote in this repo, but the config, and say
 * exactly what went. `--machine` takes flow's hooks out of the machine-wide settings files too.
 */
export declare function runUninstall(cwd: string, args: readonly string[], harnesses: readonly Harness[]): VerbResult;
/** `flow status` — is flow working here, and what will meet me. Green means guarded. */
export declare function runStatus(cwd: string, args: readonly string[], harnesses: readonly Harness[]): Promise<VerbResult>;
