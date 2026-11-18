// flow/adapter/claude/claude.ts — the Claude Code adapter's SHELL: the live side of Claude Code, wired.
//
// Everything it acts on was decided somewhere else. The dialect is next door in domain.ts (a
// transcript's meaning, what a settings file holds); the judgement is the engine's, and the hook run
// every harness shares is ../hook.ts. This file says where Claude Code's repo is and where its
// settings are, and it makes no decisions a reader has to reason about.
//
// It is the one file that hands the rest of flow a `Harness` (../harness.ts), as `claudeCode`: flow.ts
// chooses it, and nothing else outside this folder imports it.

import { join } from "node:path";
import { DELIVERS, HOOK_EVENTS } from "../domain.ts";
import type { Harness, HookPayload } from "../harness.ts";
import { HOST_SURFACE, REPO_SETTINGS, agentSettingOf, briefHead, hooksFile, ownTranscriptPath, parseEvents, spawnMeta, spawnsIn, steerOf, tokensFromTranscript, transcriptHead, turnActions } from "./domain.ts";
import { configRoot, readStore, readTranscript } from "./store.ts";

/**
 * The repo the session is standing in — the FOURTH question of §7.
 *
 * The hook's own cwd is not guaranteed to be the project: the host sets `CLAUDE_PROJECT_DIR` for
 * exactly this, and cwd is the fallback that keeps the git gate (spawned inside the repo) working.
 */
export function projectRoot(cwd: string): string {
  return process.env["CLAUDE_PROJECT_DIR"] || cwd;
}

/** Claude Code claims no payload: it is the first harness, which the run falls back to for a payload no other harness claims. */
function claims(_payload: HookPayload): boolean {
  return false;
}

/**
 * The host's machine-wide settings file. `CLAUDE_CONFIG_DIR` is the host's own documented override,
 * honoured here rather than hard-coding a home, because it is also the seam that lets `flow init` be
 * driven over a throwaway directory instead of somebody's real setup.
 */
function machineSettingsPath(): string {
  return join(configRoot(), "settings.json");
}

/** Claude Code. The one value flow.ts chooses, and what the rest of flow is handed in its place. */
export const claudeCode: Harness = {
  id: "claude-code",
  name: "Claude Code",
  detect: { folder: ".claude", program: "claude" },
  trustNote: null,
  noHookNote: null,
  events: HOOK_EVENTS,
  delivers: DELIVERS,
  claims,
  projectRoot,
  machineSettingsPath,
  registering: { repoFile: REPO_SETTINGS, hostSurface: HOST_SURFACE, ...hooksFile },
  transcripts: {
    own: ownTranscriptPath,
    tokens: tokensFromTranscript,
    turn: turnActions,
    brief: briefHead,
    sessionAgent: agentSettingOf,
    readStore,
    readTranscript,
    events: parseEvents,
    head: transcriptHead,
    spawns: spawnsIn,
    spawnMeta,
    steer: steerOf,
  },
};
