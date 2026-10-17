// flow/adapter/claude.ts — the adapter's SHELL: the live side of Claude Code, wired.
//
// Everything it acts on was decided somewhere else. The dialect is next door in domain.ts (a
// payload's meaning, a transcript's meaning, what a refusal looks like); the judgement is the
// engine's (`guard`, `brief`); the rules are the config's. This file opens files, runs commands,
// asks git what it knows, and hands the answers over. It makes no decisions a reader has to reason
// about — which is what makes the two questions of §7 it owns ("which repo is this", "where is the
// session log") the only harness knowledge that had to live in a shell.
//
// THREE ENTRY POINTS, and they are the whole live surface:
//
//   runHook(event)   one of the hook events flow answers — stdin in, a HookResult out
//   runCommit(files) the git pre-commit gate, handed the staged set
//   realWorld(root)  the `World` a check reaches through: exec · fs · git
//
// IT FAILS IN TWO DIRECTIONS ON PURPOSE, and the split is the whole doctrine:
//
//   THE GUARD fails LOUD. A classifier that throws, a check that crashes, a bound command that is
//   missing — every one of them BLOCKS, carrying the reason. The engine decides that; this file
//   just does not soften it. A config that will not load is loud the other way: it goes to
//   `whileBroken`, which lets every call through and hands the agent the load error with each one,
//   and the commit gate refuses every commit until the config loads. 2026-08-22 is why it must
//   never be silent: this repo's own config was broken for a day, the fault notice fired on every
//   hook, and the human never saw one.
//
//   THE TELEMETRY fails SAFE and silent. A log that cannot be written must never be the reason a
//   write is refused — `.flow/` answers with a boolean and this file does not look. State is a
//   de-duplication convenience, and losing it re-shows a breadcrumb, which is the harmless
//   direction.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isatty } from "node:tty";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadConfig,
  type Category,
  type ExecResult,
  type FlowConfig,
  refusalText,
  type LoadResult,
  type Grammar,
  type Settings,
  type TurnAction,
  type World,
} from "../language/domain.ts";
import {
  afterCompaction,
  brief,
  FLOW_DIR,
  sanitise,
  categoriesIn,
  fault,
  judgedDeletions,
  guard,
  recorder,
  runRows,
  UNNAMED_COMMIT,
  type AgentOf,
  type Block,
  type Identity,
  type Marks,
  type Notice,
  type Outcome,
  type RecordedStep,
  type Row,
} from "../engine/domain.ts";
import { quoteArg, useGrammars } from "../checks/domain.ts";
import {
  appendRows,
  appendSteps,
  commitAttribution,
  ensureFlowDir,
  isOff,
  isRecording,
  loadState,
  saveState,
  stickyIdentity,
  writeMarker,
} from "../engine/state.ts";
import {
  ALLOW,
  CONFIG_FILE,
  configLoadFault,
  branchFromHead,
  callKey,
  callRecord,
  forgettable,
  overlapping,
  deltaFault,
  AFTER_CALL,
  readFault,
  hermeticEnv,
  isHookEvent,
  pathLines,
  stagedChanges,
  treeChanges,
  commitScope,
  type CommitScope,
  type StagedChanges,
  sessionFactsFrom,
  agentOf,
  ownTranscriptPath,
  refused,
  reversal,
  toEvent,
  toResult,
  tokensFromTranscript,
  toolRow,
  shellReadRows,
  writeRows,
  mismatchRow,
  turnActions,
  agentSettingOf,
  nothingBound,
  ridesRefusal,
  whileBroken,
  included,
  authored,
  nulPaths,
  snapshotPathspecs,
  visibility,
  type AdapterEvent,
  type Answer,
  type CallRecord,
  type Change,
  type Delta,
  type RevertScope,
  type EventWorld,
  type HookEvent,
  type HookPayload,
  type HookResult,
  type Refused,
  type Shown,
} from "./domain.ts";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORLD — what a check reaches through, and the only place flow runs anything
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** How much of a tool's output a check may be handed. Generous — a failing suite is verbose. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/**
 * Run one command the way a check means it — through a shell, in the repo, hermetically.
 *
 * `bash -lc` because the commands checks build are shell text, not argv: `just test && npx tsc`, a
 * heredoc writing dependency-cruiser's config, a pipeline. The old engine ran its tools the same
 * way, and the login shell is what makes a version manager's PATH available to a gate that git
 * spawned.
 *
 * A MISSING BINARY IS `{ code: 127 }`, NEVER A THROW, and the fail-loud proof stands on it: the
 * engine turns a non-zero exit into a block naming the entry and the command, so `just` not being
 * installed refuses the commit instead of passing it. bash answers 127 itself; the only case left
 * is bash being unspawnable, which is the same fact one level up and is answered the same way.
 */
export function runCommand(command: string, root: string, env = hermeticEnv(process.env)): ExecResult {
  const result = spawnSync("bash", ["-lc", command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    // Git's hook variables would aim any nested `git` at the in-progress commit. See GIT_HOOK_ENV.
    env,
  });
  if (result.error) return { stdout: "", stderr: `flow could not run a command: ${result.error.message}`, code: 127 };
  // `status` is null when a signal killed the process. That is a failure, and 1 says so — the one
  // code that must never be invented is 0.
  return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1 };
}

/** A repo-relative path, made absolute. Every path a check sees is relative; disk is not. */
function inRepo(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** A file's text, or null when it is not there / not readable. */
export function readText(root: string, path: string): string | null {
  try {
    return readFileSync(inRepo(root, path), "utf8");
  } catch {
    return null;
  }
}

/**
 * THE WORLD a check reads through — the three capabilities, live.
 *
 * The whole promise of `.test()` cases rests on this object being interchangeable with the recorded
 * one a case drives: same three methods, same shapes, and the check cannot tell which it has. That
 * is also what F5's replay is: a third implementation of this interface, reading a fixture.
 *
 * git is asked in PATH LISTS and never in a status format. The old engine parsed
 * `git status --porcelain=v1` with a fixed-width slice and had a war story about eating the first
 * character of a path; the checks now ask questions whose answers are one path per line, so there
 * is no column to slice and no porcelain parser anywhere in flow.
 */
export function realWorld(root: string): World {
  return {
    exec: (command: string): Promise<ExecResult> => Promise.resolve(runCommand(command, root)),
    fs: {
      read: (path: string): Promise<string> => Promise.resolve(readText(root, path) ?? ""),
      exists: (path: string): Promise<boolean> => Promise.resolve(existsSync(inRepo(root, path))),
    },
    git: {
      diff: (path?: string): Promise<string> =>
        Promise.resolve(runCommand(path ? `git diff -- ${quoteArg(path)}` : "git diff", root).stdout),
      stagedFiles: (): Promise<string[]> =>
        Promise.resolve(pathLines(runCommand("git diff --cached --name-only --diff-filter=ACM", root).stdout)),
    },
  };
}

/**
 * The branch this checkout has out, read from its own `HEAD` — no subprocess, and none wanted.
 *
 * The marker is keyed on the branch because a worktree IS a branch: `git worktree add` refuses to
 * check the same one out twice, so two worktrees committing at once cannot clobber each other's
 * answer and mis-attribute a commit.
 *
 * A LINKED WORKTREE keeps its `.git` as a FILE naming the real gitdir, and that indirection is the
 * whole reason this is more than one read: resolve it, or every worktree reports the main
 * checkout's branch and the collision the naming scheme prevents comes straight back. Outside a git
 * repo there is one checkout and the bare marker name is correct.
 */
export function currentBranch(root: string): string | null {
  try {
    const dotgit = join(root, ".git");
    const gitdir = statSync(dotgit).isDirectory()
      ? dotgit
      : resolve(root, /gitdir:\s*(.+)/.exec(readFileSync(dotgit, "utf8"))?.[1]?.trim() ?? "");
    return branchFromHead(readFileSync(join(gitdir, "HEAD"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * WHO LAST WORKED IN THIS WORKTREE, and what they were wearing — the marker the write rail leaves,
 * read the one way.
 *
 * Both surfaces that ask outside a session ask it: the commit gate, deciding whether an
 * actor-scoped rule applies to a commit nobody is in the room for, and `flow status`, naming the
 * session a person is about to join. Asked twice in two places, the two could come to disagree about
 * who is here — and a rule that fires at the gate for a wearer status never showed is the exact
 * surprise the marker exists to prevent.
 *
 * `who` is null when the marker is missing, stale or malformed, and then the wearer wears NOTHING
 * rather than a guess: there is no transcript and no hook message out here, so the stored verdict is
 * the only truthful answer there can be.
 */
export function wearer(root: string): {
  readonly branch: string | null;
  readonly session: string;
  readonly who: AgentOf | null;
  readonly wearing: readonly string[];
} {
  const branch = currentBranch(root);
  const { session, who } = commitAttribution(root, branch);
  return { branch, session, who, wearing: who === null ? [] : (loadState(root, session, who.agent).categories ?? []) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SNAPSHOT — the tree before a call, the tree after it, and the way back
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Before every tool call the working tree is recorded as a git tree; after it, recorded again, and
// the two compared. The judgement is next door (`toEvent` over the changes, `reversal`, `toResult`);
// this is the git work and nothing else.
//
// NEVER THE USER'S INDEX. Each snapshot is built in a throwaway index file under `.flow/snapshots/`
// (`GIT_INDEX_FILE`), seeded with a COPY of the real index so git's stat cache spares it re-hashing
// every file, and the real index and staging area are never written. The objects go into the repo's
// own object store — the same place `git stash` puts them, reachable from nothing, and swept by git's
// own gc — rather than a second object directory flow would then have to prune. `.flow/` ignores
// itself, so nothing kept here is ever in the diff.
//
// THE SNAPSHOT IS GIT'S VIEW: tracked files, and untracked ones git does not ignore (`git add -A`),
// plus the ignored paths `snapshotInclude` names (`git add -f`). No exclude setting exists, because
// gitignore already is one.

/** How much content one diff may carry. Generous: a revert must not fail on a large file. */
const MAX_DELTA = 256 * 1024 * 1024;

/** One git command, run DIRECTLY — no shell, so no login profile on a path that runs every call. */
function runGit(
  root: string,
  args: readonly string[],
  opts: { readonly index?: string; readonly input?: string } = {},
): { readonly ok: boolean; readonly stdout: Buffer; readonly stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    maxBuffer: MAX_DELTA,
    ...(opts.input === undefined ? {} : { input: opts.input }),
    // Git's hook variables are stripped first (see GIT_HOOK_ENV) and the throwaway index is set
    // after, so a snapshot taken inside a commit hook still never aims at the commit's own index.
    env: { ...hermeticEnv(process.env), ...(opts.index === undefined ? {} : { GIT_INDEX_FILE: opts.index }) },
  });
  if (result.error) return { ok: false, stdout: Buffer.alloc(0), stderr: result.error.message };
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr.toString("utf8").trim() };
}

/** This checkout's git directory — a linked worktree keeps a FILE at `.git` naming it. */
function gitDir(root: string): string | null {
  try {
    const dotgit = join(root, ".git");
    return statSync(dotgit).isDirectory()
      ? dotgit
      : resolve(root, /gitdir:\s*(.+)/.exec(readFileSync(dotgit, "utf8"))?.[1]?.trim() ?? "");
  } catch {
    return null;
  }
}

/** HEAD's commit, or null when there is none to read — a repo with no commit yet. */
function headCommit(root: string): string | null {
  const head = runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return head.ok ? head.stdout.toString("utf8").trim() : null;
}

/**
 * The commits the refs point at — every ref and every worktree's HEAD for `--all`, the
 * remote-tracking branches for `--remotes`. None when git cannot say.
 */
function tips(root: string, refs: "--all" | "--remotes"): string[] {
  const listed = runGit(root, ["rev-list", refs, "--no-walk"]);
  return listed.ok ? listed.stdout.toString("utf8").split("\n").filter((line) => line !== "") : [];
}

/**
 * HEAD after the call when it is a commit the repo already had: one that `known`, the tips recorded
 * before the call, reaches, or that a remote-tracking branch reaches after it. A switch, a checkout,
 * a reset, a fast-forward or a pull lands on such a commit. null when there is no HEAD, or when the
 * call made it — a commit, a rebase, a merge that is not a fast-forward — since a commit the call
 * made holds the call's own edits, and no gate it might have skipped (`--no-verify`, a removed
 * hook) can be taken on trust.
 */
function existingHead(root: string, known: readonly string[]): string | null {
  const head = headCommit(root);
  if (head === null || known.includes(head)) return head;
  const reach = [...known, ...tips(root, "--remotes")];
  const beyond = runGit(root, ["rev-list", "-n1", "--stdin"], { input: `${[head, ...reach.map((tip) => `^${tip}`)].join("\n")}\n` });
  return beyond.ok && beyond.stdout.toString("utf8").trim() === "" ? head : null;
}

/** Where one call's snapshot lives: what it recorded, and the throwaway index it was built in. */
function snapshotFiles(root: string, key: string): { readonly meta: string; readonly index: string; readonly after: string } {
  const base = join(root, FLOW_DIR, "snapshots", sanitise(key));
  return { meta: `${base}.json`, index: `${base}.index`, after: `${base}.after.index` };
}

/**
 * A file in the snapshots folder this old is left over, whatever it is. The call log forgets only a
 * finished call (`forgettable`), so this is what takes a call that never finished: dead, with its
 * session killed, or a spawn whose session died. A dead call is kept this long, not an hour, because
 * it may still be waiting at a permission prompt, and its after-call hook then needs its snapshot.
 * It is the backstop too for what no readable record accounts for.
 */
const STALE_SNAPSHOT_MS = 24 * 60 * 60 * 1000;

/**
 * The tree as it stands, written into `index` and returned as a tree id — or why it could not be.
 *
 * `seed` is the index to start from: the real one before a call, the before-snapshot's own after it,
 * so only what changed in between is hashed.
 */
function writeTree(root: string, index: string, seed: string | null, include: readonly string[]): { tree: string } | { fault: string } {
  try {
    if (seed !== null && existsSync(seed)) copyFileSync(seed, index);
  } catch (error) {
    return { fault: `could not copy git's index (${(error as Error).message})` };
  }
  const added = runGit(root, ["add", "-A"], { index });
  if (!added.ok) return { fault: `git add -A failed: ${added.stderr}` };
  if (include.length > 0) {
    const listed = runGit(
      root,
      ["--literal-pathspecs", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...snapshotPathspecs(include)],
      { index },
    );
    if (!listed.ok) return { fault: `git could not list the ignored paths snapshotInclude names: ${listed.stderr}` };
    const wanted = included(listed.stdout.toString("utf8").split("\0"), include);
    if (wanted.length > 0) {
      const forced = runGit(root, ["--literal-pathspecs", "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        index,
        input: `${wanted.join("\0")}\0`,
      });
      if (!forced.ok) return { fault: `git could not record the snapshotInclude paths: ${forced.stderr}` };
    }
  }
  const tree = runGit(root, ["write-tree"], { index });
  if (!tree.ok) return { fault: `git write-tree failed: ${tree.stderr}` };
  return { tree: tree.stdout.toString("utf8").trim() };
}

/**
 * WHAT THE SNAPSHOT COULD NOT SEE: every path on disk that git ignored and `index` does not hold,
 * names only. It is what tells a file that entered the snapshot during a call from one the call
 * created (`visibility`), and it is taken before the call, so the config the call may edit decides
 * nothing. `--directory` names a directory git ignores whole once, `node_modules/`, so git never
 * walks it and the list stays short.
 */
function hiddenPaths(root: string, index: string): { hidden: string[] } | { fault: string } {
  const listed = runGit(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { index });
  if (!listed.ok) return { fault: `git could not list the ignored paths the snapshot leaves out: ${listed.stderr}` };
  return { hidden: nulPaths(listed.stdout.toString("utf8")) };
}

/**
 * RECORD THE TREE BEFORE A CALL, filed under the host's `tool_use_id`.
 *
 * A snapshot that cannot be taken is RECORDED as a fault rather than skipped, so the after-call rail
 * reports it instead of finding nothing and calling the call clean. `who` is kept beside the tree so
 * a snapshot with no after is readable as a call still in flight, per session and agent.
 */
export function takeSnapshot(
  root: string,
  key: string,
  include: readonly string[],
  who: { readonly session: string; readonly agent: string; readonly tool: string },
): void {
  const files = snapshotFiles(root, key);
  try {
    ensureFlowDir(root);
    mkdirSync(dirname(files.meta), { recursive: true });
    sweepSnapshots(dirname(files.meta));
  } catch {
    // The write below reports what went wrong, if anything did; a sweep that failed costs nothing.
  }
  const dir = gitDir(root);
  const written = dir === null ? { fault: `${root} is not a git checkout, so there is no tree to snapshot` } : writeTree(root, files.index, join(dir, "index"), include);
  // What the tree left out, beside it: the after-call rail needs it to tell a file the call
  // created from one that was already on disk and hidden (#146).
  const hidden = "tree" in written ? hiddenPaths(root, files.index) : null;
  const taken = hidden !== null && "fault" in hidden ? hidden : { ...written, ...hidden };
  // HEAD before the call, beside the tree: a file the call removed is git's only if HEAD held it.
  // And every tip the repo has, so the after-call rail can tell a commit it lands on from one it made.
  const head = "tree" in taken ? headCommit(root) : null;
  const known = "tree" in taken ? tips(root, "--all") : [];
  try {
    writeFileSync(files.meta, JSON.stringify({ ...who, at: Date.now(), ...taken, ...(head === null ? {} : { head }), known }));
  } catch {
    // Nothing can be recorded, so the after-call rail finds no snapshot and says so — the loud way.
  }
}

/** Files a day old the call log never forgot: a call that never finished, a half-written record. */
function sweepSnapshots(dir: string): void {
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (now - statSync(path).mtimeMs > STALE_SNAPSHOT_MS) rmSync(path, { force: true });
  }
}

/** The content of each `<tree>:<path>` asked for, or null where the tree has no such blob. */
function blobs(root: string, specs: readonly string[]): (string | null)[] | null {
  if (specs.length === 0) return [];
  const read = runGit(root, ["cat-file", "--batch"], { input: `${specs.join("\n")}\n` });
  if (!read.ok) return null;
  const out: (string | null)[] = [];
  let at = 0;
  for (let i = 0; i < specs.length; i++) {
    const eol = read.stdout.indexOf(10, at);
    if (eol === -1) return null;
    const header = read.stdout.subarray(at, eol).toString("utf8");
    at = eol + 1;
    if (header.endsWith(" missing")) {
      out.push(null);
      continue;
    }
    const [, type, size] = header.split(" ");
    const length = Number(size);
    out.push(type === "blob" ? read.stdout.subarray(at, at + length).toString("utf8") : null);
    at += length + 1;
  }
  return out;
}

/**
 * WHAT THE CALL CHANGED: the tree now against the tree its snapshot recorded, path by path, with
 * the content either side, less each path git put there (see `authored`). The before-snapshot is
 * kept — a revert reads from it — until `forget`.
 */
export function observeDelta(root: string, key: string, include: readonly string[]): Delta & { readonly before?: string } {
  const files = snapshotFiles(root, key);
  let meta: { tree?: unknown; head?: unknown; known?: unknown; hidden?: unknown; fault?: unknown };
  try {
    meta = JSON.parse(readFileSync(files.meta, "utf8")) as { tree?: unknown; head?: unknown; known?: unknown; hidden?: unknown; fault?: unknown };
  } catch {
    return { ok: false, fault: `No snapshot was taken before this call (tool_use_id ${key}), so there is nothing to compare the tree against.` };
  }
  if (typeof meta.fault === "string") return { ok: false, fault: `The snapshot before this call could not be taken: ${meta.fault}.` };
  if (typeof meta.tree !== "string") return { ok: false, fault: `The snapshot before this call (tool_use_id ${key}) is unreadable.` };
  const before = meta.tree;
  // What the snapshot could not see, as it recorded it. A record with no list is one flow cannot
  // read that from, and `visibility` then takes every new path as one that was already there.
  const hidden = Array.isArray(meta.hidden) ? meta.hidden.filter((path): path is string => typeof path === "string") : null;
  const now = writeTree(root, files.after, files.index, include);
  if ("fault" in now) return { ok: false, fault: `The tree after this call could not be recorded: ${now.fault}.` };
  if (now.tree === before) return { ok: true, changes: [], entered: [], before };
  // One entry per path, NUL-separated, never a human status format. Submodules are another
  // repository's business and are left out.
  const diffTree = (from: string, format: "--name-status" | "--name-only"): string | { why: string } => {
    const ran = runGit(root, ["diff-tree", "-r", "-z", format, "--no-renames", "--ignore-submodules=all", from, now.tree]);
    return ran.ok ? ran.stdout.toString("utf8") : { why: ran.stderr };
  };
  const changed = diffTree(before, "--name-status");
  if (typeof changed !== "string") return { ok: false, fault: `git could not compare the trees: ${changed.why}.` };
  /** The delta, once `authored` has said which changed paths are the call's own. */
  const delta = (paths: readonly string[]): Delta & { readonly before?: string } => {
    if (paths.some((path) => path.includes("\n")))
      return { ok: false, fault: "A changed path has a newline in its name, which flow cannot ask git about safely." };
    const content = blobs(root, paths.flatMap((path) => [`${before}:${path}`, `${now.tree}:${path}`]));
    if (content === null) return { ok: false, fault: "git could not read the changed files back out of the snapshot." };
    // What changed VIEW rather than content leaves here: a file that entered the snapshot during
    // the call, and one that left it still on disk as it was (`visibility`). One that left it
    // rewritten stays, as the write it is.
    const seen = visibility(
      paths.map((path, i) => ({ path, before: content[2 * i] ?? null, after: content[2 * i + 1] ?? null })),
      hidden,
      (path) => readText(root, path),
    );
    return { ok: true, changes: seen.changes, entered: seen.entered, before };
  };
  // WHAT GIT PUT THERE leaves the diff here, before anything reads it: HEAD after the call and HEAD
  // before it, each against the tree after it, are one more tree comparison each (`authored`
  // decides). Only a HEAD the repo already had can be matched: none, or one the call made, leaves
  // every change judged. HEAD before only ever answers for a file that matches HEAD after, and when
  // HEAD did not move one comparison answers for both.
  const known = Array.isArray(meta.known) ? meta.known.filter((tip): tip is string => typeof tip === "string") : [];
  const headAfter = existingHead(root, known);
  if (headAfter === null) return delta(authored(changed, null, null));
  const fromAfter = diffTree(headAfter, "--name-only");
  if (typeof fromAfter !== "string") return { ok: false, fault: `git could not compare the tree with HEAD: ${fromAfter.why}.` };
  const differsAfter = nulPaths(fromAfter);
  const headBefore = typeof meta.head === "string" ? meta.head : null;
  if (headBefore === null) return delta(authored(changed, differsAfter, null));
  if (headBefore === headAfter) return delta(authored(changed, differsAfter, differsAfter));
  const fromBefore = diffTree(headBefore, "--name-only");
  if (typeof fromBefore !== "string") return { ok: false, fault: `git could not compare the tree with HEAD before the call: ${fromBefore.why}.` };
  return delta(authored(changed, differsAfter, nulPaths(fromBefore)));
}

/**
 * PUT CHANGES BACK from the before-snapshot — a changed or removed file to its old content, a file
 * the call created removed. Answers what could not be put back, never throws: a revert that failed
 * is said to the model, loudly, rather than claimed.
 */
export function revertChanges(root: string, tree: string, changes: readonly Change[]): { path: string; why: string }[] {
  const failed: { path: string; why: string }[] = [];
  for (const change of changes.filter((c) => c.before === null)) {
    try {
      rmSync(inRepo(root, change.path), { force: true });
    } catch (error) {
      failed.push({ path: change.path, why: (error as Error).message });
    }
  }
  const back = changes.filter((c) => c.before !== null).map((c) => c.path);
  if (back.length > 0) {
    // `restore --worktree` writes the files and nothing else — no index, the user's or ours.
    const restored = runGit(root, ["--literal-pathspecs", "restore", `--source=${tree}`, "--worktree", "--", ...back]);
    if (!restored.ok) for (const path of back) failed.push({ path, why: restored.stderr || "git restore failed" });
  }
  return failed;
}

/**
 * THE CALL LOG — every snapshot's record, read back: who made each call, when it started, and when
 * it finished if it has. A record that cannot be read is left out; it is somebody's write racing
 * this read, and the next diff reads it whole.
 */
export function callLog(root: string): CallRecord[] {
  const dir = join(root, FLOW_DIR, "snapshots");
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const record = callRecord(name.slice(0, -".json".length), JSON.parse(readFileSync(join(dir, name), "utf8")));
      return record === null ? [] : [record];
    } catch {
      return [];
    }
  });
}

/**
 * The call is over: its record says when it finished, so a diff still to come can tell it
 * overlapped, and its throwaway indexes go. Records no diff still to come can overlap are dropped.
 */
export function finishSnapshot(root: string, key: string, now = Date.now()): void {
  const files = snapshotFiles(root, key);
  for (const path of [files.index, files.after]) rmSync(path, { force: true });
  const log = callLog(root);
  const me = log.find((call) => call.key === key);
  try {
    if (me === undefined) rmSync(files.meta, { force: true });
    else writeFileSync(files.meta, JSON.stringify({ session: me.session, agent: me.agent, tool: me.tool, at: me.at, done: now }));
  } catch {
    // A record that cannot be marked finished reads as in flight for its first hour: it narrows
    // refusals, which is the safe direction, and never widens one.
  }
  const finished = log.map((call) => (call.key === key ? { ...call, done: now } : call));
  for (const gone of forgettable(finished, now)) rmSync(snapshotFiles(root, gone).meta, { force: true });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONFIG — which repo this is, and what it has turned on
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The repo the session is standing in — the FOURTH question of §7.
 *
 * The hook's own cwd is not guaranteed to be the project: the host sets `CLAUDE_PROJECT_DIR` for
 * exactly this, and cwd is the fallback that keeps the git gate (spawned inside the repo) working.
 */
export function projectRoot(cwd: string): string {
  return process.env["CLAUDE_PROJECT_DIR"] || cwd;
}

/**
 * What this repo's config amounts to. Three outcomes, and they are three different facts.
 *
 * `none` is a repo that has never heard of flow, and it must be SILENT: the hooks are registered
 * once in the host's settings and fire in every repo the agent visits, so a missing config is the
 * ordinary case and blocking on it would make flow unusable the moment it was installed.
 *
 * `broken` is the opposite fact and must never be silent: a config file that is THERE and will
 * not even import is a guard that cannot run. The hook rail hands it to `whileBroken`, which lets
 * every call through with the load error, and the commit gate refuses. (A config that imports and
 * then will not load — `load.ok === false` — is the same fact and gets the same two answers.)
 */
export type Regime =
  | { readonly kind: "none" }
  | { readonly kind: "loaded"; readonly config: FlowConfig; readonly load: LoadResult }
  | { readonly kind: "broken"; readonly message: string };

/**
 * Register the grammars this config declared, with their library paths made absolute.
 *
 * ONE SPELLING, called by both doors that read a config — the CLI's `loadFile` and the hook rail's
 * `loadRegime` — because which grammars exist must not depend on which verb you typed. The path is
 * resolved against the CONFIG'S OWN ROOT rather than the process's cwd: a hook runs wherever the
 * harness happened to be, which is the whole reason `projectRoot` exists.
 *
 * It is here rather than in the adapter's pure half because `join` is an effect-shaped answer about
 * this machine, and `adapter/domain.ts` is a pure home.
 */
export function grammarsAt(settings: Settings, root: string): readonly Grammar[] {
  return (settings.grammars ?? []).map((grammar) =>
    isAbsolute(grammar.libraryPath) ? grammar : { ...grammar, libraryPath: join(root, grammar.libraryPath) },
  );
}

export function registerGrammars(settings: Settings, root: string): void {
  useGrammars(grammarsAt(settings, root), existsSync);
}

export async function loadRegime(root: string): Promise<Regime> {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { kind: "none" };
  try {
    const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
    const config = module.default as FlowConfig | undefined;
    if (!config || typeof config !== "object" || !Array.isArray(config.bindings))
      return {
        kind: "broken",
        message: `flow: ${CONFIG_FILE} has no default export from \`defineConfig([…])\` — that call IS the config, and its result is what flow reads.`,
      };
    registerGrammars(config.settings, root);
    return { kind: "loaded", config, load: loadConfig(config) };
  } catch (error) {
    // `configLoadFault`, not a sentence of its own: the same breakage reaches a person through
    // `flow test` and through a blocked hook, and a guard that describes it two ways is a guard
    // nobody learns to read. It is also where the node floor is named, once.
    return { kind: "broken", message: configLoadFault(CONFIG_FILE, (error as Error).message, process.versions.node) };
  }
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RUN — one payload, from stdin to an exit code
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Everything one hook run may need to know about the world — and every answer that costs something
 * is a FUNCTION, asked at most once.
 *
 * The transcript is why. It is a couple of megabytes on a working session and a hook fires on every
 * single tool call, so reading it eagerly would put a multi-megabyte read and parse in front of
 * every write the agent makes. Three answers come out of that one file and each rail needs a
 * different subset of them: the write rail needs none.
 */
interface Session {
  readonly root: string;
  readonly id: string;
  /** Which agent the call came from, and its type when the host said. */
  readonly who: AgentOf;
  readonly branch: string | null;
  /** This agent's own transcript: a subagent's own, never its parent's. */
  readonly transcript: () => string | null;
  readonly tokens: () => number;
  readonly turn: () => readonly TurnAction[];
  /** The agent the session itself runs as, from the parent's transcript; null when it runs as none. */
  readonly sessionAgent: () => string | null;
}

/** Ask once, remember the answer. A hook is one short-lived process, so this lives and dies with it. */
function once<T>(answer: () => T): () => T {
  let held: { value: T } | null = null;
  return (): T => {
    held ??= { value: answer() };
    return held.value;
  };
}

/**
 * What the payload says about this session, with the expensive answers left unasked.
 *
 * A subagent's call carries its PARENT's `transcript_path`, so the transcript this agent's brief,
 * tokens and turn are read from is the subagent's own one under it, found by its `agent_id`.
 */
function sessionOf(payload: HookPayload, root: string): Session {
  const path = ownTranscriptPath(payload);
  const transcript = once((): string | null => (path === null ? null : readText(root, path)));
  return {
    root,
    id: typeof payload.session_id === "string" && payload.session_id !== "" ? payload.session_id : "unknown",
    who: agentOf(payload),
    branch: currentBranch(root),
    transcript,
    tokens: once((): number => {
      const text = transcript();
      return text === null ? 0 : tokensFromTranscript(text);
    }),
    turn: once((): readonly TurnAction[] => {
      const text = transcript();
      return text === null ? [] : turnActions(text, root);
    }),
    // The PARENT's transcript, `transcript_path` as sent: the session's own agent is its record.
    sessionAgent: once((): string | null => {
      const sent = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
      const text = sent === "" ? null : readText(root, sent);
      return text === null ? null : agentSettingOf(text);
    }),
  };
}

/**
 * Who this session × agent is, read once and then remembered on disk.
 *
 * The agent type in the hook message is the answer when there is one, and the transcript's head is
 * consulted only for the generic buckets a recipe declares — that order is `spawnedAs`'s and is
 * enforced there. What this owes is the evidence: the message, and this agent's own transcript.
 *
 * NO CATEGORIES, NO QUESTION. A config that declares none has nobody to be, so the transcript is
 * never opened and no state file is written to remember an empty answer — which is the common case
 * in a repo whose rules are not actor-scoped, and it is the difference between a hook that reads
 * two megabytes per tool call and one that reads nothing.
 */
function identityOf(session: Session, payload: HookPayload, categories: readonly Category[]): Identity {
  if (categories.length === 0) return { wearing: [], faults: [], fresh: false };
  const facts = sessionFactsFrom({ payload, transcript: session.transcript() });
  return stickyIdentity(session.root, session.id, session.who.agent, facts, categories);
}

/** The world a payload is read against — disk, and the turn, asked only if the moment needs them. */
function eventWorld(root: string, session: Session, changes?: readonly Change[]): EventWorld {
  return {
    root,
    read: (path: string) => readText(root, path),
    turn: session.turn,
    sessionAgent: session.sessionAgent,
    home: homedir(),
    changes,
  };
}

/** A note's prose: inline, or the repo file it named. The shell resolves it; a pure home cannot. */
function prose(root: string, notice: Notice): string {
  if (notice.text !== undefined) return notice.text;
  return notice.file === undefined ? "" : (readText(root, notice.file) ?? "");
}

/** How many things one event was about — what the log row means by `subjects`. */
function subjectCount(event: AdapterEvent): number {
  return event.rail === "guard" && event.moment === "commit" ? (event.staged?.length ?? 0) : 1;
}

/**
 * ONE payload, judged. The live half of the pipeline, in the order the pieces become knowable.
 *
 * The shape is deliberately flat rather than a hook function per event: the events differ in what
 * they CARRY (toEvent's job) and in how their answer is rendered (toResult's job), and the middle —
 * load, classify, run, log — is identical for all of them. The old engine had five files here, and the
 * off switch, the session marker and the fault handling were each written out four or five times
 * with small differences nobody had chosen.
 */
export async function runHook(hook: HookEvent, payload: HookPayload, root: string): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return ALLOW;

  const off = isOff(root);
  const session = sessionOf(payload, root);

  // THE SESSION MARKER, written on every tool call: the commit gate is spawned by git, outside any
  // session, so this is the only way a later `git commit` can attribute its refusals to the chat
  // that caused them. Best-effort by construction — `writeMarker` answers a boolean.
  if (hook === "pre-tool-use" && !off && session.id !== "unknown")
    writeMarker(root, session.id, session.who, session.branch);

  const key = callKey(payload);
  const tool = typeof payload.tool_name === "string" ? payload.tool_name : "";
  const afterCall = AFTER_CALL.has(hook) && !off && tool !== "";
  // THE CALL IS OVER, however it went: its record says it finished, so a diff still to come can
  // tell this call overlapped it.
  const now = Date.now();
  const finish = (): void => {
    if (key !== null) finishSnapshot(root, key, now);
  };

  // THE TREE BEFORE THE CALL, taken only once the call is ALLOWED: a refused call never runs, so its
  // snapshot would be read as a call still in flight. It is taken while the config will not load as
  // well, on purpose: the call that repairs the config needs it, because that call's after-call rail
  // loads a healthy config and diffs against this snapshot.
  const include = regime.kind === "loaded" ? (regime.config.settings.snapshotInclude ?? []) : [];
  const snapshotted = (result: HookResult): HookResult => {
    if (hook === "pre-tool-use" && !off && key !== null && result.exitCode === 0)
      takeSnapshot(root, key, include, { session: session.id, agent: session.who.agent, tool });
    return result;
  };

  // THE CONFIG WILL NOT LOAD. `kind: "broken"` is a module that would not import; a LoadResult
  // carrying refusals is a module that imported and whose grammar was refused. Both are the same
  // fact, "flow is off", and get the same answer: `whileBroken` refuses nothing and hands the agent
  // the load error. They are asked in sequence only because the second needs the LoadResult the
  // first does not have.
  //
  // NO DIFF IS TAKEN after the call: nothing then can be refused or told, so the diff would be work
  // thrown away, and a diff that failed would print a fault about a call nothing judges. So NOTHING
  // IS PUT BACK either: what the call wrote stands — `npm ci`'s `node_modules`, an edit to the
  // config — and the commit gate, which stays shut until the config loads, is where it is checked.
  // The call is over, so its record says so.
  const outage = (sentence: string): HookResult => {
    if (off) return ALLOW;
    const answer = whileBroken(toEvent(hook, payload, eventWorld(root, session)), sentence);
    if (afterCall) finish();
    const result = toResult(hook, answer);
    // TURN-END IS TOLD RATHER THAN HELD. `whileBroken` says why; this is the only place that can
    // write it, because a note on the hand-back rails would keep the agent working, and `toResult`
    // speaks only the two the host reads. Exit 0 — the turn ends, and the sentence goes where a
    // human and the log see it.
    return snapshotted(answer.told === null ? result : { ...result, stderr: `${answer.told}\n` });
  };
  if (regime.kind === "broken") return outage(regime.message);

  const { load, config } = regime;
  if (!load.ok) return outage(refusalText(load.refusals));
  // RECORDING is a second, independent stream and it is deliberately not gated on `off`: turning
  // the guard off to reproduce something and finding the recorder off with it is the one moment
  // this seam exists for. It is gated on the switch alone, and on nothing else.
  const taping = isRecording(root);
  // NOTHING BOUND HERE, NOTHING READ: a hand-back with no turn-end entry to run is answered before
  // either transcript is opened, unless it is being recorded.
  if (nothingBound(hook, load.entries, taping)) return ALLOW;

  // THE DELTA, on the after-call rails: what this call changed in the tree, from the snapshot the
  // PreToolUse rail took. A call flow could not see is REPORTED and goes no further — nothing is
  // judged as clean and nothing is put back on a guess.
  const delta: (Delta & { readonly before?: string }) | null = afterCall
    ? key === null
      ? { ok: false, fault: "The host sent no tool_use_id with this call, so its snapshot cannot be found." }
      : observeDelta(root, key, include)
    : null;
  if (delta !== null && !delta.ok) {
    finish();
    return deltaFault(delta.fault);
  }
  const changes = delta?.ok === true ? delta.changes : undefined;

  // WHAT A REFUSAL MAY UNDO, asked only of a call that changed something: the repo's setting, and
  // the other actors' calls that overlapped this one.
  const revert = config.settings.revert === "all" ? "all" : "refused";
  const scopeOf = (landed: readonly Change[]): RevertScope => {
    if (landed.length === 0 || key === null) return { revert, overlap: [] };
    const log = callLog(root);
    const me = log.find((call) => call.key === key);
    return { revert, overlap: me === undefined ? [] : overlapping(me, log) };
  };

  // THE WAY BACK, once the answer is known: the changes a rule refused are written back from the
  // snapshot, and what that came to rides the answer so the refusal can say it, with the files that
  // entered the snapshot during the call. Then the call is over and its snapshot goes.
  const settle = (answer: Answer): Answer => {
    if (delta === null || key === null) return answer;
    const scope = scopeOf(delta.changes);
    const plan = reversal(delta.changes, answer.refused, scope);
    const failed = plan.revert.length === 0 ? [] : revertChanges(root, delta.before ?? "", plan.revert);
    finish();
    const landed = answer.refused.some((refusal) => refusal.observed !== undefined);
    // A file that entered the snapshot was in no change, so nothing judged it and nothing put it
    // back; the agent is told its name, refused or not.
    const told = { ...answer, entered: delta.entered };
    return landed ? { ...told, undone: { restored: plan.revert, kept: plan.kept, failed, scope } } : told;
  };

  const entries = load.entries;
  const identity = identityOf(session, payload, categoriesIn(entries));

  const events = toEvent(hook, payload, eventWorld(root, session, changes));
  const rows: Row[] = [];

  // The flight recorder goes FIRST, so the tool row precedes the guardrail rows about the same call
  // and the stream reads in the order things happened.
  if (hook === "pre-tool-use" && !off) {
    const row = toolRow(payload, root);
    if (row) rows.push(row);
    rows.push(...shellReadRows(payload, root, homedir()));
  }
  // What the call did to the tree, beside what it named — and where the host's own list of it
  // disagrees with flow's diff.
  if (changes !== undefined && !off) {
    rows.push(...writeRows(payload, changes, root));
    const mismatch = mismatchRow(payload, changes, root);
    if (mismatch !== null) rows.push(mismatch);
  }

  const steps: RecordedStep[] = [];

  const answer = await judge({ events, session, load, settings: config.settings, identity, off, hook, payload, rows, steps: taping ? steps : null });
  if (!off) appendRows({ root, session: session.id, branch: session.branch, who: session.who }, rows);
  if (taping) appendSteps(root, session.id, steps);
  return snapshotted(toResult(hook, settle(answer)));
}

/** The middle of the run: every event through the engine, and the rows that record what happened. */
async function judge(args: {
  readonly events: readonly AdapterEvent[];
  readonly session: Session;
  readonly load: LoadResult;
  readonly settings: Settings;
  readonly identity: Identity;
  readonly off: boolean;
  readonly hook: HookEvent;
  readonly payload: HookPayload;
  readonly rows: Row[];
  /** Where the replayable steps go, or null when this repo is not recording. */
  readonly steps: RecordedStep[] | null;
}): Promise<Answer> {
  const { events, session, load, settings, identity, off, hook, payload, rows, steps } = args;
  const blocked: Refused[] = [];
  const shown: Shown[] = [];
  const world = realWorld(session.root);

  // A COMPACTION is the boundary where the agent stops knowing what it was told, so every area note
  // has to be earned again. The host announces it on the session rail (`source: "compact"`), which
  // is why flow registers no compaction hook of its own — a second registration on one moment is
  // the duplicate the hook grammar exists to prevent.
  const compacted = hook === "session-start" && payload.source === "compact";
  // READ AFTER the identity was settled, deliberately: `stickyIdentity` writes the classification
  // into this same file, and the save at the end of this function carries `stored` forward whole. A
  // read taken before it would write the categories back out of existence on the next breadcrumb.
  const stored = loadState(session.root, session.id, session.who.agent);
  let marks: Marks = compacted && load.ok ? afterCompaction(stored.marks, load.entries) : stored.marks;
  if (compacted && !off) rows.push({ kind: "compaction" });
  if (compacted) steps?.push({ rail: "compaction" });

  for (const event of events) {
    if (event.rail === "guard") {
      // The recorder wraps the world rather than replacing it: what a check reached for is kept as
      // it was answered AT THAT INSTANT — the file's bytes then, the command's real exit code —
      // because re-deriving it tomorrow answers differently, and a recording that cannot reproduce
      // yesterday's block is not a recording.
      const tape = steps === null ? null : recorder(world);
      const outcome = await guard({
        load,
        event: {
          moment: event.moment,
          file: event.file,
          command: event.command,
          commands: event.commands,
          staged: event.staged,
          turn: event.turn,
          wearing: identity.wearing,
        },
        world: tape?.world ?? world,
        faults: identity.faults,
        off,
      });
      steps?.push({
        rail: "guard",
        moment: event.moment,
        ...(event.file === undefined ? {} : { file: event.file }),
        ...(event.command === undefined ? {} : { command: event.command }),
        ...(event.staged === undefined ? {} : { staged: event.staged }),
        ...(event.turn === undefined ? {} : { turn: event.turn }),
        wearing: identity.wearing,
        world: tape?.taken() ?? {},
      });
      for (const effect of outcome.effects)
        if (effect.do === "block")
          blocked.push({
            moment: event.moment,
            block: effect,
            ...(event.observed === true && event.file !== undefined ? { observed: event.file.path } : {}),
          });
      if (!off) rows.push(...runRows(event.moment, outcome, subjectCount(event)));
      continue;
    }

    // A REFUSED CALL CARRIES NO NOTES, and this is the one place it is kept from them: a note is not
    // judged for it, so `toResult` is handed none, and nothing is marked shown to stay silent until
    // drift. A blocked `cat` whose file is next read by the retried command then briefs on the
    // retry, which is the call that runs. A held TURN is the exception: its note is judged, and
    // `toResult` passes it to the agent with the refusal.
    if (blocked.length > 0 && !ridesRefusal(event.moment)) continue;
    steps?.push({
      rail: "brief",
      moment: event.moment,
      ...(event.path === undefined ? {} : { path: event.path }),
      ...(event.command === undefined ? {} : { command: event.command }),
      wearing: identity.wearing,
      tokens: session.tokens(),
    });
    const briefing = brief({
      load,
      event: {
        moment: event.moment,
        path: event.path,
        command: event.command,
        wearing: identity.wearing,
        tokens: session.tokens(),
      },
      marks,
      settings,
      off,
    });
    const notices: Notice[] = [];
    const unshown: string[] = [];
    for (const notice of briefing.notices) {
      const body = prose(session.root, notice);
      if (body.trim() === "") {
        // A note whose prose could not be resolved was never shown, so it must not be MARKED shown —
        // that would silence it for the rest of the session and hide the broken `file:` completely.
        if (notice.entry !== null) unshown.push(notice.entry);
        continue;
      }
      notices.push(notice);
      shown.push({ entry: notice.entry, cause: notice.cause, body });
    }
    marks = marksWithout(briefing.marks, marks, unshown);
    // A note that SHOWED is a row; a touch where nothing showed is not. The `tool` row already
    // records that the call happened, and a run row per touch with no tallies in it would double
    // the log to say the same thing twice.
    if (!off && notices.length > 0)
      rows.push(...runRows(event.moment, { effects: notices, tallies: [] } satisfies Outcome, 1));
  }

  if (!off && marks !== stored.marks) saveState(session.root, session.id, session.who.agent, { ...stored, marks });
  return { refused: blocked, shown };
}

/** The marks the briefing produced, with the notes that could not be shown put back as they were. */
function marksWithout(briefed: Marks, before: Marks, unshown: readonly string[]): Marks {
  if (unshown.length === 0) return briefed;
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(briefed)) if (!unshown.includes(id)) out[id] = at;
  for (const id of unshown) {
    const was = before[id];
    if (was !== undefined) out[id] = was;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMIT GATE — the moment no harness delivers
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A git question about the commit in progress, asked WITH git's hook variables — the one place flow
 * keeps them. Inside a pre-commit hook `GIT_INDEX_FILE` names the index being committed, and
 * `git commit -a` or `git commit <path>` stage into a temporary one, so without it git describes the
 * wrong index: an empty one, for both. A check's own commands stay hermetic (`runCommand`).
 */
function askGit(command: string, root: string): ExecResult {
  return runCommand(command, root, process.env);
}

/**
 * What the commit changes, asked of git ONCE, whoever called the gate — the files it will hold,
 * which of them are new, which are as the last commit has them (`--all` only), and which it removes.
 *
 * A git that cannot answer is a refusal, never an empty commit: a gate that read "nothing staged"
 * off a failed command would pass everything.
 */
function readChanges(
  root: string,
  scope: CommitScope,
): { readonly ok: true; readonly staged: StagedChanges } | { readonly ok: false; readonly why: string } {
  const ask = scope === "staged" ? "git diff --cached --name-status --no-renames -z" : "git ls-files --cached --others --exclude-standard -z";
  const listed = askGit(ask, root);
  if (listed.code !== 0)
    return { ok: false, why: `flow could not ask git what this commit changes (\`${ask}\` exited ${listed.code}): ${listed.stderr.trim()}` };
  if (scope === "staged") return { ok: true, staged: stagedChanges(listed.stdout) };
  // The whole tree: every file git can see that is on disk, measured against the last commit.
  const present = [...new Set(listed.stdout.split("\0"))].filter((path) => path !== "" && existsSync(inRepo(root, path)));
  const tree = askGit("git ls-tree -r --name-only -z HEAD", root);
  const differs = askGit("git diff --name-only --no-renames -z HEAD", root);
  return { ok: true, staged: treeChanges(present, tree, differs, () => askGit("git rev-parse -q --verify HEAD", root).code === 0) };
}

/**
 * Every `at(commit)` guardrail over the staged set — the half of the promise the PreToolUse rail
 * cannot make.
 *
 * It fires with no agent in the room: a human commit, a merge, CI. That is why it is a verb of the
 * binary rather than a hook, why it is in `DELIVERS` even though the harness supplies nothing here,
 * and why every harness gets the gates for free.
 *
 * WHO IT IS comes from the marker the PreToolUse rail left — session AND agent — so a commit's rows
 * land in the session that caused them and an actor-scoped rule fires at this moment as honestly as
 * at any other. The classification itself is never re-derived here: there is no transcript and no
 * hook message outside a session, so the STORED verdict is the only truthful answer, and a fresh commit
 * on a stale or absent marker wears nothing rather than wearing a guess.
 */
export async function runCommit(root: string, scope: CommitScope): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return ALLOW;
  if (isOff(root)) return ALLOW;
  // THE GATE USES THE ENGINE'S OWN FAULT, not `whileBroken` next door, and the difference is the
  // point rather than an oversight: `whileBroken` lets every call through, and the commit gate is
  // the one rail that stays shut. Everything written while flow was off reaches a commit only once
  // the config loads and every guardrail has checked it — so this rail refuses however the config
  // broke: the import fault here, and a load refusal through `guard()`'s own `!load.ok` branch below.
  if (regime.kind === "broken") return refused([{ moment: "commit", block: fault(regime.message) }]) ?? ALLOW;
  const changes = readChanges(root, scope);
  if (!changes.ok) return refused([{ moment: "commit", block: fault(changes.why) }]) ?? ALLOW;
  const { files, added, unchanged, deleted } = changes.staged;
  const { load } = regime;
  // Nothing to judge is a pass only for a config that loaded: one that did not refuses every commit,
  // empty or not, through `guard()`'s own `!load.ok` branch.
  if (load.ok && files.length === 0 && deleted.length === 0) return ALLOW;

  const { branch, session, who, wearing } = wearer(root);
  // The gate is where the expensive checks live — a suite, a type-check, a whole dependency
  // cruise — so it is also where a recording is worth the most: replaying a refused commit is the
  // one thing you cannot do by re-running it, because the working tree has moved on since.
  const tape = isRecording(root) ? recorder(realWorld(root)) : null;
  // A deleted file is no longer on disk, so what it held is read from the last commit — and only
  // for a deletion some rule will judge.
  const gone = judgedDeletions(load.ok ? load.entries : [], deleted).map((path) => ({
    path,
    content: askGit(`git show ${quoteArg(`HEAD:${path}`)}`, root).stdout,
  }));
  const outcome = await guard({
    load,
    event: { moment: "commit", staged: files, added, unchanged, deleted: gone, wearing },
    world: tape?.world ?? realWorld(root),
    off: false,
  });
  if (tape !== null)
    appendSteps(root, session, [
      {
        rail: "guard",
        moment: "commit",
        staged: files,
        ...(added === undefined ? {} : { added }),
        ...(unchanged.length === 0 ? {} : { unchanged }),
        ...(gone.length === 0 ? {} : { deleted: gone }),
        wearing,
        world: tape.taken(),
      },
    ]);
  appendRows({ root, session, branch, who: who ?? UNNAMED_COMMIT }, runRows("commit", outcome, files.length + gone.length));

  const blocks: Refused[] = outcome.effects
    .filter((effect): effect is Block => effect.do === "block")
    .map((block) => ({ moment: "commit", block }));
  return refused(blocks) ?? ALLOW;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STDIN — the first question of §7, and the one the old engine got wrong quietly
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** What came in on stdin: a payload, or which of the two ways reading it failed. */
export type PayloadRead =
  | { readonly ok: true; readonly payload: HookPayload }
  | { readonly ok: false; readonly why: "unreadable" | "unparseable"; readonly detail: string };

/** What `readStdin` sleeps on between tries: nothing ever wakes it, so each wait runs its full timeout. */
const NAP = new Int32Array(new SharedArrayBuffer(4));

/** How long one EAGAIN waits before the next try: the host's next write is usually milliseconds away. */
const STDIN_NAP_MS = 5;

/**
 * Every byte on fd 0, to the end of the stream.
 *
 * `readFileSync(0)` gives up the first time a NON-BLOCKING stdin is empty, with EAGAIN, and empty
 * there means "the host has not written the next piece yet", not "there is no more". A payload far
 * larger than a pipe's buffer arrives in pieces, so it is exactly the payload that read loses (#12).
 * This one waits for the next piece instead, and the thread SLEEPS between tries rather than
 * spinning. Every other error is thrown, for `readPayload` to report.
 */
function readStdin(): string {
  const pieces: Buffer[] = [];
  const piece = Buffer.alloc(64 * 1024);
  for (;;) {
    let got: number;
    try {
      got = readSync(0, piece, 0, piece.length, null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(NAP, 0, 0, STDIN_NAP_MS);
      continue;
    }
    if (got === 0) return Buffer.concat(pieces).toString("utf8");
    pieces.push(Buffer.from(piece.subarray(0, got)));
  }
}

/**
 * Read the payload, and REPORT which of three things happened.
 *
 * This used to return a payload and swallow every failure into `{}`, on the reasoning that every
 * hook answers safely from nothing. That is right for a hook handed nothing and wrong for one that
 * could not SEE what it was handed: a PreToolUse rail holding an empty payload has no tool call to
 * judge, so it allows — and the guard could not tell "there was nothing to guard" from "I could not
 * read what I was guarding", and let the tool call through either way.
 *
 * Throwing instead does NOT fix it, and that is the trap worth stating: the caller's outer catch
 * allows too. The read has to report, and each event has to answer in the way that suits it.
 */
export function readPayload(): PayloadRead {
  // HAND-RUN: a person typing `flow hook stop` has no payload and must not block on stdin forever.
  // Asked of fd 0 itself, never of `process.stdin`: merely reading that property opens a stream on
  // fd 0 and the stream makes it NON-BLOCKING (#12). `isatty(0)` leaves fd 0 blocking, so on an
  // ordinary pipe the read below never meets EAGAIN and its wait loop is not needed.
  if (isatty(0)) return { ok: true, payload: {} };
  let raw: string;
  try {
    raw = readStdin();
  } catch (error) {
    // The errno is the actionable half, and only the errno: a raw error string can carry a
    // stack-shaped prefix, and this text goes in front of the model.
    return { ok: false, why: "unreadable", detail: (error as NodeJS.ErrnoException).code ?? "unknown error" };
  }
  // GENUINELY EMPTY — the host sent nothing, or stdin was /dev/null. Safe, and the only one of the
  // three that keeps the old behaviour.
  if (raw.trim() === "") return { ok: true, payload: {} };
  let held: unknown;
  try {
    held = JSON.parse(raw);
  } catch {
    return { ok: false, why: "unparseable", detail: `${raw.length} bytes on stdin, and not JSON` };
  }
  if (!held || typeof held !== "object" || Array.isArray(held)) {
    const what = held === null ? "null" : Array.isArray(held) ? "an array" : typeof held;
    return { ok: false, why: "unparseable", detail: `JSON, but ${what} — a payload is an object` };
  }
  return { ok: true, payload: held as HookPayload };
}

/**
 * A hook, end to end: read stdin, run it, and answer the way THIS event must when the read failed.
 *
 * `pre-tool-use` is the rail that GUARDS, so it fails CLOSED — a payload it cannot read is a tool
 * call it cannot judge, and "I could not look" must never be spelled the same way as "I looked and
 * it was fine". The after-call rails JUDGE too — every change a call made reaches the rules there —
 * so a payload they cannot read is a call whose changes nobody judged, and they report it with exit
 * 2, which on those rails reaches the model beside the result and blocks nothing. The rest only add
 * a breadcrumb, and breaking a session over one would be the cure killing the patient, so they SPEAK
 * on stderr and allow. `readFault` next door is where that split is decided.
 *
 * Everything is wrapped: a hook that throws is a hook that wedges a session, and an unknown event
 * is silence rather than a usage message in front of the model.
 */
export async function hookEntry(event: string, cwd: string): Promise<HookResult> {
  try {
    if (!isHookEvent(event)) return ALLOW;
    const read = readPayload();
    if (!read.ok) {
      return readFault(event, read.why, read.detail);
    }
    return await runHook(event, read.payload, projectRoot(cwd));
  } catch (error) {
    // The guard broke in a way nothing above predicted. It is still not allowed to wedge the
    // session, so it says so and allows — the same answer the annotating rails give a fault.
    return { stdout: "", stderr: `[flow hook ${event}] the guard itself failed — ${(error as Error).message}\n`, exitCode: 0 };
  }
}

/**
 * The git gate, end to end — `flow hook commit`, or `flow hook commit --all` for the whole tree.
 *
 * It takes no file list: git is asked. `flow commit <files…>`, the name an older hook still calls,
 * arrives here with `legacy` set and its list is dropped, because git's answer is the only list — a
 * second source of the staged set is two answers that can disagree.
 */
export async function commitEntry(args: readonly string[], cwd: string, legacy = false): Promise<HookResult> {
  const scope = commitScope(args, legacy);
  if (scope === null)
    return {
      stdout: "",
      stderr: `flow hook commit takes no files — it asks git what the commit changes. Pass --all to judge the whole tree instead. Got: ${args.join(" ")}\n`,
      exitCode: 2,
    };
  return runCommit(resolve(cwd), scope);
}
