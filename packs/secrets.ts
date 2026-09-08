// flow/packs/secrets.ts — env files committed encrypted, decrypted through one seam.
//
// Subtlety: THIS PACK SHIPS NO FILE. It used to claim a `secrets.just` module that a repo would
// find copied into its tree; nothing copied it and nothing compared it. What is left is the two
// command names the sentences below send a stuck reader to — optional, defaulting to dotenvx's
// own spelling, so a repo that has wrapped them in recipes says so and a repo that has not is
// still told something it can type. The recipes worth having are on this pack's page, to copy.

import { breadcrumb, commit, definePack, guardrail, protectedPath, session, textBan, write } from "../index.ts";

/**
 * The local-only files every dotenvx repo has: the decryption key, and the per-environment
 * overrides. Named once — the protected set and the ignore list are the same fact.
 *
 * `.dev.vars` is NOT here: it is one platform's name for a local override file, so it lives in the
 * `localFiles` default beside these and a repo that has never heard of it drops it.
 */
const LOCAL_ONLY = [".env.keys", ".env.*.local"];

const AWS_KEY_SHAPE = ["AKIA", "IOSFODNN", "7EXAMPLE"].join("");

/**
 * What this pack cannot know: how this repo spells the env files it commits, and the two commands
 * that seal them and run against them.
 *
 * The two command names default to dotenvx's own, which is the honest floor — a repo that has
 * wrapped them in recipes (`just dx`, `just env-encrypt`) hands those over instead, and every
 * sentence a stuck reader meets then names a command that repo really has.
 */
export interface Seam {
  /**
   * The value prefixes that stay plaintext in a committed env file. Defaults to `["PUBLIC_"]`.
   *
   * A public value is one a bundler inlines at build time, so sealing it would break the build for
   * nothing. `DOTENV_PUBLIC_KEY` is always allowed beside these — it is dotenvx's own header, not a
   * repo's choice.
   */
  readonly publicPrefixes?: readonly string[];

  /**
   * The files that must never be committed. Defaults to `[".env.keys", ".env.*.local",
   * ".dev.vars"]`.
   *
   * These are also what `envEncrypted` ignores: a file nobody commits cannot carry a committed
   * plaintext value, and the two lists being one is what stops them drifting apart.
   */
  readonly localFiles?: readonly string[];

  /** The committed env files, as a glob. Defaults to `.env*`. */
  readonly envFiles?: string;

  /**
   * Extra credential shapes to scan staged content for, added to the six this pack ships (Stripe
   * live keys, AWS access keys, private key headers, GitHub and Slack tokens). Defaults to none.
   *
   * One regular expression per shape. A vendor whose token this pack has never heard of is a fact
   * only the repo has.
   */
  readonly extraSecretShapes?: readonly string[];

  /**
   * The repo's wrapper around dotenvx's runner, called as `<dx> <env> <cmd>` — it decrypts and
   * injects, and every env-dependent command goes through it. Defaults to dotenvx itself, spelled
   * `dotenvx run -f .env.<env> --`, which takes the env file rather than an environment name.
   *
   * A wrapper is worth having and this pack cannot guess its name: `just dx` is one fleet's
   * spelling, and written in here it would send every reader of a refusal to a command their repo
   * does not have, in the one sentence they read at the moment they are stuck.
   */
  readonly dx?: string;

  /**
   * Seals every env file in place, leaving the public prefixes plaintext. Defaults to dotenvx's
   * own `dotenvx encrypt`, excluding the prefixes above by name.
   */
  readonly encrypt?: string;
}

/**
 * Env files committed encrypted, decrypted through one seam, and the local-only files kept out of
 * git.
 *
 * The orientation is at SESSION, and that is the whole design. Models arrive with a trained
 * aversion to env files — usually correct, and reinforced by permission denials — which is exactly
 * wrong for the dotenvx model, where the committed files are encrypted and reading them is the
 * expected way to work. A touch breadcrumb cannot fix that: the sessions where an agent silently
 * avoids env work are the sessions it never fires in. So it is said up front, every time.
 *
 * Three tiers, and every value lives in exactly one: committed-and-encrypted (`.env*`), local
 * ephemera that must never be committed (`.env.keys`, `.dev.vars`, `.env.*.local`), and runtime
 * secrets set per environment on the platform.
 *
 * @install dotenvx — https://dotenvx.com. It is what encrypts the committed files and what runs a
 * command with them decrypted, and with nothing else in place every sentence below names it
 * directly. The two command parameters are for a repo that has wrapped it in recipes of its own.
 * @setup `.env.keys`, `.dev.vars` and `.env.*.local` in `.gitignore` — the rules below refuse them
 * in a commit, and an ignore entry is what stops anyone reaching that refusal.
 *
 * Nothing else is required: unbound, the sentences name dotenvx itself. THIS PACK SHIPS NO FILE
 * and nothing is copied into a repo. What a repo gains by wrapping the tool is one place to say
 * which env file each environment means, and this is the module worth copying — the three jobs an
 * env seam wants, of which this pack asks for two:
 *
 * ```just
 * [doc("Run any command with this environment's secrets injected — the ONE env seam. Usage: just dx dev npm run build")]
 * dx env +cmd:
 *     dotenvx run {{ if env == "prod" { "-f .env.production -f .env" } else { "-f .env.development.local -f .env" } }} -- {{cmd}}
 *
 * [doc("Encrypt every env file in place — everything sealed except PUBLIC_* (bundlers inline those at build).")]
 * env-encrypt:
 *     #!/usr/bin/env bash
 *     set -euo pipefail
 *     for f in .env .env.development.local .env.staging .env.production; do
 *       [ -f "$f" ] && dotenvx encrypt -f "$f" -ek 'PUBLIC_*'
 *     done
 *
 * [doc("List the variable NAMES in an env file — no values, safe to paste. Usage: just env-names .env")]
 * env-names file=".env":
 *     dotenvx get -f {{file}} --mask --pretty-print
 * ```
 *
 * Bound, that repo hands over `dx: "just dx"` and `encrypt: "just env-encrypt"`.
 * @adopt A repo with no `.env*` at all binds this for `noSecretsInCommits` alone, which is worth
 * having in a repo that has never held a secret, and turns `envEncrypted` off BY NAME in its
 * config with the reason on the record — an entry sitting dead is not the same as one opted out of.
 */
export const secrets = definePack("secrets", (repo: Seam = {}) => {
  const publicPrefixes = repo.publicPrefixes ?? ["PUBLIC_"];
  const localFiles = repo.localFiles ?? [...LOCAL_ONLY, ".dev.vars"];
  const envFiles = repo.envFiles ?? ".env*";
  const extraShapes = repo.extraSecretShapes ?? [];
  // SEALING, spelled as the repo spells it or as dotenvx does. The default excludes the very
  // prefixes this pack waves through below, so the command a refusal hands over is the one that
  // leaves exactly those plaintext — a bare `dotenvx encrypt` would seal them and break the build.
  const encrypt = repo.encrypt ?? `dotenvx encrypt ${publicPrefixes.map((prefix) => `-ek '${prefix}*'`).join(" ")}`;
  // THE SEAM, AS A WHOLE INVOCATION, because the two spellings put the environment in different
  // places: a wrapper takes it as an argument (`just dx dev npm run build`), and dotenvx itself
  // takes the env FILE and a `--`. Written as one string here rather than as a template with a
  // hole in it, so neither reading has to be bent to fit the other.
  const seam = repo.dx === undefined ? "dotenvx run -f .env.<env> -- <cmd>" : `${repo.dx} <env> <cmd>`;
  // The public prefixes reach the scan as negative lookaheads, in the order they were given, and
  // dotenvx's own header is allowed after them: a repo chooses its prefixes, never its own tool's.
  const plaintextValue =
    `^(?!\\s*#)${publicPrefixes.map((prefix) => `(?!${prefix})`).join("")}(?!DOTENV_PUBLIC_KEY)` +
    `[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*(?![\"']?encrypted:)(?![\"']?\\s*$).+`;
  return {
  /**
   * Without it, an agent avoids the env files on instinct — the trained reflex is right nearly
   * everywhere else — and either works around the seam or asks a human for values that are
   * committed, encrypted, three feet away.
   */
  orientation: breadcrumb()
    .at(session)
    .description("How secrets work here — the three tiers, the one seam, and what you may read.")
    .text(
      [
        `Env files in this repo are COMMITTED and ENCRYPTED (dotenvx): every value is an \`encrypted:…\` blob except ${publicPrefixes.map((prefix) => `${prefix}*`).join(" / ")} config, which bundlers inline at build. Reading and editing them is expected work for you, not a violation — your training says avoid env files, and for plaintext env files it is right; for these it is wrong.`,
        "Three tiers, and every value lives in exactly one. Committed and encrypted: `.env`, `.env.production`, `.env.staging`. Local ephemera, never committed and never encrypted: `.env.keys` (the decryption key — the ONE file you never read), `.env.*.local`. Runtime platform secrets: set per environment in the host platform's own secret store — a runtime secret added anywhere else does not reach the running service.",
        `One seam: \`${seam}\` decrypts and injects. EVERYTHING env-dependent goes through it — the dev server, a migration, a one-off script. Never \`source .env\`, never a hand-rolled dotenv import.`,
        "The trap worth knowing: `dotenvx decrypt` with no key present succeeds and writes EMPTY values over your file. If a decrypt looks suspiciously quiet, check `.env.keys` exists before you commit anything.",
      ].join("\n"),
    ),

  // The sealed-file rule, and it needs a repo that HAS env files. A repo with none turns it off by
  // name in flow.config.ts, with the reason on the record, rather than leaving it sitting dead.
  /**
   * Without it, one plaintext value lands in a committed `.env` and the whole model is gone: the
   * files are committed on the promise that everything in them is sealed.
   */
  envEncrypted: guardrail()
    .at(write, commit)
    .on(envFiles)
    .ignore(...localFiles)
    .description(`A committed env file carries no plaintext value — everything but ${publicPrefixes.join(" / ")} is sealed.`)
    .check(
      textBan({
        // A KEY=VALUE line whose value is neither an `encrypted:` blob nor empty, and whose key is
        // none of the declared public prefixes. Stated here rather than hidden in a script: which
        // keys a secret-leak rule waves through is the one fact its reader most needs.
        ban: [plaintextValue],
      }),
    )
    .message(
      `A plaintext value in a committed env file — this is the leak the whole model exists to prevent, and git keeps it forever. Seal it with \`${encrypt}\` (${publicPrefixes.map((prefix) => `${prefix}*`).join(", ")} and the DOTENV_PUBLIC_KEY header stay plaintext by design).`,
    )
    .test({
      pass: [{ path: ".env", content: "DOTENV_PUBLIC_KEY=03ab\nAPI_KEY=encrypted:BE9d\nPUBLIC_URL=https://x" }],
      block: [{ path: ".env", content: "API_KEY=sk-live-abcdef" }],
    }),

  noKeysFileInCommits: guardrail()
    .at(commit)
    .on(...localFiles)
    .description("The decryption key and the local overlays can never be committed — the backstop when gitignore breaks.")
    .check(protectedPath({}))
    .message(
      "This file is machine-local and must never be committed: `.env.keys` is the decryption key for every sealed value in this repo, and the `.local` overlays hold real, unencrypted values. The gitignore normally stops this — if you got here, the gitignore is broken.",
    )
    // The pass side is the file the tier ABOVE this one is about: `.env` is committed, sealed, and
    // nothing here judges it. Without the case, the rule proved only that it refuses something.
    .test({
      pass: [{ staged: [".env"], world: { fs: { ".env": "API_KEY=encrypted:BE9d" } } }],
      block: [{ staged: [".env.keys"], world: { fs: { ".env.keys": "k" } } }],
    }),

  noSecretsInCommits: guardrail()
    .at(commit)
    .on("**")
    .ignore("**/*.test.*", "**/*.spec.*")
    .description("Staged content is scanned for live-key shapes — the leak that arrives outside an env file.")
    .check(
      textBan({
        ban: [
          "sk_live_[0-9a-zA-Z]{16,}",
          "rk_live_[0-9a-zA-Z]{16,}",
          "AKIA[0-9A-Z]{16}",
          "-----BEGIN [A-Z ]*PRIVATE KEY-----",
          "ghp_[0-9A-Za-z]{30,}",
          "xox[baprs]-[0-9A-Za-z-]{10,}",
          ...extraShapes,
        ],
      }),
    )
    .message(
      `A live credential shape in staged content. Secrets belong in an encrypted env file (\`${encrypt}\`) or in the platform's runtime secret store — never in source, a fixture or a doc. If this is a real key, rotate it: staging it is already most of the way to publishing it.`,
    )
    .test({
      pass: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "const key = process.env.KEY;" } } }],
      // ASSEMBLED, and the rule is why: written whole, the block case IS a live-key shape in
      // staged content, so this entry refuses the commit that adds it. Found the honest way —
      // it blocked the crossing's own commit at `guards/secrets.ts:87`.
      block: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": `const k = '${AWS_KEY_SHAPE}';` } } }],
    }),
  };
});
