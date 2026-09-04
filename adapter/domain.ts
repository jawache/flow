// flow/adapter/domain.ts — THE CLAUDE CODE DIALECT, and the only file in flow that knows what a
// hook payload looks like.
//
// Fourth and last stage of flow's pipeline:
//
//   language → checks → engine → adapter
//
// Everything upstream is harness-blind on purpose: the engine is handed events and answers with
// effects, and it could not name `tool_input`, `stop_hook_active` or a `.jsonl` transcript if it
// wanted to. This file is where those words are allowed, and it is the whole of the contact — the
// seam that makes a recorded session replayable with no harness at all (F5), and the reason a
// second harness is a second column rather than a second engine.
//
// THE SEVEN QUESTIONS (pack-engine guide §7) are what an adapter IS. Five are answered here; the
// two that need disk are answered by the shell next door:
//
//   how does a live moment arrive   JSON on stdin of `flow hook <event>`       → toEvent
//   how do we block                 exit 2, stderr shown to the model          → toResult
//   how do we inject context        stdout decision JSON · additionalContext   → toResult
//   how many tokens so far          parsed from the transcript                 → tokensFromTranscript
//   what moments can it deliver     the honest list, never a faked one         → DELIVERS
//   which repo is this              CLAUDE_PROJECT_DIR, falling back to cwd    → claude.ts
//   where is the session log        the payload's own transcript_path          → claude.ts
//
// IT IS STILL A PURE HOME. `flow/**/domain.ts` is flow's pure shape, so there is no node:fs, no
// child_process and no process.env here — the bytes are handed over. That split is what lets the
// dialect be proved by ordinary unit tests: a payload is an object, a transcript is a string, and
// what they MEAN is a decision like any other. The reaching is claude.ts's job, and it decides
// nothing.
//
// FOUR of the old engine's dialect leaks come home here, out of pure homes they had no business in:
// the transcript token count, the tool-use parse that a rule script did through an environment
// variable, the edit-tool name set, and the flight recorder's row.

import {
  isBreadcrumbMoment,
  isGuardrailMoment,
  type BreadcrumbMoment,
  type GuardrailMoment,
  type Moment,
  type SessionFacts,
  type TurnAction,
} from "../language/domain.ts";
import { formatBlock, type Block, type Cause, type Row } from "../engine/domain.ts";
// The command tokeniser, borrowed rather than copied. Reading `rm -rf src/x.ts` for the paths it
// would remove is event ASSEMBLY — the adapter's job — but quote-aware shell tokenising is a
// question the checks layer already answers, and the old engine's second answer (a regex split on
// `&&|\|\||;`) is exactly the near-duplicate this rewrite exists to delete.
import { tokenizeCommand } from "../checks/domain.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PAYLOAD — what the harness sends, and what flow answers to
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One hook payload, as Claude Code writes it on stdin.
 *
 * Deliberately loose, every field optional: it is JSON from another program, so a shape this file
 * DEMANDS is a shape that breaks the day the host adds a field or omits one. The index signature is
 * not laziness either — F5's archival side reads keys this phase has no use for, and a payload
 * narrowed on the way in cannot grow them back.
 */
export interface HookPayload {
  readonly session_id?: string;
  readonly agent_id?: string;
  readonly hook_event_name?: string;
  readonly transcript_path?: string;
  readonly stop_hook_active?: boolean;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  /** SessionStart's reason: `startup` · `resume` · `clear` · `compact` — the compaction announcement. */
  readonly source?: string;
  readonly [key: string]: unknown;
}

/**
 * The five events flow registers for, named by the EVENT and never by the job.
 *
 * Carried from the old engine unchanged, and the naming rule with it: call a hook
 * `flow hook plan-drift` and the day a second concern wants the same host event you register a
 * second hook beside the first, which is the duplicate-firing problem the grammar exists to make
 * impossible. One command per event; a second concern extends the function.
 */
export const HOOK_EVENTS = ["session-start", "pre-tool-use", "post-tool-use", "stop", "notification"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(word: string): word is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(word);
}

/** The host's own name for each event — what a decision object has to echo back. */
const HOST_EVENT: Record<HookEvent, string> = {
  "session-start": "SessionStart",
  "pre-tool-use": "PreToolUse",
  "post-tool-use": "PostToolUse",
  stop: "Stop",
  notification: "Notification",
};

/**
 * WHAT THIS HARNESS CAN HONESTLY SUPPLY — the seventh question, and the one that keeps the seam
 * from rotting quietly. An adapter never fakes a moment it cannot deliver.
 *
 * Two facts are stated here rather than discovered by somebody whose rule never fires:
 *
 *   · `commit` is delivered, but not by the harness — git's pre-commit hook calls `flow commit`,
 *     which is why every harness gets the gates for free and why it is in this list at all.
 *   · turn-end BRIEFING is not delivered. Stop's decision object carries no context channel, so a
 *     `breadcrumb().at(turnEnd)` has nowhere to be shown; the guardrail rail at that moment works
 *     perfectly. Reporting an entry that goes dark is `flow status`'s job (F6).
 *
 * It is two lists rather than one because "turn-end" is a word in both vocabularies and the answer
 * differs between them — a single flat list could only lie about one of them.
 */
export const DELIVERS = {
  guard: ["write", "delete", "command", "commit", "turn-end"] as readonly GuardrailMoment[],
  brief: ["session", "touch"] as readonly BreadcrumbMoment[],
};

/** Does this adapter carry that moment at all? The honest answer, for `flow status` to print. */
export function delivers(moment: Moment): boolean {
  if (isGuardrailMoment(moment) && DELIVERS.guard.includes(moment)) return true;
  return isBreadcrumbMoment(moment) && DELIVERS.brief.includes(moment);
}

/**
 * Whatever the host put there, as a string — a payload field is JSON and may be anything.
 *
 * A scalar is stringified and everything else is EMPTY, never `[object Object]`: an object where a
 * path was expected is not a path, and a guard that judged a file called `[object Object]` would be
 * asserting something about a file that cannot exist. Empty is falsy, so every caller's own
 * "nothing to judge" branch catches it.
 */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EVENTS — a payload becomes what the engine understands
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One event in the engine's vocabulary, minus the two things the engine's own event types demand
 * and this file cannot know: who the session is (`wearing`, which needs the sidecar and the stored
 * verdict) and how far it has drifted (`tokens`, which needs the transcript). The shell adds both,
 * because both come off disk.
 */
export type AdapterEvent =
  | {
      readonly rail: "guard";
      readonly moment: GuardrailMoment;
      readonly file?: { readonly path: string; readonly content: string } | undefined;
      readonly command?: string | undefined;
      readonly staged?: readonly string[] | undefined;
      readonly turn?: readonly TurnAction[] | undefined;
    }
  | { readonly rail: "brief"; readonly moment: BreadcrumbMoment; readonly path?: string | undefined };

/**
 * What a payload needs from the world before it can become an event. Injected, never reached for.
 *
 * Every answer is a FUNCTION rather than a value, and that is not ceremony: a hook fires on every
 * tool call, and the turn's actions cost a whole transcript to work out. Asking only when the
 * moment needs it means the write rail — by far the most frequent — never opens the file at all.
 */
export interface EventWorld {
  /** The repo root. Event paths are repo-relative, because that is how every `on` glob is written. */
  readonly root: string;
  /** A file as it stands right now, or null when it is not there — an Edit is a diff against it. */
  readonly read: (path: string) => string | null;
  /** What the actor did this turn. Only `stop` asks, so only `stop` pays for it. */
  readonly turn?: (() => readonly TurnAction[]) | undefined;
}

/** An absolute path inside the repo → the repo-relative spelling every glob is written against. */
export function relativise(path: string, root: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** One edit operation, as the Edit tool states it. */
export interface EditOp {
  readonly old_string?: string;
  readonly new_string?: string;
  readonly replace_all?: boolean;
}

/**
 * Fold one Edit into the text it would produce — the delicate half of the pre-emptive rail.
 *
 * The whole capability rests on reconstructing the would-be file EXACTLY as the Edit tool would
 * write it: get this wrong and the guard judges a file that never existed, which is worse than not
 * guarding at all. Null when the anchor is not in the base text — the caller must then stand aside
 * rather than judge a guess.
 *
 * Lifted from the old engine with its behaviour intact, including the empty-anchor case:
 * `old_string: ""` is a Write wearing an Edit's clothes, and the new text is the whole file.
 */
export function applyEdit(
  base: string,
  { old_string = "", new_string = "", replace_all = false }: EditOp,
): string | null {
  if (old_string === "") return new_string;
  if (replace_all) return base.split(old_string).join(new_string);
  const at = base.indexOf(old_string);
  if (at === -1) return null;
  return base.slice(0, at) + new_string + base.slice(at + old_string.length);
}

/**
 * The file as it WOULD be on disk after this tool call, disk untouched — J2.2, and the whole reason
 * to guard at PreToolUse rather than after the write.
 *
 * Write carries the content outright; Edit is a diff against what is there; MultiEdit is a fold of
 * several, and one unlocatable anchor abandons the whole reconstruction rather than judging a
 * half-applied file. A tool that names no path is not a write at all.
 */
export function wouldBeFile(
  tool: string,
  input: Record<string, unknown>,
  world: EventWorld,
): { path: string; content: string } | null {
  const named = input["file_path"];
  if (!named) return null;
  const path = relativise(text(named), world.root);
  if (tool === "Write") return { path, content: text(input["content"] ?? "") };
  if (tool === "Edit") {
    const next = applyEdit(world.read(path) ?? "", input);
    return next === null ? null : { path, content: next };
  }
  if (tool === "MultiEdit") {
    let content: string | null = world.read(path) ?? "";
    for (const edit of (input["edits"] as readonly EditOp[] | undefined) ?? []) {
      content = applyEdit(content, edit);
      if (content === null) return null;
    }
    return { path, content };
  }
  return null;
}

/** The words that remove a file, and whether their LAST argument is a destination instead. */
const REMOVERS: readonly { readonly words: readonly string[]; readonly renames: boolean }[] = [
  { words: ["rm"], renames: false },
  { words: ["git", "rm"], renames: false },
  { words: ["mv"], renames: true },
  { words: ["git", "mv"], renames: true },
];

/** Where one command in a line stops and the next begins. */
const OPERATORS = new Set([";", "&&", "||", "|", "&", "|&", "\n"]);

/**
 * The paths a Bash line would remove — `rm`, `git rm`, and the SOURCE side of `mv` / `git mv`.
 *
 * Deletion has no tool of its own: it is a side effect of a shell command, so the delete moment is
 * assembled here or it does not exist at all. `git mv` was the old engine's blind spot; it is
 * covered, and quoting is respected, so a commit message mentioning `rm` is not a removal.
 *
 * A line that cannot be tokenised yields NOTHING, deliberately: `null` from the tokeniser means "I
 * cannot tell", and a guard that guesses at a line it could not parse is worse than one that stands
 * aside. The command rail still sees the raw line either way.
 */
export function deleteTargets(command: string): string[] {
  const tokens = tokenizeCommand(command);
  if (tokens === null) return [];
  const out: string[] = [];
  let segment: string[] = [];
  const flush = (): void => {
    const words = segment;
    segment = [];
    for (const remover of REMOVERS) {
      if (!remover.words.every((word, i) => words[i] === word)) continue;
      const args = words.slice(remover.words.length).filter((token) => !token.startsWith("-"));
      out.push(...(remover.renames ? (args.length >= 2 ? args.slice(0, -1) : []) : args));
      return;
    }
  };
  for (const token of tokens) {
    if (OPERATORS.has(token)) flush();
    else segment.push(token);
  }
  flush();
  return out;
}

/**
 * A payload → every event it carries. ZERO OR MORE, and the plural is not hedging.
 *
 * One Bash call is genuinely two moments — the command about to run, and each file an `rm` in it
 * would remove — and the old engine ran two evaluations off that one hook for exactly this reason.
 * A signature returning one event would push the second rail back into the shell, where it could
 * not be tested as a decision.
 *
 * An event flow was not asked for answers with an empty list, never with an invented moment.
 */
export function toEvent(hook: HookEvent, payload: HookPayload, world: EventWorld): AdapterEvent[] {
  switch (hook) {
    case "session-start":
      return [{ rail: "brief", moment: "session" }];

    case "pre-tool-use": {
      const tool = text(payload.tool_name);
      const input = payload.tool_input ?? {};
      if (!tool) return [];
      if (tool === "Bash") {
        const command = text(input["command"]);
        if (!command) return [];
        const events: AdapterEvent[] = [{ rail: "guard", moment: "command", command }];
        for (const target of deleteTargets(command)) {
          // The file is still there at PreToolUse, so a content rule can ask what is about to be
          // lost ("this matched X — did you move the code first?"). One that is already gone yields
          // no event: there is nothing to judge, and an invented empty file would let a content
          // check pass on a fiction.
          const path = relativise(target, world.root);
          const content = world.read(path);
          if (content !== null) events.push({ rail: "guard", moment: "delete", file: { path, content } });
        }
        return events;
      }
      const file = wouldBeFile(tool, input, world);
      return file === null ? [] : [{ rail: "guard", moment: "write", file }];
    }

    case "post-tool-use": {
      const path = touchedPath(payload, world.root);
      // A pathless call is SILENCE, not a pathless touch event: the engine narrows a breadcrumb by
      // `on` only when the event names a path, so a touch carrying none would show every area note
      // at once. The note arrives on the next file the session touches instead. flow's breadcrumb
      // grammar has no command matcher, by design.
      return path === null ? [] : [{ rail: "brief", moment: "touch", path }];
    }

    case "stop":
      // The host's OWN loop-breaker, honoured: a stop hook already held this turn open once and the
      // agent carried on, so blocking again is how a session gets wedged inside its own rule.
      if (payload.stop_hook_active === true) return [];
      return [{ rail: "guard", moment: "turn-end", turn: world.turn?.() ?? [] }];

    case "notification":
      // Registered, and it carries no flow moment: `Notification` says the human is wanted, which
      // is not something a guardrail or a breadcrumb has a word for. The entry exists so the
      // registration is answered deliberately rather than falling through an unknown-event path.
      return [];
  }
}

/** What a post-tool-use call was about, repo-relative: a path, or nothing this rail can steer on. */
export function touchedPath(payload: HookPayload, root: string): string | null {
  const input = payload.tool_input ?? {};
  const named = input["file_path"] ?? input["notebook_path"] ?? input["path"] ?? input["glob"];
  return named ? relativise(text(named), root) : null;
}

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

export const ALLOW: HookResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * The banner and the instruction each rail refuses with.
 *
 * One table rather than a sentence per hook function, because the difference between the rails is
 * exactly two strings and everything else about a refusal is identical. The instruction earns its
 * place: "the guard said no" without "and here is what to do now" is how a blocked agent starts
 * guessing at what would satisfy it.
 */
const RAIL: Record<GuardrailMoment, { readonly head: string; readonly tail: string }> = {
  write: { head: "flow — blocked before the write landed", tail: "Adjust the change so it passes, then retry." },
  delete: { head: "flow — blocked before the delete", tail: "Keep the file, or change the rule that protects it." },
  command: { head: "flow — command blocked before it ran", tail: "Adjust the command, then retry." },
  commit: { head: "flow — commit blocked", tail: "Fix the above, then commit again." },
  "turn-end": { head: "flow — turn held open", tail: "Do the above, then end your turn." },
};

/** One refusal, with the rail that made it — the banner is the moment's, not the hook's. */
export interface Refused {
  readonly moment: GuardrailMoment;
  readonly block: Block;
}

/** A note with its prose resolved: a `file:` breadcrumb is read by the shell, never here. */
export interface Shown {
  readonly entry: string | null;
  readonly cause: Cause;
  readonly body: string;
}

/** Everything one payload produced, ready to become something the host understands. */
export interface Answer {
  readonly refused: readonly Refused[];
  readonly shown: readonly Shown[];
}

/**
 * The block of prose a set of notes is injected as.
 *
 * The header says `breadcrumb` because that is the mechanism's name everywhere else — in the
 * config, in the log, in `flow status`. The injected block was the last place the old system spoke
 * one word to the agent and printed another to the human, and a mechanism you hear one name for and
 * read another about is one you cannot look up.
 */
export function briefBlock(shown: readonly Shown[]): string {
  return shown
    .filter((note) => note.body.trim() !== "")
    .map((note) => `# breadcrumb: ${note.entry ?? "flow"} (${note.cause})\n${note.body}`)
    .join("\n\n");
}

/**
 * Effects → the three IO edges. The SECOND and THIRD of the seven questions, answered once.
 *
 * BLOCKING IS EXIT 2 WITH THE TEXT ON STDERR, at every rail, and that is a deliberate narrowing of
 * what the old engine did. It had three spellings — a PreToolUse `permissionDecision: "deny"`
 * object for a write, exit 2 for a command, a `decision: "block"` object at Stop — three shapes for
 * one answer, each with its own way of being subtly wrong, and only one of them works at every
 * moment. Exit 2 is the host's documented refusal channel and the model reads stderr on all three
 * rails, so flow has one refusal and one place to look when it fails to arrive.
 *
 * Injection stays the decision object, because there is no other channel for it.
 */
export function toResult(hook: HookEvent, answer: Answer): HookResult {
  const refusal = refused(answer.refused);
  if (refusal !== null) return refusal;
  const prose = briefBlock(answer.shown);
  if (prose === "") return ALLOW;
  return { stdout: decision(hook, prose), stderr: "", exitCode: 0 };
}

/**
 * Every refusal as the one thing a refusal is, or null when nothing refused.
 *
 * It takes NO hook, and that is the point of it existing beside `toResult`: the commit gate is not
 * a hook at all — git spawns it — so rendering its refusals through a hook-shaped function meant
 * naming an event that never happened. The banner comes off the MOMENT, which every rail has,
 * rather than off the event, which only the harness ones do.
 */
export function refused(refusals: readonly Refused[]): HookResult | null {
  const first = refusals[0];
  if (first === undefined) return null;
  const rail = RAIL[first.moment];
  const body = refusals.map((refusal) => formatBlock(refusal.block)).join("\n\n");
  return { stdout: "", stderr: `\n${rail.head}:\n\n${body}\n\n${rail.tail}\n`, exitCode: 2 };
}

/** Hand the agent some context and allow — the one shape every steering rail emits. */
export function decision(hook: HookEvent, additionalContext: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: HOST_EVENT[hook], additionalContext } });
}

/**
 * What the guard says when it could not read its own payload.
 *
 * The three outcomes of a read are not one outcome. "There was nothing to guard" is safe and common
 * — a hand-run, an empty stdin — and silence is the right answer to it. "I could not SEE what I was
 * guarding" is the old engine's invisible swallow: both were folded into `{}`, so a PreToolUse rail
 * holding an unreadable payload found no tool call, allowed, and told nobody. The sentence is the
 * same on every rail; what differs is whether the rail blocks with it, and that is the caller's
 * decision because it is a fact about what the event is FOR.
 */
export function faultText(hook: HookEvent, why: "unreadable" | "unparseable", detail: string): string {
  const what =
    why === "unreadable" ? `could not READ its payload from stdin (${detail})` : `could not PARSE its payload (${detail})`;
  return `[flow hook ${hook}] the guard ${what}.`;
}

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
}

/**
 * ONE line of a transcript, or null when it is not one — THE reader, and the only place a
 * transcript's file format is decided.
 *
 * A transcript is appended to live by the very session doing the reading, so the last line can be
 * caught mid-write. One unreadable line is not the rest of the history's problem.
 */
function parseLine(raw: string): TranscriptLine | null {
  const record = parseObject(raw);
  return record === null ? null : { kind: text(record["type"]), record };
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
  for (const raw of jsonl.split("\n")) {
    const line = parseLine(raw);
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
 * yet": a note then shows on first touch and not again, which is the harmless direction.
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
 * The tools that CHANGE a file — which names count as an edit is harness knowledge, and this is the
 * one set.
 *
 * There were two in the old engine and they had already drifted: the recorder's knew about
 * `NotebookEdit` and the turn-end rule's did not, so a notebook edit was work for the log and not
 * work for the rule watching for work. A fact about the host's tool names belongs in one place.
 */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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
];

export function isInjected(prose: string): boolean {
  const start = prose.trimStart();
  return INJECTED.some((mark) => start.startsWith(mark));
}

/** A user line's prose, when it is one the human typed. Null for tool results and injections. */
function typedPrompt(line: TranscriptLine): string | null {
  if (line.kind !== "user" || line.record["isMeta"] === true) return null;
  const content = (line.record["message"] as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") return null;
  return isInjected(content) ? null : content;
}

/**
 * What the actor did THIS TURN, in order — the fact a turn-end check is handed.
 *
 * The turn starts at the last thing the human typed. That is a real narrowing of the rule this
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
    if (typedPrompt(lines[i] as TranscriptLine) !== null) {
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
    const prose = line === null ? null : typedPrompt(line);
    if (prose !== null) return prose.slice(0, cap);
  }
  return "";
}

/**
 * The branch a worktree has out, from the text of its own `HEAD` — the session marker's key.
 *
 * A ref name, or the short sha when HEAD is detached, or null when there is nothing there. It is
 * read as a FILE rather than asked of `git`, and at this frequency that matters: the marker is
 * written on every tool call, and a subprocess per keystroke is a cost this answer does not justify.
 * It is also the only form that answers on an unborn branch, where `git rev-parse HEAD` fails
 * outright — which is every repo's own first commit.
 */
export function branchFromHead(head: string): string | null {
  const text = head.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
  return ref?.[1] ?? (text === "" ? null : text.slice(0, 12));
}

/**
 * The sidecar beside a subagent's transcript: `…/agent-<id>.jsonl` → `…/agent-<id>.meta.json`.
 *
 * The host writes one for every spawn — present 335/335 in the probe — and it is the strongest
 * evidence in the system precisely because the session did not write it. A session could claim to
 * be anything, and permissions resting on the claim would rest on a lie.
 */
export function sidecarPath(transcriptPath: string): string | null {
  return transcriptPath.endsWith(".jsonl") ? `${transcriptPath.slice(0, -".jsonl".length)}.meta.json` : null;
}

/**
 * Host-written evidence about one session × agent, assembled — the shape a classifier sees.
 *
 * The sidecar's absence is itself the evidence for the top-level session: there is no positive
 * marker for being the parent, only the absence of having been spawned. A sidecar that will not
 * parse is NOT the same as none — the session was spawned, we simply cannot say as what — so
 * `subagent` stays true and `agentType` is left undefined, and a category keyed on a specific type
 * declines rather than the parent category wrongly claiming it.
 */
export function sessionFactsFrom(args: {
  readonly payload: HookPayload;
  readonly transcript: string | null;
  readonly sidecar: string | null;
}): SessionFacts {
  const spawned = typeof args.payload.agent_id === "string" && args.payload.agent_id !== "";
  const meta = parseObject(args.sidecar);
  const agentType = typeof meta?.["agentType"] === "string" ? meta["agentType"] : undefined;
  const description = typeof meta?.["description"] === "string" ? meta["description"] : undefined;
  return {
    head: args.transcript === null ? "" : briefHead(args.transcript),
    subagent: spawned || meta !== null,
    ...(agentType === undefined ? {} : { agentType }),
    ...(description === undefined ? {} : { description }),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDER — every tool call, as it happens
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The guard used to log only its own opinions — a rule that fired, a note that showed — which made
// every coverage question unanswerable. "Is this area guarded?" needs the calls that nothing
// watched; "did that breadcrumb arrive in time?" needs the call it arrived on and the edit that
// followed. Both are the DENOMINATOR, and it was missing.
//
// One row per call, written from the PreToolUse rail — BEFORE the call, deliberately, because a
// command the guard blocks never reaches PostToolUse, and a recorder blind to exactly the calls the
// guard refused would be blind to the guard's own effect.

/** The tools whose subject is the file they name. */
const PATH_KEYS = ["file_path", "notebook_path"] as const;

/**
 * A tool call → the row that records it, or null when the payload names no tool at all.
 *
 * EVERY call, including the ones no rule watches and no breadcrumb covers. The subject is whatever
 * the call had — a path (repo-relative, so it matches the globs an entry is written with), a
 * command line, a search pattern and its scope — and a call with no subject is still recorded by
 * name, because "the session ran fifty greps here" is a fact about the area.
 */
export function toolRow(payload: HookPayload, root = ""): Row | null {
  const tool = text(payload.tool_name);
  if (!tool) return null;
  const input = payload.tool_input ?? {};
  for (const key of PATH_KEYS) {
    if (input[key]) return { kind: "tool", tool, path: relativise(text(input[key]), root) };
  }
  if (tool === "Bash" && input["command"]) return { kind: "tool", tool, command: text(input["command"]) };
  if (!input["pattern"]) return { kind: "tool", tool };
  const scope = input["path"] ? { scope: relativise(text(input["path"]), root) } : {};
  return { kind: "tool", tool, pattern: text(input["pattern"]), ...scope };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENVIRONMENT — what a spawned tool must not inherit
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The variables git exports into a hook's environment, which REDIRECT any nested `git` command back
 * at the parent repo — a `git init` in a temp directory would suddenly write the real index.
 *
 * The commit gate runs inside git's pre-commit hook and inherits every one of them, so a check that
 * shells out (a test suite, a type-checker, dependency-cruiser writing a temp config) would run
 * inside the in-progress commit unless they are stripped. It was one rule script's own business in
 * the old engine; it is the adapter's now, because `ctx.exec` is the one door and this is a fact
 * about the world on the other side of it.
 */
export const GIT_HOOK_ENV: readonly string[] = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_INDEX_VERSION",
  "GIT_QUARANTINE_PATH",
  "GIT_QUARANTINE_ID",
];

/** The environment a check's command should see: this one, minus git's hook plumbing. */
export function hermeticEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const drop = new Set(GIT_HOOK_ENV);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key)));
}
