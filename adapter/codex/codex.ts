// flow/adapter/codex/codex.ts — the Codex adapter's SHELL: the live side of Codex, wired.
//
// Everything it acts on was decided somewhere else. The dialect is next door in domain.ts; the hook run
// every harness shares is ../hook.ts. This file says where Codex's repo is and where its hooks and
// transcripts are, and it makes no decisions a reader has to reason about.
//
// It is the one file that hands the rest of flow a `Harness` (../harness.ts), as `codex`: flow.ts chooses
// it, and nothing else outside this folder imports it.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DELIVERS, HOOK_EVENTS, hermeticEnv } from "../domain.ts";
import type { Harness } from "../harness.ts";
import { HOOK_COSTS, HOOK_REGISTRATIONS, HOST_SURFACE, REPO_HOOKS, bareRegistrations, briefHead, claimsPayload, ownTranscriptPath, parseEvents, registeredEvents, spawnMeta, staleRegistrations, tokensFromTranscript, transcriptHead, turnActions, withRegistrations, withoutRegistrations } from "./domain.ts";
import { codexHome, readStore, readTranscript } from "./store.ts";

/**
 * The repo a hook stands in: git's top folder for the folder Codex ran the hook in, which may be inside the
 * repo. The folder itself when git cannot say, which keeps a hook run outside any repository answering from
 * where it stands.
 */
export function projectRoot(cwd: string): string {
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, env: hermeticEnv(process.env), encoding: "utf8" });
  const top = asked.status === 0 ? asked.stdout.trim() : "";
  return top === "" ? cwd : top;
}

/** The machine-wide hooks file. flow 0.3 wrote nothing for Codex there, so a run of `flow uninstall --machine` finds nothing of flow's in it. */
function machineSettingsPath(): string {
  return join(codexHome(), "hooks.json");
}

/** Codex. A value flow.ts chooses, and what the rest of flow is handed in its place. */
export const codex: Harness = {
  id: "codex",
  name: "Codex",
  detect: { folder: ".codex", program: "codex" },
  trustNote: "runs a project's hooks only in a folder it trusts, and only once each hook is approved. Trust this folder in Codex, then approve flow's hooks with /hooks. A hook that `flow init` rewrites must be approved again (docs/user/reference/codex.md#the-two-trust-gates).",
  noHookNote: "Codex runs a project's hooks only in a trusted folder, and each hook only once approved in /hooks",
  events: HOOK_EVENTS.filter((event) => event !== "notification"),
  delivers: DELIVERS,
  claims: claimsPayload,
  projectRoot,
  machineSettingsPath,
  registering: {
    repoFile: REPO_HOOKS,
    hostSurface: HOST_SURFACE,
    hooks: HOOK_COSTS,
    registrations: HOOK_REGISTRATIONS,
    registeredEvents,
    staleRegistrations,
    bareRegistrations,
    withRegistrations,
    withoutRegistrations,
  },
  transcripts: {
    own: ownTranscriptPath,
    tokens: tokensFromTranscript,
    turn: turnActions,
    brief: briefHead,
    // Codex has no `--agent`: the main session has no type.
    sessionAgent: () => null,
    readStore,
    readTranscript,
    events: parseEvents,
    head: transcriptHead,
    spawns: () => new Map(),
    spawnMeta,
    steer: () => null,
  },
};
