import { type TurnAction } from "../../language/domain.ts";
import { type HookEvent } from "../domain.ts";
import type { HookPayload, Spawn, SpawnMeta, Steer, TranscriptEvent, TranscriptHead, TranscriptRef } from "../harness.ts";
/** One line of a transcript, parsed. `record` is the raw object — this file reads it, nobody else. */
export interface TranscriptLine {
    /** The record's `type`: `user`, `assistant`, or whatever else the host writes. */
    readonly kind: string;
    readonly record: Record<string, unknown>;
    /**
     * 1-based position in the FILE, counting blank and unreadable lines.
     *
     * Ground truth about the file rather than narrative, and the reason it is counted here rather
     * than by a consumer: the facts layer cites a transcript line back to a person, and a number
     * derived from a filtered list points at the wrong line the moment anything is skipped.
     */
    readonly line: number;
    /** ISO-8601 UTC, exactly as the host wrote it. Null when the line carries none. */
    readonly ts: string | null;
}
/**
 * Every readable line of a transcript, in order.
 *
 * The two questions that can stop early do NOT come through here, and the reason is size: a real
 * transcript is a couple of megabytes and a hook fires on every tool call, so parsing twenty
 * thousand records to read one number is a cost paid on every keystroke. They walk the raw lines
 * from whichever end answers first, through the same `parseLine` — one rule about what a line is,
 * three ways of arriving at it.
 */
export declare function transcriptLines(jsonl: string): TranscriptLine[];
/** The token counts one `usage` record carries. */
export interface Usage {
    readonly input_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
}
/**
 * The context size a `usage` record represents — input plus BOTH cache buckets.
 *
 * Verified on a real transcript, and the reason the sum is spelled out: `input_tokens` alone is
 * about nil, because the context lives in `cache_read_input_tokens`. A counter that summed the
 * obvious field read ~0 forever, which looks exactly like a session that never drifts.
 */
export declare function contextTokens(usage: Usage | undefined): number;
/**
 * How far this session has drifted, in context tokens — the FOURTH question, and drift's one input.
 *
 * The LAST message carrying usage, because that is the current size; an earlier one describes a
 * context that no longer exists. Unreadable or absent is 0, which the engine reads as "no drift
 * yet": a note then shows at its first moment and not again, which is the harmless direction.
 */
export declare function tokensFromTranscript(jsonl: string): number;
export declare function isInjected(prose: string): boolean;
/**
 * What the actor did THIS TURN, in order — the fact a turn-end check is handed.
 *
 * The turn starts at the last thing the human typed, or at the last background task's notice
 * when one woke the agent after it (`isTaskNotice`). That is a real narrowing of the rule this
 * replaces, which walked the whole file: over one turn the two agree (the check compares the last
 * edit against the last run), but over a resumed session of forty turns the old one was answering
 * about work from hours ago while its message said "this turn".
 *
 * And what comes back is a NARROW, harness-neutral answer — an ordered list of edits and runs —
 * rather than the transcript itself. The rule this replaces read `$WORK_TURN_TRANSCRIPT` from the
 * environment, opened the file and parsed this JSONL inside the check: three reads of the world in
 * the one place the design forbids them, and it made that rule the only core rule no case could
 * drive.
 */
export declare function turnActions(jsonl: string, root?: string): TurnAction[];
/**
 * The brief a session was started with, verbatim — the first thing the human, or the spawning
 * agent, said.
 *
 * It is rung 2 of the settled classification order, and only rung 2: a brief is consulted for
 * generic spawn buckets and never for a specifically-typed one, because a brief QUOTES — four
 * verifier briefs in the 335-transcript probe matched builder patterns, since a verifier is briefed
 * with what the builder claimed to have done. That rule is enforced in the engine's `spawnedAs`;
 * what this owes is the text, honestly and whole, capped only so a runaway paste cannot become the
 * thing every classifier scans.
 */
export declare function briefHead(jsonl: string, cap?: number): string;
/**
 * The folder a working directory's transcripts live in.
 *
 * Every character that is not a letter or a digit becomes a dash — verified against all 63 folders
 * on this machine carrying a readable cwd, with zero mismatches, rather than taken from a summary.
 * A dot is not special: `/Users/x/.hidden/y` yields a doubled dash, and that doubling is the check
 * that this is the real rule rather than a hand-written approximation (the old signposts spelling
 * was `[/.]` and was wrong for an underscore or a space).
 *
 * THE RULE IS NOT INVERTIBLE, and that matters more here than anywhere else it is used: a folder
 * named `…-workbench-workflow-flow` is `workbench.workflow-flow` and `workbench/workflow/flow` and
 * `workbench_workflow_flow`, all three. Which worktree a transcript belongs to is answered by the
 * `cwd` field the host writes INSIDE the records — see `cwdOf` — never by reading the name back.
 */
export declare function projectFolderName(cwd: string): string;
/**
 * A flat listing of a project folder, sorted into the transcripts worth reading.
 *
 * Two shapes count and nothing else does: `<session>.jsonl` at the top (a conversation somebody
 * sat in front of) and `<session>/subagents/<agent>.jsonl` (a child it spawned). A worktree holds
 * several sessions — a chat resumed on another day is a second file — so every one is enumerated
 * rather than a newest being picked.
 *
 * Anything else comes back as IGNORED rather than being silently skipped, because "the folder held
 * something I did not understand" is a fact a reader should be able to see. A `.meta.json` is the
 * one exception: it is read through the transcript it belongs to, so naming it would be noise.
 */
export declare function classifyStore(paths: readonly string[]): {
    transcripts: TranscriptRef[];
    ignored: string[];
};
/**
 * The path of THIS agent's own transcript, from a live payload — null when the payload names none.
 *
 * On a subagent's call the host sends the PARENT's `transcript_path`, and keeps the subagent's own
 * transcript under it, in the store's layout: `…/<session>.jsonl` →
 * `…/<session>/subagents/agent-<agent_id>.jsonl`. The parent's path is the parent's transcript.
 * Null too when a subagent's half is not what that layout needs — an id that could step out of the
 * folder included, since it becomes part of a path that is then read.
 */
export declare function ownTranscriptPath(payload: HookPayload): string | null;
/** A sidecar's text → what it says. Null when it is absent or will not parse. */
export declare function spawnMeta(raw: string | null): SpawnMeta | null;
/**
 * A conversation's opening facts, in ONE pass, stopping as soon as all three are known.
 *
 * It was three functions and therefore three parses of the same multi-megabyte file, once per
 * conversation in the store — a cost paid on every `flow facts` run for an answer that is in the
 * first few records. The file opens with stub records (last-prompt, mode, permission-mode) that
 * carry no fields at all, so a literal first line is never enough and the walk has to be able to
 * continue; what it must not do is start over twice.
 */
export declare function transcriptHead(jsonl: string): TranscriptHead;
/**
 * Every spawn a parent transcript made, by tool_use id — the parent's half of the join.
 *
 * It is the WEAKER half and is read as such: what the parent asked for is a claim by the session
 * being classified, while the sidecar is host-written and unforgeable, and so outranks it here.
 * Neither decides who a live session is: classification (engine, `spawnedAs`) reads the agent type
 * in the hook message. What this is for is everything the sidecar cannot say — when the spawn
 * happened, and where in the parent's own transcript to look.
 */
export declare function spawnsIn(jsonl: string): Map<string, Spawn>;
/**
 * A transcript → the narrative events in it: typed prompts, tool calls, and their results.
 *
 * The PAIRING is this function's own — a `tool_use` block carries the id its `tool_result` answers
 * to, and matching them is what turns a flat file into "the agent tried X and got back Y". The
 * old engine did this over its own `JSON.parse` and its own type switch, beside the corpus reader
 * doing the same over the same files, so "what is an assistant line" had two answers free to
 * drift. It reads through `transcriptLines` now, and owns only the pairing.
 */
export declare function parseEvents(jsonl: string, root?: string, home?: string): TranscriptEvent[];
/**
 * The tools that CHANGE a file: which names count as an edit is this harness's knowledge, and this
 * is the one set. The recorder and the turn-end rule both read it, so a notebook edit is work for both.
 */
export declare const EDIT_TOOLS: ReadonlySet<string>;
/** The file an edit tool's call (`EDIT_TOOLS`) names, as named; null for any other call, or none named. */
export declare function editedFile(payload: HookPayload): string | null;
/**
 * The repo's own Claude Code settings file, relative to the repo root: guarded here, where `flow init`
 * registers flow's hooks, and where `flow uninstall` takes them out.
 */
export declare const REPO_SETTINGS = ".claude/settings.json";
/**
 * The HOST's half of the guard: where the hooks that invoke any of it are registered.
 *
 * Fixed, because these are the harness's own file names and not a repo's choice — unlike the
 * repo's half, which `guardPaths` reads out of the config's imports.
 *
 * THE GUARD PACK KEEPS ITS OWN, WIDER LIST, and the difference is deliberate — this is the one
 * place that says so, because two lists that look like copies are read as drift until somebody
 * checks. Two things separate them:
 *
 *   · They answer different questions. This list feeds `weakenedAfterBlock`, which reports "a rail
 *     refused, and then somebody edited the guard" — so it holds only files that can WEAKEN a
 *     rule the engine enforces. The pack's `editingTheGuardrails` is a nudge before you type, and
 *     it adds `.claude/skills/**`: a skill is prose an agent reads, so editing one is worth a
 *     word of caution and is not evidence that a guardrail was loosened. Merged, every skill edit
 *     after any block would be reported as a possible weakening, and the report earns its keep
 *     only while every line in it is worth reading.
 *   · Neither may import the other, and the shared home would be worse than the duplication.
 *     `flow-packs → flow-adapter` is fenced (a pack must not be able to tell which harness is
 *     running it) and so is the way back, so a shared constant could only live in the public
 *     door — which would put one harness's file names into the GRAMMAR every config is written
 *     in, and that is the coupling the fence exists to prevent.
 */
export declare const HOST_SURFACE: readonly string[];
/**
 * The auto-mode steer a conversation is under, from the LAST auto-mode attachment in its transcript
 * — or null when it has none, or the last one is the host leaving auto mode.
 *
 * Read from the END, and only lines that name the attachment are parsed: a transcript is a couple
 * of megabytes and the answer is one record.
 */
export declare function steerOf(jsonl: string): Steer | null;
/**
 * The agent a session runs as (`--agent`, or the `agent` setting), from its own transcript — or
 * null when it runs as none.
 *
 * The host writes it as an `agent-setting` record, again as the session goes on. Read from the END,
 * and only lines that name the record are parsed, as `steerOf` does: the answer is one record.
 */
export declare function agentSettingOf(jsonl: string): string | null;
/**
 * The command each registration runs: the repo's own `@jawache/flow` first, then the PATH's.
 *
 * The host runs it through a shell with `$CLAUDE_PROJECT_DIR` set to the repo, so a repo with flow
 * only as a dev dependency answers its hooks, and its lockfile's version wins over a global one. It
 * runs the package's own file, by path, never a `flow` in node_modules/.bin, which any package can
 * put there. The same command goes in either settings file, so the host, which merges identical
 * commands, runs it once when it is in both.
 */
export declare function hookCommand(hook: HookEvent): string;
/** What `flow init`, `flow status` and `flow uninstall` ask of Claude Code's settings file, and the two readers of a command that `flow init` also uses. */
export declare const ourHookCommand: (command: string) => boolean, bareHook: (command: string) => HookEvent | null, hooksFile: {
    hooks: readonly import("../harness.ts").HookCost[];
    registrations: readonly import("../harness.ts").Registration[];
    registeredEvents: (settings: unknown) => string[];
    staleRegistrations: (settings: unknown) => string[];
    bareRegistrations: (settings: unknown) => string[];
    withRegistrations: (settings: unknown) => {
        settings: unknown;
        changed: string[];
    };
    withoutRegistrations: (settings: unknown) => {
        settings: unknown;
        removed: string[];
    };
};
