// flow/flow.ts — the `flow` binary. It has NO commands yet, and says so.
//
// The entry exists this early for one reason: `bin.flow` in package.json is a promise, and
// `just link-flow` puts it on PATH. A bin field pointing at a file the build does not produce is
// a broken symlink the moment anyone links this checkout — so the entry ships with the scaffold
// and the verbs arrive with the engine that answers them (`flow test` in F2, the hook and init
// surfaces after it).
//
// Until then this is honest about being unfinished: `--version` answers, anything else refuses.

import { VERSION } from "./version.ts";

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
} else {
  process.stderr.write(
    [
      `flow ${VERSION}`,
      "",
      "No commands yet. This build carries the config grammar only: a flow.config.ts",
      "typechecks against it and loads through it, and nothing runs it.",
      "",
    ].join("\n"),
  );
  process.exitCode = 2;
}
