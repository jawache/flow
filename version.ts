// flow/version.ts — which build this is, for the one build that has to say so.
//
// `FLOW_VERSION` is replaced at bundle time with THIS package's version (see esbuild.mjs); a
// source run has no define, so it answers the dev sentinel. Its own module because more than one
// caller will need it and none of them may import each other — the same shape as cli/version.ts.

declare const FLOW_VERSION: string | undefined;

/** The version of the `flow` build that is running. `0.0.0-dev` when run from source. */
export const VERSION: string = typeof FLOW_VERSION === "string" ? FLOW_VERSION : "0.0.0-dev";
