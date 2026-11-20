// flow/adapter/claude/domain.test.ts — the Claude Code dialect, proved as decisions.
//
// This is the file that knows what a hook payload and a transcript line mean, so it is the file
// where the harness's shape is pinned. Four claims carry it:
//
//   PAYLOAD → EVENT     the command and the files a Bash line carries, and silence for anything flow was not asked for.
//   EFFECT → RESULT     one refusal spelling — exit 2, the text on stderr — and one injection
//                       spelling, the decision object.
//   THE TRANSCRIPT      the four dialect leaks that used to live in a pure home: drift's token
//                       count, the turn's actions, the brief, and the tool row.
//   REGISTERING         the hook registrations flow writes into Claude Code's settings file, and
//                       what `flow init`, `flow status` and `flow uninstall` make of them.
//
// It is a unit suite because every one of those is a function of its arguments: a payload is an
// object and a transcript is a string. The live wiring is proved next door, against the built
// binary, over stdin.
import { describe, it, expect } from "vitest";
import { breadcrumb, defineCategory, defineConfig, definePack, guardrail, loadConfig, override, pack, session, spawnedAs, turnEnd, type LoadedEntry, type LoadResult, type TurnAction } from "../../index.ts";
import { metrics, momentsView, type Block, type Bound, type Row } from "../../engine/domain.ts";
import { parseCommandLine, parseShellSteps } from "../../language/domain.ts";
import { claudeCode } from "./claude.ts";
import { type AdapterEvent, agentOf, ALLOW, awaitsBrief, bashReads, branchFromHead, briefBlock, commandFolders, COMMIT_MSG, CONFIG_FILE, decision, type EventWorld, type Facts, FLOW_OFF, foldersBetween, formatFacts, GATE_PATH, guardPaths, holdsForBrief, HOOKS_DIR, type InitFacts, initLines, isGuardPath, isHookEvent, lastMode, LOCAL_BIN, MACHINE_FLAG, mergeNarratives, modesOf, nothingBound, opensCall, outsideOf, PACKAGE_BIN, planInit, planUninstall, reachesAnotherWorktree, readFault, relativise, ridesRefusal, sessionFactsFrom, shellReadRows, type Shown, type SpawnRecord, type Status, status, statusCode, type StatusFacts, statusLines, toEvent, toolRow, toResult, uninstallCode, type UninstallFacts, uninstallLines, weakenedAfterBlock, whileBroken, workedPaths, worktreeFolders, worktreesWorkedIn } from "../domain.ts";
import { EDIT_TOOLS, HOST_SURFACE, REPO_SETTINGS, agentSettingOf, bareHook, briefHead, classifyStore, contextTokens, editedFile, hookCommand, hooksFile, isInjected, ourHookCommand, ownTranscriptPath, parseEvents, projectFolderName, spawnMeta, spawnsIn, steerOf, tokensFromTranscript, transcriptHead, transcriptLines, turnActions } from "./domain.ts";

const { registrations: HOOK_REGISTRATIONS, hooks: HOOK_COSTS, registeredEvents, staleRegistrations, bareRegistrations, withRegistrations, withoutRegistrations } = hooksFile;
import { type HookPayload, type Steer, type TranscriptEvent } from "../harness.ts";


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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PAYLOAD → EVENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── Bash reads — what a shell command reads, for the touch breadcrumb ───────────

describe("bashReads — the files a Bash command reads, before it runs", () => {
  const HOME = "/home/me";
  const at = (command: string, cwd = ROOT, home: string | undefined = HOME): { reads: readonly string[]; searched: readonly string[] } => {
    const where = { cwd, root: ROOT, home };
    return bashReads(parseShellSteps(command, where), where);
  };
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

  it("reads an unquoted value the line sets as the words the shell splits it into", () => {
    expect(reads('F="a.ts b.ts"; cat $F')).toStrictEqual(["a.ts", "b.ts"]);
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
    // `-C` is the parse's: chained after a `cd`, and after another `-C`.
    expect(searched("cd sub && git -C a diff -- x")).toStrictEqual(["sub/a/x"]);
    expect(searched("git -C a -C b diff -- x")).toStrictEqual(["a/b/x"]);
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

describe("relativise", () => {
  it("relativises against the root, because that is how every glob is written", () => {
    expect(relativise("/repo/src/a.ts", ROOT)).toBe("src/a.ts");
    expect(relativise("src/a.ts", ROOT), "already relative").toBe("src/a.ts");
    expect(relativise("/elsewhere/a.ts", ROOT), "outside the repo stays absolute").toBe("/elsewhere/a.ts");
  });
});

describe("toEvent — one payload, every moment it carries", () => {
  it("turns a session start into the session moment", () => {
    expect(toEvent("session-start", { source: "startup" }, world())).toStrictEqual([
      { rail: "brief", moment: "session" },
    ]);
  });

  it("turns a subagent's start into the session moment, and an internal agent's into nothing", () => {
    const started = { session_id: "s1", agent_id: "a1", agent_type: "general-purpose", hook_event_name: "SubagentStart" };
    expect(toEvent("subagent-start", started, world())).toStrictEqual([{ rail: "brief", moment: "session" }]);
    expect(JSON.parse(decision("subagent-start", "x"))).toStrictEqual({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: "x" },
    });
    expect(toEvent("subagent-start", { ...started, agent_type: "" }, world()), "an empty type").toStrictEqual([]);
    expect(toEvent("subagent-start", { ...started, agent_type: "leader" }, { ...world(), sessionAgent: () => "leader" }), "the session's own agent").toStrictEqual([]);
  });

  it("adds the session notes held for the brief to a subagent's call, after its guard events", () => {
    const held = { ...world(), heldForBrief: true };
    expect(toEvent("post-tool-use", pre("Read", { file_path: "/repo/src/a.ts" }), held), "the first call that runs, held notes only").toStrictEqual([
      { rail: "brief", moment: "session" },
    ]);
    expect(toEvent("post-tool-use", pre("Read", { file_path: "/repo/src/a.ts" }), world()), "nothing held: no event, since a read changed nothing").toStrictEqual([]);
    const bash = toEvent("pre-tool-use", pre("Bash", { command: "git status" }), held).map((event) => `${event.rail}:${event.moment}`);
    expect(bash).toStrictEqual(["guard:command", "brief:session", "brief:command"]);
  });

  it("holds a subagent's session notes for its brief only when a session note is bound to a category, and only before the brief is written", () => {
    const entries = (load: LoadResult): readonly LoadedEntry[] => {
      if (!load.ok) throw new Error(JSON.stringify(load.refusals));
      return load.entries;
    };
    const briefed = defineCategory("briefed", spawnedAs({ generic: ["general-purpose"], brief: ["MARK"] }));
    const bound = entries(loadConfig(defineConfig([pack(definePack("t", { n: breadcrumb().at(session).for(briefed).text("n") }))])));
    const unbound = entries(loadConfig(defineConfig([pack(definePack("t", { n: breadcrumb().at(session).text("n") }))])));
    expect(holdsForBrief(bound)).toBe(true);
    expect(holdsForBrief(unbound), "nothing bound to a category").toBe(false);
    expect(awaitsBrief("subagent-start", null)).toBe(true);
    expect(awaitsBrief("subagent-start", "{}"), "a resumed subagent's brief can be read").toBe(false);
    expect(awaitsBrief("session-start", null), "the main session has no brief to wait for").toBe(false);
    expect(awaitsBrief("pre-tool-use", null)).toBe(false);
  });

  it("turns a Bash call into the command moment on BOTH rails, and a call to any other tool into nothing before it runs", () => {
    // One call, two rails — which is why toEvent answers with a list. The guard rail decides
    // whether the command may run and the brief rail says what the agent should know before it does.
    const events = toEvent("pre-tool-use", pre("Bash", { command: "rm secret/a.ts" }), world({ "secret/a.ts": "the content" }));
    // Every guard event comes first: a refusal carries no notes, so none is judged after one.
    expect(events).toStrictEqual([
      { rail: "guard", moment: "command", command: "rm secret/a.ts", commands: parseCommandLine("rm secret/a.ts", { cwd: "/repo" }), start: { cwd: "/repo", home: undefined } },
      { rail: "brief", moment: "command", command: "rm secret/a.ts" },
    ]);
    // flow stops no write: an Edit, a Write and a MultiEdit carry no moment before they run.
    const edit = { file_path: "/repo/src/a.ts", old_string: "old", new_string: "new" };
    for (const tool of ["Edit", "Write", "MultiEdit"])
      expect(toEvent("pre-tool-use", pre(tool, edit), world({ "src/a.ts": "old" })), tool).toStrictEqual([]);
  });

  it("shows nothing for the files a Bash call reads, and nothing for a call after it ran: what a call changed is git's to say", () => {
    // A read is not a change. The files a command reads are still recorded as `read` rows
    // (`shellReadRows`), and the breadcrumb rail has no event for them.
    const command = "cat a.ts && rg x lib ~/n.md";
    const events = toEvent("pre-tool-use", { ...pre("Bash", { command }), cwd: "/repo/src" }, { ...world(), home: "/repo/home" });
    expect(events.map((event) => `${event.rail}:${event.moment}`)).toStrictEqual(["guard:command", "brief:command"]);
    for (const tool of ["Read", "Grep", "Bash", "Edit", "Write"])
      expect(toEvent("post-tool-use", pre(tool, { file_path: "/repo/docs/x.md" }), world()), `${tool}: the changed files are found by comparing git's list`).toStrictEqual([]);
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
    const result = toResult("pre-tool-use", { refused: [{ moment: "command", block: block() }], shown: [] });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("flow — command blocked before it ran");
    expect(result.stderr).toContain("core.noTodo · src/a.ts");
    expect(result.stderr).toContain("No TODOs in shipped code.");
    expect(result.stderr).toContain("says TODO");
    expect(result.stderr, "a refusal without an instruction leaves a blocked agent guessing").toContain(
      "Adjust the command, then retry.",
    );
  });

  it("banners by the RAIL that refused, not by the hook that carried it", () => {
    const at = (moment: "command" | "commit"): string =>
      toResult("pre-tool-use", { refused: [{ moment, block: block() }], shown: [] }).stderr;
    expect(at("command")).toContain("command blocked before it ran");
    expect(at("commit")).toContain("commit blocked");
    expect(toResult("stop", { refused: [{ moment: "turn-end", block: block() }], shown: [] }).stderr).toContain(
      "turn held open",
    );
  });

  it("carries every refusal, not just the first", () => {
    const result = toResult("pre-tool-use", {
      refused: [
        { moment: "command", block: block({ entry: "one" }) },
        { moment: "command", block: block({ entry: "two" }) },
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
      refused: [{ moment: "command", block: block() }],
      shown: [{ entry: "a", cause: "first", body: "hello" }],
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

  it("heads each note with the mechanism's own name and the moment that showed it, and the load error with its cause", () => {
    const text = briefBlock([
      { entry: "area", cause: "first", moment: "file-change", body: "one" },
      { entry: "drifted", cause: "drift", moment: "command", body: "two" },
      { entry: null, cause: "fault", body: "three" },
    ]);
    expect(text).toBe("# breadcrumb: area (file-change)\none\n\n# breadcrumb: drifted (command)\ntwo\n\n# breadcrumb: flow (fault)\nthree");
  });

  it("names the event in a decision object", () => {
    expect(JSON.parse(decision("post-tool-use", "x"))).toStrictEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "x" },
    });
  });

  it("is LOUD on the one rail that judges a tool call, and speaks without holding on the rest", () => {
    // PreToolUse refuses the call it could not see. After a call there is nothing left to refuse, so
    // the fault is said and the call goes on (#12).
    expect(readFault("pre-tool-use", "unparseable", "not JSON")).toStrictEqual({
      stdout: "",
      stderr: "\n[flow hook pre-tool-use] could not PARSE its payload (not JSON).\n",
      exitCode: 2,
    });
    expect(readFault("post-tool-use", "unparseable", "not JSON")).toStrictEqual({
      stdout: "",
      stderr: "[flow hook post-tool-use] could not PARSE its payload (not JSON).\n",
      exitCode: 0,
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

  it("starts a turn at a background task's notice, though nobody typed it", () => {
    // The notice wakes the agent. Read as an injection, the turn would reach back to the human's
    // last message, and a turn-end rule would be handed the edit from the turn before.
    const jsonl = [
      human("do the thing"),
      assistant([use("Edit", { file_path: "a.ts" })]),
      line({
        type: "user",
        origin: { kind: "task-notification" },
        message: { role: "user", content: "<task-notification>\n<status>completed</status>\n</task-notification>" },
      }),
      assistant([use("Bash", { command: "ls" }), use("Write", { file_path: "b.ts" })]),
    ].join("\n");
    expect(turnActions(jsonl)).toStrictEqual([
      { did: "run", command: "ls" },
      { did: "edit", path: "b.ts" },
    ]);
  });

  it("names only the files an edit tool changes: a read, a search and a shell command change none", () => {
    expect(editedFile({ tool_name: "Write", tool_input: { file_path: "/repo/a.ts" } })).toBe("/repo/a.ts");
    expect(editedFile({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/repo/n.ipynb" } })).toBe("/repo/n.ipynb");
    for (const tool of ["Read", "Grep", "Bash"]) expect(editedFile({ tool_name: tool, tool_input: { file_path: "/repo/a.ts", command: "ls" } }), tool).toBeNull();
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
  const recap: Shown = { entry: "t.recap", cause: "first", moment: "turn-end", body: "Write the recap before you hand back." };
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
        hookSpecificOutput: { hookEventName: name, additionalContext: "# breadcrumb: t.recap (turn-end)\nWrite the recap before you hand back." },
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
    for (const moment of ["session", "file-change", "command"] as const) expect(ridesRefusal(moment), `${moment}: a refused call is not`).toBe(false);
    for (const hook of ["stop", "subagent-stop"] as const) {
      const held = toResult(hook, { refused: [{ moment: "turn-end", block: block() }], shown: [recap] });
      expect(held.exitCode, "still held").toBe(2);
      expect(held.stdout, "exit 2 is read from stderr, so both are there").toBe("");
      expect(held.stderr).toContain("flow — turn held open");
      expect(held.stderr).toContain("No TODOs in shipped code.");
      expect(held.stderr).toContain("# breadcrumb: t.recap (turn-end)\nWrite the recap before you hand back.");
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
    const facts = sessionFactsFrom({ payload: subagent, head: briefHead(human("Follow `/work build`")) });
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
    const facts = sessionFactsFrom({ payload: { session_id: "s1", agent_id: "a1", transcript_path: parent }, head: "" });
    expect(facts.subagent, "the agent id alone makes it a subagent, with no file read").toBe(true);
    expect(facts.agentType, "a category keyed on a type declines; the parent must not claim it").toBeUndefined();
    expect(facts.head).toBe("");
  });

  it("reads the parent by ABSENCE — no agent id, no type — even when a top-level --agent session sends a type", () => {
    const plain = sessionFactsFrom({ payload: { session_id: "s" }, head: briefHead(human("hello")) });
    expect(plain).toStrictEqual({ head: "hello", subagent: false });
    const named = sessionFactsFrom({ payload: { session_id: "s", agent_type: "leader" }, head: briefHead(human("hello")) });
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
    expect(toolRow(pre("Edit", { file_path: "/repo/src/a.ts" }), ROOT, true)).toStrictEqual({
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
    expect(toolRow(moded("Edit", { file_path: "/repo/a.ts" }), ROOT, true)).toMatchObject({ mode: "auto" });
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
    expect(projectFolderName("/Users/x/.hidden/y")).toBe("-Users-x--hidden-y");
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
      { path: "abc/subagents/agent-1.jsonl", meta: "abc/subagents/agent-1.meta.json", session: "abc", agent: "1" },
      // The sidecar is only named when the listing HELD it — the shell never probes for a file.
      { path: "abc/subagents/agent-2.jsonl", meta: null, session: "abc", agent: "2" },
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

});

describe("weakened after a block — the one failure a guard cannot catch itself", () => {
  it("watches the config and the host's registrations", () => {
    // That the repo half FOLLOWS the config's own imports is proved in "the guard's own files",
    // further down this file.
    const paths = guardPaths(`import { house } from "./rules/house.ts";`, HOST_SURFACE);

    // The config's name is spelled ONCE — a second copy here would leave a renamed config's old
    // name watched and its new one not.
    expect(paths).toContain(CONFIG_FILE);
    expect(CONFIG_FILE).toBe("flow.config.ts");
    expect(isGuardPath("flow.config.ts", paths)).toBe(true);
    expect(isGuardPath("src/a.ts", paths)).toBe(false);
    expect(isGuardPath("", paths)).toBe(false);

    // The host's half is fixed, because those are the harness's file names and not a repo's, and it
    // is matched at any depth: a monorepo package carries its own `.claude/`.
    expect(isGuardPath(".claude/settings.json", guardPaths(null, HOST_SURFACE))).toBe(true);
    expect(isGuardPath("packages/app/.claude/settings.json", paths)).toBe(true);
    expect(isGuardPath(".claude/agents/builder.md", paths)).toBe(true);
  });

  it("flags the guardrail edit that followed a block, citing both ends and the gap", () => {
    const rows: Row[] = [
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "deny" },
      { kind: "guardrail", ts: "2026-01-01T10:00:00.000Z", id: "core.noTodo", out: "allow" },
    ];
    const events: TranscriptEvent[] = [
      { line: 4, kind: "use", ts: "2026-01-01T09:00:00.000Z", id: "a", name: "Edit", action: "edit", input: {}, path: "flow.config.ts" },
      { line: 9, kind: "use", ts: "2026-01-01T10:00:30.000Z", id: "b", name: "Edit", action: "edit", input: {}, path: "flow.config.ts" },
      { line: 11, kind: "use", ts: "2026-01-01T10:01:00.000Z", id: "c", name: "Edit", action: "edit", input: {}, path: "src/a.ts" },
    ];
    // The edit BEFORE the block is not a weakening, and neither is one to an ordinary file.
    const paths = guardPaths(null, HOST_SURFACE);
    expect(weakenedAfterBlock(rows, events, paths)).toEqual([{ entry: "core.noTodo", line: 9, path: "flow.config.ts", gapSeconds: 30 }]);
    expect(weakenedAfterBlock(rows, [], paths)).toEqual([]);
    expect(weakenedAfterBlock([], events, paths)).toEqual([]);
  });
});

describe("formatFacts — the whole of what a person sees", () => {
  const empty = (over: Partial<Facts> = {}): Facts => ({
  host: claudeCode.name,
    root: "/repo",
    store: { dir: "/home/.claude/projects/-repo", exists: true, ignored: [] },
    selection: { analyse: [], excluded: [], counts: { backlog: 0, analysed: 0, excluded: 0 } },
    coverage: { analysed: 0, withRecord: 0, narrativeOnly: 0 },
    withoutTranscript: [],
    health: { blocked: null, warn: [] },
    metrics: metrics({ sessions: [], entries: [], nowMs: 0 }),
    moments: momentsView([], null),
    terrain: [],
    narrative: mergeNarratives([]),
    uncovered: [],
    actors: [],
    weakened: [],
    modes: modesOf([]),
    marked: null,
    ...over,
  });

  it("says how many recorded sessions it left out for want of a transcript", () => {
    expect(formatFacts(empty({ withoutTranscript: ["a", "b"] }))).toContain("  excluded  2 recorded sessions with no transcript behind them");
    expect(formatFacts(empty()).join("\n")).not.toContain("excluded");
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

  it("counts the shell's reads beside the edits, lists their paths, and counts no shell write", () => {
    const reads: Record<string, number> = { "src/a.ts": 3, "src/b.ts": 1, "c/1": 1, "c/2": 1, "c/3": 1, "c/4": 1 };
    const narrativeWith = { ...mergeNarratives([]), stats: { ...mergeNarratives([]).stats, shellReads: 8 }, shell: { reads } };
    const text = formatFacts(empty({ narrative: narrativeWith })).join("\n");
    expect(text).toContain("  session   0 edits · 0 writes · 8 shell reads · 0 commits");
    expect(text).toContain("  shell     read src/a.ts 3× · c/1 · c/2 · c/3 · c/4 · …and 1 more");
    expect(text, "a transcript says what ran, never what it changed").not.toContain("shell writes");
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

  it("names an entry that used to catch things and stopped", () => {
    const bound: Bound[] = [
      { kind: "guardrail", id: "core.noTodo", pack: "core", at: ["commit"], on: ["src/**"], for: [], description: null, says: null, disabled: null },
    ];
    const rows: Row[] = [
      { kind: "run", ts: "2026-01-01T00:00:00.000Z", moment: "commit", rules: [{ id: "core.noTodo", evaluated: 1, hits: 1, silenced: 0 }] },
      { kind: "guardrail", ts: "2026-01-01T00:00:00.000Z", moment: "commit", id: "core.noTodo", out: "deny", subject: "src/a.ts" },
      { kind: "run", ts: "2026-02-05T00:00:00.000Z", moment: "commit", rules: [] },
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

/** The events flow registers, in its order. Pinned once, by the test that names exactly what is registered. */
const REGISTERED_EVENTS = HOOK_REGISTRATIONS.map((r) => r.event);

/** A settings file holding every registration today's init writes, but `event`'s. */
const without = (event: string): { hooks: Record<string, unknown> } => ({
  hooks: Object.fromEntries(
    Object.entries((withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks).filter(([e]) => e !== event),
  ),
});

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
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).toEqual(["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"]);
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
    for (const command of [...HOOK_REGISTRATIONS.map((r) => r.command), COMMIT_MSG]) {
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
    const { settings, changed } = withRegistrations(before);
    expect(changed).toEqual(REGISTERED_EVENTS);
    const after = settings as { permissions: unknown; hooks: Record<string, unknown[]> };
    expect(after.permissions, "untouched, byte for byte").toEqual(before.permissions);
    expect(registeredEvents(settings)).toEqual(REGISTERED_EVENTS);
    expect(after.hooks["Stop"]).toEqual([{ hooks: [{ type: "command", command: hookCommand("stop") }] }]);
    expect(after.hooks["PreToolUse"]?.[0]).toMatchObject({ matcher: "Bash" });
  });

  it("adds nothing on a second run — the whole of what makes init idempotent", () => {
    const once = withRegistrations({});
    const twice = withRegistrations(once.settings);
    expect(twice.changed).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
  });

  it("keeps a stranger's registration on the same event and stands beside it", () => {
    const theirs = { hooks: { Stop: [{ hooks: [{ type: "command", command: "their-tool --report" }] }] } };
    const { settings, changed } = withRegistrations(theirs);
    expect(changed).toContain("Stop");
    const stop = (settings as { hooks: Record<string, unknown[]> }).hooks["Stop"];
    expect(JSON.stringify(stop), "theirs survives — we add, we never rewrite").toContain("their-tool --report");
    expect(JSON.stringify(stop)).toContain(JSON.stringify(hookCommand("stop")));
  });

  it("asks for Bash before a call and every tool after it, and for no hook before Edit and Write or after a failed call", () => {
    const matcher = (event: string): string | undefined => HOOK_REGISTRATIONS.find((r) => r.event === event)?.matcher;
    expect(matcher("PreToolUse"), "the one thing flow refuses before it happens is a command").toBe("Bash");
    expect(matcher("PostToolUse")).toBe("*");
    expect(HOOK_REGISTRATIONS.map((r) => r.event)).not.toContain("PostToolUseFailure");
  });

  it("brings its OWN registration up to date in place, and says so — a second entry would fire twice", () => {
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
    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual(["PostToolUse (matcher brought up to date)"]);
    const post = (settings as { hooks: Record<string, unknown[]> }).hooks["PostToolUse"];
    expect(post).toEqual([
      { matcher: "*", hooks: [{ type: "command", command: hookCommand("post-tool-use") }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --after" }] },
    ]);
    expect(staleRegistrations(settings), "and a second run finds nothing to change").toEqual([]);
    expect(withRegistrations(settings).changed).toEqual([]);
  });

  it("narrows an older PreToolUse registered for every tool to Bash, and removes the hook after a failed call", () => {
    const older = {
      hooks: {
        ...(withRegistrations({}).settings as { hooks: Record<string, unknown> }).hooks,
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand("pre-tool-use") }] }],
        PostToolUseFailure: [
          { matcher: "*", hooks: [{ type: "command", command: "flow hook post-tool-use-failure" }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "their-tool --failed" }] },
        ],
      },
    };
    expect(staleRegistrations(older)).toEqual(["PreToolUse", "PostToolUseFailure"]);
    expect(registeredEvents(older), "a hook flow no longer registers is not a registration").toEqual(REGISTERED_EVENTS);
    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual(["PreToolUse (matcher brought up to date)", "PostToolUseFailure (removed: flow no longer registers it)"]);
    const hooks = (settings as { hooks: Record<string, unknown[]> }).hooks;
    expect(hooks["PreToolUse"]).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: hookCommand("pre-tool-use") }] }]);
    expect(hooks["PostToolUseFailure"], "theirs stays, flow's goes").toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "their-tool --failed" }] }]);
    expect(withRegistrations(settings).changed, "and a second run finds nothing to do").toEqual([]);
    const alone = { hooks: { ...without("PostToolUse").hooks, PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook post-tool-use-failure" }] }] } };
    expect(Object.keys((withRegistrations(alone).settings as { hooks: Record<string, unknown> }).hooks), "an event left with nothing of anyone's goes").not.toContain("PostToolUseFailure");
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
    expect(status(statusFacts({ settings: older })).fittings.find((f) => f.id === "claude-code")?.ok).toBe(true);

    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual(REGISTERED_EVENTS.map((event) => `${event} (now runs the flow in node_modules/@jawache/flow first)`));
    const hooks = (settings as { model: string; hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> }).hooks;
    const flows = Object.values(hooks).flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((h) => h.command)).filter(ourHookCommand));
    expect(flows, "exactly flow's, each the new command").toEqual(HOOK_REGISTRATIONS.map((r) => r.command));
    expect(hooks["PreToolUse"]?.[0]?.matcher, "the matcher stays").toBe("Bash");
    expect(JSON.stringify(hooks["Stop"]), "theirs is untouched").toContain("their-tool --report");
    expect((settings as { model: string }).model).toBe("opus");
    expect(withRegistrations(settings).changed, "and a second run finds nothing to do").toEqual([]);
  });

  it("rewrites only flow's command inside an entry it shares, and brings an old matcher up to date in the same pass", () => {
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
    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual(["PostToolUse (matcher brought up to date, now runs the flow in node_modules/@jawache/flow first)"]);
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
    expect(withRegistrations(pinned).changed).toEqual([]);
  });

  it("leaves a by-name command with anything else in it as it is — it is somebody's own", () => {
    for (const prefix of ["FLOW_DEBUG=1 flow ", "cd /x && flow "]) {
      const theirs = registrationsAs((command) => command.replace(/^.* flow /, prefix));
      expect(bareRegistrations(theirs), prefix).toEqual([]);
      expect(withRegistrations(theirs).changed, prefix).toEqual([]);
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
    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual(["Notification (now runs the flow in node_modules/@jawache/flow first)"]);
    expect((settings as { hooks: Record<string, unknown[]> }).hooks["Notification"]).toEqual([
      { hooks: [{ type: "command", command: hookCommand("notification") }] },
    ]);
  });

  // A FILE AN OLDER INIT WROTE: every registration but one subagent event — SubagentStop before
  // 0.3.0, SubagentStart before flow-5. Re-running init adds that one at the end, beside everything
  // already in the file, and rewrites nothing.
  it.each(["SubagentStart", "SubagentStop"])("adds %s to a file holding every other registration, and keeps every other key", (event) => {
    const older = { model: "opus", permissions: { allow: ["Bash(git:*)"] }, hooks: { ...without(event).hooks, Notification: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    const { settings, changed } = withRegistrations(older);
    expect(changed).toEqual([event]);
    const after = settings as typeof older & { hooks: Record<string, unknown> };
    const command = HOOK_REGISTRATIONS.find((r) => r.event === event)?.command;
    expect(after.hooks[event], "no matcher: every agent type").toEqual([{ hooks: [{ type: "command", command }] }]);
    expect({ ...after, hooks: { ...after.hooks, [event]: undefined } }, "nothing else in the file changes").toEqual({
      ...older,
      hooks: { ...older.hooks, [event]: undefined },
    });
    expect(Object.keys(after.hooks), "added at the end; every key already there keeps its place").toEqual([
      ...REGISTERED_EVENTS.filter((e) => e !== event),
      "Notification",
      event,
    ]);
    expect(withRegistrations(settings).changed, "and a second run finds nothing to do").toEqual([]);
  });

  it("reads nothing out of a settings file that is not an object", () => {
    expect(registeredEvents(null)).toEqual([]);
    expect(registeredEvents("nonsense")).toEqual([]);
    expect(registeredEvents({ hooks: { Stop: "not an array" } })).toEqual([]);
  });
});

// ── init ─────────────────────────────────────────────────────────────────────

/** The one harness a `bare` repo is set up for, with the file its hooks go in. */
const claudeFile = (settings: unknown = {}, settingsUnreadable = false, machine: unknown = null): InitFacts["harnesses"] => [
  { harness: claudeCode, settings, settingsUnreadable, machine: { path: "/home/.claude/settings.json", settings: machine } },
];

const bare: InitFacts = {
  harnesses: claudeFile(),
  root: "/repo",
  empty: false,
  isGit: true,
  hasConfig: false,
  gateText: null,
  oldGateText: null,
  hasFlowDir: false,
  hooksPath: null,
  hooksFolder: { dir: ".git/hooks", files: ["pre-commit.sample", "pre-push.sample"], commitMsgText: null, commitMsgExecutable: false },
  resolves: false,
  listed: true,
  packageRoot: "/checkout/flow",
};

describe("what every rail answers while the config will not load", () => {
  const FAULT = "flow: the config will not load — 1 refusal.";
  const TOLD = `${FAULT}\n\n${FLOW_OFF}`;

  describe("whileBroken — every call goes through, and the agent is told why", () => {
    it("refuses no command, and hands each one the load error", () => {
      const files = world({ "src/a.ts": "a", "flow.config.ts": "old" });
      for (const payload of [
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
      // One Bash call is a command and its own note — two events, and the agent needs the sentence
      // once.
      const events = toEvent("pre-tool-use", pre("Bash", { command: "rm src/a.ts && cat src/b.ts" }), world({ "src/a.ts": "a", "src/b.ts": "b" }));
      expect(events.length).toBeGreaterThan(1);
      expect(whileBroken(events, FAULT).shown).toHaveLength(1);
    });

    it("greets a session with the load error in place of the breadcrumbs", () => {
      expect(whileBroken([{ rail: "brief", moment: "session" }], FAULT).shown.map((note) => note.body)).toStrictEqual([TOLD]);
    });

    it("tells the agent at the first hook of a call: after a Read, which no hook came before, and not after a Bash call, which was told when it asked", () => {
      const read = pre("Read", { file_path: "/repo/src/a.ts" });
      // What an after-call hook carries is the files the call changed, which the shell finds in git.
      const events: AdapterEvent[] = [{ rail: "brief", moment: "file-change", path: "src/a.ts" }];
      expect(toEvent("post-tool-use", read, world()), "nothing in the payload names a change").toStrictEqual([]);
      expect(opensCall("post-tool-use", "Read")).toBe(true);
      expect(whileBroken(events, FAULT, opensCall("post-tool-use", "Read")).shown.map((note) => note.body)).toStrictEqual([TOLD]);
      expect(opensCall("post-tool-use", "Bash")).toBe(false);
      expect(whileBroken(events, FAULT, opensCall("post-tool-use", "Bash"))).toStrictEqual({ refused: [], shown: [], told: null });
    });

    it("asks which hook opens a call: before a shell command, after any other tool, and never for a call with no tool", () => {
      expect([opensCall("pre-tool-use", "Bash"), opensCall("post-tool-use", "Edit"), opensCall("post-tool-use", "Bash"), opensCall("pre-tool-use", "Edit")]).toStrictEqual([true, true, false, false]);
      expect([opensCall("post-tool-use", ""), opensCall("stop", "Bash")]).toStrictEqual([false, false]);
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
    const plan = planInit({ ...bare, harnesses: claudeFile(null, true) });
    expect(plan.settings, "no write is planned against bytes nobody parsed").toEqual([]);
    const said = initLines(plan, []).join("\n");
    expect(said).toContain(".claude/settings.json");
    expect(said).toContain("not valid JSON");
    expect(said, "and it says the consequence rather than only the cause").toContain("no rail fires");
  });

  it("still creates a settings file that is simply ABSENT — the other silence", () => {
    const plan = planInit({ ...bare, harnesses: claudeFile(null) });
    expect(plan.settings[0]?.path, "inside the repo, whatever the repo's package.json lists").toBe(".claude/settings.json");
    expect(plan.settings[0]?.registered, "every event flow registers").toEqual(REGISTERED_EVENTS);
  });
});

// flow 0.3 wrote its hooks to the machine-wide file. 0.4 writes nothing there: it says so, and
// `flow uninstall --machine` removes them.
describe("the machine-wide file", () => {
  const machinePath = "/home/.claude/settings.json";

  it("is never written by init, whatever it holds: the plan has no write to it", () => {
    const plan = planInit({ ...bare, harnesses: claudeFile(null, false, withRegistrations({ theme: "dark" }).settings) });
    expect(plan.settings.map((file) => file.path)).toEqual([".claude/settings.json"]);
  });

  it("is warned of when it holds flow's hooks, with the command that removes them", () => {
    const plan = planInit({ ...bare, harnesses: claudeFile({}, false, withRegistrations({}).settings) });
    expect(plan.warnings).toEqual([
      `${machinePath} also holds flow's hooks, which flow 0.3 wrote, so each hook would run twice. Remove them with \`flow uninstall --machine\`, then run \`flow init\` again.`,
    ]);
    expect(planInit({ ...bare, harnesses: claudeFile({}, false, { theme: "dark" }) }).warnings, "none of flow's in it").toEqual([]);
    expect(planInit({ ...bare, harnesses: claudeFile({}, false, null) }).warnings, "no such file").toEqual([]);
  });
});

// ── status ───────────────────────────────────────────────────────────────────

const noteAtTurnEnd = { kind: "breadcrumb", at: ["turn-end"], text: "late" } as const;

/** What a status test varies, beside the facts: the harness's settings file, and when one of its hooks last ran. */
type StatusOver = Partial<StatusFacts> & { readonly settings?: unknown; readonly lastRan?: string | null };

const statusFacts = ({ settings, lastRan = null, ...over }: StatusOver = {}): StatusFacts => ({
  harnesses: [{ harness: claudeCode, settings: settings === undefined ? withRegistrations({}).settings : settings, lastRan }],
  now: Date.parse("2026-11-18T12:00:00.000Z"),
  root: "/repo",
  version: "1.2.3",
  off: false,
  configPath: "/repo/flow.config.ts",
  hasConfig: true,
  load: { ok: true, entries: [] },
  gateText: COMMIT_MSG,
  oldGateText: null,
  hooksPath: HOOKS_DIR,
  hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], commitMsgText: COMMIT_MSG, commitMsgExecutable: true },
  grammars: [],
  session: null,
  binary: { listed: false, copy: false, path: true },
  ...over,
});

// ── uninstall ────────────────────────────────────────────────────────────────

describe("withoutRegistrations — flow's hooks taken out of a settings file", () => {
  const theirs = { type: "command", command: "lint-on-stop" };

  it("removes flow's registrations, and the hooks key with them when nothing else is in it", () => {
    const { settings, removed } = withoutRegistrations(withRegistrations({ theme: "dark" }).settings);
    expect(removed).toEqual(["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"]);
    expect(settings).toEqual({ theme: "dark" });
  });

  it("keeps every other key, event, entry and hook, and an entry flow shares keeps the rest of its hooks", () => {
    const registered = withRegistrations({ permissions: { allow: ["Bash(ls:*)"] } }).settings as { hooks: Record<string, unknown[]> };
    const shared = { hooks: [{ type: "command", command: hookCommand("stop") }, theirs] };
    const mixed = {
      ...registered,
      hooks: {
        ...registered.hooks,
        Stop: [shared, { hooks: [theirs] }],
        Notification: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const before = structuredClone(mixed);
    const { settings, removed } = withoutRegistrations(mixed);
    expect(removed).toEqual(["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"]);
    expect(settings).toEqual({
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: { Stop: [{ hooks: [theirs] }, { hooks: [theirs] }], Notification: mixed.hooks.Notification },
    });
    expect(mixed, "a new object; the one handed in is not changed").toEqual(before);
  });

  it("removes an older flow's bare command too, and has nothing to do in a file with none of flow's", () => {
    expect(withoutRegistrations(BARE_SETTINGS).settings).toEqual({});
    expect(withoutRegistrations({ theme: "dark" })).toEqual({ settings: { theme: "dark" }, removed: [] });
    expect(withoutRegistrations(null).removed).toEqual([]);
  });
});

/** The machine-wide settings file, absolute, as the shell hands it over. */
const MACHINE_SETTINGS = "/home/me/.claude/settings.json";

/** The one harness a repo is uninstalled from, with its repo file and its machine-wide file. */
const claudeOf = (over: Partial<UninstallFacts["harnesses"][number]> = {}): UninstallFacts["harnesses"] => [
  {
    harness: claudeCode,
    settings: null,
    settingsUnreadable: false,
    machineFile: { path: MACHINE_SETTINGS, settings: withRegistrations({ theme: "dark" }).settings, unreadable: false },
    ...over,
  },
];

/**
 * A repo `flow init` set up: the gate, the hooks path, the state directory and the link, and
 * flow 0.3's hooks in the machine-wide file beside a key of the person's own.
 */
const wired: UninstallFacts = {
  harnesses: claudeOf(),
  hasConfig: true,
  gateText: COMMIT_MSG,
  oldGateText: null,
  hooksPath: HOOKS_DIR,
  subfolderOf: null,
  hooksDir: ["pre-commit"],
  hooksFolder: { dir: HOOKS_DIR, files: ["pre-commit"], commitMsgText: COMMIT_MSG, commitMsgExecutable: true },
  hasFlowDir: true,
  linked: true,
  machineFlag: false,
};

describe("planUninstall — the repo's own settings file", () => {
  const listed = { ...wired, linked: false, harnesses: claudeOf({ settings: withRegistrations({ permissions: { allow: [] } }).settings }) };

  it("takes flow's hooks out of the repo's own settings file, whatever the repo's package.json lists, and ends with the repo's npm uninstall", () => {
    const plan = planUninstall(listed);
    expect(plan.settings[0]?.path).toBe(REPO_SETTINGS);
    expect(plan.settings[0]?.value).toEqual({ permissions: { allow: [] } });
    expect(plan.link, "an installed package is npm's to remove").toBe(false);
    const said = uninstallLines(plan, []).join("\n");
    expect(said).toContain("  - .claude/settings.json — SessionStart · SubagentStart · PreToolUse · PostToolUse · Stop · SubagentStop");
    expect(said).toContain("`npm uninstall @jawache/flow`");
  });

  it("writes nothing to a settings file that would not parse, says so, and answers 1", () => {
    const plan = planUninstall({ ...listed, harnesses: claudeOf({ settings: null, settingsUnreadable: true }) });
    expect(plan.settings).toEqual([]);
    expect(plan.unreadable).toEqual([REPO_SETTINGS]);
    expect(uninstallLines(plan, []).join("\n")).toContain(".claude/settings.json is not valid JSON");
    expect(uninstallLines(plan, []).join("\n")).toContain("run `flow uninstall` again.");
    expect(uninstallCode(plan, [])).toBe(1);
  });
});

describe("planUninstall — the machine-wide settings file", () => {
  const theirs = { hooks: [{ type: "command", command: "say done" }] };
  const machineWith = (settings: unknown, unreadable = false): UninstallFacts => ({
    ...wired,
    machineFlag: true,
    harnesses: claudeOf({ machineFile: { path: MACHINE_SETTINGS, settings, unreadable } }),
  });

  it("is left as it was without --machine", () => {
    expect(planUninstall(wired).machine).toEqual([]);
    expect(uninstallLines(planUninstall(wired), []).join("\n")).not.toContain(`  - ${MACHINE_SETTINGS}`);
  });

  it("with --machine, loses flow's registrations and keeps every other key and hook", () => {
    const registered = withRegistrations({ theme: "dark", hooks: { Stop: [theirs] } }).settings;
    const plan = planUninstall(machineWith(registered));
    expect(plan.machine).toEqual([
      {
        path: MACHINE_SETTINGS,
        value: { theme: "dark", hooks: { Stop: [theirs] } },
        removed: ["SessionStart", "SubagentStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"],
      },
    ]);
    expect(uninstallLines(plan, []).join("\n")).toContain(
      `  - ${MACHINE_SETTINGS} — SessionStart · SubagentStart · PreToolUse · PostToolUse · Stop · SubagentStop`,
    );
    expect(uninstallCode(plan, [])).toBe(0);
  });

  it("with --machine, cleans both files", () => {
    const plan = planUninstall({ ...machineWith(withRegistrations({}).settings), harnesses: claudeOf({ settings: withRegistrations({}).settings }) });
    expect(plan.settings[0]?.path).toBe(REPO_SETTINGS);
    expect(plan.machine[0]?.path).toBe(MACHINE_SETTINGS);
  });

  it("with --machine, has nothing to do in a machine-wide file with none of flow's, or none at all", () => {
    expect(planUninstall(machineWith({ theme: "dark" })).machine).toEqual([]);
    expect(planUninstall(machineWith(null)).machine).toEqual([]);
  });

  it("with --machine, writes nothing to a machine-wide file that would not parse, says so with the command to run again, and answers 1", () => {
    const plan = planUninstall(machineWith(null, true));
    expect(plan.machine).toEqual([]);
    expect(plan.unreadable).toEqual([MACHINE_SETTINGS]);
    const said = uninstallLines(plan, []).join("\n");
    expect(said).toContain(`  ✗ ${MACHINE_SETTINGS} is not valid JSON`);
    expect(said).toContain(`run \`flow uninstall ${MACHINE_FLAG}\` again.`);
    expect(uninstallCode(plan, [])).toBe(1);
  });

  it("with --machine, lists both files when neither will parse, and each line says to run --machine again", () => {
    const plan = planUninstall({
      ...wired,
      machineFlag: true,
      harnesses: claudeOf({ settings: null, settingsUnreadable: true, machineFile: { path: MACHINE_SETTINGS, settings: null, unreadable: true } }),
    });
    expect(plan.settings).toEqual([]);
    expect(plan.machine).toEqual([]);
    expect(plan.unreadable).toEqual([REPO_SETTINGS, MACHINE_SETTINGS]);
    const failed = uninstallLines(plan, []).filter((line) => line.startsWith("  ✗ "));
    expect(failed.map((line) => line.split(" is not valid JSON")[0])).toEqual([`  ✗ ${REPO_SETTINGS}`, `  ✗ ${MACHINE_SETTINGS}`]);
    for (const line of failed) expect(line).toContain(`run \`flow uninstall ${MACHINE_FLAG}\` again.`);
    expect(uninstallCode(plan, [])).toBe(1);
  });

  it("without --machine, an unreadable machine-wide file is none of its business", () => {
    const plan = planUninstall({ ...wired, harnesses: claudeOf({ machineFile: { path: MACHINE_SETTINGS, settings: null, unreadable: true } }) });
    expect(plan.unreadable).toEqual([]);
    expect(uninstallCode(plan, [])).toBe(0);
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
            loaded("demo.noTodo", { kind: "guardrail", at: ["command", "commit"], on: ["src/**"], message: "no" }),
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
    // An entry at two moments is listed under both — standing at the commit, a command rule is still
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
              at: ["commit"],
              on: ["src/**"],
              ignore: ["**/*.test.ts"],
              message: "no",
            }),
            loaded("demo.quiet", { kind: "guardrail", at: ["commit"], message: "no", disabled: {} }),
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

  it("prints no session line when nothing has marked one", () => {
    expect(statusLines(status(statusFacts())).join("\n")).not.toContain("session    ");
  });
});

describe("status — a registration an older flow wrote", () => {
  const red = (over: StatusOver): string => statusLines(status(statusFacts(over))).join("\n");
  it("goes red on an older flow's registrations, and says re-running init brings them up to date", () => {
    const settings = withRegistrations({}).settings as { hooks: Record<string, unknown> };
    const older = {
      hooks: {
        ...settings.hooks,
        PostToolUse: [{ matcher: "Read|Glob|Grep|Edit|Write|Bash", hooks: [{ type: "command", command: "flow hook post-tool-use" }] }],
      },
    };
    const said = red({ settings: older });
    expect(said).toContain("calls flow for PostToolUse the way an older flow registered it");
    expect(said).toContain("Re-run `flow init` to bring it up to date.");
    const failed = { hooks: { ...older.hooks, PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: "flow hook post-tool-use-failure" }] }] } };
    expect(red({ settings: failed })).toContain("calls flow for PostToolUse · PostToolUseFailure the way an older flow registered them");
    const missing = { hooks: { ...older.hooks, PostToolUse: undefined } };
    expect(red({ settings: missing })).toContain("does not call flow for PostToolUse");
  });

  // A file without one subagent event still guards every tool call; status names that one and its cost.
  it.each([
    ["SubagentStart", "no note is shown when a subagent starts"],
    ["SubagentStop", "no turn-end rule runs when a subagent hands back"],
  ])("goes red on a file without %s, and names what goes unjudged", (event, unregistered) => {
    const s = status(statusFacts({ settings: without(event) }));
    expect(s.fittings.find((f) => f.id === "claude-code")?.ok).toBe(false);
    expect(s.green).toBe(false);
    expect(s.fittings.find((f) => f.id === "claude-code")?.detail).toBe(
      `.claude/settings.json does not call flow for ${event} — re-run \`flow init\`. Until it does, ${unregistered}.`,
    );
    expect(status(statusFacts()).fittings.find((f) => f.id === "claude-code")?.detail, "every one, and it is green").toBe(
      "registered · no hook has run here",
    );
  });

  // Each event carries its own rails, so a missing one costs those and no others: a file without
  // PreToolUse and SubagentStop still shows the note for a file a tool call changed and judges the main chat's hand-back.
  it("names only the rails of the missing events as not firing", () => {
    const hooks = { ...without("SubagentStop").hooks, PreToolUse: undefined };
    expect(status(statusFacts({ settings: { hooks } })).fittings.find((f) => f.id === "claude-code")?.detail).toBe(
      ".claude/settings.json does not call flow for PreToolUse · SubagentStop — re-run `flow init`. " +
        "Until it does, no rule judges a command before it runs; no turn-end rule runs when a subagent hands back.",
    );
    const none = status(statusFacts({ settings: {} })).fittings.find((f) => f.id === "hooks")?.detail ?? "";
    for (const registration of HOOK_REGISTRATIONS) expect(none, "a file with none names every cost").toContain(registration.event);
    expect(none).toContain("no note is shown when a session starts; no note is shown when a subagent starts; no rule judges a command before it runs;");
  });
});

describe("another worktree of the repository — read when a call works in it", () => {
  const root = "/code/app";
  const worktrees = ["/code/app", "/code/app.worktrees/feature", "/code/app.worktrees/fix"];
  const tell = (paths: readonly string[]): string[] => worktreesWorkedIn({ paths, root, worktrees });

  it("names the worktree a path in another worktree is in", () => {
    expect(tell(["/code/app.worktrees/feature/src/a.ts"])).toEqual(["/code/app.worktrees/feature"]);
  });

  it("names each worktree once, in the order the paths came", () => {
    expect(tell(["/code/app.worktrees/fix/b.ts", "/code/app.worktrees/feature/a.ts", "/code/app.worktrees/fix/c.ts"])).toEqual(["/code/app.worktrees/fix", "/code/app.worktrees/feature"]);
  });

  it("names nothing for a path outside the repository that is none of its worktrees", () => {
    expect(tell(["/tmp/scratch.txt", "/code/app-other/a.ts", "/code/app.worktrees/featured/a.ts"])).toEqual([]);
  });

  it("names nothing for a path inside the guarded folder", () => {
    expect(tell(["/code/app/src/a.ts"])).toEqual([]);
  });

  it("counts the worktree that holds the guarded folder as the session's own", () => {
    expect(worktreesWorkedIn({ paths: ["/code/app/lib/x.ts"], root: "/code/app/packages/web", worktrees })).toEqual([]);
  });

  it("reads the worktree around a session started in a nested worktree", () => {
    expect(
      worktreesWorkedIn({ paths: ["/code/app/src/a.ts"], root: "/code/app/.claude/worktrees/agent-1", worktrees: [...worktrees, "/code/app/.claude/worktrees/agent-1"] }),
    ).toEqual(["/code/app"]);
  });

  it("places a path in the deepest worktree that holds it, and names each worktree once", () => {
    const nested = [...worktrees, "/code/app.worktrees/feature/.claude/worktrees/agent-1"];
    expect(
      worktreesWorkedIn({
        paths: ["/code/app.worktrees/feature/.claude/worktrees/agent-1/a.ts", "/code/app.worktrees/feature/a.ts", "/code/app.worktrees/feature/b.ts"],
        root,
        worktrees: nested,
      }),
    ).toEqual(["/code/app.worktrees/feature/.claude/worktrees/agent-1", "/code/app.worktrees/feature"]);
  });

  it("asks git only for a call that reaches outside the guarded folder, or under a folder holding a .git file", () => {
    const none = (): boolean => false;
    expect(reachesAnotherWorktree(["/code/app/src/a.ts", "/code/app"], root, none)).toBe(false);
    expect(reachesAnotherWorktree(["/code/app/src/a.ts", "/code/app.worktrees/feature/a.ts"], root, none)).toBe(true);
    expect(reachesAnotherWorktree([], root, none)).toBe(false);
    const nested = (dir: string): boolean => dir === "/code/app/.claude/worktrees/agent-1";
    expect(reachesAnotherWorktree(["/code/app/.claude/worktrees/agent-1/src/a.ts"], root, nested)).toBe(true);
    expect(reachesAnotherWorktree(["/code/app/src/a.ts"], root, nested)).toBe(false);
  });

  it("names a worktree nested inside the guarded folder, as Claude Code makes for a subagent", () => {
    expect(
      worktreesWorkedIn({ paths: ["/code/app/.claude/worktrees/agent-1/a.ts"], root, worktrees: [...worktrees, "/code/app/.claude/worktrees/agent-1"] }),
    ).toEqual(["/code/app/.claude/worktrees/agent-1"]);
  });

  it("walks the folders between a path and the guarded folder, nearest first, neither end", () => {
    expect(foldersBetween("/code/app/.claude/worktrees/agent-1/a.ts", root)).toEqual([
      "/code/app/.claude/worktrees/agent-1",
      "/code/app/.claude/worktrees",
      "/code/app/.claude",
    ]);
    expect(foldersBetween("/code/app/a.ts", root)).toEqual([]);
    expect(foldersBetween("/code/app", root)).toEqual([]);
    expect(foldersBetween("/elsewhere/a.ts", root)).toEqual([]);
  });

  it("works where an edit tool writes, absolute, and nowhere for another tool that names a file", () => {
    const worked = (payload: HookPayload): string[] => workedPaths(payload, root, "/home/me", editedFile(payload));
    expect(worked({ tool_name: "Write", tool_input: { file_path: "/code/app.worktrees/feature/a.ts" } })).toEqual(["/code/app.worktrees/feature/a.ts"]);
    expect(worked({ tool_name: "Edit", tool_input: { file_path: "src/a.ts" } })).toEqual(["/code/app/src/a.ts"]);
    expect(worked({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/n.ipynb" } })).toEqual(["/n.ipynb"]);
    expect(worked({ tool_name: "Read", tool_input: { file_path: "/code/app.worktrees/feature/a.ts" } })).toEqual([]);
    expect(worked({ tool_name: "Write", tool_input: {} })).toEqual([]);
  });

  it("reads the folders a command runs in: the payload's cwd, then each command's folder from the parse, absolute", () => {
    const bash = (command: string, cwd?: string): HookPayload => ({ tool_name: "Bash", tool_input: { command }, ...(cwd === undefined ? {} : { cwd }) });
    expect(commandFolders(bash("ls", "/code/app.worktrees/feature"), root, "/home/me")).toEqual(["/code/app.worktrees/feature"]);
    expect(commandFolders(bash("ls"), root, "/home/me"), "no cwd: the guarded folder").toEqual(["/code/app"]);
    expect(commandFolders(bash("cd ../app.worktrees/feature && npm test", root), root, "/home/me")).toEqual(["/code/app", "/code/app.worktrees/feature"]);
    // A folder counts once a command runs in it: the trailing `pushd` moves the shell, and runs nothing there.
    expect(commandFolders(bash("(cd /tmp/x && ls); pushd ~/y", root), root, "/home/me")).toEqual(["/code/app", "/tmp/x"]);
    expect(commandFolders(bash("pushd ~/y && ls", root), root, "/home/me")).toEqual(["/code/app", "/home/me/y"]);
    expect(commandFolders(bash("git -C ../app.worktrees/feature status", root), root, "/home/me"), "git's own -C").toEqual(["/code/app", "/code/app.worktrees/feature"]);
    expect(commandFolders(bash('cd "$DIR" && ls', root), root, "/home/me"), "a folder only running the line could tell").toEqual(["/code/app"]);
    expect(commandFolders({ tool_name: "Write", tool_input: { file_path: "/code/app.worktrees/feature/a.ts" }, cwd: "/code/app.worktrees/fix" }, root, "/home/me")).toEqual([]);
  });

  it("names the worktree a command ran in, by its cwd or a cd, and nothing for a cd outside the repository", () => {
    const ran = (command: string, cwd = root): string[] => tell(workedPaths({ tool_name: "Bash", tool_input: { command }, cwd }, root, "/home/me", null));
    expect(ran("npm test", "/code/app.worktrees/feature"), "the session's folder is in the worktree").toEqual(["/code/app.worktrees/feature"]);
    expect(ran("cd /code/app.worktrees/fix/src && npm test"), "a cd into it").toEqual(["/code/app.worktrees/fix"]);
    expect(ran("cd /tmp/scratch && ls; cd ../../code/app-other"), "a cd outside the repository, to none of its worktrees").toEqual([]);
    expect(ran("cd src && ls"), "a cd inside the guarded folder").toEqual([]);
  });

  it("asks git for a folder a command ran in that is itself a nested worktree, and never for the guarded folder", () => {
    const nested = (dir: string): boolean => dir === "/code/app/.claude/worktrees/agent-1";
    expect(reachesAnotherWorktree(["/code/app/.claude/worktrees/agent-1"], root, nested)).toBe(true);
    const startedInWorktree = (dir: string): boolean => dir === root;
    expect(reachesAnotherWorktree([root, "/code/app/src"], root, startedInWorktree), "the guarded folder holds a .git file in a linked worktree").toBe(false);
  });

  it("reads git's worktree list, leaving out a bare repository", () => {
    const porcelain =
      "worktree /code/app.git\nbare\n\nworktree /code/app\nHEAD abc\nbranch refs/heads/main\n\n" +
      "worktree /code/app.worktrees/feature\nHEAD def\ndetached\nprunable gitdir file points to non-existent location\n";
    expect(worktreeFolders(porcelain)).toEqual(["/code/app", "/code/app.worktrees/feature"]);
    expect(worktreeFolders("")).toEqual([]);
  });
});

describe("outsideOf — where a call works outside the repository", () => {
  const root = "/code/app";
  // git names this repository for the guarded folder and its sibling worktree, and not for the
  // repository made inside it with `git init`.
  const repository = ["/code/app", "/code/app.worktrees/feature"];
  const asked: string[] = [];
  const under = (folder: string, top: string): boolean => folder === top || folder.startsWith(`${top}/`);
  const same = (folder: string): boolean => {
    asked.push(folder);
    return !under(folder, "/code/app/.scratch/tmp/r") && repository.some((top) => under(folder, top));
  };
  const nestedRepo = (dir: string): boolean => dir === "/code/app/.scratch/tmp/r";
  const none = (): boolean => false;
  const ran = (line: string) => ({ rail: "guard" as const, moment: "command" as const, command: line, commands: parseCommandLine(line, { cwd: root }) });

  it("names the folder of each command outside, once, and asks git of nothing inside", () => {
    asked.length = 0;
    expect(outsideOf(ran("cd /tmp/r && git init && git commit -m init; git -C /tmp/r log"), root, none, same)).toEqual(["/tmp/r"]);
    expect(asked).toEqual(["/tmp/r"]);
    asked.length = 0;
    expect(outsideOf(ran("git status && cd src && ls"), root, none, same)).toEqual([]);
    expect(asked, "inside the guarded folder, with no .git under it").toEqual([]);
  });

  it("counts every worktree of this repository as inside", () => {
    expect(outsideOf(ran("cd /code/app.worktrees/feature && git commit -m bad"), root, none, same)).toEqual([]);
    // One nested inside the guarded folder holds a `.git`, so git is asked, and names this repository.
    const nested = "/code/app/.claude/worktrees/x";
    const sameOrNested = (folder: string): boolean => folder === nested || same(folder);
    expect(outsideOf(ran("cd .claude/worktrees/x && git commit -m bad"), root, (dir) => dir === nested, sameOrNested)).toEqual([]);
  });

  it("counts a repository made under the guarded folder as outside", () => {
    expect(outsideOf(ran("cd .scratch/tmp/r && git commit -m init"), root, nestedRepo, same)).toEqual(["/code/app/.scratch/tmp/r"]);
  });

  it("names nothing for a command with no folder", () => {
    expect(outsideOf(ran('cd "$(mktemp -d)" && git commit -m init'), root, none, same)).toEqual([]);
  });

  it("names nothing for a moment but a command's, and nothing for a breadcrumb: a changed path is git's own, inside a worktree of the repository", () => {
    expect(outsideOf({ rail: "guard", moment: "commit" }, root, none, same)).toEqual([]);
    expect(outsideOf({ rail: "brief", moment: "file-change", path: "src/a.ts" }, root, none, same)).toEqual([]);
    expect(outsideOf({ rail: "brief", moment: "session" }, root, none, same)).toEqual([]);
  });
});

describe("what goes unjudged while a registration is missing", () => {
  it("names each event flow registers, by the host's own name, with what it costs", () => {
    expect(HOOK_COSTS.map((cost) => cost.event)).toEqual(HOOK_REGISTRATIONS.map((registration) => registration.event));
    for (const cost of HOOK_COSTS) expect(cost.unregistered, cost.event).not.toBe("");
  });
});

describe("claudeCode — the harness flow is handed", () => {
  it("puts the machine-wide settings file where the host's own override says", () => {
    const was = process.env["CLAUDE_CONFIG_DIR"];
    process.env["CLAUDE_CONFIG_DIR"] = "/somewhere/else";
    try {
      expect(claudeCode.machineSettingsPath()).toBe("/somewhere/else/settings.json");
    } finally {
      if (was === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
      else process.env["CLAUDE_CONFIG_DIR"] = was;
    }
  });
});

describe("what a tool call did, in flow's own words", () => {
  const actionOfTool = (name: string): string | undefined => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input: {} }] } });
    const use = parseEvents(line).find((event) => event.kind === "use");
    return use?.kind === "use" ? use.action : undefined;
  };

  it("maps every tool that changes a file, and the three it reads or runs, and calls the rest other", () => {
    expect(actionOfTool("Write")).toBe("write");
    for (const name of ["Edit", "MultiEdit", "NotebookEdit"]) expect(actionOfTool(name), name).toBe("edit");
    expect(actionOfTool("Read")).toBe("read");
    expect(actionOfTool("Bash")).toBe("shell");
    expect(actionOfTool("Grep")).toBe("other");
  });
});
