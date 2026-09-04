// MISSING MANDATORY, the breadcrumb half — a note with nothing to say.
//
// A breadcrumb carries its prose one of two ways, `.text(…)` inline or `.file(…)` for the long
// ones. Neither is not an option.

import { definePack, breadcrumb, session } from "../../index.ts";

export default definePack("rogue", {
  // @refusal this breadcrumb has no prose
  orientation: breadcrumb().at(session),
});
