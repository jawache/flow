// examples/default/guards/driven.ts — the flow pack a repo driven by work binds.
//
// Four entries: a breadcrumb that tells every session how a driven repo works, the guardrail that
// keeps an issue's issue.md and tasks in the record's shape, the one that leaves an issue's log to
// the daemon, and the one that keeps the four reviewers from writing. The daemon enforces none of
// them; a driven repo turns them on in its own flow.config.ts:
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
// quoted argument is text, never a command. Needs @jawache/flow 0.3.0 or later, and the `yaml` package,
// which reads an issue's front matter and work.yml's fields.

import {
  breadcrumb,
  type Check,
  command,
  defineCategory,
  deletion,
  definePack,
  gitCommand,
  guardrail,
  programName,
  session,
  type ShellCommand,
  shellCommands,
  spawnedAs,
  write,
} from "@jawache/flow";
import { parse } from "yaml";

// ── what a reviewer may not run ──
//
// The reviewers are the four lenses spawned to judge, never to build: codeops, which `/work start`
// spawns at every phase boundary and `/work review` spawns again, and secops, docops and devops,
// which `/work review` spawns. Each is recognised by the agent type Claude Code records for the
// spawn; the skill spawns every one by name. This pack lists them itself, with flow's public
// defineCategory and spawnedAs. Their tool lists allow only git diff, show and log, so this rule
// is a backstop.
const reviewer = defineCategory(
  "reviewer",
  spawnedAs({ types: ["secops", "codeops", "docops", "devops"] }),
);

/** Programs that change files. */
const WRITE_PROGRAMS = new Set(["tee", "cp", "mv", "rm", "rmdir", "mkdir", "touch", "ln", "chmod", "chown", "truncate", "dd", "install", "unlink", "patch", "rsync"]);
/** Programs that edit a file in place when given -i. */
const IN_PLACE = new Set(["sed", "perl", "ruby"]);
/** git subcommands that change the history, the branches, the index or the working tree. */
const GIT_WRITES = new Set(["commit", "push", "pull", "add", "rm", "mv", "checkout", "switch", "restore", "reset", "merge", "rebase", "cherry-pick", "revert", "apply", "am", "clean", "init", "clone", "update-ref", "notes"]);
/**
 * An issue's folder in the record, named by its id, `<name>-<n>` (docs/user/reference/record.md
 * § Ids), at the start of a path or after a `/`: reached through `.work` or the record's own path.
 */
const ID_DIR = String.raw`(?:^|/)[A-Za-z][A-Za-z0-9-]*-[0-9]+/`;
/** An issue's log: `log.jsonl` in its folder (§ log.jsonl). */
const LOG = new RegExp(ID_DIR + String.raw`log\.jsonl$`);
/** Programs among WRITE_PROGRAMS that read every argument but the last, the one they write. */
const COPIES = new Set(["cp", "install", "rsync", "ln"]);
/** Redirect operators that write a file. `>&` duplicates a descriptor (`2>&1`, `>&2`) and writes none. */
const WRITE_REDIRECTS = new Set([">", ">>", ">|", "&>", "&>>"]);
/** Redirect targets that write no file: a device. */
const NO_FILE = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/** What one parsed command writes, or null. */
function writeOf(c: ShellCommand): string | null {
  const prog = programName(c.program);
  const { args } = c;
  if (c.redirects.some((r) => WRITE_REDIRECTS.has(r.operator) && !NO_FILE.has(r.target))) return "a `>` or `>>` redirect writes a file";
  if (WRITE_PROGRAMS.has(prog)) return `\`${prog}\` changes files`;
  if (IN_PLACE.has(prog) && args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place"))) return `\`${prog} -i\` edits a file in place`;
  const g = gitCommand(c);
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
  if (prog === "work" && args[0] === "log") return "`work log` writes a line into the issue's log";
  return null;
}

/** Whether one parsed command writes an issue's log: a redirect into it, or a program that changes files given it. */
function writesLog(c: ShellCommand): boolean {
  if (c.redirects.some((r) => WRITE_REDIRECTS.has(r.operator) && LOG.test(r.target))) return true;
  const prog = programName(c.program);
  const changes = WRITE_PROGRAMS.has(prog) || (IN_PLACE.has(prog) && c.args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place")));
  if (!changes) return false;
  // A copy reads its sources and writes only its last argument; every other program writes, or removes, what it is given.
  const written = COPIES.has(prog) ? c.args.filter((a) => !a.startsWith("-")).slice(-1) : c.args;
  return written.some((a) => LOG.test(a));
}

/** An issue's log is the daemon's: a write, a delete, or a shell command that writes one is refused. */
const logByDaemon: Check = (ctx) => {
  if (ctx.file !== undefined) return LOG.test(ctx.file.path) ? ctx.fail(ctx.file.path) : ctx.ok();
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  return commands.some(writesLog) ? ctx.fail() : ctx.ok();
};

/** An issue's issue.md, and one of its task files, in its folder. */
const ISSUE = new RegExp(ID_DIR + String.raw`issue\.md$`);
const TASK = new RegExp(ID_DIR + String.raw`tasks/[0-9]+\.md$`);
/**
 * The keys of issue.md's front matter besides the fields work.yml names (docs/user/reference/record.md § issue.md):
 * an issue's `from`, and a chat's `kind`, `summary` and `folder` (§ A chat).
 */
const ISSUE_KEYS = ["id", "title", "status", "archived", "refs", "from", "kind", "summary", "folder"];
/** The keys of a task file's front matter, all three and no other (§ tasks/). */
const TASK_KEYS = ["id", "title", "done"];

/** The mapping a file's front matter holds, or why it holds none. */
function frontMatter(content: string): Record<string, unknown> | string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (m === null) return "it has no front matter between --- lines";
  let v: unknown;
  try {
    v = parse(m[1] ?? "");
  } catch (e) {
    return `its front matter is not YAML: ${(e as Error).message.split("\n")[0]}`;
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "its front matter is not a mapping of keys";
}

/** work.yml's fields: each field's name, and the status field's values; null when it cannot be read. */
async function fieldsOf(ctx: Parameters<Check>[0]): Promise<{ names: string[]; status: string[] } | null> {
  if (!(await ctx.fs.exists("work.yml"))) return null;
  let doc: unknown;
  try {
    doc = parse(await ctx.fs.read("work.yml"));
  } catch {
    return null;
  }
  const fields = (doc as { fields?: unknown } | null)?.fields;
  if (fields === null || typeof fields !== "object") return null;
  const values = (fields as { status?: { values?: unknown } }).status?.values;
  const status = Array.isArray(values) ? values.map((v) => String(typeof v === "object" && v !== null ? (v as { name?: unknown }).name : v)) : [];
  return { names: Object.keys(fields), status };
}

/** issue.md and a task file are written in the record's shape: their front matter's keys, and the issue's status. */
const recordShape: Check = async (ctx) => {
  const file = ctx.file;
  if (file === undefined) return ctx.ok();
  const task = TASK.test(file.path);
  if (!task && !ISSUE.test(file.path)) return ctx.ok();
  const front = frontMatter(file.content);
  if (typeof front === "string") return ctx.fail(`${file.path}: ${front}`);
  const keys = Object.keys(front);
  if (task) {
    const wrong = keys.filter((k) => !TASK_KEYS.includes(k));
    const missing = TASK_KEYS.filter((k) => !keys.includes(k));
    if (wrong.length + missing.length === 0) return ctx.ok();
    return ctx.fail(`${file.path}: a task's front matter is id, title and done${wrong.length > 0 ? `; ${wrong.join(", ")} is not one` : ""}${missing.length > 0 ? `; ${missing.join(", ")} is missing` : ""}`);
  }
  const fields = await fieldsOf(ctx);
  if (fields === null) return ctx.ok(); // with no work.yml to read, the fields cannot be judged
  const allowed = [...ISSUE_KEYS, ...fields.names];
  const wrong = keys.filter((k) => !allowed.includes(k));
  if (wrong.length > 0) return ctx.fail(`${file.path}: ${wrong.join(", ")} is not a key of an issue's front matter, which holds ${allowed.join(", ")}`);
  if ("status" in front && !fields.status.includes(String(front.status))) {
    return ctx.fail(`${file.path}: status ${JSON.stringify(front.status)} is not a value of fields.status in work.yml: ${fields.status.join(", ")}`);
  }
  return ctx.ok();
};

/** Every way the line writes, each said once; null when it only reads and runs, or cannot be parsed. */
const readAndRun: Check = (ctx) => {
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  const found = new Set<string>();
  for (const c of commands) {
    const w = writeOf(c);
    if (w !== null) found.add(w);
  }
  return found.size === 0 ? ctx.ok() : ctx.fail([...found].join("; "));
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
        "The record is `.work/<id>/`: `issue.md`, `tasks/`, `log.jsonl` and `artifacts/`. You edit `issue.md` and the tasks as Markdown; a move is the `status:` line, and only where the skill says. Only the daemon writes `log.jsonl`: ask the human with `work log question --ask \"…\"` and its body on stdin as a quoted heredoc, then stop; tell them with `work log fyi`. One question is open at a time. Never record a session's state in the record.",
      ].join("\n"),
    )
    .description("How a repo driven by work works: [work] lines, the work skill, the record in .work, work log."),

  /**
   * Without it, a session could write `issue.md` or a task with a key the daemon does not read, or
   * move an issue to a status `fields.status` does not have, which the daemon logs as an error and
   * acts on not at all, and nobody sees the move did nothing.
   *
   * The entry is the path: an issue folder's `issue.md` or `tasks/<n>.md`, through `.work` or the
   * record's own path. The issue's keys are those of record.md § issue.md and every field work.yml
   * names; a task's are `id`, `title` and `done`.
   */
  recordShape: guardrail()
    .at(write)
    .check(recordShape)
    .message(
      "An issue's `issue.md` or task file whose front matter is not the record's shape (docs/user/reference/record.md § issue.md, § tasks/). Keep the front matter's keys to the ones the page lists, the issue's `status` to a value of `fields.status` in work.yml, and a task's to `id`, `title` and `done`; write anything else in the body.",
    )
    .description("An issue's issue.md has only the record's keys and a status of fields.status; a task file's front matter is id, title and done.")
    .test({
      block: [
        { path: ".work/app-42/tasks/3.md", content: "---\nid: app-42/3\ntitle: x\ndone: false\nowner: builder\n---\n- [ ] a box\n" },
        { path: ".work/app-42/tasks/3.md", content: "---\nid: app-42/3\ntitle: x\n---\n" },
        { path: ".work/app-42/tasks/4.md", content: "- [ ] a box with no front matter\n" },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Doing\n---\nbody\n",
          world: { fs: { "work.yml": "name: app\nfields:\n  status:\n    values:\n      - { name: Backlog }\n      - { name: Build }\n" } },
        },
        {
          path: "/Users/me/src/app.record/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Build\nassignee: me\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n  priority:\n    values: [low, high]\n" } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: [x\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
      ],
      pass: [
        { path: ".work/app-42/tasks/3.md", content: "---\nid: app-42/3\ntitle: \"[B] x\"\ndone: true\n---\n- [x] a box\n" },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Build\npriority: high\narchived: true\nrefs:\n  pr: me/app#57\n---\nyour text\n\n<!-- work:agent -->\n\n## Triage\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Backlog }, { name: Build }]\n  priority:\n    values: [low, high]\n" } },
        },
        {
          path: ".work/app-12/issue.md",
          content: "---\nid: app-12\nkind: chat\ntitle: Decide how the index stays in step\nfolder: /Users/you/src/app\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-12/issue.md",
          content:
            "---\nid: app-12\nkind: chat\ntitle: The index\nsummary: |\n  We weighed a watcher against indexing as the daemon writes.\n  The index lives in ~/.work.\nfolder: /Users/you/src/app/internal\narchived: true\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-13/issue.md",
          content: "---\nid: app-13\ntitle: Search\nstatus: Build\nfrom: app-12\n---\nWhat the chat decided.\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        { path: ".work/app-42/issue.md", content: "---\nstatus: Anything\n---\n" },
        { path: ".work/app-42/artifacts/notes.md", content: "no front matter\n" },
        { path: "docs/user/reference/record.md", content: "---\nsummary: x\n---\n" },
        { path: ".work/dark-mode.md", content: "# A new issue\n" },
      ],
    }),

  /**
   * Without it, a session could write its issue's log as a file: a line in a shape the daemon does
   * not read, an answer that names no question, or a line rewritten, when the log is append-only and
   * a question is open until an answer names it. A session adds a line with `work log`, which the
   * daemon appends; the session never opens the file.
   *
   * The entry is the path: `log.jsonl` in an issue's folder, written or deleted with a tool, or named
   * by a shell command that writes it. Reading it, with `cat`, `tail` or `jq`, is no write.
   */
  logByDaemon: guardrail()
    .at(write, deletion, command)
    .check(logByDaemon)
    .message(
      "Only the daemon writes an issue's `log.jsonl` (docs/user/reference/record.md § log.jsonl). Ask with `work log question --ask \"…\"`, or tell with `work log fyi`, the body on stdin as a quoted heredoc, `<<'WORKLOG'`: the daemon appends the line. A line already in the log is never changed.",
    )
    .description("An issue's log.jsonl is written by the daemon alone: a session's write, delete or shell write of one is refused, and `work log` adds a line.")
    .test({
      pass: [
        { path: ".work/app-42/issue.md", content: "---\nid: app-42\n---\n" },
        { path: "internal/record/testdata/log.jsonl", content: "{}\n" },
        "tail -5 .work/app-42/log.jsonl",
        "jq -c 'select(.kind == \"question\")' .work/app-42/log.jsonl",
        "work log fyi --on 3 <<'WORKLOG'\nAppended to .work/app-42/log.jsonl by the daemon.\nWORKLOG",
        "cp .work/app-42/log.jsonl /tmp/before.jsonl",
        "gh pr list",
        "gh api repos/{owner}/{repo}/pulls/57/comments --jq '.[].body'",
        'grep -c "" .work/app-42/log.jsonl > /dev/null',
      ],
      block: [
        { path: ".work/app-42/log.jsonl", content: '{"kind":"answer"}\n' },
        { path: "/Users/me/src/app.record/app-42/log.jsonl", content: "" },
        "echo '{\"kind\":\"fyi\"}' >> .work/app-42/log.jsonl",
        "printf '%s\\n' x | tee -a .work/work-7/log.jsonl",
        "sed -i '' '$d' .work/app-42/log.jsonl",
        "rm .work/app-42/log.jsonl",
        "cp /tmp/before.jsonl .work/app-42/log.jsonl",
        "mv .work/app-42/log.jsonl /tmp/gone.jsonl",
        "cd .work && cat > app-42/log.jsonl <<'EOF'\n{}\nEOF",
      ],
    }),

  /**
   * Without it, a reviewer that reached a shell would have a builder's hands: it could fix the
   * defect it was sent to find, commit it, or write its own finding into the issue's log, and the
   * leader would then act on a review the reviewer made true. The four tool lists withhold Edit and Write; this holds the
   * shell to the same line.
   */
  reviewersReadAndRun: guardrail()
    .at(command)
    .for(reviewer)
    .check(readAndRun)
    .message(
      "You were spawned to review this work, as secops, codeops, docops or devops: you read the change, and you change nothing. No file, no commit, no push, no line in the issue's log. Read it with `git diff`, `git show` and `git log`, and filter their output through a pipe (`| grep`, `| head`) rather than a file. When a finding needs a change, say so in your report: the leader owns the code and decides what to change.",
    )
    .description("The four reviewers, secops, codeops, docops and devops, read the change with git diff, show and log: a shell command that writes a file, changes git or writes the issue's log is refused.")
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
      ],
      block: [
        "echo x > notes.md",
        "go test ./... > out.log 2>&1",
        "go test ./... &> out.log",
        "cat <<'EOF' >> README.md\nmore\nEOF",
        "go test ./... | tee out.log",
        "sed -i '' 's/a/b/' main.go",
        "sed -i.bak s/a/b/ main.go",
        "perl -pi -e 's/a/b/' main.go",
        "cp a.go b.go",
        "mv a.go b.go",
        "rm -rf internal/x",
        "/bin/rm -rf internal/x",
        "sudo rm -rf internal/x",
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
        "git worktree add ../x",
        "sh -c 'echo x > f'",
        "bash <<< 'rm -rf build'",
        "work log fyi <<'WORKLOG'\nThe review found nothing.\nWORKLOG",
        "work log question --ask 'Keep the cache?' <<'WORKLOG'\nx\nWORKLOG",
        "cat <<-EOF > notes.md\n\tx\n\tEOF",
        "x=$(cat <<'EOF'\nok\nEOF\n) && rm -f out.md",
        "if git push; then echo ok; fi",
        "git log --format=%h | xargs -n1 rm",
        'eval "rm -rf internal"',
        'n=$(git commit -m "fix (#44)")',
      ],
    }),
});
