// eslint.config.base.js — THIS REPO'S OWN, and nothing ships it.
//
// The typescript pack takes `eslintBase` as an optional parameter and flow.config.ts hands it this
// path; that is what puts `typescript.eslintFromBase` in this repo's guard, refusing an
// eslint.config.js that does not import this file. A repo that names no base gets no such rule at
// all — a rule demanding a file the package does not ship would refuse every repo that binds the
// pack. The pack's page carries a copy of this file for a repo that wants a base of its own.
//
// The whole point is that this file is not a hand-rolled rule set. typescript-eslint's
// `strictTypeChecked` is the maintained good-patterns set — no-floating-promises,
// no-misused-promises, ban-ts-comment, no-explicit-any, no-unnecessary-type-assertion and the
// rest — and it supersedes the five ast-grep idiom rules this pack used to carry, each of which
// was a worse approximation of one line in here. eslint-plugin-n's flat/recommended ships AS
// SHIPPED, with no hand-picked extras.
//
// A repo's own eslint.config.js is two lines: import this, spread it, then add whatever is
// genuinely local. An exception is a visible, local, per-rule override — never a loosening here.

import tseslint from "typescript-eslint";
import n from "eslint-plugin-n";

export default tseslint.config(
  { ignores: ["dist/**", "build/**", "coverage/**", ".astro/**", "node_modules/**"] },
  ...tseslint.configs.strictTypeChecked,
  n.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // n/no-process-env stays OFF deliberately: it never fired in this fleet, and Astro reads
      // import.meta.env, which it does not match anyway. The env seam is the secrets pack's job.
      "n/no-process-env": "off",
      // Escape hatches stay errors — this is the half of the pack that used to be ast-grep.
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
);
