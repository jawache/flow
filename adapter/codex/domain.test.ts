// flow/adapter/codex/domain.test.ts — the Codex dialect, proved as decisions.
//
// A payload is an object and a transcript is a string, so every claim here is a function of its
// arguments. The transcript is a recorded Codex 0.169.0 rollout (`__fixtures__/codex-rollout.jsonl`), with
// the paths and the long instructions cut. The live wiring is proved against the built binary.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { codex } from "./codex.ts";
import { shellChangesOf, withShellChanges } from "../domain.ts";
import type { Row } from "../../engine/domain.ts";
import { HOST_SURFACE, REPO_HOOKS, briefHead, claimsPayload, classifyStore, hookCommand, hooksFile, ownTranscriptPath, parseEvents, requestsOf, spawnMeta, tokensFromTranscript, transcriptHead, turnActions } from "./domain.ts";

const { registrations: HOOK_REGISTRATIONS, hooks: HOOK_COSTS } = hooksFile;

const ROLLOUT = readFileSync(new URL("../../__fixtures__/codex-rollout.jsonl", import.meta.url), "utf8");
const CODEX_PATH = "/home/me/.codex/sessions/2026/11/18/rollout-2026-11-18T16-21-44-01a1ef3f-e4f7-7a90-9581-681b208b533f.jsonl";

describe("which payloads are Codex's", () => {
  it("claims a payload that carries a turn id, or names a Codex rollout", () => {
    expect(claimsPayload({ session_id: "s", turn_id: "t1", tool_name: "Bash" })).toBe(true);
    expect(claimsPayload({ session_id: "s", transcript_path: CODEX_PATH, hook_event_name: "SessionStart" })).toBe(true);
  });

  it("leaves a payload that says nothing, or names Claude Code's transcript, to Claude Code", () => {
    expect(claimsPayload({ session_id: "s", tool_name: "Bash" })).toBe(false);
    expect(claimsPayload({ session_id: "s", transcript_path: "/home/me/.claude/projects/p/s.jsonl" })).toBe(false);
    expect(claimsPayload({ session_id: "s", transcript_path: null })).toBe(false);
  });

  it("reads the transcript a payload names, and a subagent's own at its hand-back", () => {
    expect(ownTranscriptPath({ transcript_path: CODEX_PATH })).toBe(CODEX_PATH);
    expect(ownTranscriptPath({ transcript_path: CODEX_PATH, agent_transcript_path: "/c/rollout-sub.jsonl" })).toBe("/c/rollout-sub.jsonl");
    expect(ownTranscriptPath({ transcript_path: null })).toBeNull();
    expect(ownTranscriptPath({})).toBeNull();
  });
});

describe("the hooks flow registers in .codex/hooks.json", () => {
  const events = ["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"];

  it("is six hooks, in the docs' order, each running its own event through the repo git finds", () => {
    expect(REPO_HOOKS).toBe(".codex/hooks.json");
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).toEqual(events);
    expect(HOOK_REGISTRATIONS.map((r) => r.matcher)).toEqual([undefined, undefined, "Bash", undefined, undefined, undefined]);
    expect(hookCommand("pre-tool-use")).toBe(
      'f="$(git rev-parse --show-toplevel)/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook pre-tool-use; exec flow hook pre-tool-use',
    );
    expect(HOOK_REGISTRATIONS.map((r) => r.command)).toEqual(
      ["session-start", "subagent-start", "pre-tool-use", "post-tool-use", "stop", "subagent-stop"].map((event) => hookCommand(event as never)),
    );
  });

  it("says what goes unjudged without each one, and guards the files that steer Codex", () => {
    expect(HOOK_COSTS.map((cost) => cost.event)).toEqual(events);
    for (const cost of HOOK_COSTS) expect(cost.unregistered, cost.event).not.toBe("");
    expect(HOST_SURFACE).toEqual([".codex/hooks.json", ".codex/config.toml", ".codex/agents/**"]);
  });
});

describe("a Codex rollout", () => {
  it("holds the context's size in the input tokens of the last token_count row", () => {
    // The recorded rollout's two token_count rows: 17,388 input tokens, then 17,554.
    expect(tokensFromTranscript(ROLLOUT)).toBe(17_554);
  });

  it("holds 0 when no row says, and skips a row that has no usage", () => {
    expect(tokensFromTranscript("")).toBe(0);
    const empty = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } });
    expect(tokensFromTranscript(`${empty}\nnot json`)).toBe(0);
    expect(tokensFromTranscript(`${ROLLOUT}${empty}\n`), "the last row with usage counts").toBe(17_554);
  });

  it("names the shell commands of the turn, and the brief it started with", () => {
    expect(turnActions(ROLLOUT)).toEqual([{ did: "run", command: "pwd" }]);
    expect(briefHead(ROLLOUT)).toBe("Run the shell command: pwd. Then reply with the word done.");
    expect(briefHead(ROLLOUT, 5)).toBe("Run t");
    expect(turnActions("")).toEqual([]);
  });

  it("names the file a real Codex run's shell command changed as an edit just before the command, matching what the hook recorded", () => {
    // One recorded run (codex 0.169.0): Codex wrote src/b.ts through the shell. Its rollout names the
    // command one way and flow's log, written by the hook, names it another; the two must still meet.
    const read = (name: string) => readFileSync(new URL(`../../__fixtures__/${name}`, import.meta.url), "utf8");
    const rows = read("codex-turn.flowlog.jsonl").trim().split("\n").map((line) => JSON.parse(line) as Row);
    const actions = turnActions(read("codex-turn.session.jsonl"));
    expect(withShellChanges(actions, shellChangesOf(rows, "main")).map((action) => (action.did === "edit" ? `edit ${action.path}` : "run"))).toEqual([
      "edit out/7b-codex-breadcrumb.txt",
      "edit src/b.ts",
      "run",
    ]);
  });

  it("reads the prompt, the command and what it printed, joined by the id the hook payloads carry", () => {
    const events = parseEvents(ROLLOUT, "/repo");
    expect(events.map((event) => event.kind)).toEqual(["prompt", "use", "result"]);
    expect(events[0]).toMatchObject({ kind: "prompt", text: "Run the shell command: pwd. Then reply with the word done." });
    expect(events[1]).toMatchObject({ kind: "use", id: "exec-69835531-9a4a-4b72-a8c8-4fbd98d5c358", name: "Bash", action: "shell", input: { command: "pwd" } });
    expect(events[2]).toMatchObject({ kind: "result", id: "exec-69835531-9a4a-4b72-a8c8-4fbd98d5c358", content: "/repo/src/deep\n", failed: false });
  });

  it("gives a prompt the agent's last message before it", () => {
    const item = (type: string, content: unknown): string =>
      JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { type, content } } });
    const events = parseEvents(
      [item("UserMessage", [{ type: "text", text: "first" }]), item("AgentMessage", [{ type: "Text", text: "Shall I merge?" }]), item("UserMessage", [{ type: "text", text: "go" }])].join("\n"),
      "/repo",
    );
    expect(events).toEqual([
      { line: 1, kind: "prompt", text: "first" },
      { line: 3, kind: "prompt", text: "go", before: "Shall I merge?" },
    ]);
  });

  it("names where it started, when, and on which branch", () => {
    expect(transcriptHead(ROLLOUT)).toEqual({ cwd: "/repo/src/deep", branch: null, started: "2026-11-18T15:21:44.452Z" });
    const withGit = JSON.stringify({ type: "session_meta", payload: { cwd: "/repo", timestamp: "t", git: { commit_hash: "abc", branch: "main" } } });
    expect(transcriptHead(withGit)).toEqual({ cwd: "/repo", branch: "main", started: "t" });
    expect(transcriptHead("")).toEqual({ cwd: null, branch: null, started: null });
  });

  // The first records of a leader's and a subagent's rollout, as Codex 0.169.0 wrote them, cut to the fields that name them.
  const LEADER = "01a1ef4c-43e9-7973-9f4a-a2e877a30827";
  const SUB = "01a1ef4c-5618-7aa2-a5cb-1e59527b085e";
  const leaderFirst = JSON.stringify({ type: "session_meta", payload: { session_id: LEADER, id: LEADER, thread_source: "user", cwd: "/repo" } });
  const subFirst = JSON.stringify({ type: "session_meta", payload: { session_id: LEADER, id: SUB, parent_thread_id: LEADER, thread_source: "subagent", cwd: "/repo" } });

  it("sorts a sessions folder into rollouts and the rest, and a subagent's rollout joins its parent's session", () => {
    const listed = classifyStore([
      { path: `2026/11/18/rollout-2026-11-18T16-35-15-${LEADER}.jsonl`, first: leaderFirst },
      { path: `2026/11/18/rollout-2026-11-18T16-35-19-${SUB}.jsonl`, first: subFirst },
      { path: "2026/11/18/notes.txt", first: "" },
    ]);
    expect(listed.transcripts).toEqual([
      { path: `2026/11/18/rollout-2026-11-18T16-35-15-${LEADER}.jsonl`, meta: null, session: LEADER, agent: null },
      { path: `2026/11/18/rollout-2026-11-18T16-35-19-${SUB}.jsonl`, meta: null, session: LEADER, agent: SUB },
    ]);
    expect(listed.ignored).toEqual(["2026/11/18/notes.txt"]);
    expect(spawnMeta()).toBeNull();
  });

  it("takes a rollout whose first record cannot be read for a session of its own", () => {
    expect(classifyStore([{ path: `a/rollout-x-${LEADER}.jsonl`, first: "" }]).transcripts[0]).toMatchObject({ session: LEADER, agent: null });
  });
});

describe("codex — the harness flow is handed", () => {
  it("is named by its id, calls the six hooks, delivers a command guardrail and a session breadcrumb, and tells a person the two trust gates", () => {
    expect(codex.id).toBe("codex");
    expect(codex.detect).toEqual({ folder: ".codex", program: "codex" });
    expect(codex.events).toEqual(["session-start", "subagent-start", "pre-tool-use", "post-tool-use", "stop", "subagent-stop"]);
    expect(codex.delivers.guard).toContain("command");
    expect(codex.delivers.brief).toContain("session");
    expect(codex.trustNote).toContain("/hooks");
    expect(codex.noHookNote).toBe("Codex runs a project's hooks only in a trusted folder, and each hook only once approved in /hooks");
  });
});

describe("requestsOf — a rollout's model requests", () => {
  const row = (type: string, payload: Record<string, unknown>): string => JSON.stringify({ timestamp: "2026-11-18T10:00:00.000Z", type, payload });
  const count = (input: number, total: number): string => row("event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input } } });

  it("gives a request, its context and its model for each token count that moved, and skips a repeated one", () => {
    const jsonl = [row("turn_context", { model: "gpt-5" }), count(100, 120), count(100, 120), count(450, 700)].join("\n");
    expect(requestsOf(jsonl)).toEqual([
      { line: 2, model: "gpt-5", context: 100 },
      { line: 4, model: "gpt-5", context: 450 },
    ]);
  });

  it("skips a token count with no usage", () => {
    expect(requestsOf(row("event_msg", { type: "token_count", info: null }))).toEqual([]);
  });
});
