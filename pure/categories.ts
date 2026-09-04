// flow/pure/categories.ts — WHO a rule binds to.
//
// A category is a value with its recognizer aboard: the thing that defines "builder" is the thing
// that knows how to spot one. That is the whole design, and the alternatives it rules out are why
// — a free match-function per rule gives every entry too much power and kills static reporting; a
// config-level classifier separate from the names splits definition from recognition; and a
// framework that SHIPS the names bakes one platform's vocabulary into the engine. Ruled 2026-09-04.
//
// Referenced-is-registered: a category any bound entry names is live, and nothing registers
// separately. There is no list to fall out of step with the code.
//
// flow ships NO category names. "builder", "parent", "checker" are the work platform's vocabulary,
// exported by work's own flow library; any repo defines bespoke ones the same one-line way.
//
// WHAT THE CLASSIFIER SEES is host-written evidence and never a claim the session made about
// itself — a session could lie, and permissions would then rest on the lie. Filling these facts
// from a real transcript is the adapter's job (F4/F5) and classifying with them is the engine's
// (F3); this file is the contract those two meet on.

/**
 * The host-written record of one session × agent, as a classifier sees it.
 *
 * Every field is something a HARNESS wrote, not something the session said. `agentType` is the
 * strongest of them — the sidecar the host writes beside every subagent transcript — and it is
 * what a classifier should key on when it exists.
 */
export interface SessionFacts {
  /** The head of this session's transcript: the brief it was started with, verbatim. */
  head: string;
  /** True when this is a spawned subagent rather than the parent session. */
  subagent: boolean;
  /** The host's own agent type for this spawn, from the sidecar it wrote. Absent on a parent. */
  agentType?: string | undefined;
  /** The human-readable label the spawning agent gave this subagent. Absent on a parent. */
  description?: string | undefined;
}

/** A category's recognizer: host-written facts in, a yes or no out. */
export type Classifier = (facts: SessionFacts) => boolean;

/**
 * A declared category. Only `defineCategory` makes one — the brand is what lets the load refuse
 * an entry that scoped itself to something that merely looks like a category.
 */
export interface Category {
  readonly [CATEGORY]: true;
  readonly name: string;
  readonly classify: Classifier;
}

// `Symbol.for`, not `Symbol()`: a config and a pack can end up importing two copies of flow (npm
// hoisting is not a guarantee), and a per-module symbol would make each copy's categories
// unrecognisable to the other — a refusal with no cause a reader could see.
const CATEGORY = Symbol.for("flow.category");

/** Declare a category: a name, and the recognizer that travels with it. */
export function defineCategory(name: string, classify: Classifier): Category {
  return { [CATEGORY]: true, name, classify };
}

/** Was this made by `defineCategory`? The load's backstop behind `.for()`'s typing. */
export function isCategory(value: unknown): value is Category {
  return typeof value === "object" && value !== null && CATEGORY in value;
}
