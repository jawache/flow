// flow/pure/validate.ts — THE LOAD. Bindings in, the effective regime out — or every refusal.
//
// This is the backstop, not the front door. The front door is the compiler: a config is
// TypeScript, so a wrong key is a method that does not exist, a missing parameter is an argument
// the call demands, and a moment typo is an unresolved import — all of it red in the editor, at
// the line you typed. What arrives HERE is a config that reached a loader without an editor in
// the way: generated, hand-edited, `as`-cast past the types, or built by an agent that guessed.
//
// Every class of grammar misuse gets a NAMED refusal carrying the entry it is about, because the
// engine's answer to a config that will not load is to block every gated moment with that text
// (F3). A refusal an agent cannot act on is a rail that stays shut.
//
// It COLLECTS rather than stops. A config with three mistakes reports three: stopping at the
// first means three fix-and-rerun cycles, and the second mistake is usually the informative one.
// That is also why nothing here throws — refusals are values, and the shell that wants an
// exception makes one out of them.

import { GUARDRAIL_KEYS, BREADCRUMB_KEYS, isSentence, type EntrySpec } from "./entries.ts";
import { isGuardrailMoment, isBreadcrumbMoment, phasesOf } from "./moments.ts";
import { isCategory } from "./categories.ts";
import { hasCases } from "./checks.ts";
import { overlay, type FlowConfig } from "./packs.ts";

/** The closed vocabulary of refusals. Every load failure is exactly one of these. */
export const REFUSAL_CODES = [
  "not-a-pack",
  "missing-parameter",
  "unknown-entry",
  "unknown-key",
  "unknown-moment",
  "missing-mandatory",
  "undeclared-category",
  "no-cases",
  "duplicate-id",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** One reason the config will not load. */
export interface Refusal {
  readonly code: RefusalCode;
  /** What it is about: `pack.entry`, or the pack alone when no entry is named. */
  readonly entry: string;
  /** The sentence a reader acts on. It always names the entry, because a hook shows one line. */
  readonly detail: string;
}

/** One entry as the engine will run it: the pack's sentence, with every override laid over it. */
export interface LoadedEntry {
  /** `pack.id` — one spelling from definition to log line. */
  readonly id: string;
  readonly pack: string;
  /** The entry's dotted path within its pack. */
  readonly key: string;
  readonly spec: EntrySpec;
  /** Where each key came from — what `flow status` prints when it explains an entry. */
  readonly source: Readonly<Record<string, "pack" | "override">>;
  /** The categories this entry is scoped to. Empty means every category. */
  readonly categories: readonly string[];
  /** The engine phases this entry fires at. Empty for a breadcrumb, which has no rail. */
  readonly phases: readonly string[];
}

export type LoadResult =
  | { readonly ok: true; readonly entries: readonly LoadedEntry[] }
  | { readonly ok: false; readonly refusals: readonly Refusal[] };

interface Draft {
  id: string;
  pack: string;
  key: string;
  spec: EntrySpec;
  source: Readonly<Record<string, "pack" | "override">>;
}

/** Turn a config's bindings into the effective regime, or into every reason it cannot be one. */
export function loadConfig(config: FlowConfig): LoadResult {
  const refusals: Refusal[] = [];
  const drafts: Draft[] = [];
  const seen = new Map<string, Draft>();

  // ── the pack bindings, in the order they were spoken ──
  for (const binding of config.bindings) {
    if (binding.kind !== "pack") continue;

    if (!binding.pack || binding.pack.name === "") {
      refusals.push({
        code: "not-a-pack",
        entry: "",
        detail:
          "A `pack(…)` line was given a value that no `definePack` ever made. Import the pack's default export, not one of its entries.",
      });
      continue;
    }

    const { name, build, takesParams } = binding.pack;
    if (takesParams && !binding.hasParams) {
      refusals.push({
        code: "missing-parameter",
        entry: name,
        detail: `The pack \`${name}\` declares parameters and was bound without any — write \`pack(${name}, { … })\`. Which fields it needs is stated by its factory's type.`,
      });
      continue;
    }

    for (const { key, spec } of flatten(build(binding.params))) {
      const draft: Draft = { id: `${name}.${key}`, pack: name, key, spec, source: sourceOf(spec) };
      const clash = seen.get(draft.id);
      if (clash) {
        refusals.push({
          code: "duplicate-id",
          entry: draft.id,
          detail: `Two entries claim the id \`${draft.id}\`. An id is its property name inside its pack, so this is one pack bound twice, or two packs sharing a name.`,
        });
        continue;
      }
      seen.set(draft.id, draft);
      drafts.push(draft);
    }
  }

  // ── the overrides, resolved against everything bound ──
  //
  // After the packs rather than in line with them, so a config may speak an override above the
  // `pack()` line it refines. Reading order is the author's business; resolution order is not.
  for (const binding of config.bindings) {
    if (binding.kind !== "override") continue;
    const id = `${binding.ref.pack}.${binding.ref.id}`;
    const draft = seen.get(id);
    if (!draft) {
      refusals.push({
        code: "unknown-entry",
        entry: id,
        detail: `\`override(${id})\` names an entry no bound pack has. Bind the pack it lives in, or correct the reference.`,
      });
      continue;
    }
    const laid = overlay(draft.spec, binding.spoken);
    draft.spec = laid.spec;
    draft.source = { ...draft.source, ...laid.source };
  }

  // ── every entry, judged once, in its final shape ──
  for (const draft of drafts) refusals.push(...judge(draft));

  if (refusals.length > 0) return { ok: false, refusals };
  return {
    ok: true,
    entries: drafts.map((d) => ({
      id: d.id,
      pack: d.pack,
      key: d.key,
      spec: d.spec,
      source: d.source,
      categories: (d.spec.for ?? []).map((c) => c.name),
      phases: d.spec.kind === "guardrail" ? phasesOf(d.spec.at ?? []) : [],
    })),
  };
}

/**
 * Walk a pack's tree to its entries, dotting the path as it goes.
 *
 * It takes an untyped record rather than `EntryGroup`, and that is not laziness: the type says
 * every leaf is a sentence or a group, and this function is one of the places that exists BECAUSE
 * a config may have reached here without a compiler agreeing. A guard the types have already
 * proved is a guard that will be deleted the day the types are wrong.
 */
function flatten(group: Readonly<Record<string, unknown>>, path: readonly string[] = []): Found[] {
  const out: Found[] = [];
  for (const [name, value] of Object.entries(group)) {
    if (isSentence(value)) out.push({ key: [...path, name].join("."), spec: value.spec });
    else if (typeof value === "object" && value !== null)
      out.push(...flatten(value as Record<string, unknown>, [...path, name]));
  }
  return out;
}

interface Found {
  key: string;
  spec: EntrySpec;
}

function sourceOf(spec: EntrySpec): Readonly<Record<string, "pack" | "override">> {
  const source: Record<string, "pack" | "override"> = {};
  for (const key of Object.keys(spec)) source[key] = "pack";
  return source;
}

/** Every fault in one entry, so a reader fixes them together. */
function judge(draft: Draft): Refusal[] {
  const { id, spec } = draft;
  const out: Refusal[] = [];
  const say = (code: RefusalCode, detail: string) => out.push({ code, entry: id, detail });

  const allowed: readonly string[] = spec.kind === "guardrail" ? GUARDRAIL_KEYS : BREADCRUMB_KEYS;
  const extra = Object.keys(spec).filter((k) => k !== "kind" && !allowed.includes(k));
  if (extra.length > 0)
    say(
      "unknown-key",
      `\`${id}\` carries ${extra.map((k) => `\`${k}\``).join(", ")}, which the ${spec.kind} grammar does not have. It is closed: ${allowed.join(" · ")}.`,
    );

  const at: readonly string[] = spec.at ?? [];
  const legal = spec.kind === "guardrail" ? isGuardrailMoment : isBreadcrumbMoment;
  const wrong = at.filter((m) => !legal(m));
  if (wrong.length > 0)
    say(
      "unknown-moment",
      `\`${id}\` fires at ${wrong.map((m) => `\`${m}\``).join(", ")}, which is not a moment a ${spec.kind} has a rail for.`,
    );

  const strayCategory = (spec.for ?? []).some((c) => !isCategory(c));
  if (strayCategory)
    say(
      "undeclared-category",
      `\`${id}\` is scoped with \`.for(…)\` to something \`defineCategory\` never made. A category is a value with its recognizer aboard — import the one you mean.`,
    );

  // A disabled entry is listed with its reason and never runs, so it is asked to prove nothing.
  // That is not a hole: what it says is already inert, and demanding a message and cases from an
  // entry somebody turned off is how an opt-out becomes cheaper to delete than to explain.
  if (spec.disabled) return out;

  const missing: string[] = [];
  if (at.length === 0) missing.push(".at(…)");
  if (spec.kind === "guardrail") {
    if (!spec.check) missing.push(".check(…)");
    if (spec.message === undefined) missing.push(".message(…)");
  } else if (spec.text === undefined && spec.file === undefined) {
    missing.push(".text(…) or .file(…)");
  }
  if (missing.length > 0)
    say(
      "missing-mandatory",
      `\`${id}\` never said ${missing.join(" and ")}. Nothing in this grammar defaults — an absent key is absent, not a fallback.`,
    );

  if (spec.kind === "guardrail" && !hasCases(spec.test))
    say(
      "no-cases",
      `\`${id}\` carries no cases. A rule declares what must pass it and what it must block (\`.test({ pass, block })\`) — a fence whose block-case was never written is a fence nothing proves is alive.`,
    );

  return out;
}
