---
summary: "the work + flow brand book: the marks, colour, type, layout and voice, for anything designed for either tool"
---

# work + flow

Two tools for a team of one. **work** is where you sit all day: one Claude Code session per GitHub issue, a feed of actions instead of tickets, a conversation you can steer. **flow** is what lets the agent run without you watching: guardrails written as code, so a refused action never happens and the agent is told why, in your words.

Put together they are the thing you'd expect, and that is the brand. The pun is the thesis: a solo developer's day is one stream. The agent runs in flow. You step in at the dot.

## What this system is for

Two websites, two READMEs, two GitHub and npm presences, and the terminal both tools live in. Everything here is built to be seen at 2am in a dark terminal and to look like it belongs there. The sites are the same system on a bigger screen.

## Principles

- **Spy, not protestor.** Vibrant underneath, plain on the surface. The ground is dark and quiet, the type is lowercase and unremarkable, and each brand has exactly one hot colour used in exactly one place at a time.
- **A well-kept workshop.** No gradients, no hero illustrations, no "platform". Closer to a good man page than a landing page. Rules, not shadows. Panels one step up from the ground, never two.
- **Lowercase, always.** `work` and `flow` are never capitalised, not at the start of a sentence, not in a title. The names are glyphs more than words.
- **The humour is in the brand, not the docs.** The docs stay plain and precise. The taglines carry the joke: *it just works* and *stay in flow*.
- **Each stands alone.** work is hyper-focused on the solo developer and says so in its first line. flow can live in a team's repo and never mentions work until the footer. The pair lockup is a footnote on both, never the headline of either.

## The marks

Each brand is a single glyph a terminal already knows how to draw.

| | mark | glyph | meaning |
| --- | --- | --- | --- |
| **work** | the dot | `●` | something is alive here and wants you. The first of a family the TUI already draws: `●` running, `○` idle, `◌` asleep, `■` ended |
| **flow** | the wave | `~` | one unbroken line. The agent keeps going, and the path of least resistance stays inside the banks |
| **the pair** | dot, then wave | `●work ~flow` | you ask, the agent runs with it. Always this order |

Two systems, deliberately:

- **In a terminal, type the font's own glyphs**, `●` and `~`, in `work` and `flow`. They will never be the same height as each other and don't need to be.
- **Anywhere designed, draw them.** The drawn glyphs are in [`logos/`](./logos/). The rule for drawing one beside Geist text, at any size `S`:
  - the glyph occupies one character cell, `0.62 × S` wide (the width of Geist's o)
  - its height is the x-height, `0.53 × S`, and it sits on the baseline like a lowercase letter
  - the wave's stroke is the bold stem, `0.095 × S` (`stroke-glyph`)
  - the gap between glyph and word is `0.1 × S`
  - on the 64 grid, standalone: the dot is `r18` at `32,32`; the wave is stroke 6 with round caps, 42 wide by 36 tall, `M14 32 C 20.8 12, 26.4 12, 32 32 S 43.2 52, 50 32`. The pair is `104 × 64`, dot at `24`, wave from `54`, gap 12.
- **The shape never changes. Only the stroke does.** At 32px the wave thickens to 9 and at 16px to 11, and the dot grows to r19 then r20, so the marks keep their weight when the pixels run out. Tiles (`work-tile.svg`, `flow-tile.svg`) are the brand colour with the mark knocked out in `bg`, radius `radius-lg`.
- The marks survive in one colour: use `fg` on `bg`.

## Colour

One hot colour per brand, used in one place at a time: the glyph, the wordmark, or the one thing on screen that needs you. Everything else is `bg`, `bg-panel`, `fg` and `fg-muted`.

- **work** is coral, `work`. Loud on purpose: it is the colour of a notification.
- **flow** is mint, `flow`. The colour of a check that passed and a process still running.
- The two sit one golden-angle step apart in hue, so they belong to the asim.dev family without borrowing from it.
- **Ink is the default theme.** Paper exists for docs sites and print. On paper both accents darken (`#C2491F`, `#0B7557`) so they still pass as text; never put the ink-theme coral on paper.
- `danger` is for a refusal or a failed check and is used as rarely as `work`. A page with both coral and red on it has too much going on.
- Never colour body text. Never put a brand colour on a background larger than a callout tint (`work-tint`, `flow-tint`).

## Type

One family, two faces. **Geist** for everything you read, **Geist Mono** for everything a machine wrote or will read. Both are hosted on Google Fonts; load `Geist:wght@400;500;600;700` and `Geist+Mono:wght@400;500;700`.

- Wordmarks are Geist Bold, tracked `-0.04em`, lowercase. At masthead size that is `display-xl`.
- Headings are sentence case with no full stop. `h1` once per page.
- Body is `body` at a measure of `68ch`. The first paragraph under a heading is `lead`.
- Anything from a terminal, a config file, a command, a path, a key name, is mono: `code` in blocks, `code-inline` in text, `kbd` for keys, `label` for tracked uppercase tags.
- Code blocks are `bg-panel` with a `bg-rule` border and `radius-md`. The prompt character `$` is in the brand colour; nothing else in a block is coloured except a `✗` in `danger` and a `●` in `flow`.
- Numbers in running UI (counts, ages, pids) are tabular: set `font-variant-numeric: tabular-nums`.

## Layout

- A 4px base. Components use the even steps.
- Sections are `space-16` apart on desktop, `space-12` on a phone.
- A masthead is `space-24` of air around a `display-xl` wordmark with its drawn glyph, one tagline in `display` or `h1`, and one install command in `code`. Nothing else above the fold.
- Content column `measure` wide, left-aligned. No centred body text.
- Rules (`stroke-rule` in `bg-rule`) separate things. No drop shadows anywhere.
- Touch targets are at least 44px. Focus rings are `focus`, `stroke-focus`, offset 2px, on everything.

## Voice

Plain, precise, a little dry. Sentences are short and say one thing. The docs explain how it behaves, not why you should be excited. Jokes live in taglines and footers, never in error messages.

- Say *a team of one*, not *solopreneur*. Say *the agent*, not *the AI*.
- The terminal is the primary surface. If a sentence wouldn't fit on one line of a terminal, split it.
- The footer on both repos and both sites: *part of ●work ~flow, tools for a team of one, by @jawache*.

## Don't

- Capitalise either name.
- Put the pair lockup above a single brand's own mark.
- Draw the glyphs at a different proportion, or scale the wordmark's glyph separately from its text.
- Use a gradient, a shadow, a hero illustration, or a mascot.
- Use the ink-theme accent on paper, or body text in a brand colour.
- Use `>_`, a caret, or a cursor as a mark. Those belong to everyone.

## The files

- [`tokens.json`](./tokens.json) has every colour, type style, space, radius and stroke by name.
- [`logos/`](./logos/) has the drawn marks on the 64 grid, as SVG with the ink-theme colours: `work-mark.svg`, `flow-mark.svg`, `pair-mark.svg`, `work-tile.svg` and `flow-tile.svg`. For paper, recolour to `#C2491F` and `#0B7557`.
- Wordmarks are not files, because they depend on Geist. Set them in Geist Bold beside the drawn glyph.
