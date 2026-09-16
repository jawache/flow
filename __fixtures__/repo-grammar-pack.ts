// The stranger's SECOND pack — the two capabilities no shipped pack uses, driven where a real repo
// would use them: a note attached to a command, and a rule on a grammar the repo declared itself.
//
// It is a separate file from repo-pack.ts because that one has two drivers and these two entries
// have one: the machine test. A capability nothing in the package binds still has to be driven end
// to end somewhere, or it is a feature that compiles and has never once run.
//
// The import below says `../index.ts` so this typechecks in place, with the rest of the fixtures.
// The suite repoints it as it writes the file into its temp repo — see `fixturePack` in
// flow/e2e/harness.ts.

import { astGrep, breadcrumb, command, commit, definePack, guardrail, write } from "../index.ts";

export const stranger = definePack("stranger", {
  /**
   * A note about a COMMAND, which is the one subject other than a path that a note can be narrowed
   * by.
   *
   * Without the scope it would show on every shell call in the session, which is the same as
   * showing on none — so the scope is what makes the rail usable, and driving it is what proves the
   * note reaches the agent through the PreToolUse answer rather than being quietly dropped.
   */
  installing: breadcrumb()
    .at(command)
    .on("npm install*", "npm i *")
    .description("Installing while the dev server runs corrupts its dependency cache.")
    .text("Installing a dependency while the dev server is running corrupts its dependency cache — restart the server before trusting anything it serves."),

  /**
   * A rule on a grammar THIS REPO DECLARED, rather than one ast-grep has built in or publishes.
   *
   * The language name is the proof: nothing publishes `@ast-grep/lang-declared-python`, so a match
   * here can only have come from the library the config named. A repo with a hand-built grammar —
   * astro, vue, svelte — reaches its rules by exactly this route.
   */
  noEvalInScripts: guardrail()
    .at(write, commit)
    .on("scripts/**/*.py")
    .description("No eval() in a build script — the declared-grammar rule.")
    .check(astGrep({ language: "declared-python", rule: { kind: "call", has: { field: "function", regex: "^eval$" } } }))
    .message("`eval()` in a build script runs whatever it is handed. Parse the value instead.")
    .test({
      pass: [{ path: "scripts/a.py", content: "def run(src):\n    return json.loads(src)\n" }],
      block: [{ path: "scripts/a.py", content: "def run(src):\n    return eval(src)\n" }],
    }),
});
