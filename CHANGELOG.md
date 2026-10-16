# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.0](https://github.com/jawache/flow/compare/v0.2.3...v0.3.0) (2026-10-16)

### ⚠ BREAKING CHANGES

* **checks:** `forbid: ["sdp"]` and `warn: ["sdp"]` are gone; a config with a `warn` key is refused at load.
* **checks:** a banCommands entry and a justfile recipes key are a command in words, not a
  regex. A regex entry refuses to load; one that spans two commands moves under wholeLine: true.
  matchHeredocs is removed.
* **language:** a config whose breadcrumb, or override of one, says
  both `.text(…)` and `.file(…)` no longer loads; it is refused as
  `double-prose`. Before, it loaded and `.text(…)` was shown.
* **language:** a config with `.on()` or `.ignore()` given no globs, on
  an entry or an override, no longer loads; it is refused as `empty-scope`.
* **language:** a guardrail whose `.test(…)` holds only pass cases no longer
  loads; it is refused with `no-cases`. Add a block case, an input the rule must
  refuse, to `.test({ block })` on any such guardrail.
* **checks:** substitutionInProse names each head in words, matched as banCommands matches an entry (#124)
* **checks:** the depcruise check has no `warn` option. A config that passes
  `warn: ["sdp"]` no longer typechecks; write `forbid: ["sdp"]` instead.
* **language:** the refusal code no-cases is renamed no-block-cases. Anything
  matching on the code, or on REFUSAL_CODES, must use the new name.
* **checks:** tokenizeCommand, gitInvocations and GitInvocation are no
  longer exported. Read ctx.commands, shellCommands or gitCommands instead.

* **checks:** remove the hand-written shell scanners, the parse is the one reader ([#46](https://github.com/jawache/flow/issues/46)) ([63ba586](https://github.com/jawache/flow/commit/63ba586b61884d91314f7d1344bee2f9b207ca65))

### Features

* **adapter:** a pre-commit hook git runs without the execute bit does not count as calling flow ([#134](https://github.com/jawache/flow/issues/134)) ([99a3d61](https://github.com/jawache/flow/commit/99a3d61862a20753a23b70a7dc06e2cdb4ef390c))
* **adapter:** a turn-end breadcrumb is shown as a note when an agent hands back ([#104](https://github.com/jawache/flow/issues/104)) ([9e8b849](https://github.com/jawache/flow/commit/9e8b849193f500ab30ecd8a22aa5209c02744cbd))
* **adapter:** delete and read detection read the parse ([#45](https://github.com/jawache/flow/issues/45)) ([be9fb40](https://github.com/jawache/flow/commit/be9fb40ce75e9c395daa9e63b065f35e291f115e))
* **adapter:** flow hook subagent-stop runs the turn-end rules for the subagent that hands back ([#101](https://github.com/jawache/flow/issues/101)) ([773b9d5](https://github.com/jawache/flow/commit/773b9d5bfb8a22dd935bb80a680bceaf9dda007c))
* **adapter:** flow init leaves other git hooks alone and ends with FLOW IS NOT INSTALLED ([#129](https://github.com/jawache/flow/issues/129)) ([05f1fee](https://github.com/jawache/flow/commit/05f1feee34e35a394be587ec2eba3baad28f7588))
* **adapter:** flow init registers SubagentStop, and flow status checks it ([#102](https://github.com/jawache/flow/issues/102)) ([00a9db9](https://github.com/jawache/flow/commit/00a9db9cd8ee399ae2b50cf47a56c06c0d4372fe))
* **adapter:** flow status says FLOW IS NOT INSTALLED when git runs other hooks without flow ([#130](https://github.com/jawache/flow/issues/130)) ([6c31002](https://github.com/jawache/flow/commit/6c3100246e47591230029e577db1a5d6da634eb6))
* **adapter:** flow uninstall names another folder's pre-commit hook that still calls flow, and leaves it as it is ([#141](https://github.com/jawache/flow/issues/141)) ([da654c8](https://github.com/jawache/flow/commit/da654c84f45efc4bbe7e08d64579e4a4e9dd2b68))
* **adapter:** init reads whether git already runs other hooks, and which pre-commit hook it runs ([#129](https://github.com/jawache/flow/issues/129)) ([6f0b924](https://github.com/jawache/flow/commit/6f0b92412abae7ad1c19f31e5510ef4f4ec868b4))
* **adapter:** recipe detection reads the parse, a line holding a heredoc included ([#45](https://github.com/jawache/flow/issues/45)) ([47d53ef](https://github.com/jawache/flow/commit/47d53efae0d0635e9f945ebbf92116ebeada9e54))
* **adapter:** status reads the folder git runs hooks from, as init does ([#130](https://github.com/jawache/flow/issues/130)) ([e9a5bf9](https://github.com/jawache/flow/commit/e9a5bf9515cd10f8b7ed3f45ee295399d400ac98))
* **adapter:** the block's first fix says to make the hook executable, or to create it as a shell script ([#134](https://github.com/jawache/flow/issues/134)) ([9d4e980](https://github.com/jawache/flow/commit/9d4e9805d2dec4646b3761257612b40712d97cf9))
* **adapter:** the FLOW IS NOT INSTALLED block is bold red in a terminal ([#129](https://github.com/jawache/flow/issues/129)) ([1573e6b](https://github.com/jawache/flow/commit/1573e6ba7ac6a1019a273bf9db9416b681572c26))
* **checks:** a commit message given as a heredoc in a substitution is read as the heredoc's body ([#44](https://github.com/jawache/flow/issues/44)) ([7e071c4](https://github.com/jawache/flow/commit/7e071c4c32ca65fb88349c41f88915b7cf59dc34))
* **checks:** banCommands matches each command from its program name ([#43](https://github.com/jawache/flow/issues/43)) ([cb62d6c](https://github.com/jawache/flow/commit/cb62d6c4a64c8060a6f8e114f1682c093f79e4ef)), references [#14](https://github.com/jawache/flow/issues/14) [#9](https://github.com/jawache/flow/issues/9) [#4](https://github.com/jawache/flow/issues/4)
* **checks:** banCommands names each banned command in words, and matches its program and arguments ([#123](https://github.com/jawache/flow/issues/123)) ([dc43ed7](https://github.com/jawache/flow/commit/dc43ed756c8b4566390d792a0190c03c038d15e7))
* **checks:** sdp is a depcruise forbid form, and the warn option is gone ([#120](https://github.com/jawache/flow/issues/120)) ([9fda0e0](https://github.com/jawache/flow/commit/9fda0e0776bda4e4ca41a15a1d78c5eb27492dc1))
* **checks:** substitutionInProse is a check that reads the parse's backtick substitutions ([#44](https://github.com/jawache/flow/issues/44)) ([a446daa](https://github.com/jawache/flow/commit/a446daa2e63e710583074eb3e5960bb13c81b918))
* **checks:** substitutionInProse names each head in words, matched as banCommands matches an entry ([#124](https://github.com/jawache/flow/issues/124)) ([4001816](https://github.com/jawache/flow/commit/4001816765f5b2f1f6e93482222ade98ed968209))
* **checks:** symbolsInSibling reads every name an export const binds, each declarator and each name a destructuring pattern binds ([#97](https://github.com/jawache/flow/issues/97)) ([7d7e4f3](https://github.com/jawache/flow/commit/7d7e4f3a17d5f9c0fe29959d05f6a6f0f1d7a037))
* **checks:** the commit message and the git safety rail read git commands from the parse ([#44](https://github.com/jawache/flow/issues/44)) ([3d601e4](https://github.com/jawache/flow/commit/3d601e463f88d07e2d67f544df3e9e0dbb88fa5a))
* **checks:** the depcruise sdp rule is removed, and a leftover warn option says to delete it ([#132](https://github.com/jawache/flow/issues/132)) ([b54bf2b](https://github.com/jawache/flow/commit/b54bf2b0b0a0b1ed50bc233527c87cf404367a09))
* **hook:** a config that will not load lets every write, delete and command through and tells the agent why, and the repair exception is gone ([#51](https://github.com/jawache/flow/issues/51)) ([c51fed7](https://github.com/jawache/flow/commit/c51fed72eaae0b7603695c529bb77c36fceebee0))
* **house:** a breadcrumb tells an agent every reading of a command goes through the one parse ([#46](https://github.com/jawache/flow/issues/46)) ([67619ce](https://github.com/jawache/flow/commit/67619ce2ec94430b71a5a8481eea36d1aa524f93))
* **init:** a repo whose package.json lists flow gets the hooks in its own .claude/settings.json, for init and status ([#67](https://github.com/jawache/flow/issues/67)) ([a69bb46](https://github.com/jawache/flow/commit/a69bb46d12ec73cd65da42abc035eb179d5d0d5f))
* **init:** flow init rewrites flow's old bare `flow hook <event>` registrations in place to the new command ([#66](https://github.com/jawache/flow/issues/66)) ([2c06235](https://github.com/jawache/flow/commit/2c06235ad30c1006ce8a5b14aaa8be13a04de242))
* **init:** the gate and the hook commands put the repo's node_modules/.bin first on the PATH ([#66](https://github.com/jawache/flow/issues/66)) ([464d691](https://github.com/jawache/flow/commit/464d691aa62a5d65a2f1c6bd0d9ba5fcc324c857))
* **language:** `.on()` and `.ignore()` with no globs are a compile error on every chain ([#75](https://github.com/jawache/flow/issues/75)) ([9f6b62f](https://github.com/jawache/flow/commit/9f6b62ffa6b464d354519b0c81525db40062adf5))
* **language:** a breadcrumb or override that said `.text(…)` cannot say `.file(…)`, nor the reverse ([#75](https://github.com/jawache/flow/issues/75)) ([9566122](https://github.com/jawache/flow/commit/95661228992bc97ceb370bd7eca96041084cc3d3))
* **language:** a breadcrumb with both `.text(…)` and `.file(…)` is refused as double-prose, and an override's prose replaces the pack's ([#74](https://github.com/jawache/flow/issues/74)) ([dfdce68](https://github.com/jawache/flow/commit/dfdce68917201491b74d7446000681fad5a02f61))
* **language:** a guardrail with no block case does not load ([#71](https://github.com/jawache/flow/issues/71)) ([1e8fbb6](https://github.com/jawache/flow/commit/1e8fbb622958d1597df3aa3fa3f66b04212e600e))
* **language:** a here-string fed to a shell is read as that shell's commands ([#95](https://github.com/jawache/flow/issues/95)) ([9103f4e](https://github.com/jawache/flow/commit/9103f4ef29963daccc7ed6ea4e82c0c415bb5950))
* **language:** ctx.commands carries the parse wherever ctx.command is ([#48](https://github.com/jawache/flow/issues/48)) ([c2bdb95](https://github.com/jawache/flow/commit/c2bdb95036ebf5b4f68da8fb2639bff19c7c2641))
* **language:** each command in the parse lists its redirects, a group's or a loop's on each command inside it ([#44](https://github.com/jawache/flow/issues/44)) ([63d0e41](https://github.com/jawache/flow/commit/63d0e41e7ec408060cf1720d1f3ece98c2726a1a))
* **language:** each substitution lists the commands it runs and the argument it is the whole of ([#95](https://github.com/jawache/flow/issues/95)) ([d2e256b](https://github.com/jawache/flow/commit/d2e256bd3d358986946781260ac75f5f7bd55aec))
* **language:** parse a shell command line as bash into its simple commands ([#48](https://github.com/jawache/flow/issues/48)) ([2f72f8d](https://github.com/jawache/flow/commit/2f72f8d4d5e0f2768c4b1e1f5b4891b4b98fa0e0))
* **language:** the load refuses an `.on()` or `.ignore()` with no globs as empty-scope ([#74](https://github.com/jawache/flow/issues/74)) ([7bee3d5](https://github.com/jawache/flow/commit/7bee3d5759d0520f6ce8373f31755f52e029da34))
* **language:** the parse cuts a line's heredoc bodies by where it found them ([#43](https://github.com/jawache/flow/issues/43)) ([102b22d](https://github.com/jawache/flow/commit/102b22d0787882975f06bd48f6c02debe236516c))
* **language:** the parse lists its steps in the order the shell runs them ([#45](https://github.com/jawache/flow/issues/45)) ([689ef0b](https://github.com/jawache/flow/commit/689ef0b87a585bb903d7b97ed386506e774f5685))
* **language:** the parse reads a heredoc piped into a shell, and a here-string as an argument ([#43](https://github.com/jawache/flow/issues/43)) ([662c334](https://github.com/jawache/flow/commit/662c334517bbc177e6eb3186cba13adbe612733d))
* **language:** the refusal for a guardrail with no block case is no-block-cases ([#87](https://github.com/jawache/flow/issues/87)) ([4df86d0](https://github.com/jawache/flow/commit/4df86d02f264187f62d6b15099af6dc955f68be7))
* **log:** a first-touch or drift breadcrumb row names the file or command that showed it ([#106](https://github.com/jawache/flow/issues/106)) ([543f167](https://github.com/jawache/flow/commit/543f167913b3d62431a77913c8ef6ec64454d31d))
* **log:** every row after meta names the agent it came from, and a subagent's type ([#105](https://github.com/jawache/flow/issues/105)) ([cca5f29](https://github.com/jawache/flow/commit/cca5f299836d620edb2d3c10d537184562621fcf))
* **log:** the commit gate's rows name the committing agent's type, from the session marker ([#105](https://github.com/jawache/flow/issues/105)) ([f502c66](https://github.com/jawache/flow/commit/f502c66b4ab7d77614d930cc9545175f8e0451e2))
* **packs:** the flow pack refuses flow uninstall when an agent runs it, and its page and the machine test's census say so ([#117](https://github.com/jawache/flow/issues/117)) ([644193d](https://github.com/jawache/flow/commit/644193ddbd60424a324b0427f5246f04ee93d2d4))
* **packs:** the git pack refuses a commit or a ref the commit gate never runs on ([#77](https://github.com/jawache/flow/issues/77)) ([ce78794](https://github.com/jawache/flow/commit/ce78794de63a782c805d3cabff1b7e34c1817532))
* **packs:** the secrets pack tells the agent where the key is, by custody, and seals with --no-native only for .env.keys ([#68](https://github.com/jawache/flow/issues/68)) ([9e11b42](https://github.com/jawache/flow/commit/9e11b42b0eb1ce2cbe522426156c044a0e98cdeb))
* **skills:** a release skill that writes the migration guide and cuts the release ([bf08a1c](https://github.com/jawache/flow/commit/bf08a1c002bc7212a23300163c9d54fbbd3b2665))
* **status:** a binary fitting says whether the hooks and the gate can find flow, in node_modules/.bin or on the PATH ([#65](https://github.com/jawache/flow/issues/65)) ([2e64274](https://github.com/jawache/flow/commit/2e64274e9e3a6a55f2a37abff2728d610c1ff882))
* **status:** the binary fitting judges the gate and the registrations as written ([#66](https://github.com/jawache/flow/issues/66)) ([f1b9560](https://github.com/jawache/flow/commit/f1b9560d16d7eeb4b7ce657ba4ba1a228edc263f))
* **uninstall:** --machine takes flow's hooks out of the machine-wide settings file, and nothing else does ([#116](https://github.com/jawache/flow/issues/116)) ([95ed343](https://github.com/jawache/flow/commit/95ed3438ddd41c64508223e1628ea6239de736f8))
* **uninstall:** a plain run says the machine-wide file still holds flow's hooks, and names flow uninstall --machine in its last line ([#116](https://github.com/jawache/flow/issues/116)) ([12f55f4](https://github.com/jawache/flow/commit/12f55f412528ffa308e98b40be8b27124701b9ba))
* **uninstall:** flow uninstall is a verb, listed in the help text ([#115](https://github.com/jawache/flow/issues/115)) ([3da466b](https://github.com/jawache/flow/commit/3da466b739a3f84e662355794bb7c6d5376223b7)), references [#29](https://github.com/jawache/flow/issues/29)
* **uninstall:** the plan is carried out, step by step, and every step that fails is listed and answers 1 ([#115](https://github.com/jawache/flow/issues/115)) ([a4aad12](https://github.com/jawache/flow/commit/a4aad12b5f2cad584736dace1d12e1f6d4c93ef9))
* **uninstall:** what flow uninstall removes is planned from what it finds, beside planInit ([#115](https://github.com/jawache/flow/issues/115)) ([c035259](https://github.com/jawache/flow/commit/c0352593a92177b7937909212db7dcd57d018ff2))

### Bug Fixes

* **adapter:** a file matching HEAD is git's only when HEAD is a commit the repo had before the call ([#77](https://github.com/jawache/flow/issues/77)) ([82d6794](https://github.com/jawache/flow/commit/82d679401588fd0e6e96b2eebdcc0555b220e90c))
* **adapter:** a hook's hand-run check asks fd 0 whether it is a terminal, so it no longer makes stdin non-blocking ([#54](https://github.com/jawache/flow/issues/54)) ([8d6fd33](https://github.com/jawache/flow/commit/8d6fd336eb998bbc9a4c2e5e36fc875af853d9cf))
* **adapter:** a hook's payload read waits out EAGAIN until stdin ends, sleeping between tries ([#54](https://github.com/jawache/flow/issues/54)) ([c5f5431](https://github.com/jawache/flow/commit/c5f543194aeadd7a912835078b53c8b8fbaf6097))
* **adapter:** a pull's files are left out, since a remote branch reaches the commit it lands on ([#77](https://github.com/jawache/flow/issues/77)) ([4f23522](https://github.com/jawache/flow/commit/4f235226a8661c9f393147546de9926493afd4dd))
* **adapter:** a re-run over unwired other hooks no longer says the repo is already set up ([#129](https://github.com/jawache/flow/issues/129)) ([fa0f8c2](https://github.com/jawache/flow/commit/fa0f8c286ef44d5e15d7c0ac1effd4e652e86c0e))
* **adapter:** a recording repo keeps a subagent's hand-back on its tape though nothing is bound at turn-end ([#112](https://github.com/jawache/flow/issues/112)) ([9b86676](https://github.com/jawache/flow/commit/9b86676807c684fe40b281d355aef68889522d30))
* **adapter:** a removal is git's only when HEAD held the file before the call and not after ([#41](https://github.com/jawache/flow/issues/41)) ([08edefc](https://github.com/jawache/flow/commit/08edefcb01d5d4631792bcbe3eba1097900aff1f))
* **adapter:** a shell call leaves each file that matches HEAD after it out of the diff ([#41](https://github.com/jawache/flow/issues/41)) ([ca65336](https://github.com/jawache/flow/commit/ca65336642c083985e7135bda97733ccdaa14361))
* **adapter:** a subagent is classified by the agent_type in its hook message, and read from its own transcript ([#38](https://github.com/jawache/flow/issues/38)) ([21e606c](https://github.com/jawache/flow/commit/21e606c8b35f5ea2ea5c7fa5001698c047196949))
* **adapter:** a subagent's hand-back reads nothing when no entry is bound at turn-end ([#101](https://github.com/jawache/flow/issues/101)) ([6536656](https://github.com/jawache/flow/commit/65366569f4d27ea6ca0520a762d06cc08f669de6))
* **adapter:** an after-call rail that cannot read its payload says the call ran and nothing it changed was checked ([#55](https://github.com/jawache/flow/issues/55)) ([8d6a148](https://github.com/jawache/flow/commit/8d6a14888119cc7df8b764d5f3f9ada48255f0bd))
* **adapter:** an after-call rail wraps the one read-fault line in its banner, so a payload that was not JSON says PARSE, and no fault line says "the guard" ([#83](https://github.com/jawache/flow/issues/83)) ([0c008c1](https://github.com/jawache/flow/commit/0c008c1769a89c02ed85e4c5d3165f7d6cb7bfa1))
* **adapter:** read detection expands a word only where the line leaves it unquoted ([#45](https://github.com/jawache/flow/issues/45)) ([7fd7667](https://github.com/jawache/flow/commit/7fd7667ebac6a518d680e8782be91d61e8137b0e))
* **adapter:** the chmod the block prints quotes a path with a space in it ([#137](https://github.com/jawache/flow/issues/137)) ([ebae59e](https://github.com/jawache/flow/commit/ebae59e155cca7e6539b66ff5b6c3d686524daec))
* **adapter:** the starter config drops git push --force-if-includes, a no-op without --force-with-lease, which it bans ([#139](https://github.com/jawache/flow/issues/139)) ([1a954d0](https://github.com/jawache/flow/commit/1a954d0dec24b20bbb375f78ed3263fda3032085))
* **adapter:** the starter config flow init writes bans git push --force-with-lease and --force-if-includes again ([#139](https://github.com/jawache/flow/issues/139)) ([296231e](https://github.com/jawache/flow/commit/296231ea2d3d452a43ec06a3b10b3bc43ed238d5))
* **adapter:** when git cannot name its hooks folder, init leaves core.hooksPath alone and says so ([#137](https://github.com/jawache/flow/issues/137)) ([b39c128](https://github.com/jawache/flow/commit/b39c128dee8bff149c5d7cb15bdaca26ede0d690))
* **adapter:** while the config will not load, the after-call hook finishes the call's record without diffing the tree ([#88](https://github.com/jawache/flow/issues/88)) ([72b1a89](https://github.com/jawache/flow/commit/72b1a89d5ae8a0bcdb7a08d7466b591222170ec3))
* **adapter:** xargs's list file is read from xargs's own options, in every spelling ([#46](https://github.com/jawache/flow/issues/46)) ([e47928c](https://github.com/jawache/flow/commit/e47928cda2ace47f72afb49162e26b6257c5bf7c))
* **checks:** a banCommands entry that starts with a wrapper refuses to load ([#123](https://github.com/jawache/flow/issues/123)) ([854d664](https://github.com/jawache/flow/commit/854d664b73656ba28d592a7a157fd33d35cbebc5))
* **checks:** a banCommands entry with an assignment in front refuses to load ([#123](https://github.com/jawache/flow/issues/123)) ([5ebf0f0](https://github.com/jawache/flow/commit/5ebf0f04369c5e5ea346f69ce9a5f766e77a32d7))
* **checks:** a symbolsInSibling refusal names the test once and lists every unreferenced export on one line ([#63](https://github.com/jawache/flow/issues/63)) ([e3f513f](https://github.com/jawache/flow/commit/e3f513fadd305ecc308f14629465359b44ab332b))
* **checks:** an attached -m or --message= substitution is read through its heredoc again, and the force-push check is one body ([#95](https://github.com/jawache/flow/issues/95)) ([cc2b49a](https://github.com/jawache/flow/commit/cc2b49af74faafe8f38e63b060d790bdbbf610c1))
* **checks:** banCommands compiles its wholeLine regexes when the rule loads, and one that does not compile refuses to load ([#139](https://github.com/jawache/flow/issues/139)) ([6856411](https://github.com/jawache/flow/commit/68564112e5890c23e6fc0cd7911b38d94396dfba))
* **checks:** depcruise refuses to load a config that still passes warn ([#120](https://github.com/jawache/flow/issues/120)) ([2236dd8](https://github.com/jawache/flow/commit/2236dd8736e63854107c880c64fbce9bea01a0d9))
* **checks:** exportedNames lists exports in the order the file declares them, so a refusal reads in file order ([#63](https://github.com/jawache/flow/issues/63)) ([9113da2](https://github.com/jawache/flow/commit/9113da2bfa0ee1959e332b9f60a8a27a4cb03013))
* **checks:** pin that a head's words are found anywhere among the arguments, and name the gh prose verbs once ([#124](https://github.com/jawache/flow/issues/124)) ([606b96e](https://github.com/jawache/flow/commit/606b96e9604562c326d884db5617a8e3e1ecf3a9))
* **checks:** the backtick rule finds git commit through the parse, and the command readers share gitCommands ([#44](https://github.com/jawache/flow/issues/44)) ([1e2be1c](https://github.com/jawache/flow/commit/1e2be1c3585342e0b983151ae7ea50d283e1c116))
* **docs:** every docs/user page is held to a front-matter summary, the docs breadcrumb leaves the kinds to userDocsStyle, and the packs index states no count it did not compute ([#30](https://github.com/jawache/flow/issues/30)) ([8814f5c](https://github.com/jawache/flow/commit/8814f5c5250660a3cb7bcf222639956866a01b9c))
* **engine:** the adapter's parse rides the command event, so each shell command is parsed once per hook ([#95](https://github.com/jawache/flow/issues/95)) ([d3dd506](https://github.com/jawache/flow/commit/d3dd506a761886513950c8340992b26cb5b03c9b))
* **fcis:** pureExportsTested points at the names below it and says to write the test, and pureHasTest prints no literal {dir}/{name} ([#63](https://github.com/jawache/flow/issues/63)) ([15a84b4](https://github.com/jawache/flow/commit/15a84b4b5f35d5d35dfeb0d3ffa7fa5d551dacb2))
* **git:** an unparsed line names each attribution hit once, and the gh read has pass cases ([#123](https://github.com/jawache/flow/issues/123)) ([09b37d0](https://github.com/jawache/flow/commit/09b37d0eee69f93bb60b5f6a58c830d1f19c406b))
* **git:** the attribution rule finds each git commit through the parse, so a quoted path or option value no longer hides one ([#95](https://github.com/jawache/flow/issues/95)) ([6f06b43](https://github.com/jawache/flow/commit/6f06b43f5d0b450c88f04781610d00451aca3c7c))
* **git:** the force-push rule reads the parsed git push, so git's own options and its path no longer hide one ([#95](https://github.com/jawache/flow/issues/95)) ([b0fd93c](https://github.com/jawache/flow/commit/b0fd93cc2cb6b12ffd98bf0dac2cb052a731f095))
* **guards:** the bare-gh ban holds under a whole-line banCommands too ([#43](https://github.com/jawache/flow/issues/43)) ([66e0ce0](https://github.com/jawache/flow/commit/66e0ce023758406c9743ec2612671b077ee55cc3))
* **hooks:** the gate and every hook run the repo's own @jawache/flow package, never a flow in node_modules/.bin ([#91](https://github.com/jawache/flow/issues/91)) ([f0ae617](https://github.com/jawache/flow/commit/f0ae6170cd6186e0c1420d442af1995a6bc0e51e))
* **init:** a dev dependency brings an older flow's machine-wide commands up to date, so each hook runs once ([#91](https://github.com/jawache/flow/issues/91)) ([d5dad83](https://github.com/jawache/flow/commit/d5dad83886b7438143e69302816f6f5806839364))
* **init:** the advice for a gate on the old flow commit verb names the repo-first line too ([#91](https://github.com/jawache/flow/issues/91)) ([95b3c54](https://github.com/jawache/flow/commit/95b3c547c994cd6b7dbc2c348a2074317a948094))
* **init:** the advice for someone else's commit hook names both of the gate's lines ([#91](https://github.com/jawache/flow/issues/91)) ([78a79ba](https://github.com/jawache/flow/commit/78a79ba3800726ab9b08e4a79b1dd44a1c78ab57))
* **init:** the repo's settings path is written once, the write narrows its plan, and a first run with no .claude/ folder is covered ([#67](https://github.com/jawache/flow/issues/67)) ([e03e514](https://github.com/jawache/flow/commit/e03e514bd5bd58c645d1ad2d3472bc1b233ae588))
* **language:** SessionFacts keeps description, deprecated and never set, so a config that names it still compiles ([#38](https://github.com/jawache/flow/issues/38)) ([cccadb8](https://github.com/jawache/flow/commit/cccadb8956f7f6ae1ec63f94e9b2a7c589e2f813))
* **language:** the empty-scope advice travels in tsc's note, and its wording is tested ([#75](https://github.com/jawache/flow/issues/75)) ([3dd1c24](https://github.com/jawache/flow/commit/3dd1c24c13edfe861ce6eef8228632e53e5bfff2))
* **language:** the empty-scope refusal names who said each empty verb, and where to fix it ([#89](https://github.com/jawache/flow/issues/89)) ([99014d7](https://github.com/jawache/flow/commit/99014d7f5e52f806f7fe58859655bc978e07e601))
* **language:** the empty-scope refusal says who said each empty verb, and its advice fits every case ([#74](https://github.com/jawache/flow/issues/74)) ([d96d861](https://github.com/jawache/flow/commit/d96d861b0b81e344c322ff083e21c49788462e79))
* **language:** wholeLine keeps the body of a heredoc a shell reads ([#43](https://github.com/jawache/flow/issues/43)) ([7541090](https://github.com/jawache/flow/commit/75410900a2e105502a9a67f8da8ee1c5c49cdec2))
* **packs:** flow.noUninstall catches every runner and node on the bin link, and lets a workflow script through ([#117](https://github.com/jawache/flow/issues/117)) ([e4651c7](https://github.com/jawache/flow/commit/e4651c778c68007532f5b95e0b96a2fb24d1d0fd))
* **packs:** flow.noUninstall reads the command's program and arguments, not a regex over its text ([#140](https://github.com/jawache/flow/issues/140)) ([0f5fa7c](https://github.com/jawache/flow/commit/0f5fa7cb43427e47e22e75193033f207aca0c2c7))
* **packs:** flow.noUninstall refuses a line that does not parse when it names flow and uninstall ([#140](https://github.com/jawache/flow/issues/140)) ([2575049](https://github.com/jawache/flow/commit/257504974d2064a8c8b002ed79e637832ace745a))
* **packs:** flow.noUninstall refuses a runner named by its path, and every runner in its pattern has a refused case ([#138](https://github.com/jawache/flow/issues/138)) ([40cbf78](https://github.com/jawache/flow/commit/40cbf787714cb606244e94109ec8c3251f4df19b))
* **packs:** the attribution rule reads a gh pr or gh issue with an option before its verb, as the backtick rule does ([#139](https://github.com/jawache/flow/issues/139)) ([865449e](https://github.com/jawache/flow/commit/865449e07001fc88652e398cbb0b59e2fa959288))
* **packs:** the secrets tiers line calls .env.keys the decryption key only when it is kept in a file ([#82](https://github.com/jawache/flow/issues/82)) ([93220ae](https://github.com/jawache/flow/commit/93220ae5f20312a5b80027f31b1ae88b7ad39132))
* **release:** a version with no migration guide is sent to the migration-guide skill, by the house pack and by just release ([#31](https://github.com/jawache/flow/issues/31)) ([7166245](https://github.com/jawache/flow/commit/716624509c38a7862b6c5e33f343e1064edb323f))
* **replay:** --against compares a breadcrumb row's subject when both rows name one ([#111](https://github.com/jawache/flow/issues/111)) ([9b5ed07](https://github.com/jawache/flow/commit/9b5ed07c1c238433bf948273b31bbdeaf076b36e))
* **status:** status and init share one old-shape rule, and npx's node_modules/.bin is not the PATH ([#66](https://github.com/jawache/flow/issues/66)) ([1ed78fb](https://github.com/jawache/flow/commit/1ed78fb0879f1b293507af8442bad2facb05e88c))
* **status:** status judges init's link from raw facts, names the fix init can make, and the fallback runs end to end ([#91](https://github.com/jawache/flow/issues/91)) ([fe5b03b](https://github.com/jawache/flow/commit/fe5b03b1d16db63d5ba46b70c19076a84481bdd8))
* **status:** the binary fitting is green only when the PATH has flow, since the gate and the hooks call it by name ([#65](https://github.com/jawache/flow/issues/65)) ([6258926](https://github.com/jawache/flow/commit/6258926f2ab77a1a8ab184e40c45682db85b18c6))
* **status:** the gate looks in node_modules/.bin only when it has the PATH line itself ([#91](https://github.com/jawache/flow/issues/91)) ([6764719](https://github.com/jawache/flow/commit/67647196c95c7c9b373ae3174aa75c26318729f9))
* **status:** the red hooks line names only the rails of the missing events as not firing ([#102](https://github.com/jawache/flow/issues/102)) ([4f29f61](https://github.com/jawache/flow/commit/4f29f61a9ff877c18b753fb655d39a12f9455877))
* **uninstall:** an unknown argument is refused before anything is removed, the step runner is written once, and withoutRegistrations is one pass ([#115](https://github.com/jawache/flow/issues/115)) ([aecb0d2](https://github.com/jawache/flow/commit/aecb0d29c0befe32daedd584bc0d208269cabca7)), references [#29](https://github.com/jawache/flow/issues/29)
* **uninstall:** core.hooksPath is unset only at the repo's top folder, and a subfolder run says it kept it and where to run uninstall ([#138](https://github.com/jawache/flow/issues/138)) ([9225dbc](https://github.com/jawache/flow/commit/9225dbc38cd910e8b120e61666391c2c852b8567))
* **uninstall:** core.hooksPath is unset only when the run found the .githooks/ folder it points at, so a run from a subfolder leaves it ([#138](https://github.com/jawache/flow/issues/138)) ([6852597](https://github.com/jawache/flow/commit/68525972ab84eb8ddb6626d343a2617ec794c88a))
## [0.2.3](https://github.com/jawache/flow/compare/v0.2.2...v0.2.3) (2026-10-07)

### Bug Fixes

* **git:** the attribution rule reads a commit made with git -C or git -c ([51b450b](https://github.com/jawache/flow/commit/51b450b11aac4b544ce15a3b5513f3a0c2ad7ac3))
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
