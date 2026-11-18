// flow/guards/guards.test.ts — what the packs this repo keeps in guards/ say, held still.
//
// These packs are this repo's own rules, and no longer ship. Every entry carries its own
// `.test({ pass, block })` cases and `flow test` drives them; what a case cannot see is the
// sentence a blocked person reads, and that is what is asserted here.

import { describe, it, expect } from "vitest";
import { git } from "./git.ts";
import { secrets } from "./secrets.ts";
import { typescript } from "./typescript.ts";
import { defineConfig, loadConfig, pack, type Check, type Ctx } from "@jawache/flow";

const packs = { git, secrets, typescript };

/** The entries a config loaded, or an empty list and the refusals in the failure message. */
function loaded(result: ReturnType<typeof loadConfig>): { id: string; spec: unknown }[] {
  expect(result.ok ? [] : result.refusals.map((refusal) => refusal.detail)).toEqual([]);
  return result.ok ? [...result.entries] : [];
}

/**
 * What an entry SAYS — a guardrail's refusal, a breadcrumb's prose — by id.
 *
 * The one thing a `.test({ pass, block })` case cannot see. A case drives the check and reads the
 * verdict; the sentence the blocked person actually reads is beside it, and every parameter and
 * every computed default that only ever reaches prose is invisible until something asserts on it.
 */
function sentence(entries: readonly { id: string; spec: unknown }[]): (id: string) => string {
  return (id) => {
    const found = entries.find((entry) => entry.id === id);
    expect(found, `no entry ${id}`).toBeDefined();
    const spec = (found as { spec: { message?: string; text?: string } }).spec;
    return spec.message ?? spec.text ?? "";
  };
}

describe("the guards this repo keeps", () => {
  // THE PARAMETERS, proved where they are meant to land: in the sentence a blocked person reads.
  //
  // Four packs take a repo fact, and three of them (fcis, justfile, tdd) hand it to a check, where
  // the entry's own `block` case already drives it. `git` and `typescript` hand theirs to a MESSAGE
  // as well — the whole reason they became parameters is that a hard-coded `just release` names the
  // wrong command in every repo that spells it differently, and names it at the worst moment. A
  // case cannot see a message, so this is the one place that can say so.
  it("puts the repo's own recipe names into the sentences that name a command", () => {
    const result = loadConfig(
      defineConfig([
        pack(packs.git, { release: "cargo release" }),
        pack(packs.typescript, { typecheck: "make types", lint: "make lint" }),
      ]),
    );
    const entries = loaded(result);
    const said = sentence(entries);
    expect(said("git.orientation")).toContain("cargo release");
    expect(said("git.node.noHandEditedVersion")).toContain("cargo release");
    expect(said("typescript.commitRunsTsc")).toContain("make types");
    expect(said("typescript.commitRunsEslint")).toContain("make lint");
    // And nothing carries the fleet's own spelling any more — the point of the extraction.
    for (const entry of entries) {
      const spec = entry.spec as { message?: string; text?: string };
      expect(`${spec.message ?? ""}\n${spec.text ?? ""}`, entry.id).not.toContain("just ");
    }
  });

  // THE DEFAULTS, proved in the same place and for the same reason. Two packs now have an arm that
  // exists only when a repo names nothing, and both arms live entirely in prose: `secrets` bound
  // bare falls back to dotenvx's own spelling, and `typescript` with no shared base keeps only the
  // strictness opinion. Nothing else in the suite can reach either sentence — the machine test
  // drives both bindings but asserts on ids and counts, and a case cannot see a message. A default
  // that silently became `undefined <file>` is exactly what this catches, because that is what one
  // of them did before the parameter behind it was deleted.
  it("names dotenvx itself when nothing wraps it, and the strict options when no base is named", () => {
    const entries = loaded(
      loadConfig(defineConfig([pack(packs.secrets), pack(packs.typescript, { typecheck: "make types", lint: "make lint" })])),
    );
    const said = sentence(entries);

    expect(said("secrets.orientation")).toContain("One seam: `dotenvx run -f .env.<env> -- <cmd>`");
    // Built from the pack's own `publicPrefixes`, so the command a refusal hands over is the one
    // that leaves exactly those plaintext — a bare `dotenvx encrypt` would seal them.
    expect(said("secrets.envEncrypted")).toContain("Seal it with `dotenvx encrypt -ek 'PUBLIC_*'`");
    expect(said("secrets.noSecretsInCommits")).toContain("`dotenvx encrypt -ek 'PUBLIC_*'`");

    expect(said("typescript.strictTypesNoInvalidStates")).toContain("`strict` and `noUncheckedIndexedAccess` stay on wherever they are set");
    expect(said("typescript.tsconfigStrict")).toContain("turns off one of strict / noUncheckedIndexedAccess");
    // NO BASE, NO ENTRY: a rule demanding an import of a file the package does not ship would
    // refuse every repo that binds the pack.
    expect(entries.map((entry) => entry.id)).not.toContain("typescript.eslintFromBase");
    // And no sentence names a wrapper the repo never said it had.
    for (const entry of entries) {
      const spec = entry.spec as { message?: string; text?: string };
      expect(`${spec.message ?? ""}\n${spec.text ?? ""}`, entry.id).not.toContain("just ");
    }
  });

  // THE KEY'S CUSTODY, proved in the sentences it changes. `custody` decides what the agent is told
  // about the decryption key and whether the default encrypt command passes `--no-native` — all
  // prose, so no case can see it. Bound bare it is the OS secret store; `"file"` is `.env.keys`.
  // The seam is the same in both: `dotenvx run` reads `.env.keys` first, so it never needs the switch.
  it("tells the agent where the decryption key is, and seals with --no-native only for .env.keys", () => {
    const said = (seam?: { custody: "native" | "file" }): ((id: string) => string) =>
      sentence(loaded(loadConfig(defineConfig([seam === undefined ? pack(packs.secrets) : pack(packs.secrets, seam)]))));

    const native = said();
    expect(native("secrets.orientation")).toContain(
      "The decryption key is in this machine's OS secret store, where dotenvx put it; no file in this repo holds it.",
    );
    expect(native("secrets.orientation")).toContain(
      "If a decrypt looks suspiciously quiet, the key is missing from this machine's OS secret store; stop before you commit anything.",
    );
    expect(native("secrets.orientation")).not.toContain("check `.env.keys` exists");
    // `.env.keys` stays in the local tier under the OS store too, worded so it does not contradict
    // the sentence above: the agent must not go looking for a key file that is not there.
    expect(native("secrets.orientation")).toContain("`.env.keys` (the decryption key, when it is kept in a file — the ONE file you never read)");
    expect(said({ custody: "native" })("secrets.orientation")).toBe(native("secrets.orientation"));

    const file = said({ custody: "file" });
    expect(file("secrets.orientation")).toContain(
      "`.env.keys` holds the decryption key: `dotenvx encrypt --no-native -ek 'PUBLIC_*'` writes it, and it is copied by hand to every machine that runs the code; it is never in git.",
    );
    expect(file("secrets.orientation")).toContain(
      "If a decrypt looks suspiciously quiet, check `.env.keys` exists before you commit anything.",
    );
    expect(file("secrets.orientation")).not.toContain("OS secret store");
    expect(file("secrets.envEncrypted")).toContain("Seal it with `dotenvx encrypt --no-native -ek 'PUBLIC_*'`");
    expect(file("secrets.noSecretsInCommits")).toContain("`dotenvx encrypt --no-native -ek 'PUBLIC_*'`");
    // The seam takes no switch: `dotenvx run` reads `.env.keys` before the OS secret store.
    expect(file("secrets.orientation")).toContain("One seam: `dotenvx run -f .env.<env> -- <cmd>`");
  });

  // A repo's own encrypt recipe is named as given under `"file"` — the switch is that recipe's to pass.
  it("names the repo's own encrypt recipe as what writes .env.keys", () => {
    const said = sentence(
      loaded(loadConfig(defineConfig([pack(packs.secrets, { encrypt: "just env-encrypt", custody: "file" })]))),
    );
    expect(said("secrets.orientation")).toContain("`.env.keys` holds the decryption key: `just env-encrypt` writes it");
    expect(said("secrets.envEncrypted")).toContain("Seal it with `just env-encrypt`");
  });

  // THE DETAIL a refusal adds under its message is prose too, and a case cannot see it either: a
  // case reads only the verdict. A bare `-f` once read "`-f` in `-f`" (#144).
  it("names a bare -f once in the force-push refusal, and the bundle it sits in otherwise", async () => {
    const entry = loaded(loadConfig(defineConfig([pack(packs.git, { release: "just release" })]))).find((e) => e.id === "git.noForcePush");
    const check = (entry?.spec as { check: Check }).check;
    // Only what the check reads: the command line and the two verdicts. The ctx carries no
    // `commands` ON PURPOSE, so `gitCommands` takes its fallback and parses the line itself, with
    // the same `parseCommandLine` the live rails hand over as `commands`. A pack may import only the
    // public door, and the parse is not on it. Typed as the real ctx's own three fields, so the
    // compiler refuses a stand-in that drifts from them; the one cast widens it to the whole ctx.
    const detail = async (command: string): Promise<string | undefined> => {
      const ctx: Pick<Ctx, "command" | "ok" | "fail"> = {
        command,
        ok: () => ({ ok: true }),
        fail: (said) => (said === undefined ? { ok: false } : { ok: false, detail: said }),
      };
      const verdict = await check(ctx as Ctx);
      return verdict.ok ? undefined : verdict.detail;
    };
    expect(await detail("git push -f")).toBe("`git push` forces the remote with `-f`");
    expect(await detail("/usr/bin/git push -f nowhere main")).toBe("`git push` forces the remote with `-f`");
    expect(await detail("git push -fu origin main")).toBe("`git push` forces the remote with `-f` in `-fu`");
  });
});
