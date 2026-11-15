// examples/default/guards/driven.ts — the flow pack a repo driven by work binds.
//
// Five entries: a breadcrumb that tells every session how a driven repo works, the guardrail that
// keeps an issue's issue.md and tasks in the record's shape, the one that leaves each record's log to
// the daemon, the one that keeps the reviewers from writing what git would check in, and the one that
// refuses the Playwright CLI's `close-all` and `kill-all`, which close every session's browsers. The daemon
// enforces none of them; a driven repo turns them on in its own flow.config.ts:
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
// which reads an issue's front matter and work.yml's types and fields.

import {
  breadcrumb,
  type CaseWorld,
  type Check,
  command,
  defineCategory,
  deletion,
  definePack,
  gitCommand,
  guardrail,
  programName,
  quoteArg,
  session,
  type ShellCommand,
  shellCommands,
  spawnedAs,
  write,
} from "@jawache/flow";
import { posix } from "node:path";
import { parse } from "yaml";

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
/** An issue's id, `<name>-<n>` (docs/user/reference/record.md § Ids). */
const ID = String.raw`[A-Za-z][A-Za-z0-9-]*-[0-9]+`;
/** An issue's folder in the record, at the start of a path or after a `/`: reached through `.work` or the record's own path. */
const ID_DIR = String.raw`(?:^|/)${ID}/`;
/** A standing issue's id, `<name>-session-<entry>`, the entry's name starting with a letter (§ Ids, § A standing issue). */
const SESSION_ID = String.raw`[A-Za-z][A-Za-z0-9-]*-session-[A-Za-z][A-Za-z0-9_-]*`;
/**
 * A record's log by its path alone: `log.jsonl` in the folder of an issue or a chat, reached
 * through `.work` or the record's own path, or of a standing issue, reached through `.work`
 * (§ log.jsonl). A standing issue's id may end in a word, as no issue's does, so elsewhere a folder
 * of its shape, such as a test's fixture, is a record's only when its issue.md says so (namedLog).
 */
const LOG = new RegExp(String.raw`(?:${ID_DIR}|(?:^|/)\.work/${SESSION_ID}/)log\.jsonl$`);
/** `log.jsonl` in a folder of a standing issue's id's shape, anywhere: a record's only when namedLog says so. */
const MAYBE_NAMED_LOG = new RegExp(String.raw`(?:^|/)${SESSION_ID}/log\.jsonl$`);

/**
 * Whether path, a `log.jsonl` outside `.work`, is a standing issue's record's: its folder's issue.md
 * has `kind: session` in its front matter (docs/user/reference/record.md § A standing issue). One
 * whose issue.md is not there, or does not read so, is no record's.
 */
async function namedLog(ctx: Parameters<Check>[0], path: string): Promise<boolean> {
  if (!MAYBE_NAMED_LOG.test(path)) return false;
  const issue = path.slice(0, -"log.jsonl".length) + "issue.md";
  if (!(await ctx.fs.exists(issue))) return false;
  const front = frontMatter(await ctx.fs.read(issue));
  return typeof front !== "string" && front.kind === "session";
}

/** Whether path is a record's log: by its path (LOG), or by its folder's issue.md (namedLog). */
async function isLog(ctx: Parameters<Check>[0], path: string): Promise<boolean> {
  return LOG.test(path) || (await namedLog(ctx, path));
}
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

/** A record's log is the daemon's: a write, a delete, or a shell command that writes one is refused. */
const logByDaemon: Check = async (ctx) => {
  if (ctx.file !== undefined) return (await isLog(ctx, ctx.file.path)) ? ctx.fail(ctx.file.path) : ctx.ok();
  const commands = shellCommands(ctx);
  if (commands === null) return ctx.ok(); // flow's convention: a line it cannot parse is not judged
  for (const path of commands.flatMap((c) => (filesWritten(c) ?? []).map((f) => f.path))) {
    if (await isLog(ctx, path)) return ctx.fail();
  }
  return ctx.ok();
};

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

// ── an issue's and a task's front matter ──

/** An issue's issue.md, and one of its task files, in its folder. */
const ISSUE = new RegExp(ID_DIR + String.raw`issue\.md$`);
const TASK = new RegExp(ID_DIR + String.raw`tasks/[0-9]+\.md$`);
/**
 * The keys of issue.md's front matter besides the fields work.yml names (docs/user/reference/record.md § issue.md):
 * an issue's `from`, `rank`, `agent` and `depends`, a chat's `kind`, `summary` and `folder` (§ A chat), and a standing issue's `paused` (§ A standing issue).
 */
const ISSUE_KEYS = ["id", "title", "status", "archived", "paused", "refs", "from", "rank", "agent", "depends", "kind", "summary", "folder"];
/** The keys of a task file's front matter, all three and no other (§ tasks/). */
const TASK_KEYS = ["id", "title", "done"];

/** Whether v is a YAML mapping: an object, and not a list. */
function isMap(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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
  return isMap(v) ? v : "its front matter is not a mapping of keys";
}

/** A status's name as a list writes it: a map's `name`, or the value itself. */
function statusName(v: unknown): string {
  return isMap(v) ? String(v.name) : String(v);
}

/**
 * What work.yml says an issue's front matter may hold: each field's name, and the statuses an issue
 * moves through. In a repo with types (docs/user/reference/work-yml.md § types), each type's
 * statuses by its name, in the file's order, the first the default, a `<type>.<status>` read as its
 * `<status>`; in a repo with none, `fields.status`'s values as `status`, and `types`
 * null. Null when work.yml cannot be read, or writes neither fields nor types.
 */
async function workflowOf(ctx: Parameters<Check>[0]): Promise<{ names: string[]; status: string[]; types: Map<string, string[]> | null } | null> {
  if (!(await ctx.fs.exists("work.yml"))) return null;
  let doc: unknown;
  try {
    doc = parse(await ctx.fs.read("work.yml"));
  } catch {
    return null;
  }
  const { fields, types } = isMap(doc) ? doc : {};
  if (!isMap(fields) && !isMap(types)) return null;
  const names = isMap(fields) ? Object.keys(fields) : [];
  if (isMap(types)) {
    // a <type>.<status> is named by the text after its first dot: work.yml's loader refuses one that names no map
    const named = (v: unknown): string => (isMap(v) ? statusName(v) : String(v).slice(String(v).indexOf(".") + 1));
    return { names, status: [], types: new Map(Object.entries(types).map(([t, list]) => [t, Array.isArray(list) ? list.map(named) : []])) };
  }
  const values = (fields as { status?: { values?: unknown } }).status?.values;
  return { names, status: Array.isArray(values) ? values.map(statusName) : [], types: null };
}

/** A value that is an issue's id and nothing else. */
const ISSUE_ID = new RegExp(`^${ID}$`);

/** Why the issue.md at path cannot hold depends, naming the id; null when it is a list, or empty, of other issues' ids. A chat's record is no issue. */
async function dependsWrong(ctx: Parameters<Check>[0], path: string, depends: unknown): Promise<string | null> {
  if (depends === null || depends === undefined) return null;
  if (typeof depends === "string" || typeof depends === "number") return `depends is ${JSON.stringify(depends)}, one value rather than a list; write it as depends: [${depends}]`;
  if (!Array.isArray(depends)) return `depends is ${JSON.stringify(depends)}, which is not a list of ids`;
  const own = path.split("/").at(-2) ?? "";
  const record = path.slice(0, path.length - `${own}/issue.md`.length);
  for (const item of depends) {
    const id = String(item);
    const holds = `depends holds ${JSON.stringify(item)}`;
    if (id === own) return `${holds}, this issue's own id`;
    const other = `${record}${id}/issue.md`;
    if (!ISSUE_ID.test(id) || !(await ctx.fs.exists(other))) return `${holds}, which has no issue`;
    const front = frontMatter(await ctx.fs.read(other));
    if (typeof front !== "string" && front.kind === "chat") return `${holds}, which is a chat, not an issue`;
  }
  return null;
}

// ── a review's rows ──
//
// A review task, a task file whose title starts `[R]`, lists the findings as rows (the work
// skill's templates/review-rows.md). A row is a numbered line whose first badge is its lean, FIX,
// SKIP or UPSTREAM → <repo>, ticked, struck through or neither; a Scored 2 line and a decision line
// have a number and no lean, and are no rows. The badge at once after the lean says what the fix
// changes: a verb, then a thing, a count or an article between them, the thing maybe plural. The
// verbs and the things are review-rows.md's table, the one list of them: a change to one is a change
// to the other.
const BADGE_VERBS = ["ADDS", "CHANGES", "MOVES", "DELETES"];
const BADGE_THINGS = ["CODE", "UNIT TEST", "INTEGRATION TEST", "END-TO-END STEP", "NEW JOURNEY", "GUARDRAIL", "SKILL TEXT", "DOCS", "CONFIG"];
/** A badge for what the fix changes, its text between `<kbd>` and `</kbd>`. */
const BADGE = new RegExp(String.raw`^(?:${BADGE_VERBS.join("|")}) (?:(?:[0-9]+|A|AN) )?(?:${BADGE_THINGS.map((t) => (t.endsWith("S") ? t : `${t}S?`)).join("|")})$`);
/** A row: its number, its lean, and what follows the lean. */
const ROW = /^[-*] (?:\[[ xX]\] )?(?:~~)?\*\*([0-9]+[a-z]?)\.\*\* *<kbd>(FIX|SKIP|UPSTREAM\b[^<]*)<\/kbd>(.*)$/;
/** The badge at the start of a row's text after its lean, or the text when it starts with none. */
const NEXT_BADGE = /^ *<kbd>([^<]*)<\/kbd>/;

/** What is wrong with each row of a review task's body, one phrase a row, outside fenced code. */
function rowsWrong(body: string): string[] {
  const wrong: string[] = [];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^ *(?:```|~~~)/.test(line)) fence = !fence;
    const row = fence ? null : ROW.exec(line);
    if (row === null) continue;
    const [, n = "", lean = "", rest = ""] = row;
    const next = NEXT_BADGE.exec(rest);
    if (next === null) {
      const text = rest.trim();
      wrong.push(`row ${n}'s lean, ${lean}, is followed by ${text === "" ? "nothing" : `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`}, not by a badge`);
    } else if (!BADGE.test((next[1] ?? "").trim())) {
      wrong.push(`row ${n}'s lean, ${lean}, is followed by <kbd>${next[1]}</kbd>, which is no badge of the list`);
    }
  }
  return wrong;
}

/** The refusal of a review whose rows are wrong: the file, each row, and what a badge is made of. */
function rowsRefusal(path: string, wrong: readonly string[]): string {
  const or = (words: readonly string[]): string => `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
  return `${path}: ${wrong.join("; ")}. Write a badge for what the fix changes at once after the lean, before the change in words: a verb, ${or(BADGE_VERBS)}, then a thing, ${or(BADGE_THINGS)}, a count or A or AN between them, the thing plural for more than one, such as <kbd>CHANGES CODE</kbd> <kbd>ADDS 2 UNIT TESTS</kbd> (the work skill's templates/review-rows.md)`;
}

/** issue.md and a task file are written in the record's shape: their front matter's keys, the issue's type and status, its depends, and a review's rows. */
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
    if (wrong.length + missing.length > 0) {
      return ctx.fail(`${file.path}: a task's front matter is id, title and done${wrong.length > 0 ? `; ${wrong.join(", ")} is not one` : ""}${missing.length > 0 ? `; ${missing.join(", ")} is missing` : ""}`);
    }
    if (typeof front.title !== "string" || !front.title.startsWith("[R]")) return ctx.ok();
    const rows = rowsWrong(file.content);
    return rows.length === 0 ? ctx.ok() : ctx.fail(rowsRefusal(file.path, rows));
  }
  const work = await workflowOf(ctx);
  if (work === null) return ctx.ok(); // with no work.yml to read, the fields cannot be judged
  const allowed = [...ISSUE_KEYS, ...(work.types === null ? [] : ["type"]), ...work.names];
  const wrong = keys.filter((k) => !allowed.includes(k));
  if (wrong.length > 0) return ctx.fail(`${file.path}: ${wrong.join(", ")} is not a key of an issue's front matter, which holds ${allowed.join(", ")}`);
  if (work.types !== null) {
    const typeNames = [...work.types.keys()];
    const typ = front.type === null || front.type === undefined ? (typeNames[0] ?? "") : String(front.type);
    const statuses = work.types.get(typ);
    if (statuses === undefined) return ctx.fail(`${file.path}: type ${JSON.stringify(front.type)} is not one of types in work.yml: ${typeNames.join(", ")}`);
    if ("status" in front && !statuses.includes(String(front.status))) {
      return ctx.fail(`${file.path}: status ${JSON.stringify(front.status)} is not a status of type ${typ} in work.yml: ${statuses.join(", ")}`);
    }
  } else if ("status" in front && !work.status.includes(String(front.status))) {
    return ctx.fail(`${file.path}: status ${JSON.stringify(front.status)} is not a value of fields.status in work.yml: ${work.status.join(", ")}`);
  }
  const depends = await dependsWrong(ctx, file.path, front.depends);
  return depends === null ? ctx.ok() : ctx.fail(`${file.path}: ${depends}`);
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

/**
 * A case's work.yml with types and no fields, which the rule before types judged not at all: bug
 * names two of feature's lines as <type>.<status>, and has Triage, which feature has not.
 */
const TYPES_YML =
  "types:\n  feature:\n    - { name: Backlog }\n    - { name: Docs }\n    - { name: Build }\n  bug:\n    - feature.Backlog\n    - { name: Triage }\n    - feature.Build\n";

/** A case's review task: its front matter and opening, then body, its rows. */
function review(body: string): string {
  return `---\nid: app-42/7\ntitle: "[R] The web opens a session's folder in your editor"\ndone: false\n---\nPart of app-42, its review.\n\n### 🔒 Security\n\n${body}`;
}

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
   * Without it, a session could write `issue.md` or a task with a key the daemon does not read, give
   * an issue a type `types` does not have, or move an issue to a status its type does not have, or
   * `fields.status` in a repo with no types, which the daemon logs as an error and acts on not at
   * all, and nobody sees the move did nothing.
   *
   * The entry is the path: an issue folder's `issue.md` or `tasks/<n>.md`, through `.work` or the
   * record's own path. The issue's keys are those of record.md § issue.md and every field work.yml
   * names, and `type` in a repo with types; a task's are `id`, `title` and `done`. An issue's
   * `depends` is a list of other issues' ids.
   *
   * Without it too, a review could bring the human a row that says FIX and nothing of what the fix
   * changes, and they would spend a card asking. In a review task, a task file whose title starts
   * `[R]`, each row's lean is followed at once by a badge of the list. Only the file being written is
   * judged, so an older review in the record is never refused until it is written again.
   */
  recordShape: guardrail()
    .at(write)
    .check(recordShape)
    .message(
      "An issue's `issue.md` or task file not in the record's shape (docs/user/reference/record.md § issue.md, § tasks/). Keep the front matter's keys to the ones the page lists, the issue's `type` to one of `types` in work.yml and its `status` to a status of its type, or to a value of `fields.status` in a repo with no types, its `depends` to a list of other issues' ids, and a task's to `id`, `title` and `done`; write anything else in the body. In a review task, follow each row's lean, `FIX`, `SKIP` or `UPSTREAM → <repo>`, at once with a badge for what the fix changes, such as <kbd>CHANGES CODE</kbd> (the work skill's templates/review-rows.md).",
    )
    .description("An issue's issue.md has only the record's keys, a type of types, a status of its type, or of fields.status in a repo with no types, and a depends that is a list of other issues' ids; a task file's front matter is id, title and done; and in a review task each row's lean is followed at once by a badge for what the fix changes.")
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
          path: ".work/app-14/issue.md",
          content: "---\nid: app-14\ntitle: x\nstatus: Build\nrank: 3.5\nplace: 2\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-15/issue.md",
          content: "---\nid: app-15\ntitle: Daily\nstatus: Build\nagent: triage\nrole: triage\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: [x\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        // depends: its own id, an id with no issue, written as a list or as a path; one id rather than a list; a mapping; a chat's id
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33, app-34]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n", ".work/app-34/issue.md": "---\nid: app-34\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33, app-9999]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: app-33\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: { app-33: x }\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [./app-33]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/./app-33/issue.md": "---\nid: app-33\n---\n" } },
        },
        {
          path: "/Users/me/src/app.record/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-12]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-12/issue.md": "---\nid: app-12\nkind: chat\ntitle: x\nfolder: /x\n---\n" } },
        },
        // types: a type not in types; a status another type has and the issue's type lacks, named and by default
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: chore\nstatus: Backlog\n---\n",
          world: { fs: { "work.yml": TYPES_YML } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: bug\nstatus: Docs\n---\n",
          world: { fs: { "work.yml": TYPES_YML } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Triage\n---\n",
          world: { fs: { "work.yml": TYPES_YML } },
        },
        // no types: type is a key only when fields writes it
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: bug\nstatus: Build\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        // a review's row: no badge after its lean; a badge after it that is not of the list; a badge of the list after the row's sentence
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] **1.** <kbd>FIX</kbd> A file named like an option reaches the editor as one\n") },
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] **1.** <kbd>FIX</kbd> <kbd>CODE + UNIT TEST</kbd> A file named like an option reaches the editor as one\n") },
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] **1.** <kbd>FIX</kbd> A file named like an option reaches the editor as one <kbd>CHANGES CODE</kbd>\n") },
        // each lean, and a struck-through row, with no badge after it; a row with no badge after a fenced block closes
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] **1.** <kbd>SKIP</kbd> A journey for the editor button\n") },
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] **1.** <kbd>UPSTREAM → flow</kbd> Read a path held in a shell variable\n") },
        { path: ".work/app-42/tasks/7.md", content: review("- [ ] ~~**1.** <kbd>SKIP</kbd> Say it once~~ Skipped: lean skip, taken.\n") },
        {
          path: ".work/app-42/tasks/7.md",
          content: review(
            [
              "- [x] **1.** <kbd>FIX</kbd> <kbd>CHANGES CODE</kbd> Move the check into the core, evidence: unit, 7902c1e9",
              "  <details><summary>Proof: the unit test, as run</summary>",
              "",
              "  ```",
              "  --- PASS: TestTheCheck (0.00s)",
              "  ```",
              "",
              "  </details>",
              "- [ ] **2.** <kbd>FIX</kbd> Refuse a cited path that starts with a dash",
              "",
            ].join("\n"),
          ),
        },
      ],
      pass: [
        // types: a status of the issue's type, one written in the type as <type>.<status>, and an issue with no type in a status of the first type
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: bug\nstatus: Triage\npriority: high\n---\n",
          world: { fs: { "work.yml": `${TYPES_YML}fields:\n  priority: [low, high]\n` } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: bug\nstatus: Build\n---\n",
          world: { fs: { "work.yml": TYPES_YML } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Docs\n---\n",
          world: { fs: { "work.yml": TYPES_YML } },
        },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: feature\nstatus: Backlog\n---\n",
          world: { fs: { "work.yml": "types:\n  feature:\n    - { name: Backlog }\n" } },
        },
        {
          // no types: type is a field like any other, when fields writes it
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\ntype: bug\nstatus: Build\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n  type: [feature, bug]\n" } },
        },
        { path: ".work/app-42/tasks/3.md", content: "---\nid: app-42/3\ntitle: \"[B] x\"\ndone: true\n---\n- [x] a box\n" },
        // a review's rows: each badge's grammar; an upstream lean; a ticked row with its evidence; a skipped row struck through
        {
          path: ".work/app-42/tasks/7.md",
          content: review(
            [
              "- [ ] **1.** <kbd>FIX</kbd> <kbd>CHANGES CODE</kbd> <kbd>ADDS 2 UNIT TESTS</kbd> Refuse a cited path that starts with a dash",
              "- [ ] **7.** <kbd>FIX</kbd> <kbd>ADDS 1 UNIT TEST</kbd> Refuse a path with a null byte",
              "- [ ] **2.** <kbd>FIX</kbd> <kbd>DELETES AN INTEGRATION TEST</kbd> Drop the test the unit test now covers",
              "- [ ] **3.** <kbd>SKIP</kbd> <kbd>ADDS A NEW JOURNEY</kbd> A journey for the editor button",
              "- [ ] **4.** <kbd>UPSTREAM → flow</kbd> <kbd>CHANGES A GUARDRAIL</kbd> Read a path held in a shell variable",
              "- [x] **5.** <kbd>FIX</kbd> <kbd>MOVES CODE</kbd> <kbd>CHANGES DOCS</kbd> Move the check into the core, evidence: unit, 7902c1e9",
              "  <details><summary>Proof: the unit test, as run</summary>",
              "",
              "  ```",
              "  - [ ] **9.** <kbd>FIX</kbd> quoted, not a row",
              "  ```",
              "",
              "  </details>",
              "- [ ] ~~**6.** <kbd>SKIP</kbd> <kbd>CHANGES SKILL TEXT</kbd> Say it once~~ Skipped: lean skip, taken.",
              "",
            ].join("\n"),
          ),
        },
        // a review's lines that have no lean, and a build task's boxes, have no badge
        { path: ".work/app-42/tasks/7.md", content: review("- **23.** <kbd>DELETES A UNIT TEST</kbd> Drop a test. Score 2\n- 4 more scored 1 or less.\n- **24.** The badge is checked at write. **Reverse:** drop the check\n") },
        { path: ".work/app-42/tasks/2.md", content: "---\nid: app-42/2\ntitle: \"[B] The guard refuses a row with no badge\"\ndone: false\n---\n- [ ] **1.** <kbd>FIX</kbd> a box named like a row\n- [ ] **F1.B1** The block cases, evidence: log\n" },
        {
          path: ".work/app-42/issue.md",
          content: "---\nid: app-42\ntitle: x\nstatus: Build\npriority: high\narchived: true\nrefs:\n  pr: me/app#57\n---\nyour text\n\n<!-- work:agent -->\n\n## Refine\n",
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
        {
          path: ".work/app-14/issue.md",
          content: "---\nid: app-14\ntitle: x\nstatus: Build\nrank: 3.5\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-15/issue.md",
          content: "---\nid: app-15\ntitle: Daily\nstatus: Build\nagent: triage\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-session-manager/issue.md",
          content: "---\nid: app-session-manager\nkind: session\ntitle: manager\nfolder: /Users/you/src/app\npaused: true\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33, app-35]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\nid: app-33\ntitle: x\nstatus: Build\n---\n", ".work/app-35/issue.md": "---\nid: app-35\narchived: true\n---\n" } },
        },
        {
          path: "/Users/me/src/app.record/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", "/Users/me/src/app.record/app-33/issue.md": "---\nid: app-33\n---\n" } },
        },
        {
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends:\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n" } },
        },
        {
          // one broken file blocks no write to the issues that depend on it, where `work issue set` refuses it
          path: ".work/app-34/issue.md",
          content: "---\nid: app-34\nstatus: Build\ndepends: [app-33]\n---\n",
          world: { fs: { "work.yml": "fields:\n  status:\n    values: [{ name: Build }]\n", ".work/app-33/issue.md": "---\ntitle: [x\n---\n" } },
        },
        { path: ".work/app-42/issue.md", content: "---\nstatus: Anything\n---\n" },
        { path: ".work/app-42/artifacts/notes.md", content: "no front matter\n" },
        { path: "docs/user/reference/record.md", content: "---\nsummary: x\n---\n" },
        { path: ".work/dark-mode.md", content: "# A new issue\n" },
      ],
    }),

  /**
   * Without it, a session could write its record's log as a file: a line in a shape the daemon does
   * not read, an answer that names no question, or a line rewritten, when the log is append-only and
   * a question is open until an answer names it. A session adds a line with `work log`, which the
   * daemon appends; the session never opens the file.
   *
   * The entry is the path: `log.jsonl` in the folder of an issue, a chat or a standing issue, written
   * or deleted with a tool, or named by a shell command that writes it. Reading it, with `cat`,
   * `tail` or `jq`, is no write.
   */
  logByDaemon: guardrail()
    .at(write, deletion, command)
    .check(logByDaemon)
    .message(
      "Only the daemon writes a record's `log.jsonl`, an issue's, a chat's or a standing issue's (docs/user/reference/record.md § log.jsonl). Ask with `work log question --ask \"…\"`, or tell with `work log fyi`, the body on stdin as a quoted heredoc, `<<'WORKLOG'`: the daemon appends the line. A line already in the log is never changed.",
    )
    .description("A record's log.jsonl, an issue's, a chat's or a standing issue's, is written by the daemon alone: a session's write, delete or shell write of one is refused, and `work log` adds a line.")
    .test({
      pass: [
        { path: ".work/app-42/issue.md", content: "---\nid: app-42\n---\n" },
        { path: "internal/record/testdata/log.jsonl", content: "{}\n" },
        // a fixture in a folder of a standing issue's shape, outside .work, is no record's log: it has
        // no issue.md, or one that is not a standing issue's
        { path: "test/my-session-fixture/log.jsonl", content: "{}\n" },
        "echo '{}' > test/my-session-fixture/log.jsonl",
        { path: "test/my-session-fixture/log.jsonl", content: "{}\n", world: { fs: { "test/my-session-fixture/issue.md": "---\nid: my-session-fixture\nkind: chat\n---\n" } } },
        { command: "echo '{}' >> test/my-session-fixture/log.jsonl", world: { fs: { "test/my-session-fixture/issue.md": "# not a record\n" } } },
        { path: "test/my-fixture/log.jsonl", content: "{}\n" },
        "tail -5 .work/app-42/log.jsonl",
        "tail -5 .work/app-session-triage/log.jsonl",
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
        // a standing issue's record's log, and a chat's, are the daemon's as an issue's is, an entry's
        // name ending in digits or root among them
        { path: ".work/app-session-triage/log.jsonl", content: '{"kind":"answer"}\n' },
        { path: ".work/app-session-foo-2/log.jsonl", content: "" },
        { path: ".work/app-session-root/log.jsonl", content: "" },
        { path: "/Users/me/src/app.record/app-chat-3/log.jsonl", content: "" },
        "echo '{\"kind\":\"fyi\"}' >> ../.work/app-session-triage/log.jsonl",
        // a standing issue's record's log at the record's own path, as its issue.md says
        {
          path: "/Users/me/src/app.record/app-session-triage/log.jsonl",
          content: "",
          world: { fs: { "/Users/me/src/app.record/app-session-triage/issue.md": "---\nid: app-session-triage\nkind: session\ntitle: triage\n---\n" } },
        },
        {
          command: "echo '{\"kind\":\"fyi\"}' >> /Users/me/src/app.record/app-session-triage/log.jsonl",
          world: { fs: { "/Users/me/src/app.record/app-session-triage/issue.md": "---\nid: app-session-triage\nkind: session\ntitle: triage\n---\n" } },
        },
      ],
    }),

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
        // a variable assigned again after its use, or twice, is not followed
        { command: "S=internal; echo x > $S/x.go; S=/private/tmp/claude-501/s", world: TRACKED },
        { command: "S=internal\nS=/private/tmp/claude-501/s\necho x > $S/x.go", world: TRACKED },
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
