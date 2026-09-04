// flow/index.ts — the public surface. Everything a config file or a pack imports, and nothing
// else.
//
// It is a re-export and holds no logic, by the same rule the rest of the package follows: the
// decisions live in flow/pure, where they are proved. What this file DOES carry is the promise of
// what the name `@jawache/flow` means — a symbol that is not here is not public, and a pack that
// reaches past it into `flow/language/…` is coupled to an internal layout that will move.

export {
  guardrail,
  breadcrumb,
  type Sentence,
  type EntrySpec,
  type GuardrailSpec,
  type BreadcrumbSpec,
  type GuardrailSentence,
  type BreadcrumbSentence,
  type EntryGroup,
  type DisabledMark,
} from "./language/domain.ts";

export {
  definePack,
  pack,
  override,
  defineConfig,
  type Pack,
  type PackDefinition,
  type EntryRef,
  type RefTarget,
  type FlowConfig,
  type Binding,
  type PackBinding,
  type OverrideBinding,
  type ConfigSentence,
} from "./language/domain.ts";

// `verdict` is deliberately absent: a check answers through `ctx.ok()` / `ctx.fail(detail)`, and
// one answer should have one spelling. The constructors stay internal to flow, for the code that
// BUILDS a ctx — see the CHECKS section of flow/language/domain.ts.
export {
  defineCheck,
  type Check,
  type Ctx,
  type Verdict,
  type ExecResult,
  type TurnAction,
  type Case,
  type CaseWorld,
  type Cases,
} from "./language/domain.ts";

export { defineCategory, type Category, type Classifier, type SessionFacts } from "./language/domain.ts";

export {
  write,
  command,
  commit,
  deletion,
  turnEnd,
  session,
  touch,
  type Moment,
  type GuardrailMoment,
  type BreadcrumbMoment,
} from "./language/domain.ts";

export {
  loadConfig,
  REFUSAL_CODES,
  type Refusal,
  type RefusalCode,
  type LoadResult,
  type LoadedEntry,
} from "./language/domain.ts";

export { FlowConfigError, entriesOrThrow } from "./errors.ts";
