// flow/adapter/harness.ts — THE HARNESS SEAM: what flow needs from the program that runs the agent.
//
// A harness is a program that runs an agent and calls flow's hooks. flow's own product — `flow init`, `flow status`,
// `flow uninstall`, `flow facts`, the git hook and the engine — knows the harness only as the
// `Harness` below, and names none. Everything that is one harness's own (its hook names, its payload
// fields, its settings file, its transcript) lives in one folder for that harness, and the import
// fence in guards/house.ts refuses a file outside that folder importing it. flow.ts, the one file
// that chooses a harness, is the only exception.
//
// FIVE THINGS FLOW ASKS OF A HARNESS, and the interface has one member for each:
//
//   the events it is called with   `events`, and `claims` tells its payload from another's → HookPayload
//   the replies flow gives         `HookResult`: stdout, stderr, an exit code
//   registering                    `registering`: where the harness's settings live, what flow adds
//   the type of the agent acting   carried in what `run` hands the engine (`AgentOf`, engine/domain.ts)
//   the transcript reads           `transcripts`: the harness's store, read after the fact, and the
//                                  session's own transcript, read as a hook runs
//
// This file is types only, and is the leaf of the adapter: it imports from the two layers upstream
// and from nothing in its own folder, so the product's pure home and the harness's can both import it
// without a cycle.

import type { BreadcrumbMoment, GuardrailMoment, TurnAction } from "../language/domain.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESULTS — effects become an exit code, a line on stderr, or a decision object
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What the binary prints and exits with. The three IO edges as data, so a test can read them. */
export interface HookResult {
  /** stdout — a JSON decision the host reads. Empty means nothing to say. */
  readonly stdout: string;
  /** stderr — the refusal, shown to the model on exit 2 and to the human otherwise. */
  readonly stderr: string;
  /** 0 allows; 2 blocks. Never anything else — those are the host's two codes. */
  readonly exitCode: 0 | 2;
}

/**
 * One hook payload, as a harness writes it on stdin.
 *
 * Deliberately loose, every field optional: it is JSON from another program, so a shape this file
 * DEMANDS is a shape that breaks the day the host adds a field or omits one. The index signature is
 * not laziness either — F5's archival side reads keys this phase has no use for, and a payload
 * narrowed on the way in cannot grow them back. Claude Code and Codex send these fields under these
 * names.
 */
export interface HookPayload {
  readonly session_id?: string;
  /** The folder the harness ran the hook in: where a shell command starts. */
  readonly cwd?: string;
  /** Present on every call a SUBAGENT makes, and only then: the host's id for that one spawn. */
  readonly agent_id?: string;
  /**
   * The agent type the host started this subagent as, sent beside `agent_id` on its every call.
   * Host-written: the session cannot change the message, which is why a category may key on it.
   */
  readonly agent_type?: string;
  readonly hook_event_name?: string;
  readonly transcript_path?: string | null;
  readonly stop_hook_active?: boolean;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  /** SessionStart's reason: `startup` · `resume` · `clear` · `compact` — the compaction announcement. */
  readonly source?: string;
  /**
   * The permission mode the session runs under (`default` · `acceptEdits` · `plan` · `auto` · …),
   * as the host states it on every call. Recorded and reported; never a category key.
   */
  readonly permission_mode?: string;
  readonly [key: string]: unknown;
}

/** One transcript file worth reading, and the sidecar beside it. */
export interface TranscriptRef {
  /** Relative to the project folder. */
  readonly path: string;
  /** The sidecar's path, only when the listing actually held it — never a probe. */
  readonly meta: string | null;
  readonly session: string;
  /** Null for a top-level session; the harness's id for a subagent. */
  readonly agent: string | null;
}

/**
 * The sidecar the host writes beside every subagent transcript, read.
 *
 * `toolUseId` is the field that makes this more than a label: it is the id of the parent's own
 * `Agent` tool call, so a sidecar and the block that spawned it join exactly. That join names an
 * actor for cost attribution, after the fact — the sidecar says what a spawn WAS, the parent's
 * block says when it happened and what it was asked for, and neither alone answers both. A live
 * session is not classified from it: that reads the agent type in its hook message.
 */
export interface SpawnMeta {
  readonly agentType: string | null;
  readonly description: string | null;
  /** The parent's tool_use id. Null on a sidecar written before the field existed. */
  readonly toolUseId: string | null;
  /** The model the spawn asked for — an alias like `opus`, never the served model id. */
  readonly model: string | null;
  readonly spawnDepth: number | null;
}

/** The three things knowable about a conversation without reading what was said in it. */
export interface TranscriptHead {
  /**
   * The working directory it was recorded in — THE ONLY HONEST ANSWER to "which worktree is this".
   *
   * `projectFolderName` collapses dots, slashes and underscores into one character, so two
   * worktrees of one repo — `workbench` and `workbench.workflow-flow` — share a folder name and a
   * reader that inverted it would attribute one checkout's conversations to the other.
   */
  readonly cwd: string | null;
  readonly branch: string | null;
  /** When it started, as the host stamped it. */
  readonly started: string | null;
}

/** One spawn as the PARENT recorded it: the tool call, joined to the sidecar by its id. */
export interface Spawn {
  readonly toolUseId: string;
  /** What the parent asked for — its own claim, which the sidecar's `agentType` outranks. */
  readonly asked: string | null;
  readonly description: string | null;
  readonly ts: string | null;
  readonly line: number;
}

/** What a tool call did, whichever harness's tool it was: `write` makes a whole file, `edit` changes part of one. */
export type ToolAction = "edit" | "write" | "read" | "shell" | "other";

/** One thing that happened in a conversation, with the line it happened on. */
export type TranscriptEvent =
  | { readonly line: number; readonly kind: "prompt"; readonly text: string }
  | { readonly line: number; readonly kind: "result"; readonly id: string; readonly content: string; readonly failed: boolean }
  | {
      readonly line: number;
      readonly kind: "use";
      readonly ts: string | null;
      readonly id: string;
      readonly name: string;
      /** What the call did, in flow's own words: the harness maps its tool names to one of these. */
      readonly action: ToolAction;
      readonly input: Record<string, unknown>;
      /** The file the call names, repo-relative. Empty when it names none. */
      readonly path: string;
      /** The repo files a Bash call reads by name (`bashReads`), when it reads any. */
      readonly reads?: readonly string[];
    };

// ── what the session ran under, and where the host's view of a call differed ──

/**
 * Whether the harness's auto mode is steering the session towards shell edits — `bashFirst` on the
 * host's auto-mode attachment, which tells the model to read with `cat` and change files with `sed`,
 * heredocs and scripts rather than Read, Edit and Write. `variant` is the host's own word for how hard
 * (`strict` · `relaxed`), when it gave one.
 */
export interface Steer {
  readonly shellFirst: boolean;
  readonly variant: string | null;
}

// ── what the host is told to call ────────────────────────────────────────────

/** One entry in a settings file's hook array: the command, and what it fires on. */
export interface Registration {
  /** The host's own name for the event — `SessionStart`, `PreToolUse`, … */
  readonly event: string;
  readonly command: string;
  /** The host's `matcher`. Absent means every occurrence of the event. */
  readonly matcher?: string;
}

/** One conversation in the store, with everything findable about it without opening it twice. */
export interface StoredTranscript {
  readonly ref: TranscriptRef;
  readonly file: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface Store {
  /** Where we looked, whether or not it was there — so a miss can name the path. */
  readonly dir: string;
  readonly exists: boolean;
  readonly transcripts: readonly StoredTranscript[];
  /** Files in the folder that are not transcripts. Reported, never guessed at. */
  readonly ignored: readonly string[];
}

/** The moments a harness delivers, for each kind of entry. The honest list: never a faked one. */
export interface Delivered {
  readonly guard: readonly GuardrailMoment[];
  readonly brief: readonly BreadcrumbMoment[];
}

/** One hook flow registers: the host's name for its event, and what goes unjudged without it. */
export interface HookCost {
  readonly event: string;
  readonly unregistered: string;
}

/**
 * WHERE A HARNESS'S SETTINGS ARE, and what flow writes into them. Pure: every function takes what
 * the shell read and answers what to write.
 */
export interface Registering {
  /** The repo's own settings file for this harness, relative to the repo root. */
  readonly repoFile: string;
  /** The files that steer this harness — its settings, its agent definitions — guarded like the config. */
  readonly hostSurface: readonly string[];
  /** The hooks flow registers, in order, each with what goes unjudged without it. */
  readonly hooks: readonly HookCost[];
  /** What flow writes, one per event. */
  readonly registrations: readonly Registration[];
  /** The events this settings file calls flow for. */
  readonly registeredEvents: (settings: unknown) => string[];
  /** The events it calls flow for with a command that is not today's. */
  readonly staleRegistrations: (settings: unknown) => string[];
  /** The events it calls flow for in the old, bare shape. */
  readonly bareRegistrations: (settings: unknown) => string[];
  /** A settings file with flow's registrations added. A new object, never a mutation. */
  readonly withRegistrations: (settings: unknown) => { settings: unknown; changed: string[] };
  /** A settings file with flow's registrations taken out. */
  readonly withoutRegistrations: (settings: unknown) => { settings: unknown; removed: string[] };
}

/** The harness's transcripts. Each takes text a shell already read. */
export interface Transcripts {
  /** The session's own transcript as a hook payload names it: a subagent's own, never its parent's. Null when there is none. */
  readonly own: (payload: HookPayload) => string | null;
  /** How many tokens the conversation holds in its context now, for `driftTokens`. 0 when it cannot say. */
  readonly tokens: (jsonl: string) => number;
  /** What the agent did this turn, for the turn-end rules. */
  readonly turn: (jsonl: string, root: string) => TurnAction[];
  /** The brief a session was started with, whole: what a category recognises a generic spawn by. */
  readonly brief: (jsonl: string) => string;
  /** The agent the session itself runs as (`--agent`, or its setting), read from the parent's transcript; null when it runs as none. */
  readonly sessionAgent: (jsonl: string) => string | null;
  /** The store as it stands for a working directory. A missing folder is a fact, not an error. */
  readonly readStore: (cwd: string, home?: string) => Store;
  /** One transcript's bytes, and the sidecar beside it if there is one. */
  readonly readTranscript: (dir: string, held: StoredTranscript) => { jsonl: string; meta: SpawnMeta | null };
  /** What the conversation did, in order. */
  readonly events: (jsonl: string, root?: string, home?: string) => TranscriptEvent[];
  /** The conversation's first facts: when it started, on which branch, in which folder. */
  readonly head: (jsonl: string) => TranscriptHead;
  /** The subagents the conversation started, by the host's id for each. */
  readonly spawns: (jsonl: string) => Map<string, Spawn>;
  /** The sidecar's text, read. */
  readonly spawnMeta: (raw: string | null) => SpawnMeta | null;
  /** What the session ran under: the permission mode, and whether the host steers it towards shell edits. */
  readonly steer: (jsonl: string) => Steer | null;
}

/** What flow's own verbs decide with: the harness's name, the moments it delivers and what it registers. */
export type HarnessFacts = Pick<Harness, "id" | "name" | "delivers" | "registering" | "detect" | "trustNote" | "noHookNote">;

/**
 * A harness, as the rest of flow sees it.
 *
 * `run` is the live half and the rest is what a person's verbs need: `flow init` registers through
 * `registering`, `flow status` reports what the harness delivers, `flow facts` reads `transcripts`.
 */
export interface Harness {
  /** The name `flow init --harness` takes, and the name the session log's first row holds. */
  readonly id: string;
  /** What messages call it, as a sentence names a program. */
  readonly name: string;
  /** The words after `flow hook` that this harness calls, in the order it registers them. */
  readonly events: readonly string[];
  /** The moments it delivers. */
  readonly delivers: Delivered;
  /** Is this payload this harness's? Two harnesses call the same `flow hook <event>`, so the payload says which one did. */
  readonly claims: (payload: HookPayload) => boolean;
  /** The repo a hook stands in, from the folder the harness ran it in. */
  readonly projectRoot: (cwd: string) => string;
  /** How `flow init` finds the harness in a repo: its folder there, and its program on the `PATH`. */
  readonly detect: { readonly folder: string; readonly program: string };
  /** What a person must do in the harness before it runs flow's hooks, or null when nothing. `flow init` warns of it. */
  readonly trustNote: string | null;
  /** What `flow status` says beside a registered harness none of whose hooks has run: the likely reason, or null when there is none to give. */
  readonly noHookNote: string | null;
  /** The harness's machine-wide settings file, where flow 0.3 wrote. Read for a warning, and cleaned by `flow uninstall --machine`: never written by `flow init`. */
  readonly machineSettingsPath: () => string;
  readonly registering: Registering;
  readonly transcripts: Transcripts;
}
