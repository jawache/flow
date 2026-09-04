// flow/flow.ts — the `flow` binary, and the only file in this package that reaches the world on
// its own account.
//
// It is the CLI SHELL: it reads argv, loads a config file off disk, prints, and sets an exit code.
// Every judgement it prints was made in a domain file that could not have done any of those things
// — which is the same seam the adapter will sit on when the live hooks arrive at F4.
//
// THREE VERBS. `flow test` drives every bound entry's cases; `flow hook <event>` is what the
// harness's five registrations invoke; `flow commit <files…>` is what git's pre-commit hook calls
// with the staged set. `flow init` and `flow status` arrive with the product surface. Anything else
// refuses, loudly, rather than doing nothing quietly.
//
// The hook and commit verbs are one line each here, and that is the seam working: everything they
// do is the adapter's, and this file only owns argv, the three IO edges and the exit code.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { VERSION } from "./version.ts";
import { entriesOrThrow, FlowConfigError } from "./errors.ts";
import { loadConfig, type FlowConfig, type LoadedEntry } from "./language/domain.ts";
import { runCases, type CaseResult } from "./checks/domain.ts";
import { commitEntry, hookEntry } from "./adapter/claude.ts";
import { HOOK_EVENTS, type HookResult } from "./adapter/domain.ts";

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

/**
 * Load a config FILE — the one thing in flow that turns a path into a regime.
 *
 * The import is dynamic and the file is TypeScript, which node runs directly by stripping the
 * types (unflagged since 22.6). A node too old to do that fails on the import with a syntax error
 * that says nothing useful about the cause, so the message is rewritten here: a version floor is a
 * fact about the machine, and a machine fact should never arrive as a parse error.
 */
async function loadFile(path: string): Promise<FlowConfig> {
  const absolute = resolve(process.cwd(), path);
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  } catch (error) {
    const message = (error as Error).message;
    if (/Unexpected token|Unknown file extension|strip/i.test(message)) {
      throw new Error(
        `flow could not load ${path} as TypeScript. Node ${process.versions.node} may be too old — type stripping is on by default from 22.6. (${message})`,
      );
    }
    throw new Error(`flow could not load ${path}: ${message}`);
  }
  const config = module.default;
  if (!config || typeof config !== "object" || !Array.isArray((config as FlowConfig).bindings)) {
    throw new Error(
      `${path} has no default export from \`defineConfig([…])\` — that call IS the config, and its result is what flow reads.`,
    );
  }
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
} else if (verb === "hook") {
  perform(await hookEntry(rest[0] ?? "", process.cwd()));
} else if (verb === "commit") {
  perform(await commitEntry(rest, process.cwd()));
} else {
  process.stderr.write(
    [
      `flow ${VERSION}`,
      "",
      "  flow test [config]     run every bound entry's cases (default: flow.config.ts)",
      `  flow hook <event>      a harness hook, payload on stdin — ${HOOK_EVENTS.join(" · ")}`,
      "  flow commit <files…>   the git pre-commit gate, over the staged set",
      "",
      "`flow init` and `flow status` arrive with the product surface.",
      "",
    ].join("\n"),
  );
  process.exitCode = 2;
}
