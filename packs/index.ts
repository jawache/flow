// flow/packs/index.ts — the door of `@jawache/flow/packs`. Every pack the package ships, and the
// checks a repo needs to write a pack of its own.
//
// TWO DOORS, and they are different promises. `@jawache/flow` is the GRAMMAR — what a pack and a
// config are written in, and it changes only when the language does. This one is the CONTENT — ten
// opinionated packs, each a set of rules somebody has to agree with. A repo binds the ones it
// wants, one `pack(x)` line each, and an unbound pack costs nothing: it is a module nothing
// imported.
//
// The split is a subpath rather than one door because the two are read at different times. A
// config author imports the grammar once and never thinks about it again; the packs are what they
// come back to, add to and argue with. It also keeps the grammar's surface honest — a pack that
// could be reached through `@jawache/flow` would make every rule in it part of the language.
//
// The packs import `../index.ts` and nothing else in this package: never a layer path, and never
// the bare `@jawache/flow` specifier, because a package that resolves itself through its own
// node_modules is a package that breaks the moment it is linked. The fence in a guarded repo's
// house pack says so at that repo's commit gate; flow's own says so here.
//
// ASSERTED AS A LIST in index.test.ts, by the same discipline flow/index.ts follows: a re-export
// file has one way of going wrong and it is silent — a symbol that quietly stops being public,
// found by somebody else's install.

// ── the ten packs ────────────────────────────────────────────────────────────
//
// Eight of them are fleet discipline that any repo would recognise; `guard` is flow's own
// self-protection, and is the one every guarded repo wants whether or not it runs anything else;
// `work` is the work lifecycle's rungs, for the repos that run it.

export { docs } from "./docs.ts";
export { fcis, type Convention } from "./fcis.ts";
export { git, type Release } from "./git.ts";
export { guard, type Home } from "./guard.ts";
export { justfile, type Catalogue } from "./justfile.ts";
export { node } from "./node.ts";
export { secrets, type Seam } from "./secrets.ts";
export { tdd, type Suite } from "./tdd.ts";
export { typescript, type Gates } from "./typescript.ts";

// The work lifecycle's three rungs travel WITH the pack that binds them, because a category
// nothing names is never classified: they are exported beside it so a repo's own house pack can
// bind a rule to the same rung rather than defining a fourth name for it.
export { work, builder, checker, parent } from "./work.ts";

// ── the checks these packs are written in ────────────────────────────────────
//
// Configured checks, the same shape as the stock thirteen behind `@jawache/flow`, and public for
// one reason: a repo's own house pack binds them too.
//
// What is deliberately NOT here: the pure helpers each check is built from (`discardPaths`,
// `changesVersion`, `undocumentedRecipes`, …). Those are how a check is written, not what a repo
// binds, and a door that exported them would freeze the inside of every one of them.

export { conventionalCommit, noGitDiscard, noHandEditedVersion } from "./checks.ts";
export { justfileDocs } from "./checks.ts";
export { lockfileInStep } from "./checks.ts";
