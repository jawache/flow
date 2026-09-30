// flow/tools/bash-reads.ts — THE BAKE-OFF: three ways of naming the files a Bash command reads,
// each an `Extractor` that score-bash.ts runs over the hand-labelled corpus.
//
//   literal     a hand-written shell lexer (quotes, heredocs, `$(…)`, redirects, `cd`, `VAR=`)
//               over a table of the read commands and which of their arguments are files
//   grammar     the same table over tree-sitter-bash's parse (through @ast-grep/napi, which the
//               package already ships), which also sees `for` loops, nesting and heredocs exactly
//   functions   shell functions shadowing the read commands, the shape a `CLAUDE_ENV_FILE` would
//               install: each logs its post-expansion argv and the working directory. Scored by
//               RUNNING every corpus command in zsh (the shell Claude Code runs here) with no
//               external program reachable and every absolute path moved under a throwaway root,
//               so nothing the command names is read or written for real
//
// ALL THREE SHARE ONE TABLE — which argument of `grep` is the pattern and which are files is the
// same fact whoever parsed the line — so the table measures nothing between them and the parse is
// the whole difference. It is a prototype: the winner is ported into adapter/domain.ts and this
// file goes, because the import fence keeps tools/ and adapter/ apart and a second live copy of
// the shipped extractor is how the two would drift.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import bash from "@ast-grep/lang-bash";
import type { Targets } from "./domain.ts";

// ══ THE TABLE — which arguments of a read command are files ═════════════════

interface Spec {
  /** Options that consume the next argument. */
  readonly valued?: readonly string[];
  /** Options whose value is itself a file read (`grep -f pats`, `awk -f prog.awk`). */
  readonly fileOpts?: readonly string[];
  /** Positional operands that are not files (a pattern, a script, a filter) … */
  readonly skip?: number;
  /** … unless one of these options supplied it instead. */
  readonly supplied?: readonly string[];
  /** What is read when no file operand is given: the working directory, or nothing (stdin). */
  readonly dflt?: "." | "recursive";
  /** The first operand that ends the file list (`find`'s expression). */
  readonly stop?: (arg: string) => boolean;
  /** The last operand is a destination, not a read (`cp`). */
  readonly lastIsDest?: boolean;
}

const GREP: Spec = {
  valued: ["-e", "-f", "-A", "-B", "-C", "-m", "-d", "-D", "--regexp", "--file", "--include", "--exclude", "--exclude-dir", "--max-count", "--context", "--after-context", "--before-context", "--color", "--colour", "--label"],
  fileOpts: ["-f", "--file"],
  skip: 1,
  supplied: ["-e", "-f", "--regexp", "--file"],
  dflt: "recursive",
};
const RG: Spec = {
  valued: ["-e", "-f", "-g", "-t", "-T", "-A", "-B", "-C", "-m", "-M", "-d", "-j", "-r", "-E", "--regexp", "--file", "--glob", "--iglob", "--type", "--type-not", "--type-add", "--max-count", "--max-columns", "--max-depth", "--threads", "--replace", "--encoding", "--sort", "--sortr", "--context", "--after-context", "--before-context", "--ignore-file", "--pre", "--max-filesize", "--context-separator", "--field-match-separator", "--colors", "--color"],
  fileOpts: ["-f", "--file", "--ignore-file"],
  skip: 1,
  supplied: ["-e", "-f", "--regexp", "--file", "--files", "--type-list"],
  dflt: ".",
};
const PLAIN: Spec = {};

const TABLE: Readonly<Record<string, Spec>> = {
  cat: PLAIN,
  bat: { valued: ["-l", "-r", "--language", "--line-range", "--style", "--theme"] },
  less: PLAIN,
  more: PLAIN,
  nl: { valued: ["-b", "-w", "-s", "-v", "-i"] },
  tac: PLAIN,
  head: { valued: ["-n", "-c"] },
  tail: { valued: ["-n", "-c", "-b", "-s"] },
  wc: PLAIN,
  sed: { valued: ["-e", "-f", "-l", "--expression", "--file"], fileOpts: ["-f", "--file"], skip: 1, supplied: ["-e", "-f", "--expression", "--file"] },
  awk: { valued: ["-F", "-v", "-f"], fileOpts: ["-f"], skip: 1, supplied: ["-f"] },
  jq: { valued: ["-f", "--from-file", "--indent", "--arg", "--argjson", "--slurpfile", "--rawfile", "--args", "--jsonargs"], fileOpts: ["-f", "--from-file"], skip: 1, supplied: ["-f", "--from-file"] },
  grep: GREP,
  egrep: GREP,
  fgrep: GREP,
  rg: RG,
  find: { stop: (a) => a.startsWith("-") || a === "(" || a === "!" || a === "\\(", dflt: "." },
  ls: { valued: ["-I", "--ignore", "--hide", "-w", "--width"], dflt: "." },
  du: { valued: ["-d", "-B", "--max-depth"], dflt: "." },
  tree: { valued: ["-L", "-I", "-P"], dflt: "." },
  diff: { valued: ["-U", "-C", "-x", "-X", "-I", "-L", "--label", "--exclude"] },
  cmp: PLAIN,
  cut: { valued: ["-d", "-f", "-c", "-b"] },
  sort: { valued: ["-k", "-t", "-o", "-S", "-T"] },
  uniq: { valued: ["-f", "-s"] },
  column: { valued: ["-s", "-c"] },
  xxd: { valued: ["-l", "-s", "-c", "-g"] },
  od: { valued: ["-N", "-j", "-t", "-A"] },
  hexdump: { valued: ["-n", "-s", "-e"] },
  strings: { valued: ["-n"] },
  md5: { valued: ["-s"] },
  md5sum: PLAIN,
  shasum: { valued: ["-a"] },
  sha256sum: PLAIN,
  file: PLAIN,
  cp: { valued: ["-t", "-S"], lastIsDest: true },
};

/** Where `git` takes pathspecs a reader is looking at. */
const GIT_READS = new Set(["diff", "log", "show", "status", "add", "blame", "ls-files", "grep"]);
/** Wrappers whose tail is another command, with the options that consume a value. */
const WRAPPERS: Readonly<Record<string, { valued: readonly string[]; positional?: number }>> = {
  timeout: { valued: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
  nohup: { valued: [] },
  time: { valued: [] },
  nice: { valued: ["-n"] },
  sudo: { valued: ["-u", "-g", "-C"] },
  env: { valued: ["-u", "-C"] },
  stdbuf: { valued: ["-i", "-o", "-e"] },
  command: { valued: [] },
  builtin: { valued: [] },
  exec: { valued: [] },
};

/** A word the parse could not settle — a `$(…)`, an unknown variable. Never a path. */
export type Arg = string | null;

const isOption = (a: string): boolean => a.startsWith("-") && a !== "-";

/**
 * The files one simple command reads, raw (as written, before `cwd`), plus the directory they are
 * relative to when the command moves it (`git -C`). Unknown arguments are skipped, never guessed.
 */
export function argvReads(argv: readonly Arg[]): { reads: string[]; base?: string } {
  let words = [...argv];
  // Wrappers first: `timeout 300 rg …`, `env X=1 cat f`, `xargs -a list grep …`.
  const reads: string[] = [];
  for (;;) {
    const head = words[0];
    if (head === undefined || head === null) return { reads };
    const name = posix.basename(head);
    const wrap = WRAPPERS[name];
    if (name === "xargs") {
      let i = 1;
      while (i < words.length && isOption(words[i] ?? "")) {
        const opt = words[i] as string;
        if (opt === "-a" || opt === "--arg-file") reads.push(...(words[i + 1] ? [words[i + 1] as string] : []));
        i += ["-a", "--arg-file", "-n", "-I", "-L", "-P", "-d", "-E", "-s"].includes(opt) ? 2 : 1;
      }
      words = words.slice(i);
      continue;
    }
    if (wrap === undefined) break;
    if (name === "command" && (words[1] === "-v" || words[1] === "-V")) return { reads };
    let i = 1;
    while (i < words.length) {
      const w = words[i];
      if (w !== null && w !== undefined && isOption(w)) i += wrap.valued.includes(w) ? 2 : 1;
      else if (name === "env" && w !== null && w !== undefined && /^[A-Za-z_]\w*=/.test(w)) i += 1;
      else break;
    }
    words = words.slice(i + (wrap.positional ?? 0));
  }
  const name = posix.basename(words[0] as string);
  const args = words.slice(1);

  if (name === "git") return gitReads(args, reads);
  if (name === "ffmpeg") {
    args.forEach((a, i) => {
      if (a === "-i" && args[i + 1]) reads.push(args[i + 1] as string);
    });
    return { reads };
  }
  const spec = TABLE[name];
  if (spec === undefined) return { reads };

  const operands: Arg[] = [];
  let supplied = false;
  let recursive = false;
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as Arg;
    if (ended || a === null || !isOption(a)) {
      if (a !== null && spec.stop?.(a) === true) break;
      operands.push(a);
      continue;
    }
    if (a === "--") {
      ended = true;
      continue;
    }
    if (spec.stop?.(a) === true) break;
    const [flag, glued] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    if (spec.supplied?.includes(flag) === true) supplied = true;
    if (/^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive") recursive = true;
    // `sed -i ''` and `sed -i.bak`: BSD's in-place suffix is a separate argument.
    if (name === "sed" && a === "-i" && (args[i + 1] === "" || /^\.\w+$/.test(args[i + 1] ?? ""))) {
      i++;
      continue;
    }
    if (spec.valued?.includes(flag) === true && glued === undefined) {
      const value = args[i + 1];
      if (spec.fileOpts?.includes(flag) === true && value) reads.push(value);
      i++;
      continue;
    }
    if (spec.fileOpts?.includes(flag) === true && glued) reads.push(glued);
  }
  let files = operands.slice(supplied ? 0 : (spec.skip ?? 0));
  if (spec.lastIsDest === true) files = files.slice(0, -1);
  for (const f of files) if (f !== null && f !== "-" && f !== "") reads.push(f);
  if (files.length === 0 && (spec.dflt === "." || (spec.dflt === "recursive" && recursive))) reads.push(".");
  return { reads };
}

function gitReads(args: readonly Arg[], reads: string[]): { reads: string[]; base?: string } {
  let base: string | undefined;
  let i = 0;
  while (i < args.length && isOption(args[i] ?? "")) {
    const opt = args[i] as string;
    if (opt === "-C" && args[i + 1]) base = args[i + 1] as string;
    i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(opt) ? 2 : 1;
  }
  const sub = args[i];
  if (sub === null || sub === undefined || !GIT_READS.has(sub)) return base === undefined ? { reads } : { reads, base };
  const rest = args.slice(i + 1);
  const dash = rest.indexOf("--");
  const pathish = (a: Arg): a is string =>
    a !== null && !isOption(a) && !a.includes("..") && !a.includes(":") && (a.includes("/") || /\.\w+$/.test(a));
  const specs = dash === -1 ? rest.filter(pathish) : rest.slice(dash + 1).filter((a): a is string => a !== null && a !== "");
  reads.push(...specs);
  return base === undefined ? { reads } : { reads, base };
}

// ══ THE EVALUATOR — one walk over simple commands, shared by literal and grammar ═════

/** One piece of a word: literal text, a variable, a nested command, or something unknowable. */
export type Part =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tilde" }
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "subst"; readonly command: string }
  | { readonly kind: "unknown" };
export type Word = readonly Part[];

/** A shell program, reduced to what decides a read. */
export type Node =
  | { readonly kind: "cmd"; readonly words: readonly Word[]; readonly inputs: readonly Word[] }
  | { readonly kind: "subshell"; readonly body: readonly Node[] }
  | { readonly kind: "for"; readonly name: string; readonly values: readonly Word[]; readonly body: readonly Node[] };

interface Scope {
  cwd: string | null;
  old: string | null;
  readonly vars: Map<string, string>;
}

const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "{", "}", "!", "esac", "function"]);

/** Every read a program makes, absolute, deduplicated in order. */
export function evaluate(program: readonly Node[], cwd: string, home: string, reparse: (command: string) => readonly Node[] | null): string[] {
  const out: string[] = [];
  const add = (p: string): void => {
    if (!out.includes(p)) out.push(p);
  };
  const walk = (nodes: readonly Node[], scope: Scope): void => {
    for (const node of nodes) {
      if (node.kind === "subshell") {
        walk(node.body, { cwd: scope.cwd, old: scope.old, vars: new Map(scope.vars) });
        continue;
      }
      if (node.kind === "for") {
        const values = node.values.map((w) => expand(w, scope, home, nested));
        for (const v of values.length > 0 ? values : [null]) {
          if (v === null) scope.vars.delete(node.name);
          else scope.vars.set(node.name, v);
          walk(node.body, scope);
        }
        continue;
      }
      run(node, scope);
    }
  };
  // A `$(…)` inside a word is a command of its own, and its reads count.
  const nested = (command: string, scope: Scope): void => {
    const inner = reparse(command);
    if (inner !== null) walk(inner, { cwd: scope.cwd, old: scope.old, vars: new Map(scope.vars) });
  };
  const resolve = (p: string, base: string | null): string | null => (p.startsWith("/") ? posix.resolve(p) : base === null ? null : posix.resolve(base, p));
  const run = (node: Extract<Node, { kind: "cmd" }>, scope: Scope): void => {
    for (const input of node.inputs) {
      const p = expand(input, scope, home, nested);
      const at = p === null ? null : resolve(p, scope.cwd);
      if (at !== null) add(at);
    }
    let words = node.words;
    while (words.length > 0 && KEYWORDS.has(literal(words[0] as Word) ?? "")) words = words.slice(1);
    const first = words[0] === undefined ? null : literal(words[0]);
    if (first === "for" || first === "case" || first === "in") return;
    // Assignments: a line of only `X=…` sets them; before a command they are that command's env.
    const assigns: [string, Word][] = [];
    while (words.length > 0) {
      const w = words[0] as Word;
      const head = w[0];
      if (head?.kind !== "text") break;
      const m = /^([A-Za-z_]\w*)=/.exec(head.text);
      if (m === null) break;
      assigns.push([m[1] as string, [{ kind: "text", text: head.text.slice(m[0].length) }, ...w.slice(1)]]);
      words = words.slice(1);
    }
    const setAll = (pairs: readonly [string, Word][]): void => {
      for (const [name, value] of pairs) {
        const v = expand(value, scope, home, nested);
        if (v === null) scope.vars.delete(name);
        else scope.vars.set(name, v);
      }
    };
    if (words.length === 0) {
      setAll(assigns);
      return;
    }
    const argv = words.map((w) => expand(w, scope, home, nested));
    const name = argv[0];
    if (name === "export" || name === "local" || name === "declare" || name === "readonly") {
      setAll(
        words.slice(1).flatMap((w): [string, Word][] => {
          const head = w[0];
          const m = head?.kind === "text" ? /^([A-Za-z_]\w*)=/.exec(head.text) : null;
          return m === null || head?.kind !== "text" ? [] : [[m[1] as string, [{ kind: "text", text: head.text.slice(m[0].length) }, ...w.slice(1)]]];
        }),
      );
      return;
    }
    if (name === "cd" || name === "pushd") {
      const target = argv.slice(1).find((a) => a === null || !isOption(a));
      const next = target === undefined ? home : target === null ? null : target === "-" ? scope.old : resolve(target, scope.cwd);
      scope.old = scope.cwd;
      scope.cwd = next;
      return;
    }
    const { reads, base } = argvReads(argv);
    const from = base === undefined ? scope.cwd : resolve(base, scope.cwd);
    for (const r of reads) {
      const at = resolve(r, from);
      if (at !== null) add(at);
    }
  };
  walk(program, { cwd, old: null, vars: new Map() });
  return out;
}

/** A word that is plain text and nothing else, or null. */
function literal(word: Word): string | null {
  return word.length === 1 && word[0]?.kind === "text" ? word[0].text : word.length === 0 ? "" : null;
}

/** A word → the string the shell would pass, or null when it cannot be known without running. */
function expand(word: Word, scope: Scope, home: string, nested: (command: string, scope: Scope) => void): string | null {
  let out = "";
  let known = true;
  for (const part of word) {
    if (part.kind === "text") out += part.text;
    else if (part.kind === "tilde") out += home;
    else if (part.kind === "var") {
      const v = part.name === "HOME" ? home : part.name === "PWD" ? scope.cwd : scope.vars.get(part.name);
      if (v === undefined || v === null) known = false;
      else out += v;
    } else if (part.kind === "subst") {
      nested(part.command, scope);
      known = false;
    } else known = false;
  }
  return known ? out : null;
}

// ══ CANDIDATE 1 — literal: a hand-written lexer ══════════════════════════════

const OPERATOR_CHARS = new Set([";", "&", "|", "(", ")", "<", ">", "\n", " ", "\t"]);

/** Where a `$(` or `` ` `` closes, honouring quotes and nesting. -1 when it never does. */
function closing(s: string, from: number, open: string, close: string): number {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "'" && open !== "`") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (c === '"' && open !== "`") {
      const end = dquoteEnd(s, i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (open !== close && s.startsWith(open, i)) {
      depth++;
      i += open.length - 1;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function dquoteEnd(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "$" && s[i + 1] === "(") {
      const end = closing(s, i + 2, "(", ")");
      if (end === -1) return -1;
      i = end;
    } else if (s[i] === '"') return i;
  }
  return -1;
}

/** `$NAME`, `${NAME}`, `$(…)`, `$((…))` starting at `s[i] === "$"` → the part and where it ends. */
function dollar(s: string, i: number): { part: Part; end: number } {
  const next = s[i + 1];
  if (next === "(" && s[i + 2] === "(") {
    const end = s.indexOf("))", i + 3);
    return { part: { kind: "unknown" }, end: end === -1 ? s.length : end + 2 };
  }
  if (next === "(") {
    const end = closing(s, i + 2, "(", ")");
    return end === -1 ? { part: { kind: "unknown" }, end: s.length } : { part: { kind: "subst", command: s.slice(i + 2, end) }, end: end + 1 };
  }
  if (next === "{") {
    const end = s.indexOf("}", i + 2);
    const inner = end === -1 ? "" : s.slice(i + 2, end);
    return { part: /^[A-Za-z_]\w*$/.test(inner) ? { kind: "var", name: inner } : { kind: "unknown" }, end: end === -1 ? s.length : end + 1 };
  }
  const m = /^[A-Za-z_]\w*/.exec(s.slice(i + 1));
  if (m !== null) return { part: { kind: "var", name: m[0] }, end: i + 1 + m[0].length };
  if (next !== undefined && /[0-9@*#?$!-]/.test(next)) return { part: { kind: "unknown" }, end: i + 2 };
  return { part: { kind: "text", text: "$" }, end: i + 1 };
}

type Token = { readonly t: "word"; readonly word: Word } | { readonly t: "op"; readonly op: string } | { readonly t: "redir"; readonly op: string };

/** A command line → tokens, heredoc bodies consumed. Null when a quote never closes. */
export function lex(s: string): Token[] | null {
  const tokens: Token[] = [];
  const heredocs: { delim: string; tabs: boolean }[] = [];
  let i = 0;
  let parts: Part[] = [];
  let text = "";
  let inWord = false;
  const flushText = (): void => {
    if (text !== "") parts.push({ kind: "text", text });
    text = "";
  };
  const endWord = (): void => {
    flushText();
    if (inWord) tokens.push({ t: "word", word: parts });
    parts = [];
    inWord = false;
  };
  while (i < s.length) {
    const c = s[i] as string;
    if (c === "\\" && s[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (!inWord && c === "#") {
      const nl = s.indexOf("\n", i);
      i = nl === -1 ? s.length : nl;
      continue;
    }
    if (c === "\n") {
      endWord();
      tokens.push({ t: "op", op: "\n" });
      i++;
      // Heredoc bodies start on the line after their `<<`, in the order they were opened.
      for (const doc of heredocs.splice(0)) {
        for (;;) {
          if (i >= s.length) break;
          const nl = s.indexOf("\n", i);
          const line = s.slice(i, nl === -1 ? s.length : nl);
          i = nl === -1 ? s.length : nl + 1;
          if ((doc.tabs ? line.replace(/^\t+/, "") : line) === doc.delim) break;
        }
      }
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      i++;
      continue;
    }
    if ((c === "<" || c === ">") && s[i + 1] === "(") {
      endWord();
      const end = closing(s, i + 2, "(", ")");
      tokens.push({ t: "word", word: [end === -1 ? { kind: "unknown" } : { kind: "subst", command: s.slice(i + 2, end) }] });
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    // A redirect, with any fd glued in front of it (`2>`) dropped along with the digits.
    if (c === "<" || c === ">" || (c === "&" && s[i + 1] === ">")) {
      if (inWord && parts.length === 0 && /^\d+$/.test(text)) {
        text = "";
        inWord = false;
      }
      endWord();
      const op = (/^(&>>|&>|<<<|<<-|<<|<>|<&|<|>>|>\||>&|>)/.exec(s.slice(i)) as RegExpExecArray)[0];
      tokens.push({ t: "redir", op });
      i += op.length;
      if (op === "<<" || op === "<<-") {
        while (s[i] === " " || s[i] === "\t") i++;
        const m = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(s.slice(i));
        if (m !== null) {
          heredocs.push({ delim: m[2] as string, tabs: op === "<<-" });
          i += m[0].length;
          tokens.push({ t: "word", word: [{ kind: "text", text: m[2] as string }] });
        }
      }
      continue;
    }
    if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      endWord();
      const two = s.slice(i, i + 2);
      const op = ["&&", "||", "|&", ";;"].includes(two) ? two : c;
      tokens.push({ t: "op", op });
      i += op.length;
      continue;
    }
    inWord = true;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return null;
      text += s.slice(i + 1, end);
      i = end + 1;
    } else if (c === "$" && s[i + 1] === "'") {
      const end = s.indexOf("'", i + 2);
      if (end === -1) return null;
      text += s.slice(i + 2, end);
      i = end + 1;
    } else if (c === '"') {
      const end = dquoteEnd(s, i + 1);
      if (end === -1) return null;
      let j = i + 1;
      while (j < end) {
        const d = s[j] as string;
        if (d === "\\" && /["\\$`]/.test(s[j + 1] ?? "")) {
          text += s[j + 1] as string;
          j += 2;
        } else if (d === "$") {
          flushText();
          const got = dollar(s, j);
          parts.push(got.part);
          j = got.end;
        } else if (d === "`") {
          flushText();
          const close = s.indexOf("`", j + 1);
          parts.push(close === -1 || close > end ? { kind: "unknown" } : { kind: "subst", command: s.slice(j + 1, close) });
          j = close === -1 || close > end ? end : close + 1;
        } else {
          text += d;
          j++;
        }
      }
      i = end + 1;
    } else if (c === "\\") {
      text += s[i + 1] ?? "";
      i += 2;
    } else if (c === "$") {
      flushText();
      const got = dollar(s, i);
      parts.push(got.part);
      i = got.end;
    } else if (c === "`") {
      flushText();
      const close = s.indexOf("`", i + 1);
      parts.push(close === -1 ? { kind: "unknown" } : { kind: "subst", command: s.slice(i + 1, close) });
      i = close === -1 ? s.length : close + 1;
    } else if (c === "~" && text === "" && parts.length === 0) {
      parts.push({ kind: "tilde" });
      i++;
    } else {
      while (i < s.length && !OPERATOR_CHARS.has(s[i] as string) && !"'\"\\$`".includes(s[i] as string)) text += s[i++] as string;
    }
  }
  endWord();
  return tokens;
}

/** Tokens → a flat program: one node per simple command, `( … )` kept as a subshell. */
function literalProgram(command: string): Node[] | null {
  const tokens = lex(command);
  if (tokens === null) return null;
  const stack: Node[][] = [[]];
  let words: Word[] = [];
  let inputs: Word[] = [];
  let pending: string | null = null;
  const flush = (): void => {
    if (words.length > 0 || inputs.length > 0) (stack[stack.length - 1] as Node[]).push({ kind: "cmd", words, inputs });
    words = [];
    inputs = [];
  };
  for (const tok of tokens) {
    if (tok.t === "redir") {
      pending = tok.op;
      continue;
    }
    if (tok.t === "word") {
      if (pending !== null) {
        if (pending === "<" || pending === "<>") inputs.push(tok.word);
        pending = null;
      } else words.push(tok.word);
      continue;
    }
    pending = null;
    if (tok.op === "(" && words.length === 0) {
      flush();
      stack.push([]);
      continue;
    }
    if (tok.op === ")" && stack.length > 1) {
      flush();
      const body = stack.pop() as Node[];
      (stack[stack.length - 1] as Node[]).push({ kind: "subshell", body });
      continue;
    }
    flush();
  }
  flush();
  while (stack.length > 1) {
    const body = stack.pop() as Node[];
    (stack[stack.length - 1] as Node[]).push({ kind: "subshell", body });
  }
  return stack[0] as Node[];
}

export function literalExtractor(home: string) {
  return (command: string, cwd: string): Targets => {
    const program = literalProgram(command);
    return { reads: program === null ? [] : evaluate(program, cwd, home, literalProgram), writes: [] };
  };
}

// ══ CANDIDATE 2 — grammar: tree-sitter-bash ═════════════════════════════════

let registered = false;

/** One argument node → a word. */
function wordOf(node: SgNode): Word {
  const kind = node.kind();
  const text = node.text();
  switch (kind) {
    case "word":
    case "number":
      return text.startsWith("~") ? [{ kind: "tilde" }, { kind: "text", text: unescape(text.slice(1)) }] : [{ kind: "text", text: unescape(text) }];
    case "raw_string":
      return [{ kind: "text", text: text.slice(1, -1) }];
    case "ansi_c_string":
      return [{ kind: "text", text: text.slice(2, -1) }];
    case "string":
      return node.children().flatMap((c): Part[] => {
        const k = c.kind();
        if (k === '"') return [];
        if (k === "string_content") return [{ kind: "text", text: c.text().replace(/\\(["\\$`])/g, "$1") }];
        return [...wordOf(c)];
      });
    case "concatenation":
      return node.children().flatMap((c) => [...wordOf(c)]);
    case "simple_expansion": {
      const name = node.children().find((c) => c.kind() === "variable_name");
      return [name === undefined ? { kind: "unknown" } : { kind: "var", name: name.text() }];
    }
    case "expansion": {
      const inner = text.slice(2, -1);
      return [/^[A-Za-z_]\w*$/.test(inner) ? { kind: "var", name: inner } : { kind: "unknown" }];
    }
    case "command_substitution":
    case "process_substitution":
      return [{ kind: "subst", command: text.startsWith("`") ? text.slice(1, -1) : text.slice(2, -1) }];
    default:
      return [{ kind: "unknown" }];
  }
}

const unescape = (s: string): string => s.replace(/\\(.)/g, "$1");

function grammarNodes(node: SgNode): Node[] {
  const kind = node.kind();
  if (kind === "command") {
    const words: Word[] = [];
    for (const c of node.children()) {
      const k = c.kind();
      if (k === "command_name") words.push(wordOf(c.children()[0] as SgNode));
      else if (k === "variable_assignment") {
        const value = c.children().slice(2)[0];
        words.push([{ kind: "text", text: `${c.children()[0]?.text() ?? ""}=` }, ...(value === undefined ? [] : wordOf(value))]);
      } else if (k === "file_redirect" || k === "herestring_redirect") continue;
      else words.push(wordOf(c));
    }
    return [{ kind: "cmd", words, inputs: [] }];
  }
  if (kind === "variable_assignment") {
    const value = node.children().slice(2)[0];
    return [{ kind: "cmd", words: [[{ kind: "text", text: `${node.children()[0]?.text() ?? ""}=` }, ...(value === undefined ? [] : wordOf(value))]], inputs: [] }];
  }
  if (kind === "redirected_statement") {
    const inputs: Word[] = [];
    const out: Node[] = [];
    for (const c of node.children()) {
      const k = c.kind();
      if (k === "file_redirect") {
        const op = c.children()[0]?.text() ?? "";
        const target = c.children().slice(1).find((d) => d.kind() !== "file_descriptor");
        if ((op === "<" || op === "<>") && target !== undefined) inputs.push(wordOf(target));
      } else if (k !== "heredoc_redirect" && k !== "herestring_redirect") out.push(...grammarNodes(c));
    }
    return inputs.length === 0 ? out : [...out, { kind: "cmd", words: [], inputs }];
  }
  if (kind === "subshell") return [{ kind: "subshell", body: node.children().flatMap(grammarNodes) }];
  if (kind === "for_statement") {
    const name = node.children().find((c) => c.kind() === "variable_name")?.text() ?? "";
    const values: Word[] = [];
    let seenIn = false;
    let body: Node[] = [];
    for (const c of node.children()) {
      const k = c.kind();
      if (k === "in") seenIn = true;
      else if (k === "do_group") body = c.children().flatMap(grammarNodes);
      else if (seenIn && k !== ";" && k !== "\n") values.push(wordOf(c));
    }
    return [{ kind: "for", name, values, body }];
  }
  if (kind === "heredoc_body" || kind === "comment") return [];
  if (kind === "command_substitution") return [{ kind: "cmd", words: [[{ kind: "subst", command: node.text().slice(2, -1) }]], inputs: [] }];
  return node.children().flatMap(grammarNodes);
}

function grammarProgram(command: string): Node[] | null {
  if (!registered) {
    registerDynamicLanguage({ bash });
    registered = true;
  }
  try {
    return grammarNodes(parse("bash", command).root());
  } catch {
    return null;
  }
}

export function grammarExtractor(home: string) {
  return (command: string, cwd: string): Targets => {
    const program = grammarProgram(command);
    return { reads: program === null ? [] : evaluate(program, cwd, home, grammarProgram), writes: [] };
  };
}

// ══ CANDIDATE 3 — functions: shadow the read commands in the shell itself ═══

/**
 * What a `CLAUDE_ENV_FILE` would source: one function per read command that records the working
 * directory and its argv, then runs the real thing. The table is the same one; what differs is
 * that the SHELL did the parsing, the quoting, the variables and the loops.
 */
export function shadowScript(log: string, run: boolean): string {
  const names = [...Object.keys(TABLE), "git", "ffmpeg"];
  const body = (name: string): string =>
    `${name}() { print -rn -- "\${__flow_pwd:-$PWD}"$'\\x1f'${name}$'\\x1f'"\${(pj:\\x1f:)@}"$'\\x1e' >> ${log}; ${run ? `command ${name} "$@"` : "return 0"}; }`;
  return names.map(body).join("\n");
}

/**
 * Score the functions by RUNNING each command, safely: zsh with no PATH (every external program is
 * "not found" and answered by a handler that does nothing), `cd` made virtual, `kill` stubbed, and
 * every absolute path in the line moved under a throwaway root — so a redirect or a builtin that
 * writes lands in scratch, and nothing the command names is read or written for real. Globs stay
 * literal, as the labels write them.
 */
export function functionsExtractor(home: string) {
  return (command: string, cwd: string): Targets => {
    const fake = mkdtempSync(join(tmpdir(), "flow-shadow-"));
    try {
      const log = join(fake, ".reads");
      writeFileSync(log, "");
      const moved = (p: string): string => `${fake}${p}`;
      mkdirSync(moved(cwd), { recursive: true });
      mkdirSync(moved("/dev"), { recursive: true });
      const rewritten = command.replace(/(^|[\s'"=(<>|;&`{,])\/(?=[\w.~-])/g, `$1${fake}/`);
      const prelude = [
        "setopt NO_NOMATCH",
        "command_not_found_handler() { return 0; }",
        "kill() { return 1; }",
        `__flow_pwd=${JSON.stringify(moved(cwd))}; __flow_old=""`,
        'cd() { local t="${1:-$HOME}"; [[ "$t" == -* && "$t" != "-" ]] && t="${2:-$HOME}"; [[ "$t" == "-" ]] && t="$__flow_old"; __flow_old="$__flow_pwd"; if [[ "$t" == /* ]]; then __flow_pwd="$t"; else __flow_pwd="$__flow_pwd/$t"; fi; return 0; }',
        "pushd() { cd \"$@\"; }",
        shadowScript(JSON.stringify(log), false),
      ].join("\n");
      spawnSync("/bin/zsh", ["-f", "-c", `${prelude}\n${rewritten}`], {
        cwd: moved(cwd),
        env: { PATH: "", HOME: moved(home) },
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 5000,
      });
      const reads: string[] = [];
      for (const record of readFileSync(log, "utf8").split("\x1e")) {
        if (record === "") continue;
        const [pwd, ...argv] = record.split("\x1f").map((f) => f.split(fake).join(""));
        const { reads: raw, base } = argvReads(argv);
        const from = base === undefined ? (pwd as string) : posix.resolve(pwd as string, base);
        for (const r of raw) {
          const at = posix.resolve(from, r);
          if (!reads.includes(at)) reads.push(at);
        }
      }
      return { reads, writes: [] };
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  };
}
