// flow/packs/flow.ts — flow's own orientation and self-protection.
//
// AND THEY ARE THE `flow` PACK NOW, not `guard`, which is a rename worth its churn: every entry in
// every pack here is a guardrail or a breadcrumb, so `guard.` as a prefix said nothing that was not
// already true of `git.` and `tdd.`. What these three are actually about is FLOW — the config file,
// the packs it imports, the gate that runs them — and `flow.noDeleteGuardrails` names the thing
// being protected where `guard.noDeleteGuardrails` named the category it belongs to.
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

  /**
   * The harness's own permission surface — the files an agent's tools and permissions are declared
   * in. Defaults to Claude Code's: `.claude/settings.json`, `.claude/settings.local.json`,
   * `.claude/agents/**` and `.claude/skills/**`.
   *
   * The edit nudge fires on these as well as on the guard itself, because a tool list and a hook
   * registration decide what any rule here can ever see. A repo on another harness names its own
   * files; a repo with none passes `[]`.
   */
  readonly hostSurface?: readonly string[];
}

/**
 * flow's own orientation and self-protection, as a pack any repo binds.
 *
 * Every guarded repo wants these three: a note saying what is steering you, a nudge when you edit
 * the steering itself, and a refusal when a command would delete it.
 *
 * @setup A `flow.config.ts` at the repo root and a folder for the packs the repo writes itself —
 * whatever it is called, named here as the `packs` parameter. `flow init` writes both.
 * @adopt Bind it first, before any other pack: it is the one every guarded repo wants whether or
 * not it agrees with a single other opinion in this package.
 */
export const flow = definePack("flow", (repo: Home) => {
  const hostSurface = repo.hostSurface ?? [".claude/settings.json", ".claude/settings.local.json", ".claude/agents/**", ".claude/skills/**"];
  return {
    /**
     * Without it, an agent works in a guarded repo without knowing it is guarded: a refusal arrives
     * with no model of where it came from, and the config that produced it is just another file.
     */
    orientation: breadcrumb()
      .at(session)
      .description("What the guard layer is and how it steers — shown at the start of every session.")
      .text(
        [
          "This repo is guarded by flow. Guardrails are rules that refuse a change, and every change to the files here is checked against them: a change made with the Edit tool is checked before it is written, and a change made by a shell command is checked the moment it has been written. A refused write is undone, and you are told why. The staged files are checked against the guardrails again at commit. Breadcrumbs are notes about the area you are working in, and you are shown them for any file you name in a tool call or read with a command such as `cat`.",
          "The whole guard is `flow.config.ts` — every rule that fires is reachable from that one file, whether it comes from a pack the config imports or from a pack this repo writes itself. Nothing resolves at run time and nothing defaults: what you read there is what fires. Authoring a new entry is always welcome; never loosen a guardrail to get an edit through — that is the user's call.",
          "There is no bypass token anywhere in this system. A guardrail is on or off, and turning one off is `override(pack.entry).disabled(\"why\")` in flow.config.ts — a committed change, visible in review.",
          "If the config will not load, every gated moment refuses until it is fixed. A guard that fails open is a guard that lies about being there. The ONE exception is the repair itself: while the config is broken you may still write `flow.config.ts` and the pack files it imports, because otherwise the rule that demands a fix also forbids it. Commands stay blocked, and so does the commit gate — nothing written under that exception reaches a commit until the config loads green.",
        ].join("\n"),
      ),

    // The default host surface is deliberately one wider than the engine's own list —
    // `.claude/skills/**`, because a skill is prose an agent reads and is worth a word of caution
    // before you edit it. The engine keeps the narrower list for a different question; the argument
    // for not sharing one is written out at HOST_SURFACE in the adapter's pure home.
    /**
     * Without it, the steering layer gets edited like any other file — a rule loosened in passing,
     * a hook rewritten mid-task — and the guard changes without anybody deciding that it should.
     */
    editingTheGuardrails: breadcrumb()
      .at(touch)
      .on("flow.config.ts", ...repo.packs, ...hostSurface)
      .description("A nudge when you edit the guardrails themselves; it never blocks.")
      .text(
        [
          "You are editing the guardrails themselves.",
          "If this edit weakens, disables or removes a guardrail or a permission because it just blocked you — stop and confirm with the user first.",
          "Authoring new entries is always fine; loosening one to get an edit through is the user's call, not yours.",
          "An AGENT DEFINITION is a permission surface too: its `tools:` list decides what that agent can do, and the installed link is live — the file you are editing is the one that takes effect, with nothing between your edit and every future session. Widening a tool list, or adding a permissionMode, is the user's call — a mode added as a hardening is as likely to be a loosening.",
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
  };
});
