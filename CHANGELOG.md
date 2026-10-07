# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.2](https://github.com/jawache/flow/compare/v0.2.1...v0.2.2) (2026-10-07)

### Features

* **commit:** flow hook commit asks git for the staged changes, and checks deletions at commit ([f91b3a7](https://github.com/jawache/flow/commit/f91b3a7f95e6e28e54638f4e8c66386cdc16cdf5)), closes [#6](https://github.com/jawache/flow/issues/6)
* **package:** the npm package ships its migration guides ([c3af8b1](https://github.com/jawache/flow/commit/c3af8b1abeb9de802695c1dc870c9c0e2740ff25))

### Bug Fixes

* **adapter:** flow init and flow status give the old-hook fix as one clean sentence ([908a31c](https://github.com/jawache/flow/commit/908a31c675a0473714fa51061ee9490236dba4f7))
## [0.2.1](https://github.com/jawache/flow/compare/v0.2.0...v0.2.1) (2026-10-02)

### Bug Fixes

* **packs:** a recipe is earned by regular use, not by a human running it ([14caca8](https://github.com/jawache/flow/commit/14caca84a1d7b8d20057a907c5ecc2ec1b407710))
## [0.2.0](https://github.com/jawache/flow/compare/v0.1.2...v0.2.0) (2026-10-01)

### ⚠ BREAKING CHANGES

* **checks:** a repo's own banCommands rule no longer matches text
  inside a heredoc. Set matchHeredocs: true to keep the old behaviour.
* **packs:** the `docs` pack no longer ships `docs.noMarkdownInUserDocs`.
  A repo that bound `docs` to keep markdown out of its user docs loses that
  refusal; a repo that overrode the entry must drop the override, which names an
  entry the pack no longer has and therefore refuses to load. `docs.docsShape`
  still holds the two doors, and its message no longer calls `user/` HTML.
* **adapter:** writes made by a background command after its call
  returns are now reverted when a rule refuses them, instead of reported.

### Features

* **adapter:** a file a Bash command reads briefs its area before the command runs ([2525dfd](https://github.com/jawache/flow/commit/2525dfd1c5afc4fe5b7af18ad885dc4152500660))
* **adapter:** a refusal under overlap puts back only the refused files, and a background command's writes are reported ([6c8529a](https://github.com/jawache/flow/commit/6c8529a3a4629c2637b1ebfd488588cfe7022b34))
* **adapter:** every tool call is snapshotted, diffed and judged, and a refused write is put back ([c963ac2](https://github.com/jawache/flow/commit/c963ac2118fcf227bd05ababbe19f4d459ea4f54))
* **adapter:** the log records what went round the tool rows, and facts and status report it ([7d27831](https://github.com/jawache/flow/commit/7d278318c1ca0f9df4fe9c448c53ea4f2ebb7490))
* **checks:** a repo can let only named rungs write, through the oneWriter check and ctx.actor ([62b5fb2](https://github.com/jawache/flow/commit/62b5fb2a4107b21014ec3ac39087cd963830ba1e))
* **checks:** command bans leave heredoc text out, unless a rule sets matchHeredocs ([caebd04](https://github.com/jawache/flow/commit/caebd04579b9e35cffb09bd61a1bd764b784ad52))
* **checks:** one function elides a command's heredoc bodies, and the read lexer shares its shell primitives ([352739a](https://github.com/jawache/flow/commit/352739af96c15d89de5d798891c241187431ba85))
* **packs:** user docs may be markdown; docs/user converted from HTML ([fcb3e7f](https://github.com/jawache/flow/commit/fcb3e7f8de9414b56e9bf6d681ffb0c04f7693a2))
* **tools:** score any Bash path extractor against the corpus, per mechanism and trap ([e95facc](https://github.com/jawache/flow/commit/e95facc4eea2efab6fd5653a6026b96f10724f38))
* **tools:** three Bash read extractors, scored side by side on the corpus ([f4c49b7](https://github.com/jawache/flow/commit/f4c49b791615c566847ffb24bb854fc6f6fc0945))

### Bug Fixes

* **adapter:** a background command gets no special treatment, and its later writes are judged like any other ([6de448b](https://github.com/jawache/flow/commit/6de448b9df3486da60e38f6a2f9ce5dbc572bfa1))
* **adapter:** an rm target written again is judged as a write, and an unread after-call payload is loud ([0de5f1b](https://github.com/jawache/flow/commit/0de5f1b843a094fc43da8204e829a255c8ff53bb))
* **build:** tsconfig includes by glob, so a worktree named repo.branch still typechecks ([177f3e1](https://github.com/jawache/flow/commit/177f3e18da645cd33aff5369c37f67625f54a618))
* **checks:** a heredoc is the commit message only when the commit reads stdin ([d909238](https://github.com/jawache/flow/commit/d90923860f163fc1f2ca50a53926b564a6aa0fac))
## [0.1.2](https://github.com/jawache/flow/compare/v0.1.1...v0.1.2) (2026-09-16)

### Features

* **flow:** a fence layer that is not a glob refuses to load, and a layer may have holes in it ([5e956e4](https://github.com/jawache/flow/commit/5e956e4d651f9565cfd0c6eb78dd1394529cf4de))
## [0.1.1](https://github.com/jawache/flow/compare/v0.1.0...v0.1.1) (2026-09-16)

### Features

* **flow:** a config may declare its own ast-grep grammar, and a note may be attached to a command ([1e9f603](https://github.com/jawache/flow/commit/1e9f6038ccd28500acebd82423899ad517ef9fde))
## 0.1.0 (2026-09-15)

### ⚠ BREAKING CHANGES

* **flow:** `conventionalCommit`, `noGitDiscard`, `noHandEditedVersion`,
  `justfileDocs` and `lockfileInStep` are no longer exported from `@jawache/flow/packs`.
  Bind the pack that carries them, or write the check in your own house pack.
* **flow:** `newCommandNeedsCaller` and `Surface` are gone from
  `@jawache/flow/packs`. Bind `commitReason({ diffAdds: [{ file, patterns, known }],
  token })` from `@jawache/flow` instead.
* **flow:** the `guard` pack is now `flow`, and its entry ids are `flow.*`. In a
  config, `import { flow } from "@jawache/flow/packs"` and `pack(flow, { packs: [...] })`;
  an `override(guard.editingTheGuardrails)` becomes `override(flow.editingTheGuardrails)`.
* **flow:** the crossing — this repo's guard runs on flow, and the old engine is deleted
* **packs:** the fcis pack loses two entries nobody could use, and gains the sibling convention
* **packs:** the git pack, as the human read it
* **packs:** the typescript pack stops assuming a shared base file

* **flow:** each pack carries the checks it is written in, and the bag is gone ([45111bb](https://github.com/jawache/flow/commit/45111bbfe4cdf16d02c9d89bf44464907f8d21d9))
* **flow:** the guard pack is the flow pack, and the end-to-end suites get a folder ([f6dbc39](https://github.com/jawache/flow/commit/f6dbc391e20bc3cae5fa9671358a6e8629972a4a))
* **flow:** the verb ratchet is a third condition on commitReason, not a check of its own ([190b667](https://github.com/jawache/flow/commit/190b66705e132fc1dd91bae8c935cec351a0ab31))
* **packs:** the fcis pack loses two entries nobody could use, and gains the sibling convention ([6f69bd9](https://github.com/jawache/flow/commit/6f69bd913d7532ab355905c14826dcdbbc140d6a))
* **packs:** the git pack, as the human read it ([8db9014](https://github.com/jawache/flow/commit/8db9014d6a28fd5ef939eca1d40b74d59ff38090))
* **packs:** the typescript pack stops assuming a shared base file ([c423aad](https://github.com/jawache/flow/commit/c423aad6a7f206188dc98ce3863eb89d418b2706))

### Features

* **docs:** a pack page shows the settings a rule was configured with, and every slot it is built from is filled ([adec54e](https://github.com/jawache/flow/commit/adec54e055a620fa177650a50e1fe7edd77ea5c2))
* **docs:** every shipped pack has a generated page, and the gate refuses one that has drifted ([5664127](https://github.com/jawache/flow/commit/5664127c0e69335a825cd9437a88280464c5bea9))
* flow is its own repo — its history, its tooling, its guard ([ba3f34e](https://github.com/jawache/flow/commit/ba3f34ebc516d3c344361a7695cef3def08f9fb2))
* **flow:** a broken config still admits the write that repairs it ([1e90fd5](https://github.com/jawache/flow/commit/1e90fd55652941a0636cc543159da40c1a8f3526))
* **flow:** a pack may take parameters that are all optional, and docs and tdd take theirs ([791afca](https://github.com/jawache/flow/commit/791afcab833fa8bd18a201ca6c0a6234540ac7b0))
* **flow:** checks read the world through ctx, and the package is laid out by pipeline stage ([2dfd2a9](https://github.com/jawache/flow/commit/2dfd2a9e5479995d0a9e41cf52de6ff57be6b7f5))
* **flow:** one adapter speaks Claude Code — payloads become events, effects become an exit code ([ce9a129](https://github.com/jawache/flow/commit/ce9a129140a70cd2f2ca8629429c6d085cb83b58))
* **flow:** one command binds every pack in a stranger's repo and drives all five rails ([510b14d](https://github.com/jawache/flow/commit/510b14da0a45a5f7770ecdf5415f93a3a04cfeea))
* **flow:** the archival side — the store read, the record read back, and a recorded session replayed ([5955291](https://github.com/jawache/flow/commit/59552918b3001620fb19e0f293a5c764e7a8b232))
* **flow:** the crossing — this repo's guard runs on flow, and the old engine is deleted ([36767c3](https://github.com/jawache/flow/commit/36767c3b9ca080281d3058bf93101dab8b1b977b))
* **flow:** the engine matches, classifies sessions, and fails loudly ([170ba2c](https://github.com/jawache/flow/commit/170ba2c31a43a534f84013c4e2b8913a5f1a9657))
* **flow:** the package exists, and its grammar refuses bad config in the editor ([bbea4df](https://github.com/jawache/flow/commit/bbea4df717d49a91b6cdf1a2d92d2587e6252141))
* **flow:** the product surface — init scaffolds a drivable repo, status answers what is bound, and a dead scope refuses ([6315016](https://github.com/jawache/flow/commit/6315016ee518468551c0bae5a21383cdf2738beb))
* **packs:** no pack ships a file, and the two that claimed to stop claiming it ([7df4495](https://github.com/jawache/flow/commit/7df4495d522bdbce41451bfd2b2df8081f6559ed))

### Bug Fixes

* **checks:** a leading cd names the working tree a git command is about, as -C already did ([d83c300](https://github.com/jawache/flow/commit/d83c300fdc67558d1ab3492c926954a5b68595f8))
* **docs:** a case on a pack page carries the world it canned, and the page stops printing a key shape whole ([a8300ca](https://github.com/jawache/flow/commit/a8300ca0238f98241428623cbaffcdaa4f38143f))
* **docs:** a pack page's settings read one per line, and the page's own sentences go plain ([74223d0](https://github.com/jawache/flow/commit/74223d0cd3884daf4ced2a3125fbbb7b06ade02f))
* **docs:** the engine's own surface, read against the binary rather than off the page ([3011b80](https://github.com/jawache/flow/commit/3011b80756ad654efdbbcc9d37b2f84599cdc99e))
* **flow:** flow loads the guarded repo's TypeScript itself, so a CommonJS repo can be guarded ([0b39dcb](https://github.com/jawache/flow/commit/0b39dcba3702d6ea0d54d71060a20fcf100273f3))
* **flow:** init replaces a dangling @jawache/flow link instead of tripping over it ([5a75197](https://github.com/jawache/flow/commit/5a75197347637f69fae9feb4631daf982aa87daf))
* **flow:** one shell quoter for the packs, and three sentences the move made false ([c00e0e5](https://github.com/jawache/flow/commit/c00e0e557a49eed44304953c0e9a5a7f9f54edd4))
* **flow:** the fcis pack proves itself with the repo's own pure file, not ours ([f1052a8](https://github.com/jawache/flow/commit/f1052a80885aa29d03f57166d8529cadfe19b912))
* **flow:** the live World gets a suite, and the commit gate learns who was working ([62b98b7](https://github.com/jawache/flow/commit/62b98b79d3ddc51a0396b614e343492dacb5f775))
* **flow:** the repair carve-out covers every load failure, and every hand-written claim is pinned ([39c780d](https://github.com/jawache/flow/commit/39c780def4ca9e3a1e727be11716997c0ad2f3ea))
* **flow:** the review round — a dead ratchet, a fence with a hole in it, and five smaller truths ([30964a0](https://github.com/jawache/flow/commit/30964a0c8384fa96d9eb41dd2172c0a28585a8f2))
* **flow:** the review round — the force-push ban anchors to a command, a bare filename is a path, git reads honour -C, the suites build to a temp dist ([c5f53d6](https://github.com/jawache/flow/commit/c5f53d6dc1ed2cdd371a3152386d089001fc85dd))
* **flow:** the review round on F2 — one home per fact, and the docs catch up ([ae7fe6a](https://github.com/jawache/flow/commit/ae7fe6aa4d450ebc12704e9578a02fb01e56edff))
* **just:** the seam's sealing loop stops exiting 1 on a file the repo does not have ([1f17101](https://github.com/jawache/flow/commit/1f171019855c38970d7304f4ea2a72972dede49f))
* **packs:** a bare git checkout discards exactly as the -- form does, and is refused the same way ([918aff4](https://github.com/jawache/flow/commit/918aff4366f19b910cc18c331ec1054544e0beae))
* **release:** the tarball is only what a clean clone would emit, and the pages say how to install it ([9f88873](https://github.com/jawache/flow/commit/9f8887349106d20bc6d5ae7443af8db4f4a363bb))
