import type { LoadResult } from "../language/domain.ts";
import type { Harness } from "./harness.ts";
import { type Facts, type SelectOpts } from "./domain.ts";
export interface FactsOpts extends SelectOpts {
    /** Read exactly this conversation, whatever the backlog says. */
    readonly session?: string | null | undefined;
    /** Only conversations recorded on this branch. */
    readonly branch?: string | null | undefined;
    /** Mark what was read, so the backlog starts after it next time. */
    readonly mark?: boolean | undefined;
    readonly home?: string | undefined;
    readonly nowMs?: number | undefined;
}
/**
 * Everything the record and the conversations say about a repo, assembled.
 *
 * `load` is passed in rather than read here: what an entry watches is the CONFIG's answer, and
 * this file has no business importing one. A regime that will not load is handed over as such,
 * and the universe comes back empty — which is honest, and reads as "nothing is bound" rather
 * than as a crash.
 */
export declare function facts(root: string, load: LoadResult, harnesses: readonly Harness[], opts?: FactsOpts): Facts;
