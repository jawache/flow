// flow/adapter/codex/domain.test.ts — the Codex dialect, proved as decisions.
//
// A payload is an object and a transcript is a string, so every claim here is a function of its
// arguments. The transcript is a recorded Codex 0.169.0 rollout (`__fixtures__/codex-rollout.jsonl`), with
// the paths and the long instructions cut. The live wiring is proved against the built binary.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { codex } from "./codex.ts";
import { HOOK_COSTS, HOOK_REGISTRATIONS, HOST_SURFACE, REPO_HOOKS, bareRegistrations, briefHead, claimsPayload, classifyStore, hookCommand, ownTranscriptPath, parseEvents, registeredEvents, spawnMeta, staleRegistrations, tokensFromTranscript, transcriptHead, turnActions, withRegistrations, withoutRegistrations } from "./domain.ts";

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

  it("writes them into a file, keeps every other key, and a second run has nothing to say", () => {
    const first = withRegistrations({ other: { kept: true }, hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "mine" }] }] } });
    expect(first.changed).toEqual(events);
    const written = first.settings as { other: unknown; hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> };
    expect(written.other).toEqual({ kept: true });
    expect(written.hooks["PreToolUse"]?.map((entry) => entry.matcher), "somebody else's registration keeps its place").toEqual(["Write", "Bash"]);
    expect(written.hooks["SessionStart"]).toEqual([{ hooks: [{ type: "command", command: hookCommand("session-start") }] }]);
    expect(registeredEvents(first.settings).sort()).toEqual([...events].sort());
    expect(withRegistrations(first.settings).changed).toEqual([]);
    expect(staleRegistrations(first.settings)).toEqual([]);
    expect(bareRegistrations(first.settings)).toEqual([]);
  });

  it("takes them out again and leaves the rest", () => {
    const written = withRegistrations({ other: 1, hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "mine" }] }] } }).settings;
    const out = withoutRegistrations(written);
    expect(out.removed).toEqual(events);
    expect(out.settings).toEqual({ other: 1, hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "mine" }] }] } });
    expect(withoutRegistrations({}).removed).toEqual([]);
  });

  it("rewrites a PreToolUse that an older flow registered on every tool", () => {
    const old = { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand("pre-tool-use") }] }] } };
    expect(staleRegistrations(old)).toEqual(["PreToolUse"]);
    const fixed = withRegistrations(old).settings as typeof old;
    expect(fixed.hooks.PreToolUse[0]).toMatchObject({ matcher: "Bash" });
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

  it("reads the prompt, the command and what it printed, joined by the id the hook payloads carry", () => {
    const events = parseEvents(ROLLOUT, "/repo");
    expect(events.map((event) => event.kind)).toEqual(["prompt", "use", "result"]);
    expect(events[0]).toMatchObject({ kind: "prompt", text: "Run the shell command: pwd. Then reply with the word done." });
    expect(events[1]).toMatchObject({ kind: "use", id: "exec-69835531-9a4a-4b72-a8c8-4fbd98d5c358", name: "Bash", action: "shell", input: { command: "pwd" } });
    expect(events[2]).toMatchObject({ kind: "result", id: "exec-69835531-9a4a-4b72-a8c8-4fbd98d5c358", content: "/repo/src/deep\n", failed: false });
  });

  it("names where it started and when, and no branch", () => {
    expect(transcriptHead(ROLLOUT)).toEqual({ cwd: "/repo/src/deep", branch: null, started: "2026-11-18T15:21:44.452Z" });
    expect(transcriptHead("")).toEqual({ cwd: null, branch: null, started: null });
  });

  it("sorts a sessions folder into rollouts and the rest, by the session id in the name", () => {
    const listed = classifyStore(["2026/11/18/rollout-2026-11-18T16-21-44-01a1ef3f-e4f7-7a90-9581-681b208b533f.jsonl", "2026/11/18/notes.txt"]);
    expect(listed.transcripts).toEqual([{ path: "2026/11/18/rollout-2026-11-18T16-21-44-01a1ef3f-e4f7-7a90-9581-681b208b533f.jsonl", meta: null, session: "01a1ef3f-e4f7-7a90-9581-681b208b533f", agent: null }]);
    expect(listed.ignored).toEqual(["2026/11/18/notes.txt"]);
    expect(spawnMeta()).toBeNull();
  });
});

describe("codex — the harness flow is handed", () => {
  it("is named by its id, delivers what Claude Code does, and tells a person the two trust gates", () => {
    expect(codex.id).toBe("codex");
    expect(codex.detect).toEqual({ folder: ".codex", program: "codex" });
    expect(codex.events).toEqual(["session-start", "subagent-start", "pre-tool-use", "post-tool-use", "stop", "subagent-stop"]);
    expect(codex.trustNote).toContain("/hooks");
    expect(codex.noHookNote).toBe("Codex runs a project's hooks only in a trusted folder, and each hook only once approved in /hooks");
  });
});
