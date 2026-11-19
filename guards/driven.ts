// NOT BOUND: flow.config.ts binds guards/work.ts, the same pack under the name work's template now
// gives it. This file stays until `house.noDeleteGuards` lets it be deleted.
//
// examples/default/guards/driven.ts — the flow pack a repo driven by work binds.
//
// Two entries: a breadcrumb that tells every session how a driven repo works, and the guardrail that
// refuses the Playwright CLI's `close-all` and `kill-all`, which close every session's browsers. The
// daemon enforces neither; a driven repo turns them on in its own flow.config.ts:
//
//   import { driven } from "./guards/driven.ts";
//   export default defineConfig([ …, pack(driven) ]);
//
// `work init --template` copies this file into the repo's guards/ folder, never links it: the
// import of @jawache/flow resolves from the repo's own node_modules, which a copy under ~/.work has
// none of.
//
// The guardrails on a command read the parse flow makes of each command line (`ctx.commands`, one
// entry per simple command, nested ones included): a program is compared without its path, a
// `$( )`, a `bash -c` string, an `eval` and a `sudo` are stepped into, and a heredoc body or a
// quoted argument is text, never a command. Needs @jawache/flow 0.4.0 or later.

import { breadcrumb, type Check, command, definePack, guardrail, programName, session, shellCommands } from "@jawache/flow";

// ── what no session may run ──

/** The Playwright CLI's two verbs that act on every session's browsers, wherever it is run from. */
const PLAYWRIGHT_ALL = new Set(["close-all", "kill-all"]);
/** A word that names the Playwright CLI as an argument of any program, npx and its kin among them: `@playwright/cli`, `playwright-cli`, either with a version. */
const PLAYWRIGHT_CLI_WORD = /^(?:@playwright\/cli|playwright-cli)(?:@.*)?$/;

/**
 * A command that runs the Playwright CLI's `close-all` or `kill-all`: the CLI is the program, an
 * argument of npx and its kin, or a variable the line expands as the program (`$PC close-all`, as
 * work-45 typed it). Only the parse's own words are read, so a search for the verb, a commit message
 * and a heredoc body that name it run nothing.
 */
const playwrightAll: Check = (ctx) => {
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  const found = commands.find(
    (c) =>
      c.args.some((a) => PLAYWRIGHT_ALL.has(a)) &&
      (programName(c.program) === "playwright-cli" || c.program.startsWith("$") || c.args.some((a) => PLAYWRIGHT_CLI_WORD.test(a))),
  );
  return found === undefined ? ctx.ok() : ctx.fail(found.text);
};

/**
 * A repo driven by work: the daemon types `[work]` lines into one Claude Code session per issue,
 * and the session tells the human with `work log`.
 *
 * @setup `work` on the PATH (it provides `work log`), and a `work.yml` at the repo root.
 */
export const driven = definePack("driven", {
  /**
   * Without it, a session in a driven repo reads `[work]` lines as a stranger's chatter, and
   * answers in the terminal where nobody is reading.
   */
  orientation: breadcrumb()
    .at(session)
    .text(
      [
        "This repo is driven by work. Each issue is a folder in the record, `.work/<id>/`, with one Claude Code session in its own worktree; the work daemon types lines starting with `[work]` into it. `[work] /work <verb> <issue>` is the issue entering a status: invoke the `work` skill, which dispatches the verb. Any other `[work]` line relays the daemon, such as a merge of the issue's branch.",
        "The record is `.work/<id>/`: `issue.md`, `tasks/`, `log.jsonl` and `artifacts/`. Git ignores it, so what you write there is saved as written and never committed. You edit `issue.md` and the tasks as Markdown; a move is `work issue next <id>`, which writes the `status:` line, and only where the skill says. Only the daemon writes `log.jsonl`: ask the human with `work log question --ask \"…\"` and its body on stdin as a quoted heredoc, then stop; tell them with `work log fyi`. Never record a session's state in the record.",
        "Print every link as a Markdown link, so the terminal opens it: `[tasks/3.md](http://localhost:4242/work-3/3)`, the port being `web:` in `~/.work/config.yml`.",
      ].join("\n"),
    )
    .description("How a repo driven by work works: [work] lines, the work skill, the record in .work, work log."),

  /**
   * Without it, a session that ends its demo with the Playwright CLI's `close-all` closes the browser
   * of every other session on the machine, whatever folder it types it in: the CLI keeps one registry
   * of open browsers for the user, and work-86's first `close-all` run closed the browser
   * work-95's session was measuring memory with. `kill-all` does the same, by force. A session closes its own browser by
   * the name it opened it with, `-s=<name> close`.
   *
   * The entry is a command that runs either verb through the CLI, named as `@playwright/cli`,
   * `playwright-cli` or a variable the line expands. Any status, any folder.
   */
  playwrightClosesOwnBrowser: guardrail()
    .at(command)
    .check(playwrightAll)
    .message(
      "`close-all` and `kill-all` of the Playwright CLI close every session's browsers on this machine, other issues' demos among them, whatever folder you type them in. Close your own browser by the name you opened it with: `npx -y @playwright/cli -s=<name> close`, `<name>` being the `-s=` you passed to `open`. `list --all` shows which are open.",
    )
    .description("The Playwright CLI's `close-all` and `kill-all`, which close every session's browsers, are refused in every session at any status; a close by name, `-s=<name> close`, runs.")
    .test({
      block: [
        "npx -y @playwright/cli close-all",
        "npx -y @playwright/cli kill-all",
        "npx @playwright/cli close-all >/dev/null 2>&1",
        "cd /tmp/scratch && npx @playwright/cli close-all >/dev/null 2>&1",
        "playwright-cli close-all",
        'PC="npx -y @playwright/cli@latest"; $PC close-all',
        "npx -y @playwright/cli@latest kill-all",
      ].map((command) => ({ command })),
      pass: [
        "npx -y @playwright/cli -s=app-42 close",
        "npx -y @playwright/cli list --all",
        "grep -rn close-all docs",
        "git commit -m 'docs: the guard refuses close-all and kill-all'",
        "work log fyi --on 1 <<'WORKLOG'\nThe rule refuses close-all and kill-all.\nWORKLOG",
      ].map((command) => ({ command })),
    }),
});
