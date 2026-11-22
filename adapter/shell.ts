// flow/adapter/shell.ts — the SHELL EVERY HARNESS SHARES: the world a check reaches through, the config
// load, and the git gate.
//
// None of it is one harness's. A commit is git's, whoever ran the agent, and a check reaches the
// repo through the same `World` however the call arrived. What was decided is in domain.ts (the
// gate's questions, what a commit changes, how a refusal reads) and in the engine (`guard`); this
// file opens files, runs commands, asks git what it knows, and hands the answers over.
//
// THE LIVE SURFACE HERE, and a harness's own shell (adapter/<harness>/) adds its hooks to it:
//
//   realWorld(root)        the `World` a check reaches through: exec · fs · git
//   loadRegime(root)       what this repo's config amounts to: none, loaded or broken
//   runCommit(root, args) the git gate, handed what the commit changes and its message
//
// THE GUARD fails LOUD. A check that crashes or a bound command that is missing BLOCKS, carrying the
// reason; a config that will not load makes the gate refuse every commit until it loads. THE
// TELEMETRY fails SAFE and silent: a log that cannot be written is never the reason a commit is
// refused.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, type ExecOptions, type ExecResult, type FlowConfig, type LoadResult, type Grammar, type Settings, type World } from "../language/domain.ts";
import { fault, guard, recorder, runRows, UNNAMED_COMMIT, type AgentOf, type Block } from "../engine/domain.ts";
import { quoteArg, useGrammars } from "../checks/domain.ts";
import { appendRows, appendSteps, keepOutputs, commitAttribution, isOff, isRecording, loadState } from "../engine/state.ts";
import { ALLOW, CONFIG_FILE, branchFromHead, cleanMessage, commentLeader, commitArgs, configLoadFault, hermeticEnv, pathLines, readsCommitIndex, refused, stagedChanges, treeChanges, type CommitArgs, type CommitScope, type Refused, type StagedChanges } from "./domain.ts";
import type { HookResult, StoredTranscript, TranscriptRef } from "./harness.ts";


// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORLD — what a check reaches through, and the only place flow runs anything
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The repo a hook stands in: git's top folder for the folder Codex ran the hook in, or `flow test` the config in, which may be inside
 * the repo. The folder itself when git cannot say, which keeps a hook run outside any repository answering from
 * where it stands.
 */
export function projectRoot(cwd: string): string {
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, env: hermeticEnv(process.env), encoding: "utf8" });
  const top = asked.status === 0 ? asked.stdout.trim() : "";
  return top === "" ? cwd : top;
}

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
export function runCommand(command: string, root: string, env = hermeticEnv(process.env), onePipe = false): ExecResult {
  // One pipe is set up where bash starts: `exec 2>&1` joins stderr to stdout before the command runs,
  // so the kernel orders the writes. The command string `ctx.exec` was given is never touched.
  const result = spawnSync("bash", ["-lc", onePipe ? `exec 2>&1\n${command}` : command], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    // Git's hook variables would aim any nested `git` at the in-progress commit. See GIT_HOOK_ENV.
    env,
  });
  if (result.error) {
    const said = `flow could not run a command: ${result.error.message}`;
    return onePipe ? { stdout: "", stderr: "", output: said, code: 127 } : { stdout: "", stderr: said, code: 127 };
  }
  // `status` is null when a signal killed the process. That is a failure, and 1 says so — the one
  // code that must never be invented is 0.
  const code = result.status ?? 1;
  // One pipe has no split to give: everything printed is `output`.
  return onePipe ? { stdout: "", stderr: "", output: result.stdout, code } : { stdout: result.stdout, stderr: result.stderr, code };
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
export function realWorld(root: string, commitIndex?: string): World {
  return {
    // Hermetic, but for a read of what the commit holds, which is given the commit's own index.
    exec: (command: string, options?: ExecOptions): Promise<ExecResult> => {
      const hermetic = hermeticEnv(process.env);
      return Promise.resolve(
        runCommand(command, root, commitIndex !== undefined && readsCommitIndex(command) ? { ...hermetic, GIT_INDEX_FILE: commitIndex } : hermetic, options?.onePipe === true),
      );
    },
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
 * WHO LAST WORKED IN THIS WORKTREE, and what they were wearing — the marker a tool call leaves,
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
// THE COMMIT GATE — the moment no harness delivers
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A git question about the commit in progress, asked WITH git's hook variables — the one place flow
 * keeps them. Inside a commit-msg hook `GIT_INDEX_FILE` names the index being committed, and
 * `git commit -a` or `git commit <path>` stage into a temporary one, so without it git describes the
 * wrong index: an empty one, for both. A check's own commands stay hermetic (`runCommand`).
 */
function askGit(command: string, root: string): ExecResult {
  return runCommand(command, root, process.env);
}

/**
 * What the commit changes, asked of git ONCE, whoever called the gate — the files it will hold,
 * which of them are new, and which it removes.
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
  return { ok: true, staged: treeChanges(present, tree, () => askGit("git rev-parse -q --verify HEAD", root).code === 0) };
}

/**
 * The message git is recording, as git records it: read from the file git handed its commit-message
 * hook, with the comment lines and the scissors section removed. Null with no file, which is the
 * message of `--all` and of a hook an older flow wrote. A file that cannot be read is a refusal,
 * never an empty message: a gate that judged "no message" off a failed read would pass everything.
 */
function readMessage(root: string, file: string | null): { readonly ok: true; readonly message: string | null } | { readonly ok: false; readonly why: string } {
  if (file === null) return { ok: true, message: null };
  const raw = readText(root, file);
  if (raw === null) return { ok: false, why: `flow could not read the commit message git passed it, ${file}` };
  const leader = commentLeader(askGit("git config --get core.commentString || git config --get core.commentChar", root).stdout);
  // git sets GIT_EDITOR=: for the hook when no editor ran, and then the comments are the author's.
  return { ok: true, message: cleanMessage(raw, leader, process.env["GIT_EDITOR"] !== ":") };
}

/**
 * A repo with no config on disk passes every commit but one: the commit that deletes the config.
 *
 * No rule can refuse it, because the rules are in the file being deleted, so the gate refuses it
 * itself. The commit-msg hook only runs where flow was installed, so a deleted config here is
 * flow's own guard going, not a repo that never had one.
 */
function deletesConfig(root: string, scope: CommitScope): HookResult {
  if (scope !== "staged") return ALLOW;
  const changes = readChanges(root, scope);
  if (!changes.ok || !changes.staged.deleted.includes(CONFIG_FILE)) return ALLOW;
  return (
    refused([
      { moment: "commit", block: fault(`This commit deletes ${CONFIG_FILE}, which is this repo's guard. Turn a rule off in ${CONFIG_FILE} instead.`) },
    ]) ?? ALLOW
  );
}

/**
 * Every `at(commit)` guardrail over the staged set — the half of the promise the PreToolUse rail
 * cannot make.
 *
 * It fires with no agent in the room: a human commit, CI. That is why it is a verb of the
 * binary rather than a hook, why it is in `DELIVERS` even though the harness supplies nothing here,
 * and why every harness gets the gates for free.
 *
 * WHO IT IS comes from the marker the PreToolUse rail left — session AND agent — so a commit's rows
 * land in the session that caused them and an actor-scoped rule fires at this moment as honestly as
 * at any other. The classification itself is never re-derived here: there is no transcript and no
 * hook message outside a session, so the STORED verdict is the only truthful answer, and a fresh commit
 * on a stale or absent marker wears nothing rather than wearing a guess.
 */
export async function runCommit(root: string, { scope, messageFile }: CommitArgs): Promise<HookResult> {
  const regime = await loadRegime(root);
  if (regime.kind === "none") return deletesConfig(root, scope);
  if (isOff(root)) return ALLOW;
  // THE GATE USES THE ENGINE'S OWN FAULT, not `whileBroken` next door, and the difference is the
  // point rather than an oversight: `whileBroken` lets every call through, and the commit gate is
  // the one rail that stays shut. Everything written while flow was off reaches a commit only once
  // the config loads and every guardrail has checked it — so this rail refuses however the config
  // broke: the import fault here, and a load refusal through `guard()`'s own `!load.ok` branch below.
  if (regime.kind === "broken") return refused([{ moment: "commit", block: fault(regime.message) }]) ?? ALLOW;
  // A MERGE COMMIT passes: git has written MERGE_HEAD by the time it asks the hook. What a merge
  // brought in was judged, or not, on the branch it came from.
  if (messageFile !== null && askGit("git rev-parse -q --verify MERGE_HEAD", root).code === 0) return ALLOW;
  const changes = readChanges(root, scope);
  if (!changes.ok) return refused([{ moment: "commit", block: fault(changes.why) }]) ?? ALLOW;
  const { files, added, deleted } = changes.staged;
  const read = readMessage(root, messageFile);
  if (!read.ok) return refused([{ moment: "commit", block: fault(read.why) }]) ?? ALLOW;
  const { message } = read;
  const { load } = regime;
  // Nothing to judge is a pass only for a config that loaded: one that did not refuses every commit,
  // empty or not, through `guard()`'s own `!load.ok` branch. A message is something to judge: an
  // amend that only rewrites it, or `git commit --allow-empty`, stages nothing.
  if (load.ok && files.length === 0 && deleted.length === 0 && message === null) return ALLOW;

  const { branch, session, who, wearing } = wearer(root);
  // The gate is where the expensive checks live — a suite, a type-check, a whole dependency
  // cruise — so it is also where a recording is worth the most: replaying a refused commit is the
  // one thing you cannot do by re-running it, because the working tree has moved on since.
  const tape = isRecording(root) ? recorder(realWorld(root, process.env["GIT_INDEX_FILE"])) : null;
  const outcome = await guard({
    load,
    event: { moment: "commit", staged: files, added, deleted, message, wearing, ...(scope === "all" ? { whole: true } : {}) },
    world: tape?.world ?? realWorld(root, process.env["GIT_INDEX_FILE"]),
    off: false,
  });
  if (tape !== null)
    appendSteps(root, session, [
      {
        rail: "guard",
        moment: "commit",
        staged: files,
        ...(added === undefined ? {} : { added }),
        ...(deleted.length === 0 ? {} : { deleted }),
        ...(scope === "all" ? { whole: true } : {}),
        message,
        wearing,
        world: tape.taken(),
      },
    ]);
  appendRows({ root, session, branch, who: who ?? UNNAMED_COMMIT }, runRows("commit", outcome, files.length));

  const blocks: Refused[] = outcome.effects
    .filter((effect): effect is Block => effect.do === "block")
    .map((block) => ({ moment: "commit", block }));
  keepOutputs(root, blocks.map((b) => b.block));
  return refused(blocks) ?? ALLOW;
}

/**
 * The git gate, end to end — `flow hook commit <message file>`, which git's commit-message hook
 * runs, or `flow hook commit --all` for the whole tree, which has no commit and so no message.
 *
 * It takes no list of changed files: git is asked. `flow commit <files…>`, the name an older hook still calls,
 * arrives here with `legacy` set and its list is dropped, because git's answer is the only list — a
 * second source of the staged set is two answers that can disagree.
 */
export async function commitEntry(args: readonly string[], cwd: string, legacy = false): Promise<HookResult> {
  const read = commitArgs(args, legacy);
  if (read === null)
    return {
      stdout: "",
      stderr: `flow hook commit takes the file git holds the message in, and --all. It asks git what the commit changes, so it takes no list of files. Got: ${args.join(" ")}\n`,
      exitCode: 2,
    };
  return runCommit(resolve(cwd), read);
}

/**
 * A harness's transcript files as the store lists them: each ref with its file under `dir`, its size and
 * its modified time. A file that vanished between the listing and the stat is still named, with zeros.
 */
export function storedTranscripts(dir: string, refs: readonly TranscriptRef[]): StoredTranscript[] {
  return refs.map((ref) => {
    const file = join(dir, ref.path);
    let bytes = 0;
    let mtimeMs = 0;
    try {
      const stat = statSync(file);
      bytes = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      /* named all the same */
    }
    return { ref, file, bytes, mtimeMs };
  });
}
