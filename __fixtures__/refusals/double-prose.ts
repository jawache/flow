// PROSE SAID TWICE — a breadcrumb with both `.text(…)` and `.file(…)`.
//
// A note shows one text, so a breadcrumb that says both is a note whose author has not decided
// which one it is. Once either form is said, the other is refused on the line that says it, in
// either order, on a breadcrumb and on an override. An override that says ONE form over a pack
// that used the other is not this mistake: it replaces the pack's prose, and compiles.

import { definePack, defineConfig, pack, override, breadcrumb, session } from "../../index.ts";
import { house } from "../demo-pack.ts";

export const rogue = definePack("rogue", {
  textThenFile: breadcrumb()
    .at(session)
    .text("Read the guide.")
    // @refusal already said .text(…)
    .file("docs/guide.md"),

  fileThenText: breadcrumb()
    .at(session)
    .file("docs/guide.md")
    // @refusal already said .file(…)
    .text("Read the guide."),
});

export default defineConfig([
  pack(house),
  // The pack's `orientation` uses `.text(…)`; one `.file(…)` replaces it, and is no refusal.
  override(house.orientation).file("docs/orientation.md"),
  override(house.ssr)
    .text("Pages render the same for everyone.")
    // @refusal already said .text(…)
    .file("guards/notes/ssr.md"),
  override(house.orientation)
    .file("docs/orientation.md")
    // @refusal already said .file(…)
    .text("You are in the demo repo."),
]);
