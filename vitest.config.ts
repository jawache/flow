// vitest.config.ts — one runner over this package, and the coverage gate over its pure home.
//
// ONE PROJECT, because this repo is ONE package. It arrived here as a project inside a monorepo's
// runner, where it needed a `root` of its own so a test file did not resolve `vitest` from the
// wrong node_modules. That whole problem left with the monorepo: there is one node_modules, one
// lockfile and one version.
//
// `forks` (child processes), never `threads`: the suites here spawn the built binary, mutate
// process.env and chdir, and a worker thread shares all three with its siblings.
//
// The timeouts are generous because the work is honest: a suite that builds a temp git repo,
// bundles the binary and runs `flow init` in it is slow by nature, and vitest's 5s default would
// fail it for that.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["**/*.test.ts"],
    // `__fixtures__` holds configs that are wrong on purpose — grammar.test.ts compiles them and
    // asserts the compiler refused, so they must never be collected as tests themselves.
    exclude: ["dist/**", "**/__fixtures__/**", "**/node_modules/**"],

    // ── the coverage gate, over the pure home ──
    //
    // There is no `pure/` folder anywhere here: the layer folder IS the component and its
    // `domain.ts` IS its whole pure core (ruled with the human at flow F2), plus `glob.ts`, the one
    // shared file of the product. Both are named by SHAPE rather than by folder, so a layer added
    // later is gated the day it exists rather than the day someone remembers this file.
    //
    // Written test-first from an empty folder, so the bar is what it measures today, a point or so
    // under — a threshold set AT the measurement goes red on the next honest refactor and teaches
    // everyone to raise the bar rather than write the test.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      reportsDirectory: ".work/tmp/coverage",
      include: ["**/domain.ts", "glob.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        "**/domain.ts": { lines: 98 },
        "glob.ts": { lines: 98 },
      },
    },
  },
});
