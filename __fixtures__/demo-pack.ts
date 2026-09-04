// A pack, written the way a repo writes its own: one file, `definePack`, sentences.
//
// It is the same shape a published pack has — promotion is publishing, and the only line that
// would change is the import path in the config. Both forms are here because the valid config
// binds both: `house` takes no parameters, `tdd` closes over one.

import {
  definePack,
  guardrail,
  breadcrumb,
  defineCheck,
  defineCategory,
  write,
  commit,
  command,
  session,
  touch,
  type Check,
} from "../index.ts";

/** A configured check: options in, a check out. Nothing but ctx reaches the world. */
export const banCommands = defineCheck((opts: { patterns: readonly string[] }): Check => {
  return (ctx) => {
    const line = ctx.command ?? "";
    const hit = opts.patterns.find((p) => new RegExp(p).test(line));
    return hit === undefined ? ctx.ok() : ctx.fail(`matches \`${hit}\``);
  };
});

/** An inline check, for a one-liner. */
const noTodo: Check = (ctx) =>
  ctx.file?.content.includes("TODO") === true ? ctx.fail(`${ctx.file.path} still says TODO`) : ctx.ok();

/** A category — the recognizer travels with the name. */
export const builder = defineCategory("builder", (s) => s.head.includes("/work build"));

export const house = definePack("house", {
  orientation: breadcrumb().at(session).text("You are in the demo repo."),

  ssr: breadcrumb()
    .at(touch)
    .on("src/pages/**")
    .ignore("src/pages/admin/**")
    .file("guards/notes/ssr.md")
    .description("Why marketing pages must render identically for everyone."),

  noTodo: guardrail()
    .at(write, commit)
    .on("src/**/*.ts")
    .ignore("**/*.test.ts")
    .check(noTodo)
    .message("No TODOs — open a journal entry or do it now.")
    .test({ pass: [{ path: "src/a.ts", content: "ok" }], block: [{ path: "src/a.ts", content: "// TODO" }] }),

  noPushToMain: guardrail()
    .at(command)
    .check(banCommands({ patterns: ["git push[^\\n]*\\bmain\\b"] }))
    .message("Pushing to main is Asim-controlled — push your branch instead.")
    .test({ pass: ["git push origin feature/x"], block: ["git push origin main"] }),

  plan: {
    shapeIsParents: guardrail()
      .at(write)
      .on(".work/**/plan.yaml")
      .for(builder)
      .check(noTodo)
      .message("A builder completes its own phase's steps — the plan's shape is the parent's.")
      .test({ pass: [{ path: "x.ts", content: "" }], block: [{ path: ".work/a/plan.yaml", content: "TODO" }] }),
  },
});

export const tdd = definePack("tdd", (params: { run: string }) => ({
  commitRunsTests: guardrail()
    .at(commit)
    .check((ctx) => ctx.ok())
    .message(`Tests failed (${params.run}) — the commit is refused.`)
    .test({ pass: [{ staged: ["src/a.ts"] }], block: [] }),
}));
