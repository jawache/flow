import { type TurnAction } from "../../language/domain.ts";
import { type HookEvent } from "../domain.ts";
import type { HookPayload, SpawnMeta, TranscriptEvent, TranscriptHead, TranscriptRef } from "../harness.ts";
/**
 * Is this payload Codex's?
 *
 * Claude Code and Codex call the same `flow hook <event>`, so the payload tells them apart. Two marks, and
 * either is enough: every payload of a call carries `turn_id`, which Claude Code never sends, and the
 * transcript it names is a Codex rollout. A `SessionStart` whose `transcript_path` is null carries neither,
 * and is taken for Claude Code's: the first harness is the one a payload that says nothing is run as.
 */
export declare function claimsPayload(payload: HookPayload): boolean;
/**
 * The transcript of the agent a payload came from, or null when it names none. At a `SubagentStop` Codex
 * names the subagent's own, `agent_transcript_path`; every other payload names the session's.
 */
export declare function ownTranscriptPath(payload: HookPayload): string | null;
/** The repo's own Codex hooks file, relative to the repo root: where `flow init` registers flow's hooks and `flow uninstall` takes them out. */
export declare const REPO_HOOKS = ".codex/hooks.json";
/** The files that steer Codex here — its hooks, its config, its agent definitions — guarded like flow's own config. */
export declare const HOST_SURFACE: readonly string[];
/**
 * The command each registration runs: the repo's own `@jawache/flow` first, then the PATH's. Codex runs a
 * hook in the folder the session runs in, which may be inside the repo, so git finds the repo from there.
 */
export declare function hookCommand(hook: HookEvent): string;
/** What `flow init`, `flow status` and `flow uninstall` ask of Codex's hooks file. */
export declare const hooksFile: Pick<import("../harness.ts").Registering, "hooks" | "registrations" | "registeredEvents" | "staleRegistrations" | "bareRegistrations" | "withRegistrations" | "withoutRegistrations"> & {
    readonly ourHookCommand: (command: string) => boolean;
    readonly bareHook: (command: string) => HookEvent | null;
};
/** The words after `flow hook` that Codex calls, in the order flow registers them. */
export declare const HOOK_WORDS: readonly HookEvent[];
/**
 * How many tokens the conversation's context holds now: the `input_tokens` of the last request, from
 * the last `token_count` row that has usage. Codex counts the cached tokens inside `input_tokens`. A row
 * with no `info`, which a session's first rows can be, says nothing, and no row at all is 0: a
 * breadcrumb is then not shown again as the context grows.
 */
export declare function tokensFromTranscript(jsonl: string): number;
/**
 * What the agent did this turn, in order: every shell command since the turn started. A Codex agent
 * changes files through the shell, so a command is the only action there is to count.
 */
export declare function turnActions(jsonl: string): TurnAction[];
/** The brief a session was started with: the first thing a human typed, capped. */
export declare function briefHead(jsonl: string, cap?: number): string;
/**
 * A rollout → the narrative events in it: typed prompts, shell commands and what they printed. A
 * command and its result are one `CommandExecution` item, whose id is the `tool_use_id` of the hook
 * payloads about the same call.
 */
export declare function parseEvents(jsonl: string, root?: string, home?: string): TranscriptEvent[];
/** A rollout's first facts: when it started, in which folder and on which branch, from its `session_meta` record. */
export declare function transcriptHead(jsonl: string): TranscriptHead;
/**
 * The files of Codex's `sessions/` folder, each with the first record it holds, sorted into the rollouts
 * and the rest. A top-level rollout is a session of its own. A subagent's is told by its `session_meta`,
 * which names the subagent's own id in `id` and its parent's session in `session_id`: it joins that
 * session as the agent of that id. Codex keeps one folder per day for every project on the machine, so
 * which rollout is this repo's is answered from inside it, by `transcriptHead`'s `cwd`.
 */
export declare function classifyStore(files: readonly {
    readonly path: string;
    readonly first: string;
}[]): {
    transcripts: TranscriptRef[];
    ignored: string[];
};
/** Codex writes no sidecar beside a subagent's transcript. */
export declare function spawnMeta(): SpawnMeta | null;
