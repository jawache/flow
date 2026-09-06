// flow/packs/secrets.ts — env files committed encrypted, decrypted through one seam, and the
// local-only files kept out of git.
//
// The orientation is at SESSION, and that is the whole design. Models arrive with a trained
// aversion to env files — usually correct, and reinforced by permission denials — which is exactly
// wrong for the dotenvx model, where the committed files are encrypted and reading them is the
// expected way to work. A touch breadcrumb cannot fix that: the sessions where an agent silently
// avoids env work are the sessions it never fires in. So it is said up front, every time.
//
// Three tiers, and every value lives in exactly one: committed-and-encrypted (`.env*`), local
// ephemera that must never be committed (`.env.keys`, `.dev.vars`, `.env.*.local`), and runtime
// secrets set per environment on the platform.

import { breadcrumb, commit, definePack, guardrail, protectedPath, session, textBan, touch, write } from "../index.ts";

/** The three local-only files. Named once — the protected set and the ignore list are the same fact. */
const LOCAL_ONLY = [".env.keys", ".dev.vars", ".env.*.local"];

const AWS_KEY_SHAPE = ["AKIA", "IOSFODNN", "7EXAMPLE"].join("");

export const secrets = definePack("secrets", {
  orientation: breadcrumb()
    .at(session)
    .description("How secrets work here — the three tiers, the one seam, and what you may read.")
    .text(
      [
        "Env files in this repo are COMMITTED and ENCRYPTED (dotenvx): every value is an `encrypted:…` blob except PUBLIC_* config, which bundlers inline at build. Reading and editing them is expected work for you, not a violation — your training says avoid env files, and for plaintext env files it is right; here it is wrong.",
        "Three tiers, and every value lives in exactly one. Committed and encrypted: `.env`, `.env.production`, `.env.staging`. Local ephemera, never committed and never encrypted: `.env.keys` (the decryption key — the ONE file you never read), `.dev.vars`, `.env.*.local`. Runtime platform secrets: set per environment on the host (`wrangler secret put NAME --env prod`) — a new runtime secret that skips that channel 500s the live route with nothing in the diff to show why.",
        "One seam: `just dx <env> <cmd>` decrypts and injects. Everything env-dependent goes through it — `just dx dev astro dev`, `just dx prod node tools/migrate.ts`. Never `source .env`, never a hand-rolled dotenv import.",
        "The trap worth knowing: `dotenvx decrypt` with no key present succeeds and writes EMPTY values over your file. If a decrypt looks suspiciously quiet, check `.env.keys` exists before you commit anything.",
      ].join("\n"),
    ),

  // The sealed-file rule. It needs a repo that HAS env files; this one has none, which is why
  // flow.config.ts disables it here rather than leaving it sitting dead.
  envEncrypted: guardrail()
    .at(write, commit)
    .on(".env*")
    .ignore(...LOCAL_ONLY)
    .description("A committed .env* file carries no plaintext value — everything but the declared public prefixes is sealed.")
    .check(
      textBan({
        // A KEY=VALUE line whose value is neither an `encrypted:` blob nor empty, and whose key is
        // none of the declared public prefixes. Stated here rather than hidden in a script: which
        // keys a secret-leak rule waves through is the one fact its reader most needs.
        ban: ["^(?!\\s*#)(?!PUBLIC_)(?!DOTENV_PUBLIC_KEY)[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*(?![\"']?encrypted:)(?![\"']?\\s*$).+"],
      }),
    )
    .message(
      "A plaintext value in a committed env file — this is the leak the whole model exists to prevent, and git keeps it forever. Seal it with `just env-encrypt` (PUBLIC_* and the DOTENV_PUBLIC_KEY header stay plaintext by design).",
    )
    .test({
      pass: [{ path: ".env", content: "DOTENV_PUBLIC_KEY=03ab\nAPI_KEY=encrypted:BE9d\nPUBLIC_URL=https://x" }],
      block: [{ path: ".env", content: "API_KEY=sk-live-abcdef" }],
    }),

  noKeysFileInCommits: guardrail()
    .at(commit)
    .on(...LOCAL_ONLY)
    .description("The decryption key and the local overlays can never be committed — the backstop when gitignore breaks.")
    .check(protectedPath({}))
    .message(
      "This file is machine-local and must never be committed: `.env.keys` is the decryption key for every sealed value in this repo, and the `.local` overlays hold real, unencrypted values. The gitignore normally stops this — if you got here, the gitignore is broken.",
    )
    .test({ block: [{ staged: [".env.keys"], world: { fs: { ".env.keys": "k" } } }] }),

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
        ],
      }),
    )
    .message(
      "A live credential shape in staged content. Secrets belong in an encrypted env file (`just env-encrypt`) or in the platform's runtime secret store — never in source, a fixture or a doc. If this is a real key, rotate it: staging it is already most of the way to publishing it.",
    )
    .test({
      pass: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": "const key = process.env.KEY;" } } }],
      // ASSEMBLED, and the rule is why: written whole, the block case IS a live-key shape in
      // staged content, so this entry refuses the commit that adds it. Found the honest way —
      // it blocked the crossing's own commit at `guards/secrets.ts:87`.
      block: [{ staged: ["src/a.ts"], world: { fs: { "src/a.ts": `const k = '${AWS_KEY_SHAPE}';` } } }],
    }),

  // SCOPED ON PATHS, where the YAML entry scoped on COMMANDS (`dotenvx *`, `source .env*`). flow's
  // breadcrumb moments are `session` and `touch`, and both carry a path; there is no command-shaped
  // breadcrumb, because a note about a command you are already running arrives after it ran. The
  // note is worth the same thing one keystroke earlier — when you open the env file.
  dxSeam: breadcrumb()
    .at(touch)
    .on(".env*", "**/*.env")
    .description("Redirects a raw dotenvx or `source .env` invocation to the repo's one seam.")
    .text(
      [
        "Env loading goes through the ONE seam: `just dx <env> <cmd>` (e.g. `just dx dev node tools/reset.ts`). A raw `dotenvx run` picks a different file set than the recipe does, and `source .env` reads encrypted blobs as literal strings — both look like they worked.",
        "Sealing files is `just env-encrypt`. Listing what a file defines, without decrypting anything, is `just env-names <file>`.",
      ].join("\n"),
    ),
});
