// flow/adapter/codex/domain.ts — THE CODEX DIALECT, as pure decisions: which payloads are Codex's, what a
// Codex transcript says, where Codex keeps its transcripts, and what its hooks file holds and flow writes
// there. The hook payload and the answers are every harness's and are in ../domain.ts, and so is the code
// that reads and writes a hooks file: Codex's `hooks.json` is shaped as Claude Code's settings file is.
//
// Codex's own words are in docs/user/reference/codex.md. A transcript is JSONL of `{timestamp, type,
// payload}` records: `event_msg` records say what happened, and flow reads three of them — the
// `token_count` rows for the context's size, a `UserMessage` item for a prompt and a `CommandExecution` item
// for a shell command.

import { parseShellSteps, type TurnAction } from "../../language/domain.ts";
import { bashReads, hooksFileOf, repoFirst, text, type HooksFileHook, type HookEvent } from "../domain.ts";
import type { HookPayload, ModelRequest, SpawnMeta, TranscriptEvent, TranscriptHead, TranscriptRef } from "../harness.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHICH PAYLOADS ARE CODEX'S
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Where Codex keeps a session's transcript: `<codex home>/sessions/<year>/<month>/<day>/rollout-<start
 * time>-<id>.jsonl`. A payload's `transcript_path` names it.
 */
const ROLLOUT = /[\\/]\.?codex[\\/]sessions[\\/]|[\\/]rollout-[^\\/]*\.jsonl$/;

/**
 * Is this payload Codex's?
 *
 * Claude Code and Codex call the same `flow hook <event>`, so the payload tells them apart. Two marks, and
 * either is enough: every payload of a call carries `turn_id`, which Claude Code never sends, and the
 * transcript it names is a Codex rollout. A `SessionStart` whose `transcript_path` is null carries neither,
 * and is taken for Claude Code's: the first harness is the one a payload that says nothing is run as.
 */
export function claimsPayload(payload: HookPayload): boolean {
  if (typeof payload["turn_id"] === "string" && payload["turn_id"] !== "") return true;
  return typeof payload.transcript_path === "string" && ROLLOUT.test(payload.transcript_path);
}

/**
 * The transcript of the agent a payload came from, or null when it names none. At a `SubagentStop` Codex
 * names the subagent's own, `agent_transcript_path`; every other payload names the session's.
 */
export function ownTranscriptPath(payload: HookPayload): string | null {
  const own = payload["agent_transcript_path"];
  if (typeof own === "string" && own !== "") return own;
  return typeof payload.transcript_path === "string" && payload.transcript_path !== "" ? payload.transcript_path : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HOOKS FILE — what flow registers in `.codex/hooks.json`
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The repo's own Codex hooks file, relative to the repo root: where `flow init` registers flow's hooks and `flow uninstall` takes them out. */
export const REPO_HOOKS = ".codex/hooks.json";

/** The files that steer Codex here — its hooks, its config, its agent definitions — guarded like flow's own config. */
export const HOST_SURFACE: readonly string[] = [REPO_HOOKS, ".codex/config.toml", ".codex/agents/**"];

/**
 * The six hooks, as docs/user/reference/codex.md lists them. A hook with no matcher runs for every source,
 * agent or tool; `PreToolUse` takes `Bash`, the one thing flow refuses before it happens.
 */
const REGISTERED: readonly HooksFileHook[] = [
  { hook: "session-start", unregistered: "no note is shown when a session starts" },
  { hook: "subagent-start", unregistered: "no note is shown when a subagent starts" },
  { hook: "pre-tool-use", matcher: "Bash", unregistered: "no rule judges a command before it runs" },
  { hook: "post-tool-use", unregistered: "no note is shown for the file a tool call changed" },
  { hook: "stop", unregistered: "no turn-end rule runs when the main chat hands back" },
  { hook: "subagent-stop", unregistered: "no turn-end rule runs when a subagent hands back" },
];

/**
 * The command each registration runs: the repo's own `@jawache/flow` first, then the PATH's. Codex runs a
 * hook in the folder the session runs in, which may be inside the repo, so git finds the repo from there.
 */
export function hookCommand(hook: HookEvent): string {
  return `${repoFirst("$(git rev-parse --show-toplevel)", `hook ${hook}`)}; exec flow hook ${hook}`;
}

/** What `flow init`, `flow status` and `flow uninstall` ask of Codex's hooks file. */
export const hooksFile = hooksFileOf({ registered: REGISTERED, retired: new Map(), command: hookCommand });

/** The words after `flow hook` that Codex calls, in the order flow registers them. */
export const HOOK_WORDS: readonly HookEvent[] = REGISTERED.map(({ hook }) => hook);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT — a Codex rollout
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** One record of a rollout, parsed: its line, its time, its `type` and its `payload`. */
interface Rollout {
  readonly line: number;
  readonly ts: string | null;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** The records of a rollout, in order. A line that will not parse, or is not a record, is skipped. */
function rollout(jsonl: string): Rollout[] {
  const out: Rollout[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw.trim() === "") continue;
    try {
      const held = JSON.parse(raw) as Record<string, unknown> | null;
      const payload = held?.["payload"];
      if (typeof held?.["type"] !== "string" || !payload || typeof payload !== "object") continue;
      out.push({ line: i + 1, ts: typeof held["timestamp"] === "string" ? held["timestamp"] : null, type: held["type"], payload: payload as Record<string, unknown> });
    } catch {
      continue;
    }
  }
  return out;
}

/** The item a record completed (`item_completed`), of one kind, or null. */
function completed(record: Rollout, kind: string): Record<string, unknown> | null {
  if (record.type !== "event_msg" || record.payload["type"] !== "item_completed") return null;
  const item = record.payload["item"] as Record<string, unknown> | undefined;
  return item?.["type"] === kind ? item : null;
}

/** What the human typed, from a `UserMessage` item: its text parts, joined. */
function promptOf(item: Record<string, unknown>): string {
  const parts = Array.isArray(item["content"]) ? (item["content"] as { type?: unknown; text?: unknown }[]) : [];
  return parts.map((part) => (part.type === "text" ? text(part.text) : "")).join("\n").trim();
}

/** The shell line a `CommandExecution` item ran: what Codex parsed out of it, else the last word of the shell's own argv. */
function commandOf(item: Record<string, unknown>): string {
  const parsed = Array.isArray(item["parsed_cmd"]) ? (item["parsed_cmd"] as { cmd?: unknown }[]) : [];
  const first = text(parsed[0]?.cmd);
  if (first !== "") return first;
  const argv = Array.isArray(item["command"]) ? (item["command"] as unknown[]) : [];
  return text(argv[argv.length - 1]);
}

/**
 * How many tokens the conversation's context holds now: the `input_tokens` of the last request, from
 * the last `token_count` row that has usage. Codex counts the cached tokens inside `input_tokens`. A row
 * with no `info`, which a session's first rows can be, says nothing, and no row at all is 0: a
 * breadcrumb is then not shown again as the context grows.
 */
export function tokensFromTranscript(jsonl: string): number {
  const records = rollout(jsonl);
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i] as Rollout;
    if (record.type !== "event_msg" || record.payload["type"] !== "token_count") continue;
    const info = record.payload["info"] as { last_token_usage?: { input_tokens?: unknown } } | null | undefined;
    const used = info?.last_token_usage?.input_tokens;
    if (typeof used === "number" && Number.isFinite(used)) return used;
  }
  return 0;
}

/**
 * The model requests a rollout holds: one for each `token_count` row that has usage and whose running total moved
 * since the row before, because Codex writes the same row again when nothing was sent. A request's context is its
 * `input_tokens`, which counts the cached ones, and its model is the one the latest `turn_context` record named.
 */
export function requestsOf(jsonl: string): ModelRequest[] {
  const out: ModelRequest[] = [];
  let model: string | null = null;
  let seen = -1;
  for (const record of rollout(jsonl)) {
    if (record.type === "turn_context") model = text(record.payload["model"]) || model;
    if (record.type !== "event_msg" || record.payload["type"] !== "token_count") continue;
    const info = record.payload["info"] as { total_token_usage?: { total_tokens?: unknown }; last_token_usage?: { input_tokens?: unknown } } | null | undefined;
    const used = info?.last_token_usage?.input_tokens;
    if (typeof used !== "number" || !Number.isFinite(used)) continue;
    const total = info?.total_token_usage?.total_tokens;
    if (typeof total === "number") {
      if (total === seen) continue;
      seen = total;
    }
    out.push({ line: record.line, model, context: used });
  }
  return out;
}

/**
 * What the agent did this turn, in order: every shell command since the turn started. A Codex agent
 * changes files through the shell, so a command is the only action there is to count.
 */
export function turnActions(jsonl: string): TurnAction[] {
  const records = rollout(jsonl);
  let from = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if ((records[i] as Rollout).payload["type"] === "task_started") {
      from = i;
      break;
    }
  }
  const out: TurnAction[] = [];
  for (const record of records.slice(from)) {
    const item = completed(record, "CommandExecution");
    if (item !== null && commandOf(item) !== "") out.push({ did: "run", command: commandOf(item) });
  }
  return out;
}

/** The brief a session was started with: the first thing a human typed, capped. */
export function briefHead(jsonl: string, cap = 8000): string {
  for (const record of rollout(jsonl)) {
    const item = completed(record, "UserMessage");
    if (item !== null) return promptOf(item).slice(0, cap);
  }
  return "";
}

/**
 * A rollout → the narrative events in it: typed prompts, shell commands and what they printed. A
 * command and its result are one `CommandExecution` item, whose id is the `tool_use_id` of the hook
 * payloads about the same call.
 */
export function parseEvents(jsonl: string, root = "", home?: string): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  let cwd = root;
  for (const record of rollout(jsonl)) {
    if (record.type === "session_meta") cwd = text(record.payload["cwd"]) || root;
    const prompt = completed(record, "UserMessage");
    if (prompt !== null) {
      out.push({ line: record.line, kind: "prompt", text: promptOf(prompt) });
      continue;
    }
    const item = completed(record, "CommandExecution");
    if (item === null) continue;
    const command = commandOf(item);
    const id = text(item["id"]);
    const where = { cwd, root, home };
    const reads = root === "" ? [] : bashReads(parseShellSteps(command, where), where).reads;
    out.push({ line: record.line, kind: "use", ts: record.ts, id, name: "Bash", action: "shell", input: { command }, path: "", ...(reads.length === 0 ? {} : { reads }) });
    out.push({ line: record.line, kind: "result", id, content: text(item["aggregated_output"]), failed: typeof item["exit_code"] === "number" && item["exit_code"] !== 0 });
  }
  return out;
}

/** A rollout's first facts: when it started, in which folder and on which branch, from its `session_meta` record. */
export function transcriptHead(jsonl: string): TranscriptHead {
  for (const record of rollout(jsonl)) {
    if (record.type !== "session_meta") continue;
    const git = record.payload["git"] as { branch?: unknown } | undefined;
    return { cwd: text(record.payload["cwd"]) || null, branch: text(git?.branch) || null, started: text(record.payload["timestamp"]) || record.ts };
  }
  return { cwd: null, branch: null, started: null };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STORE — where Codex keeps its transcripts
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The files of Codex's `sessions/` folder, each with the first record it holds, sorted into the rollouts
 * and the rest. A top-level rollout is a session of its own. A subagent's is told by its `session_meta`,
 * which names the subagent's own id in `id` and its parent's session in `session_id`: it joins that
 * session as the agent of that id. Codex keeps one folder per day for every project on the machine, so
 * which rollout is this repo's is answered from inside it, by `transcriptHead`'s `cwd`.
 */
export function classifyStore(files: readonly { readonly path: string; readonly first: string }[]): { transcripts: TranscriptRef[]; ignored: string[] } {
  const transcripts: TranscriptRef[] = [];
  const ignored: string[] = [];
  for (const { path, first } of files) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const id = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(name)?.[1];
    if (id === undefined) {
      ignored.push(path);
      continue;
    }
    const meta = rollout(first)[0];
    const parent = meta?.type === "session_meta" && meta.payload["thread_source"] === "subagent" ? text(meta.payload["session_id"]) : "";
    transcripts.push(parent === "" ? { path, meta: null, session: id, agent: null } : { path, meta: null, session: parent, agent: id });
  }
  return { transcripts, ignored };
}

/** Codex writes no sidecar beside a subagent's transcript. */
export function spawnMeta(): SpawnMeta | null {
  return null;
}
