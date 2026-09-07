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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// THE PACKAGE ROOT — flow/, not the repo. See the note above.
const root = new URL("./", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const production = process.argv.includes("--production");

// THREE BUNDLES, because `@jawache/flow` is three things and they are entered differently.
//
//   dist/flow.mjs   the BINARY. Executable, shebanged, and it runs on import — argv, exit code.
//   dist/index.mjs  the LIBRARY. What `import { guardrail } from "@jawache/flow"` resolves to in a
//                   guarded repo's flow.config.ts, and it must have no side effect at all.
//   dist/packs.mjs  the PACKS. What `import { git } from "@jawache/flow/packs"` resolves to — the
//                   ten shipped packs, behind their own subpath export.
//
// The binary cannot be either of the others: an import of it would parse argv and set an exit
// code, and the main-module guard that usually separates them cannot work here — the process's
// entry point IS the flow binary when a config is being loaded, so `argv[1] === this file` is true
// either way.
//
// The packs are a SECOND library bundle rather than more of the first, because they are a
// different promise: `@jawache/flow` is the grammar a config is written in, and a symbol reachable
// through it is part of the language. A pack is content — rules somebody has to agree with — and
// belongs behind its own door. The cost is that each bundle inlines its own copy of the grammar
// (the packs import `../index.ts`), and that copy is harmless by construction: every brand in this
// package is a `Symbol.for`, so a pack built against one copy and bound by a config using the
// other still matches. That is the case the branding was chosen for.
//
// The library halves also need TYPES, which esbuild does not emit — `just build` runs
// `tsc -p tsconfig.build.json` for that, and its `include` already sweeps packs/. Shipping the .ts
// source instead is not an option: node refuses to strip types under node_modules.
const bundles = [
  { entry: "flow.ts", out: "flow.mjs", binary: true },
  { entry: "index.ts", out: "index.mjs", binary: false },
  { entry: "packs/index.ts", out: "packs.mjs", binary: false },
];

// WHERE THE THREE LAND — `dist/` beside this file, unless `--outdir <path>` says otherwise.
//
// The flag exists for the end-to-end suites and for nothing else. `dist/` is not a build artefact
// in this checkout, it is the LIVE GUARD: the hooks and the commit gate execute dist/flow.mjs and
// flow.config.ts resolves `@jawache/flow` to dist/index.mjs. Every one of those suites builds the
// package on the way in, so building into `dist/` rebuilt the running guard as a side effect — and
// a run stopped part-way left it disagreeing with the source, which wedged the guard once and
// produced a false test count. They pass a temp folder now; nothing else does.
const flagged = process.argv.indexOf("--outdir");
const outDir = flagged === -1 ? fileURLToPath(new URL("dist/", root)) : resolve(process.argv[flagged + 1] ?? "");

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

mkdirSync(outDir, { recursive: true });

for (const { entry, out, binary } of bundles) {
  const outfile = join(outDir, out);
  await build({
    entryPoints: [fileURLToPath(new URL(entry, root))],
    bundle: true,
    format: "esm",
    platform: "node",
    // DELIBERATELY BEHIND `engines`, which says node >= 24. The floor is about the config LOADER —
    // node has to strip the types out of a flow.config.ts — and not about this bundle's syntax. A
    // target of node24 would make an old node fail on the bundle itself with a parse error, which
    // is precisely the machine-fact-arriving-as-a-syntax-error that `configLoadFault` exists to
    // stop. Lowering to node20 keeps the binary able to RUN far enough to say what is wrong.
    target: "node20",
    outfile,
    external: EXTERNAL,
    ...(binary ? { banner: { js: "#!/usr/bin/env node" } } : {}),
    define: { FLOW_VERSION: JSON.stringify(pkg.version) },
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  });

  // npm sets the bit on install; set it here too so the repo's own build is runnable.
  if (binary) chmodSync(outfile, 0o755);
}
