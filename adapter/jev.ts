// flow/adapter/jev.ts — the one call out of `flow facts`: each prompt goes to Jev, TypeSafe's decision model.
//
// What is asked and how a reply is read are domain.ts's (`jevRequest`, `readJevReply`, `keyInDotenv`);
// this file holds the key's places and the request itself. Nothing but a prompt and the end of the
// agent's message before it, less its code blocks, is sent.

import { realpathSync } from "node:fs";
import { dirname } from "node:path";

import { JEV_KEY, jevRequest, keyInDotenv, readJevReply, type PromptTurn, type Sorted } from "./domain.ts";
import { packageRoot } from "./product.ts";
import { readText, runCommand } from "./shell.ts";

/** Jev's address. */
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

/** How many prompts are in flight at once, and how often a busy or failing server is asked again. */
const IN_FLIGHT = 8;
const TRIES = 4;

/** The key in `dir`'s `.env`, read only when git ignores that file, so a key can never be the one a commit would carry. */
function keyIn(dir: string): string | null {
  const ignored = runCommand("git check-ignore -q .env", dir).code === 0;
  return ignored ? keyInDotenv(readText(dir, ".env") ?? "") : null;
}

/**
 * The main checkout of the flow that runs, only when flow's own package root is the top of a git
 * checkout. An installed flow sits inside a project's repo, and that project's checkout is not named.
 */
function fromFlowCheckout(flowRoot: string | null): string | null {
  if (flowRoot === null) return null;
  const top = runCommand("git rev-parse --show-toplevel", flowRoot);
  if (top.code !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(flowRoot)) return null;
  const common = runCommand("git rev-parse --path-format=absolute --git-common-dir", flowRoot);
  const main = common.code === 0 && common.stdout.trim() !== "" ? dirname(common.stdout.trim()) : null;
  return main === null ? null : keyIn(main);
}

/**
 * The key, from the environment, then from the `.env` file in the repo's root, then from the `.env`
 * in the main checkout of the flow that runs. Each file is read only when git ignores it.
 */
export function readKey(root: string, env: NodeJS.ProcessEnv = process.env, flowRoot: string | null = packageRoot()): string | null {
  const fromEnv = env[JEV_KEY];
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim();
  return keyIn(root) ?? fromFlowCheckout(flowRoot);
}

/** One prompt, sorted: null when Jev could not be reached or its reply was not what was asked for. */
async function sortOne(turn: PromptTurn, key: string, url: string): Promise<Sorted | null> {
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const reply = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(jevRequest(turn.asked ?? "", turn.before ?? "")),
      });
      if (reply.status === 429 || reply.status >= 500) {
        if (attempt < TRIES) await new Promise((done) => setTimeout(done, 1500 * attempt));
        continue;
      }
      return reply.ok ? readJevReply(await reply.json()) : null;
    } catch {
      if (attempt === TRIES) return null;
    }
  }
  return null;
}

/** Every prompt sent to Jev, a few at a time, answered in the order they were given. */
export async function sortPrompts(turns: readonly PromptTurn[], key: string, url: string = JEV_URL): Promise<(Sorted | null)[]> {
  const out: (Sorted | null)[] = new Array<Sorted | null>(turns.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(IN_FLIGHT, turns.length) }, async () => {
      while (next < turns.length) {
        const at = next++;
        out[at] = await sortOne(turns[at] as PromptTurn, key, url);
      }
    }),
  );
  return out;
}
