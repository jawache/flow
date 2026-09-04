import { describe, it, expect } from "vitest";
import {
  chain,
  guardrail,
  breadcrumb,
  isSentence,
  GUARDRAIL_KEYS,
  BREADCRUMB_KEYS,
  type GuardrailSpec,
  type BreadcrumbSpec,
} from "./entries.ts";
import { write, commit, command, session, touch, turnEnd } from "./moments.ts";
import { defineCategory } from "./categories.ts";
import { verdict, type Check } from "./checks.ts";

const passes: Check = () => verdict.ok();
const cases = { pass: ["git push origin feature/x"], block: ["git push origin main"] };

describe("guardrail()", () => {
  it("says every key it was given, and nothing it was not", () => {
    const spec = guardrail()
      .at(write, commit)
      .on("src/**/*.ts")
      .ignore("**/*.test.ts")
      .check(passes)
      .message("No TODOs — open a journal entry or do it now.")
      .test(cases).spec;

    expect(spec).toEqual({
      kind: "guardrail",
      at: ["write", "commit"],
      on: ["src/**/*.ts"],
      ignore: ["**/*.test.ts"],
      check: passes,
      message: "No TODOs — open a journal entry or do it now.",
      test: cases,
    } satisfies GuardrailSpec);
  });

  it("leaves an unspoken key ABSENT — an absent `on` is absent, never `**/*`", () => {
    const spec = guardrail().at(commit).check(passes).message("m").test(cases).spec;
    expect("on" in spec).toBe(false);
    expect("ignore" in spec).toBe(false);
    expect("for" in spec).toBe(false);
    expect("description" in spec).toBe(false);
  });

  it("does not care what order the chain was spoken in", () => {
    const a = guardrail().at(commit).check(passes).message("m").test(cases).spec;
    const b = guardrail().test(cases).message("m").check(passes).at(commit).spec;
    expect(a).toEqual(b);
  });

  it("never mutates the sentence it was chained from", () => {
    const base = guardrail().at(commit);
    const withMessage = base.message("m");
    expect("message" in base.spec).toBe(false);
    expect(withMessage.spec.message).toBe("m");
  });

  it("carries the categories it binds to, in the order spoken", () => {
    const builder = defineCategory("builder", () => true);
    const verifier = defineCategory("verifier", () => false);
    const spec = guardrail()
      .at(write)
      .for(builder, verifier)
      .check(passes)
      .message("m")
      .test(cases).spec;
    expect(spec.for?.map((c) => c.name)).toEqual(["builder", "verifier"]);
  });

  it("records a disabled entry AND its reason — the sentence flow status prints", () => {
    const spec = guardrail().at(commit).disabled("fcis.pureHasTest covers the proved set").spec;
    expect(spec.disabled).toEqual({ reason: "fcis.pureHasTest covers the proved set" });
  });

  it("allows the reason to be left out, and still records that it is off", () => {
    expect(guardrail().at(commit).disabled().spec.disabled).toEqual({});
  });

  it("takes every guardrail moment, including the one whose export is not its word", () => {
    expect(guardrail().at(command, turnEnd).spec.at).toEqual(["command", "turn-end"]);
  });
});

describe("breadcrumb()", () => {
  it("is a note — text, where it shows, and nothing that could block", () => {
    const spec = breadcrumb()
      .at(session)
      .text("You are in the work platform.")
      .description("The project map.").spec;

    expect(spec).toEqual({
      kind: "breadcrumb",
      at: ["session"],
      text: "You are in the work platform.",
      description: "The project map.",
    } satisfies BreadcrumbSpec);
  });

  it("can point at a file instead, for prose too long to sit in the sentence", () => {
    const spec = breadcrumb().at(touch).on("src/pages/**").file("guards/notes/ssr.md").spec;
    expect(spec.file).toBe("guards/notes/ssr.md");
    expect("text" in spec).toBe(false);
  });
});

describe("the closed key sets", () => {
  it("are the spec's grammar and no more", () => {
    expect(GUARDRAIL_KEYS).toEqual([
      "at",
      "for",
      "on",
      "ignore",
      "check",
      "message",
      "disabled",
      "test",
      "description",
    ]);
    expect(BREADCRUMB_KEYS).toEqual(["at", "for", "on", "ignore", "text", "file", "disabled", "description"]);
  });

  it("differ only where the two entry types genuinely do", () => {
    const g = new Set<string>(GUARDRAIL_KEYS);
    const b = new Set<string>(BREADCRUMB_KEYS);
    expect(GUARDRAIL_KEYS.filter((k) => !b.has(k))).toEqual(["check", "message", "test"]);
    expect(BREADCRUMB_KEYS.filter((k) => !g.has(k))).toEqual(["text", "file"]);
  });
});

describe("chain — the one builder behind all three chains", () => {
  it("accumulates spoken keys and hands them to whatever the caller exposes them as", () => {
    const built = chain({ kind: "guardrail" }, (spoken) => ({ seen: spoken })) as unknown as {
      at: (...m: string[]) => { on: (...g: string[]) => { seen: Record<string, unknown> } };
    };
    expect(built.at("commit").on("src/**").seen).toEqual({
      kind: "guardrail",
      at: ["commit"],
      on: ["src/**"],
    });
  });

  it("is what both a sentence and an override are made of — same verbs, same replacement", () => {
    // The sentence exposes its keys as `.spec`; the override wraps them in a binding. Nothing
    // else differs, which is why there is one builder and not two.
    expect(guardrail().at(commit).on("a/**").spec).toEqual({
      kind: "guardrail",
      at: ["commit"],
      on: ["a/**"],
    });
  });
});

describe("isSentence", () => {
  it("recognises both entry types", () => {
    expect(isSentence(guardrail().at(commit))).toBe(true);
    expect(isSentence(breadcrumb().at(session))).toBe(true);
  });

  it("refuses a group, a bare spec and anything else", () => {
    expect(isSentence({ noTodo: guardrail().at(commit) })).toBe(false);
    expect(isSentence({ spec: { kind: "guardrail" } })).toBe(true);
    expect(isSentence({ spec: { kind: "wat" } })).toBe(false);
    expect(isSentence({ spec: "guardrail" })).toBe(false);
    expect(isSentence(null)).toBe(false);
    expect(isSentence("guardrail")).toBe(false);
  });
});
