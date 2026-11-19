// flow/adapter/claude/domain.ts — THE CLAUDE CODE DIALECT, as pure decisions: what a transcript line
// means, where the host keeps its transcripts, and what its settings file holds and flow writes there.
// The hook payload and the answers are every harness's and are in ../domain.ts.

import { parseShellSteps, type TurnAction } from "../../language/domain.ts";
import { bashReads, hooksFileOf, type HooksFileHook, relativise, repoFirst, text, type HookEvent } from "../domain.ts";
import type { HookPayload, ToolAction, Spawn, SpawnMeta, Steer, TranscriptEvent, TranscriptHead, TranscriptRef } from "../harness.ts";



// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT — the session log's dialect, and the three questions it answers
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// A Claude Code transcript is JSONL, one record per line, and reading it is the deepest harness
// knowledge in the system. It lived in three places in the old engine — a token counter in a pure
// breadcrumb module, a tool-use parser inside a rule script that found its file through an
// environment variable, and an event parser in the report layer — which is exactly why "what does a
// transcript line mean" had three answers free to drift apart.
//
// ONE READER here, and three consumers on top of it: how far the session has drifted, what the
// actor did this turn, and the brief it was started with. F5's archival side extends the same
// reader for the narrative half (prompts, tool results, corrections); none of that shape is decided
// here.

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
 * ONE line of a transcript, or null when it is not one — THE reader, and the only place a
 * transcript's file format is decided.
 *
 * A transcript is appended to live by the very session doing the reading, so the last line can be
 * caught mid-write. One unreadable line is not the rest of the history's problem.
 */
function parseLine(raw: string, line = 0): TranscriptLine | null {
  const record = parseObject(raw);
  if (record === null) return null;
  const ts = text(record["timestamp"]);
  return { kind: text(record["type"]), record, line, ts: ts === "" ? null : ts };
}

/**
 * JSON that should be an object, or null — THE reader, and there is one because there is one rule.
 *
 * Two files answer to it: a transcript line and a sidecar. Both are read off disk, both can be
 * hand-edited, half-written or simply not what was expected, and "an array parses fine and is not a
 * record" is the sort of thing two copies of this would eventually disagree about.
 */
function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === "") return null;
  let held: unknown;
  try {
    held = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof held === "object" && held !== null && !Array.isArray(held) ? (held as Record<string, unknown>) : null;
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
export function transcriptLines(jsonl: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const raws = jsonl.split("\n");
  for (let i = 0; i < raws.length; i++) {
    const line = parseLine(raws[i] as string, i + 1);
    if (line !== null) out.push(line);
  }
  return out;
}

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
export function contextTokens(usage: Usage | undefined): number {
  return (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
}

/**
 * How far this session has drifted, in context tokens — the FOURTH question, and drift's one input.
 *
 * The LAST message carrying usage, because that is the current size; an earlier one describes a
 * context that no longer exists. Unreadable or absent is 0, which the engine reads as "no drift
 * yet": a note then shows at its first moment and not again, which is the harmless direction.
 */
export function tokensFromTranscript(jsonl: string): number {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const message = parseLine(raw[i] as string)?.record["message"] as { usage?: Usage } | undefined;
    if (message?.usage) return contextTokens(message.usage);
  }
  return 0;
}

/**
 * Text on a `user` line that the HUMAN did not type — the harness talking to itself.
 *
 * It matters because the turn boundary is "the last thing the human said", and a hook's own
 * injected context arrives wearing a user message's clothes. Reading one as a boundary would empty
 * the turn's actions exactly when a turn-end rule needs them.
 */
const INJECTED = [
  "<system-reminder>",
  "<command-name>",
  "<command-message>",
  "<local-command",
  "<user-prompt-submit-hook",
  "Caveat:",
  "Result of calling",
  "This session is being continued",
  "[Request interrupted",
  "DO NOT respond",
  "<budget:",
  "tool_use_id",
];

export function isInjected(prose: string): boolean {
  const start = prose.trimStart();
  // The `includes` tail is not slack: a reminder is sometimes prefixed by a line of the host's own
  // framing before the tag, and a turn boundary read off that line would empty the turn's actions
  // exactly when a turn-end rule needs them. The window is short enough that prose ABOUT a
  // system-reminder — which a session discussing this file writes constantly — is not caught.
  return INJECTED.some((mark) => start.startsWith(mark)) || start.slice(0, 40).includes("<system-reminder>");
}

/**
 * A user line's prose, when it is one that starts a turn: what the human typed, or a background
 * task's notice (`isTaskNotice`). Null for tool results and injections.
 */
function turnStart(line: TranscriptLine): string | null {
  if (line.kind !== "user" || line.record["isMeta"] === true) return null;
  const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") return null;
  return isInjected(content) ? null : content;
}

/**
 * Is this user line the notice the host writes when a background task finishes?
 *
 * It is NOT in `INJECTED`, on purpose. A notice wakes the agent, so it starts a turn, and a turn
 * woken by one holds only what the agent did after it; read as an injection, that turn would reach
 * back to the human's last message, and a turn-end rule would be handed an edit from a turn
 * earlier. It is not the human talking either, so the report's prompts, and the corrections read
 * from them, leave it out. Either mark is enough: the text's opening tag, and the record's own
 * `origin.kind`, which every notice measured on Claude Code 2.1.322 to 2.1.325 carried.
 */
function isTaskNotice(line: TranscriptLine, prose: string): boolean {
  const origin = line.record["origin"] as { kind?: unknown } | undefined;
  return origin?.kind === "task-notification" || prose.trimStart().startsWith("<task-notification>");
}

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
export function turnActions(jsonl: string, root = ""): TurnAction[] {
  const lines = transcriptLines(jsonl);
  let from = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (turnStart(lines[i] as TranscriptLine) !== null) {
      from = i;
      break;
    }
  }
  const out: TurnAction[] = [];
  for (const line of lines.slice(from)) {
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use") continue;
      const name = text(block.name);
      const input = block.input ?? {};
      const path = input["file_path"] ?? input["notebook_path"];
      if (EDIT_TOOLS.has(name) && path) out.push({ did: "edit", path: relativise(text(path), root) });
      else if (name === "Bash" && input["command"]) out.push({ did: "run", command: text(input["command"]) });
    }
  }
  return out;
}

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
export function briefHead(jsonl: string, cap = 8000): string {
  for (const raw of jsonl.split("\n")) {
    const line = parseLine(raw);
    const prose = line === null ? null : turnStart(line);
    if (prose !== null) return prose.slice(0, cap);
  }
  return "";
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STORE — where the harness keeps its transcripts, and what is in there
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The live rails are handed a transcript path in the payload. The ARCHIVAL side has no payload:
// it is asked about a repo, after the fact, and has to find the conversations itself. That is a
// second piece of harness knowledge and it belongs on this side of the seam with the first.
//
// Claude Code keeps one folder per working directory under `~/.claude/projects/`, holding one
// `<sessionId>.jsonl` per top-level session and, for each, a `<sessionId>/subagents/agent-*.jsonl`
// per child with an `agent-*.meta.json` beside it. Two readers of that layout existed in the old
// platform — the CLI's corpus reader and the guard's backlog reader — and they disagreed about the
// folder-name rule. Here the layout is read in two places: this section, where `classifyStore`
// sorts a listing by it after the fact and `ownTranscriptPath` finds a live subagent's transcript
// by it, and the store listing in archive.ts, which spells the `subagents` folder again to walk it.

/** The folder under a session that holds its subagents' transcripts. */
const SUBAGENTS = "subagents";

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
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

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
export function classifyStore(paths: readonly string[]): {
  transcripts: TranscriptRef[];
  ignored: string[];
} {
  const present = new Set(paths);
  const sessions: TranscriptRef[] = [];
  const subagents: TranscriptRef[] = [];
  const ignored: string[] = [];

  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length === 1 && path.endsWith(".jsonl")) {
      sessions.push({ path, meta: null, session: path.slice(0, -".jsonl".length), agent: null });
      continue;
    }
    if (parts.length === 3 && parts[1] === SUBAGENTS && path.endsWith(".jsonl")) {
      const meta = `${path.slice(0, -".jsonl".length)}.meta.json`;
      subagents.push({
        path,
        meta: present.has(meta) ? meta : null,
        session: parts[0] ?? "",
        agent: (parts[2] ?? "").slice("agent-".length, -".jsonl".length),
      });
      continue;
    }
    if (parts.length === 3 && parts[1] === SUBAGENTS && path.endsWith(".meta.json")) continue;
    ignored.push(path);
  }

  // Sessions first, then their children — a stable order, so the read is reproducible.
  return { transcripts: [...sessions, ...subagents], ignored };
}

/**
 * The path of THIS agent's own transcript, from a live payload — null when the payload names none.
 *
 * On a subagent's call the host sends the PARENT's `transcript_path`, and keeps the subagent's own
 * transcript under it, in the store's layout: `…/<session>.jsonl` →
 * `…/<session>/subagents/agent-<agent_id>.jsonl`. The parent's path is the parent's transcript.
 * Null too when a subagent's half is not what that layout needs — an id that could step out of the
 * folder included, since it becomes part of a path that is then read.
 */
export function ownTranscriptPath(payload: HookPayload): string | null {
  const sent = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (sent === "") return null;
  const id = payload.agent_id;
  if (typeof id !== "string" || id === "") return sent;
  if (!sent.endsWith(".jsonl") || !/^[\w-]+$/.test(id)) return null;
  return `${sent.slice(0, -".jsonl".length)}/${SUBAGENTS}/agent-${id}.jsonl`;
}

/** A sidecar's text → what it says. Null when it is absent or will not parse. */
export function spawnMeta(raw: string | null): SpawnMeta | null {
  const held = parseObject(raw);
  if (held === null) return null;
  const str = (key: string): string | null => (typeof held[key] === "string" && held[key] !== "" ? held[key] : null);
  return {
    agentType: str("agentType"),
    description: str("description"),
    toolUseId: str("toolUseId"),
    model: str("model"),
    spawnDepth: typeof held["spawnDepth"] === "number" ? held["spawnDepth"] : null,
  };
}

/**
 * A conversation's opening facts, in ONE pass, stopping as soon as all three are known.
 *
 * It was three functions and therefore three parses of the same multi-megabyte file, once per
 * conversation in the store — a cost paid on every `flow facts` run for an answer that is in the
 * first few records. The file opens with stub records (last-prompt, mode, permission-mode) that
 * carry no fields at all, so a literal first line is never enough and the walk has to be able to
 * continue; what it must not do is start over twice.
 */
export function transcriptHead(jsonl: string): TranscriptHead {
  let cwd: string | null = null;
  let branch: string | null = null;
  let started: string | null = null;
  for (const line of transcriptLines(jsonl)) {
    cwd ??= text(line.record["cwd"]) || null;
    branch ??= text(line.record["gitBranch"]) || null;
    started ??= line.ts;
    if (cwd !== null && branch !== null && started !== null) break;
  }
  return { cwd, branch, started };
}

/** The subagent-spawning tool, by the name this harness gives it. */
const SPAWN_TOOL = "Agent";

/**
 * Every spawn a parent transcript made, by tool_use id — the parent's half of the join.
 *
 * It is the WEAKER half and is read as such: what the parent asked for is a claim by the session
 * being classified, while the sidecar is host-written and unforgeable, and so outranks it here.
 * Neither decides who a live session is: classification (engine, `spawnedAs`) reads the agent type
 * in the hook message. What this is for is everything the sidecar cannot say — when the spawn
 * happened, and where in the parent's own transcript to look.
 */
export function spawnsIn(jsonl: string): Map<string, Spawn> {
  const out = new Map<string, Spawn>();
  for (const line of transcriptLines(jsonl)) {
    if (line.kind !== "assistant") continue;
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; id?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use" || block.name !== SPAWN_TOOL) continue;
      const id = text(block.id);
      if (id === "") continue;
      const input = block.input ?? {};
      out.set(id, {
        toolUseId: id,
        asked: text(input["subagent_type"]) || null,
        description: text(input["description"]) || null,
        ts: line.ts,
        line: line.line,
      });
    }
  }
  return out;
}

/**
 * A transcript → the narrative events in it: typed prompts, tool calls, and their results.
 *
 * The PAIRING is this function's own — a `tool_use` block carries the id its `tool_result` answers
 * to, and matching them is what turns a flat file into "the agent tried X and got back Y". The
 * old engine did this over its own `JSON.parse` and its own type switch, beside the corpus reader
 * doing the same over the same files, so "what is an assistant line" had two answers free to
 * drift. It reads through `transcriptLines` now, and owns only the pairing.
 */
export function parseEvents(jsonl: string, root = "", home?: string): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const line of transcriptLines(jsonl)) {
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;

    if (line.kind === "user") {
      const start = turnStart(line);
      if (start !== null) {
        // A background task's notice starts a turn, but nobody typed it.
        if (!isTaskNotice(line, start)) out.push({ line: line.line, kind: "prompt", text: start });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const raw of content) {
        const block = raw as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean } | null;
        if (!block || block.type !== "tool_result") continue;
        out.push({
          line: line.line,
          kind: "result",
          id: text(block.tool_use_id),
          content: resultText(block.content),
          failed: block.is_error === true,
        });
      }
      continue;
    }

    if (line.kind !== "assistant" || !Array.isArray(content)) continue;
    for (const raw of content) {
      const block = raw as { type?: string; id?: string; name?: string; input?: Record<string, unknown> } | null;
      if (!block || block.type !== "tool_use") continue;
      const input = block.input ?? {};
      const name = text(block.name);
      // A Bash call's reads need a repo to be relative to; with no root there is none to count in.
      const where = { cwd: text(line.record["cwd"]) || root, root, home };
      const reads =
        name === "Bash" && root !== ""
          ? bashReads(parseShellSteps(text(input["command"]), where), where).reads
          : [];
      out.push({
        line: line.line,
        kind: "use",
        ts: line.ts,
        id: text(block.id),
        name,
        action: actionOf(name),
        input,
        path: relativise(text(input["file_path"] ?? input["notebook_path"]), root),
        ...(reads.length === 0 ? {} : { reads }),
      });
    }
  }
  return out;
}

/**
 * The tools that CHANGE a file: which names count as an edit is this harness's knowledge, and this
 * is the one set. The recorder and the turn-end rule both read it, so a notebook edit is work for both.
 */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The file an edit tool's call (`EDIT_TOOLS`) names, as named; null for any other call, or none named. */
export function editedFile(payload: HookPayload): string | null {
  if (!EDIT_TOOLS.has(text(payload.tool_name))) return null;
  const input = payload.tool_input ?? {};
  const named = text(input["file_path"] ?? input["notebook_path"]);
  return named === "" ? null : named;
}

/** What a tool call did, in flow's words: the product's reading of a transcript never sees a tool name. */
function actionOf(tool: string): ToolAction {
  if (tool === "Write") return "write";
  if (EDIT_TOOLS.has(tool)) return "edit";
  if (tool === "Read") return "read";
  return tool === "Bash" ? "shell" : "other";
}

/** A tool result's text, whichever of the three shapes the host wrote it in. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as { text?: string }[]).map((part) => part.text ?? "").join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

// ── weaken-after-block ─────────────────────────────────────────────────────

/**
 * The repo's own Claude Code settings file, relative to the repo root: guarded here, where `flow init`
 * registers flow's hooks, and where `flow uninstall` takes them out.
 */
export const REPO_SETTINGS = ".claude/settings.json";

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
export const HOST_SURFACE: readonly string[] = [REPO_SETTINGS, ".claude/settings.local.json", ".claude/agents/**"];

/**
 * The auto-mode steer a conversation is under, from the LAST auto-mode attachment in its transcript
 * — or null when it has none, or the last one is the host leaving auto mode.
 *
 * Read from the END, and only lines that name the attachment are parsed: a transcript is a couple
 * of megabytes and the answer is one record.
 */
export function steerOf(jsonl: string): Steer | null {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const line = raw[i] as string;
    if (!line.includes('"auto_mode')) continue;
    const attachment = parseLine(line)?.record["attachment"] as Record<string, unknown> | undefined;
    const type = attachment?.["type"];
    if (type === "auto_mode_exit") return null;
    if (type !== "auto_mode" || attachment === undefined) continue;
    const variant = attachment["bashFirstSteer"];
    return { shellFirst: attachment["bashFirst"] === true, variant: typeof variant === "string" && variant !== "" ? variant : null };
  }
  return null;
}

/**
 * The agent a session runs as (`--agent`, or the `agent` setting), from its own transcript — or
 * null when it runs as none.
 *
 * The host writes it as an `agent-setting` record, again as the session goes on. Read from the END,
 * and only lines that name the record are parsed, as `steerOf` does: the answer is one record.
 */
export function agentSettingOf(jsonl: string): string | null {
  const raw = jsonl.split("\n");
  for (let i = raw.length - 1; i >= 0; i--) {
    const line = raw[i] as string;
    if (!line.includes('"agent-setting"')) continue;
    const parsed = parseLine(line);
    if (parsed?.kind !== "agent-setting") continue;
    return text(parsed.record["agentSetting"]) || null;
  }
  return null;
}

/**
 * WHAT `flow init` WRITES, verbatim — and it follows DELIVERS, not HOOK_EVENTS.
 *
 * flow answers seven events and registers six: `Notification` is the deliberate difference. flow
 * has no notification moment, so a registration there would spawn a process on every banner to
 * answer nothing — cost with no function, and a line contradicting the honest moment list this file
 * publishes. The day a notification moment earns its way into the grammar, the registration arrives
 * with it.
 *
 * ONE PER EVENT. Two registrations on one event fire twice, and when they point at different
 * checkouts they can disagree — so a second concern extends the command it shares an event with
 * rather than standing beside it.
 *
 * The matchers are the host's. PreToolUse takes `Bash` alone: the one thing flow refuses before it
 * happens is a shell command, so no other tool's call has anything to wait for. PostToolUse takes
 * `*`, because any tool's call can change a file a breadcrumb is about. There is no hook before the
 * Edit and Write tools, and none after a failed call: flow stops no write and no delete.
 *
 * DERIVED, not re-typed: the host's name for an event and the word this binary answers to are both
 * read off `HOST_EVENT`, the one place that mapping is stated. Written out by hand, this list would
 * be a second spelling of it — and the day an event is renamed, the half that still compiled would
 * register a command nothing answers.
 *
 * `unregistered` is what goes unjudged while that one registration is missing — what `flow status`
 * says beside the fix (see `unregisteredText`). Each event costs its own rails and no others, so a file missing one names
 * that one's cost, not the whole guard's.
 */
const REGISTERED: readonly HooksFileHook[] = [
  { hook: "session-start", matcher: "startup|resume|clear|compact", unregistered: "no note is shown when a session starts" },
  { hook: "subagent-start", unregistered: "no note is shown when a subagent starts" },
  { hook: "pre-tool-use", matcher: "Bash", unregistered: "no rule judges a command before it runs" },
  { hook: "post-tool-use", matcher: "*", unregistered: "no note is shown for a file a tool call changed" },
  { hook: "stop", unregistered: "no turn-end rule runs when the main chat hands back" },
  { hook: "subagent-stop", unregistered: "no turn-end rule runs when a subagent hands back" },
];

/**
 * The hooks an older flow registered that this one does not: the host's name for each, and the word
 * its command ends in. `flow init` removes flow's own entry on each, and `flow uninstall` too, so a
 * registration this build no longer answers does not stay behind as a process that does nothing.
 */
const RETIRED: ReadonlyMap<string, string> = new Map([["PostToolUseFailure", "post-tool-use-failure"]]);

/**
 * The command each registration runs: the repo's own `@jawache/flow` first, then the PATH's.
 *
 * The host runs it through a shell with `$CLAUDE_PROJECT_DIR` set to the repo, so a repo with flow
 * only as a dev dependency answers its hooks, and its lockfile's version wins over a global one. It
 * runs the package's own file, by path, never a `flow` in node_modules/.bin, which any package can
 * put there. The same command goes in either settings file, so the host, which merges identical
 * commands, runs it once when it is in both.
 */
export function hookCommand(hook: HookEvent): string {
  return `${repoFirst("$CLAUDE_PROJECT_DIR", `hook ${hook}`)}; exec flow hook ${hook}`;
}

/** What `flow init`, `flow status` and `flow uninstall` ask of Claude Code's settings file, and the two readers of a command that `flow init` also uses. */
export const { ourHookCommand, bareHook, ...hooksFile } = hooksFileOf({ registered: REGISTERED, retired: RETIRED, command: hookCommand });
