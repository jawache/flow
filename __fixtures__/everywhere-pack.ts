// A pack with two command rules, one marked `.everywhere()` and one not — the pair the
// "work outside the repository" journey in e2e/live.test.ts drives: a header rule that judges a
// commit only inside the repository, and a force-push rule that judges it wherever it runs.
//
// It is a fixture rather than the git pack's own rules so that journey stands on the grammar and
// not on a pack this repo keeps for itself. Its ids are the git pack's (`git.conventionalCommitFormat`,
// `git.noForcePush`), so the assertions read the same.
//
// The import below says `../index.ts` so this typechecks in place, with the rest of the fixtures.
// The suite repoints it as it writes the file into its temp repo — see `fixturePack` in
// e2e/harness.ts.

import { banCommands, command, commitMessage, definePack, guardrail } from "../index.ts";

export const git = definePack("git", {
  conventionalCommitFormat: guardrail()
    .at(command)
    .description("A commit header must be `type: description`.")
    .check((ctx) => {
      const message = commitMessage(ctx);
      return message === null || /^[a-z]+(\([^)]*\))?!?: \S/.test(message) ? ctx.ok() : ctx.fail("not a conventional header");
    })
    .message("Commit header must match Conventional Commits: type(scope): description.")
    .test({ pass: ['git commit -m "fix: a thing"', "git status"], block: ['git commit -m "bad"'] }),

  noForcePush: guardrail()
    .at(command)
    .everywhere()
    .description("Blocks a force-push, wherever it runs.")
    .check(banCommands({ ban: ["git push --force", "git push -f"] }))
    .message("A force-push rewrites history others already have.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
});
