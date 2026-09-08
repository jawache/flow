// flow/packs/typescript.ts — TypeScript discipline as shared configuration.
//
// Subtlety: BOTH gate recipes are mandatory parameters, on the `{ run }` shape tdd already uses.
// `just typecheck` is this fleet's spelling and nothing more — a pack that wrote it in would run
// nothing in a repo whose gate is `npm run typecheck`, and would say so in the refusal too.
//
// The two provisioned files (`tsconfig.base.json`, `eslint.config.base.js`) are COMMITTED here and
// byte-compared by nothing any more: `work guard apply` and its drift check went with the old
// engine. What holds them now is the two rules below plus review — a repo that edits the base is
// making a visible change to a committed file, which is the honest half of what `apply` bought.

import { astGrep, commit, breadcrumb, definePack, execPasses, guardrail, jsonInvariant, touch, write } from "../index.ts";

/** The two facts this pack cannot know: what the whole-project typecheck and the lint are called. */
export interface Gates {
  /** The recipe that typechecks every project in one pass. */
  readonly typecheck: string;
  /** The recipe that lints the repo. */
  readonly lint: string;
}

/**
 * TypeScript discipline as shared configuration: strict stays on, the checker is never silenced.
 *
 * This pack does not re-implement a linter. Five hand-rolled idiom rules (no-ts-ignore ·
 * no-any-in-exports · no-double-assertion · no-unsafe-unwrap · date-default-no-nullish) retired
 * into typescript-eslint's `strictTypeChecked`, which is the maintained version of all of them
 * plus the ones nobody here wrote — and one of ours had a description that did not match its
 * pattern for months, which is the argument in miniature.
 *
 * What is left is the half a linter cannot do: keep the repo's own configs pointing at the shared
 * base, run both tools at the gate, and teach the design habit no tool checks.
 *
 * @setup Two committed files at the repo root, and every project pointing at them: a
 * `tsconfig.base.json` every `tsconfig*.json` extends, and an `eslint.config.base.js` the repo's
 * `eslint.config.js` imports and spreads. The two rules below check exactly that, and say nothing
 * about what the base contains beyond `strict` and `noUncheckedIndexedAccess` staying on.
 * @adopt Bind it with the two gate recipes this repo really has. Expect the first commit after
 * binding to run both tools over everything — a repo that has been typechecking one project at a
 * time usually finds errors in the ones nobody was checking.
 */
export const typescript = definePack("typescript", (repo: Gates) => ({
  /**
   * Without it, strictness is treated as a setting rather than a design tool: the escape hatches
   * get reached for under time pressure, and impossible states go on being representable because
   * nothing ever said to model them out.
   */
  strictTypesNoInvalidStates: breadcrumb()
    .at(touch)
    .on("**/tsconfig*.json", "eslint.config.*")
    .description("Use the type system as a design tool — strict stays on, impossible states stay impossible.")
    .text(
      [
        "Strictness is not yours to weaken: `strict` and `noUncheckedIndexedAccess` come from the committed `tsconfig.base.json`. A red squiggle is a defect found, not a setting to relax — an exception is a visible, local, per-rule override, on the record.",
        'Model state so the impossible cannot be constructed. Two sibling booleans (isLoading + isError) are a smell: a discriminated union makes the invalid combination unrepresentable (Vanderkam, Effective TypeScript; Feldman, "Make Impossible States Impossible").',
        "The linter holds the escape hatches (@ts-expect-error, explicit any, double assertions) at error, and it does that job better than any rule we could write — which is why this pack ships a config rather than patterns.",
      ].join("\n"),
    ),

  // `**/tsconfig.json`, not `tsconfig.json`. The narrow glob made the rule true by accident: this
  // repo has four TypeScript projects, the root one did not exist, and the three that did were
  // invisible for as long as the rule watched only the repo root. Widening it turned one silent
  // pass into three real checks and 69 type errors (2026-08-13).
  /**
   * Without it, a project quietly stops extending the shared base — or extends it and then turns
   * `strict` back off — and the fleet's one standard becomes per-project taste that only shows up
   * as a bug much later.
   */
  tsconfigFromBase: guardrail()
    .at(write, commit)
    .on("**/tsconfig.json")
    .description("Every tsconfig.json extends the committed shared base and does not loosen it.")
    .check(
      jsonInvariant({
        assert: [
          { path: "extends", matches: "tsconfig\\.base\\.json$", required: true },
          { path: "compilerOptions.strict", equals: true },
          { path: "compilerOptions.noUncheckedIndexedAccess", equals: true },
        ],
      }),
    )
    .message(
      "This tsconfig must extend the committed `./tsconfig.base.json`, and it must not turn `strict` or `noUncheckedIndexedAccess` back off. Weakening the fleet's strictness means changing the base file once, visibly, not this repo quietly.",
    )
    .test({
      pass: [{ path: "cli/tsconfig.json", content: '{"extends":"../tsconfig.base.json"}' }],
      block: [
        { path: "cli/tsconfig.json", content: '{"compilerOptions":{"strict":true}}' },
        { path: "cli/tsconfig.json", content: '{"extends":"../tsconfig.base.json","compilerOptions":{"strict":false}}' },
      ],
    }),

  // ast-grep rather than jsonInvariant for one reason: an eslint flat config is JavaScript, so
  // there is no JSON to read a key out of.
  /**
   * Without it, a repo lints to its own private standard while its config claims the fleet's —
   * the rules that catch the escape hatches this pack stopped hand-rolling are simply not on.
   */
  eslintFromBase: guardrail()
    .at(write, commit)
    .on("eslint.config.js", "eslint.config.mjs")
    .description("The repo's eslint config imports the committed shared base.")
    .check(
      astGrep({
        language: "javascript",
        rule: { kind: "program", not: { has: { stopBy: "end", kind: "string", regex: "eslint\\.config\\.base" } } },
      }),
    )
    .message(
      [
        "This eslint config does not import the shared base. The fleet's lint rules live in `eslint.config.base.js` — a config that does not import it lints to a private standard while this repo's guard claims the shared one.",
        'Fix: `import base from "./eslint.config.base.js";` and spread it, then add only what is genuinely local to this repo.',
      ].join("\n"),
    )
    .test({
      pass: [{ path: "eslint.config.js", content: 'import base from "./eslint.config.base.js";\nexport default [...base];\n' }],
      block: [{ path: "eslint.config.js", content: "export default [];\n" }],
    }),

  commitRunsTsc: guardrail()
    .at(commit)
    .description("Runs the whole-project typecheck at commit and blocks on any type error.")
    .check(execPasses({ run: repo.typecheck }))
    .message(
      `The typecheck failed (\`${repo.typecheck}\`) — the commit is blocked until types are clean. tsc catches the cross-file mismatches a file-at-a-time build never sees: a change that compiled here and broke a caller there.`,
    )
    .test({
      pass: [{ staged: ["cli/a.ts"], world: { exec: { [repo.typecheck]: { code: 0 } } } }],
      block: [{ staged: ["cli/a.ts"], world: { exec: { [repo.typecheck]: { code: 1, stdout: "a.ts(1,1): error TS2322" } } } }],
    }),

  commitRunsEslint: guardrail()
    .at(commit)
    .description("Runs the lint at commit and blocks on any error.")
    .check(execPasses({ run: repo.lint }))
    .message(
      `The lint failed (\`${repo.lint}\`) — the commit is blocked until it is clean. This is where the escape hatches are held (floating promises, explicit any, ts-comments); fix the finding, or override that one rule visibly and locally.`,
    )
    .test({
      pass: [{ staged: ["cli/a.ts"], world: { exec: { [repo.lint]: { code: 0 } } } }],
      block: [{ staged: ["cli/a.ts"], world: { exec: { [repo.lint]: { code: 1, stdout: "error  Unsafe assignment" } } } }],
    }),
}));
