// flow/adapter/domain.test.ts — the Claude Code dialect, proved as decisions.
//
// This is the file that knows what a hook payload and a transcript line mean, so it is the file
// where the harness's shape is pinned. Three claims carry it:
//
//   PAYLOAD → EVENT     the would-be file rebuilt in memory (J2.2), the delete targets a Bash line
//                       carries, and silence for anything flow was not asked for.
//   EFFECT → RESULT     one refusal spelling — exit 2, the text on stderr — and one injection
//                       spelling, the decision object.
//   THE TRANSCRIPT      the four dialect leaks that used to live in a pure home: drift's token
//                       count, the turn's actions, the brief, and the tool row.
//
// It is a unit suite because every one of those is a function of its arguments: a payload is an
// object and a transcript is a string. The live wiring is proved next door, against the built
// binary, over stdin.

import { describe, it, expect } from "vitest";
import type { TurnAction } from "../index.ts";
import { metrics, momentsView, type Block, type Bound, type Row } from "../engine/domain.ts";
import { matchAny } from "../glob.ts";
import {
  ALLOW,
  DELIVERS,
  EDIT_TOOLS,
  GIT_HOOK_ENV,
  HOOK_EVENTS,
  applyEdit,
  branchFromHead,
  briefBlock,
  briefHead,
  contextTokens,
  decision,
  deleteTargets,
  delivers,
  faultText,
  hermeticEnv,
  isHookEvent,
  isInjected,
  relativise,
  sessionFactsFrom,
  sidecarPath,
  toEvent,
  toResult,
  tokensFromTranscript,
  toolRow,
  touchedPath,
  CONFIG_FILE,
  configImports,
  configSurface,
  guardPaths,
  HOST_SURFACE,
  formatFacts,
  health,
  joinSpawn,
  uncoveredAreas,
  selectSessions,
  classifyBash,
  classifyStore,
  isCorrection,
  isGuardPath,
  mergeNarratives,
  narrative,
  parseEvents,
  projectFolderName,
  recipeTools,
  snip,
  spawnMeta,
  spawnsIn,
  strip,
  transcriptHead,
  weakenedAfterBlock,
  transcriptLines,
  turnActions,
  wouldBeFile,
  type AdapterEvent,
  type EventWorld,
  type HookPayload,
  type Shown,
  type TranscriptEvent,
  type Candidate,
  type Facts,
  type SpawnRecord,
  NODE_FLOOR,
  configLoadFault,
  HOOK_REGISTRATIONS,
  ourHookCommand,
  registeredEvents,
  withRegistrations,
  PRE_COMMIT,
  HOOKS_DIR,
  GATE_PATH,
  SET_HOOKS_PATH,
  ADD_THE_GATE_LINE,
  armsFlow,
  scaffold,
  planInit,
  initLines,
  status,
  statusLines,
  type InitFacts,
  type StatusFacts,
} from "./domain.ts";

// ── the world a payload is read against ──────────────────────────────────────

const ROOT = "/repo";

/**
 * Disk, as a map. Injected, because reading it is the shell's job and never a decision.
 *
 * `turn` is a function here for the same reason it is one in the interface: working out what the
 * actor did costs a whole transcript, and only the stop rail should ever pay for it. `asked` is how
 * this suite proves the other rails do not.
 */
let asked: string[];

function world(files: Record<string, string> = {}, turn: readonly TurnAction[] = []): EventWorld {
  asked = [];
  return {
    root: ROOT,
    read: (path) => files[path] ?? null,
    turn: () => {
      asked.push("turn");
      return turn;
    },
  };
}

const pre = (tool: string, input: Record<string, unknown>): HookPayload => ({
  session_id: "s1",
  tool_name: tool,
  tool_input: input,
});

/** The one guard event a payload produced, when a test is about exactly one. */
function only(events: readonly AdapterEvent[]): AdapterEvent {
  expect(events).toHaveLength(1);
  return events[0] as AdapterEvent;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS ADAPTER ANSWERS TO
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the five events, and the moments honestly delivered", () => {
  it("answers to five events, named by the event and never by the job", () => {
    expect([...HOOK_EVENTS]).toStrictEqual(["session-start", "pre-tool-use", "post-tool-use", "stop", "notification"]);
    expect(isHookEvent("pre-tool-use")).toBe(true);
    expect(isHookEvent("PreToolUse"), "the host's name is not flow's verb").toBe(false);
  });

  it("states what it can supply, and does not claim turn-end briefing", () => {
    // Stop's decision object carries no context channel, so a note bound at turn-end has nowhere to
    // be shown. Saying so is the contract; faking it would be the failure.
    expect(delivers("guardrail", "turn-end"), "the turn-end GUARDRAIL rail works").toBe(true);
    expect(delivers("breadcrumb", "turn-end"), "a NOTE bound there has nowhere to be shown").toBe(false);
    expect(DELIVERS.brief).not.toContain("turn-end");
    expect(DELIVERS.guard, "commit is delivered — by the git gate, not by the harness").toContain("commit");
    expect(delivers("breadcrumb", "session")).toBe(true);
    expect(delivers("breadcrumb", "touch")).toBe(true);
    expect(delivers("guardrail", "session"), "a guardrail has no session rail at all").toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PAYLOAD → EVENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the would-be file, rebuilt in memory before disk", () => {
  it("takes a Write's content outright", () => {
    expect(wouldBeFile("Write", { file_path: "/repo/src/a.ts", content: "next" }, world())).toStrictEqual({
      path: "src/a.ts",
      content: "next",
    });
  });

  it("folds an Edit into the file as it stands", () => {
    const w = world({ "src/a.ts": "const a = 1;\nconst b = 2;\n" });
    expect(wouldBeFile("Edit", { file_path: "/repo/src/a.ts", old_string: "1", new_string: "9" }, w)?.content).toBe(
      "const a = 9;\nconst b = 2;\n",
    );
  });

  it("folds every edit of a MultiEdit, in order", () => {
    const w = world({ "a.ts": "one two" });
    const edits = [
      { old_string: "one", new_string: "1" },
      { old_string: "two", new_string: "2" },
    ];
    expect(wouldBeFile("MultiEdit", { file_path: "a.ts", edits }, w)?.content).toBe("1 2");
  });

  it("stands aside when an anchor is not in the file — never judges a guess", () => {
    // The whole capability rests on the reconstruction being EXACT. A file that never existed is
    // worse than no guard at all, so an unlocatable anchor abandons the whole reconstruction.
    const w = world({ "a.ts": "one" });
    expect(applyEdit("one", { old_string: "nope", new_string: "x" })).toBeNull();
    expect(wouldBeFile("Edit", { file_path: "a.ts", old_string: "nope", new_string: "x" }, w)).toBeNull();
    expect(
      wouldBeFile("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "one", new_string: "1" }, { old_string: "zz", new_string: "" }] }, w),
      "one bad anchor abandons the fold rather than judging a half-applied file",
    ).toBeNull();
  });

  it("treats an empty anchor as a Write, and replace_all as every occurrence", () => {
    expect(applyEdit("anything", { old_string: "", new_string: "whole" })).toBe("whole");
    expect(applyEdit("a a a", { old_string: "a", new_string: "b", replace_all: true })).toBe("b b b");
  });

  it("is not a write at all when the tool names no path, or is not a writing tool", () => {
    expect(wouldBeFile("Write", {}, world())).toBeNull();
    expect(wouldBeFile("Read", { file_path: "a.ts" }, world())).toBeNull();
  });

  it("relativises against the root, because that is how every glob is written", () => {
    expect(relativise("/repo/src/a.ts", ROOT)).toBe("src/a.ts");
    expect(relativise("src/a.ts", ROOT), "already relative").toBe("src/a.ts");
    expect(relativise("/elsewhere/a.ts", ROOT), "outside the repo stays absolute").toBe("/elsewhere/a.ts");
  });
});

describe("a Bash line's delete targets", () => {
  it("reads rm, git rm, and the SOURCE side of mv and git mv", () => {
    expect(deleteTargets("rm -rf secret/a.ts b.ts")).toStrictEqual(["secret/a.ts", "b.ts"]);
    expect(deleteTargets("git rm secret/a.ts")).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets("mv secret/a.ts elsewhere/a.ts")).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets("git mv secret/a.ts elsewhere/a.ts"), "git mv was the old blind spot").toStrictEqual([
      "secret/a.ts",
    ]);
  });

  it("reads every sub-command of a chained line, and no others", () => {
    expect(deleteTargets("just build && rm dist/a.js")).toStrictEqual(["dist/a.js"]);
    expect(deleteTargets("echo 'rm a.ts'"), "a quoted mention is not a command").toStrictEqual([]);
    expect(deleteTargets("git commit -m 'rm the thing'")).toStrictEqual([]);
  });

  it("stands aside on a line it cannot tokenise, rather than guessing", () => {
    // null from the tokeniser means "I cannot tell". A guard that guesses at a line it could not
    // parse is worse than one that stands aside — and the command rail still sees the raw line.
    expect(deleteTargets("rm 'unclosed")).toStrictEqual([]);
  });

  it("does not read a rename with only a destination as a removal", () => {
    expect(deleteTargets("mv onlyone")).toStrictEqual([]);
  });
});

describe("toEvent — one payload, every moment it carries", () => {
  it("turns a session start into the session moment", () => {
    expect(toEvent("session-start", { source: "startup" }, world())).toStrictEqual([
      { rail: "brief", moment: "session" },
    ]);
  });

  it("turns an Edit into a write event carrying the would-be file", () => {
    const w = world({ "src/a.ts": "old" });
    const event = only(toEvent("pre-tool-use", pre("Edit", { file_path: "/repo/src/a.ts", old_string: "old", new_string: "new" }), w));
    expect(event).toStrictEqual({ rail: "guard", moment: "write", file: { path: "src/a.ts", content: "new" } });
    // The write rail is the one that fires on every keystroke, and a transcript is megabytes.
    expect(asked, "the write rail must never pay for the turn").toStrictEqual([]);
  });

  it("turns a Bash call into the command moment, plus a delete moment per file it would remove", () => {
    // One call, two rails — which is why toEvent answers with a list. The delete rail sees the file
    // as it still is, so a content rule can ask what is about to be lost.
    const w = world({ "secret/a.ts": "the content" });
    const events = toEvent("pre-tool-use", pre("Bash", { command: "rm secret/a.ts" }), w);
    expect(events).toStrictEqual([
      { rail: "guard", moment: "command", command: "rm secret/a.ts" },
      { rail: "guard", moment: "delete", file: { path: "secret/a.ts", content: "the content" } },
    ]);
  });

  it("raises no delete moment for a file that is already gone", () => {
    const events = toEvent("pre-tool-use", pre("Bash", { command: "rm nowhere.ts" }), world());
    expect(events).toStrictEqual([{ rail: "guard", moment: "command", command: "rm nowhere.ts" }]);
  });

  it("turns a post-tool-use call on a file into a touch, and a pathless one into silence", () => {
    expect(toEvent("post-tool-use", pre("Read", { file_path: "/repo/docs/x.md" }), world())).toStrictEqual([
      { rail: "brief", moment: "touch", path: "docs/x.md" },
    ]);
    // A touch event with no path would show EVERY area breadcrumb rather than none — the engine
    // narrows by `on` only when the event names a path. Silence, and the note arrives on the next
    // file the session touches.
    expect(toEvent("post-tool-use", pre("Bash", { command: "ls" }), world())).toStrictEqual([]);
  });

  it("turns a stop into turn-end carrying the turn's actions, and honours the host's loop-breaker", () => {
    const actions: TurnAction[] = [{ did: "edit", path: "a.ts" }];
    expect(toEvent("stop", { session_id: "s" }, world({}, actions))).toStrictEqual([
      { rail: "guard", moment: "turn-end", turn: actions },
    ]);
    expect(
      toEvent("stop", { stop_hook_active: true }, world({}, actions)),
      "we already held this turn open once; blocking again is how a session wedges",
    ).toStrictEqual([]);
  });

  it("answers an empty payload, and a notification, with silence rather than an invented moment", () => {
    expect(toEvent("pre-tool-use", {}, world())).toStrictEqual([]);
    expect(toEvent("pre-tool-use", pre("Bash", {}), world())).toStrictEqual([]);
    expect(toEvent("notification", { session_id: "s" }, world())).toStrictEqual([]);
  });

  it("reads what a post-tool-use call was about, path tools and searches alike", () => {
    expect(touchedPath(pre("Grep", { pattern: "x", path: "/repo/src" }), ROOT)).toBe("src");
    expect(touchedPath(pre("NotebookEdit", { notebook_path: "/repo/n.ipynb" }), ROOT)).toBe("n.ipynb");
    expect(touchedPath(pre("Bash", { command: "ls" }), ROOT)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EFFECT → RESULT
// ════════════════════════════════════════════════════════════════════════════════════════════════

const block = (over: Partial<Block> = {}): Block => ({
  do: "block",
  entry: "core.noTodo",
  message: "No TODOs in shipped code.",
  subject: "src/a.ts",
  detail: "says TODO",
  ...over,
});

describe("toResult — one refusal spelling, one injection spelling", () => {
  it("blocks with exit 2 and the whole refusal on stderr", () => {
    // ONE spelling at every rail. The old engine had three — a PreToolUse deny object, exit 2, and
    // a Stop decision object — three shapes for one answer, each with its own way of being wrong.
    const result = toResult("pre-tool-use", { refused: [{ moment: "write", block: block() }], shown: [] });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("flow — blocked before the write landed");
    expect(result.stderr).toContain("core.noTodo · src/a.ts");
    expect(result.stderr).toContain("No TODOs in shipped code.");
    expect(result.stderr).toContain("says TODO");
    expect(result.stderr, "a refusal without an instruction leaves a blocked agent guessing").toContain(
      "Adjust the change so it passes, then retry.",
    );
  });

  it("banners by the RAIL that refused, not by the hook that carried it", () => {
    const bash = (moment: "command" | "delete"): string =>
      toResult("pre-tool-use", { refused: [{ moment, block: block() }], shown: [] }).stderr;
    expect(bash("command")).toContain("command blocked before it ran");
    expect(bash("delete")).toContain("blocked before the delete");
    expect(toResult("stop", { refused: [{ moment: "turn-end", block: block() }], shown: [] }).stderr).toContain(
      "turn held open",
    );
  });

  it("carries every refusal, not just the first", () => {
    const result = toResult("pre-tool-use", {
      refused: [
        { moment: "write", block: block({ entry: "one" }) },
        { moment: "write", block: block({ entry: "two" }) },
      ],
      shown: [],
    });
    expect(result.stderr).toContain("one");
    expect(result.stderr).toContain("two");
  });

  it("injects notes as the decision object the host reads, echoing its own event name", () => {
    const shown: Shown[] = [{ entry: "work.orientation", cause: "session", body: "This repo is guarded by flow." }];
    const result = toResult("session-start", { refused: [], shown });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "# breadcrumb: work.orientation (session)\nThis repo is guarded by flow.",
      },
    });
  });

  it("refuses before it injects — a rail that blocks has nothing to add", () => {
    const result = toResult("pre-tool-use", {
      refused: [{ moment: "write", block: block() }],
      shown: [{ entry: "a", cause: "first-touch", body: "hello" }],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
  });

  it("says nothing at all when nothing happened", () => {
    expect(toResult("post-tool-use", { refused: [], shown: [] })).toStrictEqual(ALLOW);
    expect(
      toResult("post-tool-use", { refused: [], shown: [{ entry: "a", cause: "drift", body: "   " }] }),
      "a note whose prose could not be resolved is not an empty injection",
    ).toStrictEqual(ALLOW);
  });

  it("heads each note with the mechanism's own name and its cause", () => {
    const text = briefBlock([
      { entry: "area", cause: "first-touch", body: "one" },
      { entry: "drifted", cause: "drift", body: "two" },
    ]);
    expect(text).toBe("# breadcrumb: area (first-touch)\none\n\n# breadcrumb: drifted (drift)\ntwo");
  });

  it("names the event in a decision object", () => {
    expect(JSON.parse(decision("post-tool-use", "x"))).toStrictEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "x" },
    });
  });

  it("says which of the three things happened to a payload it could not read", () => {
    // "There was nothing to guard" and "I could not SEE what I was guarding" were one answer in the
    // old engine — an empty object — so a rail that could not read its payload allowed, silently.
    expect(faultText("pre-tool-use", "unreadable", "EBADF")).toBe(
      "[flow hook pre-tool-use] the guard could not READ its payload from stdin (EBADF).",
    );
    expect(faultText("stop", "unparseable", "12 bytes on stdin, and not JSON")).toContain("could not PARSE");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT
// ════════════════════════════════════════════════════════════════════════════════════════════════

const line = (record: unknown): string => JSON.stringify(record);

const assistant = (content: unknown, usage?: Record<string, number>): string =>
  line({ type: "assistant", message: { role: "assistant", content, ...(usage ? { usage } : {}) } });

const human = (prose: string): string => line({ type: "user", message: { role: "user", content: prose } });

const use = (name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: "tool_use",
  name,
  input,
});

describe("the transcript's dialect", () => {
  it("reads every readable line and skips the rest", () => {
    const jsonl = [human("hi"), "", "{not json", line("a string, not a record"), assistant([])].join("\n");
    const lines = transcriptLines(jsonl);
    expect(lines.map((l) => l.kind)).toStrictEqual(["user", "assistant"]);
  });

  it("counts drift as input plus BOTH cache buckets, from the LAST assistant message", () => {
    // input_tokens alone is about nil — the context lives in cache_read_input_tokens — so a counter
    // that summed the obvious field would read ~0 forever, which looks like a session that never
    // drifts.
    expect(contextTokens({ input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 })).toBe(110);
    expect(contextTokens(undefined)).toBe(0);
    const jsonl = [
      assistant([], { input_tokens: 1, cache_read_input_tokens: 10 }),
      human("carry on"),
      assistant([], { input_tokens: 2, cache_read_input_tokens: 40_000 }),
    ].join("\n");
    expect(tokensFromTranscript(jsonl)).toBe(40_002);
    expect(tokensFromTranscript(""), "no transcript is no drift, not an error").toBe(0);
  });

  it("reads the turn's actions as edits and runs, in order, since the human last spoke", () => {
    const jsonl = [
      human("first turn"),
      assistant([use("Edit", { file_path: "/repo/rules/a.yml" })]),
      human("second turn"),
      assistant([use("Write", { file_path: "/repo/rules/b.yml" }), use("Bash", { command: "just test-rules" })]),
      assistant([use("Read", { file_path: "/repo/rules/c.yml" })]),
    ].join("\n");
    expect(turnActions(jsonl, ROOT)).toStrictEqual([
      { did: "edit", path: "rules/b.yml" },
      { did: "run", command: "just test-rules" },
    ]);
  });

  it("does not mistake the harness's own injections for the human starting a new turn", () => {
    // A hook's additionalContext arrives wearing a user message's clothes. Reading one as a turn
    // boundary would empty the turn's actions exactly when a turn-end rule needs them.
    const jsonl = [
      human("do the thing"),
      assistant([use("Edit", { file_path: "a.ts" })]),
      human("<system-reminder>\nremember the rules\n</system-reminder>"),
      assistant([use("Bash", { command: "ls" })]),
    ].join("\n");
    expect(turnActions(jsonl)).toStrictEqual([
      { did: "edit", path: "a.ts" },
      { did: "run", command: "ls" },
    ]);
    expect(isInjected("  <system-reminder>x")).toBe(true);
    expect(isInjected("write the code")).toBe(false);
  });

  it("knows which tool names change a file, in one place", () => {
    expect([...EDIT_TOOLS].sort()).toStrictEqual(["Edit", "MultiEdit", "NotebookEdit", "Write"]);
    const jsonl = [human("go"), assistant([use("NotebookEdit", { notebook_path: "n.ipynb" })])].join("\n");
    expect(turnActions(jsonl), "the old copy did not know about NotebookEdit").toStrictEqual([
      { did: "edit", path: "n.ipynb" },
    ]);
  });

  it("reads the brief a session was started with, and nothing the harness said", () => {
    const jsonl = [
      line({ type: "user", isMeta: true, message: { content: "Caveat: the messages below…" } }),
      human("<command-name>/work</command-name>"),
      human("Follow `/work build`. The repo is …"),
      human("and another thing"),
    ].join("\n");
    expect(briefHead(jsonl)).toBe("Follow `/work build`. The repo is …");
    expect(briefHead(jsonl, 6)).toBe("Follow");
    expect(briefHead("")).toBe("");
  });
});

describe("who the session is, from what the host wrote", () => {
  const sidecar = JSON.stringify({ agentType: "builder", description: "build F4", spawnDepth: 1 });

  it("takes the agent type from the sidecar and the brief from the transcript", () => {
    const facts = sessionFactsFrom({
      payload: { session_id: "s", agent_id: "agent-1" },
      transcript: human("Follow `/work build`"),
      sidecar,
    });
    expect(facts).toStrictEqual({
      head: "Follow `/work build`",
      subagent: true,
      agentType: "builder",
      description: "build F4",
    });
  });

  it("reads the parent by ABSENCE — no sidecar, no agent id, no type", () => {
    const facts = sessionFactsFrom({ payload: { session_id: "s" }, transcript: human("hello"), sidecar: null });
    expect(facts).toStrictEqual({ head: "hello", subagent: false });
  });

  it("keeps a spawn a spawn when its sidecar will not parse — spawned, but as what we cannot say", () => {
    const facts = sessionFactsFrom({ payload: { session_id: "s", agent_id: "a" }, transcript: null, sidecar: "{oops" });
    expect(facts.subagent).toBe(true);
    expect(facts.agentType, "a category keyed on a type declines; the parent must not claim it").toBeUndefined();
    expect(facts.head).toBe("");
  });

  it("reads the branch out of HEAD's own text, ref or detached", () => {
    // A file read rather than a `git` subprocess: the marker is written on every tool call, and it
    // is the only form that answers on an unborn branch — every repo's own first commit.
    expect(branchFromHead("ref: refs/heads/workflow/flow\n")).toBe("workflow/flow");
    expect(branchFromHead("9f2c1a4b8e7d6c5b4a39\n"), "detached — the short sha").toBe("9f2c1a4b8e7d");
    expect(branchFromHead("  \n")).toBeNull();
  });

  it("finds the sidecar beside the transcript it belongs to", () => {
    expect(sidecarPath("/c/projects/p/s1/subagents/agent-a7.jsonl")).toBe(
      "/c/projects/p/s1/subagents/agent-a7.meta.json",
    );
    expect(sidecarPath("/c/projects/p/s1"), "not a transcript path at all").toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDER, AND THE ENVIRONMENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the flight recorder's row", () => {
  it("records a path call, a command call, and a search — every call, by name", () => {
    // `edit: true` is stamped here and nowhere else: the engine reads the record back to answer
    // "how much work happened in this area" and may never import this file to ask which of the
    // host's tool names change a file.
    expect(toolRow(pre("Edit", { file_path: "/repo/src/a.ts" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Edit",
      path: "src/a.ts",
      edit: true,
    });
    expect(toolRow(pre("Read", { file_path: "/repo/src/a.ts" }), ROOT)).toMatchObject({ edit: false });
    expect(toolRow(pre("Bash", { command: "just test" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Bash",
      command: "just test",
    });
    expect(toolRow(pre("Grep", { pattern: "TODO", path: "/repo/src" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Grep",
      pattern: "TODO",
      scope: "src",
    });
    expect(toolRow(pre("Task", {}), ROOT), "no subject is still a call worth counting").toStrictEqual({
      kind: "tool",
      tool: "Task",
    });
    expect(toolRow({ session_id: "s" }), "no tool is no row").toBeNull();
  });
});

describe("the environment a check's command sees", () => {
  it("strips git's hook plumbing, and keeps everything else", () => {
    // The gate runs inside the pre-commit hook and inherits these; a nested `git` would then aim at
    // the in-progress commit. It was the tool-gate rule's own business until ctx.exec became the
    // one door.
    const env = hermeticEnv({ PATH: "/usr/bin", GIT_INDEX_FILE: "/repo/.git/index", HOME: "/home/me" });
    expect(env).toStrictEqual({ PATH: "/usr/bin", HOME: "/home/me" });
    expect(GIT_HOOK_ENV).toContain("GIT_DIR");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ARCHIVAL SIDE — the store, and what a conversation says
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The live half above is handed a transcript path. This half is asked about a REPO, after the
// fact, and has to find the conversations itself — so it is proved the same way, as decisions over
// bytes: a folder listing is an array of strings, a transcript is a string, and what they MEAN is
// the thing under test.

/** A whole transcript file, built the way the host writes it. */
const store = (...records: Record<string, unknown>[]): string => records.map((r) => JSON.stringify(r)).join("\n");

const spokeBack = (blocks: unknown[], ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "assistant",
  timestamp: ts,
  message: { content: blocks },
});

const spoke = (prose: string, ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "user",
  timestamp: ts,
  message: { content: prose },
});

const used = (name: string, input: Record<string, unknown>, id = "toolu_1"): Record<string, unknown> => ({
  type: "tool_use",
  id,
  name,
  input,
});

describe("the store — where the harness keeps its transcripts", () => {
  it("encodes a working directory the way the host does: every non-alphanumeric becomes a dash", () => {
    expect(projectFolderName("/Users/x/dev/repo")).toBe("-Users-x-dev-repo");
    // A dot is not special, so a hidden folder yields a DOUBLED dash — the check that this is the
    // real rule rather than the hand-written `[/.]` approximation the old tools carried.
    expect(projectFolderName("/Users/x/.work/y")).toBe("-Users-x--work-y");
    expect(projectFolderName("/Users/x/a_b c")).toBe("-Users-x-a-b-c");
  });

  it("sorts a listing into sessions, their subagents, and what it did not understand", () => {
    const { transcripts, ignored } = classifyStore([
      "abc.jsonl",
      "abc/subagents/agent-1.jsonl",
      "abc/subagents/agent-1.meta.json",
      "abc/subagents/agent-2.jsonl",
      "notes.txt",
      "abc/summary.md",
    ]);
    expect(transcripts).toEqual([
      { path: "abc.jsonl", meta: null, session: "abc", agent: null },
      { path: "abc/subagents/agent-1.jsonl", meta: "abc/subagents/agent-1.meta.json", session: "abc", agent: "agent-1" },
      // The sidecar is only named when the listing HELD it — the shell never probes for a file.
      { path: "abc/subagents/agent-2.jsonl", meta: null, session: "abc", agent: "agent-2" },
    ]);
    // A `.meta.json` is read through its transcript, so naming it as ignored would be noise.
    expect(ignored).toEqual(["notes.txt", "abc/summary.md"]);
  });

  it("reads the sidecar, including the toolUseId that joins it to the parent's own call", () => {
    expect(
      spawnMeta('{"agentType":"builder","description":"Build F5","toolUseId":"toolu_9","model":"opus","spawnDepth":1}'),
    ).toEqual({ agentType: "builder", description: "Build F5", toolUseId: "toolu_9", model: "opus", spawnDepth: 1 });
    expect(spawnMeta("{}")).toEqual({ agentType: null, description: null, toolUseId: null, model: null, spawnDepth: null });
    expect(spawnMeta("not json")).toBe(null);
    expect(spawnMeta(null)).toBe(null);
  });

  it("joins a sidecar to the parent block that spawned it, by id", () => {
    const parent = store(
      spoke("go"),
      spokeBack(
        [used("Agent", { subagent_type: "general-purpose", description: "Build F5", prompt: "x" }, "toolu_9")],
        "2026-01-01T10:00:00.000Z",
      ),
      spokeBack([used("Read", { file_path: "/repo/a.ts" }, "toolu_x")]),
    );
    const spawns = spawnsIn(parent);
    expect([...spawns.keys()]).toEqual(["toolu_9"]);
    const meta = spawnMeta('{"agentType":"builder","toolUseId":"toolu_9"}');
    expect(spawns.get(meta?.toolUseId ?? "")).toMatchObject({
      asked: "general-purpose",
      description: "Build F5",
      ts: "2026-01-01T10:00:00.000Z",
      line: 2,
    });
    // The sidecar OUTRANKS what the parent asked for — that is the whole point of the join: the
    // parent's `general-purpose` is a claim, and `builder` is what the host wrote down.
    expect(meta?.agentType).toBe("builder");
  });

  it("answers which worktree a transcript belongs to from the RECORDS, never from the folder name", () => {
    // Two different checkouts, one folder name — which is why the name can never be inverted.
    expect(projectFolderName("/x/workbench.workflow-flow")).toBe(projectFolderName("/x/workbench/workflow/flow"));
    const file = store(
      { type: "last-prompt" },
      { type: "mode" },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/x/workbench.workflow-flow",
        gitBranch: "workflow/flow",
        message: { content: "hi" },
      },
    );
    // ONE pass for all three. It was three functions and therefore three parses of the same
    // multi-megabyte file, per conversation in the store, for an answer that is in its first few
    // records — and this stops as soon as it has them.
    expect(transcriptHead(file)).toEqual({
      cwd: "/x/workbench.workflow-flow",
      branch: "workflow/flow",
      started: "2026-01-01T00:00:00.000Z",
    });
    // The stub records at the head of every file carry none of the three, so a literal first line
    // is never enough — and a file that has none of them says so rather than guessing.
    expect(transcriptHead(store({ type: "last-prompt" }))).toEqual({ cwd: null, branch: null, started: null });
    expect(transcriptHead("")).toEqual({ cwd: null, branch: null, started: null });
  });
});

describe("the narrative — the pairing, and the pointers it produces", () => {
  it("reads typed prompts, tool calls and their results, each with its line", () => {
    const file = store(
      { type: "user", message: { content: "<system-reminder>injected</system-reminder>" } },
      spoke("please fix the build"),
      spokeBack([used("Bash", { command: "just test" }, "toolu_1")], "2026-01-01T09:00:00.000Z"),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }] } },
      spokeBack([used("Edit", { file_path: "/repo/src/a.ts" }, "toolu_2")]),
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ text: "boom" }], is_error: true }] },
      },
    );
    expect(parseEvents(file, "/repo")).toEqual([
      // The injected reminder is NOT a prompt: the harness talking to itself is not the human.
      { line: 2, kind: "prompt", text: "please fix the build" },
      { line: 3, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "toolu_1", name: "Bash", input: { command: "just test" }, path: "" },
      { line: 4, kind: "result", id: "toolu_1", content: "ok", failed: false },
      {
        line: 5,
        kind: "use",
        ts: "2026-01-01T00:00:00.000Z",
        id: "toolu_2",
        name: "Edit",
        input: { file_path: "/repo/src/a.ts" },
        path: "src/a.ts",
      },
      { line: 6, kind: "result", id: "toolu_2", content: "boom", failed: true },
    ]);
  });

  it("a result carrying an object rather than text is still readable", () => {
    const file = store({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: { n: 1 } }] } });
    expect(parseEvents(file)[0]).toMatchObject({ kind: "result", content: '{"n":1}', failed: false });
  });

  it("spots the human pushing back — a heuristic, which is why every finding cites its line", () => {
    expect(isCorrection("actually, revert that")).toBe(true);
    expect(isCorrection("you forgot the test")).toBe(true);
    // `no,` — the commonest spelling of pushback there is, and the one the ported regex could
    // never match: its alternative ended in a punctuation class and was then asked for a word
    // boundary, which a comma followed by a space can never be. A dead alternative in a detector
    // is the spec's own P2 shape, so the anchoring moved outside the class.
    expect(isCorrection("no, the other one")).toBe(true);
    expect(isCorrection("wait, that is not it")).toBe(true);
    expect(isCorrection("please add a test for the parser")).toBe(false);
    expect(isCorrection("the manifest has no, or few, entries")).toBe(true);
  });

  it("shortens for printing, and MARKS the cut so a truncated line never reads as a whole one", () => {
    expect(snip("  a\n  b  ")).toBe("a b");
    expect(snip("abcdefghij", 5)).toBe("abcd…");
    expect(strip("[31mred[0m")).toBe("red");
    expect(strip(undefined)).toBe("");
  });
});

describe("the justfile — a bypass is DERIVED from the repo's own recipes", () => {
  const justfile = ["# a comment", "test:", "    npx vitest run", "    @just lint", "lint:", "    eslint .", "[private]"].join("\n");


  it("reads each recipe body's command words, minus the shell noise", () => {
    // `npx vitest run` names `vitest`, not `npx`. The ported reader took the first word, found a
    // launcher in its own noise list, and dropped the line — so in a repo that drives everything
    // through npx (this one) the tool set came back empty and the bypass section was silently off.
    expect(recipeTools(justfile).sort()).toEqual(["eslint", "vitest"]);
    // With no justfile there is nothing to bypass, so the detection switches itself off rather
    // than falling back to a hardcoded list that would be wrong in every other repo.
    expect(recipeTools("")).toEqual([]);
  });

  it("tells a recipe call from going round it, and leaves a heredoc alone", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("just test && just lint", tools)).toEqual({ recipes: ["test", "lint"], bypasses: [], commits: false });
    expect(classifyBash("npx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("just test-vitest", tools)).toEqual({ recipes: ["test-vitest"], bypasses: [], commits: false });
    expect(classifyBash("git commit -m x", tools).commits).toBe(true);
    // Authoring a file whose body mentions a tool is not running that tool.
    expect(classifyBash("cat <<'EOF' > x\neslint .\nEOF", tools)).toEqual({ recipes: [], bypasses: [], commits: false });
  });
});

describe("the narrative reading — stats, loops, retries, and what was touched", () => {
  const call = (name: string, input: Record<string, unknown>, line: number): TranscriptEvent => ({
    line,
    kind: "use",
    ts: null,
    id: `t${line}`,
    name,
    input,
    path: typeof input["file_path"] === "string" ? input["file_path"] : "",
  });

  it("counts the work, and cites where the human pushed back", () => {
    const read = narrative(
      [
        { line: 1, kind: "prompt", text: "add the parser" },
        { line: 2, kind: "prompt", text: "no, revert that" },
        call("Write", { file_path: "src/a.ts" }, 3),
        call("Edit", { file_path: "src/a.ts" }, 4),
        call("Read", { file_path: "src/b.ts" }, 5),
        call("Bash", { command: "git commit -m x" }, 6),
      ],
      [],
    );
    expect(read.stats).toMatchObject({ edits: 1, writes: 1, commits: 1 });
    expect(read.prompts.map((p) => p.line)).toEqual([1, 2]);
    expect(read.corrections.map((p) => p.text)).toEqual(["no, revert that"]);
    expect(read.touched).toEqual({ "src/a.ts": 2, "src/b.ts": 1 });
  });

  it("a file edited five times in a row is a LOOP; four is just work", () => {
    const edits = (n: number): TranscriptEvent[] =>
      Array.from({ length: n }, (_, i) => call("Edit", { file_path: "src/a.ts" }, i + 1));
    expect(narrative(edits(4)).loops).toEqual([]);
    expect(narrative(edits(5)).loops).toEqual([{ path: "src/a.ts", count: 5, from: 1, to: 5 }]);
    // A path outside the repo breaks the run rather than extending it — it is not this tree's file.
    expect(narrative([...edits(3), call("Edit", { file_path: "/tmp/x" }, 9), ...edits(3)]).loops).toEqual([]);
  });

  it("the same command three times is a RETRY, with every line it happened on", () => {
    const runs = Array.from({ length: 3 }, (_, i) => call("Bash", { command: "just test" }, i + 1));
    expect(narrative(runs).retries).toEqual([{ command: "just test", count: 3, lines: [1, 2, 3] }]);
    expect(narrative(runs.slice(0, 2)).retries).toEqual([]);
  });

  it("records a bypass at the site it happened, so the coach reads the line", () => {
    const read = narrative([call("Bash", { command: "npx vitest run" }, 7)], ["vitest"]);
    expect(read.stats.bypasses).toEqual({ vitest: 1 });
    expect(read.bypassSites).toEqual([{ line: 7, tool: "vitest", text: "npx vitest run" }]);
  });

  it("merges several readings into ONE list, each pointer tagged with its own transcript", () => {
    const one = narrative([{ line: 1, kind: "prompt", text: "no, undo it" }, call("Edit", { file_path: "a.ts" }, 2)]);
    const two = narrative([call("Edit", { file_path: "a.ts" }, 3)]);
    const merged = mergeNarratives([
      { session: "s1", read: one },
      { session: "s2", read: two },
    ]);
    expect(merged.stats.edits).toBe(2);
    expect(merged.touched).toEqual({ "a.ts": 2 });
    expect(merged.corrections).toEqual([{ line: 1, text: "no, undo it", session: "s1" }]);
    expect(mergeNarratives([]).stats).toEqual({ edits: 0, writes: 0, commits: 0, recipes: {}, bypasses: {} });
  });
});

describe("weakened after a block — the one failure a guard cannot catch itself", () => {
  it("watches the host's registrations, and takes the repo's half whole from the surface", () => {
    // Two halves, and only one of them is this test's. That the repo half FOLLOWS the config's own
    // imports is `configSurface`'s claim and is proved where it is made, further down this file;
    // `guardPaths` does nothing but concatenate, so re-proving the derivation here would be a
    // second place for the same fact to be right and a first place for it to disagree.
    const paths = guardPaths(`import { house } from "./rules/house.ts";`);
    expect(paths).toStrictEqual([...configSurface(`import { house } from "./rules/house.ts";`), ...HOST_SURFACE]);

    // The config's name is spelled ONCE — a second copy here would leave a renamed config's old
    // name watched and its new one not.
    expect(paths).toContain(CONFIG_FILE);
    expect(CONFIG_FILE).toBe("flow.config.ts");
    expect(isGuardPath("flow.config.ts", paths)).toBe(true);
    expect(isGuardPath("src/a.ts", paths)).toBe(false);
    expect(isGuardPath("", paths)).toBe(false);

    // The host's half is fixed, because those are the harness's file names and not a repo's, and it
    // is matched at any depth: a monorepo package carries its own `.claude/`.
    expect(isGuardPath(".claude/settings.json", guardPaths(null))).toBe(true);
    expect(isGuardPath("packages/app/.claude/settings.json", paths)).toBe(true);
    expect(isGuardPath(".claude/agents/builder.md", paths)).toBe(true);
  });

  it("flags the guardrail edit that followed a block, citing both ends and the gap", () => {
    const rows: Row[] = [
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "deny" },
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "allow" },
    ];
    const events: TranscriptEvent[] = [
      { line: 4, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "a", name: "Edit", input: {}, path: "flow.config.ts" },
      { line: 9, kind: "use", ts: "2026-01-01T10:00:30.000Z", id: "b", name: "Edit", input: {}, path: "flow.config.ts" },
      { line: 11, kind: "use", ts: "2026-01-01T10:01:00.000Z", id: "c", name: "Edit", input: {}, path: "src/a.ts" },
    ];
    // The edit BEFORE the block is not a weakening, and neither is one to an ordinary file.
    const paths = guardPaths(null);
    expect(weakenedAfterBlock(rows, events, paths)).toEqual([{ entry: "core.noTodo", line: 9, path: "flow.config.ts", gapSeconds: 30 }]);
    expect(weakenedAfterBlock(rows, [], paths)).toEqual([]);
    expect(weakenedAfterBlock([], events, paths)).toEqual([]);
  });
});

describe("selecting which conversations a run covers", () => {
  const at = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    id,
    bytes: 100,
    mtimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
    started: null,
    branch: null,
    ...over,
  });

  const newest = at("new", { started: "2026-03-01T00:00:00.000Z" });
  const middle = at("mid", { started: "2026-02-01T00:00:00.000Z", bytes: 900 });
  const oldest = at("old", { started: "2026-01-01T00:00:00.000Z" });

  it("subtracts what is already done, and orders newest first", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(["mid"]));
    expect(picked.analyse.map((c) => c.id)).toEqual(["new", "old"]);
    expect(picked.counts).toEqual({ backlog: 2, analysed: 2, excluded: 0 });
  });

  it("orders heaviest-first when asked — wasted effort concentrates in the big conversations", () => {
    expect(selectSessions([oldest, newest, middle], new Set(), { largest: true }).analyse.map((c) => c.id)).toEqual([
      "mid",
      "new",
      "old",
    ]);
  });

  it("a limit DEFERS rather than drops, so a capped run cannot declare skipped history done", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { limit: 1 });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded).toEqual([
      { id: "mid", reason: "limit" },
      { id: "old", reason: "limit" },
    ]);
    expect(selectSessions([oldest, newest], new Set(), { limit: 1, all: true }).analyse).toHaveLength(2);
  });

  it("a date floor defers everything older, naming each one", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { since: Date.parse("2026-02-15T00:00:00.000Z") });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded.map((e) => e.reason)).toEqual(["since", "since"]);
  });

  it("falls back to the file's own mtime when the conversation never stamped a start", () => {
    const dated = at("dated", { started: null, mtimeMs: Date.parse("2026-05-01T00:00:00.000Z") });
    expect(selectSessions([newest, dated], new Set()).analyse[0]?.id).toBe("dated");
  });
});

describe("the health line above every number", () => {
  it("an unarmed record BLOCKS the reading rather than reporting zeroes", () => {
    const said = health({ armed: false, rows: 0, withRecord: 0, analysed: 3 });
    expect(said.blocked).toContain("NOT ARMED");
    expect(said.warn).toEqual([]);
  });

  it("armed but silent for what was read is a warning, not a verdict", () => {
    expect(health({ armed: true, rows: 0, withRecord: 1, analysed: 1 }).warn[0]).toContain("holds no events");
    expect(health({ armed: true, rows: 0, withRecord: 0, analysed: 2 }).warn[0]).toContain("narrative only");
    expect(health({ armed: true, rows: 12, withRecord: 1, analysed: 1 })).toEqual({ blocked: null, warn: [] });
  });
});

describe("the reading — the join, the coverage answer, and the lines a person reads", () => {
  const bound: Bound[] = [
    { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["write"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    { kind: "guardrail", id: "core.off", pack: "core", at: ["write"], on: ["docs/**"], for: [], description: null, says: null, disabled: "superseded" },
  ];

  it("joins a subagent's two host-written records, and keeps what only one of them knows", () => {
    const spawns = new Map([
      ["toolu_9", { toolUseId: "toolu_9", asked: "general-purpose", description: "Build F5", ts: "2026-01-01T10:00:00.000Z", line: 12 }],
    ]);
    // A builder hidden inside a generic bucket: the parent CLAIMED general-purpose, the host WROTE
    // builder, and only one of those is evidence.
    expect(
      joinSpawn({ session: "s1", agent: "agent-1", meta: spawnMeta('{"agentType":"builder","toolUseId":"toolu_9","model":"opus"}'), spawns }),
    ).toEqual({
      session: "s1",
      agent: "agent-1",
      agentType: "builder",
      description: "Build F5",
      model: "opus",
      asked: "general-purpose",
      at: "2026-01-01T10:00:00.000Z",
      line: 12,
    });

    // No sidecar at all: spawned, as what we cannot say — and nothing is invented to fill it.
    expect(joinSpawn({ session: "s1", agent: "agent-2", meta: null, spawns })).toEqual({
      session: "s1",
      agent: "agent-2",
      agentType: null,
      description: null,
      model: null,
      asked: null,
      at: null,
      line: null,
    });

    // A sidecar whose id names no block in the parent: what it alone knows still crosses.
    const orphan = joinSpawn({ session: "s1", agent: "agent-3", meta: spawnMeta('{"agentType":"verifier","toolUseId":"toolu_x"}'), spawns });
    expect(orphan).toMatchObject({ agentType: "verifier", asked: null, line: null });
  });

  it("answers coverage from the TRANSCRIPT, which reaches conversations the record cannot", () => {
    expect(uncoveredAreas({ "src/a.ts": 3, "docs/x.md": 9, "README.md": 1 }, bound)).toEqual([
      // `docs/**` is watched by an entry that is TURNED OFF, so it is not watched.
      { path: "docs/x.md", touches: 9 },
      { path: "README.md", touches: 1 },
    ]);
    expect(uncoveredAreas({}, bound)).toEqual([]);
  });
});

describe("formatFacts — the whole of what a person sees", () => {
  const empty = (over: Partial<Facts> = {}): Facts => ({
    root: "/repo",
    store: { dir: "/home/.claude/projects/-repo", exists: true, ignored: [] },
    selection: { analyse: [], excluded: [], counts: { backlog: 0, analysed: 0, excluded: 0 } },
    coverage: { analysed: 0, withRecord: 0, narrativeOnly: 0 },
    health: { blocked: null, warn: [] },
    metrics: metrics({ sessions: [], entries: [], nowMs: 0 }),
    moments: momentsView([], null),
    terrain: [],
    narrative: mergeNarratives([]),
    uncovered: [],
    actors: [],
    weakened: [],
    marked: null,
    ...over,
  });

  it("leads with the fail-loud header — an unarmed record is never presented as a calm week", () => {
    const lines = formatFacts(empty({ health: { blocked: "the record is NOT ARMED", warn: ["and a caveat"] } }));
    expect(lines[0]).toBe("✗ the record is NOT ARMED");
    expect(lines[1]).toBe("⚠ and a caveat");
  });

  it("says a thin history is thin, rather than letting a zero read as a verdict", () => {
    expect(formatFacts(empty()).join("\n")).toContain("too thin to call anything dead");
    expect(formatFacts(empty()).join("\n")).toContain("nothing measurable yet");
    expect(formatFacts(empty({ store: { dir: "/nowhere", exists: false, ignored: [] } })).join("\n")).toContain("no store at /nowhere");
  });

  it("prints the record's own verdicts — the gap list, and each of the three silences", () => {
    const bound: Bound[] = [
      { kind: "guardrail", id: "core.fiction", pack: "core", at: ["commit"], on: ["changelog/**"], for: [], description: null, says: null, disabled: null },
    ];
    const ampleRows: Row[] = [
      { kind: "run", ts: "2026-01-01T00:00:00.000Z", moment: "commit", rules: [{ id: "core.fiction", evaluated: 0, hits: 0, silenced: 0 }] },
      { kind: "tool", ts: "2026-02-05T00:00:00.000Z", tool: "Edit", path: "docs/x.md", edit: true },
    ];
    const text = formatFacts(
      empty({ metrics: metrics({ sessions: [{ session: "s1", rows: ampleRows }], entries: bound, nowMs: Date.parse("2026-03-01T00:00:00.000Z") }) }),
    ).join("\n");
    expect(text).toContain("gap       docs — 1 edit, nothing watches it");
    expect(text).toContain("dead      core.fiction");
    expect(text).toContain("retire    core.fiction — bound, never once reached");
  });

  it("names an entry that used to catch things and stopped", () => {
    const bound: Bound[] = [
      { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["write"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    ];
    const rows: Row[] = [
      { kind: "run", ts: "2026-01-01T00:00:00.000Z", moment: "write", rules: [{ id: "core.noTodo", evaluated: 1, hits: 1, silenced: 0 }] },
      { kind: "guardrail", ts: "2026-01-01T00:00:00.000Z", moment: "write", id: "core.noTodo", out: "deny", subject: "src/a.ts" },
      { kind: "run", ts: "2026-02-05T00:00:00.000Z", moment: "write", rules: [] },
    ];
    const text = formatFacts(
      empty({ metrics: metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs: Date.parse("2026-03-01T00:00:00.000Z") }) }),
    ).join("\n");
    expect(text).toContain("quiet     core.noTodo (59d)");
  });

  it("prints every finding that only fires when something is wrong", () => {
    const read = empty({
      uncovered: [{ path: "skills/work/modes/build.md", touches: 30 }],
      actors: [{ session: "s1", agent: "a1", agentType: "builder", description: "Build F5", model: null, asked: "general-purpose", at: null, line: 3 }],
      weakened: [{ entry: "core.noTodo", line: 88, path: "flow.config.ts", gapSeconds: 42 }],
      marked: 2,
    });
    const text = formatFacts(read).join("\n");
    expect(text).toContain("unwatched skills/work/modes/build.md — touched 30×, no entry reaches it");
    // The spawn's two records disagree, and the line says so rather than picking one silently.
    expect(text).toContain("actor     builder (spawned as general-purpose) — Build F5");
    expect(text).toContain("⚠ the guard was edited after core.noTodo refused — flow.config.ts:L88, 42s later");
    expect(text).toContain("marked    2 conversation(s) read");
  });

  it("caps the headline lists and says how many it did not print", () => {
    const actor = (n: number): SpawnRecord => ({
      session: "s1",
      agent: `a${n}`,
      agentType: "builder",
      description: null,
      model: null,
      asked: "builder",
      at: null,
      line: null,
    });
    const text = formatFacts(empty({ actors: [1, 2, 3, 4, 5, 6, 7].map(actor) })).join("\n");
    expect(text.match(/actor {5}builder/g)).toHaveLength(5);
    expect(text).toContain("…and 2 more");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCT SURFACE — what `flow init` writes, and what `flow status` says
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Both verbs are decisions about the world rather than reads of it: what to write given what is
// already there, and what to SAY given what loaded. The shell next door (product.ts) stats, writes
// and spawns; every branch below is asserted here, where it costs a millisecond.

describe("the config load's one fault sentence", () => {
  it("turns a type-stripping parse error into the machine fact it really is", () => {
    const said = configLoadFault("flow.config.ts", "Unexpected token ':'", "22.4.0");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(`Node >= ${NODE_FLOOR}`);
    expect(said).toContain("22.4.0");
    expect(said, "the original is kept — the rewrite adds a cause, it does not hide one").toContain(
      "Unexpected token",
    );
  });

  it("leaves an ordinary failure alone — a missing import is not a version problem", () => {
    const said = configLoadFault("flow.config.ts", "Cannot find package 'left-pad'", "24.1.0");
    expect(said).toContain("Cannot find package 'left-pad'");
    expect(said).not.toContain(`Node >= ${NODE_FLOOR}`);
  });
});

describe("the hook registrations flow writes", () => {
  it("names exactly the events it answers — four, and Notification is not one", () => {
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).not.toContain("Notification");
  });

  it("registers each event once — two registrations on one event fire twice", () => {
    expect(new Set(HOOK_REGISTRATIONS.map((r) => r.event)).size).toBe(HOOK_REGISTRATIONS.length);
  });

  it("commands a word this build answers to — the list is derived, so it cannot name one it doesn't", () => {
    for (const registration of HOOK_REGISTRATIONS)
      expect(ourHookCommand(registration.command), registration.command).toBe(true);
    expect(HOOK_REGISTRATIONS.map((r) => r.command)).toContain("flow hook session-start");
  });

  it("recognises its own registration whatever path stands in front of the binary", () => {
    expect(ourHookCommand("flow hook stop")).toBe(true);
    expect(ourHookCommand("/usr/local/bin/flow hook pre-tool-use")).toBe(true);
    expect(ourHookCommand("node /x/flow/dist/flow.mjs hook stop")).toBe(true);
    expect(ourHookCommand("work hook stop"), "the old engine's, and not ours to touch").toBe(false);
    expect(ourHookCommand("flow hook nonsense"), "a word we do not answer to").toBe(false);
    expect(ourHookCommand("myflow hook stop")).toBe(false);
  });

  it("adds every event to a settings file that has none, leaving the rest of it alone", () => {
    const before = { permissions: { allow: ["Bash(git:*)"] } };
    const { settings, added } = withRegistrations(before);
    expect(added).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
    const after = settings as { permissions: unknown; hooks: Record<string, unknown[]> };
    expect(after.permissions, "untouched, byte for byte").toEqual(before.permissions);
    expect(registeredEvents(settings)).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
    expect(after.hooks["Stop"]).toEqual([{ hooks: [{ type: "command", command: "flow hook stop" }] }]);
    expect(after.hooks["PreToolUse"]?.[0]).toMatchObject({ matcher: "*" });
  });

  it("adds nothing on a second run — the whole of what makes init idempotent", () => {
    const once = withRegistrations({});
    const twice = withRegistrations(once.settings);
    expect(twice.added).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
  });

  it("keeps a stranger's registration on the same event and stands beside it", () => {
    const theirs = { hooks: { Stop: [{ hooks: [{ type: "command", command: "their-tool --report" }] }] } };
    const { settings, added } = withRegistrations(theirs);
    expect(added).toContain("Stop");
    const stop = (settings as { hooks: Record<string, unknown[]> }).hooks["Stop"];
    expect(JSON.stringify(stop), "theirs survives — we add, we never rewrite").toContain("their-tool --report");
    expect(JSON.stringify(stop)).toContain("flow hook stop");
  });

  it("reads nothing out of a settings file that is not an object", () => {
    expect(registeredEvents(null)).toEqual([]);
    expect(registeredEvents("nonsense")).toEqual([]);
    expect(registeredEvents({ hooks: { Stop: "not an array" } })).toEqual([]);
  });
});

describe("the git gate flow arms", () => {
  it("calls the binary's own commit verb over the staged set", () => {
    expect(PRE_COMMIT).toContain("flow commit");
    expect(PRE_COMMIT.startsWith("#!")).toBe(true);
  });

  it("names one hooks directory, and one gate inside it", () => {
    expect(GATE_PATH).toBe(`${HOOKS_DIR}/pre-commit`);
    expect(SET_HOOKS_PATH, "the report's line and the fitting's fix are one sentence").toContain(HOOKS_DIR);
    expect(PRE_COMMIT, "the hook's own comment tells you what arms it").toContain(SET_HOOKS_PATH);
  });

  it("recognises a gate that runs flow, and one that runs something else", () => {
    expect(armsFlow(PRE_COMMIT)).toBe(true);
    expect(armsFlow('#!/bin/sh\nwork guard commit "$@"\n'), "the old engine's gate").toBe(false);
    expect(armsFlow(null)).toBe(false);
  });
});

describe("the scaffolded config", () => {
  it("is a readable demo: the four ruled entries, a category, and one pack", () => {
    const demo = scaffold(false);
    expect(demo).toContain('from "@jawache/flow"');
    expect(demo).toContain("definePack");
    expect(demo).toContain("defineCategory");
    expect(demo).toContain("--force");
    expect(demo).toContain("subagent");
    expect(demo.split("\n").length, "one screen — the whole claim of the demo").toBeLessThan(80);
  });

  it("never contains the marker its own gate refuses — a config that blocks itself", () => {
    // The gate greps staged content for a marker, and the config is a staged file. Spelled whole it
    // would refuse the commit that added it, which is the exact self-reference this demo is here to
    // teach: the entry builds the word rather than writing it.
    expect(scaffold(false)).not.toContain("DO-NOT-COMMIT");
  });

  it("is an empty config, and nothing else, when asked for one", () => {
    const bare = scaffold(true);
    expect(bare).toContain("defineConfig([])");
    expect(bare).not.toContain("definePack");
  });
});

// ── init ─────────────────────────────────────────────────────────────────────

const bare: InitFacts = {
  root: "/repo",
  empty: false,
  isGit: true,
  hasConfig: false,
  gateText: null,
  hasFlowDir: false,
  hooksPath: null,
  settingsPath: "/home/.claude/settings.json",
  settings: {},
  settingsUnreadable: false,
  resolves: false,
  packageRoot: "/checkout/flow",
};

describe("planInit — a repo that has never heard of flow", () => {
  const plan = planInit(bare);

  it("writes the config, the gate, the state directory and the link", () => {
    expect(plan.config?.path).toBe("flow.config.ts");
    expect(plan.gate?.path).toBe(GATE_PATH);
    expect(plan.flowDir).toBe(true);
    expect(plan.link).toBe("/checkout/flow");
    expect(plan.hooksPath).toBe(true);
    expect(plan.registered).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
  });

  it("reports every write, and nothing it did not do", () => {
    const said = initLines(plan, []).join("\n");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(GATE_PATH);
    expect(said).toContain(".flow/");
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow status");
  });
});

describe("planInit — the second run", () => {
  const already = planInit({
    ...bare,
    hasConfig: true,
    gateText: PRE_COMMIT,
    hasFlowDir: true,
    hooksPath: HOOKS_DIR,
    resolves: true,
    settings: withRegistrations({}).settings,
  });

  it("adds nothing at all", () => {
    expect(already.config).toBeNull();
    expect(already.gate).toBeNull();
    expect(already.flowDir).toBe(false);
    expect(already.link).toBeNull();
    expect(already.hooksPath).toBe(false);
    expect(already.settings).toBeNull();
    expect(already.registered).toEqual([]);
  });

  it("says so in one line rather than printing an empty list", () => {
    expect(initLines(already, []).join("\n")).toContain("already set up");
  });
});

describe("planInit — a repo that already has a pre-commit hook", () => {
  const theirs = planInit({ ...bare, gateText: "#!/bin/sh\nnpm test\n" });

  it("NEVER overwrites it, and says what to add by hand", () => {
    expect(theirs.gate).toBeNull();
    const said = initLines(theirs, []).join("\n");
    expect(said).toContain("kept");
    expect(said, "the same instruction status gives, in the same words").toContain(ADD_THE_GATE_LINE);
  });
});

describe("the config surface — what a write may target while the guard is broken", () => {
  // The config as this repo writes it, and as a broken one still reads: the imports survive
  // whatever went wrong two hundred lines below them.
  const CONFIG = [
    `import { defineConfig, pack } from "@jawache/flow";`,
    `import { git, work } from "@jawache/flow/packs";`,
    `import { house } from "./guards/house.ts";`,
    ``,
    `export default defineConfig([pack(git), pack(house)]);`,
  ].join("\n");

  it("is the config and the packs it imports, and nothing else", () => {
    const surface = configSurface(CONFIG);
    expect(matchAny(CONFIG_FILE, surface)).toBe(true);
    expect(matchAny("guards/house.ts", surface)).toBe(true);
    expect(matchAny("guards/git.ts", surface), "the folder comes with the file").toBe(true);
    expect(matchAny("guards/nested/deep.ts", surface)).toBe(true);
    expect(matchAny("src/a.ts", surface)).toBe(false);
    expect(matchAny("cli/work.ts", surface)).toBe(false);
    // Not a suffix match: a file that merely ENDS with the config's name is somebody else's.
    expect(matchAny("vendor/flow.config.ts", surface)).toBe(false);
    expect(matchAny("src/guards/thing.ts", surface), "the folder is where the import said").toBe(false);
  });

  it("follows whatever the repo called the folder, and reaches nothing when the config names nothing", () => {
    // The whole point of reading the text: `guards/` was one repo's name for it, and every other
    // repo got a repair exception over a folder it does not have.
    const theirs = configSurface(`import { house } from "./.guard/house.ts";`);
    expect(matchAny(".guard/house.ts", theirs)).toBe(true);
    expect(matchAny(".guard/helpers/text.ts", theirs)).toBe(true);
    expect(matchAny("guards/house.ts", theirs)).toBe(false);
    // A config with every rule written inline imports no pack, so the surface is the config alone.
    const inline = configSurface(`import { defineConfig } from "@jawache/flow";`);
    expect([...inline]).toStrictEqual([CONFIG_FILE]);
    expect([...configSurface(null)]).toStrictEqual([CONFIG_FILE]);
  });

  it("reads the TEXT, not the module — which is the only reader a broken config has", () => {
    // Package specifiers are somebody else's source and never repairable here; `../` climbs out
    // of the root, where a repo-relative surface cannot follow.
    expect(configImports(CONFIG)).toStrictEqual(["guards/house.ts"]);
    expect(configImports(`import x from "../outside/y.ts";`)).toStrictEqual([]);
    expect(configImports(`const m = await import("./late/pack.ts");`)).toStrictEqual(["late/pack.ts"]);
    expect(configImports(`export { a } from "./again.ts";\nimport { b } from "./again.ts";`)).toStrictEqual(["again.ts"]);
    // The file below is not typescript at all any more, and its import line still answers.
    expect(configImports(`import { house } from "./guards/house.ts";\nthis is not typescript(((`)).toStrictEqual([
      "guards/house.ts",
    ]);
    // A `from '…'` phrase inside a QUOTED MESSAGE is harvested too, and that is the accepted
    // behaviour rather than a miss: separating a real import from a sentence that quotes one takes
    // a parser, and the file being asked about is the one that will not parse. Pinned here because
    // it only ever WIDENS the repair surface, and only while the config is already refusing every
    // other write — so the cost is one extra repairable path at a moment when nothing can commit.
    expect(configImports(`.message("write it as: import { x } from './guards/x.ts'")`)).toStrictEqual(["guards/x.ts"]);
  });
});

describe("planInit — the flags and the edges", () => {
  it("--empty scaffolds the bare config and the same wiring", () => {
    const plan = planInit({ ...bare, empty: true });
    expect(plan.config?.body).toContain("defineConfig([])");
    expect(plan.gate?.path).toBe(GATE_PATH);
  });

  it("arms no git gate outside a git repo, and says why", () => {
    const plan = planInit({ ...bare, isGit: false });
    expect(plan.gate).toBeNull();
    expect(plan.hooksPath).toBe(false);
    expect(initLines(plan, []).join("\n")).toContain("not a git repo");
  });

  it("links nothing when @jawache/flow already resolves — an installed package is not ours to shim", () => {
    expect(planInit({ ...bare, resolves: true }).link).toBeNull();
  });

  it("plans no link at all when the shell could not find its own package", () => {
    const plan = planInit({ ...bare, packageRoot: null });
    expect(plan.link, "not an empty path the shell would go on to symlink to nowhere").toBeNull();
    const said = initLines(plan, []).join("\n");
    expect(said, "and nothing is reported that was never done").not.toContain("node_modules/@jawache/flow");
    expect(said, "the rest of the setup still happened").toContain("flow.config.ts");
  });

  it("carries a failure the shell hit into the report rather than swallowing it", () => {
    expect(initLines(planInit(bare), [`could not write ${GATE_PATH}: EACCES`]).join("\n")).toContain("EACCES");
  });

  // The near-miss the crossing found, one branch from happening: a real settings.json holding
  // JSONC comments parsed to null, which reads identically to "there is no settings file" — and
  // the next line builds a NEW object holding four registrations and nothing else.
  it("registers NOTHING into a settings file it could not parse, and never writes over it", () => {
    const plan = planInit({ ...bare, settings: null, settingsUnreadable: true });
    expect(plan.settings, "no write is planned against bytes nobody parsed").toBeNull();
    expect(plan.registered).toStrictEqual([]);
    const said = initLines(plan, []).join("\n");
    expect(said).toContain("/home/.claude/settings.json");
    expect(said).toContain("not valid JSON");
    expect(said, "and it says the consequence rather than only the cause").toContain("no rail fires");
  });

  it("still creates a settings file that is simply ABSENT — the other silence", () => {
    const plan = planInit({ ...bare, settings: null, settingsUnreadable: false });
    expect(plan.settings?.path).toBe("/home/.claude/settings.json");
    expect(plan.registered.length, "all four events flow answers").toBe(4);
  });
});

// ── status ───────────────────────────────────────────────────────────────────

const noteAtTurnEnd = { kind: "breadcrumb", at: ["turn-end"], text: "late" } as const;

const statusFacts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  root: "/repo",
  version: "1.2.3",
  off: false,
  configPath: "/repo/flow.config.ts",
  hasConfig: true,
  load: { ok: true, entries: [] },
  gateText: PRE_COMMIT,
  hooksPath: HOOKS_DIR,
  settingsPath: "/home/.claude/settings.json",
  settings: withRegistrations({}).settings,
  session: null,
  ...over,
});

/** One loaded entry, as the load hands it over — the shape `status` reads. */
const loaded = (id: string, spec: Record<string, unknown>, categories: readonly string[] = []) => ({
  id,
  pack: id.split(".")[0] as string,
  key: id.split(".").slice(1).join("."),
  spec: spec as never,
  source: {},
  categories,
  phases: [],
});

describe("status — the whole answer", () => {
  it("is green over a fitted repo, and says the guard is on", () => {
    const s = status(statusFacts());
    expect(s.green).toBe(true);
    expect(s.fittings.every((f) => f.ok)).toBe(true);
    expect(statusLines(s)[0]).toContain("flow is ON");
  });

  it("lists every entry by moment, with its globs and the category it binds to", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.noTodo", { kind: "guardrail", at: ["write", "commit"], on: ["src/**"], message: "no" }),
            loaded("demo.onlySubagents", { kind: "guardrail", at: ["commit"], message: "no" }, ["subagent"]),
          ],
        },
      }),
    );
    const said = statusLines(s).join("\n");
    expect(said).toContain("demo.noTodo");
    expect(said).toContain("src/**");
    expect(said).toContain("for subagent");
    expect(s.categories).toEqual(["subagent"]);
    // An entry at two moments is listed under both — standing at the commit, a write rule is still
    // about to run.
    expect(said.match(/demo\.noTodo/g)?.length).toBe(2);
  });

  it("prints an entry's ignores beside its globs, and says so when a disabled one gave no reason", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.scoped", {
              kind: "guardrail",
              at: ["write"],
              on: ["src/**"],
              ignore: ["**/*.test.ts"],
              message: "no",
            }),
            loaded("demo.quiet", { kind: "guardrail", at: ["write"], message: "no", disabled: {} }),
          ],
        },
      }),
    );
    const said = statusLines(s).join("\n");
    expect(said).toContain("on src/**");
    expect(said).toContain("not **/*.test.ts");
    expect(said).toContain("no reason given");
  });

  it("names a session that wears nothing, and one the marker could not attribute to an agent", () => {
    const said = statusLines(status(statusFacts({ session: { id: "s1", agent: null, wearing: [] } }))).join("\n");
    expect(said).toContain("s1");
    expect(said).toContain("wearing no category");
  });

  it("lists a disabled entry with the reason somebody wrote", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.retired", {
              kind: "guardrail",
              at: ["commit"],
              message: "no",
              disabled: { reason: "the tool it calls is gone" },
            }),
          ],
        },
      }),
    );
    expect(statusLines(s).join("\n")).toContain("the tool it calls is gone");
  });

  it("names an entry bound at a moment this adapter cannot deliver — the dark rail", () => {
    const s = status({
      ...statusFacts(),
      load: { ok: true, entries: [loaded("demo.late", noteAtTurnEnd)] },
    });
    expect(s.dark).toEqual(["demo.late"]);
    expect(s.green, "a note that can never be shown is a red line").toBe(false);
    expect(statusLines(s).join("\n")).toContain("nothing delivers");
  });

  it("keeps the turn-end GUARDRAIL out of that list — the rail works, only the note is dark", () => {
    const s = status({
      ...statusFacts(),
      load: { ok: true, entries: [loaded("demo.ran", { kind: "guardrail", at: ["turn-end"], message: "no" })] },
    });
    expect(s.dark).toEqual([]);
  });

  it("says the session's own categories when a live session marked this worktree", () => {
    const s = status(statusFacts({ session: { id: "s1", agent: "main", wearing: ["parent"] } }));
    expect(statusLines(s).join("\n")).toContain("parent");
  });

  it("says so plainly when nothing has marked one", () => {
    expect(statusLines(status(statusFacts())).join("\n")).toContain("no live session");
  });
});

describe("status — the red lines, each carrying its fix", () => {
  const red = (over: Partial<StatusFacts>): string => statusLines(status(statusFacts(over))).join("\n");

  it("a repo with no config at all", () => {
    const s = status(statusFacts({ hasConfig: false, load: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s).join("\n")).toContain("flow init");
  });

  it("a config that will not load — every refusal, and every rail off until it is fixed", () => {
    const s = status(
      statusFacts({
        load: { ok: false, refusals: [{ code: "no-cases", entry: "demo.x", detail: "`demo.x` carries no cases." }] },
      }),
    );
    expect(s.green).toBe(false);
    const said = statusLines(s).join("\n");
    expect(said).toContain("carries no cases");
    expect(said, "no moment table under a headline saying nothing is armed").not.toContain("commit  ");
  });

  it("an unarmed git gate", () => {
    expect(red({ gateText: null })).toContain("flow init");
    const theirs = red({ gateText: "#!/bin/sh\nnpm test\n" });
    expect(theirs).toContain("does not call flow");
    expect(theirs, "the same instruction init gives, in the same words").toContain(ADD_THE_GATE_LINE);
  });

  it("a hooksPath git was never told about — the one a fresh clone always needs", () => {
    expect(red({ hooksPath: null })).toContain(SET_HOOKS_PATH);
  });

  it("a host that is not registered to call flow at all", () => {
    const said = red({ settings: {} });
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow init");
  });

  it("the kill switch, which is not a fault and outranks everything below it", () => {
    const s = status(statusFacts({ off: true }));
    expect(statusLines(s)).toHaveLength(1);
    expect(statusLines(s)[0]).toContain("OFF");
    expect(statusLines(s)[0]).toContain(".flow/off");
  });

  it("counts the reds it found, so a caller's exit code and the page agree", () => {
    const s = status(statusFacts({ gateText: null, hooksPath: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s).at(-1)).toContain("2 red lines");
  });

  it("closes on the same answer the exit code is taken from — never a green page that exits 1", () => {
    // One decision, read twice. Every shape below is a different route to not-green, and the close
    // has to follow `green` rather than re-deriving it from the parts.
    const shapes: Partial<StatusFacts>[] = [
      {},
      { gateText: null },
      { hasConfig: false, load: null },
      { settings: {} },
      { load: { ok: true, entries: [loaded("demo.late", noteAtTurnEnd)] } },
      { load: { ok: false, refusals: [{ code: "no-cases", entry: "demo.x", detail: "no cases" }] } },
    ];
    for (const shape of shapes) {
      const s = status(statusFacts(shape));
      expect(statusLines(s).at(-1)?.startsWith("green"), JSON.stringify(shape)).toBe(s.green);
    }
  });
});
