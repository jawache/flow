// flow/pure/moments.ts — WHEN a rule fires. The vocabulary and the mapping to engine phases,
// and nothing else.
//
// The PHASES table below is lifted verbatim from cli/guard/pure/bindings.ts:56 — it is the one
// thing worth carrying out of the old 785-line format file, and its comment is carried with it
// because the reasoning is still load-bearing:
//
//   These are the format's words, not the engine's phase names — `edit` and `turn` are internals
//   and are as unknown here as any typo. `write` is the human word for the pre-emptive PreToolUse
//   block, which the engine calls `edit`; `command` rides both the Bash rail and the commit gate
//   the rule-tester drives it on.
//
//   `push` is not among them. It was accepted for a year and fired by nothing (no pre-push hook
//   is written), which in a no-defaults format is a word promising a rail that does not exist.
//
//   The vocabulary and the mapping used to be two lists. They cannot be: a moment in one and not
//   the other is either a word the format accepts and nothing ever fires, or a rail no word can
//   reach. Adding a moment is one line HERE and it reaches both.
//
// What changed in the move is only who reads it. In YAML a moment was a string the format had to
// judge; here it is an imported value, so `.at(wrte)` is a missing binding at the line you typed
// and never reaches a validator at all. The table stays because the ENGINE still needs the
// mapping, and because the load re-validates data that may have been built outside an editor.

const PHASES = {
  write: ["edit"],
  command: ["edit", "commit"],
  commit: ["commit"],
  delete: ["delete"],
  "turn-end": ["turn"],
} as const satisfies Record<string, readonly string[]>;

/** The moments a guardrail may fire at — the keys of the one table above. */
export type GuardrailMoment = keyof typeof PHASES;

/** The moments a breadcrumb may show at. A breadcrumb is a note; it has no rail to block. */
export type BreadcrumbMoment = (typeof BREADCRUMB_MOMENTS)[number];

/** Either vocabulary. `turn-end` is the one word in both. */
export type Moment = GuardrailMoment | BreadcrumbMoment;

export const GUARDRAIL_MOMENTS: readonly GuardrailMoment[] = Object.keys(PHASES) as GuardrailMoment[];
export const BREADCRUMB_MOMENTS = ["session", "touch", "turn-end"] as const;

// ── the words, as values ─────────────────────────────────────────────────────
//
// A config imports these rather than spelling them: `.at(write)` is a binding the editor
// resolves, so the whole class of "moment typo loads green and fires never" is gone before the
// grammar has to have an opinion about it.
//
// `deletion` is the one export whose name is not its word, and it cannot be otherwise: `delete`
// is a reserved word and `const delete = …` is a syntax error. The MOMENT is still "delete" —
// the value's contents, the table's key, and what a log line prints.

export const write = "write" as const;
export const command = "command" as const;
export const commit = "commit" as const;
export const deletion = "delete" as const;
export const turnEnd = "turn-end" as const;
export const session = "session" as const;
export const touch = "touch" as const;

/** The engine phases a moment list fires at — deduped, in declaration order. */
export function phasesOf(at: readonly GuardrailMoment[]): string[] {
  const out: string[] = [];
  for (const m of at) for (const p of PHASES[m]) if (!out.includes(p)) out.push(p);
  return out;
}

/** Is this string one of the guardrail words? The load's backstop, not the editor's job. */
export function isGuardrailMoment(m: string): m is GuardrailMoment {
  return (GUARDRAIL_MOMENTS as readonly string[]).includes(m);
}

/** Is this string one of the breadcrumb words? */
export function isBreadcrumbMoment(m: string): m is BreadcrumbMoment {
  return (BREADCRUMB_MOMENTS as readonly string[]).includes(m);
}
