import { type Refusal, type LoadResult, type LoadedEntry } from "./language/domain.ts";
/**
 * The config would not load. Every refusal rides along, each naming the entry it is about.
 *
 * The WORDING is `refusalText`'s, not this file's. The engine refuses a gated moment with the same
 * block of text, so a person who has read one has read the other — and a second copy of the
 * sentence here is how the exception and the block would come to disagree.
 */
export declare class FlowConfigError extends Error {
    readonly refusals: readonly Refusal[];
    constructor(refusals: readonly Refusal[]);
}
/** The loaded entries, or the error carrying every reason there are none. */
export declare function entriesOrThrow(result: LoadResult): readonly LoadedEntry[];
