// flow/guards/work.ts — NOT BOUND: flow.config.ts does not import this pack. Its one breadcrumb
// watches `.work/`, which git ignores, so git never reports a change there and it can never fire.
// The file stays until `house.noDeleteGuards` lets it be deleted.
//
// What a repo that runs the `work` lifecycle would tell its agents about the record.
//
// ONE BREADCRUMB. The command rules this pack carried (a builder may not run the parent's `work plan`
// verbs, a parent does not tick a box, nobody files an inbox item) are gone: flow 0.4 judges a
// command by its words and not by who runs it, and those rules are work's own to keep, in work.

import { breadcrumb, definePack, fileChange } from "@jawache/flow";

/**
 * What the `work` lifecycle's record needs a session to know.
 *
 * IT IMPORTS NOTHING FROM WORK. It is a plain consumer of flow's public door, like every other
 * pack here.
 *
 * @install The `work` CLI, which keeps its record in a `.work/` folder that may be a link.
 */
export const work = definePack("work", {
  // ── the record ──

  /**
   * Without it, Node code run from a `.work/` that is a link resolves its imports from the link's
   * real path, finds no `node_modules` and no `"type": "module"`, and fails with an import error
   * that does not name the link.
   */
  nodeInTheRecord: breadcrumb()
    .at(fileChange)
    .on(".work/**")
    .description("Node code run from a linked record needs the Node settings that keep the link's path.")
    .text(
      '`.work/` links out of the repo. Run Node code there with `NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main"`, or it cannot find the repo\'s packages. Call the tool by `node_modules/.bin/<tool>`: that setting breaks `npx`.',
    ),
});
