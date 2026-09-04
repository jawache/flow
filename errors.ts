// flow/errors.ts — the one place a refusal becomes an exception.
//
// The load returns refusals as VALUES: that is what lets one broken config report all three of
// its mistakes, and it is what keeps every domain.ts free of `throw`. But a caller at the edge
// of the system — a hook entry, a CLI verb — wants the ordinary failure path, and writing the
// same three lines at each of them is how one of them ends up swallowing the refusals quietly.
//
// So the conversion lives here, once, and it is a SHELL concern: this file is not a domain.ts,
// and no domain.ts imports it.

import type { Refusal, LoadResult, LoadedEntry } from "./language/domain.ts";

/** The config would not load. Every refusal rides along, each naming the entry it is about. */
export class FlowConfigError extends Error {
  readonly refusals: readonly Refusal[];

  constructor(refusals: readonly Refusal[]) {
    super(
      [
        `flow: the config will not load — ${refusals.length} refusal${refusals.length === 1 ? "" : "s"}.`,
        ...refusals.map((r) => `  ${r.code}: ${r.detail}`),
      ].join("\n"),
    );
    this.name = "FlowConfigError";
    this.refusals = refusals;
  }
}

/** The loaded entries, or the error carrying every reason there are none. */
export function entriesOrThrow(result: LoadResult): readonly LoadedEntry[] {
  if (result.ok) return result.entries;
  throw new FlowConfigError(result.refusals);
}
