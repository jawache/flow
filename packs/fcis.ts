// flow/packs/fcis.ts — Functional Core, Imperative Shell.
//
// The convention used to be a private default inside each script (`**/pure/**` plus one platform's
// `src/lib` tier), which meant every repo that did not happen to use that layout bound eight rules
// watching directories it does not have — armed, counted, and matching nothing. That history stays
// a comment rather than joining the pack's doc comment, for the plainest of reasons: a glob with
// `**/` in it closes a block comment.
// Subtlety: fcis OWNS the sibling-test trio (hasTest · exportsTested · coverageGate) — tdd does not — and `Convention` is a mandatory typed parameter, so binding it without naming this repo's pure home does not compile.
//
// A parameter rather than eight `.on(…)` overrides, and the difference is the point: three of these
// rules narrow through their CHECK's options (`pureCovered`'s changed set, `newPureFileNeedsReason`'s
// added set) where an override cannot reach at all, so a repo stating its convention twice would be
// a repo whose rails and whose gates could silently disagree about what pure means.
//
// The import FENCE is not here and cannot be: its layers ARE a repo's architecture. What the pack
// ships is the half that is true everywhere (no shell IMPORTS in pure); the fence lives in the
// guarded repo's own house pack, where its layers are.

import {
  astGrep,
  breadcrumb,
  command,
  commit,
  commitReason,
  definePack,
  execPasses,
  guardrail,
  siblingExists,
  symbolsInSibling,
  touch,
  write,
} from "../index.ts";

/** Where a repo's pure code lives, and what proves it. Stated by the repo; nothing is defaulted. */
export interface Convention {
  /** Every pure FILE — what the rails judge, one glob per shape the repo actually uses. */
  readonly files: readonly string[];
  /** Every pure HOME — where the teaching breadcrumb fires, and what the coverage gate watches. */
  readonly homes: readonly string[];
  /** The recipe that runs the coverage gate. */
  readonly coverage: string;
  /**
   * ONE PURE FILE, spelled out — a path both `files` and `homes` match.
   *
   * `pureCovered` and `newPureFileNeedsReason` narrow inside their CHECK rather than through
   * `.on(…)`, so their cases have to name a concrete path, and a path the pack invented would fall
   * outside the repo's own convention and prove nothing. Asked for rather than computed: turning a
   * caller's glob into a concrete path is arithmetic that does not belong in a pack. A repo knows
   * one of its own pure files; nothing else does.
   */
  readonly example: string;

  /**
   * Where a pure file's test sits, as a template over the file's own path. Defaults to
   * `{dir}/{name}.test.ts`.
   *
   * `{dir}` is the file's folder and `{name}` its basename without the extension.
   * `pureHasTest` demands it exists and `pureExportsTested` reads it, so a repo whose tests live
   * in `__tests__/` or end in `.spec.ts` states that here rather than turning both rules off.
   */
  readonly sibling?: string;

  /**
   * What a new pure file may be without owing a reason: a test. Defaults to a glob matching any
   * file whose name carries `.test.`, at any depth.
   *
   * It is `newPureFileNeedsReason`'s exemption, and the `example` path with `.test` before its
   * extension is what proves it, so the two are read together.
   */
  readonly tests?: string;
}

/** The default exemption: a new pure file that is a test owes no reason. */
const TESTS = "**/*.test.*";

/** `example`, as a test file — the same path, matched by `TESTS`, still inside the repo's pure globs. */
const asTest = (file: string): string => file.replace(/(\.[^./]+)$/, ".test$1");

/**
 * Functional Core, Imperative Shell (Bernhardt, "Boundaries", SCNA 2012).
 *
 * The one-stop shop for running FCIS in a repo: the model, the rules that hold both sides honest,
 * the tests that prove the pure side, and the gate on growing it.
 *
 * EVERY RULE KEYS OFF ONE IDENTITY CONVENTION — the single way a repo names its pure code — and
 * the pack DEMANDS it rather than guessing: `Convention` is a mandatory typed parameter, so a repo
 * that binds this pack without saying where its pure code lives does not compile.
 *
 * The import FENCE is not here and cannot be: its layers ARE a repo's architecture. What the pack
 * ships is the half that is true everywhere (no shell IMPORTS in pure); the fence lives in the
 * guarded repo's own house pack, where its layers are.
 *
 * @setup A pure home the repo can name in globs, one real pure file to point at, and a coverage
 * recipe — all four parameters. The sibling-test trio reads them, so a repo that cannot say where
 * its pure code lives cannot bind this pack, by design.
 * @adopt Expect the coverage gate and the sibling-test rules to fire on the first commit that
 * touches pure code; both are scoped to the home you named, so the way to narrow them is to narrow
 * that, never to disable the rule.
 */
export const fcis = definePack("fcis", (repo: Convention) => {
  const sibling = repo.sibling ?? "{dir}/{name}.test.ts";
  const tests = repo.tests ?? TESTS;
  return {
    /**
     * Without it, the split is a rule with no model behind it: an agent moves a side effect out of a
     * pure file because a guardrail refused it, learns nothing, and puts the next one back.
     */
    fcis: breadcrumb()
      .at(touch)
      .on(...repo.homes)
      .description("The functional-core/imperative-shell mental model, for when you're working in pure-core code.")
      .text(
        [
          'Functional Core, Imperative Shell (Bernhardt, "Boundaries", SCNA 2012).',
          "Decisions live in pure functions, in this repo's declared pure home (see the fcis entries in flow.config.ts): no I/O, no clock, no randomness, no env — inject them as arguments; determinism IS testability.",
          "The shell is the wiring around the core — full of functions, but never of decisions: a branch that encodes a rule or a threshold belongs in pure, even if it is currently wrapped in an `await`. Values cross the boundary, never live objects.",
          "The shell is covered by integration tests, not unit tests.",
        ].join("\n"),
      ),

    // ── separate: the pure side, mechanically ──
    //
    // ast-grep patterns, structural rather than textual: a regex would match `new Date()` inside a
    // string or inside a comment talking ABOUT the ban, which is exactly the false positive that
    // teaches people to ignore a rule.
    noSideEffectsInPure: guardrail()
      .at(write, commit)
      .on(...repo.files)
      .ignore("**/*.test.ts")
      .description("Pure code performs no I/O and reads no clock, env or randomness — a structural match, not a regex.")
      .check(
        astGrep({
          language: "typescript",
          rule: {
            any: [
              { pattern: "Date.now()" },
              { pattern: "new Date()" },
              { pattern: "Math.random()" },
              { pattern: "crypto.randomUUID()" },
              { pattern: "crypto.getRandomValues($$$)" },
              { pattern: "fetch($$$)" },
              { pattern: "setTimeout($$$)" },
              { pattern: "setInterval($$$)" },
              { pattern: "process.env" },
              { pattern: "Bun.spawn($$$)" },
              { pattern: "Bun.file($$$)" },
            ],
          },
        }),
      )
      .message(
        [
          "Impurity in the functional core. Pure code takes no clock / randomness / I/O / process.env — inject them as arguments and keep the decision pure.",
          "  clock   → new Date() / Date.now()      (accept an injected `now`)",
          "  random  → Math.random / crypto         (accept an injected id/rng)",
          "  I/O     → fetch / timers / spawn       (do it in the shell)",
          "  env     → process.env                  (pass config in)",
          "Move the side effect to the shell and pass the pure input down.",
        ].join("\n"),
      )
      .test({
        // `new Date(iso)` is a pure parse of an injected value and passes; `new Date()` reads the
        // system clock and does not. That discrimination is the whole reason this parses.
        pass: [{ path: "cli/pure/a.ts", content: "export const at = (iso: string) => new Date(iso);" }],
        block: [{ path: "cli/pure/a.ts", content: "export const now = () => new Date();" }],
      }),

    noShellInPure: guardrail()
      .at(write, commit)
      .on(...repo.files)
      .ignore("**/*.test.ts")
      .description("Pure code imports no filesystem, process, socket or OS module — the leak the call-site rule cannot see.")
      .check(
        astGrep({
          language: "typescript",
          rule: {
            kind: "import_statement",
            has: {
              kind: "string",
              regex:
                "^[\"'](node:)?(fs|fs/promises|child_process|net|dns|tls|http|https|http2|os|cluster|worker_threads|readline|repl|v8|vm|zlib|dgram|inspector)[\"']$",
            },
          },
        }),
      )
      .message(
        [
          "A shell module imported into pure code. The functional core DECIDES; reaching for the filesystem, a process, a socket or the OS is the shell's job, and an import of one is a leak whatever the file then does with it.",
          "  fs · child_process · net · dns · http(s) · os · worker_threads · cluster",
          "Move the effect into the shell around this file and pass the values in. (`node:path` and `node:url` are string algebra and stay allowed, as does the test runner. Your own modules are fenced by the import-boundaries entry, per repo.)",
        ].join("\n"),
      )
      .test({
        pass: [{ path: "cli/pure/a.ts", content: 'import { join } from "node:path";' }],
        block: [{ path: "cli/pure/a.ts", content: 'import * as fs from "node:fs";' }],
      }),

    noThrowInPure: guardrail()
      .at(write, commit)
      .on(...repo.files)
      .ignore("**/*.test.ts")
      .description("Pure decisions return errors as values, never throw control flow.")
      .check(astGrep({ language: "typescript", rule: { any: [{ pattern: "throw $X" }, { pattern: "Promise.reject($$$)" }] } }))
      .message(
        "`throw` / Promise.reject in the functional core. Errors are VALUES here — return a Result / tagged union (ok/err) so the failure path shows in the signature and the caller must handle both arms. Adapt thrown errors to Results at the boundary, not inside pure code.",
      )
      .test({
        pass: [{ path: "cli/pure/a.ts", content: "export const f = () => ({ ok: false as const });" }],
        block: [{ path: "cli/pure/a.ts", content: 'export const f = () => { throw new Error("x"); };' }],
      }),

    // ── test: every pure file is proven ──
    pureHasTest: guardrail()
      .at(write, commit)
      .on(...repo.files)
      .ignore("**/*.test.ts")
      .description("A pure file has its sibling test — the test-first artefact exists.")
      .check(siblingExists({ sibling }))
      .message("The pure core is test-first (red → green): {dir}/{name}.test.ts is missing. Write the failing test, then the code.")
      .test({
        pass: [{ path: "cli/pure/a.ts", content: "", world: { fs: { "cli/pure/a.test.ts": "" } } }],
        block: [{ path: "cli/pure/b.ts", content: "" }],
      }),

    pureExportsTested: guardrail()
      .at(write, commit)
      .on(...repo.files)
      .ignore("**/*.test.ts")
      .description("Every exported pure function is at least referenced in its test — the 'wrote no test' nudge.")
      .check(symbolsInSibling({ sibling }))
      .message(
        "An exported pure function is never referenced in its test. Cheap nudge, not coverage — but 'added a function, wrote no test' is exactly the miss it catches.",
      )
      .test({
        pass: [{ path: "cli/pure/a.ts", content: "export const x = 1;", world: { fs: { "cli/pure/a.test.ts": "expect(x)" } } }],
        block: [{ path: "cli/pure/a.ts", content: "export const y = 1;", world: { fs: { "cli/pure/a.test.ts": "nothing" } } }],
      }),

    pureCovered: guardrail()
      .at(commit)
      .description("Blocks a commit if the pure core's coverage gate fails — only runs when pure files changed.")
      .check(execPasses({ changed: repo.homes, run: repo.coverage }))
      .message(
        "Coverage of the pure core fell below the bar — add tests for the new and changed code. (Runs only when pure files changed.)",
      )
      .test({
        // Nothing pure changed: the gate does not run at all, and a red suite is not this rule's
        // business. That is the `changed` narrowing, and it is what the pass case proves.
        pass: [{ staged: ["README.md"], world: { exec: { [repo.coverage]: { code: 1 } } } }],
        // THE REPO'S OWN PURE FILE, because the narrowing this case exists to prove is the check's
        // own: a path from any other repo falls outside `changed`, is passed correctly, and fails
        // the case.
        block: [{ staged: [repo.example], world: { exec: { [repo.coverage]: { code: 1, stdout: "ERROR: Coverage 91% < 95%" } } } }],
      }),

    // ── the strict-layout family: for repos that name their files by role ──
    //
    // ── comply: growing the pure set costs a sentence ──
    //
    // A new test sibling is expected, never sprawl, so it is exempt — the one thing the old script
    // hard-coded that is visible here.
    newPureFileNeedsReason: guardrail()
      .at(command)
      .description("A commit adding a non-test file to the pure core must say why the pure file it belongs in isn't the place.")
      .check(
        commitReason({
          whenAdded: repo.files,
          except: [tests],
          token: "new-pure-file",
        }),
      )
      .message(
        "Adding a file to the pure core must say why the pure file it belongs in isn't the place — put `new-pure-file: <why not the existing file>` on a line of its own in the commit message. The verifier reads that reason at the next phase boundary.",
      )
      // THE REPO'S OWN PURE FILE in all three, for the same reason `pureCovered`'s block case takes
      // it: `whenAdded` is the check's own narrowing, so a path from somebody else's tree is simply
      // not an added pure file and every one of these cases would prove the opposite of what it says.
      // The exempt one is that same path under `TESTS`, the exemption's own glob.
      .test({
        pass: [
          {
            command: "git commit -m 'feat: x\n\nnew-pure-file: a whole new tier'",
            world: {
              exec: {
                "git diff HEAD --name-only": { stdout: repo.example },
                "git diff HEAD --name-only --diff-filter=A": { stdout: repo.example },
                "git ls-files --others --exclude-standard": { stdout: "" },
              },
            },
          },
          {
            // A new TEST is expected, never sprawl — and the exemption is what this proves, so the
            // path has to be BOTH a pure file and a test.
            command: 'git commit -m "test: cover it"',
            world: {
              exec: {
                "git diff HEAD --name-only": { stdout: asTest(repo.example) },
                "git diff HEAD --name-only --diff-filter=A": { stdout: asTest(repo.example) },
                "git ls-files --others --exclude-standard": { stdout: "" },
              },
            },
          },
        ],
        block: [
          {
            command: 'git commit -m "feat: x"',
            world: {
              exec: {
                "git diff HEAD --name-only": { stdout: repo.example },
                "git diff HEAD --name-only --diff-filter=A": { stdout: repo.example },
                "git ls-files --others --exclude-standard": { stdout: "" },
              },
            },
          },
        ],
      }),
  };
});
