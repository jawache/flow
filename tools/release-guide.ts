// flow/tools/release-guide.ts — the release's first question: does the version it is about to cut
// have its migration guide?
//
// `just release` runs this before anything else, for the reason the gate runs first:
// commit-and-tag-version has no rollback, and a refusal at its own commit leaves the version
// stamped and the changelog written with nothing committed. Asked here, a missing guide is a clean
// refusal naming the file to write. The house pack's `releaseHasMigrationGuide` asks again at the
// commit, so a release cut any other way is refused too.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { migrationGuide, nextVersion } from "./domain.ts";

const dry = spawnSync("npx", ["commit-and-tag-version", "--dry-run"], { encoding: "utf8" });
const version = nextVersion(`${dry.stdout}${dry.stderr}`);
const guide = version === null ? null : migrationGuide(version);

if (dry.status !== 0 || version === null || guide === null) {
  process.stderr.write(`release-guide: could not read the next version from a dry run (exit ${String(dry.status)}).\n${dry.stderr}`);
  process.exitCode = 1;
} else if (!existsSync(guide)) {
  process.stderr.write(
    `release-guide: ${version} has no migration guide. Write ${guide} before releasing — what a repo that uses flow must change to upgrade to ${version}, in the format .claude/skills/documentation/SKILL.md gives, linked from docs/user/migrations/index.md.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`release-guide: ${guide} is here.\n`);
}
