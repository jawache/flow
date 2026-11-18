// examples/default/guards/driven.ts — the flow pack a repo driven by work binds.
//
// Three entries: a breadcrumb that tells every session how a driven repo works, the guardrail that
// keeps the reviewers from writing what git would check in, and the one that refuses the Playwright
// CLI's `close-all` and `kill-all`, which close every session's browsers. The daemon enforces none
// of them; a driven repo turns them on in its own flow.config.ts:
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

import {
  breadcrumb,
  type CaseWorld,
  type Check,
  command,
  defineCategory,
  definePack,
  gitCommand,
  guardrail,
  programName,
  quoteArg,
  session,
  type ShellCommand,
  shellCommands,
  spawnedAs,
} from "@jawache/flow";
import { posix } from "node:path";

// ── what a reviewer may not run ──
//
// The reviewers are the review lenses spawned to judge, never to build, at `/work docs`, at each
// task of `/work start` that added code, and at `/work review`. Each is recognised by the agent type
// Claude Code records for the spawn; the skill spawns every one by name. REVIEWERS is the one list
// of them: the category and the rule's message are built from it, with flow's public
// defineCategory and spawnedAs. Their tool lists allow only git diff, show and log, so this rule is
// a backstop.
const REVIEWERS = ["secops", "tech-lead", "tech-editor", "tech-writer", "devops", "coach"];
const reviewer = defineCategory("reviewer", spawnedAs({ types: REVIEWERS }));
/** The reviewers' names as a sentence lists them: `a, b or c`. */
const REVIEWER_NAMES = `${REVIEWERS.slice(0, -1).join(", ")} or ${REVIEWERS[REVIEWERS.length - 1]}`;

/** Programs that change files. */
const WRITE_PROGRAMS = new Set(["tee", "cp", "mv", "rm", "rmdir", "mkdir", "touch", "ln", "chmod", "chown", "truncate", "dd", "install", "unlink", "patch", "rsync"]);
/** Programs that edit a file in place when given -i. */
const IN_PLACE = new Set(["sed", "perl", "ruby"]);
/** git subcommands that change the history, the branches, the index or the working tree. */
const GIT_WRITES = new Set(["commit", "push", "pull", "add", "rm", "mv", "checkout", "switch", "restore", "reset", "merge", "rebase", "cherry-pick", "revert", "apply", "am", "clean", "init", "clone", "update-ref", "notes"]);
/** Programs among WRITE_PROGRAMS that read every argument but the last, the one they write. */
const COPIES = new Set(["cp", "install", "rsync", "ln"]);
/** Redirect operators that write a file. `>&` duplicates a descriptor (`2>&1`, `>&2`) and writes none. */
const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>"]);
/** Redirect targets that write no file: a device. */
const NO_FILE = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/** `git tag` flags that put it in list mode: `--list` itself, and those git says imply it. */
const TAG_LIST = /^(?:-l|--list|-n[0-9]*|--contains|--no-contains|--merged|--no-merged|--points-at)(?:=|$)/;
/** `git tag` flags that only shape a listing, and make one when no tag is named. */
const TAG_SHAPE = /^(?:--sort|--format|--column|--no-column|-i|--ignore-case|--color|--no-color|--omit-empty)(?:=|$)/;
/** `git tag` flags that create, delete or move a tag. */
const TAG_WRITE = /^(?:-[adfsuemF]|--delete|--annotate|--sign|--force|--local-user|--message|--file|--edit|--create-reflog)(?:=|$)/;

/** Whether `git tag` with these arguments only lists: no argument, a list-mode flag, or nothing but shaping flags; never a write flag. */
function tagLists(args: readonly string[]): boolean {
  if (args.some((a) => TAG_WRITE.test(a))) return false;
  return args.some((a) => TAG_LIST.test(a)) || args.every((a) => TAG_SHAPE.test(a));
}

/** What one parsed command does that is refused whatever it touches: it changes git, or writes the issue's log; or null. */
function refusedAlways(c: ShellCommand): string | null {
  const g = gitCommand(c);
  if (g !== null) {
    const [first = ""] = g.args;
    if (
      (g.subcommand !== null && GIT_WRITES.has(g.subcommand)) ||
      (g.subcommand === "worktree" && ["add", "remove", "move", "prune"].includes(first)) ||
      (g.subcommand === "stash" && !["list", "show"].includes(first)) ||
      (g.subcommand === "tag" && !tagLists(g.args)) ||
      (g.subcommand === "branch" && g.args.some((a) => /^-[dDmMcCf]$/.test(a) || ["--delete", "--move", "--copy", "--force"].includes(a)))
    )
      return `\`git ${g.subcommand}\` changes the branch, the history or the working tree`;
  }
  if (programName(c.program) === "work" && c.args[0] === "log") return "`work log` writes a line into the issue's log";
  return null;
}

/** A file one parsed command writes, as the command names it, and what writes it. */
interface Written {
  readonly path: string;
  readonly by: string;
}

/**
 * The files one parsed command writes: each redirect's target but a device, the operands of a
 * program that changes files (a copy's last alone), and the files an in-place edit is given. Null
 * when a program that changes files names none, as `rm` given its paths by `xargs` does: what it
 * writes cannot be told.
 */
function filesWritten(c: ShellCommand): Written[] | null {
  const out: Written[] = c.redirects.filter((r) => WRITE_REDIRECTS.has(r.operator) && !NO_FILE.has(r.target)).map((r) => ({ path: r.target, by: `a \`${r.operator}\` redirect` }));
  const prog = programName(c.program);
  let paths: string[] = [];
  if (WRITE_PROGRAMS.has(prog)) {
    const operands = c.args.filter((a) => a !== "" && !a.startsWith("-"));
    paths = COPIES.has(prog) ? operands.slice(-1) : operands;
  } else if (IN_PLACE.has(prog) && c.args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"))) {
    paths = inPlaceFiles(c.args);
  } else {
    return out;
  }
  if (paths.length === 0) return null;
  return out.concat(paths.map((path) => ({ path, by: `\`${prog}\`` })));
}

/** The files an in-place edit (`sed -i`, `perl -pi -e`) is given: its operands but its script, the one after each `-e`, or with none the first. */
function inPlaceFiles(args: readonly string[]): string[] {
  const files: string[] = [];
  let scriptFirst = !args.includes("-e");
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "-e") {
      i++;
      continue;
    }
    if (a === "" || a.startsWith("-")) continue;
    if (scriptFirst) {
      scriptFirst = false;
      continue;
    }
    files.push(a);
  }
  return files;
}

/**
 * Whether path, written by a command run in folder, is a file git would check in, as git says:
 * inside a worktree of a repository, and not ignored, so `git check-ignore` exits 1. A path in the
 * scratchpad or a temp folder is in no worktree. One in the record is reached through `.work`, which
 * git ignores and never looks beyond. A relative path from a folder only running the line could
 * tell is taken as checked in.
 */
async function checkedIn(ctx: Parameters<Check>[0], folder: string | null, path: string): Promise<boolean> {
  if (folder === null && !path.startsWith("/")) return true;
  const at = posix.isAbsolute(path) ? posix.normalize(path) : posix.join(folder ?? "/", path);
  let tree = folder ?? "/";
  if (at.startsWith("/")) {
    const list = await ctx.exec(`git ${folder === null ? "" : `-C ${quoteArg(folder)} `}worktree list --porcelain`);
    const trees = list.code === 0 ? [...list.stdout.matchAll(/^worktree (.+)$/gm)].map((m) => m[1] ?? "") : [];
    const holding = trees.filter((t) => at === t || at.startsWith(`${t}/`)).sort((a, b) => b.length - a.length);
    if (holding[0] === undefined) return false;
    tree = holding[0];
  }
  const ignored = await ctx.exec(`git -C ${quoteArg(tree)} check-ignore -q -- ${quoteArg(at)}`);
  return ignored.code === 1;
}

/** A heredoc, its opener and its body to its terminator: text a shell reads, no assignment of the line. */
const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
/** `NAME=value` on its own, at the start of the line or of a command: value a quoted or a bare word with no `$`, backtick or `(`. */
const ASSIGNMENT = /(?:^|[\n;&|])[ \t]*(?:export[ \t]+)?([A-Za-z_]\w*)=(?:"([^"$`\\]*)"|'([^']*)'|([^\s"'$`;&|()\\<>]+))(?=[ \t]*(?:$|[\n;&|]))/g;

/**
 * The variables the line sets to a value it holds in plain text, as a reviewer holds its scratchpad's
 * path in `S=…`: only one the line, its heredoc bodies removed, assigns exactly once, and uses
 * nowhere before that assignment. Any other, assigned twice or used first, could hold another
 * value where it is used, and stays unresolved.
 */
function assignedIn(line: string): Map<string, string> {
  const text = line.replace(HEREDOC, "");
  const found = new Map<string, { value: string; at: number; count: number }>();
  for (const m of text.matchAll(ASSIGNMENT)) {
    const name = m[1] ?? "";
    found.set(name, { value: m[2] ?? m[3] ?? m[4] ?? "", at: m.index ?? 0, count: (found.get(name)?.count ?? 0) + 1 });
  }
  const vars = new Map<string, string>();
  for (const [name, { value, at, count }] of found) {
    const use = new RegExp(String.raw`\$(?:${name}\b|\{${name}\})`);
    if (count === 1 && !use.test(text.slice(0, at))) vars.set(name, value);
  }
  return vars;
}

/** path with each `$NAME` and `${NAME}` the line set (assignedIn) replaced by its value; one it did not set stays as written, as the path of a variable only running the line could tell. */
function expandVars(path: string, vars: ReadonlyMap<string, string>): string {
  return path.replace(/\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/g, (whole, a: string | undefined, b: string | undefined) => vars.get(a ?? b ?? "") ?? whole);
}

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
 * Every way the line changes git, writes the issue's log or writes a file git would check in
 * (checkedIn), each said once; it passes when the line only reads, runs and writes files of its
 * own, or cannot be parsed.
 */
const readAndRun: Check = async (ctx) => {
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  const found = new Set<string>();
  const vars = assignedIn(ctx.command ?? "");
  for (const c of commands) {
    const always = refusedAlways(c);
    if (always !== null) {
      found.add(always);
      continue;
    }
    const files = filesWritten(c);
    if (files === null) {
      found.add(`\`${programName(c.program)}\` changes files it does not name`);
      continue;
    }
    for (const f of files) {
      if (await checkedIn(ctx, c.folder, expandVars(f.path, vars))) found.add(`${f.by} writes ${f.path}, which git would check in`);
    }
  }
  return found.size === 0 ? ctx.ok() : ctx.fail([...found].join("; "));
};

/** A case's world in which every path the line writes is one git would check in. */
const TRACKED: CaseWorld = { exec: { "check-ignore": { code: 1 } } };
/** worktree list's answer in a case: the main checkout and one worktree, under /Users/me/src. */
const WORKTREES = "worktree /Users/me/src/app\nHEAD 1111111\nbranch refs/heads/main\n\nworktree /Users/me/src/app.worktrees/app-42-x\nHEAD 2222222\nbranch refs/heads/app-42-x\n";

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

  /**
   * Without it, a reviewer that reached a shell would have a builder's hands: it could fix the
   * defect it was sent to find, commit it, or write its own finding into the issue's log, and the
   * leader would then act on a review the reviewer made true. The reviewers' tool lists withhold
   * Edit and Write; this holds the shell to the same line. A file git would never check in, such as
   * one in its scratchpad or the record's artifacts/, changes nothing it reviews, so it may write
   * that.
   */
  reviewersReadAndRun: guardrail()
    .at(command)
    .for(reviewer)
    .everywhere()
    .check(readAndRun)
    .message(
      "You were spawned to review this work, as " + REVIEWER_NAMES + ": you read the change, and you change nothing in it. No file git would check in, no commit, no push, no line in the issue's log. Read it with `git diff`, `git show` and `git log`. A file of your own, in your scratchpad or the record's artifacts/, is yours to write. When a finding needs a change, say so in your report: the leader owns the code and decides what to change.",
    )
    .description("The reviewers read the change with git diff, show and log: a shell command that writes a file git would check in, changes git or writes the issue's log is refused.")
    .test({
      pass: [
        "go test ./...",
        "go test ./internal/cli/... -run TestRepoListJSON -v 2>&1 | tail -40",
        "just check >/dev/null 2>&1; echo $?",
        "git diff main...HEAD --stat",
        "git log --oneline -5",
        "git show HEAD:internal/cli/repo.go",
        "git status --short",
        "git stash list",
        "git branch --show-current",
        "git tag --list",
        "git tag",
        "git tag --sort=-v:refname | head -3",
        "git tag --contains HEAD",
        "git tag -n --points-at HEAD",
        "git tag --merged main --format='%(refname:short)'",
        "git -C ../app log -1",
        "gh pr view 57 --comments",
        "cat .work/app-42/issue.md",
        "tail -3 .work/app-42/log.jsonl",
        'grep -rn "a > b" docs',
        "rg -n 'rm -rf|git push' .",
        "which tee",
        "go vet ./... 2>/dev/null",
        "python3 - <<'EOF'\nprint(1 > 0)\nEOF",
        'echo "cp a b; git commit"',
        "cat <<-EOF\n\trm -rf internal\n\tgit push\n\tEOF",
        "body=$(cat <<'EOF'\ngit commit -am x > out.md\nEOF\n)\necho \"$body\" | head -1",
        'grep -n "> " notes.md',
        "git log --oneline -3 | xargs -n1 echo",
        "echo done >&2",
        // a file of its own: in its scratchpad, in no worktree, and in the record, past `.work`, which git ignores
        {
          command: "go test ./... > /private/tmp/claude-501/-Users-me-src-app/abc/scratchpad/test.log 2>&1",
          world: { exec: { "worktree list": { stdout: WORKTREES } } },
        },
        { command: "git diff main...HEAD > .work/app-42/artifacts/review-diff.txt", world: { exec: { "check-ignore": { code: 128, stderr: "fatal: pathspec '.work/app-42/artifacts/review-diff.txt' is beyond a symbolic link" } } } },
        { command: "cat <<'EOF' > tmp/notes.md\nfindings\nEOF", world: { exec: { "check-ignore": { code: 0 } } } },
        // a variable set earlier in the line is followed to the folder it names
        {
          command: "S=/private/tmp/claude-501/-Users-me-src-app/abc/scratchpad\nmkdir -p $S/probe\ncat > $S/probe/main.go <<'EOF'\npackage main\nEOF\ngo run $S/probe/main.go > \"$S/out.txt\"",
          world: { exec: { "worktree list": { stdout: WORKTREES }, "check-ignore": { code: 1 } } },
        },
        // a variable assigned twice holds its second value where it is used: here, the scratchpad
        {
          command: "S=internal\nS=/private/tmp/claude-501/s\necho x > $S/x.go",
          world: { exec: { "worktree list": { stdout: WORKTREES }, "check-ignore": { code: 1 } } },
        },
        // a copy reads its sources, and an in-place edit's script is no file: only the scratchpad's file is judged
        ...[
          "cp internal/a.go /private/tmp/claude-501/-Users-me-src-app/abc/scratchpad/a.go",
          "sed -i '' 's/a/b/' /private/tmp/claude-501/-Users-me-src-app/abc/scratchpad/notes.md",
          "perl -pi -e 's/a/b/' /private/tmp/claude-501/-Users-me-src-app/abc/scratchpad/notes.md",
        ].map((command) => ({ command, world: { exec: { "worktree list": { stdout: WORKTREES }, "check-ignore": { code: 1 } } } })),
      ],
      block: [
        { command: "echo x > notes.md", world: TRACKED },
        { command: "git diff main...HEAD > internal/review.txt", world: TRACKED },
        // a file checked in, by its whole path, in a worktree of the repo
        {
          command: "echo x > /Users/me/src/app.worktrees/app-42-x/internal/cli/x.go",
          world: { exec: { "worktree list": { stdout: WORKTREES }, "check-ignore": { code: 1 } } },
        },
        { command: "go test ./... > out.log 2>&1", world: TRACKED },
        // a variable that names a folder of the repo, and one whose value the line does not hold, are judged as a path in the repo
        {
          command: "S=/Users/me/src/app.worktrees/app-42-x/internal\ncat > $S/x.go <<'EOF'\npackage x\nEOF",
          world: { exec: { "worktree list": { stdout: WORKTREES }, "check-ignore": { code: 1 } } },
        },
        { command: "echo x > $S/x.go", world: TRACKED },
        // a variable assigned again after its use holds its first value there: internal, which git checks in
        { command: "S=internal; echo x > $S/x.go; S=/private/tmp/claude-501/s", world: TRACKED },
        { command: "cat <<'EOF'\nS=/private/tmp/claude-501/abc/scratchpad\nEOF\necho x > $S/x.go", world: TRACKED },
        { command: "go test ./... &> out.log", world: TRACKED },
        { command: "cat <<'EOF' >> README.md\nmore\nEOF", world: TRACKED },
        { command: "go test ./... | tee out.log", world: TRACKED },
        { command: "sed -i '' 's/a/b/' main.go", world: TRACKED },
        { command: "sed -i.bak s/a/b/ main.go", world: TRACKED },
        { command: "perl -pi -e 's/a/b/' main.go", world: TRACKED },
        { command: "cp a.go b.go", world: TRACKED },
        { command: "mv a.go b.go", world: TRACKED },
        { command: "rm -rf internal/x", world: TRACKED },
        { command: "/bin/rm -rf internal/x", world: TRACKED },
        { command: "sudo rm -rf internal/x", world: TRACKED },
        { command: "mkdir -p out", world: TRACKED },
        { command: "touch x.go", world: TRACKED },
        'git commit -m "fix(cli): the flag #44"',
        "git push",
        "cd sub && git push origin HEAD",
        "git -C ../app commit -am x",
        "git add .",
        "git checkout -- main.go",
        "git stash",
        "git reset --hard HEAD~1",
        "git restore main.go",
        "git branch -D old",
        "git tag v1.0.0",
        "git tag -d v1.0.0",
        "git tag --sort=-v:refname v1.0.0",
        "git tag -a v1.0.0 -m x --contains HEAD",
        "git worktree add ../x",
        { command: "sh -c 'echo x > f'", world: TRACKED },
        { command: "bash <<< 'rm -rf build'", world: TRACKED },
        "work log fyi <<'WORKLOG'\nThe review found nothing.\nWORKLOG",
        "work log question --ask 'Keep the cache?' <<'WORKLOG'\nx\nWORKLOG",
        { command: "cat <<-EOF > notes.md\n\tx\n\tEOF", world: TRACKED },
        { command: "x=$(cat <<'EOF'\nok\nEOF\n) && rm -f out.md", world: TRACKED },
        "if git push; then echo ok; fi",
        "git log --format=%h | xargs -n1 rm",
        { command: 'eval "rm -rf internal"', world: TRACKED },
        'n=$(git commit -m "fix (#44)")',
      ],
    }),
});
