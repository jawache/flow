// AN OVERRIDE REACHING INSIDE A CHECK — the class of failure that produced twelve load errors.
//
// An override moves an entry, rewords it, or switches it off. It can never touch what the entry
// ASKS: anything a repo may vary is a parameter the pack declared, typed, in one place. So there
// is no `.check()` here and no `.test()` — not a validated key, an absent one.

import { defineConfig, pack, override, type Check } from "../../index.ts";
import { house } from "../demo-pack.ts";

const somethingElse: Check = (ctx) => ctx.ok();

export default defineConfig([
  pack(house),
  // @refusal Property 'check' does not exist
  override(house.noTodo).check(somethingElse),
]);
