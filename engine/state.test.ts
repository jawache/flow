// flow/engine/state.test.ts — `.flow/` against a real directory.
//
// This is a SHELL, so it is proved the way a shell is: over a temp repo, end to end, asserting the
// bytes that land rather than the calls that were made. What is worth proving here is exactly what
// a unit test of the decisions next door cannot say — that the directory ignores itself, that two
// processes appending to one stream keep their order, and that every one of these functions
// answers instead of throwing when the disk says no.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineCategory, type SessionFacts } from "../index.ts";
import { builder, parent } from "../__fixtures__/engine-pack.ts";
import { FLOW_DIR, LOCK_STALE_MS, lockPath, logFile, offPath, recordPath, recordingFile, statePath, type Block, type RecordedStep, type Row, type SessionState } from "./domain.ts";
import {
  alreadyRead,
  appendRows,
  keepOutputs,
  appendSteps,
  commitAttribution,
  ensureFlowDir,
  isOff,
  isRecording,
  loadRecording,
  loadState,
  markRead,
  readHistory,
  readRows,
  readRowsFile,
  sessionIds,
  stickyIdentity,
  updateState,
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
const ctx = (): LogContext => ({ root, session: "sess-1", branch: "workflow/flow", who: { agent: "main" }, now: () => at });

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

/** Put this state down whole, the way a hook would after deciding. */
const put = (session: string, agent: string, state: SessionState): SessionState => updateState(root, session, agent, () => state);

describe("one session × agent's state", () => {
  it("round-trips the sticky verdict and the marks", () => {
    put("sess-1", "agent-9", { categories: ["builder"], marks: { "a.b": 42 } });
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ categories: ["builder"], marks: { "a.b": 42 } });
  });

  it("round-trips the paths git last listed in a working folder, and drops what is not a tree", () => {
    const trees = { "/repo": { head: "abc", files: { "src/a.ts": "h1", "gone.ts": "-" } }, "/repo.wt": { head: null, files: {} } };
    put("sess-1", "agent-9", { marks: {}, trees });
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ marks: {}, trees });
    writeFileSync(statePath(root, "sess-1", "agent-9"), JSON.stringify({ marks: {}, trees: { "/repo": { files: { "a.ts": 7 } }, "/x": "no", "/y": { head: 1, files: { "b.ts": "h" } } } }));
    expect(loadState(root, "sess-1", "agent-9").trees, "a path with no hash is dropped, and a folder with no files is not a tree").toEqual({ "/repo": { head: null, files: {} }, "/y": { head: null, files: { "b.ts": "h" } } });
  });

  it("reads nothing-known before anything has been written, and after it has been corrupted", () => {
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ marks: {} });
    put("sess-1", "agent-9", { marks: { x: 1 } });
    writeFileSync(statePath(root, "sess-1", "agent-9"), "{ half a fi");
    expect(loadState(root, "sess-1", "agent-9")).toEqual({ marks: {} });
  });

  it("keeps two agents of one session apart — the identity unit is the pair", () => {
    put("sess-1", "parent", { categories: ["parent"], marks: {} });
    put("sess-1", "child", { categories: ["builder"], marks: {} });
    expect(loadState(root, "sess-1", "parent").categories).toEqual(["parent"]);
    expect(loadState(root, "sess-1", "child").categories).toEqual(["builder"]);
  });

  it("drops the write rather than throwing when the path cannot be written, and still answers with the state it made", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(updateState(blocked, "s", "a", () => ({ marks: { a: 1 } }))).toEqual({ marks: { a: 1 } });
    expect(loadState(blocked, "s", "a")).toEqual({ marks: {} });
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("two hooks at once cannot drop each other's marks", () => {
  /** A hook, as a process of its own: it shows `count` breadcrumbs, one mark each, as fast as it can. */
  const hook = (tag: string, count: number): Promise<number | null> => {
    const here = fileURLToPath(new URL("./state.ts", import.meta.url));
    const script = `import { updateState } from ${JSON.stringify(here)};
      for (let i = 0; i < ${count}; i++) updateState(${JSON.stringify(root)}, "s", "a", (state) => ({ ...state, marks: { ...state.marks, ["${tag}" + i]: i } }));`;
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
      child.on("exit", resolve);
    });
  };

  it("keeps every mark two processes write against one state file", async () => {
    const codes = await Promise.all([hook("a", 30), hook("b", 30), hook("c", 30)]);
    expect(codes, "every hook finished").toEqual([0, 0, 0]);
    expect(Object.keys(loadState(root, "s", "a").marks), "ninety marks, none dropped").toHaveLength(90);
    expect(existsSync(lockPath(root, "s", "a")), "and the lock is let go").toBe(false);
  });

  it("takes over the lock of a hook that died holding it, and never waits for one that did not", () => {
    mkdirSync(join(root, FLOW_DIR, "state"), { recursive: true });
    mkdirSync(lockPath(root, "s", "a"));
    const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
    utimesSync(lockPath(root, "s", "a"), old, old);
    expect(updateState(root, "s", "a", (state) => ({ ...state, marks: { done: 1 } })).marks).toEqual({ done: 1 });
    expect(loadState(root, "s", "a").marks).toEqual({ done: 1 });
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
    put("sess-1", "agent-9", { marks: { "a.b": 7 } });
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
    expect(appendRows({ ...ctx(), harness: "codex" }, rows)).toBe(true);
    const [meta] = readFileSync(logFile(root, "sess-1"), "utf8").split("\n");
    expect(JSON.parse(meta as string)).toEqual({
      kind: "meta",
      v: 2,
      harness: "codex",
      session: "sess-1",
      started: at.toISOString(),
      branch: "workflow/flow",
      worktree: root,
    });
  });

  it("names the agent on every row after meta, and a subagent's type beside its id", () => {
    appendRows(ctx(), rows);
    appendRows({ ...ctx(), who: { agent: "a6009b5", agentType: "builder" } }, [{ kind: "compaction" }]);
    appendRows({ ...ctx(), who: { agent: "a1" } }, [{ kind: "compaction" }]);
    const [meta, ...events] = readRows(root, "sess-1");
    expect(meta, "the meta row is the stream, not an agent's").not.toHaveProperty("agent");
    expect(events.map((r) => [r["agent"], r["agentType"]])).toEqual([
      ["main", undefined],
      ["main", undefined],
      ["a6009b5", "builder"],
      ["a1", undefined],
    ]);
    expect(events[0], "no agentType key at all on the session's own rows").not.toHaveProperty("agentType");
    // The stamp leads the row, in the order the log page shows it.
    const third = readFileSync(logFile(root, "sess-1"), "utf8").split("\n")[3] as string;
    expect(Object.keys(JSON.parse(third) as object)).toEqual(["ts", "seq", "agent", "agentType", "kind"]);
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
    expect(appendRows({ root: blocked, session: "s", branch: null, who: { agent: "main" } }, rows)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("the commit gate's marker", () => {
  it("attributes a commit to the session AND agent that were just editing this worktree", () => {
    // The agent rides along because identity is stored per session x agent: without it the gate
    // has no state file to look up, and an actor-scoped commit rule is silenced rather than run.
    expect(writeMarker(root, "sess-1", { agent: "agent-7" }, "workflow/flow", at)).toBe(true);
    expect(commitAttribution(root, "workflow/flow", at.getTime() + 60_000)).toStrictEqual({
      session: "sess-1",
      who: { agent: "agent-7" },
    });
  });

  it("carries a subagent's type to the commit, so the gate's rows can name it", () => {
    writeMarker(root, "sess-1", { agent: "a6009b5", agentType: "builder" }, "workflow/flow", at);
    expect(commitAttribution(root, "workflow/flow", at.getTime())).toStrictEqual({
      session: "sess-1",
      who: { agent: "a6009b5", agentType: "builder" },
    });
    writeMarker(root, "sess-1", { agent: "main" }, "workflow/flow", at);
    const marked = JSON.parse(readFileSync(join(root, FLOW_DIR, ".session-workflow-flow"), "utf8")) as object;
    expect(marked, "the session itself leaves no type behind").not.toHaveProperty("agentType");
  });

  it("keeps two worktrees apart by branch, so neither mis-attributes the other's commit", () => {
    writeMarker(root, "on-flow", { agent: "main-agent" }, "workflow/flow", at);
    writeMarker(root, "on-main", { agent: "main-agent" }, "main", at);
    expect(commitAttribution(root, "main", at.getTime()).session).toBe("on-main");
    expect(commitAttribution(root, "workflow/flow", at.getTime()).session).toBe("on-flow");
  });

  it("falls back to an unattributed commit when there is no marker, or it has gone stale", () => {
    expect(commitAttribution(root, "main", at.getTime())).toStrictEqual({ session: "commit", who: null });
    writeMarker(root, "sess-1", { agent: "main" }, "main", at);
    expect(commitAttribution(root, "main", at.getTime() + 5 * 60 * 60 * 1000)).toStrictEqual({
      session: "commit",
      who: null,
    });
  });

  it("drops the marker rather than throwing when it cannot be written", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(writeMarker(blocked, "s", { agent: "main" }, null, at)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});

describe("reading the whole history back", () => {
  it("finds every stream, and a repo with none is an empty history rather than an error", () => {
    expect(sessionIds(root)).toEqual([]);
    expect(readHistory(root)).toEqual([]);

    appendRows({ root, session: "sess-1", branch: null, who: { agent: "main" }, now: () => at }, [{ kind: "tool", tool: "Read", path: "a.ts" }]);
    appendRows({ root, session: "commit", branch: null, who: { agent: "commit" }, now: () => at }, [{ kind: "run", moment: "commit", subjects: 1, rules: [] }]);
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

describe("what the archival side has already read", () => {
  it("a marker means READ, and its id is sanitised before it becomes a path", () => {
    expect(alreadyRead(root)).toEqual(new Set());
    expect(markRead(root, ["sess-1", "a/b"])).toBe(2);
    expect(alreadyRead(root)).toEqual(new Set(["sess-1", "a-b"]));
    expect(markRead(root, [])).toBe(0);
  });

  it("an unwritable home answers with a count rather than throwing — a marker is bookkeeping", () => {
    const blocked = join(root, "not-a-dir");
    writeFileSync(blocked, "");
    expect(markRead(blocked, ["sess-1"])).toBe(0);
    expect(alreadyRead(blocked)).toEqual(new Set());
  });
});

describe("the recording seam", () => {
  const step = (path: string): RecordedStep => ({ rail: "guard", moment: "commit", staged: [path], wearing: [] });

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

describe("keepOutputs", () => {
  const block = (lines: number): Block => ({
    do: "block",
    entry: "py.lint",
    message: "m",
    subject: null,
    detail: "d",
    output: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
  });

  it("keeps a file only when the refusal cut lines, and the file holds all of the output", () => {
    const file = join(root, ".flow", "output", "py.lint.log");
    keepOutputs(root, [block(40)]);
    expect(existsSync(file)).toBe(false);
    keepOutputs(root, [block(41)]);
    expect(readFileSync(file, "utf8").trimEnd().split("\n")).toHaveLength(41);
  });

  it("replaces a link planted at the file's name, and never writes through it", () => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "mine");
    mkdirSync(join(root, ".flow", "output"), { recursive: true });
    const file = join(root, ".flow", "output", "py.lint.log");
    symlinkSync(outside, file);
    keepOutputs(root, [block(41)]);
    expect(readFileSync(outside, "utf8")).toBe("mine");
    expect(readFileSync(file, "utf8").trimEnd().split("\n")).toHaveLength(41);
  });
});
