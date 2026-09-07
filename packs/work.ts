// flow/packs/work.ts — the WORK LIFECYCLE's rungs: who is acting, and what each rung may do.
//
// A pack for repos that run the `work` lifecycle skill — spec · plan · start · build · review ·
// reflect · complete. It names the three rungs the lifecycle has (parent · builder · checker),
// binds one rule per rung to keep them from doing each other's jobs, and adds the two rules about
// the commands that write the journal: the inbox is the human's queue, and prose recorded through
// a shell is prose the shell can rewrite first.
//
// IT IMPORTS NOTHING FROM WORK. It is a plain consumer of flow's public door, exactly like every
// other pack here, and it knows the work CLI only as command strings on a rail. That is what lets
// flow ship it without depending on the tool it is about.
//
// flow ships no category names and never will: what a rung is called is a property of the way a
// team works, not of a guard engine. These three are the WORK lifecycle's, defined here beside the
// rules that bind to them — a builder may not do a parent's job, a checker may not write.
//
// EVERY ONE OF THEM READS HOST-WRITTEN EVIDENCE AND NOTHING ELSE. `spawnedAs` enforces the order
// the 335-transcript probe settled (flow F3): the sidecar's `agentType` decides and ends the read;
// the brief is consulted only for the buckets the harness treats as generic; the parent is the
// absence of both. A session's own claim about itself is never consulted, because a permission that
// rests on a claim rests on a lie.
//
// The trap the recipe makes unreachable, measured on the same probe: four verifier briefs matched
// every builder pattern, because a verifier is briefed with what the builder did. Keying on the
// brief first would have dressed four checkers as builders.
//
// The agent type names and brief needles below are TODAY'S work, and this pack moves into work's
// own package when work-core rewrites these rules as edit-time rails over the plan.

import {
  banCommands,
  command,
  defineCategory,
  definePack,
  guardrail,
  spawnedAs,
  substitutionInProse,
  SUBSTITUTION_MESSAGE,
  write,
} from "../index.ts";

/**
 * The harness's typeless spawn buckets — the ONLY ones whose brief may be read.
 *
 * `general-purpose` and `claude` are Claude Code's catch-alls: they carry no information about
 * what the spawn was for, and they hid 27 of 61 builders on the probe. Every other agent type
 * names its own rung, so reading its brief could only ever overrule the host.
 */
const GENERIC = ["general-purpose", "claude"] as const;

/** The top-level chat: no sidecar, no agent type. The supervisor's rung. */
export const parent = defineCategory("parent", spawnedAs({ parent: true }));

/**
 * A supervised builder — one phase of a plan, its own to write.
 *
 * The two brief needles are the two sentences a builder's own brief always carries, and they
 * recover every builder the generic buckets hid.
 */
export const builder = defineCategory(
  "builder",
  spawnedAs({
    types: ["builder"],
    generic: GENERIC,
    brief: ["Follow `/work build`", "Follow /work build", "You are the builder"],
  }),
);

/**
 * Anything spawned to JUDGE rather than to build — the verifier at a phase boundary, and the five
 * review lenses a closing review spawns.
 *
 * One category rather than six, because the rules that bind to it say the same thing to all of
 * them: a reader does not write. The verifier's own agent definition withholds Edit and Write
 * already; this is the half that holds for the lenses too, and it holds at the rail rather than in
 * a frontmatter list somebody can widen.
 */
export const checker = defineCategory(
  "checker",
  spawnedAs({
    types: ["verifier", "review", "codeops", "docops", "devops", "secops"],
    generic: GENERIC,
    brief: ["Follow `/work verify`", "Follow /work verify"],
  }),
);

export const work = definePack("work", {
  // ── THE LADDER, mechanised ──
  //
  // Three rules, one per rung, and each is a sentence the lifecycle skill's mode files already
  // state in prose: a builder owns its phase and not the plan, a checker reads and does not write,
  // a parent supervises and does not tick a box it did not build. They are RULES rather than mode
  // files because a rung is assigned by the harness that spawned you, and a rule that reads the
  // sidecar cannot be talked out of it — which is the whole reason `.for(…)` exists.
  //
  // They are also what makes the three categories real. A category nothing names is never
  // classified and never shown: `flow status` lists the ones some entry binds to, so an unbound
  // one would be config that reads as armed and costs nothing to be wrong about.
  planIsTheParents: guardrail()
    .at(command)
    .for(builder)
    .description("A builder owns its phase, not the plan — the verdict, the amendment and the cost record are the parent's.")
    .check(
      banCommands({
        ban: [
          "(?:^|[\\n;&|(]\\s*)\\s*work\\s+plan\\s+(?:verdict|amend)\\b",
          "(?:^|[\\n;&|(]\\s*)\\s*work\\s+(?:save|task)\\b",
          "(?:^|[\\n;&|(]\\s*)\\s*work\\s+cost\\s+record\\b",
        ],
      }),
    )
    .message(
      [
        "You are a builder, and this command is the parent's. Yours: `work plan status` · `work plan tick` · `work plan decision`.",
        "A verdict or an amendment needs the whole plan in view, and you can only see one phase. `work cost record` is worse than refused — it would succeed: every record is an INCREMENT since the last stamp, so filing one mid-phase bills the phase before yours for work it never did.",
        "What you have is an ask. Say it to the parent — what you hit, what your boxes do not cover, what you would do — and carry on with the boxes that are yours while you wait.",
      ].join("\n"),
    )
    .test({
      pass: ["work plan status --json", "work plan tick F7.B1 --evidence diff:abc123", "work cost"],
      block: ["work plan verdict F7 --pass --cite x", "work save", "work cost record F7"],
    }),

  checkersDoNotWrite: guardrail()
    .at(write)
    .for(checker)
    .description("A verifier and the review lenses sit at a boundary they must not write to.")
    .check((ctx) => ctx.fail(`${ctx.file?.path ?? "a file"} — a checker reads`))
    .message(
      "You were spawned to JUDGE this work, and a judge that edits the thing it is judging has destroyed the evidence. Report what you found — PASS or FAIL with citations — and let the rung that owns the code change it. (The verifier's own tool list already withholds Edit and Write; this is the half that holds for every review lens too, and it holds at the rail rather than in a frontmatter list somebody can widen.)",
    )
    .test({ block: [{ path: "src/thing.ts", content: "x" }] }),

  ticksAreTheChilds: guardrail()
    .at(command)
    .for(parent)
    .description("The parent records verdicts; a box is ticked by the child that built it, with its evidence.")
    .check(banCommands({ ban: ["(?:^|[\\n;&|(]\\s*)\\s*work\\s+plan\\s+tick\\b"] }))
    .message(
      "A box is ticked by the rung that built it. You are supervising: you did not do the work, so you cannot supply the evidence, and a tick whose proof came from reading a report is exactly the provenance the journal exists to prevent. If a child left a box unticked, that is the finding — record the verdict on it.",
    )
    .test({ pass: ["work plan verdict F7 --pass --cite x"], block: ["work plan tick F7.B1 --evidence diff:abc"] }),

  // ── the two rules about the commands that write the journal ──

  noAgentInboxItems: guardrail()
    .at(command)
    .description("The inbox is the human's speccing queue — an agent raises a finding in chat, never files one.")
    // Anchored to a COMMAND POSITION — the start of the line, or just past a shell operator — so
    // prose that merely mentions the verb is not an invocation. Measured the moment this rule was
    // written: the unanchored pattern blocked the very command that was authoring its own test
    // file, because the phrase appeared inside a heredoc.
    .check(banCommands({ ban: ["(?:^|[\\n;&|(]\\s*)\\s*work\\s+inbox\\s+new\\b"] }))
    .message(
      [
        "`work inbox new` is the human's own door, and this command rail is only ever crossed by an agent — a person typing in a terminal has no hooks in front of them. So the fact that this fired means an agent is filing.",
        "The inbox is a SPECCING QUEUE, not a findings drawer: every item in it is something its owner has decided to think about, and an item nobody chose to add is a decision taken away from them and returned as a chore. Work is born through `/work spec`, which only a clear human instruction opens.",
        "What you have is a finding. Say it in the chat — headline, why it matters, what you would do — and let the human decide whether it becomes an item, a spec, or nothing.",
      ].join("\n"),
    )
    .test({
      pass: ["work inbox list", 'echo "the human runs work inbox new themselves" >> note.md'],
      block: ['work inbox new --summary "a thing"', "echo hi && work inbox new --summary x"],
    }),

  // The lifecycle's half of the prose-substitution rule; `git`'s half covers `git commit` and the
  // two `gh` verbs, and both are built from the one tail in core, beside `banCommands`. The verbs
  // named here write
  // to an APPEND-ONLY journal, which is the half of the rule with no undo of any kind.
  noShellSubstitutionInProse: guardrail()
    .at(command)
    .description("A backtick inside a double-quoted argument of a work verb that records prose is live command substitution, not Markdown.")
    .check(banCommands({ ban: [substitutionInProse(["work\\s+(?:plan|task|recap|record|spec|complete)\\b"])] }))
    .message(SUBSTITUTION_MESSAGE)
    .test({
      pass: ["work plan decision 'chose the `chain` builder' --chose x --reverse y", "work plan status --json"],
      block: ['work plan decision "chose the `chain` builder" --chose x --reverse y'],
    }),
});
