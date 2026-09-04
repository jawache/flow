// flow/pure/checks.ts — WHAT a rule asks, and the contract it asks it through.
//
// SCOPE, honestly: this phase builds the config grammar, and a grammar cannot type `.check(…)`
// without saying what a check IS. So the Ctx contract is stated here, as spec'd, and nothing
// implements it yet — the real exec/fs/git wiring is the adapter's (F4), and the core check
// library that fills this shape is F2's. What lands now is the shape both of them must fit.
//
// The contract is weaker than purity and is exactly what the system needs: a check reads the
// world ONLY through ctx, and speaks only through its verdict. Two properties follow, and they
// are the whole point —
//
//   Deterministic given ctx. No ambient imports: no node:fs, no child_process. The same ctx
//   answers always produce the same verdict, which is what lets `.test()` cases and
//   recorded-session replay drive any check, core or bespoke, with a stubbed ctx. It is
//   mechanically enforced here rather than promised: this file is in a pure home, and the repo's
//   own guard blocks the import.
//
//   No actions, only verdicts. A check never writes, deletes or blocks anything itself. Its fail
//   becomes a block effect; the engine assembles effects; the adapter performs them. The chain of
//   custody from judgement to action stays one-directional.

import type { Moment } from "./moments.ts";

/** What `ctx.exec` answers. A diagnostic command's whole result, as data. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** A check's answer. Never an action — the engine turns a fail into an effect. */
export type Verdict = { readonly ok: true } | { readonly ok: false; readonly detail?: string };

/**
 * Everything a check may know and everything it may do.
 *
 * The facts are already in memory when the check runs — a write rail sees the file as it WOULD be
 * written, disk untouched; a command rail sees the line about to run; the commit gate sees the
 * staged paths. That is what lets a repo's own check name the file at fault instead of
 * re-deriving the tree, and it makes the work scale with the change rather than with the repo.
 */
export interface Ctx {
  // ── WHAT HAPPENED — the event's facts. Plain data, already in memory. ──
  readonly moment: Moment;
  /** write/touch: the would-be file. */
  readonly file?: { readonly path: string; readonly content: string } | undefined;
  /** command: the line about to run. */
  readonly command?: string | undefined;
  /** commit: the staged paths. */
  readonly staged?: readonly string[] | undefined;

  // ── THE DOOR TO THE WORLD — capabilities, injected. The only way out. ──
  exec(cmd: string): Promise<ExecResult>;
  readonly fs: {
    read(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
  };
  readonly git: {
    diff(path?: string): Promise<string>;
    stagedFiles(): Promise<string[]>;
  };

  // ── THE ANSWER — a verdict, never an action. ──
  ok(): Verdict;
  /** `detail` rides under the sentence's message, saying which thing broke. */
  fail(detail?: string): Verdict;
}

/** A check: ctx in, a verdict out. Sync or async — the engine awaits either. */
export type Check = (ctx: Ctx) => Verdict | Promise<Verdict>;

/**
 * The two verdict constructors — INTERNAL to flow, and deliberately not part of its public surface.
 *
 * A check has exactly one way to answer and it is `ctx.ok()` / `ctx.fail(detail)`. That is the
 * spelling the fourteen core checks are written in, the spelling a repo's own check is written in,
 * and the only one flow/index.ts exports. These exist because something has to BUILD the ctx that
 * carries them — the canned one a `.test()` case runs through, and the live one the adapter makes
 * — and that is flow's own job, not a config author's. Exporting both would put two spellings of
 * one answer in front of every check writer, and half of them would pick the wrong one.
 */
export const verdict = {
  ok: (): Verdict => ({ ok: true }),
  fail: (detail?: string): Verdict => (detail === undefined ? { ok: false } : { ok: false, detail }),
};

/**
 * Declare a CONFIGURED check: a function that takes options and returns a check.
 *
 * It is an identity function and that is deliberate — there is no framework machinery here, only
 * JavaScript, and its whole job is to give `ctx` its type inside the closure so the body is
 * written against the contract with no annotation. The other two forms need nothing at all: an
 * inline check is a lambda in the sentence, and a named one is `export const x: Check = …`.
 */
export function defineCheck<Options, C extends Check>(factory: (options: Options) => C): (options: Options) => C {
  return factory;
}

// ── cases: a canned ctx, declared on the entry ───────────────────────────────
//
// The vocabulary is per moment — a command string for a command rail, a path/content pair for a
// write rail, a staged set for the commit gate — and F2 both fleshes it out and builds the runner
// that walks it. What matters at THIS phase is that the shape exists and that an entry without
// one does not load: the class of bug that shipped two dead import fences for four days is a rule
// whose block-case was never written, and it dies at authoring time or not at all.

/** One canned event, in the dialect its moment speaks. */
export type Case =
  | string
  | { readonly path: string; readonly content: string }
  | { readonly staged: readonly string[] };

/** The cases an entry carries: what must pass it, and what must be blocked by it. */
export interface Cases {
  readonly pass?: readonly Case[];
  readonly block?: readonly Case[];
}

/** Does this cases block prove anything? An entry whose answer is no does not load. */
export function hasCases(cases: Cases | undefined): boolean {
  if (!cases) return false;
  return (cases.pass?.length ?? 0) + (cases.block?.length ?? 0) > 0;
}
