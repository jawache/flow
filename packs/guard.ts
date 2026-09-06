// flow/packs/guard.ts — the guard layer's own orientation and self-protection.
//
// Every guarded repo wants these: a note saying what is steering you, a nudge when you edit the
// steering itself, and a refusal when a command would delete it. They were the `guard` pack in the
// home-directory library; they are a module now, and the only thing that changed on the way across
// is what they point AT — flow.config.ts and guards/, not work.yaml and ~/.work/library.
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

export const guard = definePack("guard", {
  orientation: breadcrumb()
    .at(session)
    .description("What the guard layer is and how it steers — shown at the start of every session.")
    .text(
      [
        "This repo is guarded by flow. Guardrails block risky edits before they land (and again at commit); breadcrumbs steer you by area as you touch files.",
        "The whole guard is `flow.config.ts` — every rule that fires is reachable from that one file, whether it comes from a pack the config imports or from a pack this repo writes itself under `guards/`. Nothing resolves at run time and nothing defaults: what you read there is what fires. Author or refine one via /work reflect — never loosen a guardrail to get an edit through; that is the user's call.",
        "There is no bypass token anywhere in this system. A guardrail is on or off, and turning one off is `override(pack.entry).disabled(\"why\")` in flow.config.ts — a committed change, visible in review.",
        "If the config will not load, every gated moment refuses until it is fixed. A guard that fails open is a guard that lies about being there. The ONE exception is the repair itself: while the config is broken you may still write `flow.config.ts` and `guards/**`, because otherwise the rule that demands a fix also forbids it. Commands stay blocked, and so does the commit gate — nothing written under that exception reaches a commit until the config loads green.",
      ].join("\n"),
    ),

  editingTheGuardrails: breadcrumb()
    .at(touch)
    .on("flow.config.ts", "guards/**", ".claude/settings.json", ".claude/settings.local.json", ".claude/agents/**", ".claude/skills/**", "skills/*/agents/**")
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
    .on("flow.config.ts", "guards/**", ".githooks/pre-commit")
    .description("Stops a command from deleting the committed guard surface. No bypass — disable entries in the file instead.")
    .check(protectedPath({}))
    .message(
      "That command would delete this repo's guard surface (flow.config.ts binds every rule; guards/ holds the packs this repo writes itself; .githooks/pre-commit is what runs them at the gate). Deleting any of them is the same attack. There is no bypass — `override(pack.entry).disabled(\"why\")` inside flow.config.ts is the visible, committed route.",
    )
    .test({ block: [{ path: "flow.config.ts", content: "" }, { path: "guards/house.ts", content: "" }] }),
});
