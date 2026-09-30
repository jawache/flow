# The Bash corpus

`corpus.json` is 150 real Bash commands that Claude Code ran on one machine, each labelled by hand
with the files it reads and the files it writes. It is the yardstick for any function that claims
to answer "what does this command touch": `just score-bash` runs one against every entry and prints
recall and precision per mechanism.

## An entry

| field | what it holds |
|---|---|
| `id` | `c001` … `c150`, in sampling order |
| `mechanism` | the stratum the command was sampled for (below) |
| `traps` | the parsing traps the command carries (below) |
| `cwd` | the directory the call ran in, from the transcript record |
| `command` | the command exactly as the model sent it |
| `reads` | every path the command reads or searches |
| `writes` | every path the command creates, changes, moves or deletes |
| `opaque` | `reads`, `writes` or both: the list is what can be known, and the command also touches paths nothing on the line names |
| `note` | why a label is what it is, where that is not obvious |
| `background` | present and `true` when the call ran with `run_in_background` |
| `source` | the session id and timestamp of the call |

A path is relative to `cwd` when it lies under it, and absolute otherwise. A scorer resolves both
the labels and an extractor's answer against `cwd` before comparing them, so either spelling of the
same path matches.

## How the labels were decided

- **A read** is a file whose content the command reads by name (`cat`, `head`, `tail`, `sed`,
  `grep`, `rg`, `wc`, `awk`, `jq`, `diff`, `md5`, `shasum`, `ffmpeg -i`, `cp`'s source, `< file`)
  or a directory it lists or searches (`ls`, `find`, `grep -r`, `rg`, `du`). `rg` or `ls` with no
  path reads the working directory, written `.`.
- A path handed to `git diff`, `git log`, `git status` or `git add` as a pathspec is a read: the
  agent is looking at that path.
- Inside an interpreter heredoc or `-c` script, `open(p)`, `read_text`, `readFileSync` and a path
  literal handed to a function that loads it are reads, and `open(p, 'w')`, `write_text` and
  `writeFileSync` are writes, with `p` chased back to its literal assignment. Module imports are
  not reads.
- **A write** is a redirect target (`>`, `>>`, `&>`), a heredoc's target file, every file `sed -i`
  or `perl -pi` edits, `cp`'s destination, both sides of `mv` and `git mv`, `rm`, `touch`, `ln`'s
  link, `chmod`'s file, and an output file named on the line (`ffmpeg`'s last argument, a
  screenshot path passed to a script whose body is shown). When `cp` or `mv` lands in a directory,
  the write is the file inside it.
- **Not labelled:** `/dev/null` and the other `/dev` streams; files inside `.git`; a directory
  `mkdir` creates (git cannot see an empty directory); metadata-only looks (`readlink`, `stat`,
  `test -f`, `[ -f … ]`, `git check-ignore`); a script an interpreter runs (`python3 x.py`,
  `bash x.sh`, `node x.mjs`), which is marked opaque instead unless its whole body is on the line.
- **Opaque.** A recipe (`just`, `work`), a package runner (`npx`, `npm`), an unseen script,
  `git add -A`, `git status` and `git ls-files` with no pathspec, and a loop over computed paths
  touch files the line does not name. The entry lists what can be known and marks that half
  opaque. A scorer counts every labelled path towards recall on an opaque half, and does not count
  an unlabelled prediction against precision there, because the truth is unknown.
- `$VAR` is resolved when the command assigns it, and `~` and `$HOME` are the home directory. A
  path a subshell computes is not labelled, and that half is marked opaque. A glob stays a glob,
  resolved against its directory: `media/adv-js/out/*.mp4`.
- A `cd` in the line moves every later relative path. `cd -` moves it back.
- A path in a quoted argument that the command does not open (a commit message, a `work plan tick`
  citation, an `echo`) is not a read.

## How the sample was drawn

1. **Every Bash call.** Every `tool_use` named `Bash` in the 769 transcripts under
   `~/Backups/claude-transcripts/projects/` (backup of 2026-09-28, calls from 2026-08-13 to
   2026-09-28, subagent transcripts included), with the record's `cwd`, deduplicated on the pair
   `(command, cwd)`: 47,685 calls.
2. **Eligible.** Calls up to 1,500 characters long: 44,134. The long tail is almost all multi-screen
   heredoc scripts, which a hand label cannot check.
3. **Strata.** Each call is tagged with every mechanism it uses, judged on the command with its
   quoted runs and heredoc bodies masked out and split on real shell operators, wrappers (`timeout`,
   `nohup`, `env`, `sudo`) and `VAR=` assignments stripped:

   | stratum | a segment that… | eligible calls |
   |---|---|---:|
   | `cat` | runs `cat` on a file, no heredoc, no output redirect | 2,978 |
   | `head`, `tail` | runs `head` or `tail` with a file operand | 606, 1,489 |
   | `sed -n` | runs `sed -n` with a script and a file | 6,715 |
   | `grep` | runs `grep` with a file operand or `-r` | 12,750 |
   | `rg`, `find`, `ls` | runs the command at all | 473, 1,474, 5,237 |
   | `redirect` | sends output to a path with `>` or `>>`, not `/dev/null` | 1,170 |
   | `heredoc` | runs `cat > file <<EOF` | 421 |
   | `sed -i` | runs `sed -i` | 239 |
   | `python heredoc` | runs `python` or `python3` with a heredoc | 3,271 |
   | `cp/mv` | runs `cp` or `mv` | 385 |
   | `just`, `work` | runs a recipe or a `work` subcommand | 5,011, 3,276 |

4. **Traps.** Each call is also tagged with the traps it carries: `quoted-operator` (a `>`, `|`,
   `&&` or `;` inside a quoted run), `heredoc-body`, `cd` (a `cd` followed by more commands),
   `$VAR` (any `$`), and `2>&1` (any file-descriptor redirect: `2>&1`, `&>`, `>&2`).
5. **Draw.** Python's `random.Random(20260930)`, one shuffle per stratum in the order of the table,
   ten calls each, a call never drawn twice. A top-up would have drawn more for any trap present
   fewer than eight times; none was needed. The 150 carry `quoted-operator` 50 times, `heredoc-body`
   31, `cd` 58, `$VAR` 28 and `2>&1` 52.
6. **Secrets.** 283 eligible calls match a secret shape (live keys, tokens, `Bearer`, a URL with a
   password, a `PASSWORD=` or `SECRET=` assignment, a JWT) or carry an email address. They were
   excluded before the draw, and the 150 drawn were read again for anything the patterns missed.
   Nothing needed redacting.
7. **Labels.** Every entry was read and labelled by hand, by the rules above. Paths are as they
   were on the day: the worktrees and scratchpads they name may no longer exist.
