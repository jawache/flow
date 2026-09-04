import { describe, it, expect } from "vitest";
import { defineCheck, verdict, hasCases, type Check, type Ctx, type Cases } from "./checks.ts";

const ok = { ok: true } as const;

/** A ctx with nothing but the verdict verbs — enough to drive a check that reads only facts. */
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
    moment: "commit",
    exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0 }),
    fs: { read: () => Promise.resolve(""), exists: () => Promise.resolve(false) },
    git: { diff: () => Promise.resolve(""), stagedFiles: () => Promise.resolve([]) },
    ok: verdict.ok,
    fail: verdict.fail,
  ...over,
});

describe("verdict", () => {
  it("says pass with nothing else", () => {
    expect(verdict.ok()).toEqual(ok);
  });

  it("says fail, carrying the detail that rides under the sentence's message", () => {
    expect(verdict.fail("package.json changed outside a release")).toEqual({
      ok: false,
      detail: "package.json changed outside a release",
    });
  });

  it("allows a fail with no detail — the message alone is the whole answer", () => {
    expect(verdict.fail()).toEqual({ ok: false });
  });
});

describe("defineCheck", () => {
  it("hands back the factory, so options close over into a plain check", async () => {
    const bansWord = defineCheck((opts: { word: string }): Check => {
      return (c) => (c.file?.content.includes(opts.word) ? c.fail(`found ${opts.word}`) : c.ok());
    });

    const noTodo = bansWord({ word: "TODO" });
    expect(await noTodo(ctx({ file: { path: "a.ts", content: "// TODO later" } }))).toEqual({
      ok: false,
      detail: "found TODO",
    });
    expect(await noTodo(ctx({ file: { path: "a.ts", content: "// done" } }))).toEqual(ok);
  });

  it("lets a check reach the world only through the injected capabilities", async () => {
    const suitePasses = defineCheck((opts: { run: string }): Check => {
      return async (c) => ((await c.exec(opts.run)).code === 0 ? c.ok() : c.fail(`${opts.run} failed`));
    });

    const red = ctx({ exec: () => Promise.resolve({ stdout: "", stderr: "boom", code: 1 }) });
    expect(await suitePasses({ run: "just test" })(red)).toEqual({ ok: false, detail: "just test failed" });
    expect(await suitePasses({ run: "just test" })(ctx())).toEqual(ok);
  });
});

describe("hasCases", () => {
  it("is true when either arm carries a case", () => {
    expect(hasCases({ block: ["git push origin main"] })).toBe(true);
    expect(hasCases({ pass: [{ path: "a.ts", content: "" }] })).toBe(true);
    expect(hasCases({ pass: [{ staged: ["package.json"] }] })).toBe(true);
  });

  it("is false for a cases block that proves nothing", () => {
    const empty: Cases = {};
    expect(hasCases(empty)).toBe(false);
    expect(hasCases({ pass: [], block: [] })).toBe(false);
    expect(hasCases(undefined)).toBe(false);
  });
});
