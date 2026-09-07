// flow.config.ts — THIS REPO'S WHOLE GUARD, and the only file that turns anything on.
//
// A rule not reachable from here does not run. Nothing resolves at run time and nothing defaults:
// what you read below is exactly what fires.
//
//   flow status   what is bound, at which moments, and what is not wired yet
//   flow test     every rule's own cases, driven
//
// TWO VERBS AND THE WHOLE FILE IS THEM. `pack(x)` binds a pack and all its entries; `override(x.e)`
// speaks only what it changes, and everything it does not say comes from the pack. An override
// REPLACES the key it names — a narrowed `.on(…)` is the whole list, never a merge — because two
// merge semantics is two bugs, and the one that bites is the silent one.
//
// FLOW GUARDING FLOW, and the import lines are the whole of what that means. The ten packs come
// from `@jawache/flow/packs` and the grammar from `@jawache/flow` — bare specifiers, resolved
// through `node_modules/@jawache/flow`, which `flow init` linked back to this very checkout. This
// repo is therefore a CONSUMER of its own package, on exactly the path a stranger takes: nothing
// below reaches a source folder, and a door that stopped exporting a symbol breaks this file
// before it breaks anybody else's. One pack is written here, `guards/house.ts` — the project map,
// the internal layout, the one-way import fences, and the ratchet on this binary's verb surface.
//
// An unbound pack costs nothing, so binding is opt-in per pack and every one of the ten is named
// below on purpose.

import { defineConfig, override, pack } from "@jawache/flow";
import { docs, fcis, flow, git, justfile, node, secrets, tdd, typescript, work } from "@jawache/flow/packs";
import { house } from "./guards/house.ts";

// THIS REPO'S PURE HOME, stated once and used by every fcis rail and by the import fence.
//
// There is no `pure/` folder anywhere in this package: the layer folder IS the component and its
// `domain.ts` IS its whole pure core, plus `glob.ts`, the one shared file of the product. Named by
// SHAPE rather than by folder, so a pipeline layer added later is judged the day it exists rather
// than the day someone remembers this file.
//
// Handed to the packs that need it — `fcis` for its rails and its gates, `house` for the import
// fence's `pure` layer. Nobody restates it: a second copy is how the rails move and the fence does
// not, with both still reading as armed.
//
// `glob.ts` is spelled as the file is actually called. It used to carry a leading `**/` it did not
// want, because the depcruise dialect read an entry with no slash and no star as an NPM PACKAGE
// NAME — so the plain spelling compiled to a matcher for `node_modules/glob.ts` and the fence
// quietly stopped covering the one shared file of the product. The dialect now reads a dot with no
// slash as a root-relative path, so both readers agree on the plain name, and the fence covers that
// file rather than anything anywhere ending in it.
const PURE = ["**/domain.ts", "glob.ts"];

export default defineConfig([
  // ── the guard's own orientation and self-protection ──
  //
  // ONE PARAMETER: where this repo keeps the packs it writes itself, which is `guards/` and one
  // file, house.ts. Both of the pack's path-scoped entries take it — the nudge when you edit the
  // guard, and the refusal to delete it — so the folder is named here, once, and the pack never
  // knew the word. This is flow's own self-protection, bound in flow's own repo, which is the
  // shortest description of what this whole file is for.
  pack(flow, { packs: ["guards/**"] }),

  // ── git: commit headers, computed versions, nothing destroys uncommitted work ──
  //
  // ONE parameter, and `just release` is real here: it runs commit-and-tag-version, computes the
  // version from the conventional commits since the last tag, writes CHANGELOG.md, stamps
  // package.json and the lockfile, commits and tags. Nothing is pushed and nothing is published.
  pack(git, { release: "just release" }),

  // ── the justfile as tool catalogue ──
  // Nothing is exempt here, stated rather than defaulted — every recipe in the catalogue carries
  // its own `[doc("…")]`.
  pack(justfile, { exempt: [] }),
  override(justfile.toolsHome).disabled(
    "no tools/ folder here: the package IS the product, and its one operational script is esbuild.mjs, which the build recipe names directly",
  ),

  // ── package.json discipline ──
  pack(node),

  // ── secrets: bound for one entry, honestly ──
  //
  // `noSecretsInCommits` scans every staged file for live-key shapes and is worth having in a repo
  // that has never held a secret. The env machinery has nothing to watch here yet, so it is off by
  // NAME rather than sitting dead — which is the difference between an opt-out and a lie. The
  // three recipe names are this repo's own: `just/secrets.just` is included by the justfile, so
  // all three resolve even though there is nothing yet for them to decrypt.
  pack(secrets, { dx: "just dx", encrypt: "just env-encrypt", names: "just env-names" }),
  override(secrets.envEncrypted).disabled("no `.env*` in this repo — nothing to seal"),
  override(secrets.dxSeam).disabled("no env seam, because there is no env"),

  // ── TypeScript: strict stays on, the checker is never silenced ──
  //
  // The lint and the typecheck are BOTH commit gates. There is no eslint-disable comment anywhere
  // in this tree and no rule turned off in source: the per-rule overrides live in eslint.config.js,
  // each carrying the fact about THIS repo that earns it. Both gate recipes are this repo's own
  // spelling, handed over rather than assumed.
  pack(typescript, { typecheck: "just typecheck", lint: "just lint" }),

  // ── FCIS: pure decisions in a functional core, effects in the thin shells ──
  //
  // Every rail is re-scoped to this repo's one convention, because the pack's default set names a
  // `src/lib` tier this package does not have. An override REPLACES the list, so the scopes below
  // are the whole scope and not an addition to the pack's.
  //
  // `example` is one real pure file, and it is what two of the pack's own entries prove themselves
  // with — both narrow inside their check rather than through `.on(…)`, so a path the pack invented
  // would fall outside this repo's convention and fail its own case. `glob.ts` is the oldest pure
  // file here and the least likely to move.
  pack(fcis, { files: PURE, homes: PURE, coverage: "just test-coverage", example: "glob.ts" }),
  // Both already arrive disabled from the pack; they are named here so a reader of THIS file sees
  // the whole answer without opening the pack.
  override(fcis.noLogicInTypesOrIndex).disabled(
    "index.ts here is the package's PUBLIC DOOR — a re-export surface with an exact-list test, not a barrel that grew",
  ),
  override(fcis.strictLayout).disabled("no feature-folder tier here — this package is laid out by pipeline stage"),

  // ── tdd: test-first artefacts, and tests that test behaviour ──
  //
  // The generic sibling-test family lives in `fcis` and ONLY there — see the ruling at the top of
  // the tdd pack. This repo runs FCIS, so the three checks are scoped to its pure home and are
  // live; a second, unscoped, disabled copy would be three entries whose only job is to be
  // explained.
  pack(tdd, { run: "just test-commit" }),
  // The refusal fixtures are TypeScript that is WRONG on purpose: grammar.test.ts compiles them
  // under their own project and asserts the compiler refused each one, on the line the file marks.
  // Rules about this repo's test discipline must not judge files whose whole job is to be invalid.
  override(tdd.vitestIdioms.noEmptyTest).ignore("**/__fixtures__/**"),

  // ── docs: two audiences, two doors ──
  pack(docs),

  // ── work: the lifecycle's rungs ──
  //
  // This repo is built through the same supervised runs as the rest of the fleet, so the pack that
  // mechanises the ladder is bound whole. It is a plain consumer of the grammar's public door and
  // imports nothing from the work CLI it is about — which is what lets this package ship it at all.
  pack(work),

  // ── this repo's own terrain ──
  pack(house, { pure: PURE }),
]);
