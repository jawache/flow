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
import { FLOW_DIR, logFile, offPath, statePath, type Row } from "./domain.ts";
import {
  appendRows,
  commitSession,
  ensureFlowDir,
  isOff,
  loadState,
  readRows,
  saveState,
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
  it("attributes a commit to the session that was just editing this worktree", () => {
    expect(writeMarker(root, "sess-1", "workflow/flow", at)).toBe(true);
    expect(commitSession(root, "workflow/flow", at.getTime() + 60_000)).toBe("sess-1");
  });

  it("keeps two worktrees apart by branch, so neither mis-attributes the other's commit", () => {
    writeMarker(root, "on-flow", "workflow/flow", at);
    writeMarker(root, "on-main", "main", at);
    expect(commitSession(root, "main", at.getTime())).toBe("on-main");
    expect(commitSession(root, "workflow/flow", at.getTime())).toBe("on-flow");
  });

  it("falls back to an unattributed commit when there is no marker, or it has gone stale", () => {
    expect(commitSession(root, "main", at.getTime())).toBe("commit");
    writeMarker(root, "sess-1", "main", at);
    expect(commitSession(root, "main", at.getTime() + 5 * 60 * 60 * 1000)).toBe("commit");
  });

  it("drops the marker rather than throwing when it cannot be written", () => {
    const blocked = mkdtempSync(join(tmpdir(), "flow-blocked-"));
    writeFileSync(join(blocked, FLOW_DIR), "in the way");
    expect(writeMarker(blocked, "s", null, at)).toBe(false);
    rmSync(blocked, { recursive: true, force: true });
  });
});
