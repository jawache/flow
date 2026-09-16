import 'just/secrets.just'

# Command catalog. `just` (no recipe) lists everything.
# Every recipe carries a [doc("…")]. Requires `just` (brew install just).

# Put repo-local CLIs (depcruise, tsc, vitest…) on PATH for every recipe.
export PATH := (justfile_directory() / "node_modules" / ".bin") + ":" + env_var("PATH")

[doc("Show the catalog.")]
default:
    @just --list

[doc("Install dependencies from the lockfile — run this first in a fresh clone.")]
install:
    npm ci

[doc("Build the package — the `flow` binary (dist/flow.mjs), the library a flow.config.ts imports (dist/index.mjs), the packs behind their own subpath export (dist/packs.mjs), and the types for all of it (dist/types/). All four are what `exports` and `files` promise; a bundle without the types would ship a config grammar the editor cannot check.")]
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
    # files no clean clone could produce, one `npm publish` away from being part of the package.
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

[doc("The whole unit suite: the grammar's pure model, the compiler-refusal matrix, the engine, the adapter driven through the built binary, and the machine test over every shipped pack.")]
test:
    npx vitest run

[doc("Run every bound rule's own cases — the .test({pass, block}) block on each entry this repo's flow.config.ts binds, driven through the same ctx the live rails build.")]
test-rules:
    # There is no separate place a rule is proved: the cases travel ON the entry, and a
    # guardrail carrying none does not load at all. `flow test` walks every one of them.
    flow test

[doc("THE MACHINE TEST — the sibling of test-rules, asked about the PACKS instead of this repo. In a throwaway repo that has never heard of flow: `flow init`, every pack the package ships bound at once with a stranger's parameters, `flow status` green, each pack's own cases run pack by pack, and one live refusal driven at write · delete · command · commit · turn-end. Exit 0 answers 'did anything in the packs break'; a red line names the pack.")]
test-packs:
    # No build step: the test builds the bundles itself, because the thing under test is the
    # INSTALLED package — `@jawache/flow` and `@jawache/flow/packs` resolved through the link
    # `flow init` makes, which is the one path a source import would never exercise.
    # FLOW_MACHINE_REPORT is what makes it PRINT its report: the file is in the suite, so
    # `just test` and the commit gate run it too, and they want the exit code rather than the page.
    FLOW_MACHINE_REPORT=1 npx vitest run e2e/machine.test.ts

[doc("Render one page per shipped pack into docs/user/packs/ — the surface a pack is READ on. Each page is the LOADED pack (ids, moments, globs, the message or text verbatim, the check's settings as written, both sides of every case) plus the doc comments the source carries (the pack's lead, its parameters, why each entry exists). Run it after any edit under packs/ and stage what it rewrites.")]
docs-packs:
    # No build step and no binary: the generator imports the packs as SOURCE and loads them through
    # the same `loadConfig` the engine calls, so a page is never one rebuild behind the pack it prints.
    node tools/pack-pages.ts

[doc("THE DRIFT GATE — regenerate every pack page into memory and compare it with the one on disk. Green when they match; names the stale page and exits non-zero when they do not. This is what the commit gate runs, and it writes no file.")]
docs-packs-check:
    node tools/pack-pages.ts --check

[doc("Coverage gate for the pure home — one `domain.ts` per pipeline layer plus glob.ts, judged against the threshold in vitest.config.ts.")]
test-coverage:
    npx vitest run --coverage

[doc("Deterministic suite the commit gate runs: every rule's own cases, the whole repo typechecked (the runner strips types, it never checks them), and the whole vitest suite.")]
test-commit:
    just test-rules
    just typecheck
    just test

[doc("Run the full commit gate over every file git can see, tracked or not — the same guardrails .githooks/pre-commit runs on the staged set.")]
gate:
    # --others too: `git ls-files` alone is tracked-only, so this would otherwise miss exactly the
    # untracked files the pre-commit hook blocks on.
    flow commit $(git ls-files --cached --others --exclude-standard)

[doc("IS THE GUARD WORKING HERE — every rule loadable and able to fire, by MOMENT, plus every fitting (the config, the commit gate, core.hooksPath, the host's hook registrations). Green means guarded; every red line carries its fix, and the exit code is non-zero until they are all gone.")]
guard-status:
    flow status

[doc("Build the binary, then put `flow` on PATH from this checkout (npm link) — the dogfood loop, and how you run flow while you are changing it. A guarded repo installs `@jawache/flow` from npm instead.")]
link:
    just build
    npm link
    # NO backticks in this message: just hands recipe lines to the shell, which would run them as
    # command substitution.
    @echo 'flow now runs from this checkout. Undo with: npm unlink -g @jawache/flow'
    @echo 'Next, in any repo you want guarded — this one included:  flow init'

[doc("Cut a release, locally: compute the next version from the conventional commits since the last tag, write CHANGELOG.md, stamp package.json and the lockfile, and make ONE `chore(release): x.y.z` commit tagged `vx.y.z`. Nothing is pushed and nothing is published. Preview it with `just release-dry` first.")]
release:
    # The gate runs FIRST, before a byte is written. commit-and-tag-version has no rollback: its
    # own `git commit` fires .githooks/pre-commit, and a gate failure there aborts the release with
    # the version already stamped and CHANGELOG.md already written, but nothing committed and no
    # tag — a half-release you then have to unpick by hand. Running the same gate up front turns
    # that into a clean refusal. The hook still runs on the release commit: this ADDS a check, it
    # does not replace one, and there is no `--no-verify` anywhere in here.
    just gate
    # Config in .versionrc.mjs. The version is computed from the commit headers, never chosen —
    # which is what `git/node/no-hand-edited-version` blocks a hand edit in favour of.
    npx commit-and-tag-version
    @echo ''
    @echo 'Local only — nothing was pushed and nothing was published.'
    @echo 'To share the release:  git push --follow-tags origin HEAD'
    @echo 'To publish it:         just release-check   (then the npm line it prints)'

[doc("What `just release` WOULD do, and nothing else: the version it computes and the changelog entry it would write, printed. Touches no file, makes no commit, cuts no tag.")]
release-dry:
    npx commit-and-tag-version --dry-run

[doc("Everything that must be true before publishing: the full gate, a clean build, and the exact tarball npm would upload. Never publishes — `npm publish` stays yours to type.")]
release-check:
    just gate
    just test-commit
    just build-release
    npm pack --dry-run
    # READ THE FILE LIST ABOVE before typing the publish line. It is the whole of what strangers
    # get, `files` is an allowlist, and a package is not unpublishable after 72 hours.
    #
    # IN A REAL TERMINAL, and that is not a style note: npm's `otplease` helper rethrows EOTP when
    # stdin or stdout is not a TTY, so a publish run through anything that captures output — a
    # subprocess, an agent's shell, CI without a token — fails at the two-factor step instead of
    # prompting, and can never reach the browser. Learned at 0.1.0.
    #
    # AND IT RETURNS BEFORE IT IS VISIBLE. npm answers the publish with 202 Accepted — the upload is
    # taken, not yet served — so the registry can still say the old version for a minute or two
    # afterwards. Learned at 0.1.1. `npm view @jawache/flow version` is the honest check, and a
    # consumer's `npm i -D @jawache/flow@<new>` that 404s a few seconds after a successful publish is
    # this, not a failed release: wait, then ask again.
    @echo ''
    @echo 'To publish, in a terminal:  npm publish'
