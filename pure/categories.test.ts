import { describe, it, expect } from "vitest";
import { defineCategory, isCategory, type SessionFacts } from "./categories.ts";

const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  head: "",
  subagent: false,
  ...over,
});

describe("defineCategory", () => {
  it("makes a value that carries its own recognizer", () => {
    const builder = defineCategory("builder", (s) => s.head.includes("/work build"));
    expect(builder.name).toBe("builder");
    expect(builder.classify(facts({ head: "Follow `/work build` in the work skill." }))).toBe(true);
    expect(builder.classify(facts({ head: "You are the parent." }))).toBe(false);
  });

  it("hands the classifier the host-written record, not a claim the session made", () => {
    const verifier = defineCategory("verifier", (s) => s.agentType === "verifier");
    expect(verifier.classify(facts({ subagent: true, agentType: "verifier" }))).toBe(true);
    // The same brief text, but the host says this spawn was something else.
    expect(
      verifier.classify(facts({ subagent: true, agentType: "builder", head: "verify the phase" })),
    ).toBe(false);
  });

  it("can classify the parent by absence — no sidecar, no agent type", () => {
    const parent = defineCategory("parent", (s) => !s.subagent);
    expect(parent.classify(facts())).toBe(true);
    expect(parent.classify(facts({ subagent: true, agentType: "builder" }))).toBe(false);
  });
});

describe("isCategory", () => {
  it("recognises a defined category", () => {
    expect(isCategory(defineCategory("demo", () => true))).toBe(true);
  });

  it("refuses anything that only looks like one — the undeclared-category refusal's basis", () => {
    expect(isCategory({ name: "builder", classify: () => true })).toBe(false);
    expect(isCategory("builder")).toBe(false);
    expect(isCategory(null)).toBe(false);
    expect(isCategory(undefined)).toBe(false);
    expect(isCategory(42)).toBe(false);
  });
});
