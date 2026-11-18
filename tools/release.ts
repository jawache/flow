// flow/tools/release.ts — the shell behind `just release` and `just release-check`.
//
// A release is a tag that holds flow's built files. Two commits make it: the release commit on the
// branch (the version and the changelog, made by commit-and-tag-version with its own tag turned
// off), and a second commit above it that holds dist/. The tag points at the second, and the branch
// stays at the first, so the branch never holds built files and the tag always does. A project
// installs the tag with `npm i -D github:jawache/flow#v<version>`, and npm builds nothing, because
// the tagged package.json has no script it would run (`justfile.node.noPackageScripts` refuses one at the release commit).
//
//   node tools/release.ts cut     the release commit, the release build, the commit that holds dist/, the tag
//   node tools/release.ts check   the same, in a throwaway clone, then the tag installed with scripts off and run
//
// The second commit is a plain `git commit` on a detached HEAD, so the commit gate judges it as it
// judges every commit; the branch is switched back to the release commit afterwards.
// Nothing here pushes, and nothing publishes.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE = resolve(import.meta.dirname, "..");

/** What a tag ships of dist/: the same list `files` in package.json allows. */
const BUILT = ["dist/flow.mjs", "dist/index.mjs", "dist/packs.mjs", "dist/types"] as const;

/** Run a program in `cwd`, showing its output, and stop the release when it fails. */
function run(program: string, args: readonly string[], cwd: string): void {
  const ran = spawnSync(program, args, { cwd, stdio: "inherit" });
  if (ran.status !== 0) throw new Error(`${program} ${args.join(" ")} failed (exit ${String(ran.status)}) in ${cwd}`);
}

/** Run a program in `cwd` and return what it printed, trimmed. */
function out(program: string, args: readonly string[], cwd: string): string {
  const ran = spawnSync(program, args, { cwd, encoding: "utf8" });
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

  // The second commit is an ordinary `git commit` on a detached HEAD, so the commit gate judges it
  // like every other commit, and the branch is never moved: switching back leaves it at the release commit.
  const branch = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const release = out("git", ["rev-parse", "HEAD"], repo);
  run("git", ["switch", "--detach", "-q"], repo);
  try {
    run("git", ["add", "-f", "--", ...BUILT], repo);
    run("git", ["commit", "-q", "-m", `chore(release): v${version} holds the built files`], repo);
    run("git", ["tag", "-a", `v${version}`, "-m", `v${version}`], repo);
  } catch (error) {
    // The branch is put back whatever refused, so the caller sees the refusal and a repo as it was.
    spawnSync("git", ["reset", "-q"], { cwd: repo });
    spawnSync("git", ["switch", "-q", branch === "" ? release : branch], { cwd: repo });
    throw error;
  }
  // The commit gate rebuilt dist/ as a dev build while it judged the commit, and switching to the
  // branch, which does not track dist/, removes the files the tag tracks. So the folder is put back to
  // the working tree alone, from the tag: the release build, which this repo's guard loads, and nothing staged.
  run("git", ["restore", "--", "dist"], repo);
  run("git", ["switch", "-q", branch === "" ? release : branch], repo);
  run("git", ["restore", "--source", `v${version}`, "--worktree", "--", ...BUILT], repo);
  return version;
}

/** Every file under `dir`, relative to it. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
}

/** The release, made in a throwaway clone and installed from its tag as a project would. */
function check(): void {
  const root = mkdtempSync(join(tmpdir(), "flow-release-check-"));
  try {
    const clone = join(root, "flow");
    run("git", ["clone", "-q", "--local", PACKAGE, clone], PACKAGE);
    for (const key of ["user.name", "user.email"]) run("git", ["config", key, out("git", ["config", key], PACKAGE)], clone);
    // The clone builds with this checkout's dependencies, and its commits meet the same commit gate
    // this repo's do: core.hooksPath is per clone, so it is set here, and the gate resolves flow
    // through the linked node_modules.
    // node_modules is this checkout's, entry by entry, except `@jawache/flow`, which links to the clone as `just install` does.
    mkdirSync(join(clone, "node_modules", "@jawache"), { recursive: true });
    for (const name of readdirSync(join(PACKAGE, "node_modules")))
      if (name !== "@jawache") symlinkSync(join(PACKAGE, "node_modules", name), join(clone, "node_modules", name));
    symlinkSync(clone, join(clone, "node_modules", "@jawache", "flow"), "dir");
    run("git", ["config", "core.hooksPath", ".githooks"], clone);
    // The gate loads flow.config.ts through that link, so the bundles it imports exist first.
    run("just", ["build"], clone);

    const version = cut(clone);
    const tag = `v${version}`;
    process.stdout.write(`\nrelease-check: ${tag} cut in ${clone}\n`);
    process.stdout.write(`  release commit  ${out("git", ["log", "-1", "--format=%h %s", `${tag}^`], clone)}\n`);
    process.stdout.write(`  tagged commit   ${out("git", ["log", "-1", "--format=%h %s", tag], clone)}\n`);

    if (!existsSync(join(clone, "dist", "flow.mjs"))) throw new Error("dist/flow.mjs is missing from the clone after the release: this repo's guard cannot load without it");
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
