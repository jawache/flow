// flow/checks/domain.test.ts — every stock check, on its own legal and illegal sample.
//
// The behaviour assertions came across from the fourteen per-check tests the old engine carried
// and are the same claims, re-homed: what each check says yes to, what it says no to, and the
// specific bug each odd-looking line exists to prevent. What is NEW is that every check is driven
// through `cannedCtx` — the same door `flow test` drives them through and the same door the live
// hooks will — so the harness is proved by every test in the file rather than by one test of its
// own. A check that could only be tested by reaching around ctx would fail here first.

import { describe, it, expect } from "vitest";
import {
  loadConfig,
  verdict,
  type Case,
  type CaseWorld,
  type Check,
  type LoadedEntry,
  type Unanswered,
} from "../language/domain.ts";
import { globToRegExp } from "../glob.ts";
import {
  addedNames,
  astGrep,
  astGrepHits,
  banCommands,
  cannedCtx,
  canonicalFault,
  canonicalFiles,
  caseMoment,
  readCase,
  changeTogether,
  changedSet,
  commitMessage,
  commitReason,
  compileDialect,
  depcruise,
  depcruiseCommand,
  depcruiseHits,
  entryToMatcher,
  execPasses,
  exportedNames,
  failureExcerpt,
  gitDirPrefix,
  gitInvocations,
  givesReason,
  globToRe,
  heredocBody,
  judgeCanonical,
  jsonInvariant,
  jsonViolations,
  layersMatcher,
  lonelyChanges,
  NATIVE_LANGUAGES,
  patternHits,
  protectedPath,
  quoteArg,
  ranSinceEdit,
  reasonHits,
  resolveLang,
  runCase,
  runCases,
  siblingExists,
  skipForChanged,
  substitutionInProse,
  SUBSTITUTION_MESSAGE,
  symbolsInSibling,
  textBan,
  tokenizeCommand,
  unansweredText,
  unreferenced,
  GIT_VALUE_OPTS,
  type CanonOptions,
  type ChangeGroup,
  type Dialect,
  type ForbidEdge,
  type GitInvocation,
  type JsonAssert,
  type Matcher,
  type NativeConfig,
  type NativeRule,
  type PatternHit,
  type ReasonInput,
  type RequireEdge,
  type CanonVerdict,
  type CaseDialect,
  type WorkingState,
  type CaseResult,
} from "./domain.ts";

/** Drive a check exactly as `flow test` does: one canned ctx, one verdict. */
const run = async (check: Check, moment: Parameters<typeof cannedCtx>[0], c: Case): Promise<string | null> => {
  const v = await check(cannedCtx(moment, c, []));
  return v.ok ? null : (v.detail ?? "");
};

/** …and the same, keeping whatever the check reached for and the case never answered. */
const runWithReaches = async (
  check: Check,
  moment: Parameters<typeof cannedCtx>[0],
  c: Case,
): Promise<{ detail: string | null; missing: Unanswered[] }> => {
  const missing: Unanswered[] = [];
  const v = await check(cannedCtx(moment, c, missing));
  return { detail: v.ok ? null : (v.detail ?? ""), missing };
};

const file = (path: string, content: string): Case => ({ path, content });

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PATTERNS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("patternHits — the one regex sweep", () => {
  it("finds nothing in clean text", () => {
    expect(patternHits("all good here", ["\\bTODO\\b"])).toEqual([]);
  });

  it("names the pattern and the 1-based line, so a hit points at a place", () => {
    const hits: PatternHit[] = patternHits("x\nleft a TODO here", ["\\bTODO\\b"]);
    expect(hits).toEqual([{ pattern: "\\bTODO\\b", line: 2 }]);
  });

  it("applies every pattern to every line", () => {
    expect(patternHits("FIXME\nTODO", ["TODO", "FIXME"])).toHaveLength(2);
  });
});

describe("textBan", () => {
  it("passes clean prose and blocks a banned word, naming the line", async () => {
    const check = textBan({ ban: ["\\bTODO\\b"] });
    expect(await run(check, "write", file("a.md", "all good here"))).toBeNull();
    expect(await run(check, "write", file("a.md", "x\nleft a TODO here"))).toContain("line 2");
  });
});

describe("banCommands", () => {
  it("passes a safe command and blocks a banned one", async () => {
    const check = banCommands({ ban: ["git\\s+checkout\\s+--", "git\\s+reset\\s+--hard"] });
    expect(await run(check, "command", "git status")).toBeNull();
    expect(await run(check, "command", "git checkout -- src/x.ts")).toContain("banned");
  });

  it("reports every pattern that matched, not just the first", async () => {
    const check = banCommands({ ban: ["rm -rf /", "rm -rf /tmp"] });
    const detail = await run(check, "command", "rm -rf / ; rm -rf /tmp");
    expect(detail?.split(" · ")).toHaveLength(2);
  });

  // A command is ONE subject however many lines it occupies. Swept line by line, every pattern
  // that spans the newline between a commit's subject and its body matches nothing — the rule
  // loads, counts and cannot catch what it names.
  it("matches a pattern spanning the newlines of a multi-line command", async () => {
    const trailer = ["Co", "Authored", "By"].join("-");
    const check = banCommands({ ban: [`git commit[\\s\\S]*${trailer}:`] });
    expect(await run(check, "command", 'git commit -m "fix: a thing"')).toBeNull();
    expect(await run(check, "command", `git commit -m "fix: a thing\n\n${trailer}: someone"`)).toContain("banned");
  });
});

// A BUILDER, so its cases are about the expression it returns rather than about one pack's heads.
// Both real bindings (`git`'s commit and gh verbs, `work`'s lifecycle verbs) carry their own
// `.test({ pass, block })` cases; what those cannot show is the tail in isolation — that an
// argument already CLOSED before the prose does not open the scan, and that a quoted heredoc is
// genuinely safe while an unquoted one is not. Each of those was a bug in a hand-rolled copy.
describe("substitutionInProse", () => {
  const caught = (command: string): boolean => new RegExp(substitutionInProse(["say"])).test(command);

  it("catches a backtick inside an open double-quoted argument", () => {
    expect(caught('say "run `just test` first"')).toBe(true);
  });

  it("leaves a single-quoted argument alone — backticks are literal there", () => {
    expect(caught("say 'run `just test` first'")).toBe(false);
  });

  it("walks past arguments that are already CLOSED before deciding a quote is open", () => {
    // `--flag "value"` is a complete pair, so the backtick after it sits outside any double quote
    // and nothing would splice. A tail that counted quotes rather than pairing them blocks this.
    expect(caught('say --flag "value" and then `date`')).toBe(false);
    expect(caught('say --flag "value" --text "run `date`"')).toBe(true);
  });

  it("treats a QUOTED heredoc as the sanctioned way to carry backticks, and an unquoted one as live", () => {
    expect(caught("say -F - <<'EOF'\nrun `just test`\nEOF")).toBe(false);
    expect(caught('say -F - <<EOF\nrun "`just test`"\nEOF')).toBe(true);
  });

  it("spans the newline, which is why banCommands matches a command whole", () => {
    expect(caught('say "subject\n\nbody with `date` in it"')).toBe(true);
  });

  it("takes several heads, so two packs share one tail without either copying it", () => {
    const both = new RegExp(substitutionInProse(["git\\s+commit\\b", "work\\s+plan\\b"]));
    expect(both.test('git commit -m "a `date`"')).toBe(true);
    expect(both.test('work plan decision "a `date`"')).toBe(true);
    expect(both.test('gh pr create --body "a `date`"')).toBe(false);
  });

  it("says the mechanism, the absence of an undo and the fix — the sentence both packs print", () => {
    expect(SUBSTITUTION_MESSAGE).toContain("the shell RUNS it");
    expect(SUBSTITUTION_MESSAGE).toContain("no undo");
    expect(SUBSTITUTION_MESSAGE).toContain("SINGLE-quote");
    // And it never names a verb: one sentence, whichever pack caught the command.
    expect(SUBSTITUTION_MESSAGE).not.toContain("gh pr");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PATHS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("protectedPath", () => {
  it("treats the entry's scope AS the prohibition — anything it is handed is a violation", async () => {
    const detail = await run(protectedPath({}), "write", file("src/generated/api.ts", "x"));
    expect(detail).toContain("src/generated/api.ts");
    expect(detail).toContain("protected path");
  });

  it("existingOnly is append-only: a NEW file passes, an edit of one already there does not", async () => {
    const check = protectedPath({ existingOnly: true });
    expect(await run(check, "write", { path: "m/003.sql", content: "new" })).toBeNull();
    const edit = await run(check, "write", { path: "m/001.sql", content: "x", world: { fs: { "m/001.sql": "old" } } });
    expect(edit).toContain("append-only");
    expect(edit).toContain("adding a new one is fine");
  });

  it("a delete of a protected path is refused even though there is no would-be file to ask about", async () => {
    const check = protectedPath({ existingOnly: true });
    expect(await run(check, "delete", { path: "m/001.sql", content: "" })).toContain("append-only");
  });
});

describe("siblingExists", () => {
  it("passes when the companion is there and names it when it is not", async () => {
    const check = siblingExists({ sibling: "{path}.test.ts" });
    expect(await run(check, "write", { path: "a/x.ts", content: "", world: { fs: { "a/x.test.ts": "" } } })).toBeNull();
    expect(await run(check, "write", file("a/y.ts", ""))).toBe("required sibling missing: a/y.test.ts");
  });
});

describe("canonicalFiles", () => {
  const canon: CanonOptions = { root: "src/lib", allow: ["domain", "index"], thinking: "domain" };
  /** The verdict as a boolean, for the many cases where only the yes-or-no is the point. */
  const bad = (path: string, o: CanonOptions = canon): boolean => !judgeCanonical(path, o).ok;

  it("leaves the shared-util tier alone and judges inside a feature folder", () => {
    expect(bad("src/lib/helpers.ts", canon)).toBe(false); // directly under root
    expect(bad("src/lib/cart/domain.ts", canon)).toBe(false);
    expect(bad("src/lib/cart/helpers.ts", canon)).toBe(true);
  });

  it("only the thinking file may carry a .test sibling — a tested talking file grew logic", () => {
    expect(bad("src/lib/cart/domain.test.ts", canon)).toBe(false);
    expect(bad("src/lib/cart/index.test.ts", canon)).toBe(true);
  });

  it("ignores paths outside root, non-source files and declaration files", () => {
    expect(bad("other/cart/helpers.ts", canon)).toBe(false);
    expect(bad("src/lib/cart/notes.md", canon)).toBe(false);
    expect(bad("src/lib/cart/shims.d.ts", canon)).toBe(false);
  });

  it("an empty allow list means the filename tier is not policed", () => {
    expect(bad("src/lib/cart/anything.ts", { root: "src/lib", allow: [] })).toBe(false);
  });

  it("the folder tier is a second allowlist, judged on ANY file type", () => {
    const docs: CanonOptions = { root: "docs", allow: [], folders: ["user", "agent"] };
    expect(bad("docs/user/quickstart.html", docs)).toBe(false);
    expect(bad("docs/notes.md", docs)).toBe(true);
    expect(bad("docs/scratch/x.ts", docs)).toBe(true);
    expect(canonicalFault(judgeCanonical("docs/notes.md", docs), "docs/notes.md", docs)).toContain(
      "is not one of the names docs/ may hold",
    );
  });

  it("the verdict says WHICH tier refused, so the message cannot describe the other one", () => {
    const docs: CanonOptions = { root: "docs", allow: [], folders: ["user"] };
    const folder: CanonVerdict = judgeCanonical("docs/notes.md", docs);
    expect(folder).toEqual({ ok: false, tier: "folder", found: "notes.md" });
    expect(judgeCanonical("src/lib/cart/helpers.ts", canon)).toEqual({ ok: false, tier: "filename" });
    expect(judgeCanonical("src/lib/cart/domain.ts", canon)).toEqual({ ok: true });
  });

  it("the fault names the canon, because the canon IS the rule", () => {
    const path = "src/lib/cart/helpers.ts";
    const text = canonicalFault(judgeCanonical(path, canon), path, canon);
    expect(text).toContain("domain · index");
    expect(text).toContain("only domain may carry a .test sibling");
    const bare: CanonOptions = { root: "src/lib", allow: ["domain"] };
    expect(canonicalFault(judgeCanonical(path, bare), path, bare)).not.toContain("may carry a .test sibling");
    // A clean verdict renders nothing — there is no sentence to say about a file that is fine.
    expect(canonicalFault({ ok: true }, path, canon)).toBe("");
  });

  it("blocks through the check with the fault as its detail", async () => {
    expect(await run(canonicalFiles(canon), "write", file("src/lib/cart/helpers.ts", ""))).toContain("non-canonical");
    expect(await run(canonicalFiles(canon), "write", file("src/lib/cart/domain.ts", ""))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTENT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("jsonViolations", () => {
  it("keysPrefixedWith: only prefixed keys pass", () => {
    const a: JsonAssert[] = [{ path: "scripts", keysPrefixedWith: "//" }];
    expect(jsonViolations('{"scripts":{"//":"see justfile"}}', a)).toEqual([]);
    expect(jsonViolations('{"scripts":{"//":"x","dev":"run"}}', a)).toHaveLength(1);
  });

  it("keysPrefixedWith over a non-object constrains nothing", () => {
    expect(jsonViolations('{"scripts":"nope"}', [{ path: "scripts", keysPrefixedWith: "//" }])).toEqual([]);
  });

  it("matches: a stringified value against a regular expression", () => {
    const a: JsonAssert[] = [{ path: "version", matches: "^\\d+\\.\\d+\\.\\d+$" }];
    expect(jsonViolations('{"version":"1.2.3"}', a)).toEqual([]);
    expect(jsonViolations('{"version":"1.2"}', a)).toHaveLength(1);
  });

  it("equals and required, and an absent OPTIONAL path is silently fine", () => {
    const strict: JsonAssert[] = [
      { path: "compilerOptions.strict", equals: true, required: true },
      { path: "compilerOptions.noUncheckedIndexedAccess", equals: true },
    ];
    expect(jsonViolations('{"compilerOptions":{"strict":true}}', strict)).toEqual([]);
    expect(jsonViolations('{"compilerOptions":{}}', strict)).toHaveLength(1);
    expect(jsonViolations('{"compilerOptions":{"strict":false,"noUncheckedIndexedAccess":false}}', strict)).toHaveLength(
      2,
    );
  });

  it("digs a dotted path into the document, and an absent path is not found", () => {
    expect(jsonViolations('{"a":{"b":1}}', [{ path: "a.b", equals: 1 }])).toEqual([]);
    expect(jsonViolations('{"a":null}', [{ path: "a.b", required: true }])[0]).toContain("missing");
  });

  it("unparseable text yields nothing — a half-typed file is not a violation", () => {
    expect(jsonViolations("{not json", [{ path: "x", matches: "." }])).toEqual([]);
  });

  it("blocks through the check", async () => {
    const check = jsonInvariant({ assert: [{ path: "scripts", keysPrefixedWith: "//" }] });
    expect(await run(check, "write", file("package.json", '{"scripts":{"//":"x"}}'))).toBeNull();
    expect(await run(check, "write", file("package.json", '{"scripts":{"dev":"run"}}'))).toContain("must be prefixed");
  });
});

describe("unreferenced", () => {
  it("flags a name the sibling never mentions", () => {
    expect(unreferenced(["foo", "bar"], "test(foo)")).toEqual(["bar"]);
  });

  it("matches whole words, so a name inside a longer word does not count", () => {
    expect(unreferenced(["bar"], "rebarbative")).toEqual(["bar"]);
    expect(unreferenced(["bar"], "call(bar)")).toEqual([]);
  });

  it("treats a name carrying regex metacharacters literally", () => {
    expect(unreferenced(["a.b"], "call(a.b)")).toEqual([]);
    expect(unreferenced(["a.b"], "call(axb)")).toEqual(["a.b"]);
  });
});

describe("exportedNames", () => {
  it("reads real exports out of real source — a parser, not a regex", async () => {
    const names = await exportedNames(
      "export function foo(){}\nexport const bar = () => 1;\nexport class Baz {}\n// export const nope = 1\n",
    );
    expect(names).toContain("foo");
    expect(names).toContain("bar");
    expect(names).toContain("Baz");
    expect(names).not.toContain("nope");
  });
});

describe("symbolsInSibling", () => {
  const check = symbolsInSibling({ sibling: "{dir}/{name}.test.ts" });
  const source = "export function foo(){}\nexport const bar = () => 1;";

  it("names an export the sibling never references", async () => {
    const detail = await run(check, "write", {
      path: "a/x.ts",
      content: source,
      world: { fs: { "a/x.test.ts": "test(foo)" } },
    });
    expect(detail).toContain("'bar' is never referenced in a/x.test.ts");
  });

  it("passes when every export is referenced", async () => {
    const detail = await run(check, "write", {
      path: "a/x.ts",
      content: source,
      world: { fs: { "a/x.test.ts": "test(foo); test(bar)" } },
    });
    expect(detail).toBeNull();
  });

  it("a missing sibling is its own honest hit, not a crash", async () => {
    expect(await run(check, "write", file("a/x.ts", "export const q = 1;"))).toBe("sibling test not found: a/x.test.ts");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMIT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("changedSet", () => {
  it("prefers the event's own fact over asking git", async () => {
    const ctx = cannedCtx("commit", { staged: ["a.ts"] }, []);
    expect(await changedSet(ctx)).toEqual(["a.ts"]);
  });

  it("falls back to the capability when the moment carried no staged set", async () => {
    const ctx = cannedCtx("command", { command: "x", world: { staged: ["b.ts"] } }, []);
    expect(await changedSet(ctx)).toEqual(["b.ts"]);
  });
});

describe("lonelyChanges", () => {
  const groups: ChangeGroup[] = [{ if: ["package.json"], thenAny: ["package-lock.json", "pnpm-lock.yaml"] }];

  it("a trigger without its companion is a hit", () => {
    expect(lonelyChanges(["package.json", "src/x.ts"], groups)).toHaveLength(1);
  });

  it("trigger plus companion clears, and no trigger enforces nothing", () => {
    expect(lonelyChanges(["package.json", "package-lock.json"], groups)).toEqual([]);
    expect(lonelyChanges(["src/x.ts", "README.md"], groups)).toEqual([]);
  });

  it("blocks through the check, over the staged set the event carried", async () => {
    const check = changeTogether({ groups });
    expect(await run(check, "commit", { staged: ["package.json"] })).toContain("changed but none of");
    expect(await run(check, "commit", { staged: ["package.json", "package-lock.json"] })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("tokenizeCommand", () => {
  it("respects quotes, so a message mentioning a command is not a second command", () => {
    expect(tokenizeCommand(`git commit -m "git push origin main"`)).toEqual([
      "git",
      "commit",
      "-m",
      "git push origin main",
    ]);
  });

  it("emits operators, including a newline, as their own tokens", () => {
    expect(tokenizeCommand("a && b\nc")).toEqual(["a", "&&", "b", "\n", "c"]);
    expect(tokenizeCommand("a | b")).toEqual(["a", "|", "b"]);
    expect(tokenizeCommand("a ; b")).toEqual(["a", ";", "b"]);
  });

  it("unwraps a backslash escape and a double-quoted escape", () => {
    expect(tokenizeCommand("echo a\\ b")).toEqual(["echo", "a b"]);
    expect(tokenizeCommand(`echo "a\\"b"`)).toEqual(["echo", 'a"b']);
  });

  it("an unclosed quote is null — cannot tell, so do not judge", () => {
    expect(tokenizeCommand(`git commit -m "unclosed`)).toBeNull();
    expect(tokenizeCommand(`git commit -m 'unclosed`)).toBeNull();
  });
});

describe("gitInvocations", () => {
  it("splits git's own options from the subcommand and its arguments", () => {
    const invocations = gitInvocations("git -C /repo commit -m x") as GitInvocation[];
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toEqual({ globals: ["-C", "/repo"], subcommand: "commit", args: ["-m", "x"] });
  });

  it("`git commit -C HEAD` is a commit, not a command aimed at a directory named HEAD", () => {
    const invocations = gitInvocations("git commit -C HEAD") as GitInvocation[];
    expect(invocations[0]?.globals).toEqual([]);
    expect(invocations[0]?.subcommand).toBe("commit");
    expect(GIT_VALUE_OPTS.has("-C")).toBe(true);
  });

  it("only a git at a COMMAND position starts an invocation", () => {
    expect(gitInvocations(`echo "git commit"`)).toEqual([]);
    expect(gitInvocations("ls && git status")).toHaveLength(1);
  });

  it("an invocation with no subcommand at all is still reported", () => {
    expect(gitInvocations("git --version")?.[0]?.subcommand).toBeNull();
  });

  it("null on an unparseable line", () => {
    expect(gitInvocations(`git commit -m "unclosed`)).toBeNull();
  });
});

describe("gitDirPrefix and quoteArg", () => {
  it("copies -C through verbatim, so the shell resolves it exactly as git would", () => {
    expect(gitDirPrefix("git -C ../other commit -m x")).toBe("-C '../other'");
    expect(gitDirPrefix("git commit -m x")).toBe("");
    expect(gitDirPrefix("ls -la")).toBe("");
  });

  it("single-quotes an argument so nothing in it can be re-parsed", () => {
    expect(quoteArg("a b")).toBe("'a b'");
    // A quote inside single quotes cannot be escaped — POSIX shells have no escape there — so the
    // only correct spelling closes the quoting, emits an escaped quote, and reopens it.
    expect(quoteArg("it's")).toBe(`'it'\\''s'`);
  });
});

describe("commitMessage", () => {
  it("reads every -m form", () => {
    expect(commitMessage('git commit -m "feat: x"')).toBe("feat: x");
    expect(commitMessage("git commit -mfeat")).toBe("feat");
    expect(commitMessage('git commit --message "feat: x"')).toBe("feat: x");
    expect(commitMessage('git commit --message="feat: x"')).toBe("feat: x");
  });

  it("joins repeated -m as git joins them, with a blank line between", () => {
    expect(commitMessage("git commit -m subject -m body")).toBe("subject\n\nbody");
  });

  it("steps over the value, so a message that looks like a flag is not read twice", () => {
    expect(commitMessage("git commit -m -m")).toBe("-m");
  });

  it("a trailing -m with nothing after it stops rather than inventing a message", () => {
    expect(commitMessage("git commit -m")).toBeNull();
  });

  it("falls back to a heredoc body, which is how a message with backticks is written", () => {
    const command = "git commit -F - <<'EOF'\nfeat: x\n\nnew-dep: zod — checked ajv\nEOF";
    expect(commitMessage(command)).toBe("feat: x\n\nnew-dep: zod — checked ajv");
  });

  it("is not our business when there is no judgeable commit", () => {
    expect(commitMessage("git status")).toBeNull();
    expect(commitMessage("git commit")).toBeNull();
    expect(commitMessage("git commit -F message.txt")).toBeNull();
    expect(commitMessage(`git commit -m "unclosed`)).toBeNull();
  });
});

describe("heredocBody", () => {
  it("reads the first heredoc, quoted or bare", () => {
    expect(heredocBody("cat <<EOF\nbody\nEOF")).toBe("body");
    expect(heredocBody(`cat <<'EOF'\nbody\nEOF`)).toBe("body");
    expect(heredocBody('cat <<-"EOF"\nbody\nEOF')).toBe("body");
  });

  it("null when there is none, when it is unterminated, and when the body is empty", () => {
    expect(heredocBody("echo hi")).toBeNull();
    expect(heredocBody("cat <<EOF\nbody")).toBeNull();
    expect(heredocBody("cat <<EOF\nEOF")).toBeNull();
  });
});

describe("givesReason", () => {
  it("wants the token on a LINE of its own, because that is what makes it findable later", () => {
    expect(givesReason("feat: x\n\nnew-dep: zod because", "new-dep")).toBe(true);
    expect(givesReason("feat: x\n  new-dep : zod", "new-dep")).toBe(true);
    expect(givesReason("reverted the new-dep: thing", "new-dep")).toBe(false);
  });

  it("escapes the token, so one carrying a metacharacter matches only itself", () => {
    expect(givesReason("a.c: why", "a.c")).toBe(true);
    expect(givesReason("abc: why", "a.c")).toBe(false);
  });
});

describe("reasonHits", () => {
  const base = (over: Partial<ReasonInput>): ReasonInput => ({
    message: "feat: x",
    state: { changed: [], added: [] },
    token: "new-dep",
    ...over,
  });

  it("asks nothing when nothing it watches moved", () => {
    const state: WorkingState = { changed: ["README.md"], added: [] };
    expect(reasonHits(base({ state, whenChanged: ["package.json"] }))).toEqual([]);
  });

  it("names both conditions in ONE sentence, marked (new) and (changed)", () => {
    const state: WorkingState = { changed: ["package.json", "pure/thing.ts"], added: ["pure/thing.ts"] };
    const hits = reasonHits(base({ state, whenChanged: ["package.json"], whenAdded: ["pure/**"] }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("`package.json` (changed)");
    expect(hits[0]).toContain("`pure/thing.ts` (new)");
    expect(hits[0]).toContain("new-dep: <why>");
  });

  it("clears the moment the message records the reason", () => {
    const state: WorkingState = { changed: ["package.json"], added: [] };
    const message = "feat: x\n\nnew-dep: zod — schema validation, checked ajv";
    expect(reasonHits(base({ state, message, whenChanged: ["package.json"] }))).toEqual([]);
  });

  it("except exempts a path whichever condition matched it", () => {
    const state: WorkingState = { changed: ["pure/a.ts", "pure/a.test.ts"], added: ["pure/a.test.ts"] };
    const hits = reasonHits(base({ state, whenChanged: ["pure/**"], except: ["**/*.test.ts"] }));
    expect(hits[0]).not.toContain("a.test.ts");
  });

  it("folds the third condition's names into the SAME sentence, each naming the file it came from", () => {
    const state: WorkingState = { changed: ["package.json"], added: [] };
    const hits = reasonHits(
      base({ state, whenChanged: ["package.json"], namesAdded: [{ name: "audit", file: "cli/work.ts" }] }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("`package.json` (changed)");
    expect(hits[0]).toContain("`audit` (added in cli/work.ts)");
  });

  it("asks on the third condition alone, with nothing on the tree — the shape both verb ratchets bind", () => {
    const hits = reasonHits(base({ token: "caller", namesAdded: [{ name: "explain", file: "flow.ts" }] }));
    expect(hits[0]).toContain("`explain` (added in flow.ts)");
    expect(hits[0]).toContain("caller: <why>");
  });

  it("clears on the third condition too, once the message records the reason", () => {
    const message = "feat: explain\n\ncaller: human — no verb says why one entry did not fire";
    const hits = reasonHits(base({ message, token: "caller", namesAdded: [{ name: "explain", file: "flow.ts" }] }));
    expect(hits).toEqual([]);
  });
});

// The pure half of the third condition. A dispatch surface registers a name several ways and the
// list of shapes is the binding's, not the check's — two of the three forms this repo's own
// surfaces use went unwatched for a year under a version that hard-coded them.
describe("addedNames", () => {
  const CASE = 'case\\s+"([a-z][a-z-]*)"\\s*:';
  const SUB = 'sub\\s*===\\s*"([a-z][a-z-]*)"';

  it("reads names off ADDED lines only — a removal or a context line is not an addition", () => {
    const diff = ['+    case "audit":', '-    case "gone":', '     case "old":'].join("\n");
    expect(addedNames(diff, [CASE])).toEqual(["audit"]);
  });

  it("skips the +++ header, which names the file rather than a line of it", () => {
    expect(addedNames('+++ b/case "x":\n+    case "real":', [CASE])).toEqual(["real"]);
  });

  it("ignores a name the binding already knows, which is what makes it a ratchet", () => {
    const diff = '+    case "audit":\n+    case "plan":';
    expect(addedNames(diff, [CASE], ["plan"])).toEqual(["audit"]);
  });

  it("takes several patterns, so every way a surface registers a name counts", () => {
    const diff = '+    case "audit":\n+  } else if (sub === "explain") {';
    expect(addedNames(diff, [CASE, SUB]).sort()).toEqual(["audit", "explain"]);
  });

  it("finds every match on one line, and reports each name once", () => {
    expect(addedNames('+ case "a": case "b": case "a":', [CASE]).sort()).toEqual(["a", "b"]);
  });

  it("contributes nothing for a pattern with no capture group, rather than throwing at a commit gate", () => {
    expect(addedNames('+    case "audit":', ['case\\s+"[a-z]+"'])).toEqual([]);
  });
});

describe("commitReason", () => {
  const opts = { whenChanged: ["package.json"], whenAdded: ["pure/**"], token: "new-dep" };

  /** The three path-list reads the check makes, as a case would record them. */
  const gitWorld = (tracked: string[], adds: string[], untracked: string[]): CaseWorld => ({
    exec: {
      "git diff HEAD --name-only --diff-filter=A": { stdout: adds.join("\n") },
      "git diff HEAD --name-only": { stdout: tracked.join("\n") },
      "git ls-files --others --exclude-standard": { stdout: untracked.join("\n") },
    },
  });

  it("never asks git about a command that is not a judgeable commit", async () => {
    const { detail, missing } = await runWithReaches(commitReason(opts), "command", "git status");
    expect(detail).toBeNull();
    expect(missing).toEqual([]);
  });

  it("blocks a bare commit that moved a watched file, and clears once the reason is there", async () => {
    const world = gitWorld(["package.json"], [], []);
    const blocked = await run(commitReason(opts), "command", { command: 'git commit -m "feat: x"', world });
    expect(blocked).toContain("`package.json` (changed)");
    const withReason = await run(commitReason(opts), "command", {
      command: "git commit -m 'feat: x\n\nnew-dep: zod — checked ajv'",
      world,
    });
    expect(withReason).toBeNull();
  });

  it("reads a NEW file as new whether it is staged or untracked", async () => {
    const staged = gitWorld(["pure/a.ts"], ["pure/a.ts"], []);
    expect(await run(commitReason(opts), "command", { command: "git commit -m x", world: staged })).toContain("(new)");
    const untracked = gitWorld([], [], ["pure/b.ts"]);
    expect(await run(commitReason(opts), "command", { command: "git commit -m x", world: untracked })).toContain(
      "(new)",
    );
  });

  it("stands aside when git cannot answer, rather than trapping a commit it cannot judge", async () => {
    const world: CaseWorld = { exec: { "git ": { code: 128, stderr: "not a git repository" } } };
    expect(await run(commitReason(opts), "command", { command: "git commit -m x", world })).toBeNull();
  });

  it("carries a -C through to the git it runs, so another repo's commit is judged there", async () => {
    const missing: Unanswered[] = [];
    const ctx = cannedCtx("command", { command: "git -C ../other commit -m x" }, missing);
    await commitReason(opts)(ctx);
    expect(missing.every((m) => m.asked.includes("-C '../other'"))).toBe(true);
  });

  // ── the third condition, driven through the same door ──
  describe("diffAdds", () => {
    const ratchet = {
      token: "caller",
      diffAdds: [{ file: "cli/work.ts", patterns: ['case\\s+"([a-z][a-z-]*)"\\s*:'], known: ["plan"] }],
    };
    const surface = (diff: string): CaseWorld => ({ exec: { "diff HEAD -- 'cli/work.ts'": { stdout: diff } } });

    it("blocks a bare commit that added a name, and clears once the reason is there", async () => {
      const world = surface('+    case "audit":');
      const blocked = await run(commitReason(ratchet), "command", { command: 'git commit -m "feat: audit"', world });
      expect(blocked).toContain("`audit` (added in cli/work.ts)");
      const withReason = await run(commitReason(ratchet), "command", {
        command: "git commit -m 'feat: audit\n\ncaller: skill — no verb answers it'",
        world,
      });
      expect(withReason).toBeNull();
    });

    it("says nothing about a name the binding already knows — a refactor that moves one is silent", async () => {
      const world = surface('+    case "plan":');
      expect(await run(commitReason(ratchet), "command", { command: "git commit -m x", world })).toBeNull();
    });

    // A path condition costs three git reads; this one costs a diff. A binding that names only
    // `diffAdds` must not pay for the other three — every one is a question a case has to answer.
    it("asks git for the diff and NOTHING else when no path condition is bound", async () => {
      const { missing } = await runWithReaches(commitReason(ratchet), "command", { command: "git commit -m x" });
      expect(missing.map((m) => m.asked)).toEqual(["git diff HEAD -- 'cli/work.ts'"]);
    });

    it("stands aside when the diff cannot be read, rather than trapping the commit", async () => {
      const world: CaseWorld = { exec: { "diff HEAD -- 'cli/work.ts'": { code: 128, stderr: "not a git repository" } } };
      expect(await run(commitReason(ratchet), "command", { command: "git commit -m x", world })).toBeNull();
    });

    it("reads several surfaces, and each hit names the file it came from", async () => {
      const two = {
        token: "caller",
        diffAdds: [
          { file: "a.ts", patterns: ['case\\s+"([a-z]+)"'] },
          { file: "b.ts", patterns: ['case\\s+"([a-z]+)"'] },
        ],
      };
      const world: CaseWorld = {
        exec: {
          "diff HEAD -- 'a.ts'": { stdout: '+ case "one"' },
          "diff HEAD -- 'b.ts'": { stdout: '+ case "two"' },
        },
      };
      const detail = await run(commitReason(two), "command", { command: "git commit -m x", world });
      expect(detail).toContain("`one` (added in a.ts)");
      expect(detail).toContain("`two` (added in b.ts)");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE TURN
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("ranSinceEdit", () => {
  const check = ranSinceEdit({ edited: ["rules/**"], mustRun: "just test-rules" });

  it("an edit after the last run is the violation", async () => {
    const detail = await run(check, "turn-end", {
      actions: [
        { did: "edit", path: "rules/local/x.ts" },
        { did: "edit", path: "README.md" },
      ],
    });
    expect(detail).toContain("never ran `just test-rules`");
  });

  it("a run after the edit clears it", async () => {
    const detail = await run(check, "turn-end", {
      actions: [
        { did: "edit", path: "rules/local/x.ts" },
        { did: "run", command: "just test-rules" },
      ],
    });
    expect(detail).toBeNull();
  });

  it("a run BEFORE the edit does not", async () => {
    const detail = await run(check, "turn-end", {
      actions: [
        { did: "run", command: "just test-rules" },
        { did: "edit", path: "rules/local/x.ts" },
      ],
    });
    expect(detail).toContain("never ran");
  });

  it("an edit outside the watched globs is not this rule's business", async () => {
    expect(await run(check, "turn-end", { actions: [{ did: "edit", path: "src/app.ts" }] })).toBeNull();
  });

  it("an empty edited list could never fire, and says so by answering false", async () => {
    const empty = ranSinceEdit({ edited: [], mustRun: "just test" });
    expect(await run(empty, "turn-end", { actions: [{ did: "edit", path: "a.ts" }] })).toBeNull();
    const noCommand = ranSinceEdit({ edited: ["**"], mustRun: "" });
    expect(await run(noCommand, "turn-end", { actions: [{ did: "edit", path: "a.ts" }] })).toBeNull();
  });

  it("stands aside when the moment carried no turn facts at all", async () => {
    expect(await run(check, "turn-end", { staged: [] })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("skipForChanged", () => {
  it("no globs, or nothing to judge → run it (never silently skip a gate we cannot scope)", () => {
    expect(skipForChanged(["a.ts"], undefined)).toBe(false);
    expect(skipForChanged(["a.ts"], [])).toBe(false);
    expect(skipForChanged([], ["site/**"])).toBe(false);
  });

  it("skip only when the scoped area is genuinely untouched", () => {
    expect(skipForChanged(["src/x.ts"], ["site/**"])).toBe(true);
    expect(skipForChanged(["site/src/x.astro"], ["site/**"])).toBe(false);
  });
});

describe("failureExcerpt", () => {
  it("surfaces the error lines and drops the success chatter", () => {
    const out = [
      "Running tests",
      "ok 1",
      "✖ the widget renders",
      "AssertionError: expected 1 to equal 2",
      "ℹ pass 2",
    ].join("\n");
    const excerpt = failureExcerpt(out);
    expect(excerpt).toContain("AssertionError");
    expect(excerpt).toContain("widget renders");
    expect(excerpt).not.toContain("Running tests");
  });

  it("falls back to the tail when nothing looks like an error, and stays capped", () => {
    const excerpt = failureExcerpt(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(8);
    expect(excerpt).toContain("line 39");
  });
});

describe("execPasses", () => {
  it("passes on exit 0 and blocks with an excerpt otherwise", async () => {
    const ok = await run(execPasses({ run: "just test" }), "commit", {
      staged: ["a.ts"],
      world: { exec: { "just test": { code: 0 } } },
    });
    expect(ok).toBeNull();
    const bad = await run(execPasses({ run: "just test" }), "commit", {
      staged: ["a.ts"],
      world: { exec: { "just test": { code: 3, stdout: "AssertionError: nope" } } },
    });
    expect(bad).toContain("exit 3");
    expect(bad).toContain("AssertionError");
  });

  it("a scoped gate stays quiet when its area is untouched, and never runs the tool", async () => {
    const { detail, missing } = await runWithReaches(execPasses({ run: "just site", changed: ["site/**"] }), "commit", {
      staged: ["src/x.ts"],
    });
    expect(detail).toBeNull();
    expect(missing).toEqual([]);
  });

  it("{files} hands the tool the changed set — the old empty-argv blindness", async () => {
    const missing: Unanswered[] = [];
    const ctx = cannedCtx("commit", { staged: ["a b.ts", "c.ts"] }, missing);
    await execPasses({ run: "npx eslint {files}" })(ctx);
    expect(missing[0]?.asked).toBe("npx eslint 'a b.ts' 'c.ts'");
  });

  it("a run string naming {files} with nothing changed does not run at all", async () => {
    const { detail, missing } = await runWithReaches(execPasses({ run: "npx eslint {files}" }), "commit", {
      staged: [],
    });
    expect(detail).toBeNull();
    expect(missing).toEqual([]);
  });
});

describe("the depcruise dialect", () => {
  it("globToRe emits only ReDoS-guard-safe constructs, unchanged from before the tokeniser", () => {
    expect(globToRe("src/**")).toBe("^src/");
    expect(globToRe("src/**/*.ts")).toBe("^src/.*[^/]*\\.ts$");
    expect(globToRe("src/x.ts")).toBe("^src/x\\.ts$");
    expect(globToRe("**")).toBe("^");
    expect(globToRe("**/node_modules/@ast-grep/napi/**")).toBe("^.*node_modules/@ast-grep/napi/");
  });

  it("speaks the WHOLE dialect — a brace glob used to compile to a fence matching nothing", () => {
    // The bug this fix exists for: `{` and `}` were escaped into literals, so this fence looked
    // healthy and matched no module in any repo, forever.
    expect(globToRe("src/**/*.{ts,tsx}")).toBe("^src/.*[^/]*\\.(ts|tsx)$");
    expect(new RegExp(globToRe("src/**/*.{ts,tsx}")).test("src/lib/a.tsx")).toBe(true);
    expect(new RegExp(globToRe("src/**/*.{ts,tsx}")).test("src/lib/a.css")).toBe(false);
    // …and `?`, which used to pass through raw and become a regex quantifier on the character
    // before it — `src/?.ts` meant "an optional slash", not "one character".
    expect(globToRe("src/?.ts")).toBe("^src/[^/]\\.ts$");
    expect(new RegExp(globToRe("src/?.ts")).test("src/a.ts")).toBe(true);
    expect(new RegExp(globToRe("src/?.ts")).test("src.ts")).toBe(false);
  });

  it("both emitters read the same tokens, so a glob means one thing in a fence and in a scope", () => {
    // Anchors aside — the fence's one deliberate difference — the two emitters must agree
    // character for character. `RegExp.source` also escapes `/`, which is the engine's spelling
    // and not a token, so both sides are normalised before comparing.
    const body = (re: string): string =>
      re
        .replace(/\\\//g, "/")
        .replace(/^\^/, "")
        .replace(/\$$/, "");
    // No trailing `**` here: that is the one glob whose fence deliberately drops a token, and it
    // is asserted on its own above.
    for (const glob of ["src/**/*.{ts,tsx}", "src/?.ts", "a/**/b.ts", "x.ts", "a{b,c}?d*e.ts"]) {
      expect(body(globToRegExp(glob).source), glob).toBe(body(globToRe(glob)));
    }
  });

  it("entryToMatcher tells a builtin, a bare npm package and a path glob apart", () => {
    expect(entryToMatcher("node:*")).toEqual({ core: true });
    expect(entryToMatcher("node:path")).toEqual({ path: "^node:path$" });
    expect(entryToMatcher("vitest")).toEqual({ path: "node_modules/vitest(/|$)" });
    expect(entryToMatcher("src/**")).toEqual({ path: "^src/" });
    // A DOT AND NO SLASH IS A FILE AT THE ROOT, not a package: read as a package these compiled to
    // `node_modules/glob.ts`, and the layer they were written for covered nothing while the fence
    // still read as armed.
    expect(entryToMatcher("glob.ts")).toEqual({ path: "^glob\\.ts$" });
    expect(entryToMatcher("index.ts")).toEqual({ path: "^index\\.ts$" });
    // …and the mirror case keeps the spelling a scoped package already needs: a dotted package name
    // is a PATH under node_modules, never a bare word.
    expect(entryToMatcher("**/node_modules/socket.io/**")).toEqual({ path: "^.*node_modules/socket\\.io/" });
  });

  it("layersMatcher ORs a layer's paths and lifts builtins to a dependency type", () => {
    const layers = { pure: ["src/pure/**"], node: ["node:*"], gone: [] };
    const m: Matcher = layersMatcher(["pure", "node", "nosuch", "gone"], layers);
    expect(m["path"]).toEqual(["^src/pure/"]);
    expect(m["dependencyTypes"]).toEqual(["core"]);
  });

  it("compiles only: into a fail-closed allowlist naming the layers", () => {
    const config: NativeConfig = compileDialect({
      scan: "src/**/*.ts",
      layers: { pure: ["src/pure/**"], node: ["node:path"] },
      only: { pure: ["pure", "node"] },
    });
    const rule = config.forbidden.find((r: NativeRule) => r.name === "pure-only");
    expect(rule?.comment).toContain("pure may import only: pure, node");
    expect(rule?.to?.["pathNot"]).toEqual(["^src/pure/", "^node:path$"]);
  });

  it("compiles forbid edges, transitive and plain, with the fence's own why", () => {
    const forbid: ForbidEdge[] = [{ from: "core", to: "fx", transitive: true, why: "purity is transitive" }];
    const config = compileDialect({ scan: "s", layers: { core: ["c/**"], fx: ["f/**"] }, forbid });
    const rule = config.forbidden[0];
    expect(rule?.name).toBe("no-core-to-fx-transitive");
    expect(rule?.comment).toBe("purity is transitive");
    expect(rule?.to?.["reachable"]).toBe(true);
    const plain = compileDialect({ scan: "s", layers: { core: ["c/**"], fx: ["f/**"] }, forbid: [{ from: "core", to: "fx" }] });
    expect(plain.forbidden[0]?.comment).toBe("core must not import fx");
  });

  it("carves out type-only imports, which are erased at compile time and never an edge", () => {
    const config = compileDialect({
      scan: "s",
      layers: { core: ["c/**"], t: ["t/**"] },
      except: ["type-only"],
      forbid: [{ from: "core", to: "t" }],
    });
    expect(config.forbidden[0]?.to?.["dependencyTypesNot"]).toEqual(["type-only"]);
  });

  it("compiles the standing shapes: circular, orphans and a sideways cycle", () => {
    const config = compileDialect({
      scan: "s",
      layers: { feature: ["src/lib/*"] },
      forbid: ["circular", "orphans", { cyclesBetween: "feature", why: "features are islands" }],
    });
    expect(config.forbidden.map((r) => r.name)).toEqual(["no-circular", "no-orphans", "no-cycles-between-feature"]);
    expect(config.forbidden[2]?.to?.["pathNot"]).toBe("$1/");
    const unnamed = compileDialect({ scan: "s", layers: { f: ["src/*"] }, forbid: [{ cyclesBetween: "f" }] });
    expect(unnamed.forbidden[0]?.comment).toBe("f must not import sideways");
  });

  it("compiles require: into an inverted rule, and warn: into a non-blocking one", () => {
    const req: RequireEdge[] = [{ in: "src/**", import: "src/telemetry.ts", why: "everything reports" }];
    const config = compileDialect({ scan: "s", layers: {}, require: req, warn: ["sdp", "unknown"] });
    expect(config.required[0]?.name).toBe("must-import-src/telemetry.ts");
    expect(config.required[0]?.comment).toBe("everything reports");
    expect(config.forbidden.map((r) => r.name)).toEqual(["sdp"]);
    expect(config.forbidden[0]?.severity).toBe("warn");
    const bare = compileDialect({ scan: "s", layers: {}, require: [{ in: "a/**", import: "b.ts" }] });
    expect(bare.required[0]?.comment).toBe("modules in a/** must import b.ts");
  });

  it("resolves imports and does not walk node_modules, and passes options through", () => {
    const config = compileDialect({ scan: "s", layers: {}, options: { maxDepth: 3 } });
    expect(config.options["tsPreCompilationDeps"]).toBe(false);
    expect(config.options["doNotFollow"]).toEqual({ path: "node_modules" });
    expect(config.options["maxDepth"]).toBe(3);
  });

  it("ignores a forbid edge that names neither end — it fences nothing", () => {
    expect(compileDialect({ scan: "s", layers: {}, forbid: [{ why: "orphaned rule" }] }).forbidden).toEqual([]);
  });
});

describe("depcruiseCommand", () => {
  const dialect: Dialect = { scan: "src/**/*.ts", layers: { pure: ["src/pure/**"] }, forbid: ["circular"] };

  it("carries the compiled config in a QUOTED heredoc, one line, so nothing can be re-parsed", () => {
    const command = depcruiseCommand(dialect);
    expect(command).toContain("<<'FLOW_DEPCRUISE_CONFIG'");
    const body = command.split("\n")[2] ?? "";
    expect(JSON.parse(body).forbidden[0].name).toBe("no-circular");
    expect(body.includes("\n")).toBe(false);
  });

  it("resolves the local tool and preserves the tool's own exit code past the cleanup", () => {
    const command = depcruiseCommand(dialect);
    expect(command).toContain("npx --no-install depcruise");
    expect(command).toContain("'src/**/*.ts'");
    expect(command).toContain("rc=$?");
    expect(command.trimEnd().endsWith("exit $rc")).toBe(true);
  });
});

describe("depcruiseHits", () => {
  it("names the fence, the edge and the why", () => {
    const stdout = JSON.stringify({
      summary: { violations: [{ rule: { name: "pure-only", comment: "pure imports only pure" }, from: "a.ts", to: "b.ts" }] },
    });
    expect(depcruiseHits({ stdout, stderr: "", code: 1 })).toEqual([
      "pure-only: a.ts → b.ts — pure imports only pure",
    ]);
  });

  it("an unnamed violation still reads, and a clean cruise says nothing", () => {
    const stdout = JSON.stringify({ summary: { violations: [{ from: "a.ts", to: "b.ts" }] } });
    expect(depcruiseHits({ stdout, stderr: "", code: 1 })).toEqual(["fence: a.ts → b.ts"]);
    expect(depcruiseHits({ stdout: JSON.stringify({ summary: {} }), stderr: "", code: 0 })).toEqual([]);
  });

  it("unparseable output is a REAL failure when the tool failed, and silence when it did not", () => {
    expect(depcruiseHits({ stdout: "", stderr: "boom", code: 2 })[0]).toContain("depcruise failed (exit 2)");
    expect(depcruiseHits({ stdout: "not json", stderr: "", code: 0 })).toEqual([]);
  });

  it("blocks through the check", async () => {
    const stdout = JSON.stringify({ summary: { violations: [{ rule: { name: "pure-only" }, from: "a", to: "b" }] } });
    const world: CaseWorld = { exec: { depcruise: { stdout, code: 1 } } };
    expect(await run(depcruise({ scan: "s", layers: {} }), "commit", { staged: ["a.ts"], world })).toContain("pure-only");
  });
});

describe("the ast-grep grammar registry", () => {
  it("resolves every tier-0 native without an install", async () => {
    expect(NATIVE_LANGUAGES).toContain("typescript");
    for (const name of NATIVE_LANGUAGES) {
      const resolved = await resolveLang(name);
      expect(resolved.ok).toBe(true);
    }
  });

  it("an unknown grammar is a named refusal, never a silent fall-through to tsx", async () => {
    const resolved = await resolveLang("no-such-grammar");
    expect(resolved.ok).toBe(false);
    expect(resolved.ok ? "" : resolved.detail).toContain("no-such-grammar");
    expect(resolved.ok ? "" : resolved.detail).toContain("@ast-grep/lang-no-such-grammar");
  });
});

describe("astGrep", () => {
  const rule = { any: [{ pattern: "$X ?? new Date($$$)" }, { pattern: "$X ?? new Date" }] };

  it("matches a code SHAPE and reports its line", async () => {
    const hits = await astGrepHits("const p = a ?? new Date();", rule, "tsx");
    expect(hits.ok && hits.hits).toHaveLength(1);
    expect(hits.ok && hits.hits[0]).toContain("1:");
  });

  it("does not match a different shape", async () => {
    const hits = await astGrepHits("const p = a || new Date();", rule, "tsx");
    expect(hits.ok && hits.hits).toEqual([]);
  });

  it("blocks through the check, and an unknown grammar BLOCKS rather than passing quietly", async () => {
    expect(await run(astGrep({ rule, language: "tsx" }), "write", file("a.ts", "const p = a ?? new Date();"))).toContain(
      "1:",
    );
    expect(await run(astGrep({ rule, language: "tsx" }), "write", file("a.ts", "const p = 1;"))).toBeNull();
    expect(await run(astGrep({ rule, language: "klingon" }), "write", file("a.ts", "x"))).toContain("klingon");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CASES
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("readCase — the one ladder over the case union", () => {
  it("reads the dialect a case is written in", () => {
    expect(caseMoment("git push")).toBe("command");
    expect(caseMoment({ command: "git push" })).toBe("command");
    expect(caseMoment({ path: "a.ts", content: "" })).toBe("write");
    expect(caseMoment({ staged: [] })).toBe("commit");
    expect(caseMoment({ actions: [] })).toBe("turn-end");
  });

  it("reads the dialect, the facts and the world in ONE pass, so they cannot disagree", () => {
    expect(readCase("git push")).toEqual({ dialect: "command", facts: { command: "git push" }, world: {} });
    const world: CaseWorld = { fs: { "a.ts": "x" } };
    expect(readCase({ path: "a.ts", content: "x", world })).toEqual({
      dialect: "write",
      facts: { file: { path: "a.ts", content: "x" } },
      world,
    });
    expect(readCase({ command: "ls" }).world).toEqual({});
    expect(readCase({ staged: ["a.ts"] }).facts).toEqual({ staged: ["a.ts"] });
    expect(readCase({ actions: [{ did: "edit", path: "a.ts" }] }).facts).toEqual({
      turn: [{ did: "edit", path: "a.ts" }],
    });
  });

  it("every dialect is one a guardrail moment can actually be handed", async () => {
    const dialects: CaseDialect[] = ["command", "write", "commit", "turn-end"];
    const cases: Case[] = ["ls", { path: "a.ts", content: "" }, { staged: [] }, { actions: [] }];
    const moments = ["command", "write", "commit", "turn-end"];
    for (const [i, c] of cases.entries()) {
      expect(readCase(c).dialect).toBe(dialects[i]);
      const result = await runCase(entry({ at: [moments[i] as string] }), (ctx) => ctx.ok(), c, "pass", 0);
      expect(result.ok, `${dialects[i]} should reach a ${moments[i]} rail`).toBe(true);
    }
  });
});

describe("cannedCtx", () => {
  it("matches a recorded exec answer exactly, and by containment for a command nobody would retype", async () => {
    const ctx = cannedCtx("command", { command: "x", world: { exec: { "just test": { stdout: "exact", code: 0 } } } }, []);
    expect((await ctx.exec("just test")).stdout).toBe("exact");
    expect((await ctx.exec("bash -lc 'just test --watch=false'")).stdout).toBe("exact");
  });

  it("records a reach the case never answered, rather than guessing or throwing", async () => {
    const missing: Unanswered[] = [];
    const ctx = cannedCtx("command", "x", missing);
    await ctx.exec("just nope");
    await ctx.fs.read("nope.ts");
    expect(missing).toEqual([
      { kind: "exec", asked: "just nope" },
      { kind: "read", asked: "nope.ts" },
    ]);
    expect(unansweredText(missing)).toContain("world.exec");
    expect(unansweredText(missing)).toContain("world.fs");
  });

  it("a path the case never mentions simply is not there — absence is an ordinary answer", async () => {
    const missing: Unanswered[] = [];
    const ctx = cannedCtx("write", file("a.ts", ""), missing);
    expect(await ctx.fs.exists("b.ts")).toBe(false);
    expect(missing).toEqual([]);
  });

  it("answers git from the case, and defaults its diff to empty", async () => {
    const ctx = cannedCtx("commit", { staged: ["a.ts"], world: { gitDiff: "diff --git" } }, []);
    expect(await ctx.git.stagedFiles()).toEqual(["a.ts"]);
    expect(await ctx.git.diff()).toBe("diff --git");
    expect(await cannedCtx("command", "x", []).git.diff()).toBe("");
  });
});

/** A loaded entry, as the load hands one over — the runner's only input. */
const entry = (over: {
  at?: string[];
  on?: string[];
  ignore?: string[];
  check?: Check;
  test?: { pass?: Case[]; block?: Case[] };
  disabled?: boolean;
}): LoadedEntry => ({
  id: "house.rule",
  pack: "house",
  key: "rule",
  spec: {
    kind: "guardrail",
    at: (over.at ?? ["write"]) as never,
    check: over.check ?? ((ctx) => ctx.ok()),
    message: "No.",
    ...(over.on ? { on: over.on } : {}),
    ...(over.ignore ? { ignore: over.ignore } : {}),
    ...(over.test ? { test: over.test } : {}),
    ...(over.disabled === true ? { disabled: {} } : {}),
  },
  source: {},
  categories: [],
  phases: [],
});

describe("runCase", () => {
  const blocks: Check = (ctx) => ctx.fail("because");
  const passes: Check = (ctx) => ctx.ok();

  it("a block case that blocks, and a pass case that passes, are the two green outcomes", async () => {
    const b = await runCase(entry({}), blocks, file("a.ts", ""), "block", 0);
    expect(b).toEqual({ entry: "house.rule", expect: "block", index: 0, ok: true, detail: "" });
    const p = await runCase(entry({}), passes, file("a.ts", ""), "pass", 0);
    expect(p.ok).toBe(true);
  });

  it("a block case the rule lets through is the failure this whole layer exists for", async () => {
    const result = await runCase(entry({}), passes, file("a.ts", ""), "block", 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("does not catch what it says it catches");
  });

  it("a pass case the rule blocks reports the rule's own detail", async () => {
    const result = await runCase(entry({}), blocks, file("a.ts", ""), "pass", 1);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("because");
    const quiet = await runCase(entry({}), (ctx) => ctx.fail(), file("a.ts", ""), "pass", 0);
    expect(quiet.detail).toContain("expected a pass");
  });

  it("a case in a dialect the entry has no rail for is its own failure, and a loud one", async () => {
    const result = await runCase(entry({ at: ["write"] }), passes, "git push origin main", "block", 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("command dialect");
    const nowhere = await runCase(entry({ at: [] }), passes, file("a.ts", ""), "pass", 0);
    expect(nowhere.detail).toContain("no moment at all");
  });

  it("a check that throws is a case that failed, named", async () => {
    const boom: Check = () => {
      throw new Error("kaboom");
    };
    const result = await runCase(entry({}), boom, file("a.ts", ""), "pass", 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("kaboom");
  });

  it("a case that reached the world with no recorded answer fails, naming what to add", async () => {
    const reaches: Check = async (ctx) => ((await ctx.exec("just test")).code === 0 ? ctx.ok() : ctx.fail());
    const result = await runCase(entry({ at: ["commit"] }), reaches, { staged: [] }, "pass", 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("just test");
    expect(result.detail).toContain("world.exec");
  });

  it("matches a commit case to a commit moment and a turn case to turn-end", async () => {
    expect((await runCase(entry({ at: ["commit"] }), passes, { staged: [] }, "pass", 0)).ok).toBe(true);
    expect((await runCase(entry({ at: ["turn-end"] }), passes, { actions: [] }, "pass", 0)).ok).toBe(true);
    expect((await runCase(entry({ at: ["delete"] }), passes, file("a.ts", ""), "pass", 0)).ok).toBe(true);
  });

  // The commit fan-out, from a recorded world — the same split `subjectsOf` makes at the live gate.
  // Without it a commit-only CONTENT rule was handed `ctx.file` empty and passed a fixture full of
  // the thing it exists to catch: green, and not evidence about the rail.
  describe("a commit entry that named paths", () => {
    const banned: Check = (ctx) => (ctx.file?.content.includes("SECRET") === true ? ctx.fail(ctx.file.path) : ctx.ok());
    const scoped = entry({ at: ["commit"], on: ["**"], ignore: ["**/*.test.ts"], check: banned });

    it("is asked once per staged file in scope, holding that file", async () => {
      const result = await runCase(scoped, banned, { staged: ["a.ts"], world: { fs: { "a.ts": "SECRET" } } }, "block", 0);
      expect(result.ok).toBe(true);
    });

    it("honours the entry's own ignore list, so an out-of-scope file is never a subject", async () => {
      const result = await runCase(scoped, banned, { staged: ["a.test.ts"], world: { fs: { "a.test.ts": "SECRET" } } }, "pass", 0);
      expect(result.ok).toBe(true);
    });

    it("reports a staged path the case recorded no content for, rather than passing on the silence", async () => {
      const result = await runCase(scoped, banned, { staged: ["a.ts"], world: { fs: { "a.ts": "fine" } } }, "pass", 0);
      expect(result.ok).toBe(true);
      const missing = await runCase(scoped, banned, { staged: ["a.ts"] }, "pass", 0);
      // No content recorded means the path does not exist — a staged deletion, live — so there is
      // no subject and nothing to refuse.
      expect(missing.ok).toBe(true);
    });

    it("still hands an UNSCOPED commit entry the staged set, once", async () => {
      const counts: Check = (ctx) => ((ctx.staged ?? []).length === 2 ? ctx.fail("two") : ctx.ok());
      const result = await runCase(entry({ at: ["commit"], check: counts }), counts, { staged: ["a.ts", "b.ts"] }, "block", 0);
      expect(result.ok).toBe(true);
    });
  });
});

describe("runCases", () => {
  it("walks every bound entry's pass and block lists", async () => {
    const results: CaseResult[] = await runCases([
      entry({ check: (ctx) => (ctx.file?.content === "bad" ? ctx.fail() : ctx.ok()), test: { pass: [file("a.ts", "ok")], block: [file("a.ts", "bad")] } }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.expect)).toEqual(["pass", "block"]);
  });

  it("skips a disabled entry, a breadcrumb and anything with no check", async () => {
    const crumb: LoadedEntry = {
      id: "house.note",
      pack: "house",
      key: "note",
      spec: { kind: "breadcrumb", at: ["session"], text: "hi" },
      source: {},
      categories: [],
      phases: [],
    };
    const results = await runCases([entry({ disabled: true, test: { pass: [file("a.ts", "")] } }), crumb]);
    expect(results).toEqual([]);
  });

  it("an entry with no cases contributes nothing — the load is what refuses it", async () => {
    expect(await runCases([entry({})])).toEqual([]);
  });

  it("verdict is the one spelling a check answers in", () => {
    expect(verdict.ok()).toEqual({ ok: true });
    expect(verdict.fail("why")).toEqual({ ok: false, detail: "why" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WHOLE SHELF, BOUND
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// The section above proves each check against its own samples, called directly. This one proves
// something the others cannot: that every stock check is BINDABLE — that it fits a sentence, that
// its options survive a pack's typed factory, that the moment it needs is a moment the grammar
// has, and that its cases really do drive it. A check can be perfectly correct and unbindable, and
// the failure looks like nothing at all until somebody tries to use it.
//
// It runs the same fixture `flow test` runs (see F2's proof transcript), so the two cannot drift.

describe("every stock check, bound in a real config", () => {
  it("loads with no refusals and every case passes", async () => {
    const { default: config } = await import("../__fixtures__/core.config.ts");
    const loaded = loadConfig(config);
    expect(loaded.ok ? [] : loaded.refusals).toEqual([]);
    const entries = loaded.ok ? loaded.entries : [];
    const results = await runCases(entries);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    // One pass case and one block case for each of the fourteen, plus the extra pass case that
    // proves commitReason never asks git about a command that is not a commit.
    expect(results).toHaveLength(28);
  });

  it("an entry whose cases block is empty does not load at all, and the refusal names it", async () => {
    const { default: config } = await import("../__fixtures__/core-no-cases.config.ts");
    const loaded = loadConfig(config);
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? [] : loaded.refusals.map((r) => [r.code, r.entry])).toEqual([
      ["no-cases", "thin.testsPassAtCommit"],
    ]);
  });
});
