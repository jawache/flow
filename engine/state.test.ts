// flow/engine/state.test.ts — `.flow/` against a real directory.
//
// This is a SHELL, so it is proved the way a shell is: over a temp repo, end to end, asserting the
// bytes that land rather than the calls that were made. What is worth proving here is exactly what
// a unit test of the decisions next door cannot say — that the directory ignores itself, that two
// processes appending to one stream keep their order, and that every one of these functions
// answers instead of throwing when the disk says no.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineCategory, type SessionFacts } from "../index.ts";
import { builder, parent } from "../__fixtures__/engine-pack.ts";
import { FLOW_DIR, logFile, offPath, recordPath, recordingFile, statePath, type RecordedStep, type Row } from "./domain.ts";
import {
  appendRows,
  appendSteps,
  commitAttribution,
  ensureFlowDir,
  isOff,
  isRecording,
  loadRecording,
  loadState,
  readHistory,
  readRows,
  readRowsFile,
  saveState,
  sessionIds,
  stickyIdentity,
  writeMarker,
  type LogContext,
} from "./state.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flow-state-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fixed clock, so the rows a test reads back are the rows it can write down. */
const at = new Date("2026-09-04T12:00:00.000Z");
const ctx = (): LogContext => ({ root, session: "sess-1", branch: "workflow/flow", now: () => at });

describe("the state directory", () => {
  it("makes itself, and ignores itself and its own ignore file", () => {
    expect(ensureFlowDir(root)).toBe(true);
    const ignore = readFileSync(join(root, FLOW_DIR, ".gitignore"), "utf8");
    expect(ignore.split("\n")).toContain("*");
  });

  it("is idempotent, and never rewrites an ignore file somebody has edited", () => {
    ensureFlowDir(root);
    writeFileSync(join(root, FLOW_DIR, ".gitignore"), "# mine\n*\n");
    ensureFlowDir(root);
    expect(readFileSync(join(root, FLOW_DIR, ".gitignore"), "utf8")).toBe("# mine\n*\n");
  });

  it("answers false rather than throwing when it cannot be made", () => {
    // A FILE where the directory should be: the mkdir fails, and the caller gets a boolean.
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(ensureFlowDir(blocked)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("the off switch", () => {
  it("is off only when the file is definitely there", () => {
    expect(isOff(root)).toBe(false);
    ensureFlowDir(root);
    writeFileSync(offPath(root), "off\n");
    expect(isOff(root)).toBe(true);
  });
});

describe("one session × agent's state", () => {
  it("round-trips the sticky verdict and the marks", () => {
    expect(saveState(root, "sess-1", "agent-9", { categories: ["builder"], marks: { "a.b": 42 } })).toBe(true);
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ categories: ["builder"], marks: { "a.b": 42 } });
  });

  it("reads nothing-known before anything has been written, and after it has been corrupted", () => {
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ marks: {} });
    saveState(root, "sess-1", "agent-9", { marks: { x: 1 } });
    writeFileSync(statePath(root, "sess-1", "agent-9"), "{ half a fi");
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ marks: {} });
  });

  it("keeps two agents of one session apart — the identity unit is the pair", () => {
    saveState(root, "sess-1", "parent", { categories: ["parent"], marks: {} });
    saveState(root, "sess-1", "child", { categories: ["builder"], marks: {} });
    expect(loadState(root, "sess-1", "parent").categories).toEqual(["parent"]);
    expect(loadState(root, "sess-1", "child").categories).toEqual(["builder"]);
  });

  it("drops the write rather than throwing when the path cannot be written", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(saveState(blocked, "s", "a", { marks: {} })).toBe(false);
    expect(loadState(blocked, "s", "a")).toEqual({ marks: {} });
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("the sticky verdict, tied to disk", () => {
  const spawned: SessionFacts = { head: "Follow `/work build`", subagent: true, agentType: "general-purpose" };

  it("reads host-written evidence once, writes it down, and answers from the file after that", () => {
    const first = stickyIdentity(root, "sess-1", "agent-9", spawned, [builder, parent]);
    expect(first).toEqual({ wearing: ["builder"], faults: [], fresh: true });
    expect(loadState(root, "sess-1", "agent-9").categories).toEqual(["builder"]);

    // Different evidence, same session × agent: the stored verdict stands. A session's identity
    // cannot change under it halfway through, which is the whole of "sticky".
    const later = stickyIdentity(root, "sess-1", "agent-9", { head: "", subagent: false }, [builder, parent]);
    expect(later).toEqual({ wearing: ["builder"], faults: [], fresh: false });
  });

  it("keeps the marks it found — the verdict and the notes share one file", () => {
    saveState(root, "sess-1", "agent-9", { marks: { "a.b": 7 } });
    stickyIdentity(root, "sess-1", "agent-9", spawned, [builder]);
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ categories: ["builder"], marks: { "a.b": 7 } });
  });

  it("stores nothing when a classifier could not say, so the next hook tries again", () => {
    const broken = defineCategory("broken", () => {
      throw new Error("no transcript");
    });
    const seen = stickyIdentity(root, "sess-1", "agent-9", spawned, [broken]);
    expect(seen.faults).toEqual([{ category: "broken", error: "no transcript" }]);
    expect(loadState(root, "sess-1", "agent-9").categories).toBeUndefined();
  });

  it("classifies a session that wears nothing as wearing nothing, and remembers that too", () => {
    stickyIdentity(root, "sess-2", "agent-9", spawned, [parent]);
    expect(loadState(root, "sess-2", "agent-9").categories).toEqual([]);
  });
});

describe("the event log", () => {
  const rows: Row[] = [
    { kind: "run", moment: "write", subjects: 1, rules: [] },
    { kind: "guardrail", moment: "write", id: "a.b", out: "deny" },
  ];

  /** Every event's index, in order. The meta row carries none — it is the stream, not an event. */
  const seqs = (): unknown[] => readRows(root, "sess-1").filter((r) => r.kind !== "meta").map((r) => r.seq);

  it("opens a stream with its meta row — an armed guard and an absent one are different facts", () => {
    expect(appendRows(ctx(), rows)).toBe(true);
    const [meta] = readFileSync(logFile(root, "sess-1"), "utf8").split("\n");
    expect(JSON.parse(meta as string)).toEqual({
      kind: "meta",
      v: 1,
      session: "sess-1",
      started: at.toISOString(),
      branch: "workflow/flow",
      worktree: root,
    });
  });

  it("numbers every row, and keeps numbering across separate appends", () => {
    appendRows(ctx(), rows);
    appendRows(ctx(), [{ kind: "compaction" }]);
    expect(seqs()).toEqual([1, 2, 3]);
  });

  it("picks the numbering back up from the file when the writer is a fresh process", () => {
    // Which is every hook: the seq cache lives for one short-lived process, so the truth is the
    // log's own tail. Appending from a second `root` name for the same directory is the closest a
    // single-process test gets to that, and it exercises the tail read rather than the cache.
    appendRows(ctx(), rows);
    appendRows({ ...ctx(), root: `${root}/` }, [{ kind: "compaction" }]);
    expect(seqs()).toEqual([1, 2, 3]);
  });

  it("writes nothing for nothing, and reads an absent log as an empty history", () => {
    expect(appendRows(ctx(), [])).toBe(true);
    expect(existsSync(logFile(root, "sess-1"))).toBe(false);
    expect(readRows(root, "sess-1")).toEqual([]);
  });

  it("steps over a half-written line rather than losing the history behind it", () => {
    appendRows(ctx(), rows);
    writeFileSync(logFile(root, "sess-1"), `{"kind":"run","seq":9\n`, { flag: "a" });
    expect(readRows(root, "sess-1")).toHaveLength(3);
  });

  it("drops the write rather than throwing when the log cannot be opened", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    mkdirSync(join(blocked, FLOW_DIR), { recursive: true });
    writeFileSync(join(blocked, FLOW_DIR, "log"), "in the way");
    expect(appendRows({ root: blocked, session: "s", branch: null }, rows)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("the commit gate's marker", () => {
  it("attributes a commit to the session AND agent that were just editing this worktree", () => {
    // The agent rides along because identity is stored per session x agent: without it the gate
    // has no state file to look up, and an actor-scoped commit rule is silenced rather than run.
    expect(writeMarker(root, "sess-1", "agent-7", "workflow/flow", at)).toBe(true);
    expect(commitAttribution(root, "workflow/flow", at.getTime() + 60_000)).toStrictEqual({
      session: "sess-1",
      agent: "agent-7",
    });
  });

  it("keeps two worktrees apart by branch, so neither mis-attributes the other's commit", () => {
    writeMarker(root, "on-flow", "main-agent", "workflow/flow", at);
    writeMarker(root, "on-main", "main-agent", "main", at);
    expect(commitAttribution(root, "main", at.getTime()).session).toBe("on-main");
    expect(commitAttribution(root, "workflow/flow", at.getTime()).session).toBe("on-flow");
  });

  it("falls back to an unattributed commit when there is no marker, or it has gone stale", () => {
    expect(commitAttribution(root, "main", at.getTime())).toStrictEqual({ session: "commit", agent: null });
    writeMarker(root, "sess-1", "main", "main", at);
    expect(commitAttribution(root, "main", at.getTime() + 5 * 60 * 60 * 1000)).toStrictEqual({
      session: "commit",
      agent: null,
    });
  });

  it("drops the marker rather than throwing when it cannot be written", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(writeMarker(blocked, "s", "main", null, at)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("reading the whole history back", () => {
  it("finds every stream, and a repo with none is an empty history rather than an error", () => {
    expect(sessionIds(root)).toEqual([]);
    expect(readHistory(root)).toEqual([]);

    appendRows({ root, session: "sess-1", branch: null, now: () => at }, [{ kind: "tool", tool: "Read", path: "a.ts" }]);
    appendRows({ root, session: "commit", branch: null, now: () => at }, [{ kind: "run", moment: "commit", subjects: 1, rules: [] }]);
    // A stray file in the log folder is not a stream.
    writeFileSync(join(root, FLOW_DIR, "log", "notes.md"), "x");

    expect(sessionIds(root)).toEqual(["commit", "sess-1"]);
    const history = readHistory(root);
    expect(history.map((s) => s.session)).toEqual(["commit", "sess-1"]);
    // The meta row is part of the stream — a present-but-quiet log and a missing one are
    // different facts, and the first row is what tells them apart.
    expect(history[1]?.rows.map((r) => r.kind)).toEqual(["meta", "tool"]);
  });

  it("reads a stream by path, so a recording can be diffed against a log that is not ours", () => {
    const file = join(root, "elsewhere.jsonl");
    writeFileSync(file, '{"kind":"guardrail","id":"a"}\nnot json\n\n{"noKind":1}\n');
    expect(readRowsFile(file)).toEqual([{ kind: "guardrail", id: "a" }]);
    expect(readRowsFile(join(root, "missing.jsonl"))).toEqual([]);
  });
});

describe("the recording seam", () => {
  const step = (path: string): RecordedStep => ({ rail: "guard", moment: "write", file: { path, content: "x" }, wearing: [] });

  it("is off until the switch file exists, and a hiccup reads as off rather than as on", () => {
    expect(isRecording(root)).toBe(false);
    ensureFlowDir(root);
    writeFileSync(recordPath(root), "");
    expect(isRecording(root)).toBe(true);
  });

  it("writes its header once, then appends — the first writer is a hook, and it can only append", () => {
    expect(appendSteps(root, "sess-1", [step("a.ts")])).toBe(true);
    expect(appendSteps(root, "sess-1", [step("b.ts"), { rail: "compaction" }])).toBe(true);
    const text = readFileSync(recordingFile(root, "sess-1"), "utf8");
    expect(text.split("\n").filter(Boolean)).toHaveLength(4);

    const read = loadRecording(recordingFile(root, "sess-1"));
    expect(read.session).toBe("sess-1");
    expect(read.steps.map((s) => s.rail)).toEqual(["guard", "guard", "compaction"]);
  });

  it("nothing to record writes nothing, and an unwritable home answers false rather than throwing", () => {
    expect(appendSteps(root, "sess-1", [])).toBe(true);
    expect(existsSync(recordingFile(root, "sess-1"))).toBe(false);
    // A repo root that is a FILE cannot hold a state directory. Telemetry never throws: a
    // recording that could not be written must not be the reason a write is refused.
    const blocked = join(root, "a-file");
    writeFileSync(blocked, "");
    expect(appendSteps(blocked, "sess-1", [step("a.ts")])).toBe(false);
  });

  it("a recording that is not there is an empty one, keyed by the name it was asked for", () => {
    expect(loadRecording(join(root, "nope.jsonl"))).toEqual({ v: 1, session: "nope", steps: [] });
  });
});
