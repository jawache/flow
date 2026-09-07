// flow/e2e/harness.ts — the road three suites drive: a throwaway git repo, the BUILT binary, and
// the two edges a harness really talks to.
//
// It is not product and ships with nothing (tsconfig.build.json excludes this whole folder, beside
// the fixtures). Its three callers need the SAME one: `product.test.ts` drives `flow init` and
// `flow status`, `live.test.ts` drives the live rails, and `machine.test.ts` drives every shipped
// pack at once — and all three had grown their own copy of this: a `Ran` triple, a spawn wrapper
// with the host-settings override and a shim on PATH, a `git init` with an identity, an esbuild
// pre-build. Three copies of one road is three ways for it to drift, and it had already started —
// `CLAUDE_PROJECT_DIR` was set in two of them and not the third.
//
// THE FOLDER IS THE POINT, and it is why this is not at the package root any more. These three are
// the only suites that spawn a binary, write a temp repo and take tens of seconds; every other test
// file in the package is a fast unit suite beside the code it is about. Two of the three were also
// filed by what they happened to drive rather than by what they ARE — `live.test.ts` under
// `adapter/`, `machine.test.ts` under `packs/` — which made a folder of pure decision logic look as
// though it held an end-to-end suite, and put a test that imports the BUILT PACKAGE inside a layer
// whose fence exists to stop exactly that reach. One folder, one shape: the road, and the three
// things that drive it.
//
// WHAT IT DELIBERATELY DOES NOT DO: assert. Nothing here imports vitest, and every function
// returns what happened rather than judging it, so a suite's expectations stay in the suite where
// a reader looks for them. The one thing that could be mistaken for a judgement — `buildBundles`
// returning a non-zero code — is handed back as a value too.
//
// THE THREE ENVIRONMENT SEAMS, all of them the product's own rather than the suite's:
//   CLAUDE_CONFIG_DIR   where the host keeps settings.json. Pointing it at a temp directory is
//                       what lets `flow init`'s registration half run for real.
//   CLAUDE_PROJECT_DIR  which repo a hook payload is about. Always set here, to the repo being
//                       driven, because that is what a harness does and a rail that had to guess
//                       would be guessing in the suite too.
//   PATH                a directory holding one `flow` shim, so GIT's own pre-commit hook — which
//                       flow neither spawns nor configures — can find the binary under test.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** The package root, from this file rather than from the runner's cwd. */
export const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
/** The built binary — the thing under test, always. A suite that drove the source would prove the
 * one thing a shipped package cannot rely on. */
export const BINARY = join(PACKAGE, "dist", "flow.mjs");

/** What a run answers with: the three edges a hook, a gate or a person actually reads. */
export interface Ran {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Where a run's world is — every field optional, because each suite needs a different half. */
export interface Rig {
  /** `CLAUDE_CONFIG_DIR`: the host settings file this run reads and writes. */
  readonly home?: string | undefined;
  /** A directory holding the `flow` shim, prepended to PATH for git's own hook. */
  readonly bin?: string | undefined;
}

function env(repo: string, rig: Rig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: repo,
    ...(rig.home === undefined ? {} : { CLAUDE_CONFIG_DIR: rig.home }),
    ...(rig.bin === undefined ? {} : { PATH: `${rig.bin}:${process.env["PATH"] ?? ""}` }),
  };
}

/** The built binary, run in a repo, with whatever of the world the caller has set up. */
export function flow(repo: string, args: readonly string[], rig: Rig = {}, stdin = ""): Ran {
  const result = spawnSync("node", [BINARY, ...args], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: env(repo, rig),
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

/** git itself, in the same world — so a commit meets the same hook a person's would. */
export function git(repo: string, args: readonly string[], rig: Rig = {}): Ran {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: env(repo, rig) });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

/** One payload, on the rail the host would send it on. */
export const hook = (repo: string, event: string, payload: unknown, rig: Rig = {}): Ran =>
  flow(repo, ["hook", event], rig, JSON.stringify(payload));

/** A PreToolUse payload, as the host writes it. The session id is the caller's — rows are keyed by it. */
export const pre = (tool: string, input: Record<string, unknown>, session = "t-1"): Record<string, unknown> => ({
  session_id: session,
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: input,
});

/**
 * A fixture pack's SOURCE, with its import repointed at whatever the driven repo can resolve.
 *
 * The file under `__fixtures__/` imports `../index.ts`, which is what makes it typecheck in place
 * beside the other fixtures; a temp repo cannot resolve that path, and the two suites cannot
 * resolve the same thing as each other — one has `flow init`'s link and the bare specifier, the
 * other has neither and needs an absolute path. One line differs, so one line is rewritten, rather
 * than the pack being kept twice as a string.
 */
export function fixturePack(name: string, specifier: string): string {
  const text = readFileSync(join(PACKAGE, "__fixtures__", `${name}.ts`), "utf8");
  return text.replaceAll('"../index.ts"', JSON.stringify(specifier));
}

/** A fresh git repo with nothing in it — the stranger's repo of UAT step 1. */
export function newRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  return repo;
}

/** A temp directory standing in for `~/.claude` — see CLAUDE_CONFIG_DIR above. */
export const settingsHome = (prefix = "flow-home-"): string => mkdtempSync(join(tmpdir(), prefix));

/**
 * A temp directory holding one `flow` shim, for PATH.
 *
 * Git's pre-commit hook runs `flow commit …` by NAME — that is what a real repo's hook says, and
 * flow does not get to choose what is on PATH when git spawns it. Without this the gate would
 * either find whatever `flow` the machine has installed or nothing at all, and the suite would be
 * testing somebody else's binary.
 */
export function shimBin(prefix = "flow-bin-"): string {
  const bin = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(bin, "flow"), `#!/bin/sh\nexec node ${JSON.stringify(BINARY)} "$@"\n`, { mode: 0o755 });
  return bin;
}

/**
 * The bundles, built.
 *
 * The BUILT ones, deliberately, in every suite that uses this: the library bundle is what a
 * scaffolded config resolves to and the packs bundle is what `@jawache/flow/packs` resolves to, so
 * a package that only works from source is exactly the failure this build step exists to catch.
 */
export function buildBundles(): Ran {
  const result = spawnSync("node", [join(PACKAGE, "esbuild.mjs")], { encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}
