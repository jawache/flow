import { type ExecResult, type FlowConfig, type LoadResult, type Grammar, type Settings, type World } from "../language/domain.ts";
import { type AgentOf } from "../engine/domain.ts";
import { type CommitArgs } from "./domain.ts";
import type { HookResult, StoredTranscript, TranscriptRef } from "./harness.ts";
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
export declare function runCommand(command: string, root: string, env?: Record<string, string | undefined>): ExecResult;
/** A file's text, or null when it is not there / not readable. */
export declare function readText(root: string, path: string): string | null;
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
export declare function realWorld(root: string, commitIndex?: string): World;
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
export declare function currentBranch(root: string): string | null;
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
export declare function wearer(root: string): {
    readonly branch: string | null;
    readonly session: string;
    readonly who: AgentOf | null;
    readonly wearing: readonly string[];
};
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
export type Regime = {
    readonly kind: "none";
} | {
    readonly kind: "loaded";
    readonly config: FlowConfig;
    readonly load: LoadResult;
} | {
    readonly kind: "broken";
    readonly message: string;
};
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
export declare function grammarsAt(settings: Settings, root: string): readonly Grammar[];
export declare function registerGrammars(settings: Settings, root: string): void;
export declare function loadRegime(root: string): Promise<Regime>;
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
export declare function runCommit(root: string, { scope, messageFile }: CommitArgs): Promise<HookResult>;
/**
 * The git gate, end to end — `flow hook commit <message file>`, which git's commit-message hook
 * runs, or `flow hook commit --all` for the whole tree, which has no commit and so no message.
 *
 * It takes no list of changed files: git is asked. `flow commit <files…>`, the name an older hook still calls,
 * arrives here with `legacy` set and its list is dropped, because git's answer is the only list — a
 * second source of the staged set is two answers that can disagree.
 */
export declare function commitEntry(args: readonly string[], cwd: string, legacy?: boolean): Promise<HookResult>;
/**
 * A harness's transcript files as the store lists them: each ref with its file under `dir`, its size and
 * its modified time. A file that vanished between the listing and the stat is still named, with zeros.
 */
export declare function storedTranscripts(dir: string, refs: readonly TranscriptRef[]): StoredTranscript[];
