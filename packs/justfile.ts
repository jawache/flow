// flow/packs/justfile.ts — the justfile is the repo's TOOL CATALOGUE.
// Subtlety: which recipes are genuinely undocumentable is the one fact this pack cannot know, so `exempt` is a mandatory parameter — this repo binds `{ exempt: [] }` in flow.config.ts, stated rather than defaulted.

import {
  banCommands,
  breadcrumb,
  command,
  commit,
  defineCheck,
  definePack,
  guardrail,
  jsonInvariant,
  session,
  touch,
  write,
  type Check,
} from "../index.ts";

/** The one fact this pack cannot know: which recipes are genuinely undocumentable in a repo. */
// ── the justfile: every recipe is discoverable ───────────────────────────────

/** Words that open a non-recipe construct at column 0. */
const RESERVED = new Set(["set", "alias", "export", "import", "mod", "unexport"]);

/**
 * Recipes with no `[doc(…)]` attribute, as `{ name, line }` (1-based).
 *
 * `[private]` recipes are SKIPPED, and that is a fix rather than a nicety: `just --list` hides
 * them, so a private recipe is not in the catalogue and cannot owe the catalogue a description.
 * The message has claimed this exemption from the day it was written and the walk never honoured
 * it — a rule that refuses what its own sentence promises to allow is the worst kind, because the
 * reader does the thing they were told to do and is refused anyway.
 */
export function undocumentedRecipes(text: string, exempt: readonly string[] = []): { name: string; line: number }[] {
  const ex = new Set(exempt);
  const lines = text.split("\n");
  const bad: { name: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = /^(@?[A-Za-z_][A-Za-z0-9_-]*)(\s|:)/.exec(line);
    if (!m?.[1]) continue; // indented (a body), a comment, an attribute, a blank
    const name = m[1].replace(/^@/, "");
    if (RESERVED.has(name) || ex.has(name)) continue;
    const colon = line.indexOf(":");
    if (colon === -1 || line[colon + 1] === "=") continue; // not a recipe / an assignment
    // Walk up over the recipe's contiguous attribute lines (`[private]`, `[doc(…)]`, …). Either
    // one settles it: a documented recipe is fine, and a private one is not in the listing at all.
    let excused = false;
    for (let j = i - 1; j >= 0; j--) {
      const above = lines[j] as string;
      if (!/^\[.*\]\s*$/.test(above)) break;
      if (/\bdoc\(/.test(above) || /\bprivate\b/.test(above)) {
        excused = true;
        break;
      }
    }
    if (!excused) bad.push({ name, line: i + 1 });
  }
  return bad;
}

/**
 * Every justfile recipe carries an explicit `[doc("…")]`.
 *
 * Without one, `just --list` falls back to the LAST comment line above a recipe, which for a
 * multi-line comment block is a mid-sentence fragment — a help screen assembled by accident.
 */
const justfileDocs = defineCheck(
  (opts: { exempt?: readonly string[] }): Check =>
    (ctx) => {
      const bad = undocumentedRecipes(ctx.file?.content ?? "", opts.exempt ?? []);
      return bad.length === 0
        ? ctx.ok()
        : ctx.fail(bad.map((r) => `recipe '${r.name}' (line ${r.line}) has no [doc("…")] attribute`).join("\n"));
    },
);

export interface Catalogue {
  /**
   * Recipe names that owe no `[doc("…")]`. Usually empty, and MANDATORY so that it is empty on
   * the record rather than by default — an exemption list nobody stated is one nobody reviews.
   *
   * A parameter rather than an override, because `exempt` is the CHECK's option and an override
   * speaks only the sentence keys (at · for · on · ignore · message · disabled).
   *
   * `[private]` recipes need no entry — `just --list` hides them, so the check skips them.
   */
  readonly exempt: readonly string[];

  /** The folder holding the code behind the recipes. Defaults to `tools`. */
  readonly tools?: string;

  /**
   * Commands this repo has a recipe for, as a map from the command's pattern to the recipe that
   * replaces it — `{ "npm run build": "just build" }`.
   *
   * OPTIONAL, and with no map there is no entry at all: which raw command a repo has wrapped is a
   * fact only that repo has, and a rule with an empty list would be one more armed entry matching
   * nothing. The patterns are regular expressions over the command line, so `npx vitest\\b` is a
   * pattern and `npx vitest` is one too.
   *
   * The catalogue's whole promise is that the recipe is the thing to reach for; a breadcrumb says
   * so once a session, and this refuses the raw command by name for the ones that matter.
   */
  readonly recipes?: Readonly<Record<string, string>>;
}

/**
 * The justfile is the repo's TOOL CATALOGUE.
 *
 * The frame: the justfile plays the role MCP tools play elsewhere — the discovery surface an agent
 * can reach for with confidence. `just --list` is the manifest and each `[doc]` string is a tool
 * description. Every entry here is the same arrow pointing at it: the orientation says look here
 * first, `node/noPackageScripts` closes the decoy surface agents habitually read, and `justfileDocs`
 * keeps the manifest readable.
 *
 * @install `just` itself — `brew install just`, or see https://just.systems. Every rule here reads
 * a `justfile` at the repo root and none of them shells out, so nothing else is needed.
 * @setup A `justfile` at the root whose every non-private recipe carries a `[doc("…")]`, and a
 * `package.json` whose `scripts` block holds nothing but `//`-prefixed comment keys. A repo with
 * live npm scripts moves them into recipes first, or does not bind this pack.
 */
export const justfile = definePack("justfile", (repo: Catalogue) => {
  const tools = repo.tools ?? "tools";
  const recipes = repo.recipes ?? {};
  return {
  /**
   * Without it, an agent discovers commands from package.json, from memory, or from a README that
   * has drifted — and reaches for a tool this repo does not have, or hand-runs the chain a recipe
   * already spells correctly.
   */
  orientation: breadcrumb()
    .at(session)
    .description("Where the repo's tooling is catalogued, what earns a recipe, and what stays a script.")
    .text(
      [
        "The justfile is this repo's tool catalogue — the single source of truth for the tooling you can confidently reach for. Run `just` FIRST to see what you can do here; do not discover commands from package.json or memory.",
        `A recipe means: reach for this repeatedly, with confidence. Recipes stay thin — the code behind one lives in \`${tools}/\`; one-off operational scripts live there too and never become recipes.`,
        "A one-off command or chain is fine to run directly. Anything you'll run more than once becomes a script; anything a human should also run becomes a recipe (with a [doc(\"…\")]).",
        "If a service offers a CLI, prefer it over an MCP — a command is recorded, guardable and reproducible.",
      ].join("\n"),
    ),

  /**
   * Without it, everything in the tools folder is treated the same way: one-shots get promoted
   * into the catalogue until `just --list` is noise, or a genuinely repeatable tool is left with
   * no recipe pointing at it and nobody finds it again.
   */
  toolsHome: breadcrumb()
    .at(touch)
    .on(`${tools}/**`)
    .description(`The fork every file in ${tools}/ faces — catalogue entry, or one-shot.`)
    .text(
      [
        `You are writing into \`${tools}/\` — the implementation layer, not the catalogue. Decide which of two things this file is:`,
        `Repeatable — part of the catalogue? Then it also needs a thin justfile recipe pointing at it, with a [doc("…")] — a tool that exists only in \`${tools}/\` is undiscoverable.`,
        "A one-off (a migration, a backfill, a workflow step)? Then it gets NO recipe — one-shots promoted into the catalogue are how `just --list` becomes noise and stops being trustworthy.",
      ].join("\n"),
    ),

  node: {
    /**
     * Without it, package.json grows a second command surface — the one an agent reads FIRST, out
     * of habit — and the two drift until the catalogue is no longer the truth about this repo.
     */
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

  /**
   * Without it, `just --list` falls back to the last comment line above a recipe, which for a
   * multi-line comment block is a mid-sentence fragment — a help screen assembled by accident, and
   * a tool nobody can choose from its description.
   */
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
        // Hidden from `just --list`, so it is not in the catalogue and owes it nothing.
        { path: "justfile", content: "[private]\n_helper:\n    echo hi\n" },
        // An assignment and a `set` line are not recipes at all.
        { path: "justfile", content: 'set shell := ["bash", "-c"]\nport := "3000"\n' },
        // …nor are the other words that open a construct at column 0. `import` and `mod` carry no
        // colon at all, so only the reserved list keeps them from being read as recipe names.
        { path: "justfile", content: 'import "other.just"\nmod sub\n[doc("Run it.")]\ntest:\n    npx vitest run\n' },
        // ATTRIBUTES STACK, and the walk goes up over the whole contiguous run, so either one
        // excuses the recipe in either order. A walk that read only the line immediately above
        // would start refusing a private recipe the moment somebody documented it as well.
        { path: "justfile", content: '[private]\n[doc("why")]\na:\n    echo x\n' },
        { path: "justfile", content: '[doc("why")]\n[private]\nb:\n    echo x\n' },
        // A BODY line is indented, however recipe-shaped it reads. This one spells a colon after a
        // word and is still a shell command inside `a`.
        { path: "justfile", content: '[doc("why")]\na:\n    echo "test: not a recipe"\n' },
      ],
      block: [
        { path: "justfile", content: "test:\n    npx vitest run\n" },
        // THE WALK STOPS at the first line that is not an attribute, so the doc attached to `a`
        // does not reach down to `b`. One documented recipe excusing every recipe beneath it is
        // what that stop exists to prevent.
        { path: "justfile", content: '[doc("belongs to a")]\na:\n    echo x\nb:\n    echo y\n' },
        // A recipe with PARAMETERS is named before a space rather than before a colon, and one
        // written with a leading `@` is the same recipe run quietly. Both are in `just --list`, so
        // both owe it a description.
        { path: "justfile", content: "greet name:\n    echo {{name}}\n" },
        { path: "justfile", content: "@quiet:\n    echo hi\n" },
      ],
    }),

    // NO MAP, NO ENTRY. Which raw commands a repo has wrapped is that repo's fact, and an entry
    // bound with an empty list is one more armed rule matching nothing — the shape this pack
    // exists to refuse.
    ...(Object.keys(recipes).length === 0
      ? {}
      : {
          useTheRecipe: guardrail()
            .at(command)
            .description("A command the repo has a recipe for is refused, and the refusal names the recipe.")
            .check(banCommands({ ban: Object.keys(recipes) }))
            .message(
              [
                "This repo has a recipe for that command — use it. The catalogue is the tooling you can reach for with confidence, and a raw command run beside it is the one nobody sees, nobody documents and nobody can change in one place.",
                ...Object.entries(recipes).map(([pattern, recipe]) => `· \`${pattern}\` → \`${recipe}\``),
              ].join("\n"),
            )
            // The first pair of the repo's own map, driven both ways: the recipe passes, the raw
            // command it replaces is refused. A case written against a command no repo named would
            // prove the pattern against itself.
            //
            // A HEREDOC BODY IS NOT A USE: a python script that names the command in a string
            // passes, and the same command on the line after it is still refused.
            .test({
              pass: [Object.values(recipes)[0] ?? "just test", `python3 - <<'PY'\nprint("${Object.keys(recipes)[0] ?? "npx vitest run"}")\nPY`],
              block: [Object.keys(recipes)[0] ?? "npx vitest run", `python3 - <<'PY'\nprint("x")\nPY\n${Object.keys(recipes)[0] ?? "npx vitest run"}`],
            }),
        }),
  };
});
