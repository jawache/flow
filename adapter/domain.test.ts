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
import type { Block } from "../engine/domain.ts";
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
  transcriptLines,
  turnActions,
  wouldBeFile,
  type AdapterEvent,
  type EventWorld,
  type HookPayload,
  type Shown,
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
    expect(toolRow(pre("Edit", { file_path: "/repo/src/a.ts" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Edit",
      path: "src/a.ts",
    });
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
