---
summary: "move a project to a newer flow: change the pin, follow the migration guides, validate, commit"
---

# How to upgrade flow in a project

This guide shows you how to move one project from the flow it pins to a newer release.

1. Read the migration guide of each release between your version and the new one. `npx flow --version` prints yours. The guides are in [migrations](../migrations/index.md).

2. Change the pin:

   ```
   npm i -D --allow-git=root github:jawache/flow#v0.4.0
   ```

3. Make the changes each guide lists, in order.

4. Run `flow init` again. It rewrites a hook registration that an older flow wrote:

   ```
   npx flow init
   ```

   Under Codex, approve the hooks again with `/hooks` if `flow init` rewrote them.

5. Validate. The upgrade is good when all three pass:

   ```
   npx flow status            # every fitting green
   npx flow test              # every rule's cases pass
   npx flow hook commit --all # every rule with .on(…) passes over the whole repo
   ```

6. Commit `package.json`, the lockfile, and every file steps 3 and 4 changed.

---

[Index](../index.md) · the guides: [migrations](../migrations/index.md) · the first install: [how to install and pin flow](./install-flow.md)
