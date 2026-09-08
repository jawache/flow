# just/secrets.just — THIS REPO'S OWN env seam, and nothing ships it.
#
# The `secrets` pack ships no file. It takes two optional command names, defaulting to dotenvx's
# own spelling, and flow.config.ts hands it this repo's instead (`just dx` · `just env-encrypt`) so
# that every sentence a stuck reader meets names a command this repo really has. Rename a recipe
# here and the config's parameter is what has to follow it — nothing resolves by convention.
#
# `env-names` is nobody's parameter: the pack stopped asking for a list-names command when the
# breadcrumb that was its only reader went. The recipe stays because it is worth having.
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
    # `if`, NOT `[ -f "$f" ] && …`. Under `set -e` the test IS the last command of the loop body,
    # so a missing final file — and .env.staging is missing in most repos — makes the whole recipe
    # exit 1 having done its work. The `echo` below hid it here; a repo copying the seam without
    # one got a red recipe for no reason.
    for f in .env .env.development.local .env.staging .env.production; do
      if [ -f "$f" ]; then dotenvx encrypt -f "$f" -ek 'PUBLIC_*'; fi
    done
    echo "sealed. Re-run after editing values; quote # / $ / space values with SINGLE quotes or they truncate."

[doc("List the variable NAMES in an env file — no values, no decryption, safe to paste. Usage: just env-names .env")]
env-names file=".env":
    @grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' {{file}} | tr -d '=' | sort
