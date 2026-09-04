import { describe, it, expect } from "vitest";
import {
  GUARDRAIL_MOMENTS,
  BREADCRUMB_MOMENTS,
  phasesOf,
  isGuardrailMoment,
  isBreadcrumbMoment,
  write,
  command,
  commit,
  deletion,
  turnEnd,
  session,
  touch,
} from "./moments.ts";

describe("the moment vocabulary", () => {
  it("is the five guardrail words the engine has rails for", () => {
    expect(GUARDRAIL_MOMENTS).toEqual(["write", "command", "commit", "delete", "turn-end"]);
  });

  it("is the three breadcrumb words, which are not the same list", () => {
    expect(BREADCRUMB_MOMENTS).toEqual(["session", "touch", "turn-end"]);
  });

  it("exports each word as a value, so a config imports it rather than spelling it", () => {
    expect([write, command, commit, deletion, turnEnd]).toEqual([
      "write",
      "command",
      "commit",
      "delete",
      "turn-end",
    ]);
    expect([session, touch]).toEqual(["session", "touch"]);
  });

  it("names the delete moment `deletion` in the export, because `delete` cannot be a binding", () => {
    expect(deletion).toBe("delete");
    expect(GUARDRAIL_MOMENTS).toContain(deletion);
  });
});

describe("phasesOf — the table, lifted", () => {
  it("maps each moment to the engine phases it fires at", () => {
    expect(phasesOf([write])).toEqual(["edit"]);
    expect(phasesOf([command])).toEqual(["edit", "commit"]);
    expect(phasesOf([commit])).toEqual(["commit"]);
    expect(phasesOf([deletion])).toEqual(["delete"]);
    expect(phasesOf([turnEnd])).toEqual(["turn"]);
  });

  it("dedupes across moments, in declaration order", () => {
    expect(phasesOf([command, commit])).toEqual(["edit", "commit"]);
    expect(phasesOf([commit, command])).toEqual(["commit", "edit"]);
  });

  it("answers nothing for no moments", () => {
    expect(phasesOf([])).toEqual([]);
  });
});

describe("the moment guards", () => {
  it("recognise their own vocabulary and refuse the other's", () => {
    expect(isGuardrailMoment("write")).toBe(true);
    expect(isGuardrailMoment("session")).toBe(false);
    expect(isBreadcrumbMoment("session")).toBe(true);
    expect(isBreadcrumbMoment("write")).toBe(false);
  });

  it("share exactly one word — turn-end", () => {
    expect(isGuardrailMoment("turn-end")).toBe(true);
    expect(isBreadcrumbMoment("turn-end")).toBe(true);
  });

  it("refuse a word that is in neither", () => {
    expect(isGuardrailMoment("push")).toBe(false);
    expect(isBreadcrumbMoment("push")).toBe(false);
  });
});
