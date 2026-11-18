// flow/tools/release.ts — the shell behind `just release` and `just release-check`.
//
// A release is a tag that holds flow's built files. Two commits make it: the release commit on the
// branch (the version and the changelog, made by commit-and-tag-version with its own tag turned
// off), and a second commit above it that holds dist/. The tag points at the second, and the branch
// stays at the first, so the branch never holds built files and the tag always does. A project
// installs the tag with `npm i -D github:jawache/flow#v<version>`, and npm builds nothing, because
// the tagged package.json has no script it would run.
//
//   node tools/release.ts cut     the release commit, the release build, the commit that holds dist/, the tag
//   node tools/release.ts check   the same, in a throwaway clone, then the tag installed with scripts off and run
//
// The second commit is written with git's plumbing (a scratch index, write-tree, commit-tree): it
// moves no branch and needs no checkout, and its parent is the release commit the gate already judged.
// Nothing here pushes, and nothing publishes.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installScripts } from "./domain.ts";

const PACKAGE = resolve(import.meta.dirname, "..");

/** What a tag ships of dist/: the same list `files` in package.json allows. */
const BUILT = ["dist/flow.mjs", "dist/index.mjs", "dist/packs.mjs", "dist/types"] as const;

/** Run a program in `cwd`, showing its output, and stop the release when it fails. */
function run(program: string, args: readonly string[], cwd: string, extra: SpawnSyncOptions = {}): void {
  const ran = spawnSync(program, args, { cwd, stdio: "inherit", ...extra });
  if (ran.status !== 0) throw new Error(`${program} ${args.join(" ")} failed (exit ${String(ran.status)}) in ${cwd}`);
}

/** Run a program in `cwd` and return what it printed, trimmed. */
function out(program: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const ran = spawnSync(program, args, { cwd, encoding: "utf8", env });
  if (ran.status !== 0) throw new Error(`${program} ${args.join(" ")} failed (exit ${String(ran.status)}): ${ran.stderr}`);
  return ran.stdout.trim();
}

/** The release in `repo`: the release commit, the release build, then the commit that holds dist/ and the tag on it. Returns the version. */
function cut(repo: string): string {
  // The tag is made below, on the second commit, so the tool's own is skipped.
  run("npx", ["commit-and-tag-version", "--skip.tag"], repo);
  const version = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version;
  // LAST of the builds: the commit the tool just made fired the gate, which rebuilds dist/ as a dev build.
  run("just", ["build-release"], repo);

  const head = out("git", ["rev-parse", "HEAD"], repo);
  const scratch = mkdtempSync(join(tmpdir(), "flow-release-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
    out("git", ["read-tree", head], repo, env);
    out("git", ["add", "-f", "--", ...BUILT], repo, env);
    const tree = out("git", ["write-tree"], repo, env);
    const built = out("git", ["commit-tree", tree, "-p", head, "-m", `chore(release): v${version} holds the built files`], repo);
    out("git", ["tag", "-a", `v${version}`, built, "-m", `v${version}`], repo);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return version;
}

/** Every file under `dir`, relative to it, not entering a node_modules folder. */
function files(dir: string, at = ""): string[] {
  return readdirSync(join(dir, at)).flatMap((name) => {
    const rel = at === "" ? name : `${at}/${name}`;
    if (name === "node_modules") return [];
    return statSync(join(dir, rel)).isDirectory() ? files(dir, rel) : [rel];
  });
}

/** The release, made in a throwaway clone and installed from its tag as a project would. */
function check(): void {
  const root = mkdtempSync(join(tmpdir(), "flow-release-check-"));
  try {
    const clone = join(root, "flow");
    run("git", ["clone", "-q", "--local", PACKAGE, clone], PACKAGE);
    for (const key of ["user.name", "user.email"]) run("git", ["config", key, out("git", ["config", key], PACKAGE)], clone);
    // The clone builds with this checkout's dependencies, and fires no commit hook: core.hooksPath is not cloned.
    symlinkSync(join(PACKAGE, "node_modules"), join(clone, "node_modules"), "dir");

    const version = cut(clone);
    const tag = `v${version}`;
    process.stdout.write(`\nrelease-check: ${tag} cut in ${clone}\n`);
    process.stdout.write(`  release commit  ${out("git", ["log", "-1", "--format=%h %s", `${tag}^`], clone)}\n`);
    process.stdout.write(`  tagged commit   ${out("git", ["log", "-1", "--format=%h %s", tag], clone)}\n`);

    const scripts = installScripts(out("git", ["show", `${tag}:package.json`], clone));
    if (scripts.length > 0) throw new Error(`the tag's package.json names ${scripts.join(", ")}, which npm runs on install: a tag holds built files and builds nothing`);
    if (out("git", ["ls-tree", "-r", "--name-only", `${tag}^`, "dist"], clone) !== "")
      throw new Error("the release commit holds dist/: only the tag's commit may");

    const project = join(root, "project");
    mkdirSync(project);
    run("npm", ["init", "-y", "--silent"], project);
    run("npm", ["i", "-D", "--ignore-scripts", "--allow-git=root", `git+file://${clone}#${tag}`], project);

    const installed = join(project, "node_modules", "@jawache", "flow");
    process.stdout.write(`\nrelease-check: what a project gets in node_modules/@jawache/flow\n`);
    for (const file of files(installed).sort()) process.stdout.write(`  ${file}\n`);

    const printed = out("node", [join(installed, "dist", "flow.mjs"), "--version"], project);
    process.stdout.write(`\n$ node node_modules/@jawache/flow/dist/flow.mjs --version\n${printed}\n`);
    if (printed !== version) throw new Error(`the installed flow prints ${printed}, and the tag is ${tag}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const verb = process.argv[2];
try {
  if (verb === "cut") {
    const version = cut(PACKAGE);
    process.stdout.write(`\nLocal only: nothing was pushed and nothing was published.\nv${version} holds dist/; the branch stays at the release commit.\nTo share it:  git push origin HEAD && git push origin v${version}\n`);
  } else if (verb === "check") {
    check();
  } else {
    process.stderr.write("usage: node tools/release.ts cut | check\n");
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`release: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
