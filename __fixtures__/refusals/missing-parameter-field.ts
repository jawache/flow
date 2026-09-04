// MISSING PARAMETER, the field — parameters supplied, one of them absent.
//
// The runtime backstop can only see that parameters were skipped WHOLESALE; which field is
// missing is knowable only where the type is. That is the division of labour, and it is why this
// class is proved here rather than in the load's matrix.

import { defineConfig, pack } from "../../index.ts";
import { tdd } from "../demo-pack.ts";

export default defineConfig([
  // @refusal Property 'run' is missing
  pack(tdd, {}),
]);
