// A pack binding EVERY stock check, each with the cases that prove it — the fixture F2's proof
// runs over.
//
// It is written the way a real repo writes one, because that is the claim being tested: the same
// `definePack` shape, the same sentences, the same `.test()` blocks, and every check imported from
// flow/checks rather than addressed by a string. If a check cannot be bound and proved from here,
// it cannot be bound and proved anywhere.
//
// The cases are deliberately minimal — one pass and one block each — because their job in this
// fixture is to show the check is REACHABLE and ALIVE at its moment. The exhaustive behaviour is
// proved next door in flow/checks/domain.test.ts, where a failure names the branch rather than the
// entry.

import { breadcrumb, commit, command, definePack, guardrail, session, turnEnd, write } from "../index.ts";
import {
  astGrep,
  banCommands,
  canonicalFiles,
  changeTogether,
  commitReason,
  depcruise,
  execPasses,
  jsonInvariant,
  protectedPath,
  ranSinceEdit,
  siblingExists,
  symbolsInSibling,
  textBan,
} from "../checks/domain.ts";

/** The three git reads `commitReason` makes, answered as a real repo would answer them. */
const gitSaysPackageChanged = {
  exec: {
    "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
    "git diff HEAD --name-only": { stdout: "package.json" },
    "git ls-files --others --exclude-standard": { stdout: "" },
  },
};

export const core = definePack("core", {
  orientation: breadcrumb().at(session).text("Every stock check is bound in this repo."),

  noTodo: guardrail()
    .at(write, commit)
    .on("src/**/*.ts")
    .check(textBan({ ban: ["\\bTODO\\b"] }))
    .message("No TODOs — open a journal entry or do it now.")
    .test({ pass: [{ path: "src/a.ts", content: "done" }], block: [{ path: "src/a.ts", content: "// TODO" }] }),

  noForcePush: guardrail()
    .at(command)
    .check(banCommands({ ban: ["git\\s+push[^\\n]*--force"] }))
    .message("Never force-push — the history is shared.")
    .test({ pass: ["git push origin feature/x"], block: ["git push --force origin main"] }),

  generatedIsProtected: guardrail()
    .at(write)
    .on("src/generated/**")
    .check(protectedPath({}))
    .message("src/generated is written by the codegen — edit its source, not its output.")
    .test({ pass: [], block: [{ path: "src/generated/api.ts", content: "x" }] }),

  migrationsAppendOnly: guardrail()
    .at(write)
    .on("migrations/**")
    .check(protectedPath({ existingOnly: true }))
    .message("A migration already applied is history — add a new one instead.")
    .test({
      pass: [{ path: "migrations/003.sql", content: "-- new" }],
      block: [{ path: "migrations/001.sql", content: "-- edited", world: { fs: { "migrations/001.sql": "-- old" } } }],
    }),

  everyModuleIsTested: guardrail()
    .at(write)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(siblingExists({ sibling: "{path}.test.ts" }))
    .message("Every module carries a sibling test.")
    .test({
      pass: [{ path: "src/a.ts", content: "", world: { fs: { "src/a.test.ts": "" } } }],
      block: [{ path: "src/b.ts", content: "" }],
    }),

  everyExportIsTested: guardrail()
    .at(write)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(symbolsInSibling({ sibling: "{dir}/{name}.test.ts" }))
    .message("An export nobody references in the test is an export nobody proved.")
    .test({
      pass: [{ path: "src/a.ts", content: "export const x = 1;", world: { fs: { "src/a.test.ts": "check(x)" } } }],
      block: [{ path: "src/a.ts", content: "export const y = 1;", world: { fs: { "src/a.test.ts": "nothing" } } }],
    }),

  scriptsAreComments: guardrail()
    .at(write, commit)
    .on("package.json")
    .check(jsonInvariant({ assert: [{ path: "scripts", keysPrefixedWith: "//" }] }))
    .message("Commands live in the justfile — package.json scripts point at it and nothing else.")
    .test({
      pass: [{ path: "package.json", content: '{"scripts":{"//":"see the justfile"}}' }],
      block: [{ path: "package.json", content: '{"scripts":{"dev":"vite"}}' }],
    }),

  lockfileMovesWithDeps: guardrail()
    .at(commit)
    .check(changeTogether({ groups: [{ if: ["package.json"], thenAny: ["package-lock.json"] }] }))
    .message("A dependency change without its lockfile is a build nobody else can reproduce.")
    .test({
      pass: [{ staged: ["package.json", "package-lock.json"] }],
      block: [{ staged: ["package.json"] }],
    }),

  featureFoldersAreCanonical: guardrail()
    .at(write)
    .on("src/lib/**")
    .check(canonicalFiles({ root: "src/lib", allow: ["domain", "index"], thinking: "domain" }))
    .message("A feature folder holds domain.ts and index.ts — an invented name is somewhere to hide logic.")
    .test({
      pass: [{ path: "src/lib/cart/domain.ts", content: "" }],
      block: [{ path: "src/lib/cart/helpers.ts", content: "" }],
    }),

  testsPassAtCommit: guardrail()
    .at(commit)
    .check(execPasses({ run: "just test-commit" }))
    .message("The suite is red — the commit is refused.")
    .test({
      pass: [{ staged: ["src/a.ts"], world: { exec: { "just test-commit": { code: 0 } } } }],
      block: [
        {
          staged: ["src/a.ts"],
          world: { exec: { "just test-commit": { code: 1, stdout: "AssertionError: expected 1 to equal 2" } } },
        },
      ],
    }),

  ranTestsThisTurn: guardrail()
    .at(turnEnd)
    .check(ranSinceEdit({ edited: ["src/**"], mustRun: "just test" }))
    .message("You changed src/ this turn and never ran the suite afterwards.")
    .test({
      pass: [
        {
          actions: [
            { did: "edit", path: "src/a.ts" },
            { did: "run", command: "just test" },
          ],
        },
      ],
      block: [{ actions: [{ did: "edit", path: "src/a.ts" }] }],
    }),

  newDepNeedsReason: guardrail()
    .at(command)
    .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
    .message("A dependency arrived with no reason recorded.")
    .test({
      pass: [
        { command: "git commit -m 'feat: x\n\nnew-dep: zod — checked ajv'", world: gitSaysPackageChanged },
        { command: "git status", world: gitSaysPackageChanged },
      ],
      block: [{ command: 'git commit -m "feat: x"', world: gitSaysPackageChanged }],
    }),

  importFences: guardrail()
    .at(commit)
    .check(
      depcruise({
        scan: "src/**/*.ts",
        layers: { pure: ["src/pure/**"], fx: ["src/db/**"] },
        forbid: [{ from: "pure", to: "fx", why: "the functional core reaches no effects" }],
      }),
    )
    .message("An import crosses a fence the wrong way.")
    .test({
      pass: [{ staged: ["src/a.ts"], world: { exec: { depcruise: { stdout: '{"summary":{"violations":[]}}' } } } }],
      block: [
        {
          staged: ["src/a.ts"],
          world: {
            exec: {
              depcruise: {
                stdout:
                  '{"summary":{"violations":[{"rule":{"name":"no-pure-to-fx"},"from":"src/pure/a.ts","to":"src/db/b.ts"}]}}',
                code: 1,
              },
            },
          },
        },
      ],
    }),

  noBareDate: guardrail()
    .at(write)
    .on("src/**/*.ts")
    .check(astGrep({ rule: { pattern: "$X ?? new Date($$$)" }, language: "tsx" }))
    .message("A fallback to `new Date()` hides a missing timestamp — pass the time in.")
    .test({
      pass: [{ path: "src/a.ts", content: "const at = row.createdAt;" }],
      block: [{ path: "src/a.ts", content: "const at = row.createdAt ?? new Date();" }],
    }),
});
