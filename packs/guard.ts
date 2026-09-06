// flow/packs/guard.ts — the guard layer's own orientation and self-protection.
//
// Every guarded repo wants these: a note saying what is steering you, a nudge when you edit the
// steering itself, and a refusal when a command would delete it. They were the `guard` pack in the
// home-directory library; they are a module now, and the only thing that changed on the way across
// is what they point AT — flow.config.ts and the packs it imports, not work.yaml and ~/.work/library.
//
// Subtlety: WHERE those packs live is a mandatory parameter. One repo's name for the folder used to
// be written into both scopes below, so every other repo bound two rules over a folder it does not
// have — a nudge that never fires and a delete refusal that protects nothing, both counted as
// armed. That is the exact failure flow exists to make impossible.
//
// THREE ENTRIES, and the count is the pack's definition rather than a coincidence: this is flow's
// self-protection and nothing else. Two entries that used to sit here left when the packs moved
// into the package, because neither was about the guard — `noAgentInboxItems` is the work
// lifecycle's and is in `work`, and the prose-substitution rule's `git commit` / `gh` head is in
// `git` beside the other commands that write a permanent record (its `work …` head went to `work`
// with the rest of the lifecycle).
//
// ONE ENTRY DID NOT CROSS, deliberately: `workyaml-lint`, which parsed work.yaml and checked that
// every group resolved, every entry had a description, every blocking rule had a message and every
// scope matched a tracked file. All five are the type system's now — an entry missing its message
// is a red squiggle, a `use:` that resolves nowhere is an import error, and a scope that could
// never narrow anything is the dead-scope refusal. A rule re-asking at commit what the compiler
// already refused at the keystroke is a rule that can only ever agree.

import { breadcrumb, deletion, definePack, guardrail, protectedPath, session, touch } from "../index.ts";

/** The one fact this pack cannot know: where this repo keeps the packs its config imports. */
export interface Home {
  /**
   * Every glob covering a pack file `flow.config.ts` imports — one entry per folder a repo keeps
   * its own packs in, and `[]` in a repo whose rules are all written inline in the config.
   *
   * MANDATORY, and empty is a real answer rather than the absence of one. An unstated list is a
   * list nobody reviews, and here it decides what two rules watch: the nudge when you edit the
   * guard, and the refusal to delete it. Both name it and neither defaults.
   *
   * The engine derives the REPAIR surface from the config's imports directly (`configSurface`),
   * because it is asked in the broken state and can only read text. This is the same fact asked
   * at a moment where the config loads, so it is stated once, here, and typed.
   */
  readonly packs: readonly string[];
}

export const guard = definePack("guard", (repo: Home) => ({
  orientation: breadcrumb()
    .at(session)
    .description("What the guard layer is and how it steers — shown at the start of every session.")
    .text(
      [
        "This repo is guarded by flow. Guardrails block risky edits before they land (and again at commit); breadcrumbs steer you by area as you touch files.",
        "The whole guard is `flow.config.ts` — every rule that fires is reachable from that one file, whether it comes from a pack the config imports or from a pack this repo writes itself. Nothing resolves at run time and nothing defaults: what you read there is what fires. Authoring a new entry is always welcome; never loosen a guardrail to get an edit through — that is the user's call.",
        "There is no bypass token anywhere in this system. A guardrail is on or off, and turning one off is `override(pack.entry).disabled(\"why\")` in flow.config.ts — a committed change, visible in review.",
        "If the config will not load, every gated moment refuses until it is fixed. A guard that fails open is a guard that lies about being there. The ONE exception is the repair itself: while the config is broken you may still write `flow.config.ts` and the pack files it imports, because otherwise the rule that demands a fix also forbids it. Commands stay blocked, and so does the commit gate — nothing written under that exception reaches a commit until the config loads green.",
      ].join("\n"),
    ),

  // The three host files below look like the engine's own list and are deliberately one wider —
  // `.claude/skills/**`, because a skill is prose an agent reads and is worth a word of caution
  // before you edit it. The engine keeps the narrower list for a different question, and the
  // argument for not sharing one is written out at HOST_SURFACE in the adapter's pure home.
  editingTheGuardrails: breadcrumb()
    .at(touch)
    .on(
      "flow.config.ts",
      ...repo.packs,
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/agents/**",
      ".claude/skills/**",
    )
    .description("A nudge when you edit the guardrails themselves; it never blocks.")
    .text(
      [
        "You are editing the guardrails themselves.",
        "If this edit weakens, disables or removes a guardrail or a permission because it just blocked you — stop and confirm with the user first.",
        "Authoring new entries is always fine; loosening one to get an edit through is the user's call, not yours.",
        "An AGENT DEFINITION is a permission surface too: its `tools:` list decides what that agent can do, and the installed link is live — the file you are editing is the one that takes effect, with nothing between your edit and every future session. Widening a tool list, or adding a permissionMode, is the user's call. Measured: `permissionMode: dontAsk` was added as a hardening and turned out to be a loosening.",
        "Whatever you are authoring here — a `.message(…)`, a finding format, a warning — name what was SEEN (which file, which commit, which command) and what that specific cause wants done. A condition that cannot produce a distinguishing message is two rules, not one: split it. A detector that emits the same sentence for causes the reader must answer differently teaches them to talk past it, and then fails silently on the one occasion it was right.",
        "Every guardrail carries its own cases. Add the block case first — a rule whose block case passes is a rule that catches nothing, and `flow test` is what says so.",
      ].join("\n"),
    ),

  noDeleteGuardrails: guardrail()
    .at(deletion)
    .on("flow.config.ts", ...repo.packs, ".githooks/pre-commit")
    .description("Stops a command from deleting the committed guard surface. No bypass — disable entries in the file instead.")
    .check(protectedPath({}))
    .message(
      "That command would delete this repo's guard surface (flow.config.ts binds every rule; the packs it imports are where this repo writes its own; .githooks/pre-commit is what runs them at the gate). Deleting any of them is the same attack. There is no bypass — `override(pack.entry).disabled(\"why\")` inside flow.config.ts is the visible, committed route.",
    )
    .test({ block: [{ path: "flow.config.ts", content: "" }, { path: ".githooks/pre-commit", content: "" }] }),
}));
