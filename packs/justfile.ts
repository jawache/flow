// flow/packs/justfile.ts — the justfile is the repo's TOOL CATALOGUE.
// Subtlety: which recipes are genuinely undocumentable is the one fact this pack cannot know, so `exempt` is a mandatory parameter — this repo binds `{ exempt: [] }` in flow.config.ts, stated rather than defaulted.
//
// The frame: the justfile plays the role MCP tools play elsewhere — the discovery surface an agent
// can reach for with confidence. `just --list` is the manifest and each `[doc]` string is a tool
// description. Every entry here is the same arrow pointing at it: the orientation says look here
// first, `node/noPackageScripts` closes the decoy surface agents habitually read, and `justfileDocs`
// keeps the manifest readable.

import { breadcrumb, commit, definePack, guardrail, jsonInvariant, session, touch, write } from "../index.ts";
import { justfileDocs } from "./checks.ts";

/** The one fact this pack cannot know: which recipes are genuinely undocumentable here. */
export interface Catalogue {
  /**
   * Recipe names that owe no `[doc("…")]`. Usually empty, and MANDATORY so that it is empty on
   * the record rather than by default — an exemption list nobody stated is one nobody reviews.
   *
   * A parameter rather than an override, because `exempt` is the CHECK's option and an override
   * speaks only the sentence keys (at · for · on · ignore · message · disabled). It was written
   * as an unreachable `with:` at the crossing and could never have been set by any repo.
   *
   * `[private]` recipes need no entry here — `just --list` hides them, so the check skips them.
   */
  readonly exempt: readonly string[];
}

export const justfile = definePack("justfile", (repo: Catalogue) => ({
  orientation: breadcrumb()
    .at(session)
    .description("Where the repo's tooling is catalogued, what earns a recipe, and what stays a script.")
    .text(
      [
        "The justfile is this repo's tool catalogue — the single source of truth for the tooling you can confidently reach for. Run `just` FIRST to see what you can do here; do not discover commands from package.json or memory.",
        "A recipe means: reach for this repeatedly, with confidence. Recipes stay thin — the code behind one lives in the tools folder; one-off operational scripts live there too and never become recipes.",
        "A one-off command or chain is fine to run directly. Anything you'll run more than once becomes a script; anything a human should also run becomes a recipe (with a [doc(\"…\")]).",
        "If a service offers a CLI, prefer it over an MCP — a command is recorded, guardable and reproducible.",
      ].join("\n"),
    ),

  toolsHome: breadcrumb()
    .at(touch)
    .on("tools/**")
    .description("The fork every file in the tools folder faces — catalogue entry, or one-shot.")
    .text(
      [
        "You are writing into the tools folder — the implementation layer, not the catalogue. Decide which of two things this file is:",
        "Repeatable — part of the catalogue? Then it also needs a thin justfile recipe pointing at it, with a [doc(\"…\")] — a tool that exists only in tools/ is undiscoverable.",
        "A one-off (a migration, a backfill, a workflow step)? Then it gets NO recipe — one-shots promoted into the catalogue are how `just --list` becomes noise and stops being trustworthy.",
      ].join("\n"),
    ),

  node: {
    noPackageScripts: guardrail()
      .at(write, commit)
      .on("package.json")
      .description("package.json scripts stays empty — the justfile is the single command source.")
      .check(jsonInvariant({ assert: [{ path: "scripts", keysPrefixedWith: "//" }] }))
      .message(
        "package.json `scripts` must stay empty — the justfile is the catalogue, and a second command surface is one an agent reads instead of it. Only //-prefixed comment keys are allowed; move the command into a justfile recipe.",
      )
      .test({
        pass: [{ path: "package.json", content: '{"scripts":{"//":"see the justfile"}}' }],
        block: [{ path: "package.json", content: '{"scripts":{"dev":"vite"}}' }],
      }),
  },

  justfileDocs: guardrail()
    .at(write, commit)
    .on("justfile")
    .description("Every justfile recipe carries an explicit [doc] — `just --list` is the catalogue's help screen.")
    .check(justfileDocs({ exempt: repo.exempt }))
    .message(
      'Every non-private justfile recipe needs an explicit [doc("…")] — `just --list` is the tool catalogue\'s help screen, and an undocumented recipe is a tool nobody can choose. ([private] recipes are exempt; they\'re hidden from the listing.)',
    )
    .test({
      pass: [
        { path: "justfile", content: '[doc("Run the suite.")]\ntest:\n    npx vitest run\n' },
        // Hidden from `just --list`, so it is not in the catalogue and owes it nothing. The
        // message has promised this since the rule was written; the walk only started honouring
        // it at the crossing.
        { path: "justfile", content: "[private]\n_helper:\n    echo hi\n" },
        // An assignment and a `set` line are not recipes at all.
        { path: "justfile", content: 'set shell := ["bash", "-c"]\nport := "3000"\n' },
      ],
      block: [{ path: "justfile", content: "test:\n    npx vitest run\n" }],
    }),
}));
