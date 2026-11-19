// A pack with two command rules, one marked `.everywhere()` and one not — the pair the
// "work outside the repository" journey in e2e/live.test.ts drives: a rule that judges a command
// only inside the repository, and a force-push rule that judges it wherever it runs.
//
// It is a fixture rather than the git pack's own rules so that journey stands on the grammar and
// not on a pack this repo keeps for itself. Its ids are the git pack's (`git.noHardReset`,
// `git.noForcePush`), so the assertions read the same.
//
// The import below says `../index.ts` so this typechecks in place, with the rest of the fixtures.
// The suite repoints it as it writes the file into its temp repo — see `fixturePack` in
// e2e/harness.ts.

import { banCommands, command, definePack, guardrail } from "../index.ts";

export const git = definePack("git", {
  noHardReset: guardrail()
    .at(command)
    .description("Blocks a hard reset in this repository.")
    .check(banCommands({ ban: ["git reset --hard"] }))
    .message("A hard reset throws away uncommitted work.")
    .test({ pass: ["git reset --soft HEAD~1"], block: ["git reset --hard HEAD~1"] }),

  noForcePush: guardrail()
    .at(command)
    .everywhere()
    .description("Blocks a force-push, wherever it runs.")
    .check(banCommands({ ban: ["git push --force", "git push -f"] }))
    .message("A force-push rewrites history others already have.")
    .test({ pass: ["git push origin main"], block: ["git push --force origin main"] }),
});
