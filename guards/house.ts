// guards/house.ts — THIS REPO'S TERRAIN, and the only pack it writes itself.
//
// Everything else this repo's guard binds is a pack from `@jawache/flow/packs` — fleet discipline
// any repo would recognise, and here they are the very packs this package ships, bound the way a
// stranger binds them. What is left in this file is the half that could never travel: the project
// map, this package's internal layout, the one-way import fences that ARE its architecture, and
// one ratchet about its own verb surface. "House" is what a repo's own pack is called; the line
// between it and a shipped pack is a module boundary and nothing more.
//
// It imports `@jawache/flow` and `@jawache/flow/packs` — the two public doors — exactly as any
// other repo's guard does, never a layer path. That is deliberate: the doors are proved by a real
// consumer, and this one is the first to notice when either stops exporting something.

// EVERYTHING from the grammar door, and nothing from the packs door any more. Until F5 this file
// took one configured check from `@jawache/flow/packs` — a verb ratchet no shipped pack ever bound,
// which turned out to be `commitReason` with one condition missing. The condition is core now, so
// the house pack binds a stock check like every other entry here does.
import {
  breadcrumb,
  command,
  commit,
  commitReason,
  definePack,
  depcruise,
  guardrail,
  session,
  touch,
} from "@jawache/flow";

/**
 * HOW `flow.ts` REGISTERS A VERB, as a regex over a diff's ADDED lines — and it is ONE shape,
 * because that is how many shapes the file has: an `else if (verb === "x")` chain, top to bottom.
 *
 * IT WAS THREE, AND ALL THREE WERE WRONG. The list read `case "x":`, `command === "x"` and
 * `sub === "x"` — the work CLI's shapes, inherited wholesale when the ratchet was a shared check
 * with those spellings baked in. `flow.ts` contains not one `case` line and never has, so the entry
 * below could not fire on a real diff of the file it names. It loaded, it counted, `flow status`
 * showed it armed, and its own cases were green because they were written against synthetic lines
 * this file cannot produce. That is the exact failure flow exists to delete, sitting in flow's own
 * house pack, and it was equally dead before the parameter existed — making the shapes visible at
 * the binding is what let anyone see it.
 *
 * So the rule now is: the list is the surface's fact, not a fleet's. A shape this file does not
 * spell does not belong here, and the block case below is driven off a line `flow.ts` really has.
 */
const REGISTERS = ['verb\\s*===\\s*"([a-z][a-z-]*)"'];

/** What this repo calls pure. The import fence's `pure` layer is exactly this list. */
export interface Terrain {
  /**
   * Every pure HOME, as the fence names them — the same list `fcis` is given.
   *
   * A PARAMETER rather than a copy: stated twice, the day a pure home is added or renamed one of
   * the two is updated and the other quietly keeps fencing a shape nobody writes any more. The
   * rails would move and the fence would not, and both would still read as armed.
   */
  readonly pure: readonly string[];
}

export const house = definePack("house", (repo: Terrain) => ({
  orientation: breadcrumb()
    .at(session)
    .description("The project map — what flow is, where things live, how a change is proved.")
    .text(
      [
        "You are in `flow` — guardrails and breadcrumbs as code for coding agents. One npm package, `@jawache/flow`: the engine, the `flow` binary, and the ten packs it ships. A guarded repo's whole guard is one TypeScript file that imports from here.",
        "TWO DOORS, and never a layer path from outside either: `index.ts` is the GRAMMAR's (`@jawache/flow` — what a pack or a config is written in), and `packs/index.ts` is the CONTENT's (`@jawache/flow/packs` — the ten packs the package ships). Both are exact-list tested; adding or dropping an export is a deliberate edit, never drift.",
        "Layout is by PIPELINE STAGE, not by topic — `language → checks → engine → adapter`, one `domain.ts` per layer, fenced one way. See the layout breadcrumb, which fires on first touch of a layer folder.",
        "THE GUARD HERE IS flow ITSELF. `flow.config.ts` at the root binds the ten packs from `@jawache/flow/packs` — resolved through `node_modules/@jawache/flow`, a link back to this checkout — plus one pack written here, `guards/house.ts`. flow guarding flow is the dogfood: a door that stopped exporting, a rule that stopped loading or a bundle that stopped building refuses this repo's own next commit first. `flow status` answers whether the guard is working; `flow test` runs every bound rule's cases. flow's state is `.flow/` at the repo root, self-ignoring, never committed.",
        "Commands live in the justfile (`just` lists them) — `just build` · `just typecheck` · `just test` · `just link`. TWO suites answer two different questions and both are gates: `just test-rules` (`flow test`) proves the rules THIS repo binds, and `just test-packs` — the machine test — proves the ten the package SHIPS, in a throwaway repo that has never heard of flow. Tests are vitest; `just test-coverage` gates the pure home.",
        "Docs are two audiences: `docs/user/` is HTML for people (the guidebook, the quick start, the config reference, one page per stock check), `docs/agent/` is archival context pulled on demand. `.work/` is the gitignored journal.",
        "Nothing is published yet. `npm link` from this checkout is flow's whole distribution, `private: true` in package.json is the catch that stops an accident reaching the registry, and `just release` computes a version from the commit headers without pushing or publishing anything.",
      ].join("\n"),
    ),

  layout: breadcrumb()
    .at(touch)
    .on("language/**", "checks/**", "engine/**", "adapter/**", "packs/**")
    .description("How the package is laid out — the pipeline layers, one domain.ts each, and the one shared file.")
    .text(
      [
        "This package is laid out by PIPELINE STAGE, not by topic:",
        "· language/  the config grammar — sentences, packs, moments, categories, the Ctx",
        "  contract, the load. What a config file and a pack import.",
        "· checks/    the stock checks, as typed functions over ctx.",
        "· engine/    matching, categories, effects, the state home.",
        "· adapter/   everything that knows Claude Code — payloads, transcripts, hooks.",
        "· packs/     the ten packs the package SHIPS, behind their own subpath export",
        "  (`@jawache/flow/packs`). Not a pipeline stage: they are content written IN the grammar,",
        "  which is why they sit beside the layers rather than in them. Each imports `../index.ts`",
        "  — the public door — and nothing else in the package; nothing in the package imports",
        "  them back.",
        "Each layer folder holds ONE `domain.ts` plus its `domain.test.ts`, and that file is the",
        "layer's whole pure home — there is no `pure/` folder anywhere here, and no `core/` folder",
        "either. Both were considered and ruled out: a folder of one-file-per-topic modules is what",
        "the old engine had, and it hid which checks were really the same check.",
        "`glob.ts` is the ONE shared file of the PRODUCT, at the package root, because exactly one",
        "thing is genuinely shared and one shared thing earns a name rather than a folder.",
        "`e2e/` is the END-TO-END suites and nothing else, and it is not a pipeline stage either:",
        "the three tests that spawn the built binary over a throwaway git repo (product · live ·",
        "machine) plus `harness.ts`, the one road all three drive — the repo, the binary, the host's",
        "CLAUDE_CONFIG_DIR and PATH seams. It ships with nothing (tsconfig.build.json excludes the",
        "folder) and nothing in the package may import it. The fixture packs those suites write into",
        "a temp repo live in `__fixtures__/`. Every OTHER test file sits beside the code it is about",
        "and runs in milliseconds; these three take tens of seconds because they build and spawn.",
        "The pipeline runs ONE WAY — language → checks → engine → adapter. A layer may import",
        "backwards and never forwards; the fences are in the import-boundaries entry in",
        "guards/house.ts, and they are why a recorded session can replay with no harness at all.",
        "A domain file reaches the world ONLY through ctx: no node:fs, no child_process, no",
        "process.env. eslint says so on the line, import-boundaries says so at the commit.",
      ].join("\n"),
    ),

  // The fence config IS this repo's architecture, so it is local by design — the dialect comes
  // from the package, the boundaries are ours. See https://github.com/sverweij/dependency-cruiser.
  importBoundaries: guardrail()
    .at(commit)
    .description("Directed import fences over the real import graph — the pipeline runs one way, and the packs sit outside it.")
    .check(
      depcruise({
        // Named folder by folder rather than swept with `**`, so the cruise never walks
        // node_modules, dist/ or the deliberately-wrong fixtures. The leading `*.ts` is the
        // package root — index.ts, flow.ts, glob.ts, errors.ts, version.ts.
        scan: "{*.ts,language/**/*.ts,checks/**/*.ts,engine/**/*.ts,adapter/**/*.ts,packs/**/*.ts,guards/**/*.ts,e2e/**/*.ts}",
        layers: {
          // THE SAME LIST the fcis rails are scoped to, handed in once by the config. This package
          // keeps no pure folder and states its pure home as a filename per pipeline layer, plus
          // the one shared file.
          pure: repo.pure,
          // Glob-shaped on purpose: depcruise reports builtins stripped of `node:`, and the
          // dialect reads a bare name as an npm package — so "path*" is the one spelling that
          // matches the builtin.
          "node-path": ["path*", "node:path"],
          // A PARSER, and that is why it may sit in the pure allowlist. The `astGrep` check reaches
          // it with a dynamic `import()`, which depcruise sees as a real edge out of the pure home.
          // Spelled as a PATH glob, not as a bare name: the dialect reads a bare name as an npm
          // package and anchors it, which cannot work for a SCOPED package.
          "astgrep-lib": ["**/node_modules/@ast-grep/napi/**"],
          // THE PACKAGE ROOT — index.ts, flow.ts, glob.ts, errors.ts, version.ts and the three
          // test files beside them. A layer for ONE reason: without it these files belong to no
          // layer at all, so every `from:` rule below skips them and an import of `e2e/` from
          // `index.ts` — the public door, the file whose contents ARE the shipped surface — passed
          // the fence that says nothing may import e2e. A claim with a hole where the door is.
          //
          // Spelled with a star so the dialect reads it as a PATH rather than an npm package: a
          // layer entry with no slash and no star means `node_modules/<name>`, which is why
          // "index.ts" would have compiled to a matcher for a package called index.ts.
          root: ["*.ts"],
          language: ["language/**"],
          checks: ["checks/**"],
          engine: ["engine/**"],
          adapter: ["adapter/**"],
          // THE PACKS THE PACKAGE SHIPS, and they are NOT a pipeline stage — they are content
          // written in the grammar, so they sit outside the one-way run rather than at the end of
          // it. Their fence is the strictest here and it is two rules: a pack may reach the public
          // door and nothing else, and nothing may reach a pack.
          packs: ["packs/**"],
          // THIS REPO'S GUARD, as code. It is a CONSUMER of the public door and of nothing else —
          // the same fence a stranger's guard obeys from outside the package, which is what makes
          // this one worth having: it is the proof the door works from the outside.
          guards: ["guards/**"],
          // THE END-TO-END SUITES. Named as a layer for ONE reason and it is the inward half: no
          // file in this package may import e2e/. Outward it is deliberately unfenced — the whole
          // job of these three is to reach the product from outside, and two of them did exactly
          // that from inside `adapter/` and `packs/` until F5 moved them here, which is the fence
          // being asked for by the shape rather than imposed on it.
          e2e: ["e2e/**"],
        },
        only: {
          // The pure home reaches pure code, `node:path` and one parser, and nothing else. No
          // disk, no process, no clock — that is what makes a `.test()` case and a replay drive
          // the same code, and it is this package's one load-bearing invariant.
          pure: ["pure", "node-path", "astgrep-lib"],
        },
        except: ["type-only"],
        forbid: [
          // The pipeline runs one way: language → checks → engine → adapter. A layer may reach
          // BACKWARD (checks import the grammar's types; the engine imports both) and never
          // forward, so each stage below names every stage after it.
          { from: "language", to: "checks", why: "the grammar defines what a check IS; the moment it imports one, the sentence types depend on the library written in them" },
          { from: "language", to: "engine", why: "the grammar is what the engine reads — a config file's types cannot depend on the thing that will later run them" },
          { from: "language", to: "adapter", why: "flow.config.ts imports the grammar, so a grammar reaching the adapter would put Claude Code's hook payloads in every config author's type graph" },
          { from: "checks", to: "engine", why: "a check answers about one event and knows nothing of matching, scoping or effects — that coupling is what made the old engine's registry unreplayable" },
          { from: "checks", to: "adapter", why: "a check reads the world only through ctx; importing the adapter is how it would reach past ctx to the harness, and determinism-given-ctx is what replay stands on" },
          { from: "engine", to: "adapter", why: "the engine must not be able to tell which harness recorded an event — that is the seam a second harness fills and the reason a recorded session replays without one" },
          // THE PACKS, both ways. Outward first: a pack reaches `index.ts` and stops, which is the
          // same rule a guarded repo's own pack obeys from outside and the reason the door can be
          // trusted — a door only one kind of consumer has to use is not a door.
          { from: "packs", to: "language", why: "a pack writes sentences in the grammar; importing the grammar's own file would couple ten shipped opinions to a layer path that is free to move" },
          { from: "packs", to: "checks", why: "the stock checks come through the public door like every other symbol — a pack that reached the layer would be the first consumer allowed to, and the door would stop meaning anything" },
          { from: "packs", to: "engine", why: "a pack states rules; matching, scoping and effects are the engine's, and a pack that knew them could no longer be read as a list of claims" },
          { from: "packs", to: "adapter", why: "a pack must not be able to tell which harness is running it — that is what lets the same pack bind in a repo flow has never seen" },
          // And inward: NOTHING imports a pack. The packs are content, and content the machinery
          // depends on is machinery. This is what keeps every one of the ten removable, and what
          // makes an unbound pack genuinely cost nothing — a module nothing imported.
          { from: "language", to: "packs", why: "the grammar cannot know what has been written in it" },
          { from: "checks", to: "packs", why: "a check is a function a pack calls, never the other way round" },
          { from: "engine", to: "packs", why: "the engine runs whatever a config bound; a shipped pack it imported would be a rule nobody opted into" },
          { from: "adapter", to: "packs", why: "the harness layer must not depend on any pack — `flow init` writes a config that names one, and writing a name is not importing it" },
          // THE GUARD, both ways. It consumes the two public doors and nothing else in this tree;
          // and nothing in the package may import it, or one repo's bindings would become part of
          // what everybody installs.
          { from: "guards", to: "language", why: "this repo's guard is written against the published grammar, through `@jawache/flow` — reaching the layer would prove the door works only for people who do not use it" },
          { from: "guards", to: "checks", why: "a configured check comes through the public door, the way a stranger's config gets one" },
          { from: "guards", to: "engine", why: "a rule states a claim; running it is the engine's job, and a config that imported the runner could not be read as a list of claims" },
          { from: "guards", to: "adapter", why: "a rule must not be able to tell which harness is asking — that is what lets the same rule fire at a keystroke, at a commit and in a replay" },
          { from: "language", to: "guards", why: "the grammar cannot know what one repo bound in it" },
          { from: "checks", to: "guards", why: "a check is a function a config calls, never the other way round" },
          { from: "engine", to: "guards", why: "the engine reads whatever config it is pointed at; importing this one would make our bindings everyone's" },
          { from: "adapter", to: "guards", why: "the adapter loads a config by path at run time — importing one would bake this repo's guard into the shipped bundle" },
          { from: "packs", to: "guards", why: "a shipped pack that imported this repo's own pack would ship it to everybody who installs flow" },
          // NOTHING IMPORTS e2e/. It is test-only, it ships with nothing, and a product file that
          // reached into it would put a temp-repo builder and a binary spawner into the bundle.
          { from: "language", to: "e2e", why: "the grammar cannot depend on the suites that drive it" },
          { from: "checks", to: "e2e", why: "a check reads the world through ctx; the e2e road builds a real repo and spawns a real binary, which is the opposite of that" },
          { from: "engine", to: "e2e", why: "the engine is replayable with no repo and no harness — importing the thing that makes one would end that" },
          { from: "adapter", to: "e2e", why: "the adapter is the shipped harness column; the e2e road is a TEST harness and must never be mistaken for it" },
          { from: "packs", to: "e2e", why: "a shipped pack that imported a test road would ship it to everybody who installs flow" },
          { from: "guards", to: "e2e", why: "a rule loads at every gated moment; the e2e road builds temp repos and spawns binaries" },
          { from: "root", to: "e2e", why: "index.ts IS the shipped surface — an import here would put a temp-repo builder and a binary spawner into `@jawache/flow` itself" },
        ],
      }),
    )
    .message(
      "Import crosses a fence the wrong way (see the named check). The pipeline runs ONE WAY — language → checks → engine → adapter; packs/ sits outside it, reaching index.ts only, with nothing reaching back; guards/ is a consumer of the two public doors and nothing in the package may import it; e2e/ is test-only and nothing may import it, the package root included; and a pure `domain.ts` reaches pure code and node:path, nothing else.",
    )
    .test({
      pass: [{ staged: ["engine/domain.ts"], world: { exec: { depcruise: { stdout: '{"summary":{"violations":[]}}' } } } }],
      block: [
        {
          staged: ["engine/domain.ts"],
          world: {
            exec: {
              depcruise: {
                code: 1,
                stdout:
                  '{"summary":{"violations":[{"rule":{"name":"no-engine-to-adapter"},"from":"engine/domain.ts","to":"adapter/domain.ts"}]}}',
              },
            },
          },
        },
      ],
    }),

  newFlowCommandNeedsCaller: guardrail()
    .at(command)
    .description("A commit adding a verb to flow's dispatch surface must name its caller and why nothing existing serves.")
    // THE KNOWN SET IS ON THE BINDING, never inside the check: which verbs already exist is a
    // project's own fact, and a ratchet keyed off a stale list is the same silent failure it exists
    // to catch.
    //
    // `commitReason`'s THIRD condition, and the reason a check of its own died: the question is not
    // "did flow.ts change" — every commit here changes something, and a path condition would ask for
    // a sentence about all of them — but "what did this commit ADD inside it". Same commit
    // detection, same message parse, same token, same one-sentence refusal as the two path
    // conditions beside it.
    .check(
      commitReason({
        diffAdds: [
          {
            file: "flow.ts",
            patterns: REGISTERS,
            known: ["test", "hook", "commit", "init", "status", "replay", "facts"],
          },
        ],
        token: "caller",
      }),
    )
    .message(
      "Adding a verb to `flow.ts` must name its caller and why an existing verb's JSON output — or a few lines at the caller — can't serve. Put `caller: <skill|verifier|human> — <why>` on a line of its own in the commit message. Every question anyone asks a guard looks like a new verb, which is exactly why this ratchets.",
    )
    // EVERY DIFF LINE BELOW IS COPIED OFF flow.ts, and after this entry was found dead that is the
    // discipline rather than a nicety: a case written in a shape the named file cannot produce
    // proves the regex against itself and nothing else. What is here now is the else-if chain
    // exactly as that file spells it, including the one line that registers two verbs at once.
    .test({
      pass: [
        { command: 'git commit -m "feat: a thing"', world: { exec: { "diff HEAD -- 'flow.ts'": { stdout: "" } } } },
        // Verbs already ON the surface, moved in a refactor: known, so neither is new and neither
        // owes anything. The ratchet is about GROWTH, and a rule that fired on every dispatch tidy
        // would be turned off. Two on one line, because that is how this pair is really written.
        {
          command: 'git commit -m "refactor: move the dispatch"',
          world: { exec: { "diff HEAD -- 'flow.ts'": { stdout: '+} else if (verb === "init" || verb === "status") {' } } },
        },
        {
          command: "git commit -m 'feat: explain\n\ncaller: human — no verb says why one entry did not fire'",
          world: { exec: { "diff HEAD -- 'flow.ts'": { stdout: '+} else if (verb === "explain") {' } } },
        },
      ],
      block: [
        {
          command: 'git commit -m "feat: explain"',
          world: { exec: { "diff HEAD -- 'flow.ts'": { stdout: '+} else if (verb === "explain") {' } } },
        },
        // A new verb smuggled in beside a known one on the same line — the surface's own shape for
        // init/status, and what a reader that stopped at the first match on a line would miss.
        {
          command: 'git commit -m "feat: two at once"',
          world: { exec: { "diff HEAD -- 'flow.ts'": { stdout: '+} else if (verb === "status" || verb === "why") {' } } },
        },
      ],
    }),
}));
