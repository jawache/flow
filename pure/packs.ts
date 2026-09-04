// flow/pure/packs.ts — PACKS DEFINE, THE CONFIG BINDS. Two verbs, and the overlay between them.
//
// A pack is just code: `definePack` over a tree of sentences, exported from a file in the repo or
// from an npm package, identical shape either way. Promotion is publishing — the body already IS
// a pack, so the only line that changes anywhere is the import path.
//
// flow.config.ts is the only file that turns anything on. Importing a pack does nothing; a
// `pack()` line binds it, entries and all, opt-out. `override(x.entry)` speaks only what it
// changes. If a rule is not reachable from that file, it does not run.
//
// TWO THINGS THIS FILE REFUSES TO BUILD, and they are the same thing twice:
//
//   No string routes. An entry is addressed by the property it was filed under —
//   `tdd.commitRunsTests`, `git.node.versionIsSemver` — because entry names are identifiers. One
//   spelling from definition to log line, no second naming scheme, and no resolver with ambiguity
//   rules to get wrong.
//
//   No reaching inside a check. An override moves an entry, rewords it or switches it off.
//   Anything a repo may VARY is a parameter the pack declared, with a type, in one place, chosen
//   by the pack's author. The blind whole-replacement of a script's inputs is the class of
//   failure that produced twelve distinct load errors, and it is deleted rather than reported.
//
// PRECEDENCE, three rungs, top-down, nothing merges: the override beats the pack's sentence,
// which beats the parameter's default. A parameter default lives inside the factory closure, so
// by the time a sentence exists the bottom rung has already been spent — which is why `overlay`
// below has exactly two inputs and not three.

import type { EntryGroup, EntrySpec, Sentence, GuardrailSpec, BreadcrumbSpec, CompleteEntry } from "./entries.ts";
import type { GuardrailMoment, BreadcrumbMoment } from "./moments.ts";
import type { Category } from "./categories.ts";

// Both brands are STRING keys that are not valid identifiers, and that is the point: an entry is
// addressed by property, so any key a pack's author could plausibly type must stay free. `tdd.id`
// and `tdd.pack` are entry names somebody will want one day; `tdd["flow:ref"]` is not.
const PACK = "flow:pack";
const REF = "flow:ref";

// ── what a pack IS ───────────────────────────────────────────────────────────

/** A pack's definition — its name, and how to build its entries. */
export interface PackDefinition {
  readonly name: string;
  /** Build the entry tree. A pack that takes no parameters ignores the argument. */
  readonly build: (params: unknown) => EntryGroup;
  /** Does this pack's entries close over parameters? Measured from the factory's arity. */
  readonly takesParams: boolean;
}

/** Where a reference points. Flat: the pack's name, and the entry's dotted path within it. */
export interface RefTarget {
  readonly pack: string;
  readonly id: string;
}

/**
 * A typed reference to one entry.
 *
 * `Kind` is a phantom — nothing carries it at run time, because a parameterised pack's tree does
 * not exist until it is bound and a reference has to be writable before that. What it buys is the
 * whole point of references being typed: `override()` knows whether it is looking at a guardrail
 * or a breadcrumb, so `.message()` on a breadcrumb and `.text()` on a guardrail are refused where
 * you type them rather than at a load nobody watches.
 */
export interface EntryRef<Kind extends EntrySpec["kind"] = EntrySpec["kind"]> {
  readonly [REF]: RefTarget;
  readonly "flow:kind"?: Kind;
}

/** The reference tree a pack presents — the same shape as the entries, refs at the leaves. */
export type Refs<T> = {
  readonly [K in keyof T]: T[K] extends Sentence<GuardrailSpec>
    ? EntryRef<"guardrail">
    : T[K] extends Sentence<BreadcrumbSpec>
      ? EntryRef<"breadcrumb">
      : T[K] extends EntryGroup
        ? Refs<T[K]>
        : never;
};

interface PackHandle<Params> {
  readonly [PACK]: PackDefinition;
  /** Phantom. It exists so `pack(tdd)` without parameters is not a call the compiler will make. */
  readonly "flow:params"?: Params;
}

/** What `definePack` hands back: the reference tree, with the definition riding underneath it. */
export type Pack<T extends EntryGroup, Params = undefined> = Refs<T> & PackHandle<Params>;

// ── the config's sentences ───────────────────────────────────────────────────

export interface PackBinding {
  readonly kind: "pack";
  /** `undefined` when the bound value was never a pack — what the load's `not-a-pack` reads. */
  readonly pack: PackDefinition | undefined;
  readonly params: unknown;
  /** Were parameters supplied at all? The load's coarse backstop behind the compiler's fine one. */
  readonly hasParams: boolean;
}

export interface OverrideBinding {
  readonly kind: "override";
  readonly ref: RefTarget;
  /** ONLY the keys the chain spoke. An absent key here is one that flows through from the pack. */
  readonly spoken: Readonly<Record<string, unknown>>;
}

export type Binding = PackBinding | OverrideBinding;

/** A whole guard, as its config file states it: bindings, in the order they were spoken. */
export interface FlowConfig {
  readonly bindings: readonly Binding[];
}

// ── definePack ───────────────────────────────────────────────────────────────

/**
 * Declare a pack: a name, and its entries.
 *
 * The entries argument is `T & CompleteEntry<T>` — the first half infers the tree, the second
 * checks every sentence in it. An incomplete one lands on a string literal whose text names the
 * verb it never said, so the editor's error is the instruction.
 */
export function definePack<T extends EntryGroup>(name: string, entries: T & CompleteEntry<T>): Pack<T>;
export function definePack<Params, T extends EntryGroup>(
  name: string,
  factory: (params: Params) => T & CompleteEntry<T>,
): Pack<T, Params>;
export function definePack(
  name: string,
  entries: EntryGroup | ((params: never) => EntryGroup),
): Pack<EntryGroup, never> {
  const takesParams = typeof entries === "function";
  const build = (params: unknown): EntryGroup =>
    typeof entries === "function" ? entries(params as never) : entries;
  return refProxy(name, [], { name, build, takesParams }) as Pack<EntryGroup, never>;
}

// One proxy serves both jobs a pack value has: it IS the reference tree, and it CARRIES the
// definition. Lazy by necessity — a parameterised pack's entries do not exist until a `pack()`
// line supplies the parameters, and `override(tdd.commitRunsTests)` has to be writable before
// that. So a property access never asks the tree anything; it just gets longer, and whether the
// path it built names a real entry is settled at load.
function refProxy(packName: string, path: readonly string[], definition?: PackDefinition): object {
  const target: Record<string, unknown> = {
    [REF]: { pack: packName, id: path.join(".") },
    ...(definition ? { [PACK]: definition } : {}),
  };
  return new Proxy(target, {
    get(t, key) {
      if (typeof key !== "string") return undefined;
      return key in t ? t[key] : refProxy(packName, [...path, key]);
    },
  });
}

/** The definition riding under a pack value, or undefined if this was never made by definePack. */
export function packDefinition(value: unknown): PackDefinition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const held = (value as Record<string, unknown>)[PACK];
  return isPackDefinition(held) ? held : undefined;
}

function isPackDefinition(value: unknown): value is PackDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PackDefinition).name === "string" &&
    typeof (value as PackDefinition).build === "function"
  );
}

/** Where a reference points, or undefined if this was never a reference. */
export function refTarget(value: unknown): RefTarget | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const held = (value as Record<string, unknown>)[REF];
  if (typeof held !== "object" || held === null) return undefined;
  const { pack: packName, id } = held as RefTarget;
  return typeof packName === "string" && typeof id === "string" ? { pack: packName, id } : undefined;
}

// ── pack() ───────────────────────────────────────────────────────────────────

/**
 * Bind a pack — all its entries, opt-out.
 *
 * ONE signature, not two overloads, and the reason is the error message. A pack that declares no
 * parameters carries `Params = undefined`, and the rest-tuple below then resolves to `[]` — so
 * `pack(git)` is a complete call. A pack that DOES declare them infers its own parameter type,
 * the tuple gains a required member, and `pack(tdd)` is short an argument: "Expected 2 arguments,
 * but got 1", at the line you typed. Two overloads produced the same refusal wearing a diagnostic
 * about a phantom property, which was true and unreadable.
 */
export function pack<T extends EntryGroup, Params>(
  definition: Pack<T, Params>,
  ...params: undefined extends Params ? [] : [params: Params]
): PackBinding;
export function pack(definition: object, ...params: readonly unknown[]): PackBinding {
  // A value that is not a pack still produces a binding, holding nothing. Refusing here would
  // mean throwing from pure code and losing every OTHER fault in the file; the load collects them
  // all and reports them together.
  return {
    kind: "pack",
    pack: packDefinition(definition),
    params: params[0],
    hasParams: params.length > 0,
  };
}

// ── override() ───────────────────────────────────────────────────────────────

type OverrideKey = "at" | "for" | "on" | "ignore" | "message" | "text" | "file" | "disabled" | "description";

type Once<Spoken extends string, Key extends string, Verb> = Key extends Spoken ? never : Verb;

interface OverrideChain<Kind extends EntrySpec["kind"], Spoken extends OverrideKey> {
  readonly binding: OverrideBinding;
  readonly at: Once<
    Spoken,
    "at",
    (
      ...moments: (Kind extends "guardrail" ? GuardrailMoment : BreadcrumbMoment)[]
    ) => OverrideChain<Kind, Spoken | "at">
  >;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => OverrideChain<Kind, Spoken | "for">>;
  readonly on: Once<Spoken, "on", (...globs: string[]) => OverrideChain<Kind, Spoken | "on">>;
  readonly ignore: Once<Spoken, "ignore", (...globs: string[]) => OverrideChain<Kind, Spoken | "ignore">>;
  readonly message: Kind extends "guardrail"
    ? Once<Spoken, "message", (message: string) => OverrideChain<Kind, Spoken | "message">>
    : never;
  readonly text: Kind extends "breadcrumb"
    ? Once<Spoken, "text", (text: string) => OverrideChain<Kind, Spoken | "text">>
    : never;
  readonly file: Kind extends "breadcrumb"
    ? Once<Spoken, "file", (path: string) => OverrideChain<Kind, Spoken | "file">>
    : never;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => OverrideChain<Kind, Spoken | "disabled">>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => OverrideChain<Kind, Spoken | "description">
  >;
}

/**
 * Override one entry, speaking only what changes.
 *
 * There is no `.check()` and no `.test()` here, and their absence is the design: an override can
 * move an entry, reword it or switch it off, but it can never reach inside what the entry ASKS.
 */
export function override<Kind extends EntrySpec["kind"]>(ref: EntryRef<Kind>): OverrideChain<Kind, never> {
  const target = refTarget(ref) ?? { pack: "", id: "" };
  return overrideChain({ kind: "override", ref: target, spoken: {} }) as OverrideChain<Kind, never>;
}

function overrideChain(binding: OverrideBinding): unknown {
  const next = (patch: Record<string, unknown>): unknown =>
    overrideChain({ ...binding, spoken: { ...binding.spoken, ...patch } });
  return {
    binding,
    at: (...moments: string[]) => next({ at: moments }),
    for: (...categories: unknown[]) => next({ for: categories }),
    on: (...globs: string[]) => next({ on: globs }),
    ignore: (...globs: string[]) => next({ ignore: globs }),
    message: (message: string) => next({ message }),
    text: (text: string) => next({ text }),
    file: (file: string) => next({ file }),
    disabled: (reason?: string) => next({ disabled: reason === undefined ? {} : { reason } }),
    description: (description: string) => next({ description }),
  };
}

// ── defineConfig ─────────────────────────────────────────────────────────────

/** Anything a config line may be: a pack binding, or an override chain at any point in its chain. */
export type ConfigSentence = PackBinding | { readonly binding: OverrideBinding };

/**
 * The config: the sentences, in order.
 *
 * It records and does not judge. Every refusal lives in `loadConfig` instead, for one reason —
 * a config with three mistakes should report three, and a function that threw on the first would
 * report one and hide the rest behind a fix.
 */
export function defineConfig(sentences: readonly ConfigSentence[]): FlowConfig {
  return {
    bindings: sentences.map((s) => ("binding" in s ? s.binding : s)),
  };
}

// ── the overlay ──────────────────────────────────────────────────────────────

/** An effective entry, and where each of its keys came from. */
export interface Overlaid {
  readonly spec: EntrySpec;
  readonly source: Readonly<Record<string, "pack" | "override">>;
}

/**
 * Lay an override's spoken keys over a pack's definition.
 *
 * A named key replaces the pack's WHOLE key — lists never merge, so an override that narrows one
 * glob restates the others. That is deliberate: two merge semantics is two bugs, and it is the
 * same replacement rule the YAML shadows had, kept.
 */
export function overlay(base: EntrySpec, spoken: Readonly<Record<string, unknown>>): Overlaid {
  const source: Record<string, "pack" | "override"> = {};
  for (const key of Object.keys(base)) source[key] = "pack";
  for (const key of Object.keys(spoken)) source[key] = "override";
  return { spec: { ...base, ...spoken }, source };
}
