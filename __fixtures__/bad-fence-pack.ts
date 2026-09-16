// A fence written the way a repo converting from the old engine writes one — in REGEXES — which is
// the shape flow refuses to load.
//
// It is a fixture rather than a string inside the machine test because every other pack that test
// writes into its throwaway repo is one, and because this file has to typecheck in place: a config
// author's mistake that the compiler could have caught is not the mistake being demonstrated here.
// The layers below are perfectly well-TYPED and completely useless, which is the whole point.
//
// What the dialect does with them: `^core/pages/(?!api/)` is escaped into
// `^\\^core/pages/\\([^/]!api/\\)$`, a pattern no module path can match. Before flow refused it, a
// fence like this loaded, reported armed in `flow status`, walked the graph on every commit and
// found nothing — for as long as it took somebody to plant a probe and watch it sail through.
//
// The import below says `../index.ts` so this typechecks with the rest of the fixtures; the suite
// repoints it as it writes the file into its temp repo. See `fixturePack` in flow/e2e/harness.ts.

import { commit, definePack, depcruise, guardrail } from "../index.ts";

/** The canned answers a depcruise case runs on — the tool's report, not the graph. */
const CLEAN = '{"summary":{"violations":[]}}';
const DIRTY = '{"summary":{"violations":[{"rule":{"name":"no-pages-to-session"},"from":"a","to":"b"}]}}';

export const fence = definePack("fence", {
  /**
   * The architecture, as regexes — which is the bug, and the only reason this pack exists.
   *
   * ITS CASES ARE THE MINIMUM that clears `no-cases`, deliberately: they prove the entry reads a
   * violation report, which is all a canned world can ever prove, and this file is here to show
   * that a rule with green cases can still be a rule that cannot match anything.
   */
  imports: guardrail()
    .at(commit)
    .description("A fence whose layers are regular expressions, which the dialect cannot use.")
    .check(
      depcruise({
        scan: "core/**",
        layers: { pages: ["^core/pages/(?!api/)"], session: ["core/session/**"] },
        forbid: [{ from: "pages", to: "session" }],
      }),
    )
    .message("An import crosses the fence.")
    .test({
      pass: [{ staged: ["core/a.ts"], world: { exec: { depcruise: { stdout: CLEAN } } } }],
      block: [{ staged: ["core/a.ts"], world: { exec: { depcruise: { code: 1, stdout: DIRTY } } } }],
    }),
});
