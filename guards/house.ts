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
  execPasses,
  guardrail,
  session,
  touch,
  write,
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

/** The punctuation a finished line of prose ends on. Anything else is a sentence still going. */
const FINISHED = /[.:;!?)"—]$/;

/** A whole string literal, alone on its line — the shape every element of a prose array has. */
const ELEMENT = /^\s*"((?:[^"\\]|\\.)*)",?$/;

/**
 * Every line of a pack's PROSE that is a hand-wrapped continuation of the line above it, 1-based.
 *
 * The rule it enforces is one sentence — a string in `.text(…)` or `.message(…)` is never broken
 * across lines to fit an editor — and the reason is that nothing human reads it: the model gets one
 * string, and the wrap is invisible there and load-bearing nowhere. What it costs is real, and the
 * generated pack pages are where it shows: a paragraph arrives with newlines through the middle of
 * it, and a reader comparing two entries cannot tell a deliberate line break from a wrap.
 *
 * A CONTINUATION, precisely: the previous element did not finish (no closing punctuation) and this
 * one opens with a space or a lower-case letter. That pair is what separates a wrap from the two
 * shapes that legitimately indent — an aligned table and a bulleted list — where every line is a
 * complete unit of its own and the line above it ends on a full stop or a bracket. Both live in
 * the fcis pack today, and neither is a wrap.
 *
 * Only prose is read. A `.check(…)`'s option arrays are full of one-word strings on their own
 * lines — regexes, globs, command examples — and none of them is a sentence at all.
 */
export function handWrappedProse(text: string): number[] {
  const lines = text.split("\n");
  const wrapped: number[] = [];
  let inProse = false;
  let previous: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/\.(text|message)\(\s*$/.test(line)) {
      inProse = true;
      previous = null;
      continue;
    }
    if (!inProse) continue;
    if (/^\s*(\]|\))/.test(line)) {
      inProse = false;
      continue;
    }
    const element = ELEMENT.exec(line);
    if (element === null) {
      previous = null;
      continue;
    }
    const content = element[1] as string;
    if (previous !== null && !FINISHED.test(previous.trimEnd()) && /^(\s|[a-z])/.test(content)) wrapped.push(i + 1);
    previous = content;
  }
  return wrapped;
}

/** A breadcrumb entry opening: the key, and the verb that says which kind of entry it is. */
const BREADCRUMB_KEY = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*breadcrumb\(\)/;

/**
 * Every breadcrumb whose key carries no doc comment, as `{ name, line }` (1-based).
 *
 * A breadcrumb's text is INSTRUCTIONS — it tells an agent what to do and never explains itself —
 * so the only place its reason can live is a doc comment on its key, and that comment is what the
 * generated pack page prints under "Why it exists". Left empty, the page says "Not stated" and the
 * entry is one nobody can judge: the delete-it test — what goes wrong in a repo without this —
 * has no answer on the page or in the file.
 *
 * IMMEDIATELY ABOVE, and that strictness is the parser's rather than a preference: the page reads
 * these with the TypeScript compiler API, and a note wedged between the comment and the key is a
 * comment it may no longer attach to anything. Placement notes go above the doc comment.
 */
export function breadcrumbsWithoutWhy(text: string): { name: string; line: number }[] {
  const lines = text.split("\n");
  const bare: { name: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = BREADCRUMB_KEY.exec(lines[i] as string);
    if (opening === null) continue;
    if ((lines[i - 1] ?? "").trimEnd().endsWith("*/")) continue;
    bare.push({ name: opening[1] as string, line: i + 1 });
  }
  return bare;
}

/** The `version` a package.json names, or null when it names none or does not parse. */
function packageVersion(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const version = typeof parsed === "object" && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

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

/**
 * This repo's own terrain — the half of its guard that could never travel.
 *
 * The project map, the package's internal layout, the one-way import fences that ARE its
 * architecture, the ratchet on its own verb surface, and the two rules that keep the generated pack
 * pages honest. Everything a stranger's repo would recognise is bound from `@jawache/flow/packs`
 * instead; "house" is what a repo's own pack is called, and the line between it and a shipped pack
 * is a module boundary and nothing more.
 */
export const house = definePack("house", (repo: Terrain) => ({
  /**
   * Without it, every session in this repo starts by rediscovering what flow is, which of the two
   * doors it is behind, and which of the two suites answers the question it is about to ask.
   */
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
        "Docs are two audiences: `docs/user/` is markdown for people (the guidebook, the quick start, the config reference, one page per stock check, and one GENERATED page per shipped pack under `docs/user/packs/` — `just docs-packs` writes those from the packs themselves and the commit gate refuses one that has drifted), `docs/agent/` is archival context pulled on demand. `.work/` is the gitignored journal.",
        "PUBLISHED since 0.1.0 (2026-09-15): a guarded repo installs `npm i -D @jawache/flow` off npm, and `npm link` from this checkout is the dogfood loop for working ON flow and nothing else. `just release` computes a version from the commit headers and pushes and publishes nothing; `just release-check` is what must be green first, and `npm publish` stays a human's to type in a terminal.",
      ].join("\n"),
    ),

  /**
   * Without it, a file lands wherever the last repo the author worked in would have put it — a
   * `pure/` folder, a `core/` folder, a second shared module — and the pipeline's one-way shape
   * survives only as long as whoever knows it is in the room.
   */
  layout: breadcrumb()
    .at(touch)
    .on("language/**", "checks/**", "engine/**", "adapter/**", "packs/**", "tools/**")
    .description("How the package is laid out — the pipeline layers, one domain.ts each, and the one shared file.")
    .text(
      [
        "This package is laid out by PIPELINE STAGE, not by topic:",
        "· language/  the config grammar — sentences, packs, moments, categories, the Ctx contract, the load. What a config file and a pack import.",
        "· checks/    the stock checks, as typed functions over ctx.",
        "· engine/    matching, categories, effects, the state home.",
        "· adapter/   everything that knows Claude Code — payloads, transcripts, hooks.",
        "· packs/     the ten packs the package SHIPS, behind their own subpath export (`@jawache/flow/packs`). Not a pipeline stage: they are content written IN the grammar, which is why they sit beside the layers rather than in them. Each imports `../index.ts` — the public door — and nothing else in the package; nothing in the package imports them back.",
        "· tools/     the code behind a justfile recipe, and nothing that ships. `pack-pages.ts` renders one page per shipped pack into `docs/user/packs/`, and `--check` refuses a page that has drifted from its pack; `parse.ts` reads what a pack's source says that loading it cannot; `score-bash.ts` scores a Bash path extractor against the hand-labelled corpus in `__fixtures__/bash-corpus/`; `domain.ts` is the pure half all three decide through. tsconfig.build.json excludes the folder, and nothing in the package may import it — `e2e/` may, and does, for the example bindings every page and the machine test share.",
        "Each layer folder holds ONE `domain.ts` plus its `domain.test.ts`, and that file is the layer's whole pure home — there is no `pure/` folder anywhere here, and no `core/` folder either. Both were considered and ruled out: a folder of one-file-per-topic modules is what the old engine had, and it hid which checks were really the same check.",
        "`glob.ts` is the ONE shared file of the PRODUCT, at the package root, because exactly one thing is genuinely shared and one shared thing earns a name rather than a folder.",
        "`e2e/` is the END-TO-END suites and nothing else, and it is not a pipeline stage either: the three tests that spawn the built binary over a throwaway git repo (product · live · machine) plus `harness.ts`, the one road all three drive — the repo, the binary, the host's CLAUDE_CONFIG_DIR and PATH seams. It ships with nothing (tsconfig.build.json excludes the folder) and nothing in the package may import it. The fixture packs those suites write into a temp repo live in `__fixtures__/`. Every OTHER test file sits beside the code it is about and runs in milliseconds; these three take tens of seconds because they build and spawn.",
        "The pipeline runs ONE WAY — language → checks → engine → adapter. A layer may import backwards and never forwards; the fences are in the import-boundaries entry in guards/house.ts, and they are why a recorded session can replay with no harness at all.",
        "A domain file reaches the world ONLY through ctx: no node:fs, no child_process, no process.env. eslint says so on the line, import-boundaries says so at the commit.",
      ].join("\n"),
    ),

  /**
   * Without it, a pack is edited as source rather than as the page a stranger reads: the doc-comment
   * slots the page is built from go unfilled, prose gets wrapped to fit an editor, and the page that
   * the whole read depends on quietly becomes worth less than the file it came from.
   */
  packAuthoring: breadcrumb()
    .at(touch)
    .on("packs/**")
    .description("How a pack is written down — the doc-comment slots the pages are built from, and the no-wrapping rule.")
    .text(
      [
        "You are in a SHIPPED pack — content, written in the grammar, that a repo somewhere binds without ever opening this file. What a stranger reads is not this source: it is the generated page, `docs/user/packs/<pack>.md`, rendered by `just docs-packs` from the loaded pack plus the doc comments below. Regenerate it in the same commit; the gate refuses a page that has drifted.",
        "THREE DOC-COMMENT SLOTS, and they are the only prose on the page that does not come from the pack's own sentences:",
        "· On `definePack` — the pack's LEAD. One paragraph saying what the pack is for, in the words somebody who has never seen this repo needs.",
        "· On each member of the parameter interface — WHAT THE FACT IS, and why the pack cannot know it. A parameter with no doc comment is a page that asks a reader to supply something it never explains.",
        "· On each entry's key — WHY THE ENTRY EXISTS, under the delete-it test: what goes wrong in the repo without it. MANDATORY on a breadcrumb, whose text is instructions and never explains itself, and refused at the commit gate when it is missing; optional on a guardrail, whose refusal message usually carries its own reason, and worth writing when the message cannot say it.",
        "THREE NAMED BLOCKS, as JSDoc tags on that same `definePack` comment, each rendered as its own section on the page: `@install` (what to install before a rule here can pass), `@setup` (what has to exist in the repo — a file, a recipe, a script), `@adopt` (what happens on the first run, and what to fix first). A tag nobody uses renders nothing, and a tag outside the three is not read at all — instructions with no home are what a lead paragraph turns into otherwise.",
        "Everything else stays an ordinary `//` comment: placement notes, the history of a fix, an aside to whoever edits the line next. Those never reach the page, which is what keeps the page readable.",
        "PROSE STRINGS NEVER HAND-WRAP. A string in `.text(…)` or `.message(…)` is one line however long it is — only a model reads it, the wrap is invisible there, and on the page it arrives as a line break through the middle of a sentence. An aligned table or a bulleted list is not a wrap: every line is a complete unit and the line above it finishes. Doc comments are the other way round — a human reads those, so they wrap at the width the rest of the file uses.",
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
        scan: "{*.ts,language/**/*.ts,checks/**/*.ts,engine/**/*.ts,adapter/**/*.ts,packs/**/*.ts,guards/**/*.ts,tools/**/*.ts,e2e/**/*.ts}",
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
          // A star because the layer is EVERY `.ts` at the root, not because a bare name would be
          // misread — the dialect reads a dotted entry with no slash as a root-relative path now,
          // so `index.ts` would name that one file correctly. Here the whole level is wanted.
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
          // THE CODE BEHIND THE RECIPES, and a layer for the same reason `guards` is one: it is a
          // CONSUMER of the two public doors — it loads every shipped pack the way a config does —
          // and nothing in the package may reach back into it. Without the layer these files belong
          // to no layer at all, which is the hole the `root` entry above was added to close.
          tools: ["tools/**"],
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
          // THE TOOLS, both ways, and the outward half is the same claim the guard makes: the code
          // behind a recipe reads this package through the doors a stranger reads it through, so a
          // page it renders is a page rendered off the shipped surface rather than off our layers.
          { from: "tools", to: "language", why: "a tool that reached the grammar's own file would be rendering a pack from a layer path, and the page would stop being what a consumer sees" },
          { from: "tools", to: "checks", why: "the stock checks come through the public door here too — a second route to them is a second surface to keep working" },
          { from: "tools", to: "engine", why: "a tool asks what a config SAYS; matching, effects and the state home are what happens next, and none of it belongs in a page" },
          { from: "tools", to: "adapter", why: "nothing a recipe renders may depend on which harness is installed — the pages are the same in every repo that installs this package" },
          { from: "tools", to: "guards", why: "the pages document what the package SHIPS; this repo's own bindings are not part of that, and importing them would put our spelling on a fleet page" },
          // …and inward: nothing in the package imports a tool. It ships with nothing
          // (tsconfig.build.json excludes the folder), so an import would be a bundle reaching for
          // a file that is not in the tarball.
          { from: "language", to: "tools", why: "the grammar cannot depend on a script that reads it" },
          { from: "checks", to: "tools", why: "a check reads the world through ctx; a tool reads the disk directly, which is the opposite promise" },
          { from: "engine", to: "tools", why: "the engine runs a config; rendering documentation about one is nothing it does" },
          { from: "adapter", to: "tools", why: "the adapter is the shipped harness column, and tools/ is not in the package's files list at all" },
          { from: "packs", to: "tools", why: "a shipped pack that imported a local script would ship a file the tarball does not carry" },
          { from: "root", to: "tools", why: "index.ts IS the shipped surface — an import here would put a documentation generator into `@jawache/flow`" },
          { from: "guards", to: "tools", why: "a rule fires at a gated moment and must load in milliseconds; the page generator parses every pack with the TypeScript compiler, and the guard reaches it through a recipe instead" },
          { from: "tools", to: "e2e", why: "the end-to-end road builds temp repos and spawns binaries; a page generator needs none of it" },
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
      "Import crosses a fence the wrong way (see the named check). The pipeline runs ONE WAY — language → checks → engine → adapter; packs/ sits outside it, reaching index.ts only, with nothing reaching back; guards/ and tools/ are consumers of the two public doors and nothing in the package may import either; e2e/ is test-only and nothing may import it, the package root included; and a pure `domain.ts` reaches pure code and node:path, nothing else.",
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

  packPagesCurrent: guardrail()
    .at(commit)
    .description("The generated pack pages are regenerated in the same commit that changes a pack — drift is refused.")
    // `changed` narrows it to the commits that could possibly have moved a page: the packs
    // themselves, the generator, and the pages. Every other commit stands aside rather than
    // spawning a TypeScript parse of ten files to prove nothing changed.
    .check(execPasses({ run: "just docs-packs-check", changed: ["packs/**", "tools/**", "docs/user/packs/**"] }))
    .message(
      "A pack page has drifted from its pack. The pack is the source and the page is the print: run `just docs-packs` and stage what it rewrites. A page edited by hand is a claim nothing checks, which is the exact failure the pages exist to end.",
    )
    .test({
      pass: [
        // The commit that touches no pack: the gate stands aside without running anything.
        { staged: ["README.md"] },
        { staged: ["packs/docs.ts"], world: { exec: { "just docs-packs-check": { code: 0 } } } },
      ],
      block: [
        {
          staged: ["packs/docs.ts"],
          world: { exec: { "just docs-packs-check": { code: 1, stdout: "docs/user/packs/docs.md has drifted from its pack" } } },
        },
      ],
    }),

  // A release a guarded repo cannot follow is a release that strands it: the upgrade it has to make
  // lives only in commit bodies nobody there reads. The guide is the page an agent is pointed at.
  releaseHasMigrationGuide: guardrail()
    .at(commit)
    .on("package.json")
    .description("Every version package.json names has its migration guide at docs/user/migrations/<version>.md.")
    .check(async (ctx) => {
      const version = packageVersion(ctx.file?.content ?? "");
      // No readable version is another rule's question; this one is only about the guide.
      if (version === null) return ctx.ok();
      const guide = `docs/user/migrations/${version}.md`;
      return (await ctx.fs.exists(guide)) ? ctx.ok() : ctx.fail(`package.json is at ${version}, and ${guide} does not exist`);
    })
    .message(
      "This version has no migration guide. Write docs/user/migrations/<version>.md — what a repo that uses flow must change to upgrade to it, as numbered steps an agent can follow, in the format .claude/skills/documentation/SKILL.md gives — link it from docs/user/migrations/index.md, and stage it with this commit. `just release` asks the same before it writes anything.",
    )
    .test({
      pass: [
        { staged: ["package.json"], world: { fs: { "package.json": '{ "version": "0.2.2" }', "docs/user/migrations/0.2.2.md": "# Upgrade to 0.2.2" } } },
      ],
      block: [{ staged: ["package.json"], world: { fs: { "package.json": '{ "version": "0.2.2" }' } } }],
    }),

  breadcrumbSaysWhy: guardrail()
    .at(commit)
    .on("packs/**", "guards/**")
    .description("Every breadcrumb's key carries a doc comment saying why the entry exists — the page prints it, and nothing else can.")
    .check((ctx) => {
      const bare = breadcrumbsWithoutWhy(ctx.file?.content ?? "");
      return bare.length === 0 ? ctx.ok() : ctx.fail(bare.map((one) => `\`${one.name}\` (line ${one.line}) has no doc comment`).join("\n"));
    })
    .message(
      "A breadcrumb with no `why`. Its text is instructions and never explains itself, so a doc comment on the key — immediately above it — is the only place the reason can live, and it is what the pack page prints under \"Why it exists\". Write the delete-it test: what goes wrong in a repo without this entry. (A guardrail owes one only when its refusal message cannot carry the reason.)",
    )
    // THE COMMIT DIALECT, because the entry fires at the gate: a staged path, and the file's body
    // in the world beside it. The rule reads a whole file, and a commit is the moment a whole file
    // is finished being written.
    .test({
      pass: [
        {
          staged: ["packs/x.ts"],
          world: { fs: { "packs/x.ts": "  /** Without it, nobody knows which door they are behind. */\n  docs: breadcrumb()\n    .at(touch)\n" } },
        },
        // A guardrail owes nothing here: its message is the explanation.
        { staged: ["packs/x.ts"], world: { fs: { "packs/x.ts": "  docsShape: guardrail()\n    .at(commit)\n" } } },
      ],
      block: [
        { staged: ["packs/x.ts"], world: { fs: { "packs/x.ts": "  docs: breadcrumb()\n    .at(touch)\n" } } },
        // A `//` note is not a doc comment: the compiler API does not read it, so the page cannot
        // print it, and this is exactly the shape every pack carried before the convention.
        {
          staged: ["packs/x.ts"],
          world: { fs: { "packs/x.ts": "  // the two audiences, in one place\n  docs: breadcrumb()\n    .at(touch)\n" } },
        },
      ],
    }),

  proseNeverHandWrapped: guardrail()
    .at(write, commit)
    .on("packs/**", "guards/**")
    .description("A string in .text() or .message() is one line, however long — the wrap is invisible to the model and a break on the page.")
    // INLINE, because the rule is one function and the function is above. A configured check would
    // be a factory with no options, and a stock one cannot see the shape at all: the tell is not a
    // pattern on a line, it is a line's relationship to the line before it.
    .check((ctx) => {
      const wrapped = handWrappedProse(ctx.file?.content ?? "");
      return wrapped.length === 0
        ? ctx.ok()
        : ctx.fail(`line${wrapped.length === 1 ? "" : "s"} ${wrapped.join(", ")} continue${wrapped.length === 1 ? "s" : ""} the prose string above`);
    })
    .message(
      "Hand-wrapped prose. A string in `.text(…)` or `.message(…)` stays on ONE line however long it gets: only a model reads it, so the wrap buys no reader anything, and on the generated pack page it arrives as a line break through the middle of a sentence. Join the fragments into one string. (An aligned table or a bulleted list is fine — there every line is a complete unit and the line above it finishes.)",
    )
    .test({
      pass: [
        // A list whose lines each finish: indented, and not a wrap.
        {
          path: "packs/x.ts",
          content: '  .message(\n    [\n      "Effects to keep out of pure:",\n      "  clock   → new Date() (inject a `now`)",\n      "  random  → Math.random (inject an rng)",\n    ].join("\\n"),\n  )\n',
        },
        // A line that ends on a dash is finished, so the lowercase line after it is its own element.
        {
          path: "packs/x.ts",
          content: '  .message(\n    [\n      "Two doors —",\n      "user docs are HTML, agent docs are markdown.",\n    ].join("\\n"),\n  )\n',
        },
        // A `.check(…)`'s options are not prose: one-word strings on their own lines, with no
        // sentence anywhere near them.
        {
          path: "packs/x.ts",
          content: '  .check(\n    textBan({\n      ban: [\n        "sk_live_[0-9a-z]{16,}",\n        "ghp_[0-9A-Za-z]{30,}",\n      ],\n    }),\n  )\n',
        },
      ],
      block: [
        {
          path: "packs/x.ts",
          content: '  .text(\n    [\n      "One page, one job: the quick start",\n      "  teaches by doing; the guide solves situations.",\n    ].join("\\n"),\n  )\n',
        },
        // The lowercase tell on its own: no indent, the line simply carries the sentence on.
        {
          path: "packs/x.ts",
          content: '  .text(\n    [\n      "One page, one job: the quick start",\n      "teaches by doing; the guide solves situations.",\n    ].join("\\n"),\n  )\n',
        },
      ],
    }),
}));
