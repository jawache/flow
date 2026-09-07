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
  type World,
  type Verdict,
  type ExecResult,
  type TurnAction,
  type Case,
  type CaseWorld,
  type Cases,
} from "./language/domain.ts";

export { defineCategory, type Category, type Classifier, type SessionFacts } from "./language/domain.ts";

// ── the stock checks, and the command reader they are written against ────────
//
// THE LIBRARY IS PART OF THE PROMISE. A pack is just code, and the code it is made of is these:
// thirteen configured checks that cover what a guard actually asks — a banned shape in a file, a
// banned command, a protected path, a JSON invariant, an import fence, a gate that runs a tool.
// A pack that could not reach them would have to re-implement each one, and thirteen private
// re-implementations is the string registry this package exists to delete, wearing a new coat.
//
// They come through THIS door and never `@jawache/flow/checks`, for the same reason the grammar
// does: the layer path is internal and free to move.
export {
  astGrep,
  banCommands,
  canonicalFiles,
  changeTogether,
  commitReason,
  depcruise,
  execPasses,
  jsonInvariant,
  protectedPath,
  ranSinceEdit,
  siblingExists,
  symbolsInSibling,
  textBan,
  type CanonOptions,
  type ChangeGroup,
  type Dialect,
  type DiffAdds,
  type ForbidEdge,
  type JsonAssert,
  type RequireEdge,
} from "./checks/domain.ts";

// The one shared PATTERN, and the sentence that goes with it — the pair `banCommands` above is
// most often configured with, and the only piece of a rule's content this door carries.
//
// It is here because TWO PACKS say it: `git` polices `git commit` and the `gh` verbs, `work`
// polices the lifecycle verbs that write to an append-only journal, and the tail of the expression
// — an open double quote reaching a backtick, without crossing a quoted heredoc — is identical.
// Anything two packs share is a core check by the rule F5 settled; the alternative was a shared
// module beside the packs, which is what this was, and it had grown four unrelated sections around
// this pair before anyone noticed it had become a bag.
export { substitutionInProse, SUBSTITUTION_MESSAGE } from "./checks/domain.ts";

// The four readings of a command line a bespoke check needs, and the reason they are public: a
// repo writing its own command rule otherwise writes its own shell tokeniser, and a tokeniser that
// does not know a newline separates commands is how `git commit -m "bad"` sails through as line 2
// of a batch. One parser, proved once, for every rule in every repo.
//
// `quoteArg` is the fifth, and it is the same argument in the other direction: a check that reads
// a command usually goes on to BUILD one for `ctx.exec`, and a path interpolated raw is a path
// whose apostrophe ends the quoting. Written by hand it is a one-liner everybody gets almost
// right; there is one of them in this package and it is this.
//
// `gitDirPrefix` is the sixth, and it answers the question every command rule that shells out has
// to ask before it reads anything: WHICH REPO is this command about. A `git -C ~/other-repo commit`
// judged against this repo's index once vetoed another repo's commit over files it could not see.
// `commitReason` carries the fix; the packs that shell out live outside this package, so the fix
// has to come through the door with them or each one re-derives it and one of them gets it wrong.
export {
  commitMessage,
  gitDirPrefix,
  gitInvocations,
  givesReason,
  quoteArg,
  tokenizeCommand,
  type GitInvocation,
} from "./checks/domain.ts";

// The stock way to write a classifier — the engine's, because the ORDER host-written evidence must
// be read in is engine knowledge (and was measured, not chosen). A bespoke `defineCategory(name,
// facts => …)` remains the escape hatch; this is the path that cannot be got wrong.
export { spawnedAs, type SpawnRecipe } from "./engine/domain.ts";

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
  refusalText,
  REFUSAL_CODES,
  type Refusal,
  type RefusalCode,
  type LoadResult,
  type LoadedEntry,
  type Settings,
} from "./language/domain.ts";

export { FlowConfigError, entriesOrThrow } from "./errors.ts";
