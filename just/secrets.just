# just/secrets.just — the env seam: the three recipes flow's `secrets` pack talks about.
#
# The pack ships the three JOBS and names them in its notes and its refusals; this file is how
# THIS repo spells them, and flow.config.ts hands the pack the three command strings
# (`just dx` · `just env-encrypt` · `just env-names`). Rename a recipe here and the config's
# parameter is what has to follow it — nothing resolves by convention.
#
# It is a plain committed file, compared with nothing: the old library copied it in and checked it
# for drift forever, and that machinery went with the old engine. What holds it now is review.
#
# Which environments exist is the repo's own fact: the `dx` recipe below reads dev|staging|prod,
# and a repo with only dev|prod simply never passes staging.

[doc("Run any command with this environment's secrets injected — the ONE env seam. Usage: just dx dev npm run build")]
dx env +cmd:
    @dotenvx run {{ if env == "prod" { "-f .env.production -f .env" } else if env == "staging" { "-f .env.staging -f .env" } else { "-f .env.development.local -f .env" } }} -- {{cmd}}

[doc("Encrypt every env file in place — everything sealed except PUBLIC_* (bundlers inline those at build).")]
env-encrypt:
    #!/usr/bin/env bash
    set -euo pipefail
    for f in .env .env.development.local .env.staging .env.production; do
      [ -f "$f" ] && dotenvx encrypt -f "$f" -ek 'PUBLIC_*'
    done
    echo "sealed. Re-run after editing values; quote # / $ / space values with SINGLE quotes or they truncate."

[doc("List the variable NAMES in an env file — no values, no decryption, safe to paste. Usage: just env-names .env")]
env-names file=".env":
    @grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' {{file}} | tr -d '=' | sort
