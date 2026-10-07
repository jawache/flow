// flow/flow.ts — the `flow` binary, and the only file in this package that reaches the world on
// its own account.
//
// It is the CLI SHELL: it reads argv, loads a config file off disk, prints, and sets an exit code.
// Every judgement it prints was made in a domain file that could not have done any of those things
// — which is the same seam the adapter sits on for the live hooks.
//
// SEVEN VERBS, in three halves.
//
//   THE LIVE HALF, invoked by something else rather than by a person:
//     flow hook <event>    what the harness's registrations call, payload on stdin
//     flow hook commit     what git's pre-commit hook calls; it asks git what the commit changes
//
//   THE ASKING HALF, which a person types:
//     flow test [config]   every bound entry's cases, driven
//     flow status          what is bound here, and what is not wired yet
//     flow replay <file>   a recorded session back through the engine, with no repo and no harness
//     flow facts           what the record and the conversations say about this repo
//
//   THE SETUP, typed once:
//     flow init [--empty]  scaffold a config, arm the gate, register the hooks
//
// Anything else refuses, loudly, rather than doing nothing quietly.
//
// The hook and commit verbs are one line each here, and that is the seam working: everything they
// do is the adapter's, and this file only owns argv, the three IO edges and the exit code.

import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { VERSION } from "./version.ts";
import { entriesOrThrow, FlowConfigError } from "./errors.ts";
import { loadConfig, type FlowConfig, type LoadedEntry } from "./language/domain.ts";
import { runCases, type CaseResult } from "./checks/domain.ts";
import { commitEntry, hookEntry, registerGrammars } from "./adapter/claude.ts";
import { facts } from "./adapter/archive.ts";
import {
  CONFIG_FILE,
  HOOK_EVENTS,
  configLoadFault,
  formatFacts,
  loadsAsStrippedModule,
  snip,
  type HookResult,
} from "./adapter/domain.ts";
import { runInit, runStatus, type VerbResult } from "./adapter/product.ts";
import { diffRows, replay, type Row } from "./engine/domain.ts";
import { loadRecording, readRowsFile } from "./engine/state.ts";

const argv = process.argv.slice(2);

// Loading a TypeScript config makes node print an ExperimentalWarning about type stripping, to
// stderr, on every single run. flow is a GUARD: its binary is invoked by a hook on every write,
// every command and every commit, and stderr is where its refusals are read. Two lines of node
// housekeeping in front of every one of them is how a real message stops being noticed. Replacing
// the default handler rather than passing `--no-warnings` keeps every OTHER warning — a real one
// deserves to be seen.
process.removeAllListeners("warning");
process.on("warning", (w: Error) => {
  if (w.name !== "ExperimentalWarning") process.stderr.write(`${w.stack ?? w.message}\n`);
});

/*
 * TEACH THIS PROCESS TO LOAD THE GUARDED REPO'S TYPESCRIPT ITSELF — registered here, at the top of
 * the binary, before either door below imports a config. The reason flow works in a repo that is
 * not `type: "module"`.
 *
 * `module.registerHooks` is node's synchronous, in-thread loader hook (node >= 22.15, and flow's
 * floor is 24). The load hook is handed a url and returns the source and the format to evaluate it
 * as, so `loadsAsStrippedModule` picks out the consumer's own `.ts` files and this hands node the
 * type-stripped text as `module`. The nearest `package.json` never gets a say, which is the whole
 * point: a config is written in `import` statements and a guard may not require a repo to change
 * its own module system to be guarded.
 *
 * WHY THE SOURCE IS READ HERE rather than asked of `nextLoad`: node decides the format BEFORE the
 * hook chain returns, and `nextLoad(url, { ...context, format: "module" })` is not a request to
 * strip — it hands the raw TypeScript to the ESM compiler, which dies on the first `interface`.
 * Measured on node v24.1.0 while this was written; the failure is a `SyntaxError: Unexpected strict
 * mode reserved word`, pointing at a line that is valid TypeScript.
 *
 * ONE REGISTRATION, at module scope rather than behind a function somebody has to remember to
 * call: the binary has two doors onto a config file (`flow test` loads one by path, the live rails
 * load the repo's own) and this covers both without either knowing it is there.
 *
 * `stripTypeScriptTypes` in `strip` mode erases types and rewrites nothing, so a line number in a
 * stack trace is still the line in the file; `sourceUrl` is what keeps the file's own name on it.
 */
registerHooks({
  load(url, context, nextLoad) {
    if (!loadsAsStrippedModule(url)) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url }),
    };
  },
});

/**
 * Load a config FILE — the one thing in flow that turns a path into a regime.
 *
 * The import is dynamic and the file is TypeScript, which node runs directly by stripping the types.
 * A node too old to do that fails on the import with a syntax error that says nothing useful about
 * the cause, so the message is rewritten — by `configLoadFault`, which is also what the live hook
 * rail uses, because one breakage described two ways is a guard nobody learns to read.
 */
async function loadFile(path: string): Promise<FlowConfig> {
  const absolute = resolve(process.cwd(), path);
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  } catch (error) {
    throw new Error(configLoadFault(path, (error as Error).message, process.versions.node));
  }
  const config = module.default;
  if (!config || typeof config !== "object" || !Array.isArray((config as FlowConfig).bindings)) {
    throw new Error(
      `${path} has no default export from \`defineConfig([…])\` — that call IS the config, and its result is what flow reads.`,
    );
  }
  // The grammars a config declares are registered the moment it is read, against the config's OWN
  // directory — the same call the hook rail makes, so `flow test` and a live write resolve a
  // language the same way. A config that declares none clears the list, which is what makes
  // `flow test <other-config>` an honest answer rather than one coloured by the last file read.
  registerGrammars((config as FlowConfig).settings, dirname(absolute));
  return config as FlowConfig;
}

/** One line per case, and a hit is quoted with what it should have done instead. */
function report(entries: readonly LoadedEntry[], results: readonly CaseResult[]): number {
  const failed = results.filter((r) => !r.ok);
  const bound = entries.filter((e) => e.spec.kind === "guardrail" && !e.spec.disabled).length;
  for (const r of failed) {
    process.stdout.write(`  ✗ ${r.entry} · ${r.expect} case ${r.index + 1}\n      ${r.detail}\n`);
  }
  const disabled = entries.filter((e) => e.spec.disabled).length;
  const tail = disabled ? ` · ${disabled} disabled, not run` : "";
  if (failed.length === 0) {
    process.stdout.write(`flow test — ${results.length} cases over ${bound} guardrails, all green${tail}\n`);
    return 0;
  }
  process.stdout.write(
    `flow test — ${failed.length} of ${results.length} cases failed, over ${bound} guardrails${tail}\n`,
  );
  return 1;
}

async function test(path: string): Promise<number> {
  const config = await loadFile(path);
  // Every refusal, not the first: a config with three mistakes should report three, and the second
  // one is usually the informative one.
  const entries = entriesOrThrow(loadConfig(config));
  return report(entries, await runCases(entries));
}

/**
 * A hook's three IO edges, performed. The ONE place flow turns an answer into an exit code.
 *
 * The adapter decides what to say and how loudly; this writes it. Keeping the write here rather
 * than inside the adapter is what lets every rail be asserted as a value in a unit test — the whole
 * reason `HookResult` is data and not a `process.exit`.
 */
function perform(result: HookResult): void {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

/** `--name value` and `--name`, off a flat argv. The whole of flow's option dialect. */
function flag(args: readonly string[], name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return null;
  const next = args[at + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
}

const positional = (args: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    if (!word.startsWith("--")) {
      out.push(word);
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) i += 1;
  }
  return out;
};

/**
 * REPLAY — J5.2, and the one verb that proves the seam rather than using it.
 *
 * A recording is the canonical event stream plus the answers the checks reached for while it was
 * live, so this opens no file the recording did not bring with it, runs no command, and asks git
 * nothing. `--against` diffs the judgements it produced against a live log: an EMPTY diff is the
 * proof, and it is what makes a bug a fixture before it is a fix.
 */
async function replayFile(args: readonly string[]): Promise<number> {
  const [file, configPath] = positional(args);
  if (file === undefined) {
    process.stderr.write("flow replay <recording.jsonl> [config] [--against <log.jsonl>]\n");
    return 2;
  }
  const config = await loadFile(configPath ?? CONFIG_FILE);
  const load = loadConfig(config);
  const recording = loadRecording(resolve(process.cwd(), file));
  if (recording.steps.length === 0) {
    process.stderr.write(`flow replay — ${file} holds no steps. Arm the recorder with \`touch .flow/record\`.\n`);
    return 2;
  }
  const result = await replay({ load, recording, settings: config.settings });

  // A row is read back off disk, so every field is `unknown` until something says otherwise — and
  // a subject can be a whole multi-line shell command, which would break the one-line-per-judgement
  // promise this listing makes. `snip` is the ONE "make it printable and short", ellipsis and all.
  const said = (row: Row, key: string): string => snip(row[key], 100);
  const judgements = result.rows.filter((row) => row.kind === "guardrail" || row.kind === "breadcrumb");
  for (const row of judgements) {
    const subject = said(row, "subject");
    process.stdout.write(
      row.kind === "guardrail"
        ? `  ✗ ${said(row, "id")} · ${said(row, "moment")}${subject === "" ? "" : ` · ${subject}`}\n`
        : `  🍞 ${said(row, "id")} · ${said(row, "moment")} · ${said(row, "cause")}\n`,
    );
  }
  process.stdout.write(
    `flow replay — ${recording.steps.length} steps · ${judgements.filter((r) => r.kind === "guardrail").length} blocked · ` +
      `${judgements.filter((r) => r.kind === "breadcrumb").length} shown, with no repo and no harness\n`,
  );

  // An unanswered reach means the recording did not capture something a check asked for, so the
  // verdict above rests on a silence rather than on evidence. It is reported as a failure, never
  // absorbed — a replay you cannot trust is worse than none.
  for (const miss of result.unanswered)
    process.stderr.write(`  ! the recording never answered a ${miss.kind} of \`${miss.asked}\`\n`);

  const against = flag(args, "against");
  if (against === null) return result.unanswered.length > 0 ? 1 : 0;
  const differences = diffRows(result.rows, readRowsFile(resolve(process.cwd(), against)));
  for (const row of differences) process.stderr.write(`  ${row.side === "replay" ? "+" : "-"} [${row.at}] ${row.row}\n`);
  process.stdout.write(
    differences.length === 0
      ? `flow replay — the replay and ${against} agree on every block and every injection. Diff empty.\n`
      : `flow replay — ${differences.length} difference(s) against ${against}.\n`,
  );
  return differences.length === 0 && result.unanswered.length === 0 ? 0 : 1;
}

/**
 * FACTS — what the record and the conversations say about this repo.
 *
 * The numbers come from flow's own rows and the pointers come from the transcripts, and the two
 * are never mixed: `--json` hands the whole structure over for a reader that wants to do its own
 * thinking, and `formatFacts` is the headline for one that does not. The prose is a pure home's,
 * not this file's — a report is a pile of branches about what a reader most needs to know, and the
 * branch that matters most is the one that fires least.
 */
async function readFacts(args: readonly string[]): Promise<number> {
  const root = process.cwd();
  const load = existsSync(join(root, CONFIG_FILE)) ? loadConfig(await loadFile(CONFIG_FILE)) : ({ ok: true, entries: [] } as const);
  const limit = flag(args, "limit");
  const since = flag(args, "since");
  const read = facts(root, load, {
    session: flag(args, "session"),
    branch: flag(args, "branch"),
    limit: limit === null || limit === "" ? null : Number(limit),
    all: flag(args, "all") !== null,
    largest: flag(args, "largest") !== null,
    since: since === null || since === "" ? null : Date.parse(since),
    mark: flag(args, "mark") !== null,
  });

  if (flag(args, "json") !== null) {
    process.stdout.write(`${JSON.stringify(read, null, 2)}\n`);
    return read.health.blocked === null ? 0 : 1;
  }
  const lines = formatFacts(read);
  process.stdout.write(`${lines.join("\n")}\n`);
  return read.health.blocked === null ? 0 : 1;
}

const [verb, ...rest] = argv;

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
} else if (verb === "test") {
  try {
    process.exitCode = await test(rest[0] ?? "flow.config.ts");
  } catch (error) {
    // A config that will not load is a REFUSAL, printed whole. Exit 2 rather than 1, because
    // "your rules are broken" and "your rules caught something" are different answers and a
    // caller — a hook, a git gate, a CI step — must be able to tell them apart.
    process.stderr.write(`${error instanceof FlowConfigError ? error.message : (error as Error).message}\n`);
    process.exitCode = 2;
  }
} else if (verb === "hook" && rest[0] === "commit") {
  // Git's hook, not the harness's: it carries no payload on stdin, so it never reaches the reader.
  perform(await commitEntry(rest.slice(1), process.cwd()));
} else if (verb === "hook") {
  perform(await hookEntry(rest[0] ?? "", process.cwd()));
} else if (verb === "commit") {
  // The name an older pre-commit hook calls. Kept so those commits still run the gate;
  // `flow status` tells the repo to update the hook, and the file list it passes is ignored.
  perform(await commitEntry(rest, process.cwd(), true));
} else if (verb === "init" || verb === "status") {
  // The product surface. Both answer with the same three edges every other verb does, which is why
  // neither of them writes to a stream or picks an exit code of its own.
  const answer: VerbResult = verb === "init" ? runInit(process.cwd(), rest) : await runStatus(process.cwd(), rest);
  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exitCode = answer.exitCode;
} else if (verb === "replay" || verb === "facts") {
  try {
    process.exitCode = verb === "replay" ? await replayFile(rest) : await readFacts(rest);
  } catch (error) {
    // Same split as `flow test`: exit 2 is "your rules are broken", exit 1 is "the answer is no".
    process.stderr.write(`${error instanceof FlowConfigError ? error.message : (error as Error).message}\n`);
    process.exitCode = 2;
  }
} else {
  process.stderr.write(
    [
      `flow ${VERSION}`,
      "",
      "  flow init [--empty]    scaffold flow.config.ts, arm the git gate, register the hooks",
      "  flow status [--json]   what is bound here, at which moments — and what is not wired yet",
      "  flow test [config]     run every bound entry's cases (default: flow.config.ts)",
      `  flow hook <event>      a harness hook, payload on stdin — ${HOOK_EVENTS.join(" · ")}`,
      "  flow hook commit       the git pre-commit gate, over the staged changes — --all for the whole tree",
      "  flow replay <file>     a recorded session, back through the engine — --against <log> diffs it",
      "  flow facts             what the record and the conversations say about this repo — --json for all of it",
      "",
    ].join("\n"),
  );
  process.exitCode = 2;
}
