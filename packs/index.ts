// flow/packs/index.ts — the door of `@jawache/flow/packs`: the one pack flow ships, `flow`.
//
// TWO DOORS, and they are different promises. `@jawache/flow` is the GRAMMAR — what a pack and a
// config are written in, and it changes only when the language does. This one is the CONTENT, and
// the content is one pack: flow's own self-protection, the one a guarded repo wants whether or not
// it runs anything else. Every other pack is a project's own rules, kept in that project, and
// shipped to nobody.
//
// The pack imports `../index.ts` and nothing else in this package: never a layer path, and never
// the bare `@jawache/flow` specifier, because a package that resolves itself through its own
// node_modules is a package that breaks the moment it is linked.
//
// ASSERTED AS A LIST in index.test.ts, by the same discipline index.ts follows: a re-export file
// has one way of going wrong and it is silent — a symbol that quietly stops being public, found by
// somebody else's install.

export { flow } from "./flow.ts";
