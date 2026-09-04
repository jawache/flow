// flow/pure/entries.ts — THE SENTENCE. One entry, spoken as a chain, and the data it becomes.
//
// The grammar is closed and final:
//
//   at · for · on · ignore · check · message | text | file · disabled · test · description
//
// and it rests on the three rules the YAML format died holding, now enforced by the compiler
// rather than by a validator nobody reached:
//
//   NOTHING IS DEFAULTED. A guardrail that never said .at(), .check(), .message() and .test() is
//   not an entry, and `definePack` refuses it at the line you typed. An absent `on` is absent, not
//   `**/*` — a reader never needs a check's private fallback to know what an entry does.
//
//   NOTHING EXTRA IS TOLERATED. The chain IS the key set. There is no `bans:`-for-`ban:` here,
//   because a key the grammar does not have is a method that does not exist.
//
//   NOTHING IS SAID TWICE. Each verb may be spoken once per sentence; a second `.on(…)` is not a
//   silent overwrite, it is a call the type system has already removed.
//
// The chain is IMMUTABLE — every verb returns a new sentence. That is what lets a pack build a
// family from a shared prefix without one entry's later verb reaching back into another's.
//
// A note on what a sentence is NOT: it never says WHERE it is bound. The config's `pack()` line
// does that, and the entry's id is the property it is filed under. You never write a name twice.

import type { GuardrailMoment, BreadcrumbMoment } from "./moments.ts";
import type { Category } from "./categories.ts";
import type { Check, Cases } from "./checks.ts";

// ── the data an entry IS ─────────────────────────────────────────────────────

/** An entry turned off, and why. The reason is the sentence `flow status` prints beside it. */
export interface DisabledMark {
  readonly reason?: string | undefined;
}

interface SpecCommon {
  readonly for?: readonly Category[];
  readonly on?: readonly string[];
  readonly ignore?: readonly string[];
  readonly disabled?: DisabledMark;
  readonly description?: string;
}

/** A guardrail, as its sentence stated it. Every key explicit; nothing derived. */
export interface GuardrailSpec extends SpecCommon {
  readonly kind: "guardrail";
  readonly at?: readonly GuardrailMoment[];
  readonly check?: Check;
  readonly message?: string;
  readonly test?: Cases;
}

/** A breadcrumb: a note, and the moments it shows at — all of them, not just the first. */
export interface BreadcrumbSpec extends SpecCommon {
  readonly kind: "breadcrumb";
  readonly at?: readonly BreadcrumbMoment[];
  readonly text?: string;
  readonly file?: string;
}

export type EntrySpec = GuardrailSpec | BreadcrumbSpec;

/**
 * The grammar's keys, per entry type — the closed sets the load re-checks.
 *
 * They are listed here rather than derived from the interfaces because a type is gone at run time
 * and the load happens at run time. Adding a verb below without adding it here would build an
 * entry the load then refuses, which is a loud failure and the right one.
 */
export const GUARDRAIL_KEYS = [
  "at",
  "for",
  "on",
  "ignore",
  "check",
  "message",
  "disabled",
  "test",
  "description",
] as const;

export const BREADCRUMB_KEYS = [
  "at",
  "for",
  "on",
  "ignore",
  "text",
  "file",
  "disabled",
  "description",
] as const;

export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
export type BreadcrumbKey = (typeof BREADCRUMB_KEYS)[number];

// ── the sentence, and the keys it has already spoken ─────────────────────────
//
// `Spoken` is the phantom: it grows by one word per chain call, and every verb already in it is
// typed `never`, so saying it twice is not a call the compiler will make. It costs nothing at run
// time — the object underneath carries all nine methods and always did.

type Once<Spoken extends string, Key extends string, Verb> = Key extends Spoken ? never : Verb;

/** Anything a pack may file under an entry name. The one shape `definePack` walks. */
export interface Sentence<S extends EntrySpec = EntrySpec> {
  readonly spec: S;
}

/** A group of entries, or of groups — a pack may nest, and `git.node.versionIsSemver` is why. */
export interface EntryGroup {
  readonly [key: string]: Sentence | EntryGroup;
}

export interface GuardrailSentence<Spoken extends GuardrailKey = never> extends Sentence<GuardrailSpec> {
  readonly at: Once<Spoken, "at", (...moments: GuardrailMoment[]) => GuardrailSentence<Spoken | "at">>;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => GuardrailSentence<Spoken | "for">>;
  readonly on: Once<Spoken, "on", (...globs: string[]) => GuardrailSentence<Spoken | "on">>;
  readonly ignore: Once<Spoken, "ignore", (...globs: string[]) => GuardrailSentence<Spoken | "ignore">>;
  readonly check: Once<Spoken, "check", (check: Check) => GuardrailSentence<Spoken | "check">>;
  readonly message: Once<Spoken, "message", (message: string) => GuardrailSentence<Spoken | "message">>;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => GuardrailSentence<Spoken | "disabled">>;
  readonly test: Once<Spoken, "test", (cases: Cases) => GuardrailSentence<Spoken | "test">>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => GuardrailSentence<Spoken | "description">
  >;
}

export interface BreadcrumbSentence<Spoken extends BreadcrumbKey = never> extends Sentence<BreadcrumbSpec> {
  readonly at: Once<Spoken, "at", (...moments: BreadcrumbMoment[]) => BreadcrumbSentence<Spoken | "at">>;
  readonly for: Once<Spoken, "for", (...categories: Category[]) => BreadcrumbSentence<Spoken | "for">>;
  readonly on: Once<Spoken, "on", (...globs: string[]) => BreadcrumbSentence<Spoken | "on">>;
  readonly ignore: Once<Spoken, "ignore", (...globs: string[]) => BreadcrumbSentence<Spoken | "ignore">>;
  readonly text: Once<Spoken, "text", (text: string) => BreadcrumbSentence<Spoken | "text">>;
  readonly file: Once<Spoken, "file", (path: string) => BreadcrumbSentence<Spoken | "file">>;
  readonly disabled: Once<Spoken, "disabled", (reason?: string) => BreadcrumbSentence<Spoken | "disabled">>;
  readonly description: Once<
    Spoken,
    "description",
    (description: string) => BreadcrumbSentence<Spoken | "description">
  >;
}

// ── completeness, as a type ──────────────────────────────────────────────────
//
// This is J1.3's compile-time half. `definePack` accepts `T & Complete<T>`: the first component
// infers the shape, the second checks it, and an incomplete sentence lands on a string literal
// whose TEXT is the diagnostic — which is why the error a reader gets names the missing verb
// instead of saying "not assignable to never".

type Missing<Spoken extends string, Required extends string> = Exclude<Required, Spoken>;

type NeverSaid<What extends string, Verb extends string> = Verb extends string
  ? `flow: this ${What} never said .${Verb}() — nothing defaults, so it is not an entry`
  : never;

/** A guardrail must say when it fires, what it asks, what it tells you, and what proves it. */
type GuardrailRequired = "at" | "check" | "message" | "test";

/** A breadcrumb must say when it shows, and carry its prose one of the two ways. */
type BreadcrumbProse = "flow: this breadcrumb has no prose — say .text(…) or .file(…)";

export type CompleteEntry<B> =
  B extends GuardrailSentence<infer S>
    ? "disabled" extends S
      ? B
      : [Missing<S, GuardrailRequired>] extends [never]
        ? B
        : NeverSaid<"guardrail", Missing<S, GuardrailRequired>>
    : B extends BreadcrumbSentence<infer S>
      ? "disabled" extends S
        ? B
        : [Missing<S, "at">] extends [never]
          ? "text" extends S
            ? B
            : "file" extends S
              ? B
              : BreadcrumbProse
          : NeverSaid<"breadcrumb", Missing<S, "at">>
      : B extends EntryGroup
        ? { readonly [K in keyof B]: CompleteEntry<B[K]> }
        : never;

// ── the builders ─────────────────────────────────────────────────────────────

// One implementation for both entry types: the verbs differ only in which keys they write, and
// the types above are what keep a breadcrumb from ever being handed `.check()`. Writing it twice
// would be two chances to drift.
//
// It works over an untyped record on purpose. The chain's types are a PROJECTION of this one
// object — nine verbs the caller can see a shrinking subset of — and no signature can describe
// that from the inside. The three casts are the seam; every claim the grammar makes is made in
// the interfaces above, where a reader can check it.
function chain(spec: Record<string, unknown>): Sentence {
  const next = (patch: Record<string, unknown>): Sentence => chain({ ...spec, ...patch });
  return {
    spec,
    at: (...moments: string[]) => next({ at: moments }),
    for: (...categories: Category[]) => next({ for: categories }),
    on: (...globs: string[]) => next({ on: globs }),
    ignore: (...globs: string[]) => next({ ignore: globs }),
    check: (check: Check) => next({ check }),
    message: (message: string) => next({ message }),
    text: (text: string) => next({ text }),
    file: (file: string) => next({ file }),
    disabled: (reason?: string) => next({ disabled: reason === undefined ? {} : { reason } }),
    test: (test: Cases) => next({ test }),
    description: (description: string) => next({ description }),
  } as unknown as Sentence;
}

/** Open a guardrail sentence. It blocks; it must therefore say what it asks and what it proves. */
export function guardrail(): GuardrailSentence {
  return chain({ kind: "guardrail" }) as unknown as GuardrailSentence;
}

/** Open a breadcrumb sentence. Breadcrumbs are data — no check, ever, and no rail to block. */
export function breadcrumb(): BreadcrumbSentence {
  return chain({ kind: "breadcrumb" }) as unknown as BreadcrumbSentence;
}

/** Is this an entry rather than a group of them? What `definePack` walks a pack's tree with. */
export function isSentence(value: unknown): value is Sentence {
  if (typeof value !== "object" || value === null || !("spec" in value)) return false;
  const { spec } = value;
  if (typeof spec !== "object" || spec === null || !("kind" in spec)) return false;
  return spec.kind === "guardrail" || spec.kind === "breadcrumb";
}
