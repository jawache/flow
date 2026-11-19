/**
 * flow's own orientation and self-protection, as a pack any repo binds.
 *
 * Every guarded repo wants these three: a note saying what is steering you, a refusal when a commit
 * would delete the steering, and a refusal when an agent runs `flow uninstall`, which removes the guard without deleting a file the delete refusal watches.
 *
 * @setup A `flow.config.ts` at the repo root. `flow init` writes it.
 * @adopt Bind it first, before any other pack: it is the one every guarded repo wants whether or
 * not it agrees with a single other opinion in this package.
 */
export declare const flow: import("../index.ts").Pack<{
    /**
     * Without it, an agent works in a guarded repo without knowing it is guarded: a refusal arrives
     * with no model of where it came from, and the config that produced it is just another file.
     */
    orientation: import("../index.ts").BreadcrumbSentence<"text" | "at" | "description", "session">;
    noDeleteGuardrails: import("../index.ts").GuardrailSentence<"at" | "message" | "check" | "test" | "description", "commit">;
    /**
     * Without it, an agent that hit a guardrail could take the whole guard off with one command.
     * `flow uninstall` removes the commit gate, unsets `core.hooksPath` and removes flow's hook
     * registrations from inside its own process, so no shell command deletes a file that
     * `noDeleteGuardrails` watches, and that refusal never fires. A person in their own terminal
     * has no hooks in front of them, so this refusal never reaches them.
     */
    noUninstall: import("../index.ts").GuardrailSentence<"at" | "message" | "everywhere" | "check" | "test" | "description", "command">;
}, undefined>;
