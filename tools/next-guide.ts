// flow/tools/next-guide.ts — the next release's version and the path of its migration guide, read
// from a dry run of commit-and-tag-version. `release-guide.ts` and `release.ts` both ask it.

import { spawnSync } from "node:child_process";
import { migrationGuide, nextVersion } from "./domain.ts";

/** The version the next release would cut in `cwd`, and the guide it needs. Throws with the dry run's exit status and stderr when it cannot be read. */
export function nextGuide(cwd: string): { version: string; guide: string } {
  const dry = spawnSync("npx", ["commit-and-tag-version", "--dry-run"], { cwd, encoding: "utf8" });
  const version = nextVersion(`${dry.stdout}${dry.stderr}`);
  const guide = version === null ? null : migrationGuide(version);
  if (dry.status !== 0 || version === null || guide === null)
    throw new Error(`could not read the next version from a dry run (exit ${String(dry.status)}) in ${cwd}.\n${dry.stderr}`);
  return { version, guide };
}
