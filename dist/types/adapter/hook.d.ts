import { type HookEvent } from "./domain.ts";
import type { Harness, HookPayload, HookResult } from "./harness.ts";
/**
 * A path with its links resolved, as far as it exists on disk, and the rest as named. git lists a
 * worktree by its real path, and a temp folder on macOS is reached through a link (`/var` is
 * `/private/var`), so both sides are made real before they are compared.
 */
export declare function realPath(path: string): string;
/**
 * ONE payload, judged. The live half of the pipeline, in the order the pieces become knowable.
 *
 * The shape is deliberately flat rather than a hook function per event: the events differ in what
 * they CARRY (toEvent's job) and in how their answer is rendered (toResult's job), and the middle —
 * load, classify, run, log — is identical for all of them. The old engine had five files here, and the
 * off switch, the session marker and the fault handling were each written out four or five times
 * with small differences nobody had chosen.
 */
export declare function runHook(harness: Harness, hook: HookEvent, payload: HookPayload, root: string): Promise<HookResult>;
/** What came in on stdin: a payload, or which of the two ways reading it failed. */
export type PayloadRead = {
    readonly ok: true;
    readonly payload: HookPayload;
} | {
    readonly ok: false;
    readonly why: "unreadable" | "unparseable";
    readonly detail: string;
};
/**
 * A hook, end to end: read stdin, run it, and answer the way THIS event must when the read failed.
 *
 * `pre-tool-use` is the rail that GUARDS, so it fails CLOSED — a payload it cannot read is a tool
 * call it cannot judge, and "I could not look" must never be spelled the same way as "I looked and
 * it was fine". The after-call rails JUDGE too — every change a call made reaches the rules there —
 * so a payload they cannot read is a call whose changes nobody judged, and they report it with exit
 * 2, which on those rails reaches the model beside the result and blocks nothing. The rest only add
 * a breadcrumb, and breaking a session over one would be the cure killing the patient, so they SPEAK
 * on stderr and allow. `readFault` next door is where that split is decided.
 *
 * Everything is wrapped: a hook that throws is a hook that wedges a session, and an unknown event
 * is silence rather than a usage message in front of the model.
 */
export declare function hookEntry(harnesses: readonly Harness[], event: string, cwd: string): Promise<HookResult>;
