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
import {
  breadcrumb,
  defineConfig,
  definePack,
  guardrail,
  loadConfig,
  override,
  pack,
  session,
  turnEnd,
  type LoadedEntry,
  type LoadResult,
  type TurnAction,
} from "../index.ts";
import { metrics, momentsView, type Block, type Bound, type Row } from "../engine/domain.ts";
import { missingGrammarText } from "../checks/domain.ts";
import { parseCommandLine, parseShellSteps } from "../language/domain.ts";
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
  readFault,
  hermeticEnv,
  isHookEvent,
  isInjected,
  relativise,
  ownTranscriptPath,
  sessionFactsFrom,
  agentSettingOf,
  nothingBound,
  ridesRefusal,
  agentOf,
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
  statusCode,
  whileBroken,
  FLOW_OFF,
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
  hookCommand,
  bareHook,
  bareRegistrations,
  hostPath,
  ourHookCommand,
  registeredEvents,
  staleRegistrations,
  withRegistrations,
  withMachineCommandsUpToDate,
  listsFlow,
  PACKAGE_BIN,
  PACKAGE_DIR,
  callKey,
  deltaFault,
  included,
  authored,
  nulPaths,
  literalScopes,
  preJudged,
  reversal,
  callName,
  callRecord,
  forgettable,
  overlapping,
  pathLines,
  stagedChanges,
  treeChanges,
  commitScope,
  armsOldFlow,
  UPDATE_THE_GATE_LINE,
  REFUSED_ONLY,
  type CallRecord,
  snapshotPathspecs,
  staticPrefix,
  PRE_COMMIT,
  GATE_LOCAL_LINE,
  GATE_RUN_LINE,
  HOOKS_DIR,
  LOCAL_BIN,
  GATE_PATH,
  SET_HOOKS_PATH,
  ADD_THE_GATE_LINE,
  armsFlow,
  scaffold,
  planInit,
  initCode,
  initLines,
  notInstalledLines,
  NOT_INSTALLED,
  wantsColour,
  hooksDirOf,
  otherHooks,
  preCommitOf,
  settingsFileFor,
  status,
  statusLines,
  type HooksFolder,
  type Fitting,
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

describe("the seven events, and the moments honestly delivered", () => {
  it("answers to seven events, named by the event and never by the job", () => {
    expect([...HOOK_EVENTS]).toStrictEqual([
      "session-start",
      "pre-tool-use",
      "post-tool-use",
      "post-tool-use-failure",
      "stop",
      "subagent-stop",
      "notification",
    ]);
    expect(isHookEvent("pre-tool-use")).toBe(true);
    expect(isHookEvent("SubagentStop"), "the host's name is not flow's verb").toBe(false);
    expect(isHookEvent("PreToolUse"), "the host's name is not flow's verb").toBe(false);
  });

  it("states what it can supply, turn-end briefing among it", () => {
    // The Stop and SubagentStop answers carry `additionalContext`, so a note bound at turn-end is
    // shown there. Saying what is carried is the contract; faking it would be the failure.
    expect(delivers("guardrail", "turn-end"), "the turn-end GUARDRAIL rail works").toBe(true);
    expect(delivers("breadcrumb", "turn-end"), "a NOTE bound there is shown at the hand-back").toBe(true);
    expect(DELIVERS.brief).toContain("turn-end");
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
    expect(deleteTargets(parseCommandLine("rm -rf secret/a.ts b.ts"))).toStrictEqual(["secret/a.ts", "b.ts"]);
    expect(deleteTargets(parseCommandLine("git rm secret/a.ts"))).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets(parseCommandLine("mv secret/a.ts elsewhere/a.ts"))).toStrictEqual(["secret/a.ts"]);
    expect(deleteTargets(parseCommandLine("git mv secret/a.ts elsewhere/a.ts")), "git mv was the old blind spot").toStrictEqual([
      "secret/a.ts",
    ]);
  });

  it("reads every sub-command of a chained line, and no others", () => {
    expect(deleteTargets(parseCommandLine("just build && rm dist/a.js"))).toStrictEqual(["dist/a.js"]);
    expect(deleteTargets(parseCommandLine("echo 'rm a.ts'")), "a quoted mention is not a command").toStrictEqual([]);
    expect(deleteTargets(parseCommandLine("git commit -m 'rm the thing'"))).toStrictEqual([]);
  });

  it("stands aside on a line it cannot parse, rather than guessing", () => {
    // null from the parse means "I cannot tell". A guard that guesses at a line it could not
    // parse is worse than one that stands aside — and the command rail still sees the raw line.
    expect(deleteTargets(parseCommandLine("rm 'unclosed"))).toStrictEqual([]);
  });

  it("does not read a rename with only a destination as a removal", () => {
    expect(deleteTargets(parseCommandLine("mv onlyone"))).toStrictEqual([]);
  });

  it("reads the removers' own arguments in the parse, never a heredoc body or another command's quoted argument", () => {
    // A file written from a heredoc that names an `rm`, and a script fed to python on stdin.
    expect(deleteTargets(parseCommandLine("cat > notes.md <<'EOF'\nrm secret/a.ts\nEOF"))).toStrictEqual([]);
    expect(deleteTargets(parseCommandLine("python3 - <<'PY'\nimport os; os.system('rm secret/a.ts')\nPY"))).toStrictEqual([]);
    expect(deleteTargets(parseCommandLine('gh issue comment 1 --body "then rm secret/a.ts and git rm b.ts"'))).toStrictEqual([]);
    // …while an rm that RUNS is read wherever it sits: a substitution, a string given to a shell,
    // a heredoc a shell reads, and past a wrapper.
    expect(deleteTargets(parseCommandLine('echo "$(rm a.ts)"; bash -c "rm b.ts"; sudo rm c.ts'))).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
    expect(deleteTargets(parseCommandLine("bash <<'EOF'\nrm a.ts\nEOF"))).toStrictEqual(["a.ts"]);
  });

  it("reads git's own options before its subcommand, and a file after `--` that looks like a flag", () => {
    expect(deleteTargets(parseCommandLine("git -c core.x=y rm --cached a.ts"))).toStrictEqual(["a.ts"]);
    expect(deleteTargets(parseCommandLine("rm -- -weird.ts"))).toStrictEqual(["-weird.ts"]);
    expect(deleteTargets(null), "a line that does not parse").toStrictEqual([]);
  });
});

// ── Bash reads — what a shell command reads, for the touch breadcrumb ───────────

describe("bashReads — the files a Bash command reads, before it runs", () => {
  const HOME = "/home/me";
  const at = (command: string, cwd = ROOT, home: string | undefined = HOME): { reads: readonly string[]; searched: readonly string[] } =>
    bashReads(parseShellSteps(command), { cwd, root: ROOT, home });
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
    expect(at("find src -name '*.ts' -o \\( -name x \\) ! -path y")).toStrictEqual({ reads: [], searched: ["src"] });
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
    expect(searched("find src lib \\( -name x \\)")).toStrictEqual(["src", "lib"]);
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
    // A group's redirect is each inner command's own, target as written: expanded once, never the cwd.
    expect(reads('F=list.txt; { cat; head -1; } < "$F"')).toStrictEqual(["list.txt"]);
    expect(reads("cat <&- a.ts")).toStrictEqual(["a.ts"]);
  });

  it("does not read a heredoc's body as commands, quoted or dash delimiters alike", () => {
    expect(reads("cat > out.ts <<'EOF'\ncat secret.ts\nEOF\ncat after.ts")).toStrictEqual(["after.ts"]);
    expect(reads("python3 - <<PY\nopen('x.ts')\n'unbalanced\nPY\nhead a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("cat <<-EOF\n\tcat inside.ts\n\tEOF\ncat after.ts")).toStrictEqual(["after.ts"]);
    // A body that never closes runs to the end of the line, and names nothing.
    expect(reads("cat <<EOF\ncat inside.ts")).toStrictEqual([]);
    // A `<<` with no delimiter after it does not parse, and names nothing.
    expect(reads("cat a.ts <<")).toStrictEqual([]);
    // …but a body a SHELL reads is commands, and what they read is read.
    expect(reads("bash <<'EOF'\ncat inside.ts\nEOF\ncat after.ts")).toStrictEqual(["inside.ts", "after.ts"]);
    // A heredoc inside a `$(…)` is skipped there too, apostrophes and all.
    expect(reads("echo \"$(cat <<'EOF'\ndon't cat x.ts\nEOF\n)\"; cat after.ts")).toStrictEqual(["after.ts"]);
  });

  it("never reads a path in a heredoc body, or in a quoted argument of a command that is not a reader", () => {
    expect(at("cat > notes.md <<'EOF'\ncat src/a.ts\ngrep -r x src\nEOF")).toStrictEqual({ reads: [], searched: [] });
    expect(at("git commit -F - <<'EOF'\nfix: read src/a.ts\nEOF")).toStrictEqual({ reads: [], searched: [] });
    expect(at("gh pr create --body 'see `cat src/a.ts` and src/b.ts'")).toStrictEqual({ reads: [], searched: [] });
    // …but a backtick inside DOUBLE quotes runs, and what it runs reads.
    expect(at('gh pr create --body "see `cat src/a.ts`"')).toStrictEqual({ reads: ["src/a.ts"], searched: [] });
    expect(at("echo 'cat src/a.ts' | tee /dev/null")).toStrictEqual({ reads: [], searched: [] });
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
    // Quoted or escaped, a `$` or a `~` is text the program is given as is, never expanded: what
    // is read is a file of that literal name, never the home or the variable's value.
    expect(at("cat '$HOME/x.ts'", ROOT, "/repo/home").reads).toStrictEqual(["$HOME/x.ts"]);
    expect(at("cat \\$HOME/x.ts", ROOT, "/repo/home").reads).toStrictEqual(["$HOME/x.ts"]);
    expect(at("cat '~/x.ts'", ROOT, "/repo/home").reads).toStrictEqual(["~/x.ts"]);
    expect(reads("F=a.ts; cat '$F'")).toStrictEqual(["$F"]);
    expect(reads("F='$G'; G=a.ts; cat $F")).toStrictEqual(["$G"]);
    expect(reads("for f in '$D'; do cat $f; done; cat < '$F'")).toStrictEqual(["$D", "$F"]);
    expect(reads('F=a.ts; cat "$F" < "$F"')).toStrictEqual(["a.ts"]);
  });

  it("runs a for loop's body once per value", () => {
    expect(reads("for f in a.ts b.ts; do head -c 3 $f; done")).toStrictEqual(["a.ts", "b.ts"]);
    expect(reads("for f in a.ts $(ls); do\n  cat $f\ndone")).toStrictEqual(["a.ts"]);
    expect(reads("for f; do cat $f; done; cat z.ts")).toStrictEqual(["z.ts"]);
    // Unclosed, the loop does not parse, and names nothing.
    expect(reads("for f in a.ts; do cat $f")).toStrictEqual([]);
  });

  it("reads what a `$(…)`, a backquote or a `<(…)` runs, without guessing at what it prints", () => {
    expect(at("head -c 400 sessions/$(ls sessions | head -1)")).toStrictEqual({ reads: [], searched: ["sessions"] });
    expect(reads("echo `cat a.ts` \"$(cat b.ts)\" \"`cat c.ts`\"")).toStrictEqual(["a.ts", "b.ts", "c.ts"]);
    expect(reads("diff <(sort a.txt) >(cat) <(sort b.txt)")).toStrictEqual(["a.txt", "b.txt"]);
    expect(reads('echo "$(printf "%s" "x")"; cat a.ts')).toStrictEqual(["a.ts"]);
    expect(reads("echo $(echo \\(nested\\) 'q)' \\)); cat a.ts")).toStrictEqual(["a.ts"]);
  });

  it("peels the wrappers off the command they run", () => {
    expect(searched("timeout -s KILL 60 rg x src")).toStrictEqual(["src"]);
    expect(reads("env -u X A=1 cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("nice -n 5 nohup time cat a.ts")).toStrictEqual(["a.ts"]);
    expect(reads("xargs -a list.txt -n 1 grep -l x")).toStrictEqual(["list.txt"]);
    expect(reads("xargs --arg-file list.txt grep -l x src/a.ts")).toStrictEqual(["list.txt", "src/a.ts"]);
    expect(reads("xargs --arg-file=list.txt grep x")).toStrictEqual(["list.txt"]);
    expect(reads("xargs -alist.txt grep x")).toStrictEqual(["list.txt"]);
    expect(reads("exec -a name xargs grep x"), "exec's -a names the process, it is not xargs's list").toStrictEqual([]);
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
    expect(reads("done; cat a.ts) ; (cat b.ts"), "a line that does not parse").toStrictEqual([]);
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
      { rail: "guard", moment: "command", command: "rm secret/a.ts", commands: parseCommandLine("rm secret/a.ts") },
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
      { rail: "guard", moment: "command", command, commands: parseCommandLine(command) },
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
      { rail: "guard", moment: "command", command: "rm nowhere.ts", commands: parseCommandLine("rm nowhere.ts") },
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
      { rail: "brief", moment: "turn-end" },
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

  it("is LOUD on every rail that judges a tool call, and speaks without holding on the rest", () => {
    // The after-call rails say it the way every unseen call is said — the call ran and nothing it
    // changed was checked — never as a guard refusing a call that has already landed (#12).
    expect(readFault("pre-tool-use", "unparseable", "not JSON")).toStrictEqual({
      stdout: "",
      stderr: "\n[flow hook pre-tool-use] could not PARSE its payload (not JSON).\n",
      exitCode: 2,
    });
    expect(readFault("post-tool-use", "unparseable", "not JSON")).toStrictEqual({
      stdout: "",
      stderr:
        "\nflow — could not see what this call changed:\n\n" +
        "[flow hook post-tool-use] could not PARSE its payload (not JSON).\n\n" +
        "The call ran, and nothing it changed was checked or put back. Check what the call changed before you go on.\n",
      exitCode: 2,
    });
    expect(readFault("post-tool-use-failure", "unreadable", "EBADF")).toStrictEqual({
      stdout: "",
      stderr:
        "\nflow — could not see what this call changed:\n\n" +
        "[flow hook post-tool-use-failure] could not READ its payload from stdin (EBADF).\n\n" +
        "The call ran, and nothing it changed was checked or put back. Check what the call changed before you go on.\n",
      exitCode: 2,
    });
    expect(readFault("session-start", "unreadable", "EBADF")).toStrictEqual({
      stdout: "",
      stderr: "[flow hook session-start] could not READ its payload from stdin (EBADF).\n",
      exitCode: 0,
    });
    expect(readFault("stop", "unreadable", "EBADF").exitCode).toBe(0);
    expect(readFault("subagent-stop", "unreadable", "EBADF").exitCode).toBe(0);
    expect(readFault("notification", "unreadable", "EBADF").exitCode).toBe(0);
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

describe("a subagent's hand-back — the turn-end moment at SubagentStop", () => {
  // The payload as Claude Code 2.1.301 sent it for a real Explore subagent's hand-back, paths
  // shortened: its id and type, the PARENT's transcript_path, and its own beside it.
  const parent = "/c/projects/p/s1.jsonl";
  const handBack: HookPayload = {
    session_id: "s1",
    transcript_path: parent,
    cwd: "/repo",
    permission_mode: "default",
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    agent_id: "a1b1bb5ff0fc0ca82",
    agent_type: "Explore",
    agent_transcript_path: "/c/projects/p/s1/subagents/agent-a1b1bb5ff0fc0ca82.jsonl",
    last_assistant_message: "pong",
  };
  const actions: TurnAction[] = [{ did: "edit", path: "a.ts" }];

  /** The world, plus the agent the session runs as — and a record of whether it was asked. */
  const as = (sessionAgent: string | null): EventWorld => {
    const base = world({}, actions);
    return {
      ...base,
      sessionAgent: () => {
        asked.push("sessionAgent");
        return sessionAgent;
      },
    };
  };

  it("is an event flow answers, the host's SubagentStop", () => {
    expect(isHookEvent("subagent-stop")).toBe(true);
    expect(JSON.parse(decision("subagent-stop", "x"))).toStrictEqual({
      hookSpecificOutput: { hookEventName: "SubagentStop", additionalContext: "x" },
    });
  });

  it("is the turn-end moment, carrying the turn the subagent took", () => {
    expect(toEvent("subagent-stop", handBack, as(null))).toStrictEqual([
      { rail: "guard", moment: "turn-end", turn: actions },
      { rail: "brief", moment: "turn-end" },
    ]);
    expect(asked, "the turn is asked for, and so is the session's own agent").toStrictEqual(["sessionAgent", "turn"]);
  });

  it("runs no rule for an internal agent — an empty type, or the session's own agent's", () => {
    expect(toEvent("subagent-stop", { ...handBack, agent_type: "" }, as(null)), "a session run as no agent").toStrictEqual([]);
    expect(asked, "an empty type costs no transcript read, and no turn").toStrictEqual([]);
    expect(toEvent("subagent-stop", { ...handBack, agent_type: "leader" }, as("leader")), "a session run --agent leader").toStrictEqual([]);
    expect(asked, "nothing past the session's agent is read").toStrictEqual(["sessionAgent"]);
    expect(toEvent("subagent-stop", { ...handBack, agent_type: "builder" }, as("leader")), "a builder spawned by the leader").toHaveLength(2);
    const { agent_type: _type, ...untyped } = handBack;
    expect(toEvent("subagent-stop", untyped, as(null)), "no type at all").toStrictEqual([]);
    const { agent_id: _id, ...anonymous } = handBack;
    expect(toEvent("subagent-stop", anonymous, as(null)), "no agent id: no own transcript to read").toStrictEqual([]);
  });

  it("reads the session's own agent from its transcript's agent-setting record, the last one standing", () => {
    const setting = (name: string): string => JSON.stringify({ type: "agent-setting", agentSetting: name, sessionId: "s1" });
    const said = JSON.stringify({ type: "user", message: { content: 'an "agent-setting" quoted in a prompt' } });
    expect(agentSettingOf(`${setting("leader")}\n${said}\n${setting("builder")}\n`)).toBe("builder");
    expect(agentSettingOf(`${said}\n`), "a prompt quoting the word is not the record").toBeNull();
    expect(agentSettingOf(""), "a session run as no agent").toBeNull();
  });

  it("has nothing to run, and so reads nothing, when no entry is bound at turn-end", () => {
    const entries = (load: LoadResult): readonly LoadedEntry[] => {
      if (!load.ok) throw new Error(JSON.stringify(load.refusals));
      return load.entries;
    };
    const held = guardrail()
      .at(turnEnd)
      .check((ctx) => ((ctx.turn ?? []).length > 0 ? ctx.fail("did something") : ctx.ok()))
      .message("m")
      .test({ pass: [{ actions: [] }], block: [{ actions: [{ did: "edit", path: "a.ts" }] }] });
    const elsewhere = entries(loadConfig(defineConfig([pack(definePack("t", { told: breadcrumb().at(session).text("t") }))])));
    expect(nothingBound("subagent-stop", elsewhere, false), "a config with no turn-end entry").toBe(true);
    expect(nothingBound("subagent-stop", entries(loadConfig(defineConfig([pack(definePack("t", { held }))]))), false), "a turn-end guardrail").toBe(false);
    const told = definePack("t", { told: breadcrumb().at(turnEnd).text("t") });
    expect(nothingBound("subagent-stop", entries(loadConfig(defineConfig([pack(told)]))), false), "a turn-end breadcrumb").toBe(false);
    const off = definePack("t", { held });
    expect(
      nothingBound("subagent-stop", entries(loadConfig(defineConfig([pack(off), override(off.held).disabled("not here")]))), false),
      "a disabled one binds nothing",
    ).toBe(true);
    expect(nothingBound("stop", elsewhere, false), "only the subagent's hand-back is answered early").toBe(false);
    expect(nothingBound("subagent-stop", elsewhere, true), "a recording repo keeps every hand-back on its tape").toBe(false);
  });

  it("holds an agent once: a hand-back already held open is let through, and nothing is read", () => {
    expect(toEvent("subagent-stop", { ...handBack, stop_hook_active: true }, as(null))).toStrictEqual([]);
    expect(asked).toStrictEqual([]);
  });

  it("tells a config that does not load rather than holding the subagent", () => {
    const fault = "flow: the config will not load — 1 refusal.";
    const answer = whileBroken(toEvent("subagent-stop", handBack, as(null)), fault);
    expect(answer.refused).toStrictEqual([]);
    expect(answer.shown, "no note on the answer").toStrictEqual([]);
    expect(answer.told, "the shell writes this to stderr and exits 0").toBe(`${fault}\n\n${FLOW_OFF}`);
  });
});

describe("a turn-end note — a breadcrumb shown when an agent hands back", () => {
  // When a note shows — first, then after drift, and for which categories — is the engine's
  // `brief`, the same at every moment. These pin what the adapter adds: the hand-back asks for its
  // notes, and they reach the agent on the host's two channels.
  const recap: Shown = { entry: "t.recap", cause: "first-touch", body: "Write the recap before you hand back." };
  const subagent: HookPayload = {
    session_id: "s1",
    transcript_path: "/c/p/s1.jsonl",
    hook_event_name: "SubagentStop",
    stop_hook_active: false,
    agent_id: "a1",
    agent_type: "Explore",
  };
  const quiet: EventWorld = { root: ROOT, read: () => null, turn: () => [], sessionAgent: () => null };
  const briefs = (events: readonly AdapterEvent[]): boolean => events.some((event) => event.rail === "brief");

  it("is shown the first time an agent hands back, on the Stop and SubagentStop answers' additionalContext", () => {
    expect(toEvent("stop", { session_id: "s1" }, quiet), "the main chat's hand-back asks for its notes").toContainEqual({ rail: "brief", moment: "turn-end" });
    expect(toEvent("subagent-stop", subagent, quiet), "and so does a subagent's").toContainEqual({ rail: "brief", moment: "turn-end" });
    for (const [hook, name] of [["stop", "Stop"], ["subagent-stop", "SubagentStop"]] as const) {
      const result = toResult(hook, { refused: [], shown: [recap] });
      expect(result.exitCode, "a note is not a refusal: the host keeps the agent going for one more turn").toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toStrictEqual({
        hookSpecificOutput: { hookEventName: name, additionalContext: "# breadcrumb: t.recap (first-touch)\nWrite the recap before you hand back." },
      });
    }
  });

  it("shows no note on a hand-back with stop_hook_active set", () => {
    expect(briefs(toEvent("stop", { session_id: "s1", stop_hook_active: true }, quiet)), "the main chat").toBe(false);
    expect(briefs(toEvent("subagent-stop", { ...subagent, stop_hook_active: true }, quiet)), "a subagent").toBe(false);
  });

  it("shows no note to Claude Code's internal agents", () => {
    expect(briefs(toEvent("subagent-stop", { ...subagent, agent_type: "" }, quiet)), "an empty type").toBe(false);
    expect(briefs(toEvent("subagent-stop", { ...subagent, agent_type: "leader" }, { ...quiet, sessionAgent: () => "leader" })), "the session's own type").toBe(
      false,
    );
  });

  it("passes a guardrail refusal and a note at the same hand-back to the agent together", () => {
    expect(ridesRefusal("turn-end"), "a held turn is told its notes").toBe(true);
    for (const moment of ["session", "touch", "command"] as const) expect(ridesRefusal(moment), `${moment}: a refused call is not`).toBe(false);
    for (const hook of ["stop", "subagent-stop"] as const) {
      const held = toResult(hook, { refused: [{ moment: "turn-end", block: block() }], shown: [recap] });
      expect(held.exitCode, "still held").toBe(2);
      expect(held.stdout, "exit 2 is read from stderr, so both are there").toBe("");
      expect(held.stderr).toContain("flow — turn held open");
      expect(held.stderr).toContain("No TODOs in shipped code.");
      expect(held.stderr).toContain("# breadcrumb: t.recap (first-touch)\nWrite the recap before you hand back.");
      expect(held.stderr.indexOf("turn held open"), "the refusal first, then the note").toBeLessThan(held.stderr.indexOf("# breadcrumb"));
    }
  });

  it("is not shown while the config will not load: the fault is told, and the turn ends", () => {
    const answer = whileBroken(toEvent("stop", { session_id: "s1" }, quiet), "broken");
    expect(answer.shown, "a note would keep the agent working").toStrictEqual([]);
    expect(answer.told).toBe(`broken\n\n${FLOW_OFF}`);
  });
});

describe("who the session is, from what the host wrote", () => {
  // The message Claude Code sends for a subagent's call: its id and type, and the PARENT's path.
  const parent = "/c/projects/p/s1.jsonl";
  const subagent = { session_id: "s1", agent_id: "a6009b5", agent_type: "builder", transcript_path: parent };

  it("takes the agent type from the hook message and the brief from the subagent's own transcript", () => {
    const facts = sessionFactsFrom({ payload: subagent, transcript: human("Follow `/work build`") });
    expect(facts).toStrictEqual({ head: "Follow `/work build`", subagent: true, agentType: "builder" });
  });

  it("finds a subagent's own transcript under the parent's, by its agent id", () => {
    expect(ownTranscriptPath(subagent)).toBe("/c/projects/p/s1/subagents/agent-a6009b5.jsonl");
    // At SubagentStop the host also sends the path itself, and it is the one worked out here.
    const handBack = { ...subagent, agent_id: "a1b1bb5ff0fc0ca82", agent_transcript_path: "/c/projects/p/s1/subagents/agent-a1b1bb5ff0fc0ca82.jsonl" };
    expect(ownTranscriptPath(handBack), "the host's agent_transcript_path").toBe(handBack.agent_transcript_path);
    expect(ownTranscriptPath({ session_id: "s1", transcript_path: parent }), "the parent reads its own").toBe(parent);
    expect(ownTranscriptPath({ session_id: "s1", agent_id: "a1" }), "no path sent, none to read").toBeNull();
    expect(ownTranscriptPath({ ...subagent, transcript_path: "/c/projects/p/s1" }), "not a transcript").toBeNull();
    expect(ownTranscriptPath({ ...subagent, agent_id: "../../etc/x" }), "an id that leaves the folder").toBeNull();
  });

  it("keeps a subagent a subagent when its message carries no type — spawned, but as what we cannot say", () => {
    const facts = sessionFactsFrom({ payload: { session_id: "s1", agent_id: "a1", transcript_path: parent }, transcript: null });
    expect(facts.subagent, "the agent id alone makes it a subagent, with no file read").toBe(true);
    expect(facts.agentType, "a category keyed on a type declines; the parent must not claim it").toBeUndefined();
    expect(facts.head).toBe("");
  });

  it("reads the parent by ABSENCE — no agent id, no type — even when a top-level --agent session sends a type", () => {
    const plain = sessionFactsFrom({ payload: { session_id: "s" }, transcript: human("hello") });
    expect(plain).toStrictEqual({ head: "hello", subagent: false });
    const named = sessionFactsFrom({ payload: { session_id: "s", agent_type: "leader" }, transcript: human("hello") });
    expect(named, "agent_type without agent_id is the top-level session's own").toStrictEqual(plain);
  });

  it("names the agent a message came from the one way: main, or the subagent's id with its type when sent", () => {
    expect(agentOf(subagent)).toStrictEqual({ agent: "a6009b5", agentType: "builder" });
    expect(agentOf({ session_id: "s1", agent_id: "a1" }), "a subagent sent with no type").toStrictEqual({ agent: "a1" });
    expect(agentOf({ session_id: "s1", agent_id: "a1", agent_type: "" }), "an empty type is none").toStrictEqual({ agent: "a1" });
    expect(agentOf({ session_id: "s" }), "the session itself").toStrictEqual({ agent: "main" });
    expect(agentOf({ session_id: "s", agent_type: "leader" }), "a top-level --agent session is still main").toStrictEqual({ agent: "main" });
  });

  it("reads the branch out of HEAD's own text, ref or detached", () => {
    // A file read rather than a `git` subprocess: the marker is written on every tool call, and it
    // is the only form that answers on an unborn branch — every repo's own first commit.
    expect(branchFromHead("ref: refs/heads/workflow/flow\n")).toBe("workflow/flow");
    expect(branchFromHead("9f2c1a4b8e7d6c5b4a39\n"), "detached — the short sha").toBe("9f2c1a4b8e7d");
    expect(branchFromHead("  \n")).toBeNull();
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

  it("reads a recipe body whole, so a loop over several lines is commands, and an assignment is no tool", () => {
    const looped = ["check:", "    for f in a b; do \\", "      npx tsc -p $f; \\", "    done", "    FLOW_MACHINE_REPORT=1 npx vitest run", "    @-rm -rf dist"].join("\n");
    expect(recipeTools(looped).sort()).toEqual(["rm", "tsc", "vitest"]);
    // A body that does not parse whole is read line by line, and a line that does not parse names nothing.
    expect(recipeTools(["a:", '    printf "unclosed', "    eslint ."].join("\n"))).toEqual(["eslint"]);
  });

  it("judges a line that holds a heredoc: the commands around it count, the body it is fed does not", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("cat > notes.md <<'EOF'\nnpx vitest run\nEOF\nnpx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("git commit -F - <<'EOF'\nfix: run eslint\nEOF", tools)).toEqual({ recipes: [], bypasses: [], commits: true });
    expect(classifyBash("python3 - <<'PY'\nimport os\nPY\njust test", tools)).toEqual({ recipes: ["test"], bypasses: [], commits: false });
    // A body a shell reads is commands, and runs.
    expect(classifyBash("bash <<'EOF'\neslint .\nEOF", tools).bypasses).toEqual(["eslint"]);
    // A tool named inside another command's quoted argument is not run.
    expect(classifyBash('gh issue create --body "ran npx vitest run"', tools).bypasses).toEqual([]);
    expect(classifyBash('echo "x', tools), "a line that does not parse").toEqual({ recipes: [], bypasses: [], commits: false });
  });

  it("tells a recipe call from going round it, and leaves a heredoc alone", () => {
    const tools = ["vitest", "eslint"];
    expect(classifyBash("just test && just lint", tools)).toEqual({ recipes: ["test", "lint"], bypasses: [], commits: false });
    expect(classifyBash("npx vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    // A tool run by its path is the tool.
    expect(classifyBash("node_modules/.bin/vitest run", tools)).toEqual({ recipes: [], bypasses: ["vitest"], commits: false });
    expect(classifyBash("./node_modules/.bin/eslint .", tools)).toEqual({ recipes: [], bypasses: ["eslint"], commits: false });
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
  it("watches the config and the host's registrations", () => {
    // That the repo half FOLLOWS the config's own imports is proved in "the guard's own files",
    // further down this file.
    const paths = guardPaths(`import { house } from "./rules/house.ts";`);

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

/** The events flow registers, in its order. Pinned once, by the test that names exactly what is registered. */
const REGISTERED_EVENTS = HOOK_REGISTRATIONS.map((r) => r.event);

/** The same, as init and status print a list of them. */
const LISTED = REGISTERED_EVENTS.join(" · ");

/** The settings file an init before 0.3.0 wrote: every registration today's writes, but SubagentStop. */
const BEFORE_SUBAGENT_STOP = {
  hooks: Object.fromEntries(
    Object.entries((withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks).filter(([event]) => event !== "SubagentStop"),
  ),
};

/** flow's registrations, each running the command `as` makes of today's one. */
const registrationsAs = (as: (command: string) => string): { hooks: Record<string, unknown[]> } => ({
  hooks: Object.fromEntries(
    HOOK_REGISTRATIONS.map((r) => [
      r.event,
      [{ ...(r.matcher === undefined ? {} : { matcher: r.matcher }), hooks: [{ type: "command", command: as(r.command) }] }],
    ]),
  ),
});

/** The registrations an older `flow init` wrote: each the bare `flow hook <event>`. */
const BARE_SETTINGS = registrationsAs((command) => command.replace(/^.* flow /, "flow "));

describe("the hook registrations flow writes", () => {
  it("names exactly the events it answers, and Notification is not one", () => {
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).toEqual(["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop"]);
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).not.toContain("Notification");
  });

  it("registers each event once — two registrations on one event fire twice", () => {
    expect(new Set(HOOK_REGISTRATIONS.map((r) => r.event)).size).toBe(HOOK_REGISTRATIONS.length);
  });

  it("commands a word this build answers to — the list is derived, so it cannot name one it doesn't", () => {
    for (const registration of HOOK_REGISTRATIONS)
      expect(ourHookCommand(registration.command), registration.command).toBe(true);
    expect(HOOK_REGISTRATIONS.map((r) => r.command)).toContain(
      'f="$CLAUDE_PROJECT_DIR/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook session-start; exec flow hook session-start',
    );
  });

  // A `flow` in node_modules/.bin can be anyone's: Facebook's `flow-bin` installs one, and nothing
  // guards the folder. Every caller flow writes runs its own package's file, by path, or the PATH's.
  it("writes no command that finds flow through node_modules/.bin — only its own package's file, then the PATH", () => {
    for (const command of [...HOOK_REGISTRATIONS.map((r) => r.command), PRE_COMMIT]) {
      expect(command, command).not.toContain(LOCAL_BIN);
      expect(command, command).not.toMatch(/\bPATH=/);
      expect(command, command).toContain(PACKAGE_BIN);
    }
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
    expect(added).toEqual(REGISTERED_EVENTS);
    const after = settings as { permissions: unknown; hooks: Record<string, unknown[]> };
    expect(after.permissions, "untouched, byte for byte").toEqual(before.permissions);
    expect(registeredEvents(settings)).toEqual(REGISTERED_EVENTS);
    expect(after.hooks["Stop"]).toEqual([{ hooks: [{ type: "command", command: hookCommand("stop") }] }]);
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
    expect(JSON.stringify(stop)).toContain(JSON.stringify(hookCommand("stop")));
  });

  it("asks for every tool after the call, succeeded or failed — any tool can change the tree", () => {
    const matcher = (event: string): string | undefined => HOOK_REGISTRATIONS.find((r) => r.event === event)?.matcher;
    expect(matcher("PostToolUse")).toBe("*");
    expect(matcher("PostToolUseFailure")).toBe("*");
    expect(HOOK_REGISTRATIONS.find((r) => r.event === "PostToolUseFailure")?.command).toBe(hookCommand("post-tool-use-failure"));
  });

  it("widens its OWN narrow registration in place, and says so — a second entry would fire twice", () => {
    const older = {
      hooks: {
        ...(withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks,
        PostToolUse: [
          { matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: hookCommand("post-tool-use") }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --after" }] },
        ],
      },
    };
    expect(staleRegistrations(older)).toEqual(["PostToolUse"]);
    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(["PostToolUse (widened to every tool)"]);
    const post = (settings as { hooks: Record<string, unknown[]> }).hooks["PostToolUse"];
    expect(post).toEqual([
      { matcher: "*", hooks: [{ type: "command", command: hookCommand("post-tool-use") }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --after" }] },
    ]);
    expect(staleRegistrations(settings), "and a second run finds nothing to widen").toEqual([]);
    expect(withRegistrations(settings).added).toEqual([]);
  });

  it("reads the old shape, the bare `flow hook <event>`, and nothing else as old", () => {
    expect(bareHook("flow hook stop")).toBe("stop");
    expect(bareHook("  flow hook pre-tool-use ")).toBe("pre-tool-use");
    expect(bareHook(hookCommand("stop")), "today's command").toBeNull();
    expect(bareHook("/usr/local/bin/flow hook stop"), "a path names the copy it runs").toBeNull();
    expect(bareHook("node /x/flow/dist/flow.mjs hook stop")).toBeNull();
    expect(bareHook("flow hook nonsense"), "a word we do not answer to").toBeNull();
    expect(bareHook("work hook stop")).toBeNull();
  });

  // THE MACHINE-WIDE FILE AN OLDER INIT WROTE: its registrations in the old shape. They are flow's,
  // so status counts them, and init rewrites them where they stand — a new entry beside each would
  // run flow twice for every event.
  it("counts the old shape as flow's, and rewrites it in place to the new command", () => {
    const older = {
      model: "opus",
      hooks: Object.fromEntries(
        Object.entries(BARE_SETTINGS.hooks).map(([event, entries]) => [
          event,
          [...entries, { hooks: [{ type: "command", command: "their-tool --report" }] }],
        ]),
      ),
    };
    expect(registeredEvents(older), "both shapes are flow's").toEqual(REGISTERED_EVENTS);
    expect(bareRegistrations(older)).toEqual(REGISTERED_EVENTS);
    expect(status(statusFacts({ settings: older })).fittings.find((f) => f.id === "hooks")?.ok).toBe(true);

    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(REGISTERED_EVENTS.map((event) => `${event} (now runs the flow in node_modules/@jawache/flow first)`));
    const hooks = (settings as { model: string; hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> }).hooks;
    const flows = Object.values(hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((h) => h.command)).filter(ourHookCommand));
    expect(flows, "exactly flow's, each the new command").toEqual(HOOK_REGISTRATIONS.map((r) => r.command));
    expect(hooks["PreToolUse"]?.[0]?.matcher, "the matcher stays").toBe("*");
    expect(JSON.stringify(hooks["Stop"]), "theirs is untouched").toContain("their-tool --report");
    expect((settings as { model: string }).model).toBe("opus");
    expect(withRegistrations(settings).added, "and a second run finds nothing to do").toEqual([]);
  });

  it("rewrites only flow's command inside an entry it shares, and widens an old narrow one in the same pass", () => {
    const older = {
      hooks: {
        ...(withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks,
        PostToolUse: [
          {
            matcher: "Read|Glob|Grep|Edit|Write|Bash",
            hooks: [
              { type: "command", command: "flow hook post-tool-use" },
              { type: "command", command: "their-tool --after" },
            ],
          },
        ],
      },
    };
    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(["PostToolUse (widened to every tool, now runs the flow in node_modules/@jawache/flow first)"]);
    expect((settings as { hooks: Record<string, unknown[]> }).hooks["PostToolUse"]).toEqual([
      {
        matcher: "*",
        hooks: [
          { type: "command", command: hookCommand("post-tool-use") },
          { type: "command", command: "their-tool --after" },
        ],
      },
    ]);
  });

  it("leaves a registration with a path to the binary as it is — it names the copy it runs", () => {
    const pinned = registrationsAs((command) => command.replace(/^.* flow /, "node /x/dist/flow.mjs "));
    expect(withRegistrations(pinned).added).toEqual([]);
  });

  it("leaves a by-name command with anything else in it as it is — it is somebody's own", () => {
    for (const prefix of ["FLOW_DEBUG=1 flow ", "cd /x && flow "]) {
      const theirs = registrationsAs((command) => command.replace(/^.* flow /, prefix));
      expect(bareRegistrations(theirs), prefix).toEqual([]);
      expect(withRegistrations(theirs).added, prefix).toEqual([]);
    }
  });

  // An older flow, or a hand, filed a bare command under an event flow does not register today. It
  // is still flow's, and still finds only the PATH, so it is rewritten and reported like the rest.
  it("rewrites an old-shape command under an event flow does not register, and names that event", () => {
    const older = {
      hooks: {
        ...(withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks,
        Notification: [{ hooks: [{ type: "command", command: "flow hook notification" }] }],
      },
    };
    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(["Notification (now runs the flow in node_modules/@jawache/flow first)"]);
    expect((settings as { hooks: Record<string, unknown[]> }).hooks["Notification"]).toEqual([
      { hooks: [{ type: "command", command: hookCommand("notification") }] },
    ]);
  });

  // THE FILE AN INIT BEFORE 0.3.0 WROTE: every registration but SubagentStop. Re-running init adds
  // that one, beside everything already in the file, and rewrites nothing.
  it("adds SubagentStop to a file holding every other registration, and keeps every other key", () => {
    const older = { model: "opus", permissions: { allow: ["Bash(git:*)"] }, hooks: { ...BEFORE_SUBAGENT_STOP.hooks, Notification: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    const { settings, added } = withRegistrations(older);
    expect(added).toEqual(["SubagentStop"]);
    const after = settings as typeof older & { hooks: Record<string, unknown> };
    expect(after.hooks["SubagentStop"]).toEqual([{ hooks: [{ type: "command", command: hookCommand("subagent-stop") }] }]);
    expect({ ...after, hooks: { ...after.hooks, SubagentStop: undefined } }, "nothing else in the file changes").toEqual({
      ...older,
      hooks: { ...older.hooks, SubagentStop: undefined },
    });
    expect(Object.keys(after.hooks), "added at the end; every key already there keeps its place").toEqual([
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "Stop",
      "Notification",
      "SubagentStop",
    ]);
    expect(withRegistrations(settings).added, "and a second run finds nothing to do").toEqual([]);
  });

  it("reads nothing out of a settings file that is not an object", () => {
    expect(registeredEvents(null)).toEqual([]);
    expect(registeredEvents("nonsense")).toEqual([]);
    expect(registeredEvents({ hooks: { Stop: "not an array" } })).toEqual([]);
  });
});

const OLD_GATE = '#!/bin/sh\nstaged=$(git diff --cached --name-only --diff-filter=ACMR)\n[ -z "$staged" ] && exit 0\nexec flow commit $staged\n';

describe("the git gate flow arms", () => {
  it("calls `flow hook commit` and passes nothing — no list, no filter, no early exit", () => {
    expect(PRE_COMMIT.startsWith("#!")).toBe(true);
    expect(PRE_COMMIT, "flow asks git; the hook does not").not.toContain("git diff");
    expect(PRE_COMMIT).not.toContain("exit 0");
  });

  // A DEV DEPENDENCY GUARDS THE REPO: git hands its hooks the PATH it was given, and a repo with
  // flow only as a dev dependency has none there, so the gate runs the repo's own package first.
  it("runs the repo's own @jawache/flow first, then the flow on the PATH", () => {
    const lines = PRE_COMMIT.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
    expect(lines).toEqual([GATE_LOCAL_LINE, GATE_RUN_LINE]);
    expect(GATE_LOCAL_LINE).toBe('f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit');
    expect(GATE_RUN_LINE).toBe("exec flow hook commit");
  });

  it("names one hooks directory, and one gate inside it", () => {
    expect(GATE_PATH).toBe(`${HOOKS_DIR}/pre-commit`);
    expect(SET_HOOKS_PATH, "the report's line and the fitting's fix are one sentence").toContain(HOOKS_DIR);
    expect(PRE_COMMIT, "the hook's own comment tells you what arms it").toContain(SET_HOOKS_PATH);
  });

  it("recognises a gate that runs flow, one that runs the OLD verb, and one that runs something else", () => {
    expect(armsFlow(PRE_COMMIT)).toBe(true);
    expect(armsFlow(OLD_GATE), "flow's own gate from before `flow hook commit`").toBe(false);
    expect(armsOldFlow(OLD_GATE)).toBe(true);
    expect(armsOldFlow(PRE_COMMIT), "the current gate is not the old one, whatever its comment says").toBe(false);
    expect(armsFlow("#!/bin/sh\n# flow hook commit runs here one day\nnpm test\n"), "a comment runs nothing").toBe(false);
    expect(armsFlow('#!/bin/sh\nwork guard commit "$@"\n'), "the old engine's gate").toBe(false);
    expect(armsOldFlow('#!/bin/sh\nwork guard commit "$@"\n')).toBe(false);
    expect(armsFlow(null)).toBe(false);
    expect(armsOldFlow(null)).toBe(false);
  });

  it("reads `flow hook commit [--all]`, refuses a file list, and drops the old verb's list", () => {
    expect(commitScope([], false)).toBe("staged");
    expect(commitScope(["--all"], false)).toBe("all");
    expect(commitScope(["src/a.ts"], false), "a second source of the staged set").toBeNull();
    expect(commitScope(["--all", "src/a.ts"], false)).toBeNull();
    expect(commitScope(["src/a.ts", "src/b.ts"], true), "an older hook's `flow commit $staged`").toBe("staged");
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
  hooksFolder: { dir: ".git/hooks", files: ["pre-commit.sample", "pre-push.sample"], preCommit: null },
  settingsPath: "/home/.claude/settings.json",
  settings: {},
  settingsUnreadable: false,
  machine: null,
  resolves: false,
  packageRoot: "/checkout/flow",
};

/** Flow's two lines at the end of somebody's pre-commit hook: what the block asks a person to add. */
const WIRED = `#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`;

/** A repo husky set up: git runs `.husky/_`, and a person edits `.husky/pre-commit`. */
const husky = (preCommit: string | null): Partial<InitFacts> => ({
  hooksPath: ".husky/_",
  hooksFolder: { dir: ".husky/_", files: ["h", "husky.sh", "pre-commit", "pre-push"], preCommit },
});

/** A repo with a hook of its own in `.git/hooks`, which git runs while `core.hooksPath` is unset. */
const gitHooks = (files: readonly string[], preCommit: string | null = null): Partial<InitFacts> => ({
  hooksFolder: { dir: ".git/hooks", files: ["pre-commit.sample", ...files], preCommit },
});

describe("other hooks — what counts, and the pre-commit hook a person edits", () => {
  const folder = (files: readonly string[], dir = ".git/hooks", preCommit: string | null = null): HooksFolder => ({ dir, files, preCommit });

  it("a fresh `git init` has only sample hooks, and they do not count", () => {
    expect(otherHooks(null, folder(["pre-commit.sample", "pre-push.sample", "update.sample"]))).toBeNull();
    expect(otherHooks(null, folder([])), "nor does an empty or missing folder").toBeNull();
  });

  it("any other file in .git/hooks counts, not only a pre-commit: Git LFS installs pre-push", () => {
    expect(otherHooks(null, folder(["pre-push.sample", "pre-push"]))).toStrictEqual({
      dir: ".git/hooks",
      preCommit: ".git/hooks/pre-commit",
      wired: false,
    });
  });

  it("a core.hooksPath anywhere but .githooks counts, whatever is in it", () => {
    expect(otherHooks(".husky/_", folder([], ".husky/_"))?.dir).toBe(".husky/_");
    expect(otherHooks("hooks", folder([], "hooks"))?.preCommit).toBe("hooks/pre-commit");
  });

  it("flow's own .githooks is not other hooks, whatever .git/hooks holds", () => {
    expect(otherHooks(HOOKS_DIR, folder(["pre-commit"], HOOKS_DIR))).toBeNull();
  });

  it("compares the folder git resolved, so any spelling of .githooks is flow's own", () => {
    for (const set of [".githooks/", "./.githooks", "/repo/.githooks"])
      expect(otherHooks(set, folder(["pre-commit"], hooksDirOf("/repo", set))), set).toBeNull();
  });

  it("names the folder repo-relative when it is inside the repo, and absolute when it is not", () => {
    expect(hooksDirOf("/repo", ".husky/_")).toBe(".husky/_");
    expect(hooksDirOf("/repo", ".git/hooks")).toBe(".git/hooks");
    expect(hooksDirOf("/repo", "..foo/hooks"), "a name that starts with .. is still inside").toBe("..foo/hooks");
    expect(hooksDirOf("/repo", "../sibling/hooks"), "a sibling of the repo is outside it").toBe("/sibling/hooks");
    expect(hooksDirOf("/wt", "/main/.git/hooks"), "a worktree's shared folder").toBe("/main/.git/hooks");
    expect(hooksDirOf("/repo", "."), "the repo root itself is not a folder inside it").toBe("/repo");
  });

  it("is wired once the pre-commit hook a person edits calls flow, and a comment naming it does not", () => {
    expect(otherHooks(".husky/_", folder([], ".husky/_", WIRED))?.wired).toBe(true);
    expect(otherHooks(".husky/_", folder([], ".husky/_", "#!/bin/sh\n# flow hook commit\nnpm test\n"))?.wired).toBe(false);
  });

  it("husky's stub folder `.husky/_` maps to `.husky/pre-commit`; any other folder to its own", () => {
    expect(preCommitOf(".husky/_")).toBe(".husky/pre-commit");
    expect(preCommitOf(".husky/_/")).toBe(".husky/pre-commit");
    expect(preCommitOf(".husky"), "husky 5 to 8 pointed git at .husky itself").toBe(".husky/pre-commit");
    expect(preCommitOf(".git/hooks")).toBe(".git/hooks/pre-commit");
    expect(preCommitOf("/main/.git/hooks"), "a worktree's shared folder is absolute").toBe("/main/.git/hooks/pre-commit");
  });

  it("init's plan carries it, and a repo with no other hooks plans none", () => {
    expect(planInit(bare).otherHooks).toBeNull();
    expect(planInit({ ...bare, ...husky(null) }).otherHooks).toStrictEqual({ dir: ".husky/_", preCommit: ".husky/pre-commit", wired: false });
    expect(planInit({ ...bare, ...gitHooks(["pre-push"]) }).otherHooks?.dir).toBe(".git/hooks");
    expect(planInit({ ...bare, ...husky(null), isGit: false }).otherHooks, "outside git there are no hooks to keep").toBeNull();
    expect(planInit({ ...bare, hooksPath: ".husky/_", hooksFolder: null }).otherHooks, "nor when git could not say").toBeNull();
  });
});

describe("planInit — when git already runs other hooks", () => {
  const block = (plan: ReturnType<typeof planInit>): string[] => {
    const said = initLines(plan, []);
    const at = said.findIndex((line) => line.startsWith(NOT_INSTALLED));
    return at === -1 ? [] : said.slice(at);
  };

  describe("a husky repo whose .husky/pre-commit does not call flow", () => {
    const plan = planInit({ ...bare, ...husky("#!/bin/sh\nnpm test\n") });

    it("leaves core.hooksPath alone, and still writes every other file", () => {
      expect(plan.hooksPath).toBe(false);
      expect(plan.config?.path).toBe("flow.config.ts");
      expect(plan.gate?.path, "the second fix moves hooks in beside this gate").toBe(GATE_PATH);
      expect(plan.flowDir).toBe(true);
      expect(plan.registered).toEqual(REGISTERED_EVENTS);
      expect(initLines(plan, []).join("\n")).not.toContain(`+ ${SET_HOOKS_PATH}`);
    });

    it("ends with the block: the folder git runs hooks from, and both fixes", () => {
      const said = initLines(plan, []);
      const lines = block(plan);
      expect(lines, "the block is the end of the output").toStrictEqual(notInstalledLines({ dir: ".husky/_", preCommit: ".husky/pre-commit", wired: false }));
      expect(said[said.length - lines.length - 1], "set apart from the report by a blank line").toBe("");
      const text = lines.join("\n");
      expect(text).toContain("Git runs hooks from .husky/_");
      expect(text).toContain("Add these two lines to the end of .husky/pre-commit:");
      expect(text).toContain(GATE_LOCAL_LINE);
      expect(text).toContain(GATE_RUN_LINE);
      expect(text).toContain(`move those hooks into ${HOOKS_DIR}/`);
      expect(text).toContain(SET_HOOKS_PATH);
    });

    it("answers 1, whatever else landed", () => {
      expect(initCode(plan, [])).toBe(1);
    });

    it("followed to the letter, the first fix wires it", () => {
      const lines = block(plan);
      const at = lines.findIndex((line) => line.includes("Add these two lines to the end of .husky/pre-commit:"));
      const added = lines.slice(at + 1, at + 3).map((line) => line.trim());
      const followed = `#!/bin/sh\nnpm test\n${added.join("\n")}\n`;
      expect(planInit({ ...bare, ...husky(followed) }).otherHooks?.wired).toBe(true);
    });
  });

  it("run again with nothing left to write, it never says the repo is set up above a block saying it is not", () => {
    const again = planInit({
      ...bare,
      ...husky("#!/bin/sh\nnpm test\n"),
      hasConfig: true,
      gateText: PRE_COMMIT,
      hasFlowDir: true,
      resolves: true,
      settings: withRegistrations({}).settings,
    });
    const said = initLines(again, []).join("\n");
    expect(said).not.toContain("already set up");
    expect(said).toContain("nothing new to write");
    expect(said).toContain(NOT_INSTALLED);
    expect(initCode(again, [])).toBe(1);
  });

  it("a repo with a hook in .git/hooks names that folder and its pre-commit", () => {
    const plan = planInit({ ...bare, ...gitHooks(["pre-push", "post-checkout"]) });
    expect(plan.hooksPath).toBe(false);
    expect(block(plan)[0]).toContain("Git runs hooks from .git/hooks");
    expect(block(plan).join("\n")).toContain("the end of .git/hooks/pre-commit:");
    expect(initCode(plan, [])).toBe(1);
  });

  it("once the hook git runs calls flow, no block, a quiet note, and 0", () => {
    const plan = planInit({ ...bare, ...husky(WIRED) });
    expect(plan.hooksPath, "still never set over husky's").toBe(false);
    expect(block(plan)).toStrictEqual([]);
    expect(initLines(plan, []).join("\n")).toContain("· git runs hooks from .husky/_, and .husky/pre-commit calls flow");
    expect(initCode(plan, [])).toBe(0);
  });

  describe("in a terminal", () => {
    const plan = planInit({ ...bare, ...husky(null) });
    const BOLD_RED = "\u001b[1;31m";
    const RESET = "\u001b[0m";

    it("the block is bold red, line by line, and nothing else is", () => {
      const said = initLines(plan, [], true);
      const at = said.findIndex((line) => line.includes(NOT_INSTALLED));
      expect(said.slice(at)).toStrictEqual(
        notInstalledLines({ dir: ".husky/_", preCommit: ".husky/pre-commit", wired: false }).map((line) => `${BOLD_RED}${line}${RESET}`),
      );
      expect(said.slice(0, at).join("\n"), "the report above it stays plain").not.toContain("\u001b[");
    });

    it("is plain when colour is off, and a repo without the block never carries a colour code", () => {
      expect(initLines(plan, [], false).join("\n")).not.toContain("\u001b[");
      expect(initLines(planInit(bare), [], true).join("\n")).not.toContain("\u001b[");
    });

    it("colour is on only in a terminal, and NO_COLOR set to anything but empty turns it off", () => {
      expect(wantsColour(true, undefined)).toBe(true);
      expect(wantsColour(false, undefined), "piped, or written to a file").toBe(false);
      expect(wantsColour(true, "1")).toBe(false);
      expect(wantsColour(true, "0"), "any value, per no-color.org").toBe(false);
      expect(wantsColour(true, ""), "an empty NO_COLOR is unset, per no-color.org").toBe(true);
    });
  });

  it("a repo with no other hooks gets exactly what it got before: the setting, no block, 0", () => {
    const plan = planInit(bare);
    expect(plan.hooksPath).toBe(true);
    expect(block(plan)).toStrictEqual([]);
    expect(initLines(plan, []).join("\n")).not.toContain("git runs hooks from");
    expect(initCode(plan, [])).toBe(0);
    expect(initCode(plan, ["could not write .githooks/pre-commit: EACCES"]), "a failure is still a 1").toBe(1);
  });
});

describe("planInit — a repo that has never heard of flow", () => {
  const plan = planInit(bare);

  it("writes the config, the gate, the state directory and the link", () => {
    expect(plan.config?.path).toBe("flow.config.ts");
    expect(plan.gate?.path).toBe(GATE_PATH);
    expect(plan.flowDir).toBe(true);
    expect(plan.link).toBe("/checkout/flow");
    expect(plan.hooksPath).toBe(true);
    expect(plan.registered).toEqual(REGISTERED_EVENTS);
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
    hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], preCommit: PRE_COMMIT },
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

  // FOLLOWED TO THE LETTER, the advice must leave a dev-dependency repo able to commit: both lines,
  // the one that puts the repo's own flow first and the one that runs it.
  it("names both of the gate's lines, and a hook that follows it is armed and finds the repo's own flow", () => {
    expect(ADD_THE_GATE_LINE).toContain(GATE_LOCAL_LINE);
    expect(ADD_THE_GATE_LINE).toContain(GATE_RUN_LINE);
    const followed = `#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`;
    expect(armsFlow(followed)).toBe(true);
    const fitting = status(statusFacts({ gateText: followed, binary: { listed: true, copy: true, path: false } })).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok, fitting?.detail).toBe(true);
  });

  it("never overwrites flow's OLD gate either, and says which line to replace", () => {
    const old = planInit({ ...bare, gateText: OLD_GATE });
    expect(old.gate).toBeNull();
    expect(old.gateOld).toBe(true);
    const said = initLines(old, []).join("\n");
    expect(said, "the same instruction status gives, in the same words").toContain(UPDATE_THE_GATE_LINE);
    expect(said).not.toContain(ADD_THE_GATE_LINE);
    expect(planInit({ ...bare, gateText: PRE_COMMIT }).gateKept, "today's gate is simply kept").toBe(false);
  });

  // THE SAME GAP AS A HOOK THAT NEVER RAN FLOW: the old verb's line, replaced by the run line alone,
  // still finds flow on the PATH alone. Followed to the letter, the advice runs the repo's own first.
  it("names both of the gate's lines for the old verb too, and a gate that follows it finds the repo's own flow", () => {
    expect(UPDATE_THE_GATE_LINE).toContain(GATE_LOCAL_LINE);
    expect(UPDATE_THE_GATE_LINE).toContain(GATE_RUN_LINE);
    const followed = OLD_GATE.replace(/^exec flow commit .*$/m, `${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}`);
    expect(armsFlow(followed)).toBe(true);
    expect(armsOldFlow(followed)).toBe(false);
    const fitting = status(statusFacts({ gateText: followed, binary: { listed: true, copy: true, path: false } })).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok, fitting?.detail).toBe(true);
  });
});

describe("the guard's own files — the repo's half read out of the config's text, and the host's", () => {
  // The config as this repo writes it, and as a broken one still reads: the imports survive
  // whatever went wrong two hundred lines below them.
  const CONFIG = [
    `import { defineConfig, pack } from "@jawache/flow";`,
    `import { git, work } from "@jawache/flow/packs";`,
    `import { house } from "./guards/house.ts";`,
    ``,
    `export default defineConfig([pack(git), pack(house)]);`,
  ].join("\n");

  it("is the config, the packs it imports and the host's half, and nothing else", () => {
    // MEMBERSHIP, never order: the one caller asks whether a path is in the list, so an order
    // pinned here would break on a reshuffle that changes nothing a user sees.
    const paths = guardPaths(CONFIG);
    expect(paths, "the host's half is there, whole").toEqual(expect.arrayContaining([...HOST_SURFACE]));
    expect(matchAny(CONFIG_FILE, paths)).toBe(true);
    expect(matchAny("guards/house.ts", paths)).toBe(true);
    expect(matchAny("guards/git.ts", paths), "the folder comes with the file").toBe(true);
    expect(matchAny("guards/nested/deep.ts", paths)).toBe(true);
    expect(matchAny("src/a.ts", paths)).toBe(false);
    expect(matchAny("cli/work.ts", paths)).toBe(false);
    // Not a suffix match: a file that merely ENDS with the config's name is somebody else's.
    expect(matchAny("vendor/flow.config.ts", paths)).toBe(false);
    expect(matchAny("src/guards/thing.ts", paths), "the folder is where the import said").toBe(false);
  });

  it("follows whatever the repo called the folder, and reaches nothing when the config names nothing", () => {
    // The whole point of reading the text: `guards/` is one repo's name for it, and the engine
    // knows no folder name of its own.
    const theirs = guardPaths(`import { house } from "./.guard/house.ts";`);
    expect(matchAny(".guard/house.ts", theirs)).toBe(true);
    expect(matchAny(".guard/helpers/text.ts", theirs)).toBe(true);
    expect(matchAny("guards/house.ts", theirs)).toBe(false);
    // A config with every rule written inline imports no pack, so the repo's half is the config alone.
    const inline = guardPaths(`import { defineConfig } from "@jawache/flow";`);
    expect(new Set(inline)).toStrictEqual(new Set([CONFIG_FILE, ...HOST_SURFACE]));
    expect(new Set(guardPaths(null))).toStrictEqual(new Set([CONFIG_FILE, ...HOST_SURFACE]));
  });

  it("reads the TEXT, not the module — which is the only reader a broken config has", () => {
    // Package specifiers are somebody else's source, never this repo's guard; `../` climbs out
    // of the root, where repo-relative paths cannot follow.
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
    // a parser, and the file being asked about may be one that will not parse. Pinned here because
    // it only ever WIDENS the guard's paths, so the cost is one extra path reported as a guard file.
    expect(configImports(`.message("write it as: import { x } from './guards/x.ts'")`)).toStrictEqual(["guards/x.ts"]);
  });
});

describe("what every rail answers while the config will not load", () => {
  const FAULT = "flow: the config will not load — 1 refusal.";
  const TOLD = `${FAULT}\n\n${FLOW_OFF}`;

  describe("whileBroken — every call goes through, and the agent is told why", () => {
    it("refuses no write, edit, delete or command, and hands each one the load error", () => {
      const files = world({ "src/a.ts": "a", "flow.config.ts": "old" });
      for (const payload of [
        pre("Write", { file_path: "/repo/src/b.ts", content: "fine" }),
        pre("Edit", { file_path: "/repo/src/a.ts", old_string: "a", new_string: "b" }),
        pre("Bash", { command: "rm src/a.ts" }),
        pre("Bash", { command: "npm ci" }),
        pre("Bash", { command: "git reset --hard" }),
      ]) {
        const answer = whileBroken(toEvent("pre-tool-use", payload, files), FAULT);
        expect(answer.refused, `${JSON.stringify(payload.tool_input)} is let through`).toStrictEqual([]);
        expect(answer.shown).toStrictEqual([{ entry: null, cause: "fault", body: TOLD }]);
        expect(answer.told).toBeNull();
        const result = toResult("pre-tool-use", answer);
        expect(result.exitCode).toBe(0);
        expect(result.stdout, "the load error reaches the agent as context").toContain(FAULT);
      }
    });

    it("tells the agent once per answer, however many events the payload carried", () => {
      // One Bash call is a command, each file an `rm` removes, and each file it reads — four
      // events here, and the agent needs the sentence once.
      const events = toEvent("pre-tool-use", pre("Bash", { command: "rm src/a.ts && cat src/b.ts" }), world({ "src/a.ts": "a", "src/b.ts": "b" }));
      expect(events.length).toBeGreaterThan(2);
      expect(whileBroken(events, FAULT).shown).toHaveLength(1);
    });

    it("greets a session with the load error in place of the breadcrumbs", () => {
      expect(whileBroken([{ rail: "brief", moment: "session" }], FAULT).shown.map((note) => note.body)).toStrictEqual([TOLD]);
    });

    it("says nothing after the call, because the agent was told when it asked", () => {
      const changes = [{ path: "src/a.ts", before: "a", after: "b" }];
      const events = toEvent("post-tool-use", pre("Bash", { command: "python3 fix.py" }), { ...world(), changes });
      expect(events.some((event) => event.rail === "guard" && event.observed === true), "the change was seen").toBe(true);
      expect(whileBroken(events, FAULT)).toStrictEqual({ refused: [], shown: [], told: null });
    });

    it("tells turn-end rather than holding it", () => {
      const answer = whileBroken([{ rail: "guard", moment: "turn-end", turn: [] }], FAULT);
      expect(answer.refused, "a held turn cannot hand back to the human who would fix it").toStrictEqual([]);
      expect(answer.told, "and it is not silent either").toBe(TOLD);
    });

    it("says nothing at all when the payload carried no rail", () => {
      expect(whileBroken([], FAULT)).toStrictEqual({ refused: [], shown: [], told: null });
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

describe("settingsFileFor — which settings file holds flow's hooks", () => {
  const machine = "/home/someone/.claude/settings.json";
  const manifest = (body: unknown): string => JSON.stringify(body);

  it("is the repo's own when package.json lists flow as a dev dependency", () => {
    expect(settingsFileFor(manifest({ devDependencies: { "@jawache/flow": "^0.3.0" } }), machine)).toBe(".claude/settings.json");
  });

  it("is the repo's own when package.json lists flow as a dependency", () => {
    expect(settingsFileFor(manifest({ dependencies: { "@jawache/flow": "0.3.0" } }), machine)).toBe(".claude/settings.json");
    expect(listsFlow(manifest({ dependencies: { "@jawache/flow": "0.3.0" } })), "the rule status judges the repo's own copy by").toBe(true);
    expect(listsFlow(manifest({ name: "@jawache/flow" }))).toBe(false);
  });

  it("is the machine-wide one when package.json lists other packages only — this repo, which IS flow, among them", () => {
    expect(settingsFileFor(manifest({ name: "@jawache/flow", devDependencies: { vitest: "^3.0.0" } }), machine)).toBe(machine);
    expect(settingsFileFor(manifest({ peerDependencies: { "@jawache/flow": "*" } }), machine)).toBe(machine);
  });

  it("is the machine-wide one when there is no package.json", () => {
    expect(settingsFileFor(null, machine)).toBe(machine);
  });

  it("is the machine-wide one when package.json will not parse, or is not an object", () => {
    expect(settingsFileFor('{ "devDependencies": { "@jawache/flow": "^0.3.0" }, }', machine)).toBe(machine);
    expect(settingsFileFor("", machine)).toBe(machine);
    expect(settingsFileFor("null", machine)).toBe(machine);
    expect(settingsFileFor('["@jawache/flow"]', machine)).toBe(machine);
    expect(settingsFileFor(manifest({ devDependencies: ["@jawache/flow"] }), machine)).toBe(machine);
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
  // the next line builds a NEW object holding flow's registrations and nothing else.
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
    expect(plan.registered, "every event flow registers").toEqual(REGISTERED_EVENTS);
  });
});

// A DEV DEPENDENCY'S HOOKS are in the repo's own file, and the host merges only IDENTICAL commands
// across its files: an older flow's bare command left in the machine-wide file runs flow twice.
describe("the machine-wide file, beside a dev dependency's own", () => {
  const machinePath = "/home/.claude/settings.json";
  const theirs = { type: "command", command: "lint-on-stop" };
  const older = {
    theme: "dark",
    hooks: {
      ...BARE_SETTINGS.hooks,
      PostToolUse: [{ matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] }],
      Stop: [...(BARE_SETTINGS.hooks["Stop"] ?? []), { hooks: [theirs] }],
      Notification: [{ hooks: [{ type: "command", command: "say done" }] }],
    },
  };

  it("rewrites flow's old commands there to today's, and touches nothing else", () => {
    const { settings, rewritten } = withMachineCommandsUpToDate(older);
    expect(rewritten).toEqual(REGISTERED_EVENTS);
    const after = settings as typeof older;
    expect(after.theme).toBe("dark");
    expect(after.hooks.PostToolUse, "the command is rewritten, the matcher is left as it was").toEqual([
      { matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: hookCommand("post-tool-use") }] },
    ]);
    expect(after.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: hookCommand("stop") }] }, { hooks: [theirs] }]);
    expect(after.hooks.Notification).toEqual(older.hooks.Notification);
    expect(older.hooks.Stop[0], "a new object; the one handed in is not changed").toEqual(BARE_SETTINGS.hooks["Stop"]?.[0]);
  });

  it("adds no registration there, and has nothing to do a second time", () => {
    const none = withMachineCommandsUpToDate({ theme: "dark" });
    expect(none).toEqual({ settings: { theme: "dark" }, rewritten: [] });
    expect(withMachineCommandsUpToDate(null).rewritten).toEqual([]);
    const once = withMachineCommandsUpToDate(older);
    expect(withMachineCommandsUpToDate(once.settings).rewritten).toEqual([]);
  });

  it("is planned and reported by init, and skipped when the file would not parse", () => {
    const facts = { ...bare, settingsPath: ".claude/settings.json", settings: null };
    const plan = planInit({ ...facts, machine: { path: machinePath, settings: older, unreadable: false } });
    expect(plan.machine?.path).toBe(machinePath);
    expect(plan.machine?.rewritten).toEqual(REGISTERED_EVENTS);
    expect(initLines(plan, []).join("\n")).toContain(
      `+ ${machinePath} — ${LISTED} (an older flow's command, now the same as .claude/settings.json's, so each hook runs once)`,
    );
    expect(planInit({ ...facts, machine: { path: machinePath, settings: null, unreadable: true } }).machine).toBeNull();
    expect(planInit({ ...facts, machine: { path: machinePath, settings: { theme: "dark" }, unreadable: false } }).machine).toBeNull();
    expect(planInit(bare).machine, "no machine-wide file to bring in line when it IS the hooks' file").toBeNull();
  });

  const hooks = (machine: unknown) => {
    const facts = statusFacts({ settingsPath: ".claude/settings.json", machine: { path: machinePath, settings: machine } });
    const s = status(facts);
    return { fitting: s.fittings.find((f) => f.id === "hooks"), green: s.green };
  };

  it("turns the hooks line red when the machine-wide file calls flow with another command", () => {
    const { fitting, green } = hooks(older);
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toBe(
      `${machinePath} also calls flow for ${LISTED} the old way, as the bare \`flow hook <event>\`, ` +
        "so Claude Code runs it beside .claude/settings.json's command and each of those hooks fires twice. Re-run `flow init`, which rewrites it to the same command.",
    );
    expect(green).toBe(false);
  });

  // A COMMAND OF SOMEBODY'S OWN runs twice too, and init leaves it: its fix is a hand edit, never
  // "re-run flow init", which would leave the line red for good.
  it("names a command of somebody's own apart, with the fix init cannot make", () => {
    const debug = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "FLOW_DEBUG=1 flow hook stop" }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook pre-tool-use" }] }],
      },
    };
    expect(withMachineCommandsUpToDate({ hooks: { Stop: debug.hooks.Stop } }).rewritten, "init has nothing to rewrite there").toEqual([]);
    const { fitting } = hooks(debug);
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toBe(
      [
        `${machinePath} also calls flow for PreToolUse the old way, as the bare \`flow hook <event>\`, ` +
          "so Claude Code runs it beside .claude/settings.json's command and each of those hooks fires twice. Re-run `flow init`, which rewrites it to the same command.",
        `${machinePath} also calls flow for Stop with a command of its own, ` +
          "so Claude Code runs it beside .claude/settings.json's command and each of those hooks fires twice. Make it the same command as .claude/settings.json's, or remove it from that file.",
      ].join("\n"),
    );
  });

  it("is green when the machine-wide file has the same commands, none of flow's, or nothing", () => {
    for (const machine of [withMachineCommandsUpToDate(older).settings, withRegistrations({}).settings, { theme: "dark" }, null])
      expect(hooks(machine).fitting?.ok, JSON.stringify(machine)).toBe(true);
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
  hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], preCommit: PRE_COMMIT },
  settingsPath: "/home/.claude/settings.json",
  settings: withRegistrations({}).settings,
  machine: null,
  grammars: [],
  session: null,
  ignored: [],
  snapshotInclude: [],
  binary: { listed: false, copy: false, path: true },
  ...over,
});

/** A fresh clone's hooks folder: `core.hooksPath` unset, and `.git/hooks` holding only git's samples. */
const FRESH_CLONE: HooksFolder = { dir: ".git/hooks", files: ["pre-commit.sample", "pre-push.sample"], preCommit: null };

/** The gate an older `flow init` wrote: today's, without the line that runs the repo's own package first. */
const PATH_ONLY_GATE = PRE_COMMIT.replace(`${GATE_LOCAL_LINE}\n`, "");

describe("the binary fitting — can the hooks and the gate find flow", () => {
  const binary = (modules: boolean, path: boolean, over: Partial<StatusFacts> = {}) => {
    const s = status(statusFacts({ binary: { listed: modules, copy: modules, path }, ...over }));
    return { fitting: s.fittings.find((f) => f.id === "binary"), green: s.green, lines: statusLines(s) };
  };

  it("fixes its two old shapes as fixtures: a gate without the PATH line, and the bare registration", () => {
    expect(armsFlow(PATH_ONLY_GATE)).toBe(true);
    expect(PATH_ONLY_GATE).not.toContain(PACKAGE_BIN);
    expect(bareRegistrations(BARE_SETTINGS)).toEqual(HOOK_REGISTRATIONS.map((r) => r.event));
  });

  it("names the PATH when only the PATH has one, in the tutorial's words", () => {
    const { lines, green } = binary(false, true);
    expect(lines).toContain("  ✓ binary: the hooks and the gate run the flow on the PATH");
    expect(green).toBe(true);
  });

  // THE DEV DEPENDENCY: today's gate and registrations run the repo's own package first, so the
  // repo's copy answers them with no flow on the PATH, and wins over one that is there.
  it("names node_modules/@jawache/flow when the repo has its own, whatever the PATH holds", () => {
    for (const path of [false, true]) {
      const { lines, green } = binary(true, path);
      expect(lines).toContain("  ✓ binary: the hooks and the gate run the flow in node_modules/@jawache/flow");
      expect(green).toBe(true);
    }
  });

  it("judges a gate older `flow init` wrote by the PATH alone, and says how to bring it up to date", () => {
    const { fitting, green } = binary(true, false, { gateText: PATH_ONLY_GATE });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toBe(
      "the flow in node_modules/@jawache/flow is not on the PATH, and the gate looks for flow on the PATH alone, so git refuses every commit — " +
        'add `f="$PWD/node_modules/@jawache/flow/dist/flow.mjs"; [ -f "$f" ] && exec node "$f" hook commit` to .githooks/pre-commit above the line that runs flow; ' +
        "or install it for every repo with `npm i -g @jawache/flow`.",
    );
    expect(green).toBe(false);
    expect(binary(true, false, { gateText: OLD_GATE }).fitting?.detail, "the old verb's gate too").toContain("the gate looks for flow on the PATH alone");
  });

  // THE LINE, NOT THE TEXT: a gate that runs another tool from node_modules/.bin, with no PATH
  // line, still finds flow on the PATH alone — and git fails every commit with `flow: not found`.
  it("judges a gate that names node_modules/.bin only for another tool by the PATH alone", () => {
    const lintFirst = "#!/bin/sh\nnode_modules/.bin/lint-staged && flow hook commit\n";
    expect(armsFlow(lintFirst)).toBe(true);
    const { fitting, green } = binary(true, false, { gateText: lintFirst });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the gate looks for flow on the PATH alone");
    expect(fitting?.detail).toContain(`add \`${GATE_LOCAL_LINE}\` to .githooks/pre-commit`);
    expect(green).toBe(false);
    expect(binary(true, false, { gateText: `#!/bin/sh\n  ${GATE_LOCAL_LINE}\nnode_modules/.bin/lint-staged && flow hook commit\n` }).fitting?.ok,
      "the line itself, indented, puts the repo's copy first").toBe(true);
  });

  it("judges registrations in the old shape by the PATH alone, and names `flow init` as the fix", () => {
    const { fitting, green } = binary(true, false, { settings: BARE_SETTINGS });
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the hooks look for flow on the PATH alone, so every hook fails with `flow: not found`");
    expect(fitting?.detail).toContain("re-run `flow init`");
    expect(fitting?.detail).not.toContain("the gate");
    expect(green).toBe(false);
  });

  it("names both when both are old", () => {
    const { fitting } = binary(true, false, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS });
    expect(fitting?.detail).toContain("the hooks and the gate look for flow on the PATH alone");
    expect(fitting?.detail).toContain("every hook fails with `flow: not found` and git refuses every commit");
  });

  it("is green over old callers when the PATH has one, and says which copy each runs", () => {
    expect(binary(true, true, { settings: BARE_SETTINGS }).fitting).toEqual({
      id: "binary",
      ok: true,
      detail: "the hooks run the flow on the PATH, and the gate the flow in node_modules/@jawache/flow",
    });
    expect(binary(true, true, { gateText: PATH_ONLY_GATE }).fitting?.detail).toBe(
      "the hooks run the flow in node_modules/@jawache/flow, and the gate the flow on the PATH",
    );
    expect(binary(false, true, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS }).fitting?.detail).toBe(
      "the hooks and the gate run the flow on the PATH",
    );
  });

  // ONE RULE FOR STATUS AND INIT: a red line whose fix is `flow init` must be one init can carry out.
  it("judges registrations by the rule init rewrites by — a prefixed by-name command is somebody's own", () => {
    const theirs = registrationsAs((command) => command.replace(/^.* flow /, "FLOW_DEBUG=1 flow "));
    expect(withRegistrations(theirs).added, "init has nothing to rewrite").toEqual([]);
    expect(binary(true, false, { settings: theirs }).fitting?.ok, "so status names no fix init would not make").toBe(true);
  });

  it("does not judge a registration with a path to the binary by the PATH — it names its own copy", () => {
    const pinned = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "/usr/local/bin/flow hook stop" }] }] },
    };
    expect(binary(true, false, { settings: pinned }).fitting?.ok).toBe(true);
  });

  it("judges a gate and registrations not there yet as `flow init` will write them — their own fittings are red", () => {
    const { fitting, green } = binary(true, false, { gateText: null, settings: {} });
    expect(fitting?.ok).toBe(true);
    expect(green, "the commit-gate and hooks lines are").toBe(false);
  });

  // INIT'S LINK, in a repo that does not list flow, is the flow that ran init — not the repo's own.
  // Judged by the PATH, the tutorial's global install reads "on the PATH"; with nothing there, it is
  // red on the safe side, and says the link is what runs until it breaks.
  it("judges a copy the repo does not list by the PATH: green with one there, and a red line naming the link without", () => {
    const linked = (path: boolean) => status(statusFacts({ binary: { listed: false, copy: true, path } }));
    expect(statusLines(linked(true))).toContain("  ✓ binary: the hooks and the gate run the flow on the PATH");
    const red = linked(false);
    expect(red.fittings.find((f) => f.id === "binary")).toEqual({
      id: "binary",
      ok: false,
      detail:
        "this repo's package.json does not list @jawache/flow, so node_modules/@jawache/flow is the link `flow init` made to the flow that ran it, " +
        "and no flow is on the PATH. The hooks and the gate run that link only while it resolves, and once it breaks every hook fails " +
        "with `flow: not found` and git refuses every commit — install it for this repo with `npm i -D @jawache/flow`, or for every repo with `npm i -g @jawache/flow`.",
    });
    expect(red.green).toBe(false);
    const listedNotInstalled = status(statusFacts({ binary: { listed: true, copy: false, path: false } })).fittings.find((f) => f.id === "binary");
    expect(listedNotInstalled?.detail, "listed, but not installed yet").toContain(`no flow in ${PACKAGE_DIR} or on the PATH`);
  });

  it("is a red line naming both installs when neither has one, and status is not green", () => {
    for (const over of [{}, { gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS }]) {
      const { fitting, green, lines } = binary(false, false, over);
      expect(fitting?.ok).toBe(false);
      expect(fitting?.detail).toContain(`no flow in ${PACKAGE_DIR} or on the PATH`);
      expect(fitting?.detail).toContain("npm i -D @jawache/flow");
      expect(fitting?.detail).toContain("npm i -g @jawache/flow");
      expect(green).toBe(false);
      expect(lines.at(-1)).toContain("1 red line");
    }
  });
});

describe("hostPath — the PATH git and the host hand their hooks", () => {
  // `npx flow status` and `npm run` put the repo's node_modules/.bin, and every ancestor's, on the
  // PATH of this one run. Counted, a dev dependency's flow is "on the PATH" though git never sees it.
  it("drops the node_modules/.bin npm adds for one run: the repo's own, and an ancestor's", () => {
    const dirs = ["/repo/node_modules/.bin", "/node_modules/.bin", "/opt/homebrew/bin", "/usr/bin"];
    expect(hostPath(dirs, "/repo")).toEqual(["/opt/homebrew/bin", "/usr/bin"]);
    expect(hostPath(["/work/node_modules/.bin/"], "/work/repo"), "a trailing slash is the same folder").toEqual([]);
  });

  it("drops npx's cache of a package it fetched", () => {
    expect(hostPath(["/home/u/.npm/_npx/1a2b3c/node_modules/.bin", "/usr/bin"], "/repo")).toEqual(["/usr/bin"]);
  });

  it("keeps another repo's node_modules/.bin — someone put it on the PATH, so the hooks have it too", () => {
    expect(hostPath(["/elsewhere/node_modules/.bin", "/repo-two/node_modules/.bin"], "/repo")).toEqual([
      "/elsewhere/node_modules/.bin",
      "/repo-two/node_modules/.bin",
    ]);
  });

  it("drops the empty entries a PATH can hold", () => {
    expect(hostPath(["", "/usr/bin", ""], "/repo")).toEqual(["/usr/bin"]);
  });

  // THE FALSE GREEN B5 closes: an old gate and old registrations, flow only as a dev dependency, and
  // status run through npx. The npx folder is not the PATH, so the line is red.
  it("leaves an old gate and old registrations red under npx, with flow only as a dev dependency", () => {
    const holdsFlow = new Set(["/repo/node_modules/.bin"]);
    const onPath = hostPath(["/repo/node_modules/.bin", "/usr/bin"], "/repo").some((dir) => holdsFlow.has(dir));
    const fitting = status(
      statusFacts({ gateText: PATH_ONLY_GATE, settings: BARE_SETTINGS, binary: { listed: true, copy: true, path: onPath } }),
    ).fittings.find((f) => f.id === "binary");
    expect(fitting?.ok).toBe(false);
    expect(fitting?.detail).toContain("the hooks and the gate look for flow on the PATH alone");
  });
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
    // Claude Code delivers every moment the grammar has, so the dark entry is one the grammar would
    // refuse: a guardrail at `session`, handed to status as loaded.
    const s = status({
      ...statusFacts(),
      load: { ok: true, entries: [loaded("demo.early", { kind: "guardrail", at: ["session"], message: "no" })] },
    });
    expect(s.dark).toEqual(["demo.early"]);
    expect(s.green, "a rule that can never fire is a red line").toBe(false);
    expect(statusLines(s).join("\n")).toContain("nothing delivers");
  });

  it("lists a turn-end breadcrumb as one that fires, with no red line — beside the turn-end guardrail", () => {
    const s = status({
      ...statusFacts(),
      load: {
        ok: true,
        entries: [loaded("demo.late", noteAtTurnEnd), loaded("demo.ran", { kind: "guardrail", at: ["turn-end"], message: "no" })],
      },
    });
    expect(s.dark).toEqual([]);
    expect(s.green, "a note shown at the hand-back is in force").toBe(true);
    const page = statusLines(s).join("\n");
    expect(page).not.toContain("nothing delivers");
    expect(page, "listed as a note").toContain("🍞 demo.late");
    const atTurnEnd = s.moments.moments.find((row) => row.moment === "turn-end")?.entries.map((entry) => entry.id);
    expect(atTurnEnd, "under the moment it fires at").toContain("demo.late");
  });

  it("says the session's own categories when a live session marked this worktree", () => {
    const s = status(statusFacts({ session: { id: "s1", agent: "main", wearing: ["parent"] } }));
    expect(statusLines(s).join("\n")).toContain("parent");
  });

  it("says so plainly when nothing has marked one", () => {
    expect(statusLines(status(statusFacts())).join("\n")).toContain("no live session");
  });
});

describe("status — does git run the commit gate", () => {
  const judged = (over: Partial<StatusFacts>) => {
    const s = status(statusFacts(over));
    // As printed: a detail of several lines is several lines on the page.
    const line = statusLines(s).join("\n").split("\n").find((said) => said.includes(" hooks-path: "));
    return { s, fitting: s.fittings.find((f) => f.id === "hooks-path"), line, code: statusCode(s) };
  };
  /** Husky's setup: git runs `.husky/_`, and a person edits `.husky/pre-commit`. */
  const husky = (preCommit: string | null): Partial<StatusFacts> => ({
    hooksPath: ".husky/_",
    hooksFolder: { dir: ".husky/_", files: ["h", "husky.sh", "pre-commit"], preCommit },
  });

  it("flow's own .githooks is green, as it always read", () => {
    const { s, line } = judged({});
    expect(line).toBe(`  ✓ hooks-path: core.hooksPath = ${HOOKS_DIR}`);
    expect(s.green).toBe(true);
  });

  it("counts `.githooks/`, `./.githooks` and an absolute path to it as flow's own, as init does", () => {
    for (const set of [".githooks/", "./.githooks", "/repo/.githooks"]) {
      const { s, line } = judged({ hooksPath: set, hooksFolder: { dir: hooksDirOf("/repo", set), files: ["pre-commit"], preCommit: PRE_COMMIT } });
      expect(line, set).toBe(`  ✓ hooks-path: core.hooksPath = ${HOOKS_DIR}`);
      expect(s.green, set).toBe(true);
    }
  });

  describe("other hooks that do not call flow", () => {
    it("husky's: red, in the words of init's block — the folder and both fixes — and exits 1", () => {
      const { s, fitting, line, code } = judged(husky("npm test\n"));
      const other = { dir: ".husky/_", preCommit: ".husky/pre-commit", wired: false };
      expect(fitting).toStrictEqual({ id: "hooks-path", ok: false, detail: notInstalledLines(other).join("\n") });
      expect(line).toBe(`  ✗ hooks-path: ${NOT_INSTALLED}. Git runs hooks from .husky/_, so flow left core.hooksPath alone, and no commit runs flow's gate.`);
      const said = statusLines(s).join("\n");
      expect(said).toContain("Add these two lines to the end of .husky/pre-commit:");
      expect(said).toContain(GATE_RUN_LINE);
      expect(said).toContain(`move those hooks into ${HOOKS_DIR}/`);
      expect(said).toContain(SET_HOOKS_PATH);
      expect(s.green).toBe(false);
      expect(code).toBe(1);
    });

    it("a hook in .git/hooks, with core.hooksPath unset: red, naming that folder and its pre-commit", () => {
      const { fitting, code } = judged({ hooksPath: null, hooksFolder: { ...FRESH_CLONE, files: [...FRESH_CLONE.files, "pre-push"] } });
      expect(fitting?.ok).toBe(false);
      expect(fitting?.detail).toContain("Git runs hooks from .git/hooks");
      expect(fitting?.detail).toContain("Add these two lines to the end of .git/hooks/pre-commit:");
      expect(code).toBe(1);
    });

    it("hands the same answer over as data, with no colour codes", () => {
      const json = JSON.stringify(status(statusFacts(husky("npm test\n"))));
      expect(json).not.toContain("\u001b");
      const read = JSON.parse(json) as { green: boolean; fittings: Fitting[] };
      expect(read.green).toBe(false);
      expect(read.fittings.find((f) => f.id === "hooks-path")?.detail.startsWith(NOT_INSTALLED)).toBe(true);
    });
  });

  it("other hooks whose pre-commit calls flow: green, naming the folder and the hook", () => {
    const { s, line, code } = judged(husky(`#!/bin/sh\nnpm test\n${GATE_LOCAL_LINE}\n${GATE_RUN_LINE}\n`));
    expect(line).toBe("  ✓ hooks-path: git runs hooks from .husky/_, and .husky/pre-commit calls flow");
    expect(s.green).toBe(true);
    expect(code).toBe(0);
  });

  it("no other hooks and core.hooksPath unset: the red line it always was, with the setting to make", () => {
    const { fitting } = judged({ hooksPath: null, hooksFolder: FRESH_CLONE });
    expect(fitting).toStrictEqual({
      id: "hooks-path",
      ok: false,
      detail: `core.hooksPath is unset — run \`${SET_HOOKS_PATH}\`. It is per-clone, so every fresh checkout needs it.`,
    });
    expect(fitting?.detail).not.toContain(NOT_INSTALLED);
  });

  it("when git could not say, reads the setting as typed", () => {
    expect(judged({ hooksFolder: null }).fitting?.ok).toBe(true);
    expect(judged({ hooksPath: ".husky/_", hooksFolder: null }).fitting?.detail).toContain(SET_HOOKS_PATH);
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
        load: { ok: false, refusals: [{ code: "no-block-cases", entry: "demo.x", detail: "`demo.x` has no block case." }] },
      }),
    );
    expect(s.green).toBe(false);
    const said = statusLines(s).join("\n");
    expect(said).toContain("has no block case");
    expect(said, "no moment table under a headline saying nothing is armed").not.toContain("commit  ");
  });

  it("an unarmed git gate", () => {
    expect(red({ gateText: null })).toContain("flow init");
    const theirs = red({ gateText: "#!/bin/sh\nnpm test\n" });
    expect(theirs).toContain("does not call flow");
    expect(theirs, "the same instruction init gives, in the same words").toContain(ADD_THE_GATE_LINE);
    const old = red({ gateText: OLD_GATE });
    expect(old, "an old gate still runs, and misses every deletion").toContain("calls the old `flow commit`");
    expect(old, "the same instruction init gives, in the same words").toContain(UPDATE_THE_GATE_LINE);
  });

  it("a hooksPath git was never told about — the one a fresh clone always needs", () => {
    expect(red({ hooksPath: null, hooksFolder: FRESH_CLONE })).toContain(SET_HOOKS_PATH);
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
    const s = status(statusFacts({ gateText: null, hooksPath: null, hooksFolder: FRESH_CLONE }));
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
      { load: { ok: false, refusals: [{ code: "no-block-cases", entry: "demo.x", detail: "no block case" }] } },
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

  // An init before 0.3.0 wrote every registration but SubagentStop. Status checks it like the rest.
  it("goes red on a file without SubagentStop, and says re-running init adds it", () => {
    const s = status(statusFacts({ settings: BEFORE_SUBAGENT_STOP }));
    expect(s.fittings.find((f) => f.id === "hooks")?.ok).toBe(false);
    expect(s.green).toBe(false);
    expect(red({ settings: BEFORE_SUBAGENT_STOP })).toContain("/home/.claude/settings.json does not call flow for SubagentStop — re-run `flow init`.");
    expect(status(statusFacts()).fittings.find((f) => f.id === "hooks")?.detail, "every one, and it is green").toBe(
      `/home/.claude/settings.json — ${LISTED}`,
    );
  });

  // Each event carries its own rails, so a missing one costs those and no others: a file without
  // SubagentStop still guards every tool call and the main chat's hand-back.
  it("names only the rails of the missing events as not firing", () => {
    const only = status(statusFacts({ settings: BEFORE_SUBAGENT_STOP })).fittings.find((f) => f.id === "hooks")?.detail;
    expect(only).toBe(
      "/home/.claude/settings.json does not call flow for SubagentStop — re-run `flow init`. Until it does, no turn-end rule runs when a subagent hands back.",
    );
    const hooks = { ...BEFORE_SUBAGENT_STOP.hooks, PreToolUse: undefined };
    expect(status(statusFacts({ settings: { hooks } })).fittings.find((f) => f.id === "hooks")?.detail).toBe(
      "/home/.claude/settings.json does not call flow for PreToolUse · SubagentStop — re-run `flow init`. " +
        "Until it does, no rule judges a tool call before it runs; no turn-end rule runs when a subagent hands back.",
    );
    const none = status(statusFacts({ settings: {} })).fittings.find((f) => f.id === "hooks")?.detail ?? "";
    for (const registration of HOOK_REGISTRATIONS) expect(none, "a file with none names every cost").toContain(registration.event);
    expect(none).toContain("no note is shown when a session starts; no rule judges a tool call before it runs;");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELTA — what a call changed, judged, and what is put back
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("stagedChanges — one question to git, and every staged change comes back with what it is", () => {
  it("splits git's -z answer into what the commit holds, what is new, and what it removes", () => {
    // `--no-renames` already split the rename: its old path is a D, its new one an A.
    const z = ["A", "m/2.sql", "M", "src/a.ts", "D", "m/1.sql", "A", "m/1b.sql", "D", "a path with spaces.sql", "T", "bin/x", ""].join("\0");
    expect(stagedChanges(z)).toEqual({
      files: ["m/2.sql", "src/a.ts", "m/1b.sql", "bin/x"],
      added: ["m/2.sql", "m/1b.sql"],
      deleted: ["m/1.sql", "a path with spaces.sql"],
    });
  });

  it("reads nothing staged as an empty commit", () => {
    expect(stagedChanges("")).toEqual({ files: [], added: [], deleted: [] });
  });
});

describe("treeChanges — the whole tree as one commit, against the last commit's own list", () => {
  const ran = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
  const unasked = (): boolean => {
    throw new Error("HEAD was asked about although the tree answered");
  };

  it("marks what the last commit lacks as new, and what it has that is gone as removed", () => {
    const tree = ran(["m/1.sql", "m/gone.sql", "src/a.ts", ""].join("\0"));
    expect(treeChanges(["m/1.sql", "m/2.sql", "src/a.ts"], tree, unasked)).toEqual({
      files: ["m/1.sql", "m/2.sql", "src/a.ts"],
      added: ["m/2.sql"],
      deleted: ["m/gone.sql"],
    });
  });

  it("treats every file as new before the first commit, when there is no HEAD to list", () => {
    expect(treeChanges(["m/1.sql"], ran("", 128), () => false)).toEqual({ files: ["m/1.sql"], added: ["m/1.sql"], deleted: [] });
  });

  it("says nothing is known when git failed for any other reason, so a check refuses rather than allows", () => {
    expect(treeChanges(["m/1.sql"], ran("", 127), () => true)).toEqual({ files: ["m/1.sql"], added: undefined, deleted: [] });
  });
});

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
      { rail: "guard", moment: "write", file: { path: "src/a.ts", content: "a // TODO\n", existed: true }, observed: true },
      { rail: "guard", moment: "write", file: { path: "src/new.ts", content: "new\n", existed: false }, observed: true },
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
      { rail: "guard", moment: "write", file: { path: "src/a.ts", content: "a // TODO\n", existed: true }, observed: true },
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
});

describe("an observed refusal — its own banner, and what was put back", () => {
  const noTodo: Block = { do: "block", entry: "house.noTodo", message: "No TODOs in src/ — do it now, or track it properly.", subject: "src/b.ts", detail: "line 3 says TODO" };
  const b = { path: "src/b.ts", before: "b\n", after: "TODO\n" };

  it("prints the example on docs/user/explanation/what-the-guard-sees.md: the reverted banner, the entry, and the two-sentence tail", () => {
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

  it("reports a call it could not see — loud, exit 2, the call ran and nothing it changed was checked", () => {
    const said = deltaFault("No snapshot was taken before this call.");
    expect(said.exitCode).toBe(2);
    expect(said.stderr).toBe(
      "\nflow — could not see what this call changed:\n\nNo snapshot was taken before this call.\n\n" +
        "The call ran, and nothing it changed was checked or put back. Check what the call changed before you go on.\n",
    );
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

  it("leaves out of the diff each changed path that matches HEAD after the call, and keeps every other", () => {
    // git diff-tree --name-status -z, in git's order: two files on disk, one gone.
    const diff = "A\0migrations/002.sql\0M\0src/a.ts\0A\0src/legacy.ts\0";
    // src/a.ts still differs from HEAD after the call (the agent's edit); the other two now agree with it.
    expect(authored(diff, ["src/a.ts", "notes.md"], ["src/a.ts"])).toEqual(["src/a.ts"]);
    expect(authored(diff, [], []), "a call that leaves the tree equal to HEAD authored nothing").toEqual([]);
    expect(authored(diff, null, null), "no HEAD the repo had before the call — none yet, or one the call made: every change is the agent's").toEqual([
      "migrations/002.sql",
      "src/a.ts",
      "src/legacy.ts",
    ]);
  });

  it("leaves out a removal only when HEAD held the file before the call and does not hold it after", () => {
    const diff = "D\0migrations/002.sql\0D\0.env\0D\0notes.md\0";
    // Before the call HEAD held 002.sql (so it differs from the tree it is gone from); after, nothing
    // holds any of the three. .env and notes.md are in neither commit: the agent removed them.
    expect(authored(diff, [], ["migrations/002.sql"])).toEqual([".env", "notes.md"]);
    expect(authored(diff, [], null), "no HEAD before the call: nothing was git's to remove").toEqual(["migrations/002.sql", ".env", "notes.md"]);
    // HEAD still holds 002.sql after the call, so the removal differs from it, whatever HEAD held before.
    expect(authored(diff, ["migrations/002.sql"], ["migrations/002.sql"])).toEqual(["migrations/002.sql", ".env", "notes.md"]);
  });

  it("reads git's -z answer as paths, with no quoting and no empty tail", () => {
    expect(nulPaths("src/a b.ts\0src/\"q\".ts\0")).toEqual(["src/a b.ts", 'src/"q".ts']);
    expect(nulPaths("")).toEqual([]);
  });
});
