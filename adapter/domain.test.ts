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
import type { Block, Row } from "../engine/domain.ts";
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
  GUARD_PATHS,
  branchOf,
  health,
  selectSessions,
  classifyBash,
  classifyStore,
  cwdOf,
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
  startedAt,
  strip,
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
    expect(delivers("turn-end"), "the turn-end GUARDRAIL rail works").toBe(true);
    expect(DELIVERS.brief).not.toContain("turn-end");
    expect(DELIVERS.guard, "commit is delivered — by the git gate, not by the harness").toContain("commit");
    expect(delivers("session")).toBe(true);
    expect(delivers("touch")).toBe(true);
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
    expect(cwdOf(file)).toBe("/x/workbench.workflow-flow");
    expect(branchOf(file)).toBe("workflow/flow");
    expect(startedAt(file)).toBe("2026-01-01T00:00:00.000Z");
    // The stub records at the head of every file carry none of the three, so a literal first line
    // is never enough — and a file that has none of them says so rather than guessing.
    expect(cwdOf(store({ type: "last-prompt" }))).toBe(null);
    expect(branchOf("")).toBe(null);
    expect(startedAt("")).toBe(null);
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
  it("knows which files ARE the guard here, in flow's own spelling", () => {
    expect(GUARD_PATHS).toContain("flow.config.ts");
    expect(isGuardPath("flow.config.ts")).toBe(true);
    expect(isGuardPath("guards/mine.ts")).toBe(true);
    expect(isGuardPath("packages/app/.claude/settings.json")).toBe(true);
    expect(isGuardPath("src/a.ts")).toBe(false);
    expect(isGuardPath("")).toBe(false);
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
    expect(weakenedAfterBlock(rows, events)).toEqual([{ entry: "core.noTodo", line: 9, path: "flow.config.ts", gapSeconds: 30 }]);
    expect(weakenedAfterBlock(rows, [])).toEqual([]);
    expect(weakenedAfterBlock([], events)).toEqual([]);
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
