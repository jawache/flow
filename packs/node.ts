// flow/packs/node.ts — package.json discipline: reach for a maintained package, say why, pin it, move
// the lockfile with it.
//
// The dependencies breadcrumb's POLARITY is deliberate. It does not read as "adding a dependency is
// a risk"; it reads as "check whether it is already solved" — because the code we hand-roll to
// avoid a package has no users, no reviewers and no fixes coming, which is the larger risk most of
// the time.

import { breadcrumb, command, commit, commitReason, definePack, guardrail, touch } from "../index.ts";
import { lockfileInStep } from "./checks.ts";

export const node = definePack("node", {
  dependencies: breadcrumb()
    .at(touch)
    .on("package.json", "package-lock.json", "pnpm-lock.yaml")
    .description("When to reach for a package, how to vet it, and what a commit that adds one owes.")
    .text(
      [
        "Before building it, check whether it's been solved: a maintained package that does the job beats hand-rolled code — ours has no users, no reviewers and no fixes coming.",
        "When you DO add one, vet it: is it alive — downloads, recent releases, active issues? Most-downloaded isn't the bar (a newer, trending package can be the right call); the red flag is a package nobody uses and nobody maintains — that is the supply-chain risk (OWASP A03).",
        "Adding a dependency is a decision that carries its reasoning: put `new-dep: <name> — <why, what else was checked>` on a line of its own in the commit message; the rule blocks a bare addition.",
        "Pin the version; the lockfile change ships in the SAME commit.",
      ].join("\n"),
    ),

  // The condition is the FILE, not the diff. A package.json commit that is only a version bump owes
  // a line too — a pin change is a supply-chain decision on the same grounds as an addition, and a
  // mechanism a reader can understand from the entry is worth that.
  newDependencyNeedsReason: guardrail()
    .at(command)
    .description("A commit that moves package.json must record why, and what else was checked.")
    .check(commitReason({ whenChanged: ["package.json"], token: "new-dep" }))
    .message(
      "This commit moves package.json with no reason recorded. A dependency is a supply-chain surface — put `new-dep: <name> — <why, and what else was checked>` on a line of its own in the commit message. Doing it is fine; doing it silently is not, and the verifier reads that line at the next phase boundary.",
    )
    .test({
      pass: [
        {
          command: "git commit -m 'feat: x\n\nnew-dep: zod — checked ajv'",
          world: {
            exec: {
              "git diff HEAD --name-only": { stdout: "package.json" },
              "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
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
              "git diff HEAD --name-only": { stdout: "package.json" },
              "git diff HEAD --name-only --diff-filter=A": { stdout: "" },
              "git ls-files --others --exclude-standard": { stdout: "" },
            },
          },
        },
      ],
    }),

  // Keyed on the dependency BLOCKS, not on the file: a repository.url fix moves no lockfile, and
  // the file-keyed version blocked exactly that commit (2026-08-13).
  lockfileInStep: guardrail()
    .at(commit)
    .description("A dependency move and the lockfile land in the same commit — deps stay exactly pinned.")
    .check(lockfileInStep({}))
    .message(
      "A dependency moved in package.json but no lockfile is staged. Run the install and stage the lockfile in the same commit — a lockfile one commit behind is a build that resolves differently on the next machine.",
    )
    .test({
      pass: [
        { staged: ["src/a.ts"] },
        {
          staged: ["package.json", "package-lock.json"],
          world: { exec: { "git show HEAD:package.json": { stdout: "{}" }, "git show :package.json": { stdout: "{}" } } },
        },
        {
          // A metadata-only edit: nothing for a lockfile to mirror.
          staged: ["package.json"],
          world: {
            exec: {
              "git show HEAD:package.json": { stdout: '{"name":"a","dependencies":{"zod":"1.0.0"}}' },
              "git show :package.json": { stdout: '{"name":"b","dependencies":{"zod":"1.0.0"}}' },
            },
          },
        },
      ],
      block: [
        {
          staged: ["package.json"],
          world: {
            exec: {
              "git show HEAD:package.json": { stdout: '{"dependencies":{"zod":"1.0.0"}}' },
              "git show :package.json": { stdout: '{"dependencies":{"zod":"2.0.0"}}' },
            },
          },
        },
        // Unparseable on one side. A package.json being reshaped into something else is a change
        // no comparison can rule out, so it blocks rather than waving through — the safe direction
        // for a rule about a lockfile going one commit stale.
        {
          staged: ["package.json"],
          world: {
            exec: {
              "git show HEAD:package.json": { stdout: '{"dependencies":{"zod":"1.0.0"}}' },
              "git show :package.json": { stdout: "{ not json at all" },
            },
          },
        },
      ],
    }),
});
