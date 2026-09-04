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

// ONE external, and the asymmetry between flow's two dependencies is the whole explanation.
//
// @ast-grep/napi is a NATIVE binding — its real payload is a per-platform `.node` binary that
// esbuild cannot inline into an ESM bundle — so it is marked external and resolved from
// node_modules at run time, exactly as the CLI does with it.
//
// dependency-cruiser is a dependency and is NOT here, because nothing imports it: the depcruise
// check runs it as a subprocess through `ctx.exec` (a check may not touch the module graph any
// more than it may touch disk). It stays in `dependencies` so installing flow installs the tool
// the check shells out to — a bundled binary whose one external tool is missing would be a
// broken promise on first run.
const EXTERNAL = ["@ast-grep/napi"];

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
