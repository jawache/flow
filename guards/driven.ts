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
// none of.

import {
  banCommands,
  breadcrumb,
  type Check,
  command,
  definePack,
  gitInvocations,
  guardrail,
  quoteArg,
  session,
  tokenizeCommand,
  defineCategory,
  spawnedAs,
} from "@jawache/flow";

// The ban is written to hold under both readings of a command line. `work init --template` copies
// this file into repos whose @jawache/flow may still match the whole line, where a bare `gh` would
// refuse every `work gh …`; and START opens with `^`, so per-command matching from the program
// name reads it too.
//
// Where a shell starts a new command: the start of the line, after a separator, inside $( ) or
// backticks, after a brace or a keyword, or at the head of a string handed to a shell.
const START = String.raw`(?:^|[\n;&|({\x60]|\$\(|\b(?:ba|z)?sh\s+-c\s+['"]|\beval\s+['"]?)`;
/** Words that run the word after them as a command, so the program is further on. */
const PREFIXES = new Set(["command", "exec", "env", "sudo", "nohup", "time", "xargs", "if", "then", "else", "elif", "do", "while", "until", "!"]);
// What may sit between that start and the program: whitespace, variable assignments, and the
// PREFIXES (each with its own flags), the same list the checker's word walk skips. An assignment
// whose value opens a `$(` is not skipped over: START already begins a new command inside it.
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
const OPERATORS = new Set([";", "&&", "||", "|", "&", "|&", "\n"]);
/** A redirect token: `>`, `>>` or `>|`, with an fd or `&` before it, and the target glued on or next. */
const REDIRECT = /^(?:\d+|&)?>(?:>|\|)?(\S*)$/;
/** Targets that write no file: an fd duplicate (`>&2`), or a device. */
const NO_FILE = /^(?:&\d*-?|\/dev\/(?:null|stdout|stderr|tty))\)*$/;

/**
 * The line without its heredoc bodies, which are text fed to a program, not commands. flow has
 * this as `elideHeredocs`, but neither 0.2.1 nor 0.2.3 exports it from `@jawache/flow`, so this is
 * its line-based half: `<<WORD`, `<<'WORD'` and `<<-WORD`, several on a line, inside `$( )` as
 * anywhere else, each body ending at the line that holds only WORD.
 */
function withoutHeredocBodies(line: string): string {
  const kept: string[] = [];
  const pending: string[] = [];
  for (const l of line.split("\n")) {
    if (pending.length > 0) {
      if (l.trim() === pending[0]) pending.shift();
      continue;
    }
    kept.push(l);
    for (const m of l.replace(/<<</g, "").matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) pending.push(m[2] ?? "");
  }
  return kept.join("\n");
}

/** Drops what stands before the program: assignments, and prefix words with their flags. */
function fromProgram(words: readonly string[]): string[] {
  let i = 0;
  while (i < words.length) {
    const w = words[i] ?? "";
    if (w !== "" && !PREFIXES.has(w) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break;
    i++;
    while (PREFIXES.has(w) && /^-/.test(words[i] ?? "")) i++;
  }
  return words.slice(i);
}

/** The simple commands in a token list, program first. A `$(` or backtick starts a new one. */
function simpleCommands(tokens: readonly string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const close = (): void => {
    const c = fromProgram(cur);
    if (c.length > 0) out.push(c);
    cur = [];
  };
  for (const t of tokens) {
    if (OPERATORS.has(t)) {
      close();
      continue;
    }
    const at = Math.max(t.lastIndexOf("$("), t.lastIndexOf("`"));
    if (at >= 0) {
      close();
      cur.push(t.slice(at + (t[at] === "`" ? 1 : 2)));
      continue;
    }
    cur.push((cur.length === 0 ? t.replace(/^[({]+/, "") : t).replace(/\)+$/, ""));
  }
  close();
  return out;
}

/** What one simple command writes, or null. */
function writeOf(cmd: readonly string[], depth: number): string | null {
  const prog = (cmd[0] ?? "").replace(/^.*\//, "");
  const args = cmd.slice(1);
  if (["sh", "bash", "zsh"].includes(prog) && args[0] === "-c" && args[1] !== undefined) return depth < 3 ? whatWrites(args[1], depth + 1) : null;
  if (prog === "eval") return depth < 3 ? whatWrites(args.join(" "), depth + 1) : null;
  if (WRITE_PROGRAMS.has(prog)) return `\`${prog}\` changes files`;
  if (IN_PLACE.has(prog) && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"))) return `\`${prog} -i\` edits a file in place`;
  if (prog === "git") {
    for (const g of gitInvocations(cmd.map(quoteArg).join(" ")) ?? []) {
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

/** Every way the line writes, each said once; null when it only reads and runs, or cannot be parsed. */
function whatWrites(line: string, depth = 0): string | null {
  const tokens = tokenizeCommand(withoutHeredocBodies(line));
  if (tokens === null) return null; // flow's convention: a line it cannot parse is not judged
  const found = new Set<string>();
  tokens.forEach((t, i) => {
    const m = REDIRECT.exec(t);
    if (m !== null && !NO_FILE.test(m[1] !== "" ? (m[1] ?? "") : (tokens[i + 1] ?? ""))) found.add("a `>` or `>>` redirect writes a file");
  });
  for (const c of simpleCommands(tokens)) {
    const w = writeOf(c, depth);
    if (w !== null) found.add(w);
  }
  return found.size === 0 ? null : [...found].join("; ");
}

const readAndRun: Check = (ctx) => {
  const why = whatWrites(ctx.command ?? "");
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
      ],
    }),
});
