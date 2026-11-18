// flow/packs/flow.ts — flow's own orientation and self-protection.
//
// AND THEY ARE THE `flow` PACK NOW, not `guard`, which is a rename worth its churn: every entry in
// every pack here is a guardrail or a breadcrumb, so `guard.` as a prefix said nothing that was not
// already true of `git.` and `tdd.`. What these three are actually about is FLOW — the config file,
// the packs it imports, the gate that runs them — and `flow.noDeleteGuardrails` names the thing
// being protected where `guard.noDeleteGuardrails` named the category it belongs to.
//
// Subtlety: WHERE those packs live is a mandatory parameter. One repo's name for the folder used to
// be written into the scope below, so every other repo bound a rule over a folder it does not
// have — a delete refusal that protects nothing, counted as armed. That is the exact failure flow exists to make impossible.
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

import {
  breadcrumb,
  command,
  commit,
  defineCheck,
  definePack,
  guardrail,
  programName,
  protectedPath,
  session,
  shellCommands,
  type Check,
  type ShellCommand,
} from "../index.ts";

/** The programs that start flow without being flow: the package runners, and node on the bundle or the bin link. */
const RUNNERS = new Set(["npx", "pnpx", "bunx", "yarn", "pnpm", "bun", "npm", "node"]);

/**
 * A word, less its path, that names flow: `flow` itself (`./node_modules/.bin/flow`), the package
 * at any version (`@jawache/flow@latest`), or the bundle (`dist/flow.mjs`). Compared whole, so
 * `workflow` and `scripts/workflow.mjs` are not flow.
 */
const FLOW = /^flow(?:@.+|\.mjs)?$/;

/**
 * The command runs `flow uninstall`: its program names flow, or it is a runner and one of its
 * arguments names flow, and the word after that is `uninstall` — flow's verb is always its first
 * word. A runner may sit any number of words before flow (`pnpm dlx`, `npm exec --`, node's own
 * options), so its arguments are searched rather than read at one position.
 */
function runsUninstall(c: ShellCommand): boolean {
  const words = [c.program, ...c.args];
  const namesFlowThenUninstall = (i: number): boolean => FLOW.test(programName(words[i] ?? "")) && words[i + 1] === "uninstall";
  return namesFlowThenUninstall(0) || (RUNNERS.has(programName(c.program)) && c.args.some((_, i) => namesFlowThenUninstall(i + 1)));
}

/** What ends a word in a line that does not parse, as `banCommands` reads one: whitespace, a quote, a backtick and the shell's operators. */
const EDGE = String.raw`\s'"\x60;&|()<>`;

/** The word, whole, anywhere in a line that does not parse. */
const wholeWord = (word: string): RegExp => new RegExp(`(?:^|[${EDGE}])${word}(?=$|[${EDGE}])`);

/** For a line that does not parse: a word naming flow, after any path, and the word `uninstall`, each whole. */
const UNPARSED = [wholeWord(`(?:[^${EDGE}]*/)?flow(?:@[^${EDGE}]+|\\.mjs)?`), wholeWord("uninstall")];

/**
 * Refuses `flow uninstall` in every way an agent can start flow, read from the parse, so a commit
 * message, an echo or a heredoc that names the command is prose about it. A check of its own rather
 * than `banCommands`, because two of those ways are a path or a version, which an entry in words
 * compares whole: `node node_modules/@jawache/flow/dist/flow.mjs uninstall`, and
 * `pnpm dlx @jawache/flow@<any version> uninstall`. A regex under `wholeLine` would read the line
 * as written, prose included, and refuse a commit message that quotes the node form.
 *
 * A line that does not parse is refused when it names flow and `uninstall` as whole words, as
 * `banCommands` refuses one: bash runs every complete command before a later syntax error, so
 * `flow uninstall` on a line above an unmatched `)` still runs.
 */
const noFlowUninstall = defineCheck(
  (_opts: Record<string, never>): Check =>
    (ctx) => {
      const parsed = shellCommands(ctx);
      if (parsed === null) {
        const line = ctx.command ?? "";
        return UNPARSED.every((re) => re.test(line)) ? ctx.fail("the line does not parse, and names flow and `uninstall` as whole words") : ctx.ok();
      }
      const found = parsed.filter(runsUninstall).map((c) => `\`${c.text}\` runs flow uninstall`);
      return found.length === 0 ? ctx.ok() : ctx.fail(found.join("\n"));
    },
);

/** The one fact this pack cannot know: where this repo keeps the packs its config imports. */
export interface Home {
  /**
   * Every glob covering a pack file `flow.config.ts` imports — one entry per folder a repo keeps
   * its own packs in, and `[]` in a repo whose rules are all written inline in the config.
   *
   * MANDATORY, and empty is a real answer rather than the absence of one. An unstated list is a
   * list nobody reviews, and here it decides what the rule watches: the refusal to
   * delete the guard. It names the folders and does not default.
   *
   * The engine reads the same folders out of the config's imports (`guardPaths`), for the
   * weaken-after-block report, because that report must answer while the config will not load
   * and text is all it can read then. This is the same fact asked at a moment where the config
   * loads, so it is stated once, here, and typed.
   */
  readonly packs: readonly string[];
}

/**
 * flow's own orientation and self-protection, as a pack any repo binds.
 *
 * Every guarded repo wants these three: a note saying what is steering you, a refusal when a commit
 * would delete the steering, and a refusal when an agent runs `flow uninstall`, which removes the guard without deleting a file the delete refusal watches.
 *
 * @setup A `flow.config.ts` at the repo root and a folder for the packs the repo writes itself —
 * whatever it is called, named here as the `packs` parameter. `flow init` writes both.
 * @adopt Bind it first, before any other pack: it is the one every guarded repo wants whether or
 * not it agrees with a single other opinion in this package.
 */
export const flow = definePack("flow", (repo: Home) => {
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
          "This repo is guarded by flow. A guardrail refuses a commit or a command, and a breadcrumb is text shown to you at a moment, such as the area you changed. Nothing stops you writing or deleting a file in the working tree, so a file is judged when it is staged: the commit is refused, with the guardrail's message, until it passes. A command is judged before it runs, by its words. A breadcrumb is shown at the start of a session, before a command, when you hand back, and after a tool call that changed a file it is about.",
          "The whole guard is `flow.config.ts` — every rule that fires is reachable from that one file, whether it comes from a pack the config imports or from a pack this repo writes itself. Nothing resolves at run time and nothing defaults: what you read there is what fires. Authoring a new entry is always welcome; never loosen a guardrail to get an edit through — that is the user's call.",
          "There is no bypass token anywhere in this system. A guardrail is on or off, and turning one off is `override(pack.entry).disabled(\"why\")` in flow.config.ts — a committed change, visible in review.",
          "If the config will not load, flow is off: no guardrail and no breadcrumb fires, and the load error comes with every call instead — at session start, before each command, after each other tool call and at turn-end — so the guard is never off without you reading that it is. Edits and commands go through, so you fix the config the way you do any other work, `npm ci` for a missing package included. The commit gate refuses every commit until the config loads again, so nothing written while flow was off reaches a commit before every guardrail has checked it.",
        ].join("\n"),
      ),

    noDeleteGuardrails: guardrail()
      .at(commit)
      .description("Refuses a commit that deletes the committed guard surface. No bypass — disable entries in the file instead.")
      // A deletion is read from the commit's own list, so the staged paths are left out of the
      // call: changing flow.config.ts or a pack is what a repo does all day, and deleting one is
      // the attack.
      .check((ctx) => protectedPath({ paths: ["flow.config.ts", ...repo.packs, ".githooks/commit-msg"] })({ ...ctx, staged: [] }))
      .message(
        "This commit deletes part of this repo's guard (flow.config.ts binds every rule; the packs it imports are where this repo writes its own; .githooks/commit-msg is what runs them at the gate). There is no bypass — `override(pack.entry).disabled(\"why\")` inside flow.config.ts is the visible, committed route.",
      )
      .test({
        pass: [{ staged: ["flow.config.ts"] }, { staged: [], deleted: ["src/a.ts"] }],
        block: [{ staged: [], deleted: ["flow.config.ts"] }, { staged: ["src/a.ts"], deleted: [".githooks/commit-msg"] }],
      }),

    /**
     * Without it, an agent that hit a guardrail could take the whole guard off with one command.
     * `flow uninstall` removes the commit gate, unsets `core.hooksPath` and removes flow's hook
     * registrations from inside its own process, so no shell command deletes a file that
     * `noDeleteGuardrails` watches, and that refusal never fires. A person in their own terminal
     * has no hooks in front of them, so this refusal never reaches them.
     */
    noUninstall: guardrail()
      .at(command)
      .everywhere()
      .description("Refuses `flow uninstall` when an agent runs it. Taking flow off a repo or a machine is the user's call, made in their own terminal.")
      .check(noFlowUninstall({}))
      .message(
        "`flow uninstall` removes this repo's guard: the commit gate, `core.hooksPath` and flow's hook registrations, and with `--machine` the hooks every repo on this machine runs. An agent does not take off the guard it works under, so there is no bypass. If flow should come off, say so and ask the user to run `flow uninstall` in their own terminal. If a guardrail is in your way, `override(pack.entry).disabled(\"why\")` inside flow.config.ts is the visible, committed route, and it is the user's call too.",
      )
      .test({
        pass: [
          "flow status",
          "flow init",
          "npx flow test",
          'git commit -m "docs: flow uninstall leaves flow.config.ts in place"',
          "cat > note.md <<'EOF'\nflow uninstall --machine\nEOF",
          "node scripts/workflow.mjs uninstall",
          "npx workflow uninstall",
          'echo "the hooks call node node_modules/@jawache/flow/dist/flow.mjs uninstall"',
          'git commit -m "node node_modules/@jawache/flow/dist/flow.mjs uninstall"',
          "npm test -- flow",
        ],
        block: [
          "flow uninstall",
          "flow uninstall --machine",
          "npx flow uninstall",
          "npx @jawache/flow uninstall --machine",
          "npm exec -- flow uninstall",
          "pnpm dlx @jawache/flow@latest uninstall",
          "pnpm dlx @jawache/flow@0.3.0 uninstall",
          "bunx flow uninstall",
          "pnpx flow uninstall",
          "yarn flow uninstall",
          "bun run flow uninstall",
          "/usr/local/bin/npx flow uninstall",
          "/opt/homebrew/bin/node node_modules/.bin/flow uninstall",
          "./node_modules/.bin/flow uninstall",
          "node node_modules/@jawache/flow/dist/flow.mjs uninstall",
          "node node_modules/.bin/flow uninstall",
          "node --enable-source-maps dist/flow.mjs uninstall",
          "./dist/flow.mjs uninstall",
          "sudo flow uninstall --machine",
          "cd app && flow uninstall",
          "bash -c 'flow uninstall --machine'",
          "flow uninstall\n)",
        ],
      }),
  };
});
