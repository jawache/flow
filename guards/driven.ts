// examples/default/guards/driven.ts — the flow pack a repo driven by work binds.
//
// Three entries: a breadcrumb that tells every session how a driven repo works, the guardrail that
// keeps the agent on `work gh`, and the one that keeps the verifier from writing. The daemon
// enforces none of them; a driven repo turns them on in its own flow.config.ts:
//
//   import { driven } from "./guards/driven.ts";
//   export default defineConfig([ …, pack(driven) ]);
//
// `work init --template` copies this file into the repo's guards/ folder, never links it: the
// import of @jawache/flow resolves from the repo's own node_modules, which a copy under ~/.work has
// none of. It needs @jawache/flow 0.3.0 or later: it imports the parse's readers (`shellCommands`,
// `gitCommand`, `programName`), which an older flow does not export, and there the file fails to load.

import {
  banCommands,
  breadcrumb,
  type Check,
  command,
  definePack,
  gitCommand,
  guardrail,
  programName,
  session,
  shellCommands,
  type ShellCommand,
  type ShellRedirect,
  defineCategory,
  spawnedAs,
} from "@jawache/flow";

// The ban is matched against each command from its program name, and START opens with `^`, so it
// matches a bare `gh` at the start of a command; the rest of START also reads a `gh` later in a line.
//
// Where a shell starts a new command: the start of the line, after a separator, inside $( ) or
// backticks, after a brace or a keyword, or at the head of a string handed to a shell.
const START = String.raw`(?:^|[\n;&|({\x60]|\$\(|\b(?:ba|z)?sh\s+-c\s+['"]|\beval\s+['"]?)`;
/** Words that run the word after them as a command, so the program is further on. */
const PREFIXES = new Set(["command", "exec", "env", "sudo", "nohup", "time", "xargs", "if", "then", "else", "elif", "do", "while", "until", "!"]);
// What may sit between that start and the program: whitespace, variable assignments, and the
// PREFIXES (each with its own flags). An assignment whose value opens a `$(` is not skipped over:
// START already begins a new command inside it.
const LEAD =
  String.raw`\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?!\$\()\S*\s+)*(?:(?:` +
  [...PREFIXES].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
  String.raw`)(?:\s+-\S+)*\s+)*`;
// gh itself, by name or by path, as a whole word.
const GH = String.raw`(?:\S*/)?gh(?=\s|$|[;&|)\x60'"])`;

// ── what a checker may not run ──
//
// The checkers are the agents spawned to judge, never to build: the verifier `/work start` spawns
// at every sub-issue, the deduper beside it when the phase added logic, and the four review lenses
// `/work review` spawns. Each is recognised by the agent type Claude Code records for the spawn;
// the skill spawns every one by name. This pack lists them itself, with flow's public
// defineCategory and spawnedAs. The lenses' tool lists allow only git diff, show and log, so for
// them this rule is a backstop.
const checker = defineCategory(
  "checker",
  spawnedAs({ types: ["verifier", "deduper", "secops", "codeops", "docops", "devops"] }),
);

/** Programs that change files. */
const WRITE_PROGRAMS = new Set(["tee", "cp", "mv", "rm", "rmdir", "mkdir", "touch", "ln", "chmod", "chown", "truncate", "dd", "install", "unlink", "patch", "rsync"]);
/** Programs that edit a file in place when given -i. */
const IN_PLACE = new Set(["sed", "perl", "ruby"]);
/** git subcommands that change the history, the branches, the index or the working tree. */
const GIT_WRITES = new Set(["commit", "push", "pull", "add", "rm", "mv", "checkout", "switch", "restore", "reset", "merge", "rebase", "cherry-pick", "revert", "apply", "am", "clean", "init", "clone", "update-ref", "notes"]);
/** The `work gh <noun> <verb>` pairs that post to or change GitHub. */
const GH_WRITES: Readonly<Record<string, ReadonlySet<string>>> = {
  issue: new Set(["comment", "close", "create", "edit", "reopen", "lock", "unlock", "delete", "transfer", "pin", "unpin", "develop"]),
  pr: new Set(["comment", "close", "create", "edit", "reopen", "merge", "ready", "review", "lock", "unlock", "checkout"]),
  project: new Set(["item-add", "item-archive", "item-create", "item-delete", "item-edit", "field-create", "field-delete", "create", "edit", "delete", "close", "copy", "link", "unlink", "mark-template"]),
  label: new Set(["create", "edit", "delete", "clone"]),
  release: new Set(["create", "edit", "delete", "upload"]),
  repo: new Set(["create", "edit", "delete", "fork", "rename", "archive", "sync"]),
};
/** The redirect operators that write their target. `<` reads it; `>&` and `<&` duplicate a descriptor. */
const WRITES = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);
/** Targets that are no file: a device. */
const NO_FILE = /^\/dev\/(?:null|stdout|stderr|tty)$/;

/** Does this redirect write a file? `>&` writes one only when its target is not a descriptor. */
function writesFile(r: ShellRedirect): boolean {
  if (NO_FILE.test(r.target)) return false;
  return WRITES.has(r.operator) || (r.operator === ">&" && !/^(?:\d+|-)$/.test(r.target));
}

/**
 * What one parsed command writes, or null. The parse has already stepped past the wrappers and
 * lists every command a `$( )`, a `bash -c` or an `eval` string runs, so each is judged here.
 */
function writeOf(cmd: ShellCommand): string | null {
  const prog = programName(cmd.program);
  const { args } = cmd;
  if (WRITE_PROGRAMS.has(prog)) return `\`${prog}\` changes files`;
  if (IN_PLACE.has(prog) && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"))) return `\`${prog} -i\` edits a file in place`;
  const g = gitCommand(cmd);
  if (g !== null) {
    const [first = ""] = g.args;
    if (
      (g.subcommand !== null && GIT_WRITES.has(g.subcommand)) ||
      (g.subcommand === "worktree" && ["add", "remove", "move", "prune"].includes(first)) ||
      (g.subcommand === "stash" && !["list", "show"].includes(first)) ||
      (g.subcommand === "tag" && g.args.length > 0 && !["-l", "--list"].includes(first)) ||
      (g.subcommand === "branch" && g.args.some((a) => /^-[dDmMcCf]$/.test(a) || ["--delete", "--move", "--copy", "--force"].includes(a)))
    )
      return `\`git ${g.subcommand}\` changes the branch, the history or the working tree`;
  }
  if (prog === "work" && args[0] === "gh") {
    const [noun = "", verb = ""] = args.slice(1);
    if (GH_WRITES[noun]?.has(verb) === true) return `\`work gh ${noun} ${verb}\` posts to or changes GitHub`;
    if (noun === "api") {
      const rest = args.slice(2);
      const flag = rest.findIndex((a) => a === "-X" || a === "--method");
      const glued = rest.map((a) => /^(?:-X|--method=)(.+)$/.exec(a)?.[1]).find((v) => v !== undefined);
      const method = (glued ?? (flag >= 0 ? rest[flag + 1] : undefined))?.toUpperCase();
      const fields = rest.some((a) => /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)/.test(a) || /^-[fF]./.test(a));
      if (method !== undefined ? method !== "GET" : fields) return "`work gh api` with a method other than GET, or with fields (which make it a POST), changes GitHub";
    }
  }
  return null;
}

/** Every way the parsed line writes, each said once; null when it only reads and runs. */
function whatWrites(commands: readonly ShellCommand[]): string | null {
  const found = new Set<string>();
  for (const c of commands) {
    if (c.redirects.some(writesFile)) found.add("a `>` or `>>` redirect writes a file");
    const w = writeOf(c);
    if (w !== null) found.add(w);
  }
  return found.size === 0 ? null : [...found].join("; ");
}

const readAndRun: Check = (ctx) => {
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  const why = whatWrites(commands);
  return why === null ? ctx.ok() : ctx.fail(why);
};

/**
 * A repo driven by work: the daemon types `[work]` lines into one Claude Code session per issue,
 * and the session reaches GitHub only through `work gh`.
 *
 * @setup `work` on the PATH (it provides `work gh`), and a `work.yml` at the repo root.
 */
export const driven = definePack("driven", {
  /**
   * Without it, a session in a driven repo reads `[work]` lines as a stranger's chatter, answers
   * in the terminal where nobody is reading, and reaches for the `gh` it already knows.
   */
  orientation: breadcrumb()
    .at(session)
    .text(
      [
        "This repo is driven by work. Each GitHub issue on its board has one Claude Code session in its own worktree; the work daemon types lines starting with `[work]` into it. `[work] /work <verb> <issue>` is the card entering a Status: invoke the `work` skill, which dispatches the verb. Any other `[work]` line relays a comment, review, check or merge on the issue, its sub-issues or its pull request.",
        "GitHub is the record and the human reads it there, not in this terminal: ask in a comment that starts with `<!-- work:agent -->` and @mentions them, then stop. Every GitHub call is `work gh …`, which acts as the GitHub App, and as the human for `gh project`. Move the card only where the skill says; when stuck, post a Needs you on the parent issue and stop. A Needs you is the only comment that @mentions the human; the daemon labels the issue from it, so never add or remove a state label yourself.",
      ].join("\n"),
    )
    .description("How a repo driven by work works: [work] lines, the work skill, work gh, GitHub as the record."),

  /**
   * Without it, an agent falls back to the `gh` it knows: its comments and pull requests are
   * posted as the human, the daemon cannot tell them from the human's own, and a `project` call
   * as the App fails because an App cannot see a user's board.
   */
  noBareGh: guardrail()
    .at(command)
    .check(banCommands({ ban: [START + LEAD + GH] }))
    .message(
      "Bare `gh` in a repo driven by work. Run the same command as `work gh …`: it runs `gh project …` as you, so the board can be read and moved, and everything else as the GitHub App, so comments and pull requests are the App's and the daemon can tell them from yours. Bare `gh` would post as you.",
    )
    .description("Every GitHub call in a driven repo is `work gh`; a bare `gh` is refused before it runs.")
    .test({
      pass: [
        "work gh issue list",
        "work gh issue view 42 --comments",
        "cd sub && work gh pr create --draft --base dev --title x --body-file .work/tmp/pr.md",
        "/Users/me/go/bin/work gh project item-list 3 --owner me --format json",
        "bin/work gh api repos/me/app/issues/42/sub_issues",
        "pid=$(work gh project view 3 --owner me --format json --jq .id)",
        "git checkout -b fix-gh-login",
        'grep -rn "gh issue" docs',
        "which gh",
        "brew upgrade gh",
        "ls ~/.config/gh",
        "ghq get github.com/me/app",
        "cat > notes.md <<'EOF'\ngh issue list\nEOF",
        // Named inside another command's argument, gh is prose, not a call.
        "echo 'gh issue list'",
        'work gh issue comment 42 --body "ran gh issue list by mistake"',
      ],
      block: [
        "gh issue list",
        "gh pr create --draft --base dev",
        "cd sub && gh issue view 42 --comments",
        "git status\ngh issue list",
        "GH_TOKEN=x gh api user",
        "echo hi | gh issue comment 42 --body-file -",
        "n=$(gh pr view --json number -q .number)",
        "/opt/homebrew/bin/gh issue list",
        "command gh auth status",
        "xargs -n1 gh issue close",
        "sh -c 'gh issue list'",
        "if gh pr view; then echo open; fi",
      ],
    }),

  /**
   * Without it, the verifier's unrestricted Bash is a builder's: it can fix the defect it was sent
   * to find, commit it, or post its own verdict, and the leader then records a pass on evidence the
   * verifier made. Its tool list withholds Edit and Write; this holds the shell to the same line,
   * for the deduper and the review lenses too.
   */
  verifierReadsAndRuns: guardrail()
    .at(command)
    .for(checker)
    .check(readAndRun)
    .message(
      "You were spawned to check this work, as the verifier, the deduper or a review lens: you read and you run, and you change nothing. No file, no commit, no push, no post on GitHub. Run the proofs and the tests as the branch has them, and read their output through a pipe (`| tail`, `| grep`) rather than a file. When a proof needs a change, or a state the worktree is not in, say so in your report: the leader owns the code and records the verdict.",
    )
    .description("The verifier, the deduper and the review lenses read and run: a shell command that writes a file, changes git or posts to GitHub is refused.")
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
        "git -C ../app log -1",
        "work gh issue view 44 --comments",
        "work gh pr view --comments",
        "work gh api repos/{owner}/{repo}/issues/42/sub_issues --jq '.[].number'",
        "work gh api -X GET search/issues -f q=repo:me/app",
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
        "wc -l < notes.md",
        "go test ./... 2>&1 >/dev/null | tail -5",
        "go test 2>&-",
      ],
      block: [
        "echo x > notes.md",
        "go test ./... > out.log 2>&1",
        "cat <<'EOF' >> README.md\nmore\nEOF",
        "go test ./... | tee out.log",
        "sed -i '' 's/a/b/' main.go",
        "sed -i.bak s/a/b/ main.go",
        "perl -pi -e 's/a/b/' main.go",
        "cp a.go b.go",
        "mv a.go b.go",
        "rm -rf internal/x",
        "mkdir -p out",
        "touch x.go",
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
        "sh -c 'echo x > f'",
        "work gh issue comment 44 --body-file .work/tmp/v.md",
        "work gh issue close 44",
        "work gh pr ready 57",
        "work gh project item-edit --id x --project-id y --field-id z --single-select-option-id w",
        "work gh api -X PATCH repos/{owner}/{repo}/issues/44 -f body=x",
        "work gh api repos/{owner}/{repo}/issues/42/sub_issues -F sub_issue_id=1",
        "cat <<-EOF > notes.md\n\tx\n\tEOF",
        "x=$(cat <<'EOF'\nok\nEOF\n) && rm -f out.md",
        "if git push; then echo ok; fi",
        "git log --format=%h | xargs -n1 rm",
        'eval "rm -rf internal"',
        'n=$(git commit -m "fix (#44)")',
        "work gh api -XPATCH repos/{owner}/{repo}/issues/44",
        // A group's or a loop's redirect writes for every command inside it.
        "{ go test ./...; go vet ./...; } > out.log",
        "while read l; do echo $l; done < in.txt >> out.txt",
        "go test ./... &> out.log",
        "echo x >&out.txt",
        "echo x >| f",
        "go test &>> f",
      ],
    }),
});
