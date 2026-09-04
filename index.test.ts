// flow/index.test.ts — what `@jawache/flow` means, held still.
//
// A re-export file has one way of going wrong and it is silent: a symbol that quietly stops being
// public. A pack in somebody else's repo finds out at their next install, which is the worst place
// to find out. So the surface is asserted as a LIST — adding to it is a line here, and removing
// from it is a deliberate deletion rather than a dropped export.

import { describe, it, expect } from "vitest";
import * as flow from "./index.ts";
import { FlowConfigError, entriesOrThrow } from "./errors.ts";

describe("the public surface", () => {
  it("is exactly what a config file and a pack may import", () => {
    expect(Object.keys(flow).sort()).toEqual([
      "FlowConfigError",
      "REFUSAL_CODES",
      "breadcrumb",
      "command",
      "commit",
      "defineCategory",
      "defineCheck",
      "defineConfig",
      "definePack",
      "deletion",
      "entriesOrThrow",
      "guardrail",
      "loadConfig",
      "override",
      "pack",
      "session",
      "touch",
      "turnEnd",
      "write",
    ]);
  });

  it("binds a whole guard through it, with nothing reaching past into flow/pure", () => {
    const house = flow.definePack("house", {
      noTodo: flow
        .guardrail()
        .at(flow.commit)
        .check((ctx) => ctx.ok())
        .message("No TODOs.")
        .test({ block: [{ path: "a.ts", content: "TODO" }] }),
    });
    const config = flow.defineConfig([flow.pack(house), flow.override(house.noTodo).on("src/**")]);
    const result = flow.loadConfig(config);
    expect(result.ok && result.entries.map((e) => e.id)).toEqual(["house.noTodo"]);
  });
});

const refusals = [
  { code: "no-cases", entry: "house.noTodo", detail: "`house.noTodo` carries no cases." },
  { code: "unknown-entry", entry: "tdd.x", detail: "`override(tdd.x)` names an entry no bound pack has." },
] as const;

describe("FlowConfigError", () => {
  it("carries every refusal, so a caller can act on all of them", () => {
    const error = new FlowConfigError(refusals);
    expect(error.refusals).toEqual(refusals);
    expect(error.name).toBe("FlowConfigError");
  });

  it("reads as one message naming each entry — the text a blocked hook prints", () => {
    const error = new FlowConfigError(refusals);
    expect(error.message).toContain("2 refusals");
    expect(error.message).toContain("house.noTodo");
    expect(error.message).toContain("tdd.x");
  });

  it("counts one refusal in the singular, because the sentence is read by a person", () => {
    expect(new FlowConfigError([refusals[0]]).message).toContain("1 refusal.");
  });
});

describe("entriesOrThrow", () => {
  it("hands back the entries when the load was clean", () => {
    expect(entriesOrThrow({ ok: true, entries: [] })).toEqual([]);
  });

  it("throws the named error, refusals aboard, when it was not", () => {
    expect(() => entriesOrThrow({ ok: false, refusals })).toThrow(FlowConfigError);
    try {
      entriesOrThrow({ ok: false, refusals });
    } catch (error) {
      expect(error instanceof FlowConfigError && error.refusals).toEqual(refusals);
    }
  });
});
