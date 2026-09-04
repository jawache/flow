// The same config as ./core.config.ts, with one entry's cases emptied — the other half of F2's
// proof.
//
// TWO WAYS AN ENTRY CAN CARRY NO CASES, and flow refuses both at different times:
//
//   `.test()` never spoken       the COMPILER refuses, at the line you type, because the
//                                completeness type requires it. That is F1's proof and it is
//                                driven by ./refusals/no-cases.ts, which the compiler is run over
//                                in flow/grammar.test.ts. It cannot be demonstrated here, because
//                                a file that will not compile will not run either.
//
//   `.test({})` spoken but empty the LOAD refuses, naming the entry, with the `no-cases` code.
//                                That is what this file demonstrates: it typechecks, it runs, and
//                                `flow test` over it refuses to test anything and says which entry
//                                is why.
//
// The second one is the backstop that matters in the wild, because a config can reach a loader
// without an editor in the way — generated, hand-edited, cast past the types — and a fence whose
// block case was never written is the exact failure that shipped two dead import fences for four
// days.

import { commit, defineConfig, definePack, guardrail, pack } from "../index.ts";
import { execPasses } from "../checks/domain.ts";
import { core } from "./core-pack.ts";

const thin = definePack("thin", {
  testsPassAtCommit: guardrail()
    .at(commit)
    .check(execPasses({ run: "just test-commit" }))
    .message("The suite is red — the commit is refused.")
    // Spoken, and empty. Nothing here proves this rule can block anything.
    .test({}),
});

export default defineConfig([pack(core), pack(thin)]);
