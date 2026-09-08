// flow/packs/docs.ts — two documentation audiences, one folder, nothing replicated.

import { breadcrumb, canonicalFiles, commit, definePack, guardrail, protectedPath, touch, write } from "../index.ts";

/**
 * Two documentation audiences, one folder, nothing replicated.
 *
 * Every repo documents for exactly two readers who want opposite things: the end user wants the
 * least possible cognitive load, and the agent wants almost nothing in context. So `docs/` has
 * exactly two doors and everything inside follows its door's rules.
 *
 * @setup A `docs/` folder holding exactly `user/` and `agent/`, each with its own index —
 * `docs/user/index.html` for people and `docs/agent/README.md` as a list of pointers. The two
 * guardrails below refuse anything else at the top of the folder, so a repo with a different shape
 * either moves its pages or does not bind this pack.
 */
export interface Doors {
  /**
   * The documentation folder, as a path from the repo root. Defaults to `docs`.
   *
   * Both guardrails and both breadcrumbs are scoped to it, so a repo whose pages live in
   * `documentation/` names that here and keeps every rule.
   */
  readonly root?: string;

  /**
   * Filenames allowed to sit LOOSE at the top of that folder, beside the two doors. Defaults to
   * none — every file belongs behind `user/` or `agent/`.
   *
   * A repo that keeps a `README.md` at the top of its docs folder names it here.
   */
  readonly allow?: readonly string[];
}

export const docs = definePack("docs", (repo: Doors = {}) => {
  const root = repo.root ?? "docs";
  const allow = repo.allow ?? [];
  return {
    /**
     * Without it, an agent writing under `docs/` has no way to know there are two audiences. User
     * pages fill with rationale nobody asked for, and agent pages fill with copies of what the code
     * already says, which go stale silently while still reading as true.
     */
    docs: breadcrumb()
      .at(touch)
      .on(`${root}/**`)
      .description("The two audiences, the admission test, and the discipline that keeps docs true.")
      .text(
        [
          "Two audiences, two doors, opposite rules. `docs/user/` is for PEOPLE: always HTML, entered through index.html, and multimodal on purpose — images, SVGs and short recordings are encouraged wherever they explain better than sentences. The measure of a user doc is how little work the reader has to do.",
          "`docs/agent/` is ARCHIVAL CONTEXT, loaded on demand, entered through README.md as an index of pointers. The admission test: could a fresh agent derive this from the code, the config or the guard layer? Then it does not belong — derivable content is replication, and replication goes stale silently while still reading as true. Only expensive syntheses live here: understanding that took hours to establish and would take hours to re-derive. Pointers outward, never copies inward; this folder must never compete with the breadcrumb layer.",
          "The style law, both sides: state CURRENT FACTS in the present tense. No litigation, no rationale essays, no history — the journal owns the past. Where a decision would otherwise look wrong, one Chesterton-fence line pointing at the decision record, never a retelling.",
          "The failure mode is silent staleness, not error: a doc stays literally correct while a whole task's machinery lands unmentioned, and nothing complains. So if the work you just shipped changed a boundary, a component's job or the lifecycle, the doc changes in the SAME commit.",
        ].join("\n"),
      ),

    // It sits BESIDE `docs`, not inside it, because the two breadcrumbs answer different questions
    // at different moments: `docs` fires anywhere under docs/ and says which door you are behind;
    // this one fires only behind the user door and says how a page there is written.
    /**
     * Without it, every user page is written in whatever style that session had, and the docs read
     * as ten authors. Every source it cites is a public standard — Diátaxis, the Google developer
     * style guide — so nothing in it is one repo's taste.
     */
    userDocsStyle: breadcrumb()
      .at(touch)
      .on(`${root}/user/**`)
      .description("The ruled style of docs/user — Diátaxis page discipline, the language rules, captured output.")
      .text(
        [
          "The user docs have a ruled style — hold it:",
          "· One page, one job (the Diátaxis framework, https://diataxis.fr): the quick start teaches by doing (explanation is linked, never inlined); the guide solves situations; reference pages state facts for lookup, no narrative.",
          "· Language (per the Google developer style guide, https://developers.google.com/style): second person, present tense, active voice. Define a term on first use or do not use it. Spend words in proportion to difficulty — one sentence for the simple thing, the full walkthrough for the hard one. No \"simply\", no filler.",
          "· Code examples are TypeScript, formatted as the repo formats it — a config example is copied from a file that compiles, never typed into the page.",
          "· Every claim and printed output is captured from the shipped binary, never paraphrased — re-run the example before you change its text.",
        ].join("\n"),
      ),

    /**
     * Without it, `docs/` grows a third folder nobody chose — notes, scratch, drafts — and the two
     * doors stop being a rule. A folder with no declared audience is how a docs folder becomes a
     * drawer, and neither audience's rules can be applied to what is in it.
     */
    docsShape: guardrail()
      .at(write, commit)
      .on(`${root}/**`)
      .description("docs/ holds exactly user/ and agent/ — the folder allowlist.")
      // Nothing may sit loose at the top of docs/ — every file belongs to one of the two doors.
      .check(canonicalFiles({ root, allow, folders: ["user", "agent"] }))
      .message(
        "docs/ holds exactly two doors: `user/` (HTML, for people) and `agent/` (archival context, for agents). A third folder or a loose file at the top is documentation with no declared audience, which is how a docs folder becomes a drawer.",
      )
      .test({
        pass: [{ path: `${root}/user/index.html`, content: "" }],
        block: [{ path: `${root}/notes/scratch.md`, content: "" }],
      }),

    noMarkdownInUserDocs: guardrail()
      .at(write, commit)
      .on(`${root}/user/**/*.md`, `${root}/user/**/*.mdx`)
      .description("No .md or .mdx under docs/user — user docs are HTML, and assets of every other kind are welcome.")
      .check(protectedPath({}))
      .message(
        "User docs are HTML — that is what makes them multimodal by default (images, SVGs, video inline) and what stops them turning into paragraphs nobody reads. Markdown belongs in `docs/agent/`. Every other asset type is welcome under `docs/user/`.",
      )
      .test({ block: [{ path: `${root}/user/guide.md`, content: "# hi" }] }),
  };
});
