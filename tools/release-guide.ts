// flow/tools/release-guide.ts — the release's first question: does the version it is about to cut
// have its migration guide?
//
// `just release` runs this before anything else, for the reason the gate runs first:
// commit-and-tag-version has no rollback, and a refusal at its own commit leaves the version
// stamped and the changelog written with nothing committed. Asked here, a missing guide is a clean
// refusal naming the file to write. The house pack's `releaseHasMigrationGuide` asks again at the
// commit, so a release cut any other way is refused too.

import { existsSync } from "node:fs";
import { nextGuide } from "./next-guide.ts";

try {
  const { version, guide } = nextGuide(process.cwd());
  if (!existsSync(guide)) {
    process.stderr.write(
      `release-guide: ${version} has no migration guide. Write ${guide} before releasing — what a repo that uses flow must change to upgrade to ${version}, in the format .claude/skills/release/migration-guide.md gives — linked from docs/user/migrations/index.md.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`release-guide: ${guide} is here.\n`);
  }
} catch (error) {
  process.stderr.write(`release-guide: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
