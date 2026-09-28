[flow packs](./index.md) › secrets

# The `secrets` pack

3 guardrails · 1 breadcrumb · fires at: session · write · commit · takes 6 parameters

Env files committed encrypted, decrypted through one seam, and the local-only files kept out of
git.

The orientation is at SESSION, and that is the whole design. Models arrive with a trained
aversion to env files — usually correct, and reinforced by permission denials — which is exactly
wrong for the dotenvx model, where the committed files are encrypted and reading them is the
expected way to work. A touch breadcrumb cannot fix that: the sessions where an agent silently
avoids env work are the sessions it never fires in. So it is said up front, every time.

Three tiers, and every value lives in exactly one: committed-and-encrypted (`.env*`), local
ephemera that must never be committed (`.env.keys`, `.dev.vars`, `.env.*.local`), and runtime
secrets set per environment on the platform.

Generated from `packs/secrets.ts` by `just docs-packs`. Edit the pack, not this page. The commit gate refuses a page that has drifted.

## Binding it

The pack takes 6 parameters. These are facts the pack cannot know about your repo:

| Parameter | Type | What it is |
| --- | --- | --- |
| `publicPrefixes` | `readonly string[]` | The value prefixes that stay plaintext in a committed env file. Defaults to `["PUBLIC_"]`.<br><br>A public value is one a bundler inlines at build time, so sealing it would break the build for nothing. `DOTENV_PUBLIC_KEY` is always allowed beside these — it is dotenvx's own header, not a repo's choice. |
| `localFiles` | `readonly string[]` | The files that must never be committed. Defaults to `[".env.keys", ".env.*.local", ".dev.vars"]`.<br><br>These are also what `envEncrypted` ignores: a file nobody commits cannot carry a committed plaintext value, and the two lists being one is what stops them drifting apart. |
| `envFiles` | `string` | The committed env files, as a glob. Defaults to `.env*`. |
| `extraSecretShapes` | `readonly string[]` | Extra credential shapes to scan staged content for, added to the six this pack ships (Stripe live keys, AWS access keys, private key headers, GitHub and Slack tokens). Defaults to none.<br><br>One regular expression per shape. A vendor whose token this pack has never heard of is a fact only the repo has. |
| `dx` | `string` | The repo's wrapper around dotenvx's runner, called as `<dx> <env> <cmd>` — it decrypts and injects, and every env-dependent command goes through it. Defaults to dotenvx itself, spelled `dotenvx run -f .env.<env> --`, which takes the env file rather than an environment name.<br><br>A wrapper is worth having and this pack cannot guess its name: `just dx` is one fleet's spelling, and written in here it would send every reader of a refusal to a command their repo does not have, in the one sentence they read at the moment they are stuck. |
| `encrypt` | `string` | Seals every env file in place, leaving the public prefixes plaintext. Defaults to dotenvx's own `dotenvx encrypt`, excluding the prefixes above by name. |

Example config. The values are examples, and every glob and command on this page was rendered with them:

```
import { defineConfig, pack } from "@jawache/flow";
import { secrets } from "@jawache/flow/packs";

export default defineConfig([pack(secrets, { dx: "./ci.sh dx", encrypt: "./ci.sh seal" })]);
```

To turn one entry off, say so in the config: `override(secrets.orientation).disabled("why")`. It is a committed change, so a reviewer sees it.

## What to install first

dotenvx — https://dotenvx.com. It is what encrypts the committed files and what runs a
command with them decrypted, and with nothing else in place every sentence below names it
directly. The two command parameters are for a repo that has wrapped it in recipes of its own.

## What the repo needs in place

`.env.keys`, `.dev.vars` and `.env.*.local` in `.gitignore` — the rules below refuse them
in a commit, and an ignore entry is what stops anyone reaching that refusal.

Nothing else is required: unbound, the sentences name dotenvx itself. THIS PACK SHIPS NO FILE
and nothing is copied into a repo. What a repo gains by wrapping the tool is one place to say
which env file each environment means — REFERENCE below, not a file to match: it is a seam that
works as written, to copy and then spell your own way. The environments are the repo's own fact,
and so is the file list the sealing loop walks.

```just
[doc("Run any command with this environment's secrets injected — the ONE env seam. Usage: just dx dev npm run build")]
dx env +cmd:
    dotenvx run {{ if env == "prod" { "-f .env.production -f .env" } else { "-f .env.development.local -f .env" } }} -- {{cmd}}

[doc("Seal every env file in place — everything encrypted except PUBLIC_* (bundlers inline those at build).")]
env-encrypt:
    #!/usr/bin/env bash
    set -euo pipefail
    for f in .env .env.development.local .env.production; do
      if [ -f "$f" ]; then dotenvx encrypt -f "$f" -ek 'PUBLIC_*'; fi
    done

[doc("List the variable NAMES in an env file — no values, nothing decrypted. Usage: just env-names .env")]
env-names file=".env":
    grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' {{file}} | tr -d '=' | sort
```

Bound, that repo hands over `dx: "just dx"` and `encrypt: "just env-encrypt"`. The third job is
nobody's parameter — no sentence in this pack names it — and it is here because an env seam
wants it.

## Adopting it

A repo with no `.env*` at all binds this for `noSecretsInCommits` alone, which is worth
having in a repo that has never held a secret, and turns `envEncrypted` off BY NAME in its
config with the reason on the record — an entry sitting dead is not the same as one opted out of.

## Entries

- [`secrets.orientation`](#secretsorientation--breadcrumb) · breadcrumb · How secrets work here — the three tiers, the one seam, and what you may read.
- [`secrets.envEncrypted`](#secretsenvencrypted--guardrail) · guardrail · A committed env file carries no plaintext value — everything but PUBLIC_ is sealed.
- [`secrets.noKeysFileInCommits`](#secretsnokeysfileincommits--guardrail) · guardrail · The decryption key and the local overlays can never be committed — the backstop when gitignore breaks.
- [`secrets.noSecretsInCommits`](#secretsnosecretsincommits--guardrail) · guardrail · Staged content is scanned for live-key shapes — the leak that arrives outside an env file.

## `secrets.orientation` — breadcrumb

How secrets work here — the three tiers, the one seam, and what you may read.

- **Shown when** once, at the start of a session
- **Watches** not scoped by path
- **Categories** every session

### Why it exists

Without it, an agent avoids the env files on instinct — the trained reflex is right nearly
everywhere else — and either works around the seam or asks a human for values that are
committed, encrypted, three feet away.

### What the agent reads

```
Env files in this repo are COMMITTED and ENCRYPTED (dotenvx): every value is an `encrypted:…` blob except PUBLIC_* config, which bundlers inline at build. Reading and editing them is expected work for you, not a violation — your training says avoid env files, and for plaintext env files it is right; for these it is wrong.
Three tiers, and every value lives in exactly one. Committed and encrypted: `.env`, `.env.production`, `.env.staging`. Local ephemera, never committed and never encrypted: `.env.keys` (the decryption key — the ONE file you never read), `.env.*.local`. Runtime platform secrets: set per environment in the host platform's own secret store — a runtime secret added anywhere else does not reach the running service.
One seam: `./ci.sh dx <env> <cmd>` decrypts and injects. EVERYTHING env-dependent goes through it — the dev server, a migration, a one-off script. Never `source .env`, never a hand-rolled dotenv import.
The trap worth knowing: `dotenvx decrypt` with no key present succeeds and writes EMPTY values over your file. If a decrypt looks suspiciously quiet, check `.env.keys` exists before you commit anything.
```

## `secrets.envEncrypted` — guardrail

A committed env file carries no plaintext value — everything but PUBLIC_ is sealed.

- **Refuses at** a file is written or edited · the commit gate, over the staged set
- **Watches** `.env*`
- **Ignores** `.env.keys` · `.env.*.local` · `.dev.vars`
- **Categories** every session
- **Check** [`textBan`](../checks/text-ban.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "^(?!\\s*#)(?!PUBLIC_)(?!DOTENV_PUBLIC_KEY)[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*(?![\"']?encrypted:)(?![\"']?\\s*$).+"
  ]
}
```

</details>

### Why it exists

Without it, one plaintext value lands in a committed `.env` and the whole model is gone: the
files are committed on the promise that everything in them is sealed.

### What the agent reads when refused

```
A plaintext value in a committed env file — this is the leak the whole model exists to prevent, and git keeps it forever. Seal it with `./ci.sh seal` (PUBLIC_* and the DOTENV_PUBLIC_KEY header stay plaintext by design).
```

### Proved by

**passes**

- writing `.env` — `DOTENV_PUBLIC_KEY=03ab API_KEY=encrypted:BE9d PUBLIC_URL=https://x`

**blocks**

- writing `.env` — `API_KEY=sk-live-abcdef`

## `secrets.noKeysFileInCommits` — guardrail

The decryption key and the local overlays can never be committed — the backstop when gitignore breaks.

- **Refuses at** the commit gate, over the staged set
- **Watches** `.env.keys` · `.env.*.local` · `.dev.vars`
- **Categories** every session
- **Check** [`protectedPath`](../checks/protected-path.md) — no options

### What the agent reads when refused

```
This file is machine-local and must never be committed: `.env.keys` is the decryption key for every sealed value in this repo, and the `.local` overlays hold real, unencrypted values. The gitignore normally stops this — if you got here, the gitignore is broken.
```

### Proved by

**passes**

- committing `.env`
  - given `.env` holds `API_KEY=encrypted:BE9d`

**blocks**

- committing `.env.keys`
  - given `.env.keys` holds `k`

## `secrets.noSecretsInCommits` — guardrail

Staged content is scanned for live-key shapes — the leak that arrives outside an env file.

- **Refuses at** the commit gate, over the staged set
- **Watches** `**`
- **Ignores** `**/*.test.*` · `**/*.spec.*`
- **Categories** every session
- **Check** [`textBan`](../checks/text-ban.md)

<details><summary>settings</summary>

```
{
  "ban": [
    "sk_live_[0-9a-zA-Z]{16,}",
    "rk_live_[0-9a-zA-Z]{16,}",
    "AKIA[0-9A-Z]{16}",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "ghp_[0-9A-Za-z]{30,}",
    "xox[baprs]-[0-9A-Za-z-]{10,}"
  ]
}
```

</details>

### What the agent reads when refused

```
A live credential shape in staged content. Secrets belong in an encrypted env file (`./ci.sh seal`) or in the platform's runtime secret store — never in source, a fixture or a doc. If this is a real key, rotate it: staging it is already most of the way to publishing it.
```

### Proved by

**passes**

- committing `src/a.ts`
  - given `src/a.ts` holds `const key = process.env.KEY;`

**blocks**

- committing `src/a.ts`
  - given `src/a.ts` holds `const k = 'AKIA…';`

## Where each part of this page comes from

| On the page | In the pack | Read how |
| --- | --- | --- |
| Lead, and the parameters table | The doc comment on `definePack`, and the doc comment on each member of the parameter interface | JSDoc, read with the TypeScript compiler API |
| The named sections above the entries | An `@install`, `@setup` or `@adopt` tag on that same doc comment. A tag nobody uses renders nothing. | JSDoc tags |
| Entry id, kind, moments, globs, categories, description | The entry itself — `.at()` `.on()` `.description()` | Loaded: the same data the engine runs |
| Why it exists | The doc comment on the entry's key. Required on a breadcrumb; optional on a guardrail whose message already gives the reason. | JSDoc |
| What the agent reads | `.text()` or `.message()`, verbatim | Loaded |
| Check and its settings | The check the entry asks, and the options it was given | The name from the pack's source. The settings are read off the check, so they are the values a parameter supplied. |
| Proved by, and what each case was told | `.test({ pass, block })` — the event, and the `world` the case supplies for whatever the check reads | Loaded |

---

flow docs · [the packs](./index.md) · `secrets` · generated page, do not edit
