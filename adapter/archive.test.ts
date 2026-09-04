// flow/adapter/archive.test.ts — the archival shell, against a real store on disk.
//
// A SHELL suite, written like one: a temp repo, a temp `~/.claude` beside it laid out exactly as
// the host lays one out, and the assertions are about what comes back rather than about which
// calls were made. What is worth proving here is precisely what a unit test of the two domain
// files cannot say:
//
//   THE LAYOUT IS REAL          a session file at the top, its subagents in a folder, a sidecar
//                               beside each — walked the way the host writes it.
//   THE WORKTREE IS RESOLVED    the store folder's name is not invertible, so a conversation
//                               recorded in a SIBLING checkout must not be read as this one's.
//   NOTHING THROWS              a missing store, an unreadable transcript and a repo git cannot
//                               answer for are all facts to report, never errors to raise.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig, loadConfig, pack, type LoadResult } from "../index.ts";
import { rails } from "../__fixtures__/engine-pack.ts";
import { appendRows } from "../engine/state.ts";
import { alreadyRead, facts, markRead, projectDir, readStore, readTranscript } from "./archive.ts";
import { projectFolderName } from "./domain.ts";

let repo: string;
let home: string;

const regime: LoadResult = loadConfig(defineConfig([pack(rails)]));

/** One line of a transcript, as the host writes them. */
const line = (record: Record<string, unknown>): string => JSON.stringify(record);

/**
 * Write a conversation into the store, exactly where the host would put it.
 *
 * `cwd` is a parameter because it is the whole point of one of the tests below: the folder is
 * keyed on the working directory, and two checkouts of one repo can collapse into one folder name.
 */
function conversation(cwd: string, id: string, over: { agent?: string; meta?: unknown; body?: string[] } = {}): void {
  const dir = projectDir(cwd, home);
  const at = over.agent === undefined ? join(dir, `${id}.jsonl`) : join(dir, id, "subagents", `${over.agent}.jsonl`);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(
    at,
    [
      line({ type: "last-prompt" }),
      line({ type: "user", timestamp: "2026-09-04T10:00:00.000Z", cwd, gitBranch: "main", message: { content: "go" } }),
      ...(over.body ?? []),
      "",
    ].join("\n"),
  );
  if (over.meta !== undefined) writeFileSync(join(dir, id, "subagents", `${over.agent as string}.meta.json`), JSON.stringify(over.meta));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "flow-archive-"));
  home = mkdtempSync(join(tmpdir(), "flow-home-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("the store, walked", () => {
  it("finds a session, its subagents and their sidecars — and names what it did not understand", () => {
    conversation(repo, "sess-a");
    conversation(repo, "sess-a", { agent: "agent-1", meta: { agentType: "builder", toolUseId: "toolu_9" } });
    conversation(repo, "sess-a", { agent: "agent-2" });
    writeFileSync(join(projectDir(repo, home), "notes.md"), "x");

    const store = readStore(repo, home);
    expect(store.exists).toBe(true);
    expect(store.transcripts.map((t) => t.ref.path)).toEqual([
      "sess-a.jsonl",
      "sess-a/subagents/agent-1.jsonl",
      "sess-a/subagents/agent-2.jsonl",
    ]);
    expect(store.ignored).toEqual(["notes.md"]);
    expect(store.transcripts[0]?.bytes).toBeGreaterThan(0);

    const child = store.transcripts[1];
    const read = readTranscript(store.dir, child!);
    expect(read.meta).toMatchObject({ agentType: "builder", toolUseId: "toolu_9" });
    expect(read.jsonl).toContain('"type":"user"');
    // A subagent with no sidecar is spawned-but-unnamed, which is a different fact from unspawned.
    expect(readTranscript(store.dir, store.transcripts[2]!).meta).toBe(null);
  });

  it("a store that is not there is a FACT with a path on it, never an error", () => {
    const store = readStore(repo, home);
    expect(store).toMatchObject({ exists: false, transcripts: [], ignored: [] });
    expect(store.dir).toContain(projectFolderName(repo));
  });
});

describe("which checkout a conversation belongs to", () => {
  it("reads the cwd inside the records, because the folder name cannot be inverted", () => {
    // Two sibling worktrees whose paths collapse to the SAME store folder — the dot and the slash
    // both become a dash. A reader that trusted the name would attribute one to the other.
    const sibling = `${repo}/x`;
    expect(projectFolderName(`${repo}.x`)).toBe(projectFolderName(sibling));
    conversation(repo, "mine");
    conversation(sibling, "theirs");
    mkdirSync(sibling, { recursive: true });

    const read = facts(repo, regime, { home });
    expect(read.selection.analyse.map((c) => c.id)).toEqual(["mine"]);
    expect(read.selection.counts.backlog).toBe(1);
  });

  it("carries each conversation's own branch and start, so a run can be scoped to one", () => {
    conversation(repo, "mine");
    expect(facts(repo, regime, { home, branch: "main" }).selection.analyse).toHaveLength(1);
    expect(facts(repo, regime, { home, branch: "other" }).selection.analyse).toHaveLength(0);
    expect(facts(repo, regime, { home }).selection.analyse[0]?.started).toBe("2026-09-04T10:00:00.000Z");
  });
});

describe("the backlog's memory", () => {
  it("a marked conversation leaves the backlog, and only ANALYSED ones are ever marked", () => {
    conversation(repo, "one");
    conversation(repo, "two");
    expect(alreadyRead(repo).size).toBe(0);

    // A capped run marks what it covered and defers the rest — which is what stops skipped
    // history being declared done and lost.
    const capped = facts(repo, regime, { home, limit: 1, mark: true });
    expect(capped.marked).toBe(1);
    expect(capped.selection.excluded).toHaveLength(1);
    expect(alreadyRead(repo).size).toBe(1);

    const next = facts(repo, regime, { home });
    expect(next.selection.counts.backlog).toBe(1);
    expect(next.selection.analyse.map((c) => c.id)).toEqual(capped.selection.excluded.map((e) => e.id));

    expect(markRead(repo, [])).toBe(0);
  });

  it("`--session` reads exactly what it was pointed at, whatever the backlog says", () => {
    conversation(repo, "one");
    conversation(repo, "two");
    markRead(repo, ["two"]);
    const read = facts(repo, regime, { home, session: "two" });
    expect(read.selection.analyse.map((c) => c.id)).toEqual(["two"]);
  });
});

describe("the reading, assembled", () => {
  it("keeps the numbers and the narrative apart, and says which conversations had a record", () => {
    conversation(repo, "one", {
      body: [
        line({
          type: "assistant",
          timestamp: "2026-09-04T10:01:00.000Z",
          message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: join(repo, "src/a.ts") } }] },
        }),
        line({ type: "user", timestamp: "2026-09-04T10:02:00.000Z", message: { content: "no, revert that" } }),
      ],
    });
    appendRows({ root: repo, session: "one", branch: "main" }, [
      { kind: "tool", tool: "Edit", path: "src/a.ts", edit: true },
      { kind: "guardrail", moment: "write", id: "rails.everyone", subject: "src/a.ts", out: "deny" },
    ]);

    const read = facts(repo, regime, { home });
    expect(read.health.blocked).toBe(null);
    expect(read.coverage).toEqual({ analysed: 1, withRecord: 1, narrativeOnly: 0 });
    // NUMBERS — from the rows, and from nowhere else.
    expect(read.metrics.headline.blocks).toBe(1);
    expect(read.metrics.guardrails.find((g) => g.id === "rails.everyone")?.hits).toBe(1);
    // NARRATIVE — from the conversation, heuristic, and every finding citing its line.
    expect(read.narrative.stats.edits).toBe(1);
    expect(read.narrative.corrections).toEqual([{ line: 4, text: "no, revert that", session: "one" }]);
    // The universe is the CONFIG's answer, handed in — this file never loads one.
    expect(read.moments.totals.guardrails).toBe(10);
    expect(read.terrain.some((node) => node.path === "src/a.ts")).toBe(true);
  });

  it("a conversation with no record of its own is narrative-only, and the health line says so", () => {
    conversation(repo, "one");
    const read = facts(repo, regime, { home });
    expect(read.health.blocked).toContain("NOT ARMED");
    expect(read.coverage).toEqual({ analysed: 1, withRecord: 0, narrativeOnly: 1 });
    expect(read.metrics.span.tools).toBe(0);
  });

  it("a regime that will not load reads as nothing bound, rather than as a crash", () => {
    conversation(repo, "one");
    const broken: LoadResult = { ok: false, refusals: [{ code: "unknown-key", entry: "rails.everyone", detail: "x" }] };
    const read = facts(repo, broken, { home });
    expect(read.moments.totals).toEqual({ guardrails: 0, breadcrumbs: 0, disabled: 0 });
    expect(read.metrics.guardrails).toEqual([]);
  });

  it("a repo with no store at all still answers — every read here is fail-safe", () => {
    const read = facts(repo, regime, { home });
    expect(read.store.exists).toBe(false);
    expect(read.selection.counts).toEqual({ backlog: 0, analysed: 0, excluded: 0 });
    expect(read.narrative.stats.edits).toBe(0);
    expect(read.marked).toBe(null);
  });
});
