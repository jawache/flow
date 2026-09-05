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
  type EntrySpec,
  type GuardrailMoment,
  type LoadResult,
  type Moment,
  type Refusal,
  type SessionFacts,
  type TurnAction,
} from "../language/domain.ts";
import {
  covers,
  FLOW_DIR,
  formatBlock,
  insideRepo,
  momentsView,
  universe,
  watching,
  type Block,
  type Bound,
  type Cause,
  type Metrics,
  type MomentsView,
  type Row,
  type TerrainNode,
} from "../engine/domain.ts";
// The command tokeniser, borrowed rather than copied. Reading `rm -rf src/x.ts` for the paths it
// would remove is event ASSEMBLY — the adapter's job — but quote-aware shell tokenising is a
// question the checks layer already answers, and the old engine's second answer (a regex split on
// `&&|\|\||;`) is exactly the near-duplicate this rewrite exists to delete.
import { tokenizeCommand } from "../checks/domain.ts";
// The one glob engine. A coverage question asked with a second matcher is a coverage answer about
// files the guard never judged — see flow/glob.ts on why there is exactly one.
import { matchAny } from "../glob.ts";

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
/**
 * The one file that turns anything on, spelled ONCE.
 *
 * It lives in the pure home rather than in the shell that opens it because three things name it
 * and only one of them is a read: the shell looks for it, the CLI defaults to it, and the list of
 * files that ARE the guard here has to include it. A second spelling in that list would leave a
 * renamed config's old name watched and its new one not.
 */
export const CONFIG_FILE = "flow.config.ts";

/**
 * THE CONFIG SURFACE — the files a write may target while the guard is broken, and nothing else.
 *
 * Fail-loud says a config that will not load refuses every gated moment, and it is right: a guard
 * that quietly carries on with yesterday's rules is a guard that lies about being there. But taken
 * without exception it also refuses the ONE write that can end the outage, and then the doctrine's
 * own instruction — "adjust the change so it passes, then retry" — is impossible to obey. A human
 * in an editor never meets this (no hooks sit in front of them, so they just undo); an agent that
 * broke the config is locked out of repairing it, and the repo stays broken until a human arrives.
 * Measured twice on the crossing that introduced it, once for real.
 *
 * So the exception is exactly as wide as the repair and no wider: a write whose target is the
 * config or a pack it imports. Everything else still refuses — every other path, every command,
 * and the commit gate, which goes on refusing until the config loads green, so nothing written
 * under the exception can reach a commit unreviewed by a working guard.
 *
 * STATIC, not derived from the config's own import graph, and that is the point: the config is
 * broken, so its imports are exactly what cannot be trusted to be read. A convention two lines long
 * that a person can check by eye beats a resolver that has to parse the file that will not parse.
 */
export const CONFIG_SURFACE: readonly string[] = [CONFIG_FILE, "guards/**"];

/** Is this repo-relative path part of the guard's own source? */
export function onConfigSurface(path: string): boolean {
  return matchAny(path, CONFIG_SURFACE);
}

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

// `delivers` — the reader of the two lists — lives with `flow status`, its only caller, at the foot
// of this file. It takes the entry's KIND as well as the moment, and it has to: `turn-end` is a word
// in both vocabularies, so a reader that took the moment alone would answer "delivered" for a
// breadcrumb bound there, which is the single lie these two lists exist to prevent.

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
    // `edit` is stamped HERE, and that is the seam rather than a convenience. Which of a harness's
    // tools change a file is harness knowledge; the engine reads the record back to answer "how
    // much work happened in this area" and may never import this file to ask. So the answer is
    // decided once, at write time, by the only layer entitled to know it.
    if (input[key]) return { kind: "tool", tool, path: relativise(text(input[key]), root), edit: EDIT_TOOLS.has(tool) };
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
// folder-name rule; there is one here.

/**
 * The folder a working directory's transcripts live in.
 *
 * Every character that is not a letter or a digit becomes a dash — verified against all 63 folders
 * on this machine carrying a readable cwd, with zero mismatches, rather than taken from a summary.
 * A dot is not special: `/Users/x/.work/y` yields a doubled dash, and that doubling is the check
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

/** One transcript file worth reading, and the sidecar beside it. */
export interface TranscriptRef {
  /** Relative to the project folder. */
  readonly path: string;
  /** The sidecar's path, only when the listing actually held it — never a probe. */
  readonly meta: string | null;
  readonly session: string;
  /** Null for a top-level session; the `agent-…` stem for a subagent. */
  readonly agent: string | null;
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
    if (parts.length === 3 && parts[1] === "subagents" && path.endsWith(".jsonl")) {
      const meta = `${path.slice(0, -".jsonl".length)}.meta.json`;
      subagents.push({
        path,
        meta: present.has(meta) ? meta : null,
        session: parts[0] ?? "",
        agent: (parts[2] ?? "").slice(0, -".jsonl".length),
      });
      continue;
    }
    if (parts.length === 3 && parts[1] === "subagents" && path.endsWith(".meta.json")) continue;
    ignored.push(path);
  }

  // Sessions first, then their children — a stable order, so the read is reproducible.
  return { transcripts: [...sessions, ...subagents], ignored };
}

/**
 * The sidecar the host writes beside every subagent transcript, read.
 *
 * `toolUseId` is the field that makes this more than a label: it is the id of the parent's own
 * `Agent` tool call, so a sidecar and the block that spawned it join exactly. That join is what
 * lets cost attribution and classification agree about who an actor was — the sidecar says what a
 * spawn WAS, the parent's block says when it happened and what it was asked for, and neither
 * alone answers both.
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

/** One spawn as the PARENT recorded it: the tool call, joined to the sidecar by its id. */
export interface Spawn {
  readonly toolUseId: string;
  /** What the parent asked for — its own claim, which the sidecar's `agentType` outranks. */
  readonly asked: string | null;
  readonly description: string | null;
  readonly ts: string | null;
  readonly line: number;
}

/** The subagent-spawning tool, by the name this harness gives it. */
const SPAWN_TOOL = "Agent";

/**
 * Every spawn a parent transcript made, by tool_use id — the parent's half of the join.
 *
 * It is the WEAKER half and is read as such: what the parent asked for is a claim by the session
 * being classified, while the sidecar is host-written and unforgeable. The classification order
 * (engine, `spawnedAs`) reads the sidecar and never this. What this is for is everything the
 * sidecar cannot say — when the spawn happened, and where in the parent's own transcript to look.
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NARRATIVE — what a conversation says, as opposed to what the guard did
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything above this line is deterministic: a payload means one thing, a usage record is a
// number, a sidecar says what it says. Everything below is HEURISTIC and must be labelled as such
// wherever it surfaces — "the human pushed back here" is a guess about a sentence, and a guess
// presented beside a count reads as a count.
//
// It carries its own citation for exactly that reason: every pointer names the transcript line it
// came from, so the reader judges the spot rather than the label.
//
// It lives HERE because it is transcript CONTENT dialect — an assistant block called `tool_use`, a
// user block called `tool_result`, a bare string meaning a typed prompt. The FILE shape is
// `transcriptLines`' one answer, above; if the content format changes, this function changes, and
// if the file format changes, that one does, once.

const ANSI = /\x1b\[[0-9;]*m/g;

/** Text with terminal colour codes taken out — a recorded command line is full of them. */
export function strip(value: unknown): string {
  return text(value).replace(ANSI, "");
}

/**
 * ONE definition of "make this printable and short": strip ANSI, collapse whitespace, cut to `n`
 * — and MARK the cut, because a truncated command with no ellipsis reads as a whole one, and every
 * surface that shows these strings claims to be showing what really happened.
 */
export function snip(value: unknown, n = 140): string {
  const flat = strip(value).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

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
      readonly input: Record<string, unknown>;
      /** The file the call names, repo-relative. Empty when it names none. */
      readonly path: string;
    };

/**
 * A transcript → the narrative events in it: typed prompts, tool calls, and their results.
 *
 * The PAIRING is this function's own — a `tool_use` block carries the id its `tool_result` answers
 * to, and matching them is what turns a flat file into "the agent tried X and got back Y". The
 * old engine did this over its own `JSON.parse` and its own type switch, beside the corpus reader
 * doing the same over the same files, so "what is an assistant line" had two answers free to
 * drift. It reads through `transcriptLines` now, and owns only the pairing.
 */
export function parseEvents(jsonl: string, root = ""): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const line of transcriptLines(jsonl)) {
    const content = (line.record["message"] as { content?: unknown } | undefined)?.content;

    if (line.kind === "user") {
      const typed = typedPrompt(line);
      if (typed !== null) {
        out.push({ line: line.line, kind: "prompt", text: typed });
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
      out.push({
        line: line.line,
        kind: "use",
        ts: line.ts,
        id: text(block.id),
        name: text(block.name),
        input,
        path: relativise(text(input["file_path"] ?? input["notebook_path"]), root),
      });
    }
  }
  return out;
}

/** A tool result's text, whichever of the three shapes the host wrote it in. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as { text?: string }[]).map((part) => part.text ?? "").join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

/**
 * High-signal pushback — where the human corrected the agent. A HEURISTIC, and the report says so.
 *
 * It is deliberately generous: the cost of a false positive is a coach reading one line that turns
 * out to be fine, and the cost of a false negative is the session's most informative moment going
 * unnoticed.
 */
// THE ANCHORING IS OUTSIDE THE CLASSES, and that is a fix rather than a transcription. The ported
// regex wrapped every alternative in one `\b(…)\b`, so the two that end in punctuation — `wait[, ]`
// and `no[, ]` — were then asked for a word boundary immediately after a comma or a space, which
// neither can ever be followed by. `no, that's wrong` and `wait, stop` are the two commonest
// spellings of pushback there are, and both alternatives were dead: a detector that reads as armed
// and matches nothing is the spec's own P2 shape, inside the code meant to find it.
const CORRECTION = new RegExp(
  [
    String.raw`\b(actually|hold on|nope|revert|undo|instead|hmm)\b`,
    String.raw`\b(wait|no)[,!.](\s|$)`,
    String.raw`\b(stop|don'?t|do not)\s`,
    String.raw`\bthat'?s (wrong|not right|not what|not)\b`,
    String.raw`\byou (broke|shouldn'?t|missed|forgot|didn'?t)\b`,
    String.raw`\bwhy (did|are) you\b`,
    String.raw`\b(rather than|let'?s not)\b`,
  ].join("|"),
  "i",
);

/** Does this prompt read as the human pushing back? */
export function isCorrection(prose: string): boolean {
  return CORRECTION.test(prose);
}

// ── the justfile's own tools, so a bypass is derived rather than guessed ──
//
// Every recipe body line → each command segment's first word → the set of tools that "should go
// through just". Shell noise is dropped; with no justfile, bypass detection is switched off
// entirely rather than falling back to a hardcoded list that would be wrong for every other repo.

const NOISE = new Set([
  "set", "node", "npx", "just", "cd", "export", "echo", "then", "fi", "do", "done", "if", "for", "while", "source",
]);

/** Is this top-level line a recipe header — `name:`, `name arg:`, `[attr]` and all? */
function isRecipeHeader(line: string): boolean {
  if (line.startsWith("[")) return false;
  const colon = line.indexOf(":");
  if (colon < 0) return false;
  const head = line.slice(0, colon).trim();
  return head !== "" && /^[@A-Za-z_][\w-]*(\s|$)/.test(head) && !head.includes("=");
}

/** The tools a repo's justfile actually drives — what a direct invocation would be bypassing. */
export function recipeTools(justfile: string): string[] {
  const tools = new Set<string>();
  let inRecipe = false;
  for (const raw of justfile.split("\n")) {
    if (raw.trim() === "") continue;
    const indented = /^\s/.test(raw);
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (!indented) {
      inRecipe = isRecipeHeader(line);
      continue; // the header itself is not a command
    }
    if (!inRecipe) continue;
    for (const segment of line.split(/&&|\|\||\||;/)) {
      const words = segment.trim().split(/\s+/);
      // A LAUNCHER names the tool in its next word, and dropping the line at the launcher is how
      // the ported reader came back empty on this very repo: every recipe here is `npx tsc`,
      // `npx vitest`, `npx eslint`, so `npx` matched the noise list and no tool was ever
      // collected — leaving the bypass section switched off and looking like a clean record.
      const first = (words[0] ?? "").replace(/^@/, "");
      const word = first === "npx" ? (words[1] ?? "") : first;
      if (word === "" || !/^[A-Za-z]/.test(word) || word.includes("/") || NOISE.has(word)) continue;
      tools.add(word);
    }
  }
  return [...tools];
}

/** What one Bash line was: the recipes it drove, the tools it went round, and whether it committed. */
export interface BashClass {
  readonly recipes: readonly string[];
  readonly bypasses: readonly string[];
  readonly commits: boolean;
}

/** Read one command line against the repo's own recipe tools. HEURISTIC, like everything below. */
export function classifyBash(command: unknown, tools: readonly string[]): BashClass {
  const line = strip(command);
  // A heredoc is authoring, not running — the body is a file being written, and every word in it
  // would otherwise read as a command.
  if (/<<-?\s*['"]?\w/.test(line)) return { recipes: [], bypasses: [], commits: false };
  const recipes: string[] = [];
  for (const match of line.matchAll(/(?:^|\n|;|\||&&|\()\s*just\s+([a-z][\w-]*)/g)) recipes.push(match[1] as string);
  const bypasses: string[] = [];
  for (const tool of tools) {
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = new RegExp(`(?:^|\\n|;|\\||&&|\\(|node_modules/\\.bin/|npx\\s+)\\s*(?:\\./)?${escaped}\\b`);
    const viaJust = new RegExp(`just\\s+\\S*\\b${escaped}\\b`);
    if (direct.test(line) && !viaJust.test(line)) bypasses.push(tool);
  }
  return { recipes, bypasses, commits: /\bgit\s+commit\b/.test(line) };
}

// ── the reading ────────────────────────────────────────────────────────────

/** A pointer into a transcript — the shape every heuristic finding takes. */
export interface Pointer {
  readonly line: number;
  readonly text: string;
  /** Which transcript, once several are merged into one report. */
  readonly session?: string;
}

export interface Bypass extends Pointer {
  readonly tool: string;
}

/** The same file edited over and over — a loop somebody was stuck in. */
export interface EditLoop {
  readonly path: string;
  readonly count: number;
  readonly from: number;
  readonly to: number;
  readonly session?: string;
}

/** The same command run again and again — something that would not come right. */
export interface Retry {
  readonly command: string;
  readonly count: number;
  readonly lines: readonly number[];
  readonly session?: string;
}

export interface Narrative {
  readonly stats: {
    readonly edits: number;
    readonly writes: number;
    readonly commits: number;
    readonly recipes: Readonly<Record<string, number>>;
    readonly bypasses: Readonly<Record<string, number>>;
  };
  readonly prompts: readonly Pointer[];
  readonly corrections: readonly Pointer[];
  readonly bypassSites: readonly Bypass[];
  readonly loops: readonly EditLoop[];
  readonly retries: readonly Retry[];
  /** Every in-repo file the session touched, with how often. The facts layer scores coverage. */
  readonly touched: Readonly<Record<string, number>>;
}

/** How many times one file is edited in a row before it reads as a loop. */
const LOOP = 5;
/** How many times one command line is repeated before it reads as a retry. */
const RETRY = 3;

// `insideRepo` is the engine's, imported rather than re-spelled: whether a path is a file of this
// repo decides what the narrative counts as touched AND what the record counts as an uncovered
// edit, and those two must never be able to disagree.

/**
 * The narrative reading of one conversation. Everything here is a guess with a citation.
 *
 * `tools` is INJECTED — the shell reads the justfile — so the same call is reproducible from a
 * fixture, which is the same discipline the guard itself is built on.
 */
export function narrative(events: readonly TranscriptEvent[], tools: readonly string[] = []): Narrative {
  let edits = 0;
  let writes = 0;
  let commits = 0;
  const recipes: Record<string, number> = {};
  const bypasses: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const prompts: Pointer[] = [];
  const corrections: Pointer[] = [];
  const bypassSites: Bypass[] = [];
  const loops: EditLoop[] = [];
  const retries: Retry[] = [];
  const byCommand: Record<string, number[]> = {};

  let loopPath: string | null = null;
  let loopFrom = 0;
  let loopTo = 0;
  let loopCount = 0;
  const closeLoop = (): void => {
    if (loopCount >= LOOP && loopPath !== null) loops.push({ path: loopPath, count: loopCount, from: loopFrom, to: loopTo });
  };

  for (const event of events) {
    if (event.kind === "prompt") {
      prompts.push({ line: event.line, text: snip(event.text, 120) });
      if (isCorrection(event.text)) corrections.push({ line: event.line, text: snip(event.text, 140) });
      continue;
    }
    if (event.kind !== "use") continue;

    // THE one edit-tool set, the same one the flight recorder stamps a row with. There were two
    // in the old engine and they had already drifted; a fact about the host's tool names is
    // spelled once in this file and read everywhere.
    if (EDIT_TOOLS.has(event.name)) {
      if (event.name === "Write") writes += 1;
      else edits += 1;
      const here = insideRepo(event.path);
      if (here && event.path === loopPath) {
        loopCount += 1;
        loopTo = event.line;
      } else {
        closeLoop();
        loopPath = here ? event.path : null;
        loopFrom = event.line;
        loopTo = event.line;
        loopCount = here ? 1 : 0;
      }
      if (here) touched[event.path] = (touched[event.path] ?? 0) + 1;
      continue;
    }
    if (event.name === "Read") {
      if (insideRepo(event.path)) touched[event.path] = (touched[event.path] ?? 0) + 1;
      continue;
    }
    if (event.name !== "Bash") continue;
    const command = text(event.input["command"]);
    const read = classifyBash(command, tools);
    for (const recipe of read.recipes) recipes[recipe] = (recipes[recipe] ?? 0) + 1;
    for (const tool of read.bypasses) {
      bypasses[tool] = (bypasses[tool] ?? 0) + 1;
      bypassSites.push({ line: event.line, tool, text: snip(command, 120) });
    }
    if (read.commits) commits += 1;
    const normalised = snip(command, 400);
    (byCommand[normalised] ??= []).push(event.line);
  }
  closeLoop();
  for (const [command, lines] of Object.entries(byCommand))
    if (lines.length >= RETRY) retries.push({ command, count: lines.length, lines });

  return {
    stats: { edits, writes, commits, recipes, bypasses },
    prompts,
    corrections,
    bypassSites,
    loops,
    retries,
    touched,
  };
}

/**
 * Every narrative reading merged into one, each pointer tagged with the transcript it came from.
 *
 * The report is ONE aggregate whether it read one conversation or a hundred — the flags only
 * re-scope which sessions it covers, never its shape — so this is where the per-session readings
 * stop being chapters and become one list somebody can work down.
 */
export function mergeNarratives(each: readonly { session: string; read: Narrative }[]): Narrative {
  const tag = <T extends object>(rows: readonly T[], session: string): (T & { session: string })[] =>
    rows.map((row) => ({ ...row, session }));
  const recipes: Record<string, number> = {};
  const bypasses: Record<string, number> = {};
  const touched: Record<string, number> = {};
  const out = {
    prompts: [] as Pointer[],
    corrections: [] as Pointer[],
    bypassSites: [] as Bypass[],
    loops: [] as EditLoop[],
    retries: [] as Retry[],
  };
  let edits = 0;
  let writes = 0;
  let commits = 0;

  for (const { session, read } of each) {
    out.prompts.push(...tag(read.prompts, session));
    out.corrections.push(...tag(read.corrections, session));
    out.bypassSites.push(...tag(read.bypassSites, session));
    out.loops.push(...tag(read.loops, session));
    out.retries.push(...tag(read.retries, session));
    edits += read.stats.edits;
    writes += read.stats.writes;
    commits += read.stats.commits;
    for (const [key, n] of Object.entries(read.stats.recipes)) recipes[key] = (recipes[key] ?? 0) + n;
    for (const [key, n] of Object.entries(read.stats.bypasses)) bypasses[key] = (bypasses[key] ?? 0) + n;
    for (const [key, n] of Object.entries(read.touched)) touched[key] = (touched[key] ?? 0) + n;
  }
  return { stats: { edits, writes, commits, recipes, bypasses }, ...out, touched };
}

// ── weaken-after-block ─────────────────────────────────────────────────────

/**
 * The files that ARE the guard here. A scope list rather than a parser, which is why it survives
 * every change to the config's own shape.
 *
 * It is flow's spelling now: `flow.config.ts` is the whole regime, `guards/` is where a repo's own
 * packs live, and the settings files are where the hooks that invoke any of it are registered. The
 * old list carried `work.yaml` and three file shapes the system can no longer produce.
 */
export const GUARD_PATHS = [
  CONFIG_FILE,
  "guards/**",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/agents/**",
];

/** Is this one of the files that decides what the guard does? */
export function isGuardPath(path: string): boolean {
  return path !== "" && matchAny(path, GUARD_PATHS.flatMap((glob) => [glob, `**/${glob}`]));
}

/** A block, and the guardrail edit that followed it. A POINTER, never an accusation. */
export interface Weakening {
  readonly entry: string | null;
  readonly line: number;
  readonly path: string;
  readonly gapSeconds: number;
}

/**
 * A rail refused, and then somebody edited the guard — flagged, with both ends cited.
 *
 * The edit may be perfectly legitimate authoring, which is exactly why this reports a POINTER and
 * lets a person read the two spots. What it cannot do is stay quiet: "the rule blocked me, so I
 * changed the rule" is the one failure mode a guard cannot catch itself.
 */
export function weakenedAfterBlock(rows: readonly Row[], events: readonly TranscriptEvent[]): Weakening[] {
  const blocked = rows
    .filter((row) => row.kind === "guardrail" && row["out"] === "deny" && typeof row["ts"] === "string")
    .map((row) => ({ entry: typeof row["id"] === "string" ? row["id"] : null, ts: row["ts"] as string }));
  const edits = events
    .filter((e): e is Extract<TranscriptEvent, { kind: "use" }> => e.kind === "use")
    .filter((e) => (e.name === "Edit" || e.name === "Write") && e.ts !== null && isGuardPath(e.path))
    .sort((a, b) => (a.ts as string).localeCompare(b.ts as string));

  const out: Weakening[] = [];
  for (const block of blocked) {
    const after = edits.find((e) => (e.ts as string) > block.ts);
    if (after === undefined) continue;
    out.push({
      entry: block.entry,
      line: after.line,
      path: after.path,
      gapSeconds: Math.round((Date.parse(after.ts as string) - Date.parse(block.ts)) / 1000),
    });
  }
  return out;
}

// ── which conversations a run covers ───────────────────────────────────────
//
// The archival side's scope is the UNREFLECTED BACKLOG: every transcript in the store whose
// session id has not been marked dealt-with. That is deliberately the STORE and not the log —
// history from before flow was installed is exactly what a first reading most wants to see, and a
// scope taken from the log could only ever show the repo what it already knew.
//
// Everything this returns in `analyse` is analysed AND markable. The excluded ones never are, so a
// capped run cannot declare skipped history done and quietly lose it.

/** One transcript, as the selector needs it: enough to order by, and nothing it has to open. */
export interface Candidate {
  readonly id: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  /** When the conversation began, as the host stamped it. Preferred over the file's mtime. */
  readonly started: string | null;
  readonly branch: string | null;
}

export interface SelectOpts {
  /** Analyse only the first N in order. The rest resurface next time. */
  readonly limit?: number | null | undefined;
  /** Ignore the limit. */
  readonly all?: boolean | undefined;
  /** Order heaviest-first — wasted effort concentrates in the token-heavy conversations. */
  readonly largest?: boolean | undefined;
  /** A date floor, in ms. */
  readonly since?: number | null | undefined;
}

export interface Selection {
  readonly analyse: readonly Candidate[];
  readonly excluded: readonly { readonly id: string; readonly reason: "limit" | "since" }[];
  readonly counts: { readonly backlog: number; readonly analysed: number; readonly excluded: number };
}

/** When a conversation happened: its own first timestamp, falling back to the file's mtime. */
function timeOf(candidate: Candidate): number {
  const started = Date.parse(String(candidate.started));
  return Number.isFinite(started) ? started : candidate.mtimeMs;
}

/** The backlog, ordered and narrowed — and an honest account of what was left out, and why. */
export function selectSessions(
  candidates: readonly Candidate[],
  done: ReadonlySet<string>,
  opts: SelectOpts = {},
): Selection {
  const { limit = null, all = false, largest = false, since = null } = opts;
  const backlog = candidates.filter((c) => !done.has(c.id));

  const byNewest = (a: Candidate, b: Candidate): number => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id);
  const byLargest = (a: Candidate, b: Candidate): number => b.bytes - a.bytes || byNewest(a, b);
  const ordered = [...backlog].sort(largest ? byLargest : byNewest);

  const excluded: { id: string; reason: "limit" | "since" }[] = [];
  let kept = ordered;
  if (since !== null) {
    kept = ordered.filter((c) => timeOf(c) >= since);
    for (const c of ordered) if (timeOf(c) < since) excluded.push({ id: c.id, reason: "since" });
  }

  let analyse = kept;
  if (!all && limit !== null && limit >= 0 && kept.length > limit) {
    analyse = kept.slice(0, limit);
    for (const c of kept.slice(limit)) excluded.push({ id: c.id, reason: "limit" });
  }

  return {
    analyse,
    excluded,
    counts: { backlog: backlog.length, analysed: analyse.length, excluded: excluded.length },
  };
}

// ── the fail-loud header on every number below it ──────────────────────────
//
// A record with nothing in it and a guard that never ran look identical in a table of zeroes, and
// the second reads as "a calm week" to anyone — including a coach recommending which rules to
// retire. So the reading carries its own health line, and the one thing it must never do is
// present an unarmed repo's silence as evidence.

export interface Health {
  /** The record cannot be believed at all, and this says why. Nothing below it should be read. */
  readonly blocked: string | null;
  /** It can be believed with a caveat, and here they are. */
  readonly warn: readonly string[];
}

export interface HealthArgs {
  /** Does this repo have a recorded history at all? */
  readonly armed: boolean;
  /** Did the sessions being read record anything? */
  readonly rows: number;
  /** How many of the conversations being read had a stream of their own. */
  readonly withRecord: number;
  readonly analysed: number;
}

/** What a reader must know before believing anything under it. */
export function health({ armed, rows, withRecord, analysed }: HealthArgs): Health {
  if (!armed)
    return {
      blocked:
        "the record is NOT ARMED — no stream has ever been written here, so there are no numbers. " +
        'This is not "nothing happened".',
      warn: [],
    };
  const warn: string[] = [];
  if (analysed > 0 && withRecord === 0)
    warn.push(
      "none of the conversations read has a stream of its own — the hooks did not record for them, " +
        "so everything below is narrative only.",
    );
  else if (rows === 0) warn.push("the record is armed and holds no events for what was read.");
  return { blocked: null, warn };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READING — what the record and the conversations add up to, and how it reads
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The SHAPE lives here and the gathering lives in the shell next door, for the reason every other
// split in this package exists: what a reading says is a decision and gets a test; opening the
// files it says it about is not. That includes the prose — `formatFacts` is the whole of what a
// person sees, and thirty lines of branching sentences in a CLI shell is thirty lines nothing can
// assert.

/**
 * One spawned actor, as the two host-written records agree on it — THE join, at its consumer.
 *
 * The sidecar says what a spawn WAS (`agentType`, unforgeable, written by the host) and the
 * parent's own `Agent` block says when it happened and what was asked for. Joining them on
 * `toolUseId` is what lets classification and cost attribution name the same actor: a builder
 * spawned under a generic bucket is `general-purpose` in the parent's claim and `builder` in the
 * host's record, and only one of those is evidence.
 */
export interface SpawnRecord {
  /** The conversation that spawned it. */
  readonly session: string;
  /** The `agent-…` stem — its own transcript's name. */
  readonly agent: string;
  /** The host's answer. Null when the sidecar was absent or would not parse: spawned, as what unknown. */
  readonly agentType: string | null;
  readonly description: string | null;
  readonly model: string | null;
  /** What the PARENT asked for. Null when the two records could not be joined. */
  readonly asked: string | null;
  readonly at: string | null;
  /** Where in the parent's transcript to look. Null when unjoined. */
  readonly line: number | null;
}

/** One subagent's two records, joined. An unjoinable sidecar still yields what it alone knows. */
export function joinSpawn(args: {
  readonly session: string;
  readonly agent: string;
  readonly meta: SpawnMeta | null;
  readonly spawns: ReadonlyMap<string, Spawn>;
}): SpawnRecord {
  const { session, agent, meta, spawns } = args;
  const from = meta?.toolUseId === undefined || meta.toolUseId === null ? undefined : spawns.get(meta.toolUseId);
  return {
    session,
    agent,
    agentType: meta?.agentType ?? null,
    // The sidecar's description is the human label the spawn was filed under; the parent's block
    // carries the same text, so either answers and the host-written one wins.
    description: meta?.description ?? from?.description ?? null,
    model: meta?.model ?? null,
    asked: from?.asked ?? null,
    at: from?.ts ?? null,
    line: from?.line ?? null,
  };
}

/** An area the conversations worked in that no entry's globs reach. */
export interface Uncovered {
  readonly path: string;
  readonly touches: number;
}

/**
 * The files a conversation touched that nothing was watching — coverage read from the TRANSCRIPT.
 *
 * It is not a duplicate of the record's own gap list and the difference is the whole point: the
 * rows can only answer for sessions flow was installed for, and the store holds every conversation
 * this repo has ever had. A session with no record at all still says where the work went, which is
 * exactly the reading a repo wants on the day it adopts flow — and the day after, when it wants to
 * know whether the entries it just bound point anywhere near it.
 */
export function uncoveredAreas(touched: Readonly<Record<string, number>>, entries: readonly Bound[]): Uncovered[] {
  const scoped = watching(entries);
  return Object.entries(touched)
    .filter(([path]) => !scoped.some((e) => covers(e, path)))
    .map(([path, touches]) => ({ path, touches }))
    .sort((a, b) => b.touches - a.touches || a.path.localeCompare(b.path));
}

export interface Facts {
  readonly root: string;
  readonly store: { readonly dir: string; readonly exists: boolean; readonly ignored: readonly string[] };
  /** Which conversations this run covers, and which it deliberately deferred. */
  readonly selection: Selection;
  readonly coverage: { readonly analysed: number; readonly withRecord: number; readonly narrativeOnly: number };
  /** The fail-loud header. Read it before believing anything else here. */
  readonly health: Health;
  /**
   * The numbers, over the repo's WHOLE recorded history — deliberately not narrowed to the
   * selection. A dead scope and a lead distribution are lifetime questions, and scoping them to
   * one backlog would make a quiet week look like a retirement case.
   */
  readonly metrics: Metrics;
  readonly moments: MomentsView;
  readonly terrain: readonly TerrainNode[];
  /** The heuristic pointers, one list, each row tagged with the conversation it came from. */
  readonly narrative: Narrative;
  /** Where the conversations worked that nothing watches — the transcript's own coverage answer. */
  readonly uncovered: readonly Uncovered[];
  /** Every actor the read conversations spawned, both host-written records joined. */
  readonly actors: readonly SpawnRecord[];
  /** A rail refused, and then somebody edited the guard. A pointer, never an accusation. */
  readonly weakened: readonly Weakening[];
  /** How many conversations were marked read, when asked for. Null when not asked. */
  readonly marked: number | null;
}

/** How many gaps and how many actors a headline lists before it stops being a headline. */
const HEADLINE = 5;

/**
 * The reading, as the lines a person reads. The whole of what `flow facts` prints.
 *
 * It is here rather than in the CLI shell on this repo's own standing precedent (927ca62, the
 * guard status report): a report's text is a pile of branches — is it armed, is the history ample,
 * did anything go quiet, was the guard edited after it refused — and every one of those branches
 * is a judgement about what a reader most needs to know. In a shell they are untestable, and the
 * one that matters most is the one that fires least.
 */
export function formatFacts(facts: Facts): string[] {
  const lines: string[] = [];
  if (facts.health.blocked !== null) lines.push(`✗ ${facts.health.blocked}`);
  for (const warn of facts.health.warn) lines.push(`⚠ ${warn}`);

  const { span, headline } = facts.metrics;
  lines.push(
    `flow facts — ${facts.coverage.analysed} of ${facts.selection.counts.backlog} unread conversations · ` +
      `${facts.coverage.withRecord} with a record · ` +
      (facts.store.exists ? facts.store.dir : `no store at ${facts.store.dir}`),
    `  recorded  ${span.tools.toLocaleString()} tool calls · ${span.sessions} chats · ${span.days}d` +
      (span.ample ? "" : " (too thin to call anything dead)"),
    `  blocks    ${headline.blocks}`,
    `  lead      ` +
      (headline.lead.median === null ? "nothing measurable yet" : `median ${headline.lead.median} tool calls`),
  );

  for (const gap of headline.gaps.slice(0, HEADLINE))
    lines.push(`  gap       ${gap.area} — ${gap.edits} edit${gap.edits === 1 ? "" : "s"}, nothing watches it`);
  if (headline.dead.length > 0) lines.push(`  dead      ${headline.dead.join(" · ")}`);
  if (headline.retire.length > 0) lines.push(`  retire    ${headline.retire.join(" · ")} — bound, never once reached`);
  if (headline.quiet.length > 0)
    lines.push(`  quiet     ${headline.quiet.map((q) => `${q.id} (${q.daysSince}d)`).join(" · ")}`);

  const { stats, corrections, loops, retries, bypassSites } = facts.narrative;
  lines.push(
    `  session   ${stats.edits} edits · ${stats.writes} writes · ${stats.commits} commits · ` +
      `${corrections.length} corrections · ${loops.length} edit loops · ${retries.length} retries · ` +
      `${bypassSites.length} bypasses`,
  );
  // The transcript's own coverage answer, which reaches conversations the record cannot.
  for (const area of facts.uncovered.slice(0, HEADLINE))
    lines.push(`  unwatched ${area.path} — touched ${area.touches}×, no entry reaches it`);
  for (const actor of facts.actors.slice(0, HEADLINE))
    lines.push(
      `  actor     ${actor.agentType ?? "unknown"}${actor.asked !== null && actor.asked !== actor.agentType ? ` (spawned as ${actor.asked})` : ""}` +
        (actor.description === null ? "" : ` — ${actor.description}`),
    );
  if (facts.actors.length > HEADLINE) lines.push(`            …and ${facts.actors.length - HEADLINE} more`);

  for (const weak of facts.weakened)
    lines.push(
      `  ⚠ the guard was edited after ${weak.entry ?? "a block"} refused — ` +
        `${weak.path}:L${weak.line}, ${weak.gapSeconds}s later`,
    );
  if (facts.marked !== null) lines.push(`  marked    ${facts.marked} conversation(s) read`);
  return lines;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCT SURFACE — `flow init` and `flow status`
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The two verbs a PERSON types at a repo, as against the two the harness invokes. They live in the
// adapter because both are about the host: init writes Claude Code's own hook registrations and
// git's own pre-commit hook, and status reports whether those wirings are there. Neither could sit
// upstream — the engine is not allowed to know that a settings file exists.
//
// The split with the shell next door (product.ts) is the one this package keeps everywhere: what to
// write given what is already there, and what to SAY given what loaded, are decisions and live
// here; the stat, the write and the subprocess do not.

/**
 * The node version flow's config loader needs, and why it is a floor rather than a preference.
 *
 * A `flow.config.ts` is TypeScript and is loaded by node's own type stripping — there is no
 * transpile step and there will not be one, because a guard that compiles its own config is a guard
 * with a build to go wrong. Stripping is flag-free from node 24 (the Active LTS), so that is the
 * floor `engines` states and the number this sentence names.
 */
export const NODE_FLOOR = 24;

/**
 * The one sentence for "this config would not load", and the one place a version floor is named.
 *
 * A node too old to strip types fails on the IMPORT, with a syntax error about a colon. That is a
 * machine fact arriving as a parse error — the least actionable shape a true statement can take —
 * so it is rewritten here, once, for both readers: the `flow test` verb and the live hook rail,
 * which would otherwise describe one breakage two ways.
 */
export function configLoadFault(file: string, message: string, nodeVersion: string): string {
  const stripping = /Unexpected token|Unknown file extension|strip|SyntaxError/i.test(message);
  return stripping
    ? `flow: ${file} could not be loaded as TypeScript. flow needs Node >= ${NODE_FLOOR}, where type stripping is on by default; this is node ${nodeVersion}. (${message})`
    : `flow: ${file} could not be loaded — ${message}`;
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

/**
 * WHAT `flow init` WRITES, verbatim — and it follows DELIVERS, not HOOK_EVENTS.
 *
 * flow answers five events and registers four. `Notification` is the difference and it is deliberate
 * (ruled at F4): flow has no notification moment, so a registration there would spawn a process on
 * every banner to answer nothing — cost with no function, and a line contradicting the honest moment
 * list this file publishes. The day a notification moment earns its way into the grammar, the
 * registration arrives with it.
 *
 * ONE PER EVENT. Two registrations on one event fire twice, and when they point at different
 * checkouts they can disagree — so a second concern extends the command it shares an event with
 * rather than standing beside it.
 *
 * The matchers are the host's, each the widest set its command can act on. PreToolUse takes `*`
 * because the flight recorder's whole claim is that the log holds every call, including the ones no
 * rule watches — they are the denominator of every coverage question. PostToolUse keeps a narrower
 * list because a `touch` breadcrumb can only steer on a path, so a tool naming none would cost a
 * process to inject nothing.
 *
 * DERIVED, not re-typed: the host's name for an event and the word this binary answers to are both
 * read off `HOST_EVENT`, the one place that mapping is stated. Written out by hand, this list would
 * be a second spelling of it — and the day an event is renamed, the half that still compiled would
 * register a command nothing answers.
 */
const REGISTERED: readonly { readonly hook: HookEvent; readonly matcher?: string }[] = [
  { hook: "session-start", matcher: "startup|resume|clear|compact" },
  { hook: "pre-tool-use", matcher: "*" },
  { hook: "post-tool-use", matcher: "Read|Glob|Grep|Edit|Write|Bash" },
  { hook: "stop" },
];

export const HOOK_REGISTRATIONS: readonly Registration[] = REGISTERED.map(({ hook, matcher }) => ({
  event: HOST_EVENT[hook],
  command: `flow hook ${hook}`,
  ...(matcher === undefined ? {} : { matcher }),
}));

/**
 * Is this registration OURS?
 *
 * The rule that says "this is ours" is the rule that would say "this may be removed", so it is
 * narrow on purpose: the flow binary — by either name it legitimately goes by, with any path in
 * front — invoking `hook <event>` for an event this build actually answers. A `work hook stop` from
 * the engine flow replaces is NOT ours; sweeping those is the crossing's job, with that engine's own
 * recogniser.
 */
export function ourHookCommand(command: string): boolean {
  const match = /(^|[\s"'/\\])(?:flow|flow\.mjs)["']?\s+hook\s+([a-z-]+)\s*$/.exec(command.trim());
  return match?.[2] !== undefined && isHookEvent(match[2]);
}

/** Every hook array in a settings file, by event. Loose: it is somebody's hand-edited JSON. */
function hookArrays(settings: unknown): Record<string, unknown[]> {
  const held = (settings && typeof settings === "object" ? settings : {}) as { hooks?: unknown };
  const hooks = (held.hooks && typeof held.hooks === "object" ? held.hooks : {}) as Record<string, unknown>;
  const out: Record<string, unknown[]> = {};
  for (const [event, value] of Object.entries(hooks)) if (Array.isArray(value)) out[event] = value;
  return out;
}

/** The events this settings file already calls flow for. What makes init idempotent and status honest. */
export function registeredEvents(settings: unknown): string[] {
  const out: string[] = [];
  for (const [event, entries] of Object.entries(hookArrays(settings))) {
    const ours = entries.some((entry) => {
      const inner = (entry as { hooks?: unknown } | null)?.hooks;
      if (!Array.isArray(inner)) return false;
      return inner.some((held) => {
        const command = (held as { command?: unknown } | null)?.command;
        return typeof command === "string" && ourHookCommand(command);
      });
    });
    if (ours) out.push(event);
  }
  return out;
}

/**
 * A settings file with flow's registrations in it — a NEW object, and only ever added to.
 *
 * It is somebody's file and holds far more than us, so nothing is rewritten and nothing is removed:
 * a registration on our event that belongs to another tool keeps its place and flow stands beside
 * it. Adding what is already there is skipped, which is the whole of what makes `flow init`
 * idempotent — a second run has nothing to say.
 */
export function withRegistrations(settings: unknown): { settings: unknown; added: string[] } {
  const base = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const already = new Set(registeredEvents(settings));
  const wanted = HOOK_REGISTRATIONS.filter((r) => !already.has(r.event));
  if (wanted.length === 0) return { settings: base, added: [] };

  const arrays = hookArrays(settings);
  const hooks: Record<string, unknown> = { ...(base["hooks"] as Record<string, unknown> | undefined) };
  for (const registration of wanted) {
    hooks[registration.event] = [
      ...(arrays[registration.event] ?? []),
      {
        ...(registration.matcher === undefined ? {} : { matcher: registration.matcher }),
        hooks: [{ type: "command", command: registration.command }],
      },
    ];
  }
  return { settings: { ...base, hooks }, added: wanted.map((r) => r.event) };
}

// ── the git gate ─────────────────────────────────────────────────────────────

/**
 * WHERE THE GATE LIVES, spelled once for everyone who names it.
 *
 * Four readers say these two paths — the hook `init` writes, the report that names the write, the
 * fitting `status` checks, and the shell next door that stats the file. Spelled four times, a rename
 * would leave one reader writing a path another never looks at, and the failure is the silent kind:
 * a green report over a gate git is not running.
 */
export const HOOKS_DIR = ".githooks";
export const GATE_PATH = `${HOOKS_DIR}/pre-commit`;

/** What arms git, said the way a person types it — the report's line and the fitting's fix. */
export const SET_HOOKS_PATH = `git config core.hooksPath ${HOOKS_DIR}`;

/**
 * How to arm a gate flow will not write over, in the ONE wording both readers use.
 *
 * `init` says it about the hook it just declined to overwrite; `status` says it about the hook it
 * found unarmed. The same instruction, at the two moments a person can meet it — and two spellings
 * of an instruction are two instructions the day one of them is edited.
 */
export const ADD_THE_GATE_LINE = "add `flow commit $(git diff --cached --name-only)` to it";

/**
 * The pre-commit hook, verbatim.
 *
 * `flow commit <files…>` rather than a sixth hook, because the commit moment is not delivered by any
 * harness — git's own hook is what fires it, which is why every harness gets the gates for free. The
 * staged set is computed here rather than inside flow: it is git's own question, and this file is
 * already a git hook.
 */
export const PRE_COMMIT = `#!/bin/sh
# The flow commit gate. Written by \`flow init\`; \`${SET_HOOKS_PATH}\` arms it.
#
# Every at(commit) guardrail runs over the staged set and a block exits non-zero, which is how git
# refuses the commit. This is the half of the promise the PreToolUse rail cannot make: it fires for
# a human's commit, a merge and CI, with no session in the room.
staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0
# shellcheck disable=SC2086
exec flow commit $staged
`;

/** Does this pre-commit hook call flow? Asked by `init` before writing, and by `status` after. */
export function armsFlow(text: string | null): boolean {
  return text !== null && /(^|[\s"'/\\])flow\b[^\n]*\bcommit\b/m.test(text);
}

// ── the scaffold ─────────────────────────────────────────────────────────────

/** The config `flow init --empty` leaves: the wiring, with no opinions. */
const EMPTY_CONFIG = String.raw`// flow.config.ts — this repo's whole guard.
//
// A rule not reachable from this file does not run. Bind a pack with ` + "`pack(x)`" + String.raw`, refine one of
// its entries with ` + "`override(x.entry)`" + String.raw`, and ask ` + "`flow status`" + String.raw` what is live.

import { defineConfig } from "@jawache/flow";

export default defineConfig([]);
`;

/**
 * THE DEMO — the config `flow init` leaves behind, and the whole of J6.1.
 *
 * Four entries on one screen: a note that meets every session, a command ban, a commit gate over
 * staged content, and one rule bound to an ACTOR rather than to a path. It is a worked example of
 * J1.2 as much as a starting guard — a pack here is written exactly as a published one is, and
 * promoting it would change the import line and nothing else.
 *
 * Written with `String.raw` so the regex inside it is the regex a reader will see: this is source
 * code that generates source code, and a scaffold whose backslashes were eaten on the way out is a
 * config that loads and matches nothing.
 */
const DEMO_CONFIG = String.raw`// flow.config.ts — this repo's whole guard, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Everything below is ordinary code: a pack is a
// module, a check is a function of its ctx, and a category is a name with its recognizer aboard.
// Nothing defaults — an absent key is absent — so a mistake fails in your editor, not at 3am.
//
//   flow status   what is bound, at which moments, and what is not wired yet
//   flow test     every rule's own cases, run

import {
  breadcrumb,
  command,
  commit,
  defineCategory,
  defineConfig,
  definePack,
  guardrail,
  pack,
  session,
} from "@jawache/flow";

// A category is a name and the HOST-WRITTEN evidence that recognises it — never a claim a session
// made about itself. This one is "the harness wrote a sidecar for you", which is what a spawned
// subagent is and a chat is not.
const subagent = defineCategory("subagent", (facts) => facts.subagent);

// Spelled in pieces on purpose. Written whole it would appear in this very file, and the gate below
// greps staged content — so the demo would refuse the commit that added it.
const MARKER = ["DO", "NOT", "COMMIT"].join("-");

export const demo = definePack("demo", {
  orientation: breadcrumb()
    .at(session)
    .text("This repo is guarded by flow. The rules are in flow.config.ts — read them rather than routing around them."),

  noForcePush: guardrail()
    .at(command)
    .check((ctx) =>
      /git\s+push\b[^\n]*(--force|(^|\s)-f(\s|$))/.test(ctx.command ?? "")
        ? ctx.fail("rewrites history other clones already have")
        : ctx.ok(),
    )
    .message("Force-pushing rewrites history everyone else has. Push a correcting commit, or ask first.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),

  // No .on() here, and that is the sentence rather than an omission: an entry that names no paths is
  // about THE COMMIT, so it is asked once and handed the whole staged set. (Name paths with .on()
  // and the gate asks it once per staged file in scope instead, handing over each file.)
  noMarkedFiles: guardrail()
    .at(commit)
    .check(async (ctx) => {
      for (const path of ctx.staged ?? [])
        if ((await ctx.fs.read(path)).includes(MARKER)) return ctx.fail(path + " carries the marker");
      return ctx.ok();
    })
    .message("A file carrying the do-not-commit marker is staged. Take the marker out, or unstage the file.")
    .test({
      pass: [{ staged: ["a.txt"], world: { fs: { "a.txt": "fine" } } }],
      block: [{ staged: ["a.txt"], world: { fs: { "a.txt": MARKER } } }],
    }),

  // The same act, a different wearer, a different answer — a rule bound to WHO rather than to what.
  chatCommits: guardrail()
    .at(commit)
    .for(subagent)
    .check((ctx) => ctx.fail((ctx.staged ?? []).length + " staged file(s)"))
    .message("A subagent does not commit — hand the change back to the chat that spawned it.")
    .test({ pass: [], block: [{ staged: ["a.txt"] }] }),
});

export default defineConfig([pack(demo)]);
`;

/** The config file init writes: the demo, or the bare one `--empty` asks for. */
export function scaffold(empty: boolean): string {
  return empty ? EMPTY_CONFIG : DEMO_CONFIG;
}

// ── init ─────────────────────────────────────────────────────────────────────

/** What the shell found before anything was written. Every one is a stat, not a judgement. */
export interface InitFacts {
  readonly root: string;
  /** `--empty`: the wiring, with no demo. */
  readonly empty: boolean;
  readonly isGit: boolean;
  readonly hasConfig: boolean;
  /** The gate as it stands, or null when there is none. */
  readonly gateText: string | null;
  readonly hasFlowDir: boolean;
  /** `git config core.hooksPath` as it stands. */
  readonly hooksPath: string | null;
  readonly settingsPath: string;
  /** The parsed host settings file. */
  readonly settings: unknown;
  /**
   * The settings file is THERE and would not parse.
   *
   * Distinct from `settings: null`, which means there is none — and the distinction is the whole
   * reason this field exists. Both read as "no registrations found", so an init that acted on the
   * absence would answer an unreadable file by writing a NEW one over it, taking the reader's
   * permissions, model and every other key with it. Measured at the crossing, against a real
   * settings.json holding JSONC comments: the write was one branch away.
   */
  readonly settingsUnreadable: boolean;
  /** Does `@jawache/flow` already resolve from this repo? */
  readonly resolves: boolean;
  /**
   * Where the running binary's own package lives — what a link would point at, and NULL when the
   * walk up never found it. Null rather than an empty string on purpose: an empty string is a path
   * as far as the shell is concerned, and it would go on to attempt a symlink to nowhere and report
   * the failure of a step that should never have been planned.
   */
  readonly packageRoot: string | null;
}

/** One file to write, repo-relative so the report reads the way a person would say it. */
export interface Write {
  readonly path: string;
  readonly body: string;
  /** Set on the gate, which git will not run unless it is executable. */
  readonly mode?: number;
}

/** Everything `flow init` will do, decided before a byte is written. A null means "already there". */
export interface InitPlan {
  readonly config: Write | null;
  readonly gate: Write | null;
  /** A pre-commit hook that is somebody else's. Never overwritten — reported, with the line to add. */
  readonly gateKept: boolean;
  readonly notGit: boolean;
  readonly flowDir: boolean;
  /** The package to link into `node_modules/@jawache/flow`, or null when flow already resolves. */
  readonly link: string | null;
  readonly hooksPath: boolean;
  /** The rewritten settings, or null when they already call flow — or could not be read. */
  readonly settings: { readonly path: string; readonly value: unknown } | null;
  readonly registered: readonly string[];
  /** The settings file was there and would not parse, so nothing was registered. Said out loud. */
  readonly settingsUnreadable: string | null;
}

/** What init will do to this repo. Pure: every branch reads a fact the shell already gathered. */
export function planInit(facts: InitFacts): InitPlan {
  // A file we could not read is a file we may not write. `withRegistrations` builds a NEW object
  // from whatever it is handed, so handing it the null an unparseable file produces would emit a
  // settings file holding flow's four registrations and NOTHING ELSE — permissions, model, theme,
  // every other tool's hooks, gone. There is no safe merge into bytes nobody parsed, so init
  // registers nothing and says which file to fix.
  const registration = facts.settingsUnreadable ? { settings: facts.settings, added: [] } : withRegistrations(facts.settings);
  return {
    config: facts.hasConfig ? null : { path: CONFIG_FILE, body: scaffold(facts.empty) },
    // NEVER over a hook that is already there. This is a scaffold, and a repo whose gate runs its
    // own suite must not lose it to a re-run — which is also what makes init safe to run again.
    gate: !facts.isGit || facts.gateText !== null ? null : { path: GATE_PATH, body: PRE_COMMIT, mode: 0o755 },
    gateKept: facts.isGit && facts.gateText !== null && !armsFlow(facts.gateText),
    notGit: !facts.isGit,
    flowDir: !facts.hasFlowDir,
    link: facts.resolves ? null : facts.packageRoot,
    // Per CLONE, not per repo: `core.hooksPath` is not committed, so a fresh clone and every
    // worktree needs it set again. That is why init is the command a new checkout runs.
    hooksPath: facts.isGit && facts.hooksPath !== HOOKS_DIR,
    settings: registration.added.length === 0 ? null : { path: facts.settingsPath, value: registration.settings },
    registered: registration.added,
    settingsUnreadable: facts.settingsUnreadable ? facts.settingsPath : null,
  };
}

/**
 * The report — every write named, and everything NOT done said out loud with what to do instead.
 *
 * A setup command that prints "done" is a command nobody can check. Failures are handed in rather
 * than thrown because a PARTIAL init is the interesting case: the config landed, the settings file
 * was read-only, and the person needs to know exactly that.
 */
export function initLines(plan: InitPlan, failures: readonly string[]): string[] {
  const wrote: string[] = [];
  if (plan.config) wrote.push(plan.config.path);
  if (plan.gate) wrote.push(plan.gate.path);
  if (plan.flowDir) wrote.push(`${FLOW_DIR}/ — flow's own state, self-ignoring, never committed`);
  if (plan.link) wrote.push(`node_modules/@jawache/flow → ${plan.link} (npm link is flow's distribution until it is published)`);
  if (plan.settings) wrote.push(`${plan.settings.path} — ${plan.registered.join(" · ")}`);
  if (plan.hooksPath) wrote.push(SET_HOOKS_PATH);

  const lines: string[] =
    wrote.length === 0
      ? ["flow init — already set up here; nothing to do."]
      : ["flow init — created:", ...wrote.map((what) => `  + ${what}`)];

  if (plan.notGit) lines.push("  · not a git repo, so no commit gate was armed. Run `git init`, then `flow init` again.");
  if (plan.gateKept)
    lines.push(`  · kept the ${GATE_PATH} already here — flow never overwrites one, so ${ADD_THE_GATE_LINE} yourself.`);
  if (plan.settingsUnreadable !== null)
    lines.push(
      `  ✗ ${plan.settingsUnreadable} is not valid JSON, so nothing was registered and NOTHING was written to it — ` +
        `every other key in that file is somebody's, and there is no safe merge into bytes nobody could parse. ` +
        `Fix the JSON (a trailing comma, or a // comment) and run \`flow init\` again. Until then no rail fires.`,
    );
  for (const failure of failures) lines.push(`  ✗ ${failure}`);
  lines.push("  next: `flow status` — what is bound, and what is not wired yet.");
  return lines;
}

// ── status ───────────────────────────────────────────────────────────────────
//
// ONE VERB that answers "is flow working here, and what will meet me". Green means guarded: every
// rule loads, every fitting is in place, and no entry is bound at a moment nothing delivers.
//
// It counts what LOADS rather than what parses, and that distinction is the whole reason the old
// engine needed four verbs to answer this badly. A rule that cannot fire no longer loads at all, so
// "every one resolved and able to fire" is a statement the loader already made and this only has to
// report. What is left is the world AROUND the config — the gate, the hooks path, the registrations
// — and putting every red line where the person standing in the repo will see it, each with its fix.

/** One thing the world around the config has to be, and whether it is. A red line carries its fix. */
export interface Fitting {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Everything status was able to read. Gathering it is the shell's job; judging it is not. */
export interface StatusFacts {
  readonly root: string;
  readonly version: string;
  readonly off: boolean;
  readonly configPath: string;
  readonly hasConfig: boolean;
  /** The load, or null when there is no config to load. */
  readonly load: LoadResult | null;
  readonly gateText: string | null;
  readonly hooksPath: string | null;
  readonly settingsPath: string;
  readonly settings: unknown;
  /** Who last worked in this worktree, from the marker the write rail leaves. Null when nobody has. */
  readonly session: { readonly id: string; readonly agent: string | null; readonly wearing: readonly string[] } | null;
}

/** The whole answer. */
export interface Status {
  readonly root: string;
  readonly version: string;
  readonly armed: boolean;
  readonly configPath: string;
  readonly moments: MomentsView;
  /** Every category a bound entry names — the vocabulary this repo actually classifies by. */
  readonly categories: readonly string[];
  readonly session: StatusFacts["session"];
  /** Entries bound only at moments this harness cannot deliver. Loaded, counted, and dark. */
  readonly dark: readonly string[];
  readonly fittings: readonly Fitting[];
  readonly refusals: readonly Refusal[];
  readonly green: boolean;
}

function fittingsOf(facts: StatusFacts): Fitting[] {
  const registered = registeredEvents(facts.settings);
  const missing = HOOK_REGISTRATIONS.filter((r) => !registered.includes(r.event)).map((r) => r.event);
  const armed = armsFlow(facts.gateText);
  return [
    {
      id: "config",
      ok: facts.hasConfig,
      detail: facts.hasConfig
        ? facts.configPath
        : `no ${CONFIG_FILE} in ${facts.root} — \`flow init\` writes one, with a demo you can read in a minute.`,
    },
    {
      id: "commit-gate",
      ok: armed,
      detail: armed
        ? `${GATE_PATH} runs \`flow commit\` over the staged set`
        : facts.gateText === null
          ? `no ${GATE_PATH} — \`flow init\` arms it. Until then nothing runs at the commit.`
          : `${GATE_PATH} is here but does not call flow — ${ADD_THE_GATE_LINE}.`,
    },
    {
      id: "hooks-path",
      ok: facts.hooksPath === HOOKS_DIR,
      detail:
        facts.hooksPath === HOOKS_DIR
          ? `core.hooksPath = ${HOOKS_DIR}`
          : `core.hooksPath is ${facts.hooksPath ?? "unset"} — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    },
    {
      id: "hooks",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${facts.settingsPath} — ${registered.join(" · ")}`
          : `${facts.settingsPath} does not call flow for ${missing.join(" · ")} — re-run \`flow init\`. No live rail fires until it does.`,
    },
  ];
}

/**
 * EVERY RED LINE, worked out once — the list status closes on, and the definition of not-green.
 *
 * `green` and the closing count are the same question asked at two moments, and asking it twice is
 * how a page that ends "green" comes to exit 1. One function answers it: the boolean is this list
 * being empty, and the close prints its length.
 */
function redLines(s: Pick<Status, "refusals" | "dark" | "fittings">): string[] {
  return [
    ...s.refusals.map((r) => `${r.code}: ${r.detail}`),
    ...s.dark,
    ...s.fittings.filter((f) => !f.ok).map((f) => `${f.id}: ${f.detail}`),
  ];
}

/** Does this adapter carry that moment, for that KIND of entry? */
export function delivers(kind: EntrySpec["kind"], moment: Moment): boolean {
  return kind === "guardrail"
    ? isGuardrailMoment(moment) && DELIVERS.guard.includes(moment)
    : isBreadcrumbMoment(moment) && DELIVERS.brief.includes(moment);
}

/** The gathered facts, judged. Never throws: a broken config is a red line, not an exception. */
export function status(facts: StatusFacts): Status {
  const entries = facts.load?.ok === true ? facts.load.entries : [];
  const refusals = facts.load?.ok === false ? facts.load.refusals : [];

  // NO MOMENT TABLE WHEN THE CONFIG DID NOT LOAD. A load fault is not partial — the loader refuses
  // the whole document, so every rail is off until it is fixed, and printing "3 guardrails at the
  // commit" under a headline saying nothing is armed would be the old status's exact lie.
  const bound = refusals.length > 0 ? [] : universe(entries);
  const dark = bound
    .filter((entry) => entry.disabled === null && entry.at.length > 0 && !entry.at.some((m) => delivers(entry.kind, m)))
    .map((entry) => entry.id);
  const fittings = fittingsOf(facts);

  return {
    root: facts.root,
    version: facts.version,
    armed: !facts.off,
    configPath: facts.configPath,
    // NO RECORD NUMBERS HERE, deliberately. What each entry has DONE is a lifetime question over
    // every session's rows, and `flow facts` is the verb that asks it — a second reader of the same
    // rows is how two surfaces come to disagree about which rule is dead. status answers what is
    // BOUND, which needs no history at all.
    moments: momentsView(bound, null),
    categories: [...new Set(entries.flatMap((entry) => entry.categories))].sort(),
    session: facts.session,
    dark,
    fittings,
    refusals,
    green: redLines({ refusals, dark, fittings }).length === 0,
  };
}

/** One entry, as a person reads it: what it says, where it looks, and who it binds to. */
function entryLines(entry: Bound): string[] {
  const scope = [
    (entry.on?.length ?? 0) > 0 ? `on ${entry.on?.join(" ")}` : "",
    (entry.ignore?.length ?? 0) > 0 ? `not ${entry.ignore?.join(" ")}` : "",
    entry.for.length > 0 ? `for ${entry.for.join(" · ")}` : "",
  ].filter((part) => part !== "");
  const mark = entry.disabled !== null ? "○" : entry.kind === "guardrail" ? "✗" : "🍞";
  const lines = [`    ${mark} ${entry.id}${scope.length === 0 ? "" : `  —  ${scope.join(" · ")}`}`];
  if (entry.disabled !== null) lines.push(`        off: ${entry.disabled || "no reason given"}`);
  else if (entry.says !== null) lines.push(`        ${snip(entry.says, 100)}`);
  return lines;
}

/**
 * The whole answer as lines — the headline, what meets you and when, then everything not true yet.
 *
 * The branching is here rather than in the CLI shell for the reason every report in this package is:
 * which headline, whether a moment table is printable at all, when the close goes red — each of
 * those is a judgement about what a reader most needs to know, and in a shell not one has a test.
 */
export function statusLines(s: Status): string[] {
  if (!s.armed)
    return [`flow is OFF — every rail is silenced (${FLOW_DIR}/off is there). Delete that file to turn it back on.`];

  const { breadcrumbs, guardrails, disabled } = s.moments.totals;
  const lines = [
    s.refusals.length > 0
      ? `flow ${s.version} — the config will not load, so every guardrail and breadcrumb here is OFF.`
      : `flow is ON — ${count(guardrails, "guardrail")} · ${count(breadcrumbs, "breadcrumb")}` +
        (disabled === 0 ? "" : ` · ${disabled} disabled`) +
        ", every one resolved and able to fire",
    `  config     ${s.configPath}`,
    `  state      ${s.root}/${FLOW_DIR}`,
    `  session    ` +
      (s.session === null
        ? "no live session has marked this worktree yet"
        : `${s.session.id}${s.session.agent === null ? "" : ` · ${s.session.agent}`}, wearing ${s.session.wearing.length === 0 ? "no category" : s.session.wearing.join(" · ")}`),
  ];
  if (s.categories.length > 0) lines.push(`  categories ${s.categories.join(" · ")} — what the entries below bind to`);

  for (const { moment, entries } of s.moments.moments) {
    lines.push(`  ${moment}`);
    for (const entry of entries) lines.push(...entryLines(entry));
  }

  for (const fitting of s.fittings) lines.push(`  ${fitting.ok ? "✓" : "✗"} ${fitting.id}: ${fitting.detail}`);
  for (const refusal of s.refusals) lines.push(`  ✗ ${refusal.code}: ${refusal.detail}`);
  for (const id of s.dark)
    lines.push(
      `  ✗ ${id}: bound only at a moment nothing delivers here — it loads, it counts, and it will never fire. ` +
        `This adapter carries ${DELIVERS.guard.join(" · ")} for a guardrail and ${DELIVERS.brief.join(" · ")} for a breadcrumb.`,
    );
  lines.push(
    s.green
      ? "green — every rule loads, every fitting is in place."
      : `${count(redLines(s).length, "red line")} — flow is NOT fully in force here.`,
  );
  return lines;
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
