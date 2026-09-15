// eslint.config.js — this repo's lint, which is the fleet's lint plus what is local to here.
//
// The rules are NOT here: they are in the committed `eslint.config.base.js`, which is the fleet's
// standard and is imported below. Changing the fleet's standard means changing that file, once and
// visibly; changing it here would be a silent fork, which is what `typescript.eslintFromBase` — an
// entry of the typescript pack, shipped by this very package — exists to catch: it refuses a
// config that does not import the base.
//
// What IS local: the surfaces the linter should not read at all, and four per-rule overrides. Every
// one of them answers a fact about THIS repo and carries the fact. There is no blanket disable, no
// file-level eslint-disable comment anywhere in the tree, and no rule turned off in source.
//
// The base's `projectService: true` finds the nearest tsconfig by itself. This repo has ONE
// TypeScript project — `tsconfig.json` sweeps the whole package plus this repo's own guard — so
// there is nothing to name.

import base from "./eslint.config.base.js";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // The refusal fixtures are TypeScript that is WRONG on purpose, compiled by
      // grammar.test.ts under their own project and asserted to fail. Linting them would report
      // every deliberate misuse as a finding.
      "**/__fixtures__/**",
      // The journal is a symlink into ~/.work — not this repo's code, and not this repo's lint.
      ".work/**",
    ],
  },
  ...base,

  // ── override 1 · a number belongs in a sentence ──────────────────────────────────
  //
  // `strictTypeChecked` sets restrict-template-expressions to allowNumber:false, a reasonable
  // default for an app whose strings are user-facing copy. flow's output IS counts — "4 guardrails
  // · 2 breadcrumbs", "30 cases over 7 guardrails", an exit code's reason — so putting a number
  // into a sentence is the product. `${n}` on a number cannot go wrong the way `${obj}` or
  // `${maybeUndefined}` can, and the clauses that carry the rule's real value stay off: any,
  // boolean, nullish, regexp and never all still fail.
  {
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // ── override 2 · this repo's guard imports the package this repo IS ──────────────
  //
  // `flow.config.ts` and `guards/house.ts` import `@jawache/flow` and `@jawache/flow/packs`
  // exactly as any other repo's config does — through the two public doors, never a layer path.
  // That is deliberate dogfooding: the guard of the flow repo is written the way a stranger's is,
  // so a door that stopped working would fail here first.
  //
  // eslint-plugin-n reads the nearest package.json, does not find `@jawache/flow` among its
  // dependencies, and reports it extraneous. It is right about the fact and wrong about the fix: a
  // package cannot declare itself. `flow init` writes the `node_modules/@jawache/flow` symlink
  // that makes the specifier resolve — to this checkout — and that is what both the compiler and
  // the linter follow.
  {
    files: ["flow.config.ts", "guards/**/*.ts"],
    rules: {
      "n/no-extraneous-import": "off",
    },
  },

  // ── override 3 · a domain file may not reach the world ───────────────────────────
  //
  // THE SAME FENCE THE COMMIT GATE ALREADY HOLDS, moved to where it is cheap. The
  // import-boundaries entry in guards/house.ts puts every `domain.ts` in the `pure` layer, whose
  // `only:` allowlist has no node builtins in it — so a `node:fs` import there is refused at
  // commit. This says it again in the editor, on the line, before the file is written: the whole
  // reason flow exists is that a rule which fires late is a rule people learn to work around.
  //
  // It is also flow's ONE load-bearing invariant rather than a style preference. A check reads the
  // world only through `ctx` — that is what makes `.test()` cases real, what makes a recorded
  // session replay without a repo or a harness, and what keeps the judgement/action split
  // one-directional. `process.env` is on the list beside the two builtins because the old engine's
  // one env smuggle (a transcript path read inside a rule script) was exactly this leak wearing a
  // different name, and it made that rule the only one no case could drive.
  //
  // Scoped to the domain files and glob.ts — this package's whole pure home. The CLI shell
  // (flow.ts) and the adapter reach the world for a living, which is the point of their being
  // separate.
  {
    files: ["**/domain.ts", "glob.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "a domain file reads the world only through ctx.fs — the adapter owns disk (see the import-boundaries entry in guards/house.ts)" },
            { name: "node:fs", message: "a domain file reads the world only through ctx.fs — the adapter owns disk (see the import-boundaries entry in guards/house.ts)" },
            { name: "node:fs/promises", message: "a domain file reads the world only through ctx.fs — the adapter owns disk (see the import-boundaries entry in guards/house.ts)" },
            { name: "child_process", message: "a domain file runs commands only through ctx.exec — that is what makes a case and a replay drive the same code" },
            { name: "node:child_process", message: "a domain file runs commands only through ctx.exec — that is what makes a case and a replay drive the same code" },
            { name: "node:os", message: "a domain file has no machine to ask about — whatever this needs is a parameter or a ctx answer" },
          ],
        },
      ],
      "n/no-process-env": "error",
    },
  },

  // ── override 4 · in a test, the assertion IS the null check ──────────────────────
  //
  // Under `noUncheckedIndexedAccess` (which the fleet base turns on, and which stays on) every
  // `rows[0]`, `map.get(k)` and `re.exec(s)` in a test is possibly-undefined, and the test's next
  // line is an assertion on it. In source a `!` hides a real branch and the rule is right, so it
  // stays at error there. In a test it hides nothing: a null reaches the very next line and fails
  // loudly, at the exact assertion, with the exact value.
  //
  // The unsafe-* family rides with it for the same reason one step out: these tests drive the
  // built binary as a subprocess and assert on its JSON, and `JSON.parse` returns `any` by
  // construction. Typing the parse would assert the very shape the test exists to VERIFY, so a
  // contract regression would typecheck and pass.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ── override 5 · a leading underscore already means "deliberately unused" here ──
  //
  // typescript-eslint ships no-unused-vars with no ignore patterns, so it reports the universal
  // convention as a defect. This codebase already spells every deliberate placeholder that way —
  // `_ctx` on a signature that takes no context, `const { x: _x, ...rest }` to drop a field — and
  // the rule with no options has no way to tell those from a genuine leftover. Configured, it
  // still catches every unprefixed one, which is the finding worth having.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // ── override 6 · the two node APIs flow loads a config through ───────────────────
  //
  // `module.registerHooks` and `module.stripTypeScriptTypes` are marked experimental, and
  // eslint-plugin-n is right to say so — on every other line it would be a finding worth keeping.
  // Here it names the only two functions that let a repo which is not `type: "module"` be guarded
  // at all, and there is no stable alternative to move to: node decides a `.ts` file's module
  // system from the nearest package.json and offers no other seam to overrule it. The choice is
  // these two functions or a loader dependency in a package that has two, and the ruling of
  // 2026-09-15 was these two. Scoped to the ONE file that may call them, so the rule still fires
  // everywhere else and a third experimental builtin cannot arrive quietly.
  //
  // WHAT TO WATCH: both are behind `ExperimentalWarning`, which flow.ts suppresses for its own
  // stderr. If either changes shape, `the repo's package.json type` in e2e/product.test.ts goes
  // red across three of its four rows — the table is the tripwire, not this comment.
  {
    files: ["adapter/claude.ts"],
    rules: {
      "n/no-unsupported-features/node-builtins": ["error", { ignores: ["module.registerHooks", "module.stripTypeScriptTypes"] }],
    },
  },
];
