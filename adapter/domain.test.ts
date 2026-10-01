// flow/adapter/domain.test.ts — the Claude Code dialect, proved as decisions.
//
// This is the file that knows what a hook payload and a transcript line mean, so it is the file
// where the harness's shape is pinned. Three claims carry it:
//
//   PAYLOAD → EVENT     the would-be file rebuilt in memory (J2.2), the delete targets a Bash line
//                       carries, and silence for anything flow was not asked for.
//   EFFECT → RESULT     one refusal spelling — exit 2, the text on stderr — and one injection
//                       spelling, the decision object.
//   THE TRANSCRIPT      the four dialect leaks that used to live in a pure home: drift's token
//                       count, the turn's actions, the brief, and the tool row.
//
// It is a unit suite because every one of those is a function of its arguments: a payload is an
// object and a transcript is a string. The live wiring is proved next door, against the built
// binary, over stdin.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { TurnAction } from "../index.ts";
import { metrics, momentsView, type Block, type Bound, type Row } from "../engine/domain.ts";
import { missingGrammarText } from "../checks/domain.ts";
import { matchAny } from "../glob.ts";
import {
  ALLOW,
  DELIVERS,
  EDIT_TOOLS,
  GIT_HOOK_ENV,
  HOOK_EVENTS,
  applyEdit,
  bashReads,
  branchFromHead,
  briefBlock,
  briefHead,
  contextTokens,
  decision,
  deleteTargets,
  delivers,
  faultText,
  readFault,
  hermeticEnv,
  isHookEvent,
  isInjected,
  relativise,
  sessionFactsFrom,
  sidecarPath,
  toEvent,
  toResult,
  tokensFromTranscript,
  toolRow,
  modesOf,
  mismatchesIn,
  steerOf,
  lastMode,
  shellReadRows,
  writeRows,
  mismatchRow,
  touchedPath,
  CONFIG_FILE,
  configImports,
  configSurface,
  repairs,
  statusCode,
  whileBroken,
  guardPaths,
  HOST_SURFACE,
  formatFacts,
  health,
  joinSpawn,
  uncoveredAreas,
  selectSessions,
  classifyBash,
  classifyStore,
  isCorrection,
  isGuardPath,
  mergeNarratives,
  narrative,
  parseEvents,
  projectFolderName,
  recipeTools,
  snip,
  spawnMeta,
  spawnsIn,
  strip,
  transcriptHead,
  weakenedAfterBlock,
  transcriptLines,
  turnActions,
  wouldBeFile,
  type AdapterEvent,
  type EventWorld,
  type HookPayload,
  type Change,
  type Steer,
  type Shown,
  type TranscriptEvent,
  type Candidate,
  type Facts,
  type SpawnRecord,
  NODE_FLOOR,
  configLoadFault,
  loadsAsStrippedModule,
  HOOK_REGISTRATIONS,
  ourHookCommand,
  registeredEvents,
  staleRegistrations,
  withRegistrations,
  callKey,
  deltaFault,
  included,
  literalScopes,
  preJudged,
  reversal,
  callName,
  callRecord,
  forgettable,
  overlapping,
  pathLines,
  REFUSED_ONLY,
  type CallRecord,
  snapshotPathspecs,
  staticPrefix,
  PRE_COMMIT,
  HOOKS_DIR,
  GATE_PATH,
  SET_HOOKS_PATH,
  ADD_THE_GATE_LINE,
  armsFlow,
  scaffold,
  planInit,
  initLines,
  status,
  statusLines,
  type InitFacts,
  type Status,
  type StatusFacts,
} from "./domain.ts";

// ── the world a payload is read against ──────────────────────────────────────

const ROOT = "/repo";

/**
 * Disk, as a map. Injected, because reading it is the shell's job and never a decision.
 *
 * `turn` is a function here for the same reason it is one in the interface: working out what the
 * actor did costs a whole transcript, and only the stop rail should ever pay for it. `asked` is how
 * this suite proves the other rails do not.
 */
let asked: string[];

function world(files: Record<string, string> = {}, turn: readonly TurnAction[] = []): EventWorld {
  asked = [];
  return {
    root: ROOT,
    read: (path) => files[path] ?? null,
    turn: () => {
      asked.push("turn");
      return turn;
    },
  };
}

const pre = (tool: string, input: Record<string, unknown>): HookPayload => ({
  session_id: "s1",
  tool_name: tool,
  tool_input: input,
});

/** The one guard event a payload produced, when a test is about exactly one. */
function only(events: readonly AdapterEvent[]): AdapterEvent {
  expect(events).toHaveLength(1);
  return events[0] as AdapterEvent;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS ADAPTER ANSWERS TO
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the six events, and the moments honestly delivered", () => {
  it("answers to six events, named by the event and never by the job", () => {
    expect([...HOOK_EVENTS]).toStrictEqual([
      "session-start",
      "pre-tool-use",
      "post-tool-use",
      "post-tool-use-failure",
      "stop",
      "notification",
    ]);
    expect(isHookEvent("pre-tool-use")).toBe(true);
    expect(isHookEvent("PreToolUse"), "the host's name is not flow's verb").toBe(false);
  });

  it("states what it can supply, and does not claim turn-end briefing", () => {
    // Stop's decision object carries no context channel, so a note bound at turn-end has nowhere to
    // be shown. Saying so is the contract; faking it would be the failure.
    expect(delivers("guardrail", "turn-end"), "the turn-end GUARDRAIL rail works").toBe(true);
    expect(delivers("breadcrumb", "turn-end"), "a NOTE bound there has nowhere to be shown").toBe(false);
    expect(DELIVERS.brief).not.toContain("turn-end");
    expect(DELIVERS.guard, "commit is delivered — by the git gate, not by the harness").toContain("commit");
    expect(delivers("breadcrumb", "session")).toBe(true);
    expect(delivers("breadcrumb", "touch")).toBe(true);
    expect(delivers("guardrail", "session"), "a guardrail has no session rail at all").toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PAYLOAD → EVENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the would-be file, rebuilt in memory before disk", () => {
  it("takes a Write's content outright", () => {
    expect(wouldBeFile("Write", { file_path: "/repo/src/a.ts", content: "next" }, world())).toStrictEqual({
      path: "src/a.ts",
      content: "next",
    });
  });

  it("folds an Edit into the file as it stands", () => {
    const w = world({ "src/a.ts": "const a = 1;\nconst b = 2;\n" });
    expect(wouldBeFile("Edit", { file_path: "/repo/src/a.ts", old_string: "1", new_string: "9" }, w)?.content).toBe(
      "const a = 9;\nconst b = 2;\n",
    );
  });

  it("folds every edit of a MultiEdit, in order", () => {
    const w = world({ "a.ts": "one two" });
    const edits = [
      { old_string: "one", new_string: "1" },
      { old_string: "two", new_string: "2" },
    ];
    expect(wouldBeFile("MultiEdit", { file_path: "a.ts", edits }, w)?.content).toBe("1 2");
  });

  it("stands aside when an anchor is not in the file — never judges a guess", () => {
    // The whole capability rests on the reconstruction being EXACT. A file that never existed is
    // worse than no guard at all, so an unlocatable anchor abandons the whole reconstruction.
    const w = world({ "a.ts": "one" });
    expect(applyEdit("one", { old_string: "nope", new_string: "x" })).toBeNull();
    expect(wouldBeFile("Edit", { file_path: "a.ts", old_string: "nope", new_string: "x" }, w)).toBeNull();
    expect(
      wouldBeFile("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "one", new_string: "1" }, { old_string: "zz", new_string: "" }] }, w),
      "one bad anchor abandons the fold rather than judging a half-applied file",
    ).toBeNull();
  });

  it("treats an empty anchor as a Write, and replace_all as every occurrence", () => {
    expect(applyEdit("anything", { old_string: "", new_string: "whole" })).toBe("whole");
    expect(applyEdit("a a a", { old_string: "a", new_string: "b", replace_all: true })).toBe("b b b");
  });

  it("is not a write at all when the tool names no path, or is not a writing tool", () => {
    expect(wouldBeFile("Write", {}, world())).toBeNull();
    expect(wouldBeFile("Read", { file_path: "a.ts" }, world())).toBeNull();
  });

  it("relativises against the root, because that is how every glob is written", () => {
    expect(relativise("/repo/src/a.ts", ROOT)).toBe("src/a.ts");
    expect(relativise("src/a.ts", ROOT), "already relative").toBe("src/a.ts");
    expect(relativise("/elsewhere/a.ts", ROOT), "outside the repo stays absolute").toBe("/elsewhere/a.ts");
  });
});

describe("a Bash line's delete targets", () => {
  it("reads rm, git rm, and the SOURCE side of mv and git mv", () => {
    expect(deleteTargets("rm -rf secret/a.ts b.ts")).toStrictEqual(["secret/a.ts", "b.ts"]);
    expect(deleteTargets("git rm secret/a.ts")).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets("mv secret/a.ts elsewhere/a.ts")).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets("git mv secret/a.ts elsewhere/a.ts"), "git mv was the old blind spot").toStrictEqual([
      "secret/a.ts",
    ]);
  });

  it("reads every sub-command of a chained line, and no others", () => {
    expect(deleteTargets("just build && rm dist/a.js")).toStrictEqual(["dist/a.js"]);
    expect(deleteTargets("echo 'rm a.ts'"), "a quoted mention is not a command").toStrictEqual([]);
    expect(deleteTargets("git commit -m 'rm the thing'")).toStrictEqual([]);
  });

  it("stands aside on a line it cannot tokenise, rather than guessing", () => {
    // null from the tokeniser means "I cannot tell". A guard that guesses at a line it could not
    // parse is worse than one that stands aside — and the command rail still sees the raw line.
    expect(deleteTargets("rm 'unclosed")).toStrictEqual([]);
  });

  it("does not read a rename with only a destination as a removal", () => {
    expect(deleteTargets("mv onlyone")).toStrictEqual([]);
  });
});

// ── Bash reads — what a shell command reads, for the touch breadcrumb ───────────

describe("bashReads — the files a Bash command reads, before it runs", () => {
  const HOME = "/home/me";
  const at = (command: string, cwd = ROOT, home: string | undefined = HOME): { reads: readonly string[]; searched: readonly string[] } =>
    bashReads(command, { cwd, root: ROOT, home });
  const reads = (command: string, cwd = ROOT): readonly string[] => at(command, cwd).reads;
  const searched = (command: string, cwd = ROOT): readonly string[] => at(command, cwd).searched;

  it("names the files the read commands open, and skips their pattern, script or filter", () => {
    expect(reads("cat src/a.ts src/b.ts")).toStrictEqual(["src/a.ts", "src/b.ts"]);
    expect(reads("head -n 30 src/a.ts; tail -5 src/b.ts")).toStrictEqual(["src/a.ts", "src/b.ts"]);
    expect(reads("sed -n '1,40p' src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads('grep -n "x|y" src/a.ts | head')).toStrictEqual(["src/a.ts"]);
    expect(reads("awk -F, '{print $1}' data.csv")).toStrictEqual(["data.csv"]);
    expect(reads("jq '.name' package.json")).toStrictEqual(["package.json"]);
    expect(reads("wc -l a.ts && diff -U 3 a.ts b.ts")).toStrictEqual(["a.ts", "b.ts"]);
  });

  it("reads the pattern from an option when one supplies it, and a file an option names", () => {
    expect(reads("grep -e pat src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("grep -f pats.txt src/a.ts")).toStrictEqual(["pats.txt", "src/a.ts"]);
    expect(reads("grep --file=pats.txt src/a.ts")).toStrictEqual(["pats.txt", "src/a.ts"]);
    expect(reads("grep --include=*.ts -n x src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("awk -f prog.awk data.csv")).toStrictEqual(["prog.awk", "data.csv"]);
    expect(reads("sed -f edit.sed src/a.ts")).toStrictEqual(["edit.sed", "src/a.ts"]);
  });

  it("tells BSD sed's in-place suffix from its script", () => {
    expect(reads("sed -i '' 's/a/b/' src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("sed -i .bak 's/a/b/' src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("sed -i 's/a/b/' src/a.ts")).toStrictEqual(["src/a.ts"]);
  });

  it("keeps a search apart from a read — its operands may be directories", () => {
    expect(at("rg -n TODO src docs")).toStrictEqual({ reads: [], searched: ["src", "docs"] });
    expect(at("grep -rn TODO src")).toStrictEqual({ reads: [], searched: ["src"] });
    expect(at("find src -name '*.ts' -o ( -name x ) ! -path y")).toStrictEqual({ reads: [], searched: ["src"] });
    expect(at("ls -la docs && du -sh lib && tree -L 2 pkg")).toStrictEqual({ reads: [], searched: ["docs", "lib", "pkg"] });
  });

  it("searches the working directory when a search names nothing, and a plain grep reads stdin", () => {
    expect(searched("rg TODO", "/repo/src")).toStrictEqual(["src"]);
    expect(searched("grep -r TODO", "/repo/src")).toStrictEqual(["src"]);
    expect(searched("ls", "/repo/src")).toStrictEqual(["src"]);
    expect(at("grep TODO")).toStrictEqual({ reads: [], searched: [] });
    // The repo root is not an area: a bare search there touches nothing in particular.
    expect(searched("find . -name x")).toStrictEqual([]);
  });

  it("stops find's paths at its expression", () => {
    expect(searched("find src lib ( -name x )")).toStrictEqual(["src", "lib"]);
    expect(searched("find src ! -name x")).toStrictEqual(["src"]);
  });

  it("drops stdin, empty arguments, an option after `--` is a file, and cp's destination is not read", () => {
    expect(reads("cat - a.ts ''")).toStrictEqual(["a.ts"]);
    expect(reads("cat -- -weird.ts")).toStrictEqual(["-weird.ts"]);
    expect(reads("cp -r a.ts b.ts dest/")).toStrictEqual(["a.ts", "b.ts"]);
  });

  it("reads a `<` redirect, and never the target of a write, a heredoc's delimiter or a here-string", () => {
    expect(reads("sort < names.txt > out.txt 2>/dev/null")).toStrictEqual(["names.txt"]);
    expect(reads("wc -l <> both.txt")).toStrictEqual(["both.txt"]);
    expect(reads("cat src/a.ts &> log.txt; cat src/b.ts &>> log.txt; cat c.ts 2>&1")).toStrictEqual(["src/a.ts", "src/b.ts", "c.ts"]);
    expect(reads("grep x <<< 'some text'")).toStrictEqual([]);
    expect(reads("while read l; do echo $l; done < list.txt")).toStrictEqual(["list.txt"]);
  });

  it("does not read a heredoc's body as commands, quoted or dash delimiters alike", () => {
    expect(reads("cat > out.ts <<'EOF'\ncat secret.ts\nEOF\ncat after.ts")).toStrictEqual(["after.ts"]);
    expect(reads("python3 - <<PY\nopen('x.ts')\n'unbalanced\nPY\nhead a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("cat <<-EOF\n\tcat inside.ts\n\tEOF\ncat after.ts")).toStrictEqual(["after.ts"]);
    // A body that never closes runs to the end of the line, and names nothing.
    expect(reads("cat <<EOF\ncat inside.ts")).toStrictEqual([]);
    // A `<<` with no delimiter after it is not a heredoc.
    expect(reads("cat a.ts <<")).toStrictEqual(["a.ts"]);
    // …but a body a SHELL reads is commands, and what they read is read.
    expect(reads("bash <<'EOF'\ncat inside.ts\nEOF\ncat after.ts")).toStrictEqual(["inside.ts", "after.ts"]);
    // A heredoc inside a `$(…)` is skipped there too, apostrophes and all.
    expect(reads("echo \"$(cat <<'EOF'\ndon't cat x.ts\nEOF\n)\"; cat after.ts")).toStrictEqual(["after.ts"]);
  });

  it("does not read a quoted operator as a separator, or a quoted word as a command", () => {
    expect(reads('grep -n "a; cat b.ts" c.ts')).toStrictEqual(["c.ts"]);
    expect(reads("echo 'cat x.ts' && cat \"y z.ts\"")).toStrictEqual(["y z.ts"]);
    expect(reads("cat $'ansi.ts' a\\ b.ts")).toStrictEqual(["ansi.ts", "a b.ts"]);
    expect(reads('cat "say \\"hi\\".ts"')).toStrictEqual(['say "hi".ts']);
  });

  it("follows `cd`, back with `cd -` and home with a bare `cd`, and a subshell's `cd` stays in it", () => {
    expect(reads("cd src && cat a.ts; cd - ; cat b.ts")).toStrictEqual(["src/a.ts", "b.ts"]);
    expect(reads("cd /repo/lib; cat a.ts")).toStrictEqual(["lib/a.ts"]);
    expect(reads("(cd src; cat a.ts); cat b.ts")).toStrictEqual(["src/a.ts", "b.ts"]);
    expect(reads("cd -P src && cat a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("pushd src && cat a.ts")).toStrictEqual(["src/a.ts"]);
    expect(at("cd; cat a.ts", ROOT, "/repo/home").reads).toStrictEqual(["home/a.ts"]);
    // Where a `cd` goes cannot be known, what is relative to it cannot either.
    expect(reads("cd $(pick); cat a.ts; cat /repo/b.ts")).toStrictEqual(["b.ts"]);
    expect(at("cd; cat a.ts", ROOT, undefined).reads).toStrictEqual([]);
    expect(reads("cd -; cat a.ts")).toStrictEqual([]);
  });

  it("resolves a variable the line assigns, `~` and `$HOME`, and leaves out one it cannot know", () => {
    expect(reads("F=src/a.ts; cat $F \"${F}\"")).toStrictEqual(["src/a.ts"]);
    expect(reads("export D=src; cat $D/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("export -n; local X; cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("X=1 cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("cat $UNSET/a.ts ${X:-y}.ts $1.ts $((1+2)).ts")).toStrictEqual([]);
    expect(reads("F=a.ts; F=$(pick); cat $F")).toStrictEqual([]);
    expect(at("cat ~/a.ts $HOME/b.ts", ROOT, "/repo/home").reads).toStrictEqual(["home/a.ts", "home/b.ts"]);
    expect(reads("cat ~/a.ts")).toStrictEqual([]);
    expect(reads("cat cost$ a.ts")).toStrictEqual(["cost$", "a.ts"]);
  });

  it("runs a for loop's body once per value", () => {
    expect(reads("for f in a.ts b.ts; do head -c 3 $f; done")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("for f in a.ts $(ls); do\n  cat $f\ndone")).toStrictEqual(["a.ts"]);
    expect(reads("for f; do cat $f; done; cat z.ts")).toStrictEqual(["z.ts"]);
    // Unclosed, the loop still ends with the line.
    expect(reads("for f in a.ts; do cat $f")).toStrictEqual(["a.ts"]);
  });

  it("reads what a `$(…)`, a backquote or a `<(…)` runs, without guessing at what it prints", () => {
    expect(at("head -c 400 sessions/$(ls sessions | head -1)")).toStrictEqual({ reads: [], searched: ["sessions"] });
    expect(reads("echo `cat a.ts` \"$(cat b.ts)\" \"`cat c.ts`\"")).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
    expect(reads("diff <(sort a.txt) >(cat) <(sort b.txt)")).toStrictEqual(["a.txt", "b.txt"]);
    expect(reads('echo "$(printf "%s" "x")"; cat a.ts')).toStrictEqual(["a.ts"]);
    expect(reads("echo $(echo (nested) 'q)' \\)); cat a.ts")).toStrictEqual(["a.ts"]);
  });

  it("peels the wrappers off the command they run", () => {
    expect(searched("timeout -s KILL 60 rg x src")).toStrictEqual(["src"]);
    expect(reads("env -u X A=1 cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("nice -n 5 nohup time cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("xargs -a list.txt -n 1 grep -l x")).toStrictEqual(["list.txt"]);
    expect(reads("command -v cat a.ts")).toStrictEqual([]);
    expect(reads("command cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("timeout 5")).toStrictEqual([]);
  });

  it("reads a git pathspec, never a revision, and follows `git -C`", () => {
    expect(searched("git diff HEAD~1 main..x HEAD:a.ts src/a.ts")).toStrictEqual(["src/a.ts"]);
    expect(searched("git log --oneline -- src docs")).toStrictEqual(["src", "docs"]);
    expect(searched("git -C lib -c a=b status pkg/x.ts")).toStrictEqual(["lib/pkg/x.ts"]);
    expect(searched("git --config-env a.b=HOME status pkg/x.ts")).toStrictEqual(["pkg/x.ts"]);
    expect(searched("git commit -m 'src/a.ts'")).toStrictEqual([]);
    expect(searched("git -C lib")).toStrictEqual([]);
  });

  it("reads ffmpeg's inputs", () => {
    expect(reads("ffmpeg -i in.mp4 -y out.mp4")).toStrictEqual(["in.mp4"]);
  });

  it("names nothing it cannot settle: an unknown command, an unknown word where a command goes, a line that will not lex", () => {
    expect(at("npx vitest run src/a.ts")).toStrictEqual({ reads: [], searched: [] });
    expect(reads("$CAT a.ts")).toStrictEqual([]);
    expect(reads("cat 'unclosed a.ts")).toStrictEqual([]);
    expect(reads('cat "unclosed a.ts')).toStrictEqual([]);
    expect(reads("cat $'unclosed")).toStrictEqual([]);
    expect(reads('cat "$(unclosed"')).toStrictEqual([]);
    expect(reads("cat $(unclosed a.ts")).toStrictEqual([]);
    expect(reads("cat `unclosed a.ts")).toStrictEqual([]);
    expect(reads("cat ${unclosed a.ts")).toStrictEqual([]);
    expect(reads("cat $((1+2 a.ts")).toStrictEqual([]);
    expect(reads("diff <(sort a.txt b.txt")).toStrictEqual([]);
    expect(reads('cat "a `b.ts"')).toStrictEqual([]);
  });

  it("finds at least what it found when it won the bake-off, on the hand-labelled corpus", () => {
    // The yardstick the mechanism was chosen by (__fixtures__/bash-corpus/, scored by
    // `just score-bash`; the bake-off is evidence/f3-b1-bakeoff.log in the task's journal). The
    // scorer lives in tools/, which the import fence keeps apart from this layer, so the one number
    // that matters is counted here: labelled reads found, over labelled reads. A root of "" makes
    // every absolute path "inside", so paths outside any repo are scored too. The labels spell `~`
    // as the home of the machine they were recorded on, so that home is handed in, not this one's.
    const corpus = JSON.parse(readFileSync(join(import.meta.dirname, "..", "__fixtures__", "bash-corpus", "corpus.json"), "utf8")) as {
      command: string;
      cwd: string;
      reads: string[];
    }[];
    let found = 0;
    let labelled = 0;
    for (const entry of corpus) {
      const got = bashReads(entry.command, { cwd: entry.cwd, root: "", home: "/Users/jawache" });
      const named = new Set([...got.reads, ...got.searched].map((p) => `/${p}`));
      const want = new Set(entry.reads.map((p) => posix.resolve(entry.cwd, p)));
      labelled += want.size;
      found += [...want].filter((p) => named.has(p)).length;
    }
    expect(labelled).toBe(272);
    expect(found).toBeGreaterThanOrEqual(241);
  });

  it("leaves out what lies outside the repo, and the repo root itself", () => {
    expect(reads("cat /etc/hosts /repo/src/a.ts ../elsewhere.ts")).toStrictEqual(["src/a.ts"]);
    expect(reads("cat src/a.ts src/./a.ts")).toStrictEqual(["src/a.ts"]);
  });

  it("reads through shell structure: continuations, comments, keywords, functions and case", () => {
    expect(reads("cat \\\n  a.ts # cat b.ts\ncat c.ts")).toStrictEqual(["a.ts", "c.ts"]);
    expect(reads("if [ -f a.ts ]; then cat a.ts; else cat b.ts; fi")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("{ cat a.ts; } 2>&1 | head; ! cat b.ts")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("f() { cat a.ts; }; f")).toStrictEqual(["a.ts"]);
    expect(reads("case $x in a) cat a.ts;; esac; cat b.ts")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("done; cat a.ts) ; (cat b.ts")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("cat a.ts & cat b.ts || cat c.ts |& cat")).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("toEvent — one payload, every moment it carries", () => {
  it("turns a session start into the session moment", () => {
    expect(toEvent("session-start", { source: "startup" }, world())).toStrictEqual([
      { rail: "brief", moment: "session" },
    ]);
  });

  it("turns an Edit into a write event carrying the would-be file", () => {
    const w = world({ "src/a.ts": "old" });
    const event = only(toEvent("pre-tool-use", pre("Edit", { file_path: "/repo/src/a.ts", old_string: "old", new_string: "new" }), w));
    expect(event).toStrictEqual({ rail: "guard", moment: "write", file: { path: "src/a.ts", content: "new" } });
    // The write rail is the one that fires on every keystroke, and a transcript is megabytes.
    expect(asked, "the write rail must never pay for the turn").toStrictEqual([]);
  });

  it("turns a Bash call into the command moment on BOTH rails, plus a delete moment per file it would remove", () => {
    // One call, three rails — which is why toEvent answers with a list. The guard rail decides
    // whether the command may run and the brief rail says what the agent should know before it does;
    // the delete rail sees the file as it still is, so a content rule can ask what is about to be
    // lost.
    const w = world({ "secret/a.ts": "the content" });
    const events = toEvent("pre-tool-use", pre("Bash", { command: "rm secret/a.ts" }), w);
    // Every guard event comes first: a refusal carries no notes, so none is judged after one.
    expect(events).toStrictEqual([
      { rail: "guard", moment: "command", command: "rm secret/a.ts" },
      { rail: "guard", moment: "delete", file: { path: "secret/a.ts", content: "the content" } },
      { rail: "brief", moment: "command", command: "rm secret/a.ts" },
    ]);
  });

  it("turns each file a Bash call reads or searches into a touch on the same answer, from where the shell stands", () => {
    // The note has to arrive BEFORE the output: a Bash payload names no path, so the post-tool-use
    // rail has nothing to steer on, and a touch there would be after the agent read the file.
    const command = "cat a.ts && rg x lib ~/n.md";
    const events = toEvent("pre-tool-use", { ...pre("Bash", { command }), cwd: "/repo/src" }, { ...world(), home: "/repo/home" });
    expect(events).toStrictEqual([
      { rail: "guard", moment: "command", command },
      { rail: "brief", moment: "command", command },
      { rail: "brief", moment: "touch", path: "src/a.ts" },
      { rail: "brief", moment: "touch", path: "src/lib" },
      { rail: "brief", moment: "touch", path: "home/n.md" },
    ]);
    // No `cwd` on the payload: the shell is taken to stand at the repo root. A path read AND
    // searched is one touch, not two.
    expect(toEvent("pre-tool-use", pre("Bash", { command: "cat a.ts; ls a.ts" }), world()).slice(2)).toStrictEqual([
      { rail: "brief", moment: "touch", path: "a.ts" },
    ]);
  });

  it("raises no delete moment for a file that is already gone", () => {
    const events = toEvent("pre-tool-use", pre("Bash", { command: "rm nowhere.ts" }), world());
    expect(events).toStrictEqual([
      { rail: "guard", moment: "command", command: "rm nowhere.ts" },
      { rail: "brief", moment: "command", command: "rm nowhere.ts" },
    ]);
  });

  it("turns a post-tool-use call on a file into a touch, and a pathless one into silence", () => {
    expect(toEvent("post-tool-use", pre("Read", { file_path: "/repo/docs/x.md" }), world())).toStrictEqual([
      { rail: "brief", moment: "touch", path: "docs/x.md" },
    ]);
    // A touch event with no path would show EVERY area breadcrumb rather than none — the engine
    // narrows by `on` only when the event names a path. Silence, and the note arrives on the next
    // file the session touches.
    expect(toEvent("post-tool-use", pre("Bash", { command: "ls" }), world())).toStrictEqual([]);
  });

  it("turns a stop into turn-end carrying the turn's actions, and honours the host's loop-breaker", () => {
    const actions: TurnAction[] = [{ did: "edit", path: "a.ts" }];
    expect(toEvent("stop", { session_id: "s" }, world({}, actions))).toStrictEqual([
      { rail: "guard", moment: "turn-end", turn: actions },
    ]);
    expect(
      toEvent("stop", { stop_hook_active: true }, world({}, actions)),
      "we already held this turn open once; blocking again is how a session wedges",
    ).toStrictEqual([]);
  });

  it("answers an empty payload, and a notification, with silence rather than an invented moment", () => {
    expect(toEvent("pre-tool-use", {}, world())).toStrictEqual([]);
    expect(toEvent("pre-tool-use", pre("Bash", {}), world())).toStrictEqual([]);
    expect(toEvent("notification", { session_id: "s" }, world())).toStrictEqual([]);
  });

  it("reads what a post-tool-use call was about, path tools and searches alike", () => {
    expect(touchedPath(pre("Grep", { pattern: "x", path: "/repo/src" }), ROOT)).toBe("src");
    expect(touchedPath(pre("NotebookEdit", { notebook_path: "/repo/n.ipynb" }), ROOT)).toBe("n.ipynb");
    expect(touchedPath(pre("Bash", { command: "ls" }), ROOT)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EFFECT → RESULT
// ════════════════════════════════════════════════════════════════════════════════════════════════

const block = (over: Partial<Block> = {}): Block => ({
  do: "block",
  entry: "core.noTodo",
  message: "No TODOs in shipped code.",
  subject: "src/a.ts",
  detail: "says TODO",
  ...over,
});

describe("toResult — one refusal spelling, one injection spelling", () => {
  it("blocks with exit 2 and the whole refusal on stderr", () => {
    // ONE spelling at every rail. The old engine had three — a PreToolUse deny object, exit 2, and
    // a Stop decision object — three shapes for one answer, each with its own way of being wrong.
    const result = toResult("pre-tool-use", { refused: [{ moment: "write", block: block() }], shown: [] });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("flow — blocked before the write landed");
    expect(result.stderr).toContain("core.noTodo · src/a.ts");
    expect(result.stderr).toContain("No TODOs in shipped code.");
    expect(result.stderr).toContain("says TODO");
    expect(result.stderr, "a refusal without an instruction leaves a blocked agent guessing").toContain(
      "Adjust the change so it passes, then retry.",
    );
  });

  it("banners by the RAIL that refused, not by the hook that carried it", () => {
    const bash = (moment: "command" | "delete"): string =>
      toResult("pre-tool-use", { refused: [{ moment, block: block() }], shown: [] }).stderr;
    expect(bash("command")).toContain("command blocked before it ran");
    expect(bash("delete")).toContain("blocked before the delete");
    expect(toResult("stop", { refused: [{ moment: "turn-end", block: block() }], shown: [] }).stderr).toContain(
      "turn held open",
    );
  });

  it("carries every refusal, not just the first", () => {
    const result = toResult("pre-tool-use", {
      refused: [
        { moment: "write", block: block({ entry: "one" }) },
        { moment: "write", block: block({ entry: "two" }) },
      ],
      shown: [],
    });
    expect(result.stderr).toContain("one");
    expect(result.stderr).toContain("two");
  });

  it("injects notes as the decision object the host reads, echoing its own event name", () => {
    const shown: Shown[] = [{ entry: "work.orientation", cause: "session", body: "This repo is guarded by flow." }];
    const result = toResult("session-start", { refused: [], shown });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toStrictEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "# breadcrumb: work.orientation (session)\nThis repo is guarded by flow.",
      },
    });
  });

  it("refuses before it injects — a rail that blocks has nothing to add", () => {
    const result = toResult("pre-tool-use", {
      refused: [{ moment: "write", block: block() }],
      shown: [{ entry: "a", cause: "first-touch", body: "hello" }],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
  });

  it("says nothing at all when nothing happened", () => {
    expect(toResult("post-tool-use", { refused: [], shown: [] })).toStrictEqual(ALLOW);
    expect(
      toResult("post-tool-use", { refused: [], shown: [{ entry: "a", cause: "drift", body: "   " }] }),
      "a note whose prose could not be resolved is not an empty injection",
    ).toStrictEqual(ALLOW);
  });

  it("heads each note with the mechanism's own name and its cause", () => {
    const text = briefBlock([
      { entry: "area", cause: "first-touch", body: "one" },
      { entry: "drifted", cause: "drift", body: "two" },
    ]);
    expect(text).toBe("# breadcrumb: area (first-touch)\none\n\n# breadcrumb: drifted (drift)\ntwo");
  });

  it("names the event in a decision object", () => {
    expect(JSON.parse(decision("post-tool-use", "x"))).toStrictEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "x" },
    });
  });

  it("says which of the three things happened to a payload it could not read", () => {
    // "There was nothing to guard" and "I could not SEE what I was guarding" were one answer in the
    // old engine — an empty object — so a rail that could not read its payload allowed, silently.
    expect(faultText("pre-tool-use", "unreadable", "EBADF")).toBe(
      "[flow hook pre-tool-use] the guard could not READ its payload from stdin (EBADF).",
    );
    expect(faultText("stop", "unparseable", "12 bytes on stdin, and not JSON")).toContain("could not PARSE");
  });

  it("is LOUD on every rail that judges a tool call, and speaks without holding on the rest", () => {
    for (const hook of ["pre-tool-use", "post-tool-use", "post-tool-use-failure"] as const) {
      const answer = readFault(hook, "unparseable", "not JSON");
      expect(answer.exitCode, hook).toBe(2);
      expect(answer.stderr).toContain(`[flow hook ${hook}] the guard could not PARSE its payload`);
    }
    for (const hook of ["session-start", "stop", "notification"] as const) {
      const answer = readFault(hook, "unreadable", "EBADF");
      expect(answer.exitCode, hook).toBe(0);
      expect(answer.stderr).toContain("could not READ");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRANSCRIPT
// ════════════════════════════════════════════════════════════════════════════════════════════════

const line = (record: unknown): string => JSON.stringify(record);

const assistant = (content: unknown, usage?: Record<string, number>): string =>
  line({ type: "assistant", message: { role: "assistant", content, ...(usage ? { usage } : {}) } });

const human = (prose: string): string => line({ type: "user", message: { role: "user", content: prose } });

const use = (name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: "tool_use",
  name,
  input,
});

describe("the transcript's dialect", () => {
  it("reads every readable line and skips the rest", () => {
    const jsonl = [human("hi"), "", "{not json", line("a string, not a record"), assistant([])].join("\n");
    const lines = transcriptLines(jsonl);
    expect(lines.map((l) => l.kind)).toStrictEqual(["user", "assistant"]);
  });

  it("counts drift as input plus BOTH cache buckets, from the LAST assistant message", () => {
    // input_tokens alone is about nil — the context lives in cache_read_input_tokens — so a counter
    // that summed the obvious field would read ~0 forever, which looks like a session that never
    // drifts.
    expect(contextTokens({ input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 })).toBe(110);
    expect(contextTokens(undefined)).toBe(0);
    const jsonl = [
      assistant([], { input_tokens: 1, cache_read_input_tokens: 10 }),
      human("carry on"),
      assistant([], { input_tokens: 2, cache_read_input_tokens: 40_000 }),
    ].join("\n");
    expect(tokensFromTranscript(jsonl)).toBe(40_002);
    expect(tokensFromTranscript(""), "no transcript is no drift, not an error").toBe(0);
  });

  it("reads the turn's actions as edits and runs, in order, since the human last spoke", () => {
    const jsonl = [
      human("first turn"),
      assistant([use("Edit", { file_path: "/repo/rules/a.yml" })]),
      human("second turn"),
      assistant([use("Write", { file_path: "/repo/rules/b.yml" }), use("Bash", { command: "just test-rules" })]),
      assistant([use("Read", { file_path: "/repo/rules/c.yml" })]),
    ].join("\n");
    expect(turnActions(jsonl, ROOT)).toStrictEqual([
      { did: "edit", path: "rules/b.yml" },
      { did: "run", command: "just test-rules" },
    ]);
  });

  it("does not mistake the harness's own injections for the human starting a new turn", () => {
    // A hook's additionalContext arrives wearing a user message's clothes. Reading one as a turn
    // boundary would empty the turn's actions exactly when a turn-end rule needs them.
    const jsonl = [
      human("do the thing"),
      assistant([use("Edit", { file_path: "a.ts" })]),
      human("<system-reminder>\nremember the rules\n</system-reminder>"),
      assistant([use("Bash", { command: "ls" })]),
    ].join("\n");
    expect(turnActions(jsonl)).toStrictEqual([
      { did: "edit", path: "a.ts" },
      { did: "run", command: "ls" },
    ]);
    expect(isInjected("  <system-reminder>x")).toBe(true);
    expect(isInjected("write the code")).toBe(false);
  });

  it("knows which tool names change a file, in one place", () => {
    expect([...EDIT_TOOLS].sort()).toStrictEqual(["Edit", "MultiEdit", "NotebookEdit", "Write"]);
    const jsonl = [human("go"), assistant([use("NotebookEdit", { notebook_path: "n.ipynb" })])].join("\n");
    expect(turnActions(jsonl), "the old copy did not know about NotebookEdit").toStrictEqual([
      { did: "edit", path: "n.ipynb" },
    ]);
  });

  it("reads the brief a session was started with, and nothing the harness said", () => {
    const jsonl = [
      line({ type: "user", isMeta: true, message: { content: "Caveat: the messages below…" } }),
      human("<command-name>/work</command-name>"),
      human("Follow `/work build`. The repo is …"),
      human("and another thing"),
    ].join("\n");
    expect(briefHead(jsonl)).toBe("Follow `/work build`. The repo is …");
    expect(briefHead(jsonl, 6)).toBe("Follow");
    expect(briefHead("")).toBe("");
  });
});

describe("who the session is, from what the host wrote", () => {
  const sidecar = JSON.stringify({ agentType: "builder", description: "build F4", spawnDepth: 1 });

  it("takes the agent type from the sidecar and the brief from the transcript", () => {
    const facts = sessionFactsFrom({
      payload: { session_id: "s", agent_id: "agent-1" },
      transcript: human("Follow `/work build`"),
      sidecar,
    });
    expect(facts).toStrictEqual({
      head: "Follow `/work build`",
      subagent: true,
      agentType: "builder",
      description: "build F4",
    });
  });

  it("reads the parent by ABSENCE — no sidecar, no agent id, no type", () => {
    const facts = sessionFactsFrom({ payload: { session_id: "s" }, transcript: human("hello"), sidecar: null });
    expect(facts).toStrictEqual({ head: "hello", subagent: false });
  });

  it("keeps a spawn a spawn when its sidecar will not parse — spawned, but as what we cannot say", () => {
    const facts = sessionFactsFrom({ payload: { session_id: "s", agent_id: "a" }, transcript: null, sidecar: "{oops" });
    expect(facts.subagent).toBe(true);
    expect(facts.agentType, "a category keyed on a type declines; the parent must not claim it").toBeUndefined();
    expect(facts.head).toBe("");
  });

  it("reads the branch out of HEAD's own text, ref or detached", () => {
    // A file read rather than a `git` subprocess: the marker is written on every tool call, and it
    // is the only form that answers on an unborn branch — every repo's own first commit.
    expect(branchFromHead("ref: refs/heads/workflow/flow\n")).toBe("workflow/flow");
    expect(branchFromHead("9f2c1a4b8e7d6c5b4a39\n"), "detached — the short sha").toBe("9f2c1a4b8e7d");
    expect(branchFromHead("  \n")).toBeNull();
  });

  it("finds the sidecar beside the transcript it belongs to", () => {
    expect(sidecarPath("/c/projects/p/s1/subagents/agent-a7.jsonl")).toBe(
      "/c/projects/p/s1/subagents/agent-a7.meta.json",
    );
    expect(sidecarPath("/c/projects/p/s1"), "not a transcript path at all").toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDER, AND THE ENVIRONMENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the flight recorder's row", () => {
  it("records a path call, a command call, and a search — every call, by name", () => {
    // `edit: true` is stamped here and nowhere else: the engine reads the record back to answer
    // "how much work happened in this area" and may never import this file to ask which of the
    // host's tool names change a file.
    expect(toolRow(pre("Edit", { file_path: "/repo/src/a.ts" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Edit",
      path: "src/a.ts",
      edit: true,
    });
    expect(toolRow(pre("Read", { file_path: "/repo/src/a.ts" }), ROOT)).toMatchObject({ edit: false });
    expect(toolRow(pre("Bash", { command: "just test" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Bash",
      command: "just test",
    });
    expect(toolRow(pre("Grep", { pattern: "TODO", path: "/repo/src" }), ROOT)).toStrictEqual({
      kind: "tool",
      tool: "Grep",
      pattern: "TODO",
      scope: "src",
    });
    expect(toolRow(pre("Task", {}), ROOT), "no subject is still a call worth counting").toStrictEqual({
      kind: "tool",
      tool: "Task",
    });
    expect(toolRow({ session_id: "s" }), "no tool is no row").toBeNull();
  });

  it("carries the permission mode the host stated for the call, on every shape of row", () => {
    const moded = (tool: string, input: Record<string, unknown>): HookPayload => ({ ...pre(tool, input), permission_mode: "auto" });
    expect(toolRow(moded("Edit", { file_path: "/repo/a.ts" }), ROOT)).toMatchObject({ mode: "auto" });
    expect(toolRow(moded("Bash", { command: "ls" }), ROOT)).toMatchObject({ mode: "auto" });
    expect(toolRow(moded("Grep", { pattern: "x" }), ROOT)).toMatchObject({ mode: "auto" });
    expect(toolRow(moded("Task", {}), ROOT)).toStrictEqual({ kind: "tool", tool: "Task", mode: "auto" });
    expect(toolRow(pre("Task", {}), ROOT), "no mode stated is no field").not.toHaveProperty("mode");
  });

  it("a Bash call's files read by name are read rows — a searched directory is not", () => {
    const bash = { ...pre("Bash", { command: "cat src/a.ts && rg TODO src && head -3 ../out.txt" }), cwd: ROOT };
    expect(shellReadRows(bash, ROOT)).toStrictEqual([{ kind: "read", tool: "Bash", path: "src/a.ts" }]);
    expect(shellReadRows(pre("Read", { file_path: "/repo/src/a.ts" }), ROOT), "a Read is its own tool row").toEqual([]);
    expect(shellReadRows(pre("Bash", {}), ROOT)).toEqual([]);
  });

  it("the files a call changed are write rows, except the file an edit tool named and anything a spawn saw", () => {
    const changes: Change[] = [
      { path: "src/a.ts", before: "a", after: "b" },
      { path: "src/new.ts", before: null, after: "n" },
      { path: "src/old.ts", before: "o", after: null },
    ];
    expect(writeRows(pre("Bash", { command: "python3 - <<EOF" }), changes, ROOT)).toStrictEqual([
      { kind: "write", tool: "Bash", path: "src/a.ts", change: "modified" },
      { kind: "write", tool: "Bash", path: "src/new.ts", change: "created" },
      { kind: "write", tool: "Bash", path: "src/old.ts", change: "deleted" },
    ]);
    expect(writeRows(pre("Edit", { file_path: "/repo/src/a.ts" }), changes, ROOT).map((r) => r["path"])).toEqual([
      "src/new.ts",
      "src/old.ts",
    ]);
    expect(writeRows(pre("NotebookEdit", { notebook_path: "/repo/src/new.ts" }), changes, ROOT)).toHaveLength(2);
    expect(writeRows(pre("Agent", { prompt: "build" }), changes, ROOT), "the subagent's calls log their own").toEqual([]);
    expect(writeRows(pre("Task", {}), changes, ROOT)).toEqual([]);
  });

  it("the host's own changed-file list is a mismatch row only where it disagrees with flow's diff", () => {
    const changes: Change[] = [
      { path: "src/a.ts", before: "a", after: "b" },
      { path: "src/b.ts", before: "a", after: "b" },
    ];
    const after = (bashEditDiff: unknown): HookPayload => ({ ...pre("Bash", { command: "x" }), tool_response: { stdout: "", bashEditDiff } });
    expect(mismatchRow(after({ changedFiles: ["/repo/src/a.ts", "/repo/src/b.ts"] }), changes, ROOT), "agreement is silence").toBeNull();
    expect(mismatchRow(after({ changedFiles: ["/repo/src/a.ts", "/repo/.env", "/elsewhere/x"] }), changes, ROOT)).toStrictEqual({
      kind: "mismatch",
      tool: "Bash",
      hostOnly: [".env"],
      flowOnly: ["src/b.ts"],
    });
    // A list the host cut short cannot prove flow saw something extra.
    expect(mismatchRow(after({ changedFiles: ["/repo/src/a.ts"], moreFiles: 3 }), changes, ROOT)).toBeNull();
    expect(mismatchRow(pre("Bash", { command: "x" }), changes, ROOT), "no list, no opinion").toBeNull();
    expect(mismatchRow({ ...pre("Bash", {}), tool_response: "text" }, changes, ROOT)).toBeNull();
    expect(mismatchRow(after(null), changes, ROOT)).toBeNull();
    expect(mismatchRow(after({ files: [] }), changes, ROOT)).toBeNull();
  });
});

describe("the environment a check's command sees", () => {
  it("strips git's hook plumbing, and keeps everything else", () => {
    // The gate runs inside the pre-commit hook and inherits these; a nested `git` would then aim at
    // the in-progress commit. It was the tool-gate rule's own business until ctx.exec became the
    // one door.
    const env = hermeticEnv({ PATH: "/usr/bin", GIT_INDEX_FILE: "/repo/.git/index", HOME: "/home/me" });
    expect(env).toStrictEqual({ PATH: "/usr/bin", HOME: "/home/me" });
    expect(GIT_HOOK_ENV).toContain("GIT_DIR");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ARCHIVAL SIDE — the store, and what a conversation says
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The live half above is handed a transcript path. This half is asked about a REPO, after the
// fact, and has to find the conversations itself — so it is proved the same way, as decisions over
// bytes: a folder listing is an array of strings, a transcript is a string, and what they MEAN is
// the thing under test.

/** A whole transcript file, built the way the host writes it. */
const store = (...records: Record<string, unknown>[]): string => records.map((r) => JSON.stringify(r)).join("\n");

const spokeBack = (blocks: unknown[], ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "assistant",
  timestamp: ts,
  message: { content: blocks },
});

const spoke = (prose: string, ts = "2026-01-01T00:00:00.000Z"): Record<string, unknown> => ({
  type: "user",
  timestamp: ts,
  message: { content: prose },
});

const used = (name: string, input: Record<string, unknown>, id = "toolu_1"): Record<string, unknown> => ({
  type: "tool_use",
  id,
  name,
  input,
});

describe("the store — where the harness keeps its transcripts", () => {
  it("encodes a working directory the way the host does: every non-alphanumeric becomes a dash", () => {
    expect(projectFolderName("/Users/x/dev/repo")).toBe("-Users-x-dev-repo");
    // A dot is not special, so a hidden folder yields a DOUBLED dash — the check that this is the
    // real rule rather than the hand-written `[/.]` approximation the old tools carried.
    expect(projectFolderName("/Users/x/.work/y")).toBe("-Users-x--work-y");
    expect(projectFolderName("/Users/x/a_b c")).toBe("-Users-x-a-b-c");
  });

  it("sorts a listing into sessions, their subagents, and what it did not understand", () => {
    const { transcripts, ignored } = classifyStore([
      "abc.jsonl",
      "abc/subagents/agent-1.jsonl",
      "abc/subagents/agent-1.meta.json",
      "abc/subagents/agent-2.jsonl",
      "notes.txt",
      "abc/summary.md",
    ]);
    expect(transcripts).toEqual([
      { path: "abc.jsonl", meta: null, session: "abc", agent: null },
      { path: "abc/subagents/agent-1.jsonl", meta: "abc/subagents/agent-1.meta.json", session: "abc", agent: "agent-1" },
      // The sidecar is only named when the listing HELD it — the shell never probes for a file.
      { path: "abc/subagents/agent-2.jsonl", meta: null, session: "abc", agent: "agent-2" },
    ]);
    // A `.meta.json` is read through its transcript, so naming it as ignored would be noise.
    expect(ignored).toEqual(["notes.txt", "abc/summary.md"]);
  });

  it("reads the sidecar, including the toolUseId that joins it to the parent's own call", () => {
    expect(
      spawnMeta('{"agentType":"builder","description":"Build F5","toolUseId":"toolu_9","model":"opus","spawnDepth":1}'),
    ).toEqual({ agentType: "builder", description: "Build F5", toolUseId: "toolu_9", model: "opus", spawnDepth: 1 });
    expect(spawnMeta("{}")).toEqual({ agentType: null, description: null, toolUseId: null, model: null, spawnDepth: null });
    expect(spawnMeta("not json")).toBe(null);
    expect(spawnMeta(null)).toBe(null);
  });

  it("joins a sidecar to the parent block that spawned it, by id", () => {
    const parent = store(
      spoke("go"),
      spokeBack(
        [used("Agent", { subagent_type: "general-purpose", description: "Build F5", prompt: "x" }, "toolu_9")],
        "2026-01-01T10:00:00.000Z",
      ),
      spokeBack([used("Read", { file_path: "/repo/a.ts" }, "toolu_x")]),
    );
    const spawns = spawnsIn(parent);
    expect([...spawns.keys()]).toEqual(["toolu_9"]);
    const meta = spawnMeta('{"agentType":"builder","toolUseId":"toolu_9"}');
    expect(spawns.get(meta?.toolUseId ?? "")).toMatchObject({
      asked: "general-purpose",
      description: "Build F5",
      ts: "2026-01-01T10:00:00.000Z",
      line: 2,
    });
    // The sidecar OUTRANKS what the parent asked for — that is the whole point of the join: the
    // parent's `general-purpose` is a claim, and `builder` is what the host wrote down.
    expect(meta?.agentType).toBe("builder");
  });

  it("answers which worktree a transcript belongs to from the RECORDS, never from the folder name", () => {
    // Two different checkouts, one folder name — which is why the name can never be inverted.
    expect(projectFolderName("/x/workbench.workflow-flow")).toBe(projectFolderName("/x/workbench/workflow/flow"));
    const file = store(
      { type: "last-prompt" },
      { type: "mode" },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/x/workbench.workflow-flow",
        gitBranch: "workflow/flow",
        message: { content: "hi" },
      },
    );
    // ONE pass for all three. It was three functions and therefore three parses of the same
    // multi-megabyte file, per conversation in the store, for an answer that is in its first few
    // records — and this stops as soon as it has them.
    expect(transcriptHead(file)).toEqual({
      cwd: "/x/workbench.workflow-flow",
      branch: "workflow/flow",
      started: "2026-01-01T00:00:00.000Z",
    });
    // The stub records at the head of every file carry none of the three, so a literal first line
    // is never enough — and a file that has none of them says so rather than guessing.
    expect(transcriptHead(store({ type: "last-prompt" }))).toEqual({ cwd: null, branch: null, started: null });
    expect(transcriptHead("")).toEqual({ cwd: null, branch: null, started: null });
  });
});

describe("the narrative — the pairing, and the pointers it produces", () => {
  it("reads typed prompts, tool calls and their results, each with its line", () => {
    const file = store(
      { type: "user", message: { content: "<system-reminder>injected</system-reminder>" } },
      spoke("please fix the build"),
      spokeBack([used("Bash", { command: "just test" }, "toolu_1")], "2026-01-01T09:00:00.000Z"),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }] } },
      spokeBack([used("Edit", { file_path: "/repo/src/a.ts" }, "toolu_2")]),
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ text: "boom" }], is_error: true }] },
      },
    );
    expect(parseEvents(file, "/repo")).toEqual([
      // The injected reminder is NOT a prompt: the harness talking to itself is not the human.
      { line: 2, kind: "prompt", text: "please fix the build" },
      { line: 3, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "toolu_1", name: "Bash", input: { command: "just test" }, path: "" },
      { line: 4, kind: "result", id: "toolu_1", content: "ok", failed: false },
      {
        line: 5,
        kind: "use",
        ts: "2026-01-01T00:00:00.000Z",
        id: "toolu_2",
        name: "Edit",
        input: { file_path: "/repo/src/a.ts" },
        path: "src/a.ts",
      },
      { line: 6, kind: "result", id: "toolu_2", content: "boom", failed: true },
    ]);
  });

  it("carries the repo files a Bash call reads, from the directory the record says it ran in", () => {
    const file = store(
      { ...spokeBack([used("Bash", { command: "cat a.ts; rg x lib; cat /etc/hosts" })]), cwd: "/repo/src" },
      spokeBack([used("Bash", { command: "cat a.ts" }, "t2")]),
      spokeBack([used("Bash", { command: "cat ~/a.ts" }, "t3")]),
    );
    const uses = parseEvents(file, "/repo", "/repo/home");
    // Only files read by name: a searched directory is not a file, and outside the repo is not an area.
    expect(uses[0]).toMatchObject({ name: "Bash", reads: ["src/a.ts"] });
    // No `cwd` on the record: the call is taken to have run at the root.
    expect(uses[1]).toMatchObject({ reads: ["a.ts"] });
    expect(uses[2]).toMatchObject({ reads: ["home/a.ts"] });
    // With no repo to be relative to there is nothing to count in.
    expect(parseEvents(file)[0]).not.toHaveProperty("reads");
  });

  it("a result carrying an object rather than text is still readable", () => {
    const file = store({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: { n: 1 } }] } });
    expect(parseEvents(file)[0]).toMatchObject({ kind: "result", content: '{"n":1}', failed: false });
  });

  it("spots the human pushing back — a heuristic, which is why every finding cites its line", () => {
    expect(isCorrection("actually, revert that")).toBe(true);
    expect(isCorrection("you forgot the test")).toBe(true);
    // `no,` — the commonest spelling of pushback there is, and the one the ported regex could
    // never match: its alternative ended in a punctuation class and was then asked for a word
    // boundary, which a comma followed by a space can never be. A dead alternative in a detector
    // is the spec's own P2 shape, so the anchoring moved outside the class.
    expect(isCorrection("no, the other one")).toBe(true);
    expect(isCorrection("wait, that is not it")).toBe(true);
    expect(isCorrection("please add a test for the parser")).toBe(false);
    expect(isCorrection("the manifest has no, or few, entries")).toBe(true);
  });

  it("shortens for printing, and MARKS the cut so a truncated line never reads as a whole one", () => {
    expect(snip("  a\n  b  ")).toBe("a b");
    expect(snip("abcdefghij", 5)).toBe("abcd…");
    expect(strip("[31mred[0m")).toBe("red");
    expect(strip(undefined)).toBe("");
  });
});

describe("the justfile — a bypass is DERIVED from the repo's own recipes", () => {
  const justfile = ["# a comment", "test:", "    npx vitest run", "    @just lint", "lint:", "    eslint .", "[private]"].join("\n");


  it("reads each recipe body's command words, minus the shell noise", () => {
    // `npx vitest run` names `vitest`, not `npx`. The ported reader took the first word, found a
    // launcher in its own noise list, and dropped the line — so in a repo that drives everything
    // through npx (this one) the tool set came back empty and the bypass section was silently off.
    expect(recipeTools(justfile).sort()).toEqual(["eslint", "vitest"]);
    // With no justfile there is nothing to bypass, so the detection switches itself off rather
    // than falling back to a hardcoded list that would be wrong in every other repo.
    expect(recipeTools("")).toEqual([]);
  });

  it("tells a recipe call from going round it, and leaves a heredoc alone", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("just test && just lint", tools)).toEqual({ recipes: ["test", "lint"], bypasses: [], commits: false });
    expect(classifyBash("npx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("just test-vitest", tools)).toEqual({ recipes: ["test-vitest"], bypasses: [], commits: false });
    expect(classifyBash("git commit -m x", tools).commits).toBe(true);
    // Authoring a file whose body mentions a tool is not running that tool.
    expect(classifyBash("cat <<'EOF' > x\neslint .\nEOF", tools)).toEqual({ recipes: [], bypasses: [], commits: false });
    // A here-string is not a heredoc: the line is still read.
    expect(classifyBash("grep -c x <<< foo && npx vitest run", tools).bypasses).toEqual(["vitest"]);
  });
});

describe("the narrative reading — stats, loops, retries, and what was touched", () => {
  const call = (name: string, input: Record<string, unknown>, line: number): TranscriptEvent => ({
    line,
    kind: "use",
    ts: null,
    id: `t${line}`,
    name,
    input,
    path: typeof input["file_path"] === "string" ? input["file_path"] : "",
  });

  it("counts the work, and cites where the human pushed back", () => {
    const read = narrative(
      [
        { line: 1, kind: "prompt", text: "add the parser" },
        { line: 2, kind: "prompt", text: "no, revert that" },
        call("Write", { file_path: "src/a.ts" }, 3),
        call("Edit", { file_path: "src/a.ts" }, 4),
        call("Read", { file_path: "src/b.ts" }, 5),
        call("Bash", { command: "git commit -m x" }, 6),
      ],
      [],
    );
    expect(read.stats).toMatchObject({ edits: 1, writes: 1, commits: 1 });
    expect(read.prompts.map((p) => p.line)).toEqual([1, 2]);
    expect(read.corrections.map((p) => p.text)).toEqual(["no, revert that"]);
    expect(read.touched).toEqual({ "src/a.ts": 2, "src/b.ts": 1 });
  });

  it("counts a file read through the shell as touched, like a Read", () => {
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", input: { command: "cat src/a.ts src/c.ts" }, path: "", reads: ["src/a.ts", "src/c.ts"] };
    const read = narrative([cat, call("Read", { file_path: "src/a.ts" }, 2)], []);
    expect(read.touched).toEqual({ "src/a.ts": 2, "src/c.ts": 1 });
  });

  it("a file edited five times in a row is a LOOP; four is just work", () => {
    const edits = (n: number): TranscriptEvent[] =>
      Array.from({ length: n }, (_, i) => call("Edit", { file_path: "src/a.ts" }, i + 1));
    expect(narrative(edits(4)).loops).toEqual([]);
    expect(narrative(edits(5)).loops).toEqual([{ path: "src/a.ts", count: 5, from: 1, to: 5 }]);
    // A path outside the repo breaks the run rather than extending it — it is not this tree's file.
    expect(narrative([...edits(3), call("Edit", { file_path: "/tmp/x" }, 9), ...edits(3)]).loops).toEqual([]);
  });

  it("the same command three times is a RETRY, with every line it happened on", () => {
    const runs = Array.from({ length: 3 }, (_, i) => call("Bash", { command: "just test" }, i + 1));
    expect(narrative(runs).retries).toEqual([{ command: "just test", count: 3, lines: [1, 2, 3] }]);
    expect(narrative(runs.slice(0, 2)).retries).toEqual([]);
  });

  it("records a bypass at the site it happened, so the coach reads the line", () => {
    const read = narrative([call("Bash", { command: "npx vitest run" }, 7)], ["vitest"]);
    expect(read.stats.bypasses).toEqual({ vitest: 1 });
    expect(read.bypassSites).toEqual([{ line: 7, tool: "vitest", text: "npx vitest run" }]);
  });

  it("merges several readings into ONE list, each pointer tagged with its own transcript", () => {
    const one = narrative([{ line: 1, kind: "prompt", text: "no, undo it" }, call("Edit", { file_path: "a.ts" }, 2)]);
    const two = narrative([call("Edit", { file_path: "a.ts" }, 3)]);
    const merged = mergeNarratives([
      { session: "s1", read: one },
      { session: "s2", read: two },
    ]);
    expect(merged.stats.edits).toBe(2);
    expect(merged.touched).toEqual({ "a.ts": 2 });
    expect(merged.corrections).toEqual([{ line: 1, text: "no, undo it", session: "s1" }]);
    expect(mergeNarratives([]).stats).toEqual({ edits: 0, writes: 0, shellWrites: 0, shellReads: 0, commits: 0, recipes: {}, bypasses: {} });
  });

  it("counts shell writes from the conversation's own stream, and shell reads from its transcript", () => {
    const cat: TranscriptEvent = { line: 1, kind: "use", ts: null, id: "t1", name: "Bash", input: { command: "cat src/a.ts" }, path: "", reads: ["src/a.ts"] };
    const heredoc = call("Bash", { command: "python3 - <<'EOF'\nopen('src/b.ts','w')\nEOF" }, 2);
    const rows: Row[] = [
      { kind: "tool", tool: "Bash", command: "python3 - <<'EOF'" },
      { kind: "write", tool: "Bash", path: "src/b.ts", change: "modified" },
      { kind: "write", tool: "Bash", path: "src/b.ts", change: "modified" },
      { kind: "write", tool: "Bash", path: "/tmp/outside", change: "created" },
      { kind: "read", tool: "Bash", path: "src/a.ts" },
    ];
    const read = narrative([cat, heredoc], [], rows);
    expect(read.stats).toMatchObject({ edits: 0, writes: 0, shellWrites: 2, shellReads: 1 });
    expect(read.shell).toEqual({ writes: { "src/b.ts": 2 }, reads: { "src/a.ts": 1 } });
    expect(read.touched).toEqual({ "src/a.ts": 1, "src/b.ts": 2 });
    // No stream is no shell writes — the transcript cannot say what a command changed.
    expect(narrative([cat, heredoc]).stats.shellWrites).toBe(0);

    const merged = mergeNarratives([
      { session: "s1", read },
      { session: "s2", read },
    ]);
    expect(merged.stats).toMatchObject({ shellWrites: 4, shellReads: 2 });
    expect(merged.shell).toEqual({ writes: { "src/b.ts": 4 }, reads: { "src/a.ts": 2 } });
  });
});

describe("what the session ran under — the permission mode, and auto mode's steer", () => {
  const attached = (attachment: Record<string, unknown>): string => line({ type: "attachment", attachment });

  it("reads the steer from the LAST auto-mode attachment, and none once auto mode was left", () => {
    const strict = attached({ type: "auto_mode", bashFirst: true, bashFirstSteer: "strict", steerOnly: true });
    const plain = attached({ type: "auto_mode", bashFirst: false, steerOnly: false });
    expect(steerOf([human("hi"), strict].join("\n"))).toEqual({ shellFirst: true, variant: "strict" });
    expect(steerOf([strict, plain].join("\n"))).toEqual({ shellFirst: false, variant: null });
    expect(steerOf([strict, attached({ type: "auto_mode_exit", bashFirst: true })].join("\n"))).toBeNull();
    expect(steerOf([strict, attached({ type: "auto_mode_other" }), "{broken"].join("\n"))).toEqual({ shellFirst: true, variant: "strict" });
    expect(steerOf(human("never in auto mode"))).toBeNull();
    expect(steerOf("")).toBeNull();
  });

  it("the last call that stated a mode is the mode the session is under", () => {
    expect(lastMode([{ kind: "tool", tool: "Edit", mode: "default" }, { kind: "tool", tool: "Bash", mode: "auto" }, { kind: "tool", tool: "Read" }])).toBe("auto");
    expect(lastMode([{ kind: "tool", tool: "Read" }, { kind: "run", mode: "x" }])).toBeNull();
  });

  it("adds up the calls per mode, and how many auto-mode conversations were steered and how", () => {
    const tool = (mode?: string): Row => ({ kind: "tool", tool: "Bash", ...(mode === undefined ? {} : { mode }) });
    expect(
      modesOf([
        { rows: [tool("auto"), tool("auto"), tool()], steer: { shellFirst: true, variant: "strict" } },
        { rows: [tool("default")], steer: null },
        { rows: [], steer: { shellFirst: false, variant: null } },
        { rows: [], steer: { shellFirst: true, variant: null } },
      ]),
    ).toEqual({ calls: { auto: 2, default: 1 }, auto: 3, steered: 2, variants: { strict: 1 } });
  });

  it("adds up where the host's changed-file list disagreed with flow's diff", () => {
    expect(
      mismatchesIn([
        { kind: "mismatch", tool: "Bash", hostOnly: [".env"], flowOnly: ["src/b.ts"] },
        { kind: "mismatch", tool: "Bash", hostOnly: [".env", 3], flowOnly: "nonsense" },
        { kind: "write", path: "x" },
      ]),
    ).toEqual({ calls: 2, hostOnly: { ".env": 2 }, flowOnly: { "src/b.ts": 1 } });
  });
});

describe("weakened after a block — the one failure a guard cannot catch itself", () => {
  it("watches the host's registrations, and takes the repo's half whole from the surface", () => {
    // Two halves, and only one of them is this test's. That the repo half FOLLOWS the config's own
    // imports is `configSurface`'s claim and is proved where it is made, further down this file;
    // `guardPaths` does nothing but concatenate, so re-proving the derivation here would be a
    // second place for the same fact to be right and a first place for it to disagree.
    const paths = guardPaths(`import { house } from "./rules/house.ts";`);
    expect(paths).toStrictEqual([...configSurface(`import { house } from "./rules/house.ts";`), ...HOST_SURFACE]);

    // The config's name is spelled ONCE — a second copy here would leave a renamed config's old
    // name watched and its new one not.
    expect(paths).toContain(CONFIG_FILE);
    expect(CONFIG_FILE).toBe("flow.config.ts");
    expect(isGuardPath("flow.config.ts", paths)).toBe(true);
    expect(isGuardPath("src/a.ts", paths)).toBe(false);
    expect(isGuardPath("", paths)).toBe(false);

    // The host's half is fixed, because those are the harness's file names and not a repo's, and it
    // is matched at any depth: a monorepo package carries its own `.claude/`.
    expect(isGuardPath(".claude/settings.json", guardPaths(null))).toBe(true);
    expect(isGuardPath("packages/app/.claude/settings.json", paths)).toBe(true);
    expect(isGuardPath(".claude/agents/builder.md", paths)).toBe(true);
  });

  it("flags the guardrail edit that followed a block, citing both ends and the gap", () => {
    const rows: Row[] = [
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "deny" },
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "allow" },
    ];
    const events: TranscriptEvent[] = [
      { line: 4, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "a", name: "Edit", input: {}, path: "flow.config.ts" },
      { line: 9, kind: "use", ts: "2026-01-01T10:00:30.000Z", id: "b", name: "Edit", input: {}, path: "flow.config.ts" },
      { line: 11, kind: "use", ts: "2026-01-01T10:01:00.000Z", id: "c", name: "Edit", input: {}, path: "src/a.ts" },
    ];
    // The edit BEFORE the block is not a weakening, and neither is one to an ordinary file.
    const paths = guardPaths(null);
    expect(weakenedAfterBlock(rows, events, paths)).toEqual([{ entry: "core.noTodo", line: 9, path: "flow.config.ts", gapSeconds: 30 }]);
    expect(weakenedAfterBlock(rows, [], paths)).toEqual([]);
    expect(weakenedAfterBlock([], events, paths)).toEqual([]);
  });
});

describe("selecting which conversations a run covers", () => {
  const at = (id: string, over: Partial<Candidate> = {}): Candidate => ({
    id,
    bytes: 100,
    mtimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
    started: null,
    branch: null,
    ...over,
  });

  const newest = at("new", { started: "2026-03-01T00:00:00.000Z" });
  const middle = at("mid", { started: "2026-02-01T00:00:00.000Z", bytes: 900 });
  const oldest = at("old", { started: "2026-01-01T00:00:00.000Z" });

  it("subtracts what is already done, and orders newest first", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(["mid"]));
    expect(picked.analyse.map((c) => c.id)).toEqual(["new", "old"]);
    expect(picked.counts).toEqual({ backlog: 2, analysed: 2, excluded: 0 });
  });

  it("orders heaviest-first when asked — wasted effort concentrates in the big conversations", () => {
    expect(selectSessions([oldest, newest, middle], new Set(), { largest: true }).analyse.map((c) => c.id)).toEqual([
      "mid",
      "new",
      "old",
    ]);
  });

  it("a limit DEFERS rather than drops, so a capped run cannot declare skipped history done", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { limit: 1 });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded).toEqual([
      { id: "mid", reason: "limit" },
      { id: "old", reason: "limit" },
    ]);
    expect(selectSessions([oldest, newest], new Set(), { limit: 1, all: true }).analyse).toHaveLength(2);
  });

  it("a date floor defers everything older, naming each one", () => {
    const picked = selectSessions([oldest, newest, middle], new Set(), { since: Date.parse("2026-02-15T00:00:00.000Z") });
    expect(picked.analyse.map((c) => c.id)).toEqual(["new"]);
    expect(picked.excluded.map((e) => e.reason)).toEqual(["since", "since"]);
  });

  it("falls back to the file's own mtime when the conversation never stamped a start", () => {
    const dated = at("dated", { started: null, mtimeMs: Date.parse("2026-05-01T00:00:00.000Z") });
    expect(selectSessions([newest, dated], new Set()).analyse[0]?.id).toBe("dated");
  });
});

describe("the health line above every number", () => {
  it("an unarmed record BLOCKS the reading rather than reporting zeroes", () => {
    const said = health({ armed: false, rows: 0, withRecord: 0, analysed: 3 });
    expect(said.blocked).toContain("NOT ARMED");
    expect(said.warn).toEqual([]);
  });

  it("armed but silent for what was read is a warning, not a verdict", () => {
    expect(health({ armed: true, rows: 0, withRecord: 1, analysed: 1 }).warn[0]).toContain("holds no events");
    expect(health({ armed: true, rows: 0, withRecord: 0, analysed: 2 }).warn[0]).toContain("narrative only");
    expect(health({ armed: true, rows: 12, withRecord: 1, analysed: 1 })).toEqual({ blocked: null, warn: [] });
  });
});

describe("the reading — the join, the coverage answer, and the lines a person reads", () => {
  const bound: Bound[] = [
    { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["write"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    { kind: "guardrail", id: "core.off", pack: "core", at: ["write"], on: ["docs/**"], for: [], description: null, says: null, disabled: "superseded" },
  ];

  it("joins a subagent's two host-written records, and keeps what only one of them knows", () => {
    const spawns = new Map([
      ["toolu_9", { toolUseId: "toolu_9", asked: "general-purpose", description: "Build F5", ts: "2026-01-01T10:00:00.000Z", line: 12 }],
    ]);
    // A builder hidden inside a generic bucket: the parent CLAIMED general-purpose, the host WROTE
    // builder, and only one of those is evidence.
    expect(
      joinSpawn({ session: "s1", agent: "agent-1", meta: spawnMeta('{"agentType":"builder","toolUseId":"toolu_9","model":"opus"}'), spawns }),
    ).toEqual({
      session: "s1",
      agent: "agent-1",
      agentType: "builder",
      description: "Build F5",
      model: "opus",
      asked: "general-purpose",
      at: "2026-01-01T10:00:00.000Z",
      line: 12,
    });

    // No sidecar at all: spawned, as what we cannot say — and nothing is invented to fill it.
    expect(joinSpawn({ session: "s1", agent: "agent-2", meta: null, spawns })).toEqual({
      session: "s1",
      agent: "agent-2",
      agentType: null,
      description: null,
      model: null,
      asked: null,
      at: null,
      line: null,
    });

    // A sidecar whose id names no block in the parent: what it alone knows still crosses.
    const orphan = joinSpawn({ session: "s1", agent: "agent-3", meta: spawnMeta('{"agentType":"verifier","toolUseId":"toolu_x"}'), spawns });
    expect(orphan).toMatchObject({ agentType: "verifier", asked: null, line: null });
  });

  it("answers coverage from the TRANSCRIPT, which reaches conversations the record cannot", () => {
    expect(uncoveredAreas({ "src/a.ts": 3, "docs/x.md": 9, "README.md": 1 }, bound)).toEqual([
      // `docs/**` is watched by an entry that is TURNED OFF, so it is not watched.
      { path: "docs/x.md", touches: 9 },
      { path: "README.md", touches: 1 },
    ]);
    expect(uncoveredAreas({}, bound)).toEqual([]);
  });
});

describe("formatFacts — the whole of what a person sees", () => {
  const empty = (over: Partial<Facts> = {}): Facts => ({
    root: "/repo",
    store: { dir: "/home/.claude/projects/-repo", exists: true, ignored: [] },
    selection: { analyse: [], excluded: [], counts: { backlog: 0, analysed: 0, excluded: 0 } },
    coverage: { analysed: 0, withRecord: 0, narrativeOnly: 0 },
    health: { blocked: null, warn: [] },
    metrics: metrics({ sessions: [], entries: [], nowMs: 0 }),
    moments: momentsView([], null),
    terrain: [],
    narrative: mergeNarratives([]),
    uncovered: [],
    actors: [],
    weakened: [],
    modes: modesOf([]),
    mismatches: mismatchesIn([]),
    marked: null,
    ...over,
  });

  it("leads with the fail-loud header — an unarmed record is never presented as a calm week", () => {
    const lines = formatFacts(empty({ health: { blocked: "the record is NOT ARMED", warn: ["and a caveat"] } }));
    expect(lines[0]).toBe("✗ the record is NOT ARMED");
    expect(lines[1]).toBe("⚠ and a caveat");
  });

  it("says a thin history is thin, rather than letting a zero read as a verdict", () => {
    expect(formatFacts(empty()).join("\n")).toContain("too thin to call anything dead");
    expect(formatFacts(empty()).join("\n")).toContain("nothing measurable yet");
    expect(formatFacts(empty({ store: { dir: "/nowhere", exists: false, ignored: [] } })).join("\n")).toContain("no store at /nowhere");
  });

  it("prints the record's own verdicts — the gap list, and each of the three silences", () => {
    const bound: Bound[] = [
      { kind: "guardrail", id: "core.fiction", pack: "core", at: ["commit"], on: ["changelog/**"], for: [], description: null, says: null, disabled: null },
    ];
    const ampleRows: Row[] = [
      { kind: "run", ts: "2026-01-01T00:00:00.000Z", moment: "commit", rules: [{ id: "core.fiction", evaluated: 0, hits: 0, silenced: 0 }] },
      { kind: "tool", ts: "2026-02-05T00:00:00.000Z", tool: "Edit", path: "docs/x.md", edit: true },
    ];
    const text = formatFacts(
      empty({ metrics: metrics({ sessions: [{ session: "s1", rows: ampleRows }], entries: bound, nowMs: Date.parse("2026-03-01T00:00:00.000Z") }) }),
    ).join("\n");
    expect(text).toContain("gap       docs — 1 edit, nothing watches it");
    expect(text).toContain("dead      core.fiction");
    expect(text).toContain("retire    core.fiction — bound, never once reached");
  });

  it("counts the shell's writes and reads beside the edits, and lists their paths", () => {
    const writes: Record<string, number> = { "src/a.ts": 3, "src/b.ts": 1, "c/1": 1, "c/2": 1, "c/3": 1, "c/4": 1 };
    const narrativeWith = { ...mergeNarratives([]), stats: { ...mergeNarratives([]).stats, shellWrites: 8, shellReads: 1 }, shell: { writes, reads: { "src/c.ts": 1 } } };
    const text = formatFacts(empty({ narrative: narrativeWith })).join("\n");
    expect(text).toContain("0 edits · 0 writes · 8 shell writes · 1 shell reads · 0 commits");
    expect(text).toContain("  shell     wrote src/a.ts 3× · c/1 · c/2 · c/3 · c/4 · …and 1 more");
    expect(text).toContain("  shell     read src/c.ts");
    expect(formatFacts(empty()).join("\n"), "nothing through the shell is no path line").not.toContain("  shell ");
  });

  it("names the permission modes and whether auto mode steered towards shell edits", () => {
    const one = formatFacts(empty({ modes: { calls: { default: 1, auto: 40 }, auto: 2, steered: 1, variants: { strict: 1 } } })).join("\n");
    expect(one).toContain("  mode      auto 40 calls · default 1 call — 1 of 2 auto-mode conversations steered towards shell edits (strict 1)");
    expect(formatFacts(empty({ modes: { calls: { default: 3 }, auto: 0, steered: 0, variants: {} } }))).toContain("  mode      default 3 calls");
    expect(formatFacts(empty({ modes: { calls: {}, auto: 1, steered: 0, variants: {} } })).join("\n")).toContain(
      "  mode      no call recorded a mode — 0 of 1 auto-mode conversation steered towards shell edits",
    );
    expect(formatFacts(empty()).join("\n")).not.toContain("  mode ");
  });

  it("flags where Claude Code's own changed-file list disagreed with flow's diff", () => {
    const text = formatFacts(empty({ mismatches: { calls: 2, hostOnly: { ".env": 2 }, flowOnly: { "src/b.ts": 1 } } })).join("\n");
    expect(text).toContain("⚠ Claude Code's changed-file list disagreed with flow's diff on 2 calls — only Claude Code listed .env 2× — only flow's diff held src/b.ts");
    expect(formatFacts(empty({ mismatches: { calls: 1, hostOnly: {}, flowOnly: { x: 1 } } })).join("\n")).toContain("on 1 call — only flow's diff held x");
    expect(formatFacts(empty()).join("\n")).not.toContain("disagreed");
  });

  it("names an entry that used to catch things and stopped", () => {
    const bound: Bound[] = [
      { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["write"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    ];
    const rows: Row[] = [
      { kind: "run", ts: "2026-01-01T00:00:00.000Z", moment: "write", rules: [{ id: "core.noTodo", evaluated: 1, hits: 1, silenced: 0 }] },
      { kind: "guardrail", ts: "2026-01-01T00:00:00.000Z", moment: "write", id: "core.noTodo", out: "deny", subject: "src/a.ts" },
      { kind: "run", ts: "2026-02-05T00:00:00.000Z", moment: "write", rules: [] },
    ];
    const text = formatFacts(
      empty({ metrics: metrics({ sessions: [{ session: "s1", rows }], entries: bound, nowMs: Date.parse("2026-03-01T00:00:00.000Z") }) }),
    ).join("\n");
    expect(text).toContain("quiet     core.noTodo (59d)");
  });

  it("prints every finding that only fires when something is wrong", () => {
    const read = empty({
      uncovered: [{ path: "skills/work/modes/build.md", touches: 30 }],
      actors: [{ session: "s1", agent: "a1", agentType: "builder", description: "Build F5", model: null, asked: "general-purpose", at: null, line: 3 }],
      weakened: [{ entry: "core.noTodo", line: 88, path: "flow.config.ts", gapSeconds: 42 }],
      marked: 2,
    });
    const text = formatFacts(read).join("\n");
    expect(text).toContain("unwatched skills/work/modes/build.md — touched 30×, no entry reaches it");
    // The spawn's two records disagree, and the line says so rather than picking one silently.
    expect(text).toContain("actor     builder (spawned as general-purpose) — Build F5");
    expect(text).toContain("⚠ the guard was edited after core.noTodo refused — flow.config.ts:L88, 42s later");
    expect(text).toContain("marked    2 conversation(s) read");
  });

  it("caps the headline lists and says how many it did not print", () => {
    const actor = (n: number): SpawnRecord => ({
      session: "s1",
      agent: `a${n}`,
      agentType: "builder",
      description: null,
      model: null,
      asked: "builder",
      at: null,
      line: null,
    });
    const text = formatFacts(empty({ actors: [1, 2, 3, 4, 5, 6, 7].map(actor) })).join("\n");
    expect(text.match(/actor {5}builder/g)).toHaveLength(5);
    expect(text).toContain("…and 2 more");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRODUCT SURFACE — what `flow init` writes, and what `flow status` says
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// Both verbs are decisions about the world rather than reads of it: what to write given what is
// already there, and what to SAY given what loaded. The shell next door (product.ts) stats, writes
// and spawns; every branch below is asserted here, where it costs a millisecond.

describe("the config load's one fault sentence", () => {
  it("turns a type-stripping parse error into the machine fact it really is", () => {
    const said = configLoadFault("flow.config.ts", "Unexpected token ':'", "22.4.0");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(`Node >= ${NODE_FLOOR}`);
    expect(said).toContain("22.4.0");
    expect(said, "the original is kept — the rewrite adds a cause, it does not hide one").toContain(
      "Unexpected token",
    );
  });

  it("leaves an ordinary failure alone — a missing import is not a version problem", () => {
    const said = configLoadFault("flow.config.ts", "Cannot find package 'left-pad'", "24.1.0");
    expect(said).toContain("Cannot find package 'left-pad'");
    expect(said).not.toContain(`Node >= ${NODE_FLOOR}`);
  });
});

describe("which modules flow strips and evaluates itself", () => {
  const url = (path: string): string => `file://${path}`;

  it("takes the guarded repo's own TypeScript — the config, and what it imports", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/guards/house.ts"))).toBe(true);
  });

  it("leaves node_modules alone, because node refuses to strip there and that refusal is not flow's to overrule", () => {
    expect(loadsAsStrippedModule(url("/repo/node_modules/some-pkg/index.ts"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/node_modules/@scope/pkg/deep/src/x.ts"))).toBe(false);
  });

  it("leaves everything that is not a .ts file, declarations included", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.js"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/flow.config.mjs"))).toBe(false);
    expect(loadsAsStrippedModule(url("/repo/types/x.d.ts")), "types all the way down, evaluating to nothing").toBe(false);
  });

  it("answers only for file urls — an http or data specifier is nothing flow put there", () => {
    expect(loadsAsStrippedModule("data:text/typescript,export default 1")).toBe(false);
    expect(loadsAsStrippedModule("https://example.com/config.ts")).toBe(false);
    expect(loadsAsStrippedModule("node:fs")).toBe(false);
  });

  it("reads past a query or a fragment, which a cache-busting import adds", () => {
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts?v=2"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/flow.config.ts#frag"))).toBe(true);
    expect(loadsAsStrippedModule(url("/repo/x.js?name=y.ts")), "the query is not the extension").toBe(false);
  });
});

describe("the hook registrations flow writes", () => {
  it("names exactly the events it answers — five, and Notification is not one", () => {
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"]);
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).not.toContain("Notification");
  });

  it("registers each event once — two registrations on one event fire twice", () => {
    expect(new Set(HOOK_REGISTRATIONS.map((r) => r.event)).size).toBe(HOOK_REGISTRATIONS.length);
  });

  it("commands a word this build answers to — the list is derived, so it cannot name one it doesn't", () => {
    for (const registration of HOOK_REGISTRATIONS)
      expect(ourHookCommand(registration.command), registration.command).toBe(true);
    expect(HOOK_REGISTRATIONS.map((r) => r.command)).toContain("flow hook session-start");
  });

  it("recognises its own registration whatever path stands in front of the binary", () => {
    expect(ourHookCommand("flow hook stop")).toBe(true);
    expect(ourHookCommand("/usr/local/bin/flow hook pre-tool-use")).toBe(true);
    expect(ourHookCommand("node /x/flow/dist/flow.mjs hook stop")).toBe(true);
    expect(ourHookCommand("work hook stop"), "the old engine's, and not ours to touch").toBe(false);
    expect(ourHookCommand("flow hook nonsense"), "a word we do not answer to").toBe(false);
    expect(ourHookCommand("myflow hook stop")).toBe(false);
  });

  it("adds every event to a settings file that has none, leaving the rest of it alone", () => {
    const before = { permissions: { allow: ["Bash(git:*)"] } };
    const { settings, added } = withRegistrations(before);
    expect(added).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"]);
    const after = settings as { permissions: unknown; hooks: Record<string, unknown[]> };
    expect(after.permissions, "untouched, byte for byte").toEqual(before.permissions);
    expect(registeredEvents(settings)).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"]);
    expect(after.hooks["Stop"]).toEqual([{ hooks: [{ type: "command", command: "flow hook stop" }] }]);
    expect(after.hooks["PreToolUse"]?.[0]).toMatchObject({ matcher: "*" });
  });

  it("adds nothing on a second run — the whole of what makes init idempotent", () => {
    const once = withRegistrations({});
    const twice = withRegistrations(once.settings);
    expect(twice.added).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
  });

  it("keeps a stranger's registration on the same event and stands beside it", () => {
    const theirs = { hooks: { Stop: [{ hooks: [{ type: "command", command: "their-tool --report" }] }] } };
    const { settings, added } = withRegistrations(theirs);
    expect(added).toContain("Stop");
    const stop = (settings as { hooks: Record<string, unknown[]> }).hooks["Stop"];
    expect(JSON.stringify(stop), "theirs survives — we add, we never rewrite").toContain("their-tool --report");
    expect(JSON.stringify(stop)).toContain("flow hook stop");
  });

  it("asks for every tool after the call, succeeded or failed — any tool can change the tree", () => {
    const matcher = (event: string): string | undefined => HOOK_REGISTRATIONS.find((r) => r.event === event)?.matcher;
    expect(matcher("PostToolUse")).toBe("*");
    expect(matcher("PostToolUseFailure")).toBe("*");
    expect(HOOK_REGISTRATIONS.find((r) => r.event === "PostToolUseFailure")?.command).toBe("flow hook post-tool-use-failure");
  });

  it("widens its OWN narrow registration in place, and says so — a second entry would fire twice", () => {
    const older = {
      hooks: {
        ...(withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks,
        PostToolUse: [
          { matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --after" }] },
        ],
      },
    };
    expect(staleRegistrations(older)).toEqual(["PostToolUse"]);
    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(["PostToolUse (widened to every tool)"]);
    const post = (settings as { hooks: Record<string, unknown[]> }).hooks["PostToolUse"];
    expect(post).toEqual([
      { matcher: "*", hooks: [{ type: "command", command: "flow hook post-tool-use" }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --after" }] },
    ]);
    expect(staleRegistrations(settings), "and a second run finds nothing to widen").toEqual([]);
    expect(withRegistrations(settings).added).toEqual([]);
  });

  it("reads nothing out of a settings file that is not an object", () => {
    expect(registeredEvents(null)).toEqual([]);
    expect(registeredEvents("nonsense")).toEqual([]);
    expect(registeredEvents({ hooks: { Stop: "not an array" } })).toEqual([]);
  });
});

describe("the git gate flow arms", () => {
  it("calls the binary's own commit verb over the staged set", () => {
    expect(PRE_COMMIT).toContain("flow commit");
    expect(PRE_COMMIT.startsWith("#!")).toBe(true);
  });

  it("names one hooks directory, and one gate inside it", () => {
    expect(GATE_PATH).toBe(`${HOOKS_DIR}/pre-commit`);
    expect(SET_HOOKS_PATH, "the report's line and the fitting's fix are one sentence").toContain(HOOKS_DIR);
    expect(PRE_COMMIT, "the hook's own comment tells you what arms it").toContain(SET_HOOKS_PATH);
  });

  it("recognises a gate that runs flow, and one that runs something else", () => {
    expect(armsFlow(PRE_COMMIT)).toBe(true);
    expect(armsFlow('#!/bin/sh\nwork guard commit "$@"\n'), "the old engine's gate").toBe(false);
    expect(armsFlow(null)).toBe(false);
  });
});

describe("the scaffolded config", () => {
  it("is a readable demo: the four ruled entries, a category, and one pack", () => {
    const demo = scaffold(false);
    expect(demo).toContain('from "@jawache/flow"');
    expect(demo).toContain("definePack");
    expect(demo).toContain("defineCategory");
    expect(demo).toContain("--force");
    expect(demo).toContain("subagent");
    expect(demo.split("\n").length, "one screen — the whole claim of the demo").toBeLessThan(80);
  });

  it("never contains the marker its own gate refuses — a config that blocks itself", () => {
    // The gate greps staged content for a marker, and the config is a staged file. Spelled whole it
    // would refuse the commit that added it, which is the exact self-reference this demo is here to
    // teach: the entry builds the word rather than writing it.
    expect(scaffold(false)).not.toContain("DO-NOT-COMMIT");
  });

  it("is an empty config, and nothing else, when asked for one", () => {
    const bare = scaffold(true);
    expect(bare).toContain("defineConfig([])");
    expect(bare).not.toContain("definePack");
  });
});

// ── init ─────────────────────────────────────────────────────────────────────

const bare: InitFacts = {
  root: "/repo",
  empty: false,
  isGit: true,
  hasConfig: false,
  gateText: null,
  hasFlowDir: false,
  hooksPath: null,
  settingsPath: "/home/.claude/settings.json",
  settings: {},
  settingsUnreadable: false,
  resolves: false,
  packageRoot: "/checkout/flow",
};

describe("planInit — a repo that has never heard of flow", () => {
  const plan = planInit(bare);

  it("writes the config, the gate, the state directory and the link", () => {
    expect(plan.config?.path).toBe("flow.config.ts");
    expect(plan.gate?.path).toBe(GATE_PATH);
    expect(plan.flowDir).toBe(true);
    expect(plan.link).toBe("/checkout/flow");
    expect(plan.hooksPath).toBe(true);
    expect(plan.registered).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"]);
  });

  it("reports every write, and nothing it did not do", () => {
    const said = initLines(plan, []).join("\n");
    expect(said).toContain("flow.config.ts");
    expect(said).toContain(GATE_PATH);
    expect(said).toContain(".flow/");
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow status");
  });
});

describe("planInit — the second run", () => {
  const already = planInit({
    ...bare,
    hasConfig: true,
    gateText: PRE_COMMIT,
    hasFlowDir: true,
    hooksPath: HOOKS_DIR,
    resolves: true,
    settings: withRegistrations({}).settings,
  });

  it("adds nothing at all", () => {
    expect(already.config).toBeNull();
    expect(already.gate).toBeNull();
    expect(already.flowDir).toBe(false);
    expect(already.link).toBeNull();
    expect(already.hooksPath).toBe(false);
    expect(already.settings).toBeNull();
    expect(already.registered).toEqual([]);
  });

  it("says so in one line rather than printing an empty list", () => {
    expect(initLines(already, []).join("\n")).toContain("already set up");
  });
});

describe("planInit — a repo that already has a pre-commit hook", () => {
  const theirs = planInit({ ...bare, gateText: "#!/bin/sh\nnpm test\n" });

  it("NEVER overwrites it, and says what to add by hand", () => {
    expect(theirs.gate).toBeNull();
    const said = initLines(theirs, []).join("\n");
    expect(said).toContain("kept");
    expect(said, "the same instruction status gives, in the same words").toContain(ADD_THE_GATE_LINE);
  });
});

describe("the config surface — what a write may target while the guard is broken", () => {
  // The config as this repo writes it, and as a broken one still reads: the imports survive
  // whatever went wrong two hundred lines below them.
  const CONFIG = [
    `import { defineConfig, pack } from "@jawache/flow";`,
    `import { git, work } from "@jawache/flow/packs";`,
    `import { house } from "./guards/house.ts";`,
    ``,
    `export default defineConfig([pack(git), pack(house)]);`,
  ].join("\n");

  it("is the config and the packs it imports, and nothing else", () => {
    const surface = configSurface(CONFIG);
    expect(matchAny(CONFIG_FILE, surface)).toBe(true);
    expect(matchAny("guards/house.ts", surface)).toBe(true);
    expect(matchAny("guards/git.ts", surface), "the folder comes with the file").toBe(true);
    expect(matchAny("guards/nested/deep.ts", surface)).toBe(true);
    expect(matchAny("src/a.ts", surface)).toBe(false);
    expect(matchAny("cli/work.ts", surface)).toBe(false);
    // Not a suffix match: a file that merely ENDS with the config's name is somebody else's.
    expect(matchAny("vendor/flow.config.ts", surface)).toBe(false);
    expect(matchAny("src/guards/thing.ts", surface), "the folder is where the import said").toBe(false);
  });

  it("follows whatever the repo called the folder, and reaches nothing when the config names nothing", () => {
    // The whole point of reading the text: `guards/` was one repo's name for it, and every other
    // repo got a repair exception over a folder it does not have.
    const theirs = configSurface(`import { house } from "./.guard/house.ts";`);
    expect(matchAny(".guard/house.ts", theirs)).toBe(true);
    expect(matchAny(".guard/helpers/text.ts", theirs)).toBe(true);
    expect(matchAny("guards/house.ts", theirs)).toBe(false);
    // A config with every rule written inline imports no pack, so the surface is the config alone.
    const inline = configSurface(`import { defineConfig } from "@jawache/flow";`);
    expect([...inline]).toStrictEqual([CONFIG_FILE]);
    expect([...configSurface(null)]).toStrictEqual([CONFIG_FILE]);
  });

  it("reads the TEXT, not the module — which is the only reader a broken config has", () => {
    // Package specifiers are somebody else's source and never repairable here; `../` climbs out
    // of the root, where a repo-relative surface cannot follow.
    expect(configImports(CONFIG)).toStrictEqual(["guards/house.ts"]);
    expect(configImports(`import x from "../outside/y.ts";`)).toStrictEqual([]);
    expect(configImports(`const m = await import("./late/pack.ts");`)).toStrictEqual(["late/pack.ts"]);
    expect(configImports(`export { a } from "./again.ts";\nimport { b } from "./again.ts";`)).toStrictEqual(["again.ts"]);
    // The file below is not typescript at all any more, and its import line still answers.
    expect(configImports(`import { house } from "./guards/house.ts";\nthis is not typescript(((`)).toStrictEqual([
      "guards/house.ts",
    ]);
    // A `from '…'` phrase inside a QUOTED MESSAGE is harvested too, and that is the accepted
    // behaviour rather than a miss: separating a real import from a sentence that quotes one takes
    // a parser, and the file being asked about is the one that will not parse. Pinned here because
    // it only ever WIDENS the repair surface, and only while the config is already refusing every
    // other write — so the cost is one extra repairable path at a moment when nothing can commit.
    expect(configImports(`.message("write it as: import { x } from './guards/x.ts'")`)).toStrictEqual(["guards/x.ts"]);
  });
});

describe("what every rail answers while the config will not load", () => {
  const SURFACE = ["flow.config.ts", "guards/house.ts", "guards/**"];
  const FAULT = "flow: the config will not load — 1 refusal.";
  const write = (path: string): AdapterEvent => ({ rail: "guard", moment: "write", file: { path, content: "x" } });

  describe("repairs — the exception is exactly as wide as the repair", () => {
    it("is the config and the packs it imports, at a write or a delete", () => {
      expect(repairs(write("flow.config.ts"), SURFACE)).toBe(true);
      expect(repairs(write("guards/house.ts"), SURFACE)).toBe(true);
      expect(repairs(write("guards/nested/helper.ts"), SURFACE), "the folder comes with the file").toBe(true);
      expect(repairs({ rail: "guard", moment: "delete", file: { path: "flow.config.ts", content: "" } }, SURFACE)).toBe(true);
    });

    it("is nothing else — not another file, not a command, not a rail without a target", () => {
      expect(repairs(write("src/a.ts"), SURFACE)).toBe(false);
      // A command names a STRING, never a target: `sed -i` on the config reads exactly like
      // `rm -rf` before either runs, so the command rail stays fully shut in the broken state.
      expect(repairs({ rail: "guard", moment: "command", command: "sed -i s/x/y/ flow.config.ts" }, SURFACE)).toBe(false);
      expect(repairs({ rail: "guard", moment: "commit", staged: ["flow.config.ts"] }, SURFACE)).toBe(false);
      expect(repairs({ rail: "brief", moment: "touch", path: "flow.config.ts" }, SURFACE)).toBe(false);
    });
  });

  describe("whileBroken — one answer, whichever way it broke", () => {
    it("refuses every gated moment but the repair, and hands the fault to a breadcrumb rail", () => {
      const answer = whileBroken(
        [write("src/a.ts"), write("flow.config.ts"), { rail: "brief", moment: "session" }],
        SURFACE,
        FAULT,
      );
      expect(answer.refused.map((r) => r.moment), "the repair is not among them").toStrictEqual(["write"]);
      expect(answer.refused[0]?.block.message).toBe(FAULT);
      expect(answer.refused[0]?.block.entry, "the guard itself refused, not a rule").toBeNull();
      expect(answer.shown.map((s) => s.body), "a breadcrumb rail has no rail to refuse with").toStrictEqual([FAULT]);
      expect(answer.told).toBeNull();
    });

    it("tells turn-end rather than holding it, which is the only rail that changes", () => {
      const answer = whileBroken([{ rail: "guard", moment: "turn-end", turn: [] }], SURFACE, FAULT);
      expect(answer.refused, "a held turn cannot hand back to the human who would fix it").toStrictEqual([]);
      expect(answer.told, "and it is not silent either").toBe(FAULT);
    });

    it("says nothing at all when the payload carried no rail", () => {
      const answer = whileBroken([], SURFACE, FAULT);
      expect(answer).toStrictEqual({ refused: [], shown: [], told: null });
    });
  });

  describe("statusCode — one code for a config that will not load, however it broke", () => {
    // 2 is "your guard cannot run", 1 is "your guard is not fully in force". A config the GRAMMAR
    // refused used to answer 1 while one that would not IMPORT answered 2 — the same fact under two
    // codes, and a setup script reading the split got a different answer for the same outage.
    const answer = (over: Partial<Status>): Status => ({ ...status(statusFacts({})), ...over });

    it("is 2 for any refusal list, green or not", () => {
      expect(statusCode(answer({ refusals: [{ code: "missing-mandatory", entry: "demo.x", detail: "`demo.x` never said .message(…)" }], green: false }))).toBe(2);
    });

    it("is 0 when green and 1 when merely not in force", () => {
      expect(statusCode(answer({ refusals: [], green: true }))).toBe(0);
      expect(statusCode(answer({ refusals: [], green: false }))).toBe(1);
    });
  });
});

describe("planInit — the flags and the edges", () => {
  it("--empty scaffolds the bare config and the same wiring", () => {
    const plan = planInit({ ...bare, empty: true });
    expect(plan.config?.body).toContain("defineConfig([])");
    expect(plan.gate?.path).toBe(GATE_PATH);
  });

  it("arms no git gate outside a git repo, and says why", () => {
    const plan = planInit({ ...bare, isGit: false });
    expect(plan.gate).toBeNull();
    expect(plan.hooksPath).toBe(false);
    expect(initLines(plan, []).join("\n")).toContain("not a git repo");
  });

  it("links nothing when @jawache/flow already resolves — an installed package is not ours to shim", () => {
    expect(planInit({ ...bare, resolves: true }).link).toBeNull();
  });

  it("plans no link at all when the shell could not find its own package", () => {
    const plan = planInit({ ...bare, packageRoot: null });
    expect(plan.link, "not an empty path the shell would go on to symlink to nowhere").toBeNull();
    const said = initLines(plan, []).join("\n");
    expect(said, "and nothing is reported that was never done").not.toContain("node_modules/@jawache/flow");
    expect(said, "the rest of the setup still happened").toContain("flow.config.ts");
  });

  it("carries a failure the shell hit into the report rather than swallowing it", () => {
    expect(initLines(planInit(bare), [`could not write ${GATE_PATH}: EACCES`]).join("\n")).toContain("EACCES");
  });

  // The near-miss the crossing found, one branch from happening: a real settings.json holding
  // JSONC comments parsed to null, which reads identically to "there is no settings file" — and
  // the next line builds a NEW object holding five registrations and nothing else.
  it("registers NOTHING into a settings file it could not parse, and never writes over it", () => {
    const plan = planInit({ ...bare, settings: null, settingsUnreadable: true });
    expect(plan.settings, "no write is planned against bytes nobody parsed").toBeNull();
    expect(plan.registered).toStrictEqual([]);
    const said = initLines(plan, []).join("\n");
    expect(said).toContain("/home/.claude/settings.json");
    expect(said).toContain("not valid JSON");
    expect(said, "and it says the consequence rather than only the cause").toContain("no rail fires");
  });

  it("still creates a settings file that is simply ABSENT — the other silence", () => {
    const plan = planInit({ ...bare, settings: null, settingsUnreadable: false });
    expect(plan.settings?.path).toBe("/home/.claude/settings.json");
    expect(plan.registered.length, "all five events flow registers").toBe(5);
  });
});

// ── status ───────────────────────────────────────────────────────────────────

const noteAtTurnEnd = { kind: "breadcrumb", at: ["turn-end"], text: "late" } as const;

const statusFacts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  root: "/repo",
  version: "1.2.3",
  off: false,
  configPath: "/repo/flow.config.ts",
  hasConfig: true,
  load: { ok: true, entries: [] },
  gateText: PRE_COMMIT,
  hooksPath: HOOKS_DIR,
  settingsPath: "/home/.claude/settings.json",
  settings: withRegistrations({}).settings,
  grammars: [],
  session: null,
  ignored: [],
  snapshotInclude: [],
  ...over,
});

describe("the grammar fitting", () => {
  it("says nothing at all when the config declares no grammar", () => {
    expect(status(statusFacts()).fittings.map((f) => f.id)).not.toContain("grammars");
  });

  it("is green when every declared library is built, and names them", () => {
    const green = status(statusFacts({ grammars: [{ name: "astro", libraryPath: "/repo/grammars/astro.dylib", present: true }] }));
    const fitting = green.fittings.find((f) => f.id === "grammars");
    expect(fitting?.ok).toBe(true);
    expect(fitting?.detail).toContain("astro");
    expect(green.green).toBe(true);
  });

  // THE RED LINE, and the whole reason the fitting exists: a declared grammar whose library is not
  // there is a repo where every rule on that language refuses. Green there would be the exact lie
  // this package was written to delete — a rule that loads, reports armed, and checks nothing.
  it("is a red line naming the FILE when a declared library is missing", () => {
    const red = status(statusFacts({ grammars: [{ name: "astro", libraryPath: "/repo/grammars/astro.dylib", present: false }] }));
    const fitting = red.fittings.find((f) => f.id === "grammars");
    expect(fitting?.ok).toBe(false);
    // The same sentence the resolver gives when a rule on that language is reached — pinned at both
    // ends, because two accounts of one fact is how the worse one survives.
    expect(fitting?.detail).toBe(missingGrammarText("astro", "/repo/grammars/astro.dylib"));
    expect(red.green).toBe(false);
  });
});

/** One loaded entry, as the load hands it over — the shape `status` reads. */
const loaded = (id: string, spec: Record<string, unknown>, categories: readonly string[] = []) => ({
  id,
  pack: id.split(".")[0] as string,
  key: id.split(".").slice(1).join("."),
  spec: spec as never,
  source: {},
  categories,
  phases: [],
});

describe("status — the whole answer", () => {
  it("is green over a fitted repo, and says the guard is on", () => {
    const s = status(statusFacts());
    expect(s.green).toBe(true);
    expect(s.fittings.every((f) => f.ok)).toBe(true);
    expect(statusLines(s)[0]).toContain("flow is ON");
  });

  it("lists every entry by moment, with its globs and the category it binds to", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.noTodo", { kind: "guardrail", at: ["write", "commit"], on: ["src/**"], message: "no" }),
            loaded("demo.onlySubagents", { kind: "guardrail", at: ["commit"], message: "no" }, ["subagent"]),
          ],
        },
      }),
    );
    const said = statusLines(s).join("\n");
    expect(said).toContain("demo.noTodo");
    expect(said).toContain("src/**");
    expect(said).toContain("for subagent");
    expect(s.categories).toEqual(["subagent"]);
    // An entry at two moments is listed under both — standing at the commit, a write rule is still
    // about to run.
    expect(said.match(/demo\.noTodo/g)?.length).toBe(2);
  });

  it("prints an entry's ignores beside its globs, and says so when a disabled one gave no reason", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.scoped", {
              kind: "guardrail",
              at: ["write"],
              on: ["src/**"],
              ignore: ["**/*.test.ts"],
              message: "no",
            }),
            loaded("demo.quiet", { kind: "guardrail", at: ["write"], message: "no", disabled: {} }),
          ],
        },
      }),
    );
    const said = statusLines(s).join("\n");
    expect(said).toContain("on src/**");
    expect(said).toContain("not **/*.test.ts");
    expect(said).toContain("no reason given");
  });

  it("names a session that wears nothing, and one the marker could not attribute to an agent", () => {
    const said = statusLines(status(statusFacts({ session: { id: "s1", agent: null, wearing: [] } }))).join("\n");
    expect(said).toContain("s1");
    expect(said).toContain("wearing no category");
  });

  it("prints the permission mode, and under auto mode whether the session is steered towards shell edits", () => {
    const under = (mode: string | null, steer: Steer | null = null): string[] =>
      statusLines(status(statusFacts({ session: { id: "s1", agent: "main", wearing: [], mode, steer } })));
    expect(under("auto", { shellFirst: true, variant: "strict" })).toContain("  mode       auto — steered towards shell edits (strict)");
    expect(under("auto", { shellFirst: true, variant: null })).toContain("  mode       auto — steered towards shell edits");
    expect(under("auto", { shellFirst: false, variant: null })).toContain("  mode       auto — not steered towards shell edits");
    expect(under("auto")).toContain("  mode       auto — no steer towards shell edits found in its transcript");
    expect(under("default", { shellFirst: true, variant: "strict" }), "the steer is auto mode's alone").toContain("  mode       default");
    expect(under(null).join("\n"), "no call has stated a mode yet").not.toContain("  mode ");
    expect(statusLines(status(statusFacts())).join("\n")).not.toContain("  mode ");
  });

  it("lists a disabled entry with the reason somebody wrote", () => {
    const s = status(
      statusFacts({
        load: {
          ok: true,
          entries: [
            loaded("demo.retired", {
              kind: "guardrail",
              at: ["commit"],
              message: "no",
              disabled: { reason: "the tool it calls is gone" },
            }),
          ],
        },
      }),
    );
    expect(statusLines(s).join("\n")).toContain("the tool it calls is gone");
  });

  it("names an entry bound at a moment this adapter cannot deliver — the dark rail", () => {
    const s = status({
      ...statusFacts(),
      load: { ok: true, entries: [loaded("demo.late", noteAtTurnEnd)] },
    });
    expect(s.dark).toEqual(["demo.late"]);
    expect(s.green, "a note that can never be shown is a red line").toBe(false);
    expect(statusLines(s).join("\n")).toContain("nothing delivers");
  });

  it("keeps the turn-end GUARDRAIL out of that list — the rail works, only the note is dark", () => {
    const s = status({
      ...statusFacts(),
      load: { ok: true, entries: [loaded("demo.ran", { kind: "guardrail", at: ["turn-end"], message: "no" })] },
    });
    expect(s.dark).toEqual([]);
  });

  it("says the session's own categories when a live session marked this worktree", () => {
    const s = status(statusFacts({ session: { id: "s1", agent: "main", wearing: ["parent"] } }));
    expect(statusLines(s).join("\n")).toContain("parent");
  });

  it("says so plainly when nothing has marked one", () => {
    expect(statusLines(status(statusFacts())).join("\n")).toContain("no live session");
  });
});

describe("status — the red lines, each carrying its fix", () => {
  const red = (over: Partial<StatusFacts>): string => statusLines(status(statusFacts(over))).join("\n");

  it("a repo with no config at all", () => {
    const s = status(statusFacts({ hasConfig: false, load: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s).join("\n")).toContain("flow init");
  });

  it("a config that will not load — every refusal, and every rail off until it is fixed", () => {
    const s = status(
      statusFacts({
        load: { ok: false, refusals: [{ code: "no-cases", entry: "demo.x", detail: "`demo.x` carries no cases." }] },
      }),
    );
    expect(s.green).toBe(false);
    const said = statusLines(s).join("\n");
    expect(said).toContain("carries no cases");
    expect(said, "no moment table under a headline saying nothing is armed").not.toContain("commit  ");
  });

  it("an unarmed git gate", () => {
    expect(red({ gateText: null })).toContain("flow init");
    const theirs = red({ gateText: "#!/bin/sh\nnpm test\n" });
    expect(theirs).toContain("does not call flow");
    expect(theirs, "the same instruction init gives, in the same words").toContain(ADD_THE_GATE_LINE);
  });

  it("a hooksPath git was never told about — the one a fresh clone always needs", () => {
    expect(red({ hooksPath: null })).toContain(SET_HOOKS_PATH);
  });

  it("a host that is not registered to call flow at all", () => {
    const said = red({ settings: {} });
    expect(said).toContain("SessionStart");
    expect(said).toContain("flow init");
  });

  it("the kill switch, which is not a fault and outranks everything below it", () => {
    const s = status(statusFacts({ off: true }));
    expect(statusLines(s)).toHaveLength(1);
    expect(statusLines(s)[0]).toContain("OFF");
    expect(statusLines(s)[0]).toContain(".flow/off");
  });

  it("counts the reds it found, so a caller's exit code and the page agree", () => {
    const s = status(statusFacts({ gateText: null, hooksPath: null }));
    expect(s.green).toBe(false);
    expect(statusLines(s).at(-1)).toContain("2 red lines");
  });

  it("closes on the same answer the exit code is taken from — never a green page that exits 1", () => {
    // One decision, read twice. Every shape below is a different route to not-green, and the close
    // has to follow `green` rather than re-deriving it from the parts.
    const shapes: Partial<StatusFacts>[] = [
      {},
      { gateText: null },
      { hasConfig: false, load: null },
      { settings: {} },
      { load: { ok: true, entries: [loaded("demo.late", noteAtTurnEnd)] } },
      { load: { ok: false, refusals: [{ code: "no-cases", entry: "demo.x", detail: "no cases" }] } },
    ];
    for (const shape of shapes) {
      const s = status(statusFacts(shape));
      expect(statusLines(s).at(-1)?.startsWith("green"), JSON.stringify(shape)).toBe(s.green);
    }
  });
});

describe("status — the snapshot's edges and a registration an older flow wrote", () => {
  const red = (over: Partial<StatusFacts>): string => statusLines(status(statusFacts(over))).join("\n");
  const guardsAt = (on: readonly string[], at: readonly string[] = ["write"]) =>
    loaded("house.env", { kind: "guardrail", at, on, message: "no" });

  it("names a rule whose scope reaches an ignored path the snapshot leaves out, and the setting", () => {
    const facts = { load: { ok: true as const, entries: [guardsAt([".env"])] }, ignored: [".env", "node_modules/"] };
    const said = red(facts);
    expect(said).toContain("✗ snapshot: house.env guards .env, which git ignores");
    expect(said).toContain("snapshotInclude");
    expect(status(statusFacts(facts)).green).toBe(false);
    expect(status(statusFacts({ ...facts, snapshotInclude: [".env*"] })).green, "listed, so the snapshot holds it").toBe(true);
  });

  it("reaches an ignored directory a glob names, and not one a wildcard only happens to cover", () => {
    const gaps = (on: readonly string[], ignored: readonly string[], include: readonly string[] = []): string[] =>
      status(statusFacts({ load: { ok: true, entries: [guardsAt(on)] }, ignored, snapshotInclude: include }))
        .fittings.filter((f) => f.id === "snapshot")
        .map((f) => f.detail.split(",")[0] ?? "");
    expect(gaps(["dist/**"], ["dist/"])).toEqual(["house.env guards dist/"]);
    expect(gaps(["src/**"], ["src/gen/"])).toEqual(["house.env guards src/gen/"]);
    expect(gaps(["src/*.ts"], ["src/gen/"]), "one segment deep never reaches below it").toEqual([]);
    expect(gaps(["**/*.ts"], ["node_modules/"]), "no rule was written about node_modules").toEqual([]);
    expect(gaps(["**/*.log"], ["debug.log"]), "an ignored FILE the glob matches is reached").toEqual(["house.env guards debug.log"]);
    expect(gaps(["src/**"], ["src/gen/"], ["src/gen/**"]), "brought back by snapshotInclude").toEqual([]);
    expect(gaps(["dist/**"], ["dist/"], ["dist/**"])).toEqual([]);
    expect(gaps(["dist/app.js"], ["dist/"])).toEqual(["house.env guards dist/app.js"]);
  });

  it("asks only about live write and delete guardrails — a note, a command rule or a disabled one has no stake", () => {
    const quiet = (spec: Record<string, unknown>): boolean =>
      status(statusFacts({ load: { ok: true, entries: [loaded("house.x", spec)] }, ignored: [".env"] })).green;
    expect(quiet({ kind: "breadcrumb", at: ["touch"], on: [".env"], text: "x" })).toBe(true);
    expect(quiet({ kind: "guardrail", at: ["commit"], on: [".env"], message: "x" })).toBe(true);
    expect(quiet({ kind: "guardrail", at: ["delete"], on: [".env"], message: "x" })).toBe(false);
    expect(quiet({ kind: "guardrail", at: ["write"], on: [".env"], ignore: [".env"], message: "x" })).toBe(true);
    expect(quiet({ kind: "guardrail", at: ["write"], on: [".env"], message: "x", disabled: "off for now" })).toBe(true);
  });

  it("lists the paths rules name outright, which status asks git about by name", () => {
    const load = { ok: true as const, entries: [guardsAt([".env", "src/**", "config/app.json"]), guardsAt([".env"], ["delete"])] };
    expect(literalScopes(load)).toEqual([".env", "config/app.json"]);
    expect(literalScopes(null)).toEqual([]);
  });

  it("goes red on an older flow's narrow PostToolUse, and says re-running init widens it", () => {
    const settings = withRegistrations({}).settings as { hooks: Record<string, unknown> };
    const older = {
      hooks: {
        ...settings.hooks,
        PostToolUse: [{ matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] }],
      },
    };
    const said = red({ settings: older });
    expect(said).toContain("calls flow for PostToolUse on some tools only");
    expect(said).toContain("Re-run `flow init` to widen it.");
    const missing = { hooks: { ...older.hooks, PostToolUseFailure: undefined } };
    const both = red({ settings: missing });
    expect(both).toContain("does not call flow for PostToolUseFailure");
    expect(both).toContain("on some tools only");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELTA — what a call changed, judged, and what is put back
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("the delta becomes the write and delete rails, and touch is the floor", () => {
  const changes = [
    { path: "src/a.ts", before: "a\n", after: "a // TODO\n" },
    { path: "src/new.ts", before: null, after: "new\n" },
    { path: "src/old.ts", before: "old\n", after: null },
  ];
  const withChanges = (over: readonly { path: string; before: string | null; after: string | null }[]): EventWorld => ({
    ...world(),
    changes: over,
  });

  it("judges every changed file on what is now on disk, and every removed one on what it held", () => {
    const events = toEvent("post-tool-use", pre("Bash", { command: "python3 fix.py" }), withChanges(changes));
    expect(events).toStrictEqual([
      { rail: "guard", moment: "write", file: { path: "src/a.ts", content: "a // TODO\n" }, observed: true },
      { rail: "guard", moment: "write", file: { path: "src/new.ts", content: "new\n" }, observed: true },
      { rail: "guard", moment: "delete", file: { path: "src/old.ts", content: "old\n" }, observed: true },
      { rail: "brief", moment: "touch", path: "src/a.ts" },
      { rail: "brief", moment: "touch", path: "src/new.ts" },
      { rail: "brief", moment: "touch", path: "src/old.ts" },
    ]);
  });

  it("judges a failed call's partial writes exactly as a finished call's", () => {
    const payload = pre("Bash", { command: "python3 fix.py" });
    expect(toEvent("post-tool-use-failure", payload, withChanges(changes))).toStrictEqual(
      toEvent("post-tool-use", payload, withChanges(changes)),
    );
  });

  it("does not judge twice what PreToolUse already judged — the Edit's file, the rm's target", () => {
    const edit = toEvent("post-tool-use", pre("Edit", { file_path: "/repo/src/a.ts" }), withChanges(changes.slice(0, 1)));
    expect(edit).toStrictEqual([{ rail: "brief", moment: "touch", path: "src/a.ts" }]);
    const rm = toEvent("post-tool-use", pre("Bash", { command: "rm src/old.ts" }), withChanges(changes.slice(2)));
    expect(rm).toStrictEqual([{ rail: "brief", moment: "touch", path: "src/old.ts" }]);
    expect(preJudged(pre("Write", { file_path: "/repo/x.ts" }), ROOT)).toEqual({ writes: ["x.ts"], deletes: [] });
    expect(preJudged(pre("Bash", { command: "rm /repo/x.ts" }), ROOT)).toEqual({ writes: [], deletes: ["x.ts"] });
    expect(preJudged(pre("MultiEdit", {}), ROOT)).toEqual({ writes: [], deletes: [] });
    expect(preJudged(pre("Read", { file_path: "/repo/x.ts" }), ROOT), "a read judged nothing").toEqual({ writes: [], deletes: [] });
  });

  it("judges as a WRITE an rm target the call wrote again — PreToolUse only judged it as a delete", () => {
    const rewritten = [{ path: "src/a.ts", before: "a\n", after: "a // TODO\n" }];
    const command = "rm src/a.ts && cat > src/a.ts <<EOF\na // TODO\nEOF";
    expect(toEvent("post-tool-use", pre("Bash", { command }), withChanges(rewritten))).toStrictEqual([
      { rail: "guard", moment: "write", file: { path: "src/a.ts", content: "a // TODO\n" }, observed: true },
      { rail: "brief", moment: "touch", path: "src/a.ts" },
    ]);
    // An mv's source that something else then fills is the same hole, and closed the same way.
    const moved = [
      { path: "src/a.ts", before: "a\n", after: "TODO\n" },
      { path: "src/b.ts", before: null, after: "a\n" },
    ];
    const events = toEvent("post-tool-use", pre("Bash", { command: "mv src/a.ts src/b.ts && echo TODO > src/a.ts" }), withChanges(moved));
    expect(events.flatMap((e) => (e.rail === "guard" ? [[e.moment, e.file?.path]] : []))).toStrictEqual([
      ["write", "src/a.ts"],
      ["write", "src/b.ts"],
    ]);
  });

  it("touches the path the tool named once, however many rails it is on", () => {
    const events = toEvent("post-tool-use", pre("Read", { file_path: "/repo/src/a.ts" }), withChanges(changes.slice(0, 1)));
    expect(events.filter((e) => e.rail === "brief")).toStrictEqual([{ rail: "brief", moment: "touch", path: "src/a.ts" }]);
  });

  it("reads the host's key for one call, and nothing when it sent none", () => {
    expect(callKey({ tool_use_id: "toolu_1" })).toBe("toolu_1");
    expect(callKey({})).toBeNull();
    expect(callKey({ tool_use_id: {} as never })).toBeNull();
  });
});

describe("reversal — exactly the refused files go back", () => {
  const changes = [
    { path: "src/a.ts", before: "a\n", after: "TODO\n" },
    { path: "src/b.ts", before: "b\n", after: "b2\n" },
  ];
  const block = (subject: string): Block => ({ do: "block", entry: "house.noTodo", message: "No TODOs.", subject, detail: "" });

  it("reverts the refused path, and lists the rest as kept", () => {
    expect(reversal(changes, [{ moment: "write", block: block("src/a.ts"), observed: "src/a.ts" }])).toStrictEqual({
      revert: [changes[0]],
      kept: ["src/b.ts"],
    });
  });

  it("reverts nothing on a refusal that names no landed change — a revert is never a guess", () => {
    expect(reversal(changes, [{ moment: "command", block: block("x") }])).toStrictEqual({ revert: [], kept: ["src/a.ts", "src/b.ts"] });
  });

  it("honours the repair exception: a broken config's own repair lands and stays", () => {
    const repair = [
      { path: "flow.config.ts", before: "old", after: "fixed" },
      { path: "src/a.ts", before: "a", after: "b" },
    ];
    const events = toEvent("post-tool-use", pre("Bash", { command: "python3 fix.py" }), { ...world(), changes: repair });
    const answer = whileBroken(events, configSurface(""), "the config will not load");
    expect(answer.refused.map((r) => r.observed), "only the path off the surface is refused").toEqual(["src/a.ts"]);
    expect(reversal(repair, answer.refused)).toStrictEqual({ revert: [repair[1]], kept: ["flow.config.ts"] });
  });
});

describe("an observed refusal — its own banner, and what was put back", () => {
  const noTodo: Block = { do: "block", entry: "house.noTodo", message: "No TODOs in src/ — do it now, or track it properly.", subject: "src/b.ts", detail: "line 3 says TODO" };
  const b = { path: "src/b.ts", before: "b\n", after: "TODO\n" };

  it("prints the guide's example: the reverted banner, the entry, and the two-sentence tail", () => {
    const answer = toResult("post-tool-use", {
      refused: [{ moment: "write", block: noTodo, observed: "src/b.ts" }],
      shown: [],
      undone: { restored: [b], kept: [], failed: [] },
    });
    expect(answer.exitCode).toBe(2);
    expect(answer.stdout).toBe("");
    expect(answer.stderr).toBe(
      "\nflow — write reverted after it landed:\n\n" +
        "✗ house.noTodo · src/b.ts\n  No TODOs in src/ — do it now, or track it properly.\n    line 3 says TODO\n\n" +
        "src/b.ts is back to its previous content. Adjust the change so it passes and write it again — through Edit, which is judged before it lands.\n" +
        "Only file content was put back: anything else the call did has already happened.\n",
    );
  });

  it("says which files stayed, which were removed again, and which were restored", () => {
    const stderr = toResult("post-tool-use", {
      refused: [
        { moment: "write", block: noTodo, observed: "src/b.ts" },
        { moment: "write", block: noTodo, observed: "src/c.ts" },
        { moment: "write", block: noTodo, observed: "src/n.ts" },
      ],
      shown: [],
      undone: {
        restored: [b, { path: "src/c.ts", before: "c", after: "x" }, { path: "src/n.ts", before: null, after: "x" }],
        kept: ["README.md"],
        failed: [],
      },
    }).stderr;
    expect(stderr).toContain("src/b.ts and src/c.ts are back to their previous content.");
    expect(stderr).toContain("src/n.ts is gone again — the call created it.");
    expect(stderr).toContain("Kept as the call wrote it: README.md.");
  });

  it("restores a removed file under the delete banner, with the delete rail's instruction", () => {
    const stderr = toResult("post-tool-use", {
      refused: [{ moment: "delete", block: { ...noTodo, entry: "house.keep" }, observed: "a.ts" }, { moment: "delete", block: noTodo, observed: "b.ts" }],
      shown: [],
      undone: {
        restored: [
          { path: "a.ts", before: "a", after: null },
          { path: "b.ts", before: "b", after: null },
        ],
        kept: ["x.ts", "y.ts"],
        failed: [],
      },
    }).stderr;
    expect(stderr.startsWith("\nflow — delete reverted after it landed:\n")).toBe(true);
    expect(stderr).toContain("a.ts and b.ts are restored. Keep the file, or change the rule that protects it.");
    expect(stderr).toContain("Kept as the call wrote them: x.ts, y.ts.");
  });

  it("never claims a revert that failed — it says the file still holds what the call wrote", () => {
    const stderr = toResult("post-tool-use", {
      refused: [{ moment: "write", block: noTodo, observed: "src/b.ts" }],
      shown: [],
      undone: { restored: [b], kept: [], failed: [{ path: "src/b.ts", why: "permission denied" }] },
    }).stderr;
    expect(stderr).not.toContain("is back to its previous content");
    expect(stderr).toContain("flow could not put src/b.ts back (permission denied) — it still holds what the call wrote.");
  });

  it("keeps the pre-emptive banner for a refusal that did not land", () => {
    expect(toResult("pre-tool-use", { refused: [{ moment: "write", block: noTodo }], shown: [] }).stderr).toContain(
      "flow — blocked before the write landed",
    );
  });

  it("reports a call it could not see — loud, exit 2, nothing judged and nothing put back", () => {
    const said = deltaFault("No snapshot was taken before this call.");
    expect(said.exitCode).toBe(2);
    expect(said.stderr).toContain("flow — could not see what this call changed:");
    expect(said.stderr).toContain("No snapshot was taken before this call.");
    expect(said.stderr).toContain("nothing was put back");
  });
});

describe("the call log — which other calls overlapped this one", () => {
  const call = (key: string, agent: string, at: number, done?: number, tool = "Bash"): CallRecord => ({
    key,
    session: "sess-1234abcd",
    agent,
    tool,
    at,
    ...(done === undefined ? {} : { done }),
  });

  it("reads a record back, and refuses what is not one", () => {
    expect(callRecord("k", { session: "s", agent: "a", tool: "Bash", at: 5, tree: "abc" })).toStrictEqual({ key: "k", session: "s", agent: "a", tool: "Bash", at: 5 });
    expect(callRecord("k", { session: "s", agent: "a", tool: "Bash", at: 5, done: 9 })?.done).toBe(9);
    expect(callRecord("k", { session: "s" }), "no start time").toBeNull();
    expect(callRecord("k", null)).toBeNull();
    expect(callRecord("k", "text")).toBeNull();
  });

  it("names a call in flight, and one that finished inside this call's window", () => {
    const me = call("me", "main", 100);
    const log = [me, call("running", "sub1", 50), call("inside", "sub2", 120, 150), call("before", "sub3", 10, 90)];
    expect(overlapping(me, log).map((c) => c.key), "one that finished before this began did not overlap it").toStrictEqual(["running", "inside"]);
  });

  it("never counts the same actor, whose writing calls the host runs one at a time", () => {
    const me = call("me", "main", 100);
    expect(overlapping(me, [me, call("sibling", "main", 90)])).toStrictEqual([]);
    expect(overlapping(me, [me, { ...call("other", "main", 90), session: "another-session" }]).map((c) => c.key)).toStrictEqual(["other"]);
  });

  it("never counts a spawn: the subagent's writes are its own calls", () => {
    const me = call("me", "sub1", 100);
    expect(overlapping(me, [me, call("spawn", "main", 10, undefined, "Agent"), call("old", "main", 10, undefined, "Task")])).toStrictEqual([]);
  });

  it("does not wait on a snapshot whose call never ran — its agent has since finished a later call", () => {
    const me = call("me", "main", 100);
    const denied = call("denied", "sub1", 20);
    expect(overlapping(me, [me, denied]).map((c) => c.key), "nothing says it was abandoned").toStrictEqual(["denied"]);
    expect(overlapping(me, [me, denied, call("next", "sub1", 30, 40)])).toStrictEqual([]);
  });

  it("forgets a finished call once no call still in flight began before it finished", () => {
    const log = [call("live", "main", 100), call("old", "sub1", 10, 50), call("recent", "sub1", 60, 150)];
    expect(forgettable(log), "recent finished after live began, so live's diff still needs it").toStrictEqual(["old"]);
    expect(forgettable([...log, call("earliest", "sub2", 5)]), "a call in flight since before either pins both").toStrictEqual([]);
    expect(forgettable([call("a", "main", 1, 2), call("b", "sub1", 3, 4)]), "nothing in flight").toStrictEqual(["a", "b"]);
  });

  it("names a call by its tool, its id and whose it was", () => {
    expect(callName(call("toolu_9", "main", 1))).toBe("Bash toolu_9 (main agent of session sess-123)");
    expect(callName({ ...call("toolu_9", "a77", 1), tool: "" })).toBe("a tool toolu_9 (agent a77 of session sess-123)");
  });
});

describe("the revert scope — the setting, and overlap", () => {
  const changes = [
    { path: "src/a.ts", before: "a\n", after: "TODO\n" },
    { path: "src/b.ts", before: "b\n", after: "b2\n" },
    { path: "src/c.ts", before: null, after: "c\n" },
  ];
  const noTodo: Block = { do: "block", entry: "house.noTodo", message: "No TODOs.", subject: "src/a.ts", detail: "" };
  const refusedA = [{ moment: "write" as const, block: noTodo, observed: "src/a.ts" }];
  const other: CallRecord = { key: "toolu_other", session: "sess-9999aaaa", agent: "a1", tool: "Bash", at: 1 };

  it("puts back every file the call changed when the repo sets revert: all", () => {
    expect(reversal(changes, refusedA, { ...REFUSED_ONLY, revert: "all" })).toStrictEqual({ revert: changes, kept: [] });
  });

  it("puts back nothing under revert: all when nothing refused a landed change", () => {
    expect(reversal(changes, [], { ...REFUSED_ONLY, revert: "all" }).revert).toStrictEqual([]);
  });

  it("ignores revert: all while another actor's call overlapped this one", () => {
    expect(reversal(changes, refusedA, { revert: "all", overlap: [other] })).toStrictEqual({
      revert: [changes[0]],
      kept: ["src/b.ts", "src/c.ts"],
    });
  });

  it("says the whole call went back under revert: all", () => {
    const stderr = toResult("post-tool-use", {
      refused: refusedA,
      shown: [],
      undone: { restored: changes, kept: [], failed: [], scope: { ...REFUSED_ONLY, revert: "all" } },
    }).stderr;
    expect(stderr).toContain("src/a.ts and src/b.ts are back to their previous content.");
    expect(stderr).toContain('revert: "all" is set, so every file this call changed was put back, not only the refused ones.');
  });

  it("names the calls that overlapped, and says revert: all was not applied", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...other, key: `toolu_${i}` }));
    const stderr = toResult("post-tool-use", {
      refused: refusedA,
      shown: [],
      undone: { restored: [changes[0]!], kept: ["src/b.ts"], failed: [], scope: { revert: "all", overlap: many } },
    }).stderr;
    expect(stderr.startsWith("\nflow — write reverted after it landed:\n")).toBe(true);
    expect(stderr).toContain("Other tool calls overlapped this one: Bash toolu_0 (agent a1 of session sess-999);");
    expect(stderr).toContain("toolu_4 (agent a1 of session sess-999); and 2 more.");
    expect(stderr).toContain('only the refused files were put back — revert: "all" is set, and is not applied while calls overlap.');
    const plain = toResult("post-tool-use", {
      refused: refusedA,
      shown: [],
      undone: { restored: [changes[0]!], kept: [], failed: [], scope: { revert: "refused", overlap: [other] } },
    }).stderr;
    expect(plain).toContain("so only the refused files were put back.\n");
  });
});

describe("pathLines — git's one-path-per-line answer", () => {
  it("keeps each path, trimmed, and drops the blank lines", () => {
    expect(pathLines(" a.ts\n\nsrc/b c.ts \n")).toStrictEqual(["a.ts", "src/b c.ts"]);
    expect(pathLines(null), "a command that never ran").toStrictEqual([]);
  });
});

describe("snapshotInclude — where git looks, and what it keeps", () => {
  it("cuts a glob to its literal head, whole segments only", () => {
    expect(staticPrefix("src/gen/**")).toBe("src/gen/");
    expect(staticPrefix("src/*.ts")).toBe("src/");
    expect(staticPrefix(".env")).toBe(".env");
    expect(staticPrefix("**/.env")).toBe("");
    expect(staticPrefix("config/{a,b}.json")).toBe("config/");
  });

  it("walks only the heads, or everywhere once one glob has none", () => {
    expect(snapshotPathspecs([".env", "config/*.local.json", "config/x/**"])).toEqual([".env", "config/", "config/x/"]);
    expect(snapshotPathspecs([".env", "**/.env.local"])).toEqual(["."]);
  });

  it("keeps the listed paths a glob matches, through the one glob engine", () => {
    expect(included(["config/a.local.json", "config/cache.bin", ""], ["config/*.local.json"])).toEqual(["config/a.local.json"]);
  });
});
