// flow/tools/parse.test.ts — the AST reader, driven by fixture.
//
// The failure this exists for is SILENT. What the parser answers is joined onto a loaded pack by
// key, so a shape it cannot follow does not throw and does not render an error: the loaded half
// still fills the page with ids, moments and messages, and only the doc comments and the check
// names quietly go missing. That is exactly what happened when a pack's factory grew a body — the
// git pack shipped a page with every "why" blank for four commits, looking complete.
//
// So each shape a pack is really written in is a fixture here, small enough to read whole, and the
// assertion is that the reader found the keys and the words in it.

import { describe, expect, it } from "vitest";
import { parseSource } from "./parse.ts";

/** The plainest pack there is: no parameters, one entry, one doc comment. */
const PLAIN = `
import { definePack, guardrail, commit, textBan } from "../index.ts";

/**
 * What the pack is for, in a sentence.
 *
 * @install \`just\`, from https://just.systems.
 * @adopt Bind it and expect the first commit to be loud.
 * @see nothing reads this tag
 */
export const plain = definePack("plain", {
  /** Without it the repo drifts. */
  oneRule: guardrail().at(commit).check(textBan({ ban: ["x"] })).message("no x").test({ block: ["x"] }),
});
`;

/** A pack carrying a file a reader is meant to copy in every slot the page renders one from. */
const FENCED = `
import { definePack, guardrail, commit, textBan } from "../index.ts";

/** A pack with a fact it cannot know. */
export interface Repo {
  /**
   * Where the repo keeps its tools.
   *
   * \`\`\`json
   * { "tools": "bin" }
   * \`\`\`
   */
  readonly tools?: string;
}

/**
 * A pack that ships nothing and shows the file instead.
 *
 * \`\`\`sh
 * npm i -D dotenvx
 *   # and nothing else
 * \`\`\`
 *
 * @setup A base at the repo root, and this is one worth starting from:
 *
 * \`\`\`json
 * {
 *   "compilerOptions": {
 *     "strict": true
 *   }
 * }
 * \`\`\`
 */
export const fenced = definePack("fenced", (repo: Repo) => {
  const tools = repo.tools ?? "tools";
  return {
    /**
     * Without it nobody knows where the code behind a recipe lives.
     *
     * \`\`\`just
     * check:
     *     ./bin/check
     * \`\`\`
     */
    home: guardrail().at(commit).check(textBan({ ban: [tools] })).message("no").test({ block: ["x"] }),
  };
});
`;

/** A pack whose factory DEFAULTS a parameter, which forces a body and a return statement. */
const DEFAULTED = `
import { definePack, guardrail, commit, textBan } from "../index.ts";

/** A pack with a fact it cannot know. */
export interface Repo {
  /** Where the repo keeps its tools. */
  readonly tools?: string;
  /** The recipe that runs the suite. */
  readonly run: string;
}

export const defaulted = definePack("defaulted", (repo: Repo) => {
  const tools = repo.tools ?? "tools";
  return {
    /** Without it nobody knows where the code behind a recipe lives. */
    home: guardrail().at(commit).check(textBan({ ban: [tools] })).message("no").test({ block: ["x"] }),
    nested: {
      /** Without it the group is empty. */
      inner: guardrail().at(commit).check(textBan({ ban: [repo.run] })).message("no").test({ block: ["x"] }),
    },
    // An entry that exists only when the repo asked for it.
    ...(repo.tools === undefined ? {} : {
      /** Without it an optional rule has no reason. */
      optional: guardrail().at(commit).check(textBan({ ban: ["y"] })).message("no").test({ block: ["y"] }),
    }),
  };
});
`;

describe("what a pack's source says that loading it cannot", () => {
  it("reads the lead, the named blocks and an entry's why off the plainest pack there is", () => {
    const parsed = parseSource("plain.ts", PLAIN);
    expect(parsed.lead).toContain("What the pack is for, in a sentence.");
    expect(parsed.blocks).toEqual([
      { tag: "install", body: "`just`, from https://just.systems." },
      { tag: "adopt", body: "Bind it and expect the first commit to be loud." },
    ]);
    expect(parsed.why.get("oneRule")).toBe("Without it the repo drifts.");
    expect(parsed.check.get("oneRule")).toBe('textBan({ ban: ["x"] })');
    expect(parsed.params).toEqual([]);
  });

  // INDENTATION IS THE POINT. TypeScript's own reader of a doc comment returns the words with the
  // leading whitespace of every line thrown away, which is right for prose and ruinous for the one
  // thing a `@setup` block now carries: a file to copy. Read off the source instead, the gutter
  // goes and nothing else does.
  it("keeps a fenced file exactly as it is written, indentation and all, in every slot the page renders", () => {
    const parsed = parseSource("fenced.ts", FENCED);
    expect(parsed.blocks).toEqual([
      {
        tag: "setup",
        body: 'A base at the repo root, and this is one worth starting from:\n\n```json\n{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n```',
      },
    ]);
    // The lead, a parameter's own doc and an entry's why reach the page down the same road, so a
    // reader that kept the indentation for one and dropped it for the others would render three
    // pastable files and one flat one — and `fenceFault` would be covering a slot nobody checked.
    expect(parsed.lead).toBe("A pack that ships nothing and shows the file instead.\n\n```sh\nnpm i -D dotenvx\n  # and nothing else\n```");
    expect(parsed.params).toEqual([{ name: "tools", type: "string", why: 'Where the repo keeps its tools.\n\n```json\n{ "tools": "bin" }\n```' }]);
    expect(parsed.why.get("home")).toBe("Without it nobody knows where the code behind a recipe lives.\n\n```just\ncheck:\n    ./bin/check\n```");
  });

  // THE BUG THAT EARNED THIS FILE. Defaulting a parameter is what turns `(repo) => ({…})` into
  // `(repo) => { … return {…}; }`, and a reader that only understood the first form found no
  // entries at all — silently, because the loaded half still filled the page.
  it("follows a factory into its body, and into both arms of a conditional spread", () => {
    const parsed = parseSource("defaulted.ts", DEFAULTED);
    expect([...parsed.why.keys()]).toEqual(["home", "nested.inner", "optional"]);
    expect(parsed.why.get("nested.inner")).toBe("Without it the group is empty.");
    expect(parsed.check.get("home")).toBe("textBan({ ban: [tools] })");
    expect(parsed.check.get("optional")).toBe('textBan({ ban: ["y"] })');
  });

  // The dotted keys are the LOADER's keys, so the two halves of a page join with no mapping table.
  // A group contributes `group.entry`, which is what `LoadedEntry.key` carries.
  it("names a nested entry the way the loader names it", () => {
    expect([...parseSource("defaulted.ts", DEFAULTED).why.keys()]).toContain("nested.inner");
  });

  it("finds the parameter interface by the name the factory asked for, with each member's why", () => {
    const parsed = parseSource("defaulted.ts", DEFAULTED);
    expect(parsed.params).toEqual([
      { name: "tools", type: "string", why: "Where the repo keeps its tools." },
      { name: "run", type: "string", why: "The recipe that runs the suite." },
    ]);
  });

  // A file with no `definePack` in it is not an error — the generator only ever hands it pack
  // files, and answering with empties beats throwing on a file somebody moved.
  it("answers with empties rather than throwing at a file that defines no pack", () => {
    const parsed = parseSource("nothing.ts", "export const x = 1;\n");
    expect(parsed.lead).toBe("");
    expect(parsed.blocks).toEqual([]);
    expect(parsed.params).toEqual([]);
    expect([...parsed.why.keys()]).toEqual([]);
    expect([...parsed.check.keys()]).toEqual([]);
  });
});
