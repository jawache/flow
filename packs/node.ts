// flow/packs/node.ts — package.json discipline: reach for a maintained package, say why, pin it, move
// the lockfile with it.
//
// The dependencies breadcrumb's POLARITY is deliberate. It does not read as "adding a dependency is
// a risk"; it reads as "check whether it is already solved" — because the code we hand-roll to
// avoid a package has no users, no reviewers and no fixes coming, which is the larger risk most of
// the time.

import { breadcrumb, command, commit, commitReason, defineCheck, definePack, guardrail, touch, type Check } from "../index.ts";

// ── node: the lockfile moves with the dependency, not with the file ──────────

const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "yarn.lock"];

/**
 * The dependency names whose entry differs between two package.json texts.
 *
 * Unparseable JSON on either side names every dependency both sides mention: a file being reshaped
 * into something else is a change we cannot rule out. An empty string means the file did not exist
 * on that side.
 */
export function movedDependencies(beforeText: string, afterText: string): string[] {
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = beforeText.trim() === "" ? {} : (JSON.parse(beforeText) as Record<string, unknown>);
    after = afterText.trim() === "" ? {} : (JSON.parse(afterText) as Record<string, unknown>);
  } catch {
    return ["(package.json is not parseable JSON on one side of this commit)"];
  }
  const moved: string[] = [];
  for (const block of DEP_BLOCKS) {
    const a = (before[block] ?? {}) as Record<string, unknown>;
    const b = (after[block] ?? {}) as Record<string, unknown>;
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (a[name] !== b[name] && !moved.includes(name)) moved.push(name);
  }
  return moved;
}

/**
 * A dependency move and its lockfile land in the same commit.
 *
 * Keyed on the dependency BLOCKS, never on the file: a `repository.url` fix moves no lockfile, and
 * the file-keyed version of this rule blocked exactly that commit (2026-08-13). Knowing the domain
 * is what buys the message the generic rule could never write — it names what moved.
 */
const lockfileInStep = defineCheck(
  (_opts: Record<string, never>): Check =>
    async (ctx) => {
      const staged = ctx.staged ?? [];
      if (!staged.includes("package.json")) return ctx.ok();
      if (staged.some((f) => LOCKFILES.includes(f))) return ctx.ok();
      // `HEAD:` is the last committed version (empty = a brand-new package.json), `:` the staged one.
      const [head, index] = await Promise.all([ctx.exec("git show HEAD:package.json"), ctx.exec("git show :package.json")]);
      const moved = movedDependencies(head.code === 0 ? head.stdout : "", index.code === 0 ? index.stdout : "");
      if (moved.length === 0) return ctx.ok(); // a metadata edit — nothing for a lockfile to mirror
      return ctx.fail(`this commit moves ${moved.map((d) => `\`${d}\``).join(", ")} in package.json but stages no lockfile`);
    },
);

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
