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

import { breadcrumb, commit, command, definePack, guardrail, session, turnEnd } from "../index.ts";
import {
  astGrep,
  banCommands,
  canonicalFiles,
  changeTogether,
  commitMessage,
  commitReason,
  docLinks,
  depcruise,
  execPasses,
  jsonInvariant,
  protectedPath,
  ranSinceEdit,
  siblingExists,
  symbolsInSibling,
  textBan,
} from "../checks/domain.ts";

export const core = definePack("core", {
  orientation: breadcrumb().at(session).text("Every stock check is bound in this repo."),

  noTodo: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    .check(textBan({ ban: ["\\bTODO\\b"] }))
    .message("No TODOs — open a journal entry or do it now.")
    .test({ pass: [{ path: "src/a.ts", content: "done" }], block: [{ path: "src/a.ts", content: "// TODO" }] }),

  noForcePush: guardrail()
    .at(command)
    .check(banCommands({ ban: ["git push --force"] }))
    .message("Never force-push — the history is shared.")
    .test({ pass: ["git push origin feature/x"], block: ["git push --force origin main"] }),

  generatedIsProtected: guardrail()
    .at(commit)
    .check(protectedPath({ paths: ["src/generated/**"] }))
    .message("src/generated is written by the codegen — edit its source, not its output.")
    .test({ pass: [{ staged: ["src/a.ts"] }], block: [{ staged: ["src/generated/api.ts"] }, { staged: [], deleted: ["src/generated/api.ts"] }] }),

  migrationsAppendOnly: guardrail()
    .at(commit)
    .check(protectedPath({ paths: ["migrations/**"], existingOnly: true }))
    .message("A migration already applied is history — add a new one instead.")
    .test({
      pass: [{ staged: ["migrations/003.sql"], added: ["migrations/003.sql"] }],
      block: [{ staged: ["migrations/001.sql"], added: [] }],
    }),

  conventionalHeader: guardrail()
    .at(commit)
    .check(commitMessage({ header: "^(feat|fix|chore)(\\([a-z0-9-]+\\))?: .+" }))
    .message("The first line is `type(scope): description`.")
    .test({ pass: [{ message: "fix(parse): read a heredoc" }], block: [{ message: "wip" }] }),

  docLinksResolve: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    .check(docLinks({ pages: ["docs/**/*.md"] }))
    .message("This file cites a docs page or section that does not exist.")
    .test({
      pass: [{ path: "src/a.ts", content: "// docs/guide.md#start", world: { fs: { "docs/guide.md": "# Start\n" } } }],
      block: [{ path: "src/a.ts", content: "// docs/guide.md#end", world: { fs: { "docs/guide.md": "# Start\n" } } }],
    }),

  everyModuleIsTested: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(siblingExists({ sibling: "{path}.test.ts" }))
    .message("Every module carries a sibling test.")
    .test({
      pass: [{ path: "src/a.ts", content: "", world: { fs: { "src/a.test.ts": "" } } }],
      block: [{ path: "src/b.ts", content: "" }],
    }),

  everyExportIsTested: guardrail()
    .at(commit)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(symbolsInSibling({ sibling: "{dir}/{name}.test.ts" }))
    .message("An export nobody references in the test is an export nobody proved.")
    .test({
      pass: [{ path: "src/a.ts", content: "export const x = 1;", world: { fs: { "src/a.test.ts": "check(x)" } } }],
      block: [{ path: "src/a.ts", content: "export const y = 1;", world: { fs: { "src/a.test.ts": "nothing" } } }],
    }),

  scriptsAreComments: guardrail()
    .at(commit)
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
    .at(commit)
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
    .at(commit)
    .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
    .message("A dependency arrived with no reason recorded.")
    .test({
      pass: [
        { message: "feat: x\n\nnew-dep: zod — checked ajv", staged: ["package.json"] },
        { message: "feat: x", staged: ["src/a.ts"] },
      ],
      block: [{ message: "feat: x", staged: ["package.json"] }],
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
    .at(commit)
    .on("src/**/*.ts")
    .check(astGrep({ rule: { pattern: "$X ?? new Date($$$)" }, language: "tsx" }))
    .message("A fallback to `new Date()` hides a missing timestamp — pass the time in.")
    .test({
      pass: [{ path: "src/a.ts", content: "const at = row.createdAt;" }],
      block: [{ path: "src/a.ts", content: "const at = row.createdAt ?? new Date();" }],
    }),
});
