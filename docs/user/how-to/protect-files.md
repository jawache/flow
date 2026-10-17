---
summary: "refuse every write, delete and commit of the paths you list, with `protectedPath`"
---

# How to protect files

This guide shows you how to stop anyone changing or deleting files that nobody should edit, such as generated code.

1. Open the pack that holds your repo's rules. If you have none, create `guards/house.ts` and bind it with `pack(house)` in `flow.config.ts`:

   ```
   // guards/house.ts — the rules of this house
   import { banCommands, commit, command, definePack, guardrail, textBan, write } from "@jawache/flow";

   export const house = definePack("house", {
     // …entries…
   });
   ```

   Add `deletion` and `protectedPath` to the import.

2. Add an entry that runs `protectedPath` at `write`, `deletion` and `commit`. List the paths in `.on(…)`:

   ```
   keepGenerated: guardrail()
     .at(write, deletion, commit)
     .on("src/generated/**")
     .check(protectedPath({}))
     .message("Machine-written — edit the source the header names, then re-run the build.")
     .test({ block: [{ path: "src/generated/api.ts", content: "" }] }),
   ```

3. Run `flow test`.

`protectedPath` refuses every file it is called with, and it does not read the file's contents. Which files are protected is set only by the globs in `.on(…)`. The agent is shown the text you pass to `.message(…)`.

**A file identical to the one in the last commit passes.** Only `flow hook commit --all` calls the rule with such a file.

The glob also covers deleting the whole folder. `rm -rf src/generated` removes every file under the folder. Once the command has run, flow judges each removed file and writes back each one the rule refuses.

The `.test` block has `block` cases and no `pass` cases. `pass` lists the inputs the rule must let through, and `block` lists the inputs it must refuse. This rule refuses every edit, so `pass` has nothing to list.

## Variants

- **If you want to keep existing files but allow new ones**, such as in a migrations folder, pass `protectedPath({ existingOnly: true })`. A file that exists can no longer be changed or deleted, and a new file can still be created. At commit, a new file is one the last commit does not have. Keep the rule at `write`, `deletion` and `commit`, so a commit that deletes or renames an existing file is refused too. A rename is refused by its old path. With `existingOnly`, a new file passes, so the `.test` block can list one under `pass`.

## What happens when the rule refuses

- **Through the Edit or Write tool**, the refusal comes first and nothing is written.
- **Through `rm`, `git rm`, `mv` or `git mv` naming a file**, the delete is refused before the command runs. For `mv` and `git mv`, the file being moved away is the one deleted.
- **Through any other shell command**, including `rm -rf` of a folder, the change lands, flow checks it, and flow writes each refused file's previous content back.

[What the guard sees](../explanation/what-the-guard-sees.md) explains the routes.

---

[Index](../index.md) · every option: [`protectedPath`](../checks/protected-path.md) · the verbs of an entry: [the config reference](../reference/config.md#a-guardrail)
