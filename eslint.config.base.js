// eslint.config.base.js — shipped by the typescript pack in ~/.work/library.
//
// Copied into the repo (CI must read it) and compared with the pack's version at every
// `work guard status`: a copy is fine, a SILENT copy is not.
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
