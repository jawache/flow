// flow/packs/typescript.ts — TypeScript discipline as shared configuration.
//
// Subtlety: BOTH gate recipes are mandatory parameters, on the `{ run }` shape tdd already uses.
// `just typecheck` is this fleet's spelling and nothing more — a pack that wrote it in would run
// nothing in a repo whose gate is `npm run typecheck`, and would say so in the refusal too.


import { astGrep, commit, breadcrumb, definePack, escapeRe, execPasses, guardrail, jsonInvariant, touch, write } from "../index.ts";

/** What this pack cannot know: the two gate recipes, and whether the repo has shared config files. */
export interface Gates {
  /** The recipe that typechecks every project in one pass. */
  readonly typecheck: string;
  /** The recipe that lints the repo. */
  readonly lint: string;

  /**
   * The shared tsconfig every project must extend — a path (`./tsconfig.base.json`) or a package
   * name. Optional, and with nothing here the rule does not ask for one.
   *
   * flow ships no such file: a base states one fleet's opinion about target, module and lib, and a
   * neutral engine has no business having one. What the pack holds without it is the opinion that
   * travels — `strictOptions` below stay on wherever they are set.
   */
  readonly tsconfigBase?: string;

  /**
   * The shared eslint config the repo's own config must import — a path
   * (`./eslint.config.base.js`) or a package name. Optional; with nothing here there is no entry.
   */
  readonly eslintBase?: string;

  /**
   * The compiler options that may never be turned off. Defaults to `["strict",
   * "noUncheckedIndexedAccess"]`.
   *
   * Stated as option names under `compilerOptions`, each asserted `true`. This is the pack's whole
   * opinion when no base file is named.
   */
  readonly strictOptions?: readonly string[];
}

/**
 * TypeScript discipline as shared configuration: strict stays on, the checker is never silenced.
 *
 * This pack does not re-implement a linter. The escape hatches — `@ts-expect-error`, explicit
 * `any`, double assertions — are typescript-eslint's `strictTypeChecked` job, and it does it
 * better than a hand-rolled pattern can. What is left is the half a linter cannot do: keep the
 * repo's own configs pointing at a shared base, run both tools at the gate, and teach the design
 * habit no tool checks.
 *
 * @setup The two gate recipes, and nothing else. THIS PACK SHIPS NO FILE: a base states one
 * fleet's opinion about target, module and lib, and a neutral engine has no business having one,
 * so with no base named the pack holds only the opinion that travels — the strict options stay on
 * wherever they are set.
 *
 * A shared base is still worth having, and a repo that keeps one names it in `tsconfigBase` and
 * `eslintBase`; the two rules then hold every project to it. REFERENCE below, not a file to match:
 * the smallest base that carries the opinion, to copy as `tsconfig.base.json` and then add a
 * repo's own emit and module settings to. Every `tsconfig*.json` extends it.
 *
 * ```json
 * {
 *   "compilerOptions": {
 *     "strict": true,
 *     "noUncheckedIndexedAccess": true,
 *     "exactOptionalPropertyTypes": true,
 *     "noImplicitOverride": true,
 *     "noFallthroughCasesInSwitch": true,
 *     "noUnusedLocals": true,
 *     "noUnusedParameters": true
 *   }
 * }
 * ```
 *
 * …and the lint half as `eslint.config.base.js`, which the repo's own `eslint.config.js` imports
 * and spreads. It is deliberately not a hand-rolled rule set: `strictTypeChecked` is the maintained
 * good-patterns set, it already holds the escape hatches at error, and it supersedes every idiom
 * rule a pack could write. `projectService` is what makes the type-aware rules work at all.
 *
 * ```js
 * import tseslint from "typescript-eslint";
 *
 * export default tseslint.config(
 *   { ignores: ["dist/**", "coverage/**"] },
 *   ...tseslint.configs.strictTypeChecked,
 *   {
 *     languageOptions: {
 *       parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
 *     },
 *   },
 * );
 * ```
 * @adopt Bind it with the two gate recipes this repo really has. Expect the first commit after
 * binding to run both tools over everything — a repo that has been typechecking one project at a
 * time usually finds errors in the ones nobody was checking.
 */
export const typescript = definePack("typescript", (repo: Gates) => {
  const strictOptions = repo.strictOptions ?? ["strict", "noUncheckedIndexedAccess"];
  // The base is one assert among the strictness asserts, and it is only there when a repo named a
  // base. A repo with no shared file still gets the half that travels.
  const base = repo.tsconfigBase;
  const asserts = [
    ...(base === undefined ? [] : [{ path: "extends", matches: `${escapeRe(base)}$`, required: true }]),
    ...strictOptions.map((option) => ({ path: `compilerOptions.${option}`, equals: true })),
  ];
  return {
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
          `Strictness is not yours to weaken: ${strictOptions.map((option) => `\`${option}\``).join(" and ")} ${base === undefined ? "stay on wherever they are set" : `come from the committed \`${base}\``}. A red squiggle is a defect found, not a setting to relax — an exception is a visible, local, per-rule override, on the record.`,
          'Model state so the impossible cannot be constructed. Two sibling booleans (isLoading + isError) are a smell: a discriminated union makes the invalid combination unrepresentable (Vanderkam, Effective TypeScript; Feldman, "Make Impossible States Impossible").',
          "The linter holds the escape hatches (@ts-expect-error, explicit any, double assertions) at error, and it does that job better than any rule we could write — which is why this pack points at the linter rather than carrying patterns of its own.",
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
    tsconfigStrict: guardrail()
      .at(write, commit)
      .on("**/tsconfig.json")
      .description(
        base === undefined
          ? `Every tsconfig.json keeps ${strictOptions.join(" and ")} on.`
          : `Every tsconfig.json extends ${base} and keeps ${strictOptions.join(" and ")} on.`,
      )
      .check(jsonInvariant({ assert: asserts }))
      .message(
        [
          base === undefined
            ? `This tsconfig turns off one of ${strictOptions.join(" / ")}. A red squiggle is a defect found, not a setting to relax.`
            : `This tsconfig must extend \`${base}\`, and it must not turn ${strictOptions.join(" or ")} back off. Weakening the strictness means changing the shared base once, visibly, not this project quietly.`,
        ].join("\n"),
      )
      .test({
        pass: [
          {
            path: "cli/tsconfig.json",
            content: base === undefined ? '{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true}}' : `{"extends":"${base}"}`,
          },
        ],
        block: [
          { path: "cli/tsconfig.json", content: '{"compilerOptions":{"strict":false}}' },
          {
            path: "cli/tsconfig.json",
            content: base === undefined ? '{"compilerOptions":{"noUncheckedIndexedAccess":false}}' : `{"extends":"${base}","compilerOptions":{"strict":false}}`,
          },
        ],
      }),

  // ast-grep rather than jsonInvariant for one reason: an eslint flat config is JavaScript, so
  // there is no JSON to read a key out of.
  /**
   * Without it, a repo lints to its own private standard while its config claims the fleet's —
   * the rules that catch the escape hatches this pack stopped hand-rolling are simply not on.
   */
    // NO BASE, NO ENTRY: a repo that has not named a shared eslint config has nothing for this rule
    // to be about, and an entry demanding a file nobody ships is a rule that refuses every repo.
    ...(repo.eslintBase === undefined
      ? {}
      : {
          eslintFromBase: guardrail()
            .at(write, commit)
            .on("eslint.config.js", "eslint.config.mjs")
            .description(`The repo's eslint config imports ${repo.eslintBase}.`)
            .check(
              astGrep({
                language: "javascript",
                rule: {
                  kind: "program",
                  not: { has: { stopBy: "end", kind: "string", regex: escapeRe(repo.eslintBase) } },
                },
              }),
            )
            .message(
              [
                `This eslint config does not import \`${repo.eslintBase}\`. The shared rules live there — a config that does not import it lints to a private standard while this repo's guard claims the shared one.`,
                `Fix: \`import base from "${repo.eslintBase}";\` and spread it, then add only what is genuinely local to this repo.`,
              ].join("\n"),
            )
            .test({
              pass: [{ path: "eslint.config.js", content: `import base from "${repo.eslintBase}";\nexport default [...base];\n` }],
              block: [{ path: "eslint.config.js", content: "export default [];\n" }],
            }),
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
  };
});
