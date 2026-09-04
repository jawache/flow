// A flow.config.ts binding every stock check — what `flow test` is driven over in F2's proof.
//
// One `pack()` line turns on all fourteen entries of ../core-pack.ts, opt-out, and one override
// shows that a repo can move a pack's rule without reaching inside what it asks. Run it:
//
//   node flow/dist/flow.mjs test flow/__fixtures__/core.config.ts

import { defineConfig, override, pack } from "../index.ts";
import { core } from "./core-pack.ts";

export default defineConfig([
  pack(core),

  // Move it: this repo keeps its prose under content/, not src/.
  override(core.noTodo).on("content/**/*.ts", "src/**/*.ts"),
]);
