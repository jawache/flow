// The harness the product's suites drive: Claude Code, the one adapter flow has.
//
// flow's own product takes a `Harness` and names none, so a suite of it needs a real one to hand over.
// It is imported from here rather than from the adapter's folder, which keeps the suites of the
// product's files from naming a harness, and the fence in guards/house.ts that keeps the product out
// of that folder from needing an exception for its tests.

export { claudeCode as host } from "../adapter/claude/claude.ts";
