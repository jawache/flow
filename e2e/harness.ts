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
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** The package root, from this file rather than from the runner's cwd. */
export const PACKAGE = fileURLToPath(new URL("../", import.meta.url));

/** This run's throwaway package root, once something has asked for it. */
let bundleRoot: string | null = null;

/**
 * WHERE THIS RUN'S BUNDLES LIVE — a throwaway package root under the OS temp directory, and never
 * `dist/`.
 *
 * `dist/` is not a build artefact in this checkout, it is THE LIVE GUARD: this repo's git hook and
 * commit gate execute `dist/flow.mjs`, and its own `flow.config.ts` resolves `@jawache/flow` to
 * `dist/index.mjs`. All three suites build the package on the way in, so building into `dist/` also
 * rebuilt the guard the developer running the suite is standing on — and a run stopped between a
 * fixture mutation and its restore left that guard disagreeing with its source. It wedged the guard
 * once and produced a false test count once, which is exactly one more time than a test may edit
 * the thing that judges the repo.
 *
 * A PACKAGE root rather than a bare folder of bundles, because two things walk it. `flow init`
 * finds its own package by climbing to a `package.json` named `@jawache/flow` and links the guarded
 * repo at whatever it finds, so the copy is what makes the link resolve; and the `exports` map in
 * that same file is what turns `@jawache/flow` and `@jawache/flow/packs` into the two library
 * bundles. `node_modules` is a symlink to the real one — the bundles keep one external, and the
 * checks that shell out want the same tools the checkout has.
 */
function packageUnderTest(): string {
  if (bundleRoot !== null) return bundleRoot;
  const root = mkdtempSync(join(tmpdir(), "flow-dist-"));
  copyFileSync(join(PACKAGE, "package.json"), join(root, "package.json"));
  symlinkSync(join(PACKAGE, "node_modules"), join(root, "node_modules"), "dir");
  bundleRoot = root;
  return root;
}

/**
 * The package this run built, as `flow init` will report it — the stand-in for the checkout.
 *
 * Exported for ONE reader: the README transcript in product.test.ts quotes the link line `flow init`
 * prints, and the path in it is now this directory rather than the checkout.
 */
export const builtPackage = (): string => packageUnderTest();

/** The built binary — the thing under test, always. A suite that drove the source would prove the
 * one thing a shipped package cannot rely on. */
export const binary = (): string => join(packageUnderTest(), "dist", "flow.mjs");

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
  /**
   * `HOME`: the user's home, where the host keeps its transcript store (`~/.claude/projects/…`).
   * A run that reads conversations reads this one's, never the machine's.
   */
  readonly user?: string | undefined;
}

function env(repo: string, rig: Rig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: repo,
    ...(rig.home === undefined ? {} : { CLAUDE_CONFIG_DIR: rig.home }),
    ...(rig.bin === undefined ? {} : { PATH: `${rig.bin}:${process.env["PATH"] ?? ""}` }),
    ...(rig.user === undefined ? {} : { HOME: rig.user }),
  };
}

/** The built binary, run in a repo, with whatever of the world the caller has set up. */
export function flow(repo: string, args: readonly string[], rig: Rig = {}, stdin = ""): Ran {
  const result = spawnSync("node", [binary(), ...args], {
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
  writeFileSync(join(bin, "flow"), `#!/bin/sh\nexec node ${JSON.stringify(binary())} "$@"\n`, { mode: 0o755 });
  return bin;
}

/**
 * The bundles, built — into this run's throwaway package root, never into `dist/`. See above.
 *
 * The BUILT ones, deliberately, in every suite that uses this: the library bundle is what a
 * scaffolded config resolves to and the packs bundle is what `@jawache/flow/packs` resolves to, so
 * a package that only works from source is exactly the failure this build step exists to catch.
 */
export function buildBundles(): Ran {
  const args = [join(PACKAGE, "esbuild.mjs"), "--outdir", join(packageUnderTest(), "dist")];
  const result = spawnSync("node", args, { encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? -1 };
}

/** The throwaway package root, gone. Every suite that built one calls this in its `afterAll`. */
export function cleanBundles(): void {
  if (bundleRoot === null) return;
  // The `node_modules` inside is a SYMLINK, and a recursive remove unlinks it rather than walking
  // into it — the same reason a suite can delete a temp repo still holding the link `flow init`
  // made into this package.
  rmSync(bundleRoot, { recursive: true, force: true });
  bundleRoot = null;
}

/**
 * Add a binding to a config that already has one — the `export default defineConfig([…])` rewrite,
 * in one place.
 *
 * THREE CALLERS wanted the same edit and each had written it out: two of the four `BREAKS` below,
 * and the package.json-shape table in product.test.ts. The regex is the fiddly part (the list runs
 * over several lines in the scaffold and one line in a hand-written config, and the scaffold's
 * last entry carries a trailing comma), so three copies of it is three chances to match nothing
 * and silently return the config unchanged — which is a test that passes because it tested the
 * wrong file.
 *
 * It THROWS rather than returning the input when the shape is not there, for exactly that reason.
 *
 * `above` goes at the top of the file (an import the new binding needs) and `before` immediately
 * ahead of the export (a pack declared inline). Both are optional; `bind` is the binding itself.
 */
export function bindInConfig(
  config: string,
  added: { readonly above?: string; readonly before?: string; readonly bind: string },
): string {
  const source = added.above ? `${added.above}\n${config}` : config;
  const out = source.replace(/export default defineConfig\(\[(.*)\]\);/s, (_m, bound: string) => {
    const kept = bound.trimEnd().replace(/,$/, "");
    return `${added.before ? `${added.before}\n` : ""}export default defineConfig([${kept}, ${added.bind}]);`;
  });
  if (out === source) throw new Error(`bindInConfig: no \`export default defineConfig([…]);\` to add \`${added.bind}\` to`);
  return out;
}

/**
 * THE FOUR WAYS A CONFIG STOPS LOADING — a breaker per way, given the config's own text.
 *
 * It lives here rather than in either suite because both need it and they need it to be the SAME
 * four. `live.test.ts` drives them through the hook rail (does the repair get through, does
 * everything else refuse, does the turn end); `product.test.ts` drives them through the verbs
 * (does every one of them answer 2). A second copy in either file is a copy that would stop
 * agreeing about what "broken" means, and the whole F3 finding was that the two ways of breaking
 * had drifted into two behaviours while everyone believed they were one.
 *
 * THE FIRST will not import. THE OTHER THREE import perfectly and the grammar refuses them — and
 * the second of those, a deleted `.message(…)`, is the break the README and the guidebook both
 * tell a reader to make, which is why it is the one that mattered.
 *
 * Each breaker is a text edit, so it works on any config carrying the shape it names: the deleted
 * `.message` needs one, and the last two rewrite the `defineConfig([…])` line the caller passes in.
 */
export const BREAKS: Readonly<Record<string, (good: string) => string>> = {
  "will not import at all": (good) => `${good}\nthis is not typescript at all(((\n`,
  "a deleted .message(…)": (good) => good.replace(/\n\s*\.message\([^\n]*\n/, "\n"),
  "an override naming an entry the pack does not have": (good) =>
    bindInConfig(good.replace(/^import \{/m, "import { override,"), {
      bind: `override((demo as unknown as Record<string, never>)["notAnEntry"]).disabled("x")`,
    }),
  "a mandatory parameter nobody supplied": (good) =>
    bindInConfig(good, {
      before: [
        `const needs = definePack("needs", (repo: { run: string }) => ({`,
        `  gate: guardrail().at(commit).check(() => ({ ok: true })).message(repo.run).test({ pass: [], block: [{ staged: ["a.txt"] }] }),`,
        `}));`,
      ].join("\n"),
      bind: "pack(needs)",
    }),
};
