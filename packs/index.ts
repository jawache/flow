// flow/packs/index.ts — the door of `@jawache/flow/packs`. Every pack the package ships, and the
// three rungs the work lifecycle's entries are scoped to. Content, and nothing but content.
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
// Eight of them are fleet discipline that any repo would recognise; `flow` is flow's own
// self-protection, and is the one every guarded repo wants whether or not it runs anything else;
// `work` is the work lifecycle's rungs, for the repos that run it.

export { docs } from "./docs.ts";
export { fcis, type Convention } from "./fcis.ts";
export { flow, type Home } from "./flow.ts";
export { git, type Release } from "./git.ts";
export { justfile, type Catalogue } from "./justfile.ts";
export { node } from "./node.ts";
export { secrets, type Seam } from "./secrets.ts";
export { tdd, type Suite } from "./tdd.ts";
export { typescript, type Gates } from "./typescript.ts";

// The work lifecycle's three rungs travel WITH the pack that binds them, because a category
// nothing names is never classified: they are exported beside it so a repo's own house pack can
// bind a rule to the same rung rather than defining a fourth name for it.
export { work, builder, checker, parent } from "./work.ts";

// ── and nothing else ────────────────────────────────────────────────────────
//
// THE DOOR IS THE PACKS AND THE RUNGS, and that is the whole list. It used to carry five configured
// checks as well, from a `checks.ts` beside the packs, and the fold that deleted that file is what
// makes this comment worth writing: not one of the five was ever bound outside the pack it was
// written for. They read as a library and were a bag — five sections about git, the justfile, node
// and the work platform in one module, held together by nothing but having been extracted at the
// same time.
//
// Each now lives in its own pack file, private to it, with its pure helpers unit-tested beside it.
// A check that TWO packs share is a different thing and has a different home: it goes to core,
// behind `@jawache/flow`, which is where `substitutionInProse` went the same day.
//
// So a repo writing its own house pack imports the grammar and the stock checks from
// `@jawache/flow`, and from HERE it imports content: a pack to bind, or a rung to scope an entry
// of its own to.
