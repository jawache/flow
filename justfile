import 'just/secrets.just'

# Command catalog. `just` (no recipe) lists everything.
# Every recipe carries a [doc("…")]. Requires `just` (brew install just).

# Put repo-local CLIs (depcruise, tsc, vitest…) on PATH for every recipe.
export PATH := (justfile_directory() / "node_modules" / ".bin") + ":" + env_var("PATH")

[doc("Show the catalog.")]
default:
    @just --list

[doc("Install dependencies from the lockfile, and link `@jawache/flow` back to this checkout — run this first in a fresh clone or worktree.")]
install:
    npm ci
    # AFTER `npm ci`, which wipes node_modules. The hooks run node_modules/@jawache/flow/dist/flow.mjs
    # when it exists and fall back to the `flow` on PATH, so without this link a checkout's hooks run
    # whatever older flow is installed, and the config this checkout's packs write may not load there.
    mkdir -p node_modules/@jawache
    ln -sfn ../.. node_modules/@jawache/flow

[doc("Build the package — the `flow` binary (dist/flow.mjs), the library a flow.config.ts imports (dist/index.mjs), the one pack behind its own subpath export (dist/packs.mjs), and the types for all of it (dist/types/). All four are what `exports` and `files` promise; a bundle without the types would ship a config grammar the editor cannot check.")]
build:
    node esbuild.mjs
    just emit-types

[doc("Build as it ships: minified, and with NO sourcemap comment — the map is not in the package's published files list, so a dev build would point at a file that isn't there.")]
build-release:
    node esbuild.mjs --production
    just emit-types

[doc("Emit dist/types/ FROM SCRATCH — the declaration half of the package, and the half that rots. tsc overwrites what it emits and deletes nothing, so a renamed or deleted source leaves its .d.ts behind forever and `npm pack` ships it. The three bundles cannot drift that way (esbuild rewrites all three every run); this tree mirrors the source tree, so it is cleared first.")]
emit-types:
    # MEASURED on the eve of 0.1.0, from this very tarball: dist/types/packs/guard.d.ts and
    # dist/types/packs/checks.d.ts — declarations for two packs deleted commits ago — plus
    # dist/types/e2e/harness.d.ts, emitted before tsconfig.build.json excluded that folder. Three
    # files no clean clone could produce, one release away from being part of the package.
    rm -rf dist/types
    npx tsc -p tsconfig.build.json

[doc("Typecheck the whole repo against the shared tsconfig.base.json — the package AND this repo's own guard (flow.config.ts + guards/house.ts), which is ordinary TypeScript and has to typecheck like any other. This is what the commit gate runs.")]
typecheck:
    # BUILD FIRST: flow.config.ts and guards/house.ts import `@jawache/flow`, which resolves
    # through node_modules/@jawache/flow to this very checkout's dist/types. That is the point
    # rather than a chore — the whole promise of config-as-code is that a wrong rule is a red
    # squiggle, and a squiggle needs the same .d.ts a config author's editor reads. Building it
    # here is also the only way this repo's guard is checked against the package it ships.
    just build
    npx tsc -p tsconfig.json

[doc("Lint every TypeScript surface — the pipeline layers, the packs, this repo's own guard and the two configs — with the fleet's shared eslint base (typescript-eslint strictTypeChecked + eslint-plugin-n). Type-aware: it sees what tsc alone cannot.")]
lint:
    npx eslint adapter checks e2e engine language packs guards tools *.ts

[positional-arguments]
[doc("The whole unit suite: the grammar's pure model, the compiler-refusal matrix, the engine, the adapter driven through the built binary, and the machine test over every shipped pack.")]
test *args:
    npx vitest run "$@"

[doc("Run every bound rule's own cases — the .test({pass, block}) block on each entry this repo's flow.config.ts binds, driven through the same ctx the live rails build.")]
test-rules:
    # There is no separate place a rule is proved: the cases travel ON the entry, and a
    # guardrail carrying none does not load at all. `flow test` walks every one of them.
    just build
    node dist/flow.mjs test

[doc("THE MACHINE TEST — the sibling of test-rules, asked about the one pack the package ships, `flow`, instead of this repo. In a throwaway repo that has never heard of flow: `flow init`, the `flow` pack bound bare beside two packs the repo writes, `flow status` green, each pack's own cases run, and a live refusal driven at commit · turn-end. Exit 0 answers 'did the shipped pack break'; a red line names it.")]
test-packs:
    # No build step: the test builds the bundles itself, because the thing under test is the
    # INSTALLED package — `@jawache/flow` and `@jawache/flow/packs` resolved through the link
    # `flow init` makes, which is the one path a source import would never exercise.
    # FLOW_MACHINE_REPORT is what makes it PRINT its report: the file is in the suite, so
    # `just test` and the commit gate run it too, and they want the exit code rather than the page.
    FLOW_MACHINE_REPORT=1 npx vitest run e2e/machine.test.ts

[doc("Score a Bash path extractor against the hand-labelled corpus in __fixtures__/bash-corpus/ — recall and precision for reads and writes, per mechanism and per parsing trap. `just score-bash` scores the naive baseline; name another extractor from tools/score-bash.ts to score that one, and add --misses to list every path it missed or invented.")]
score-bash *args:
    node tools/score-bash.ts {{args}}

[doc("Coverage gate for the pure home — one `domain.ts` per pipeline layer plus glob.ts, judged against the threshold in vitest.config.ts.")]
test-coverage:
    npx vitest run --coverage

[doc("Deterministic suite the commit gate runs: every rule's own cases, the whole repo typechecked (the runner strips types, it never checks them), and the whole vitest suite.")]
test-commit:
    just test-rules
    just typecheck
    just test

[doc("Pin the Getting started tutorial to the binary: every transcript on docs/user/tutorials/getting-started.md is what the built flow prints. Outside the commit gate, since the docs land before the code that prints them; the full suite and `just release-check` run it.")]
test-tutorial:
    FLOW_TUTORIAL=1 npx vitest run e2e/product.test.ts -t "the Getting started tutorial's transcripts"

[doc("Run the full commit gate over every file git can see, tracked or not, as if all of it were staged — the same guardrails .githooks/commit-msg runs on the staged changes, plus every file the last commit has that is now gone.")]
gate: build
    node dist/flow.mjs hook commit --all

[doc("IS THE GUARD WORKING HERE — every rule loadable and able to fire, by MOMENT, plus every fitting (the config, the commit gate, core.hooksPath, the host's hook registrations). Green means guarded; every red line carries its fix, and the exit code is non-zero until they are all gone.")]
guard-status: build
    node dist/flow.mjs status

[doc("Cut a release, locally: compute the next version from the conventional commits since the last tag, write CHANGELOG.md, stamp package.json and the lockfile, and make the `chore(release): x.y.z` commit on this branch. Then build for release and make a second commit above it that holds dist/, and tag THAT one `vx.y.z`. The branch stays at the first commit. Refused until docs/user/migrations/<version>.md exists. Nothing is pushed and nothing is published. Preview it with `just release-dry` first.")]
release:
    # The version being cut needs its migration guide, the page a repo that uses flow follows to
    # upgrade. Asked first, for the same no-rollback reason as the gate below.
    node tools/release-guide.ts
    # The gate runs FIRST, before a byte is written. commit-and-tag-version has no rollback: its
    # own `git commit` fires .githooks/commit-msg, and a gate failure there aborts the release with
    # the version already stamped and CHANGELOG.md already written, but nothing committed. Running
    # the same gate up front turns that into a clean refusal. There is no `--no-verify` in here.
    just gate
    # The release commit, the release build, the commit that holds dist/ and the tag on it: all in
    # tools/release.ts, which pushes nothing.
    node tools/release.ts cut

[doc("What `just release` WOULD do, and nothing else: the version it computes and the changelog entry it would write, printed. Touches no file, makes no commit, cuts no tag.")]
release-dry:
    npx commit-and-tag-version --dry-run

[doc("Everything that must be true before a release: the full gate, the commit suite, the tutorial against the binary, and then the release itself, made in a throwaway clone: the release commit, the commit that holds dist/ and the tag. The tag is installed into a scratch folder with `npm i -D --ignore-scripts`, and the installed dist/flow.mjs runs. Pushes nothing, and leaves this repo as it was.")]
release-check:
    just gate
    just test-commit
    just test-tutorial
    node tools/release.ts check
