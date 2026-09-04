// Build the `flow` binary — one self-contained ESM bundle.
//
// Modelled on cli/esbuild.mjs, with the one thing that script gets away with FIXED. There,
// `new URL("..", import.meta.url)` is the repo root, and the repo root is also the CLI's package
// root, so `readFileSync(new URL("package.json", root))` reads the right version by coincidence
// of layout. flow is its own package one level down, and copying that line verbatim would define
// FLOW_VERSION from @jawache/work's version — a build stamped with another package's number,
// wrong in a way nothing would ever notice. The root here is THIS directory.
//
// The version is inlined at bundle time rather than read from package.json at run time, because
// the bundle's path relative to package.json is not guaranteed once npm has installed it.

import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// THE PACKAGE ROOT — flow/, not the repo. See the note above.
const root = new URL("./", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const production = process.argv.includes("--production");

const bundles = [{ entry: "flow.ts", out: "dist/flow.mjs" }];

// Nothing is external yet: flow declares no dependencies, so there is nothing the bundler cannot
// swallow. The two the CLI has to mark external (@ast-grep/napi, a native binding; and
// dependency-cruiser, which it spawns rather than imports) arrive with the core checks that need
// them, and this list is where they will be named.
const EXTERNAL = [];

mkdirSync(fileURLToPath(new URL("dist/", root)), { recursive: true });

for (const { entry, out } of bundles) {
  const outfile = fileURLToPath(new URL(out, root));
  await build({
    entryPoints: [fileURLToPath(new URL(entry, root))],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    external: EXTERNAL,
    banner: { js: "#!/usr/bin/env node" },
    define: { FLOW_VERSION: JSON.stringify(pkg.version) },
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  });

  // npm sets the bit on install; set it here too so the repo's own build is runnable.
  chmodSync(outfile, 0o755);
}
