// flow/adapter/codex/codex.test.ts — the Codex adapter's shell, against a real disk and a real hook run.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRows } from "../../engine/state.ts";
import { runHook } from "../hook.ts";
import { codex, projectRoot } from "./codex.ts";

describe("a hook run for the harness that sent the payload", () => {
  const config = `import { breadcrumb, command, defineConfig, definePack, guardrail, pack, session } from ${JSON.stringify(new URL("../../index.ts", import.meta.url).pathname)};
const demo = definePack("demo", {
  hello: breadcrumb().at(session).text("Hello."),
  noTodo: guardrail().at(command).check((ctx) => (ctx.command?.includes("TODO") ? ctx.fail("TODO") : ctx.ok())).message("No TODOs.").test({ pass: ["echo ok"], block: ["echo TODO"] }),
});
export default defineConfig([pack(demo)]);
`;

  it("names the harness in the session log's first row, and refuses a command in the dialect of its answers", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "flow-hook-")));
    try {
      writeFileSync(join(repo, "flow.config.ts"), config);
      const sent = { session_id: "s1", transcript_path: "/home/me/.codex/sessions/2026/11/18/rollout-x-s1.jsonl", cwd: repo, turn_id: "t1" };
      const started = await runHook(codex, "session-start", { ...sent, hook_event_name: "SessionStart", source: "startup" }, repo);
      expect(started.stdout).toContain("demo.hello");
      const refused = await runHook(codex, "pre-tool-use", { ...sent, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo TODO" } }, repo);
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain("No TODOs.");
      const [meta, ...rows] = readRows(repo, "s1");
      expect(meta).toMatchObject({ kind: "meta", v: 2, harness: "codex", session: "s1" });
      expect(rows.map((row) => row.kind)).toContain("guardrail");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("which repo", () => {
  it("is the one git finds from the folder the hook ran in, and that folder when git finds none", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "flow-root-")));
    try {
      spawnSync("git", ["init", "-q"], { cwd: repo });
      mkdirSync(join(repo, "src", "deep"), { recursive: true });
      expect(projectRoot(join(repo, "src", "deep"))).toBe(repo);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
    const loose = realpathSync(mkdtempSync(join(tmpdir(), "flow-loose-")));
    try {
      expect(projectRoot(loose), "outside any repository").toBe(loose);
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });
});
