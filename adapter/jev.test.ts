// The one call to Jev, against a local server that stands in for it: what `flow facts` sends for a
// prompt, and what it reports back from the reply.

import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { narrative } from "./domain.ts";
import { readKey, sortPrompts } from "./jev.ts";

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A stand-in for Jev that records each request and answers with `reply`. */
async function standIn(reply: unknown): Promise<{ url: string; seen: { auth: string | undefined; body: unknown }[] }> {
  const seen: { auth: string | undefined; body: unknown }[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
  const address = server.address();
  return { url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/v1/systemone`, seen };
}

describe("flow facts sorts a prompt with Jev", () => {
  it("sends the prompt and the end of the agent's message, and reports the kind, confidence and score that come back", async () => {
    const jev = await standIn({ answers: { kind: { choice: "correction", confidence: 0.92 }, frustrated: { noul: 0.7 } } });
    const read = narrative([{ line: 1, kind: "prompt", text: "no, revert that", before: "I changed the parser." }]);
    const sorted = await sortPrompts(read.prompts, "the-key", jev.url);
    expect(sorted).toEqual([{ kind: "correction", confidence: 0.92, frustrated: 0.7 }]);
    expect(jev.seen).toHaveLength(1);
    expect(jev.seen[0]?.auth).toBe("Bearer the-key");
    expect(jev.seen[0]?.body).toMatchObject({ state: { the_agent_said_before: "I changed the parser.", the_person_then_wrote: "no, revert that" } });
  });

  it("reports a prompt as not sorted when the reply is not what was asked for", async () => {
    const jev = await standIn({ answers: {} });
    const read = narrative([{ line: 1, kind: "prompt", text: "go" }]);
    expect(await sortPrompts(read.prompts, "k", jev.url)).toEqual([null]);
  });
});

describe("the key", () => {
  it("is read from the environment, then from a .env file git ignores, and from no .env git does not ignore", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-jev-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: dir });
      writeFileSync(join(dir, ".env"), "TYPESAFE_API_KEY=from-file\n");
      expect(readKey(dir, {})).toBeNull();
      writeFileSync(join(dir, ".gitignore"), ".env\n");
      expect(readKey(dir, {})).toBe("from-file");
      expect(readKey(dir, { TYPESAFE_API_KEY: "from-env" })).toBe("from-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
