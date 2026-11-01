# Design system

## The direction

**Blue-cool paper ground, hairline separators, one acid accent, three type voices.**

It was chosen after reading the CSS of current premium studios — V12 Labs, Sooties,
Swapp Studio, BlackBear, DVLP, Relay, Phoni, Kott — plus Monolith and a set of
gallery taxonomies. V12 Labs set the register most directly: Switzer 300/400/500
at scale, a near-black ground, and section headings that are *declarative
sentences* ("What we build and run ourselves.") rather than category labels
("Products"). The finding that shaped everything:

> Expensive-looking sites have **fewer** named colours, **fewer** type cuts,
> **more** irregular structure, and **fewer** claims. Cheap-looking sites have
> the most colours, the most type, uniform card grids, stat banners, and an FAQ
> about themselves.

So the system is deliberately subtractive. Every addition had to justify itself
against a rule that a template would have followed automatically.

---

## Colour

A blue-cool paper ground, a four-step ladder, three levels of ink, two flat
bookend surfaces, one accent in two roles.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f2f5fb` | Page. Blue-tinted paper — 9 points of blue off neutral, never pure white |
| `--bg-inset` | `#e7ebf5` | Form fields, wells |
| `--bg-sunken` | `#dae0ee` | The darkest surface any text is asked to sit on |
| `--bg-raised` / `--lift-1` | `#fbfcfe` | A card — brighter than the page it lies on |
| `--lift-2` | `#eef1f9` | Surfaces you act on — plates, hovered rows, chips |
| `--lift-3` | `#e2e7f2` | The bottom of a press: selected, active, note wells |
| `--bg-band` | `#e5eaf4` | Alternating section ground — one step *down*, not up |
| `--bg-hero` | `#d9e5fb` | The opening plate: hero and inner-page heads |
| `--bg-closing` | `#d6e1f9` | The closing plate — the deepest surface on the site |
| `--line` | `#d3d9e6` | Hairlines. The **only** separator mechanism |
| `--line-strong` | `#737d95` | Interactive boundaries |
| `--ink` | `#141a26` | Headings, 16.0:1 on bg |
| `--ink-body` | `#242c3d` | Body copy, 12.8:1 on bg |
| `--ink-muted` | `#4a5468` | Supporting text, 7.0:1 |
| `--ink-faint` | `#576176` | Captions and metadata, 5.7:1 |
| `--accent` | `#b8f14a` | **Fill only:** buttons, bars, chips, rules, the pointer edge |
| `--accent-deep` | `#4d6d0d` | **Letters only:** links, indices, labels, focus rings |
| `--accent-bright` | `#c8ff5e` | Hover fill for accent surfaces |
| `--bg-scrim` | `color-mix(--bg 78%)` | A label floating over media |

Every neutral is tinted off pure grey — no `oklch(… 0 …)` — and every pair below
clears the requirement it is held to. The worst case for each is measured on
`--bg-sunken`, the darkest surface text sits on:

| Pair | Value | Needed |
|---|---|---|
| `--ink-faint` on `--bg` | 5.69:1 | 4.5:1 |
| `--ink-faint` on `--bg-sunken` | 4.70:1 | 4.5:1 |
| `--ink-muted` on `--lift-3` | 6.14:1 | 4.5:1 |
| `--accent-deep` on `--bg-sunken` | 4.53:1 | 4.5:1 |
| `--line-strong` on `--bg-sunken` | 3.12:1 | 3:1 |

### The ladder, and why it runs toward the ink

The first version of this build had one ground value and hairlines, and a
full-page capture measured **97–98% of pixels below luminance 24**. It read as
unfinished rather than restrained. The ground was dark then, and the fix was to
lift panels out of the void — so the ladder ran *upwards*, toward white.

It now runs the other way, because paper does not have that problem. The page is
already the brightest object in the composition, so depth is made by pressing
in: a card sits above the sheet it lies on (`#fbfcfe` on `#f2f5fb`), and a
surface you act on is a step *down* into it (`#eef1f9`, `#e2e7f2`).

`--bg-band` deliberately no longer equals `--lift-1`. They shared a value when
both were panels against a void; here a band has to go down (`#e5eaf4`) while a
card goes up (`#fbfcfe`), and the two directions are what give a section its
rhythm. Cards inside a banded section therefore read as white on grey; cards
inside an un-banded one are held by their hairline alone, which is the quieter
of the two and is meant to be.

### The ground is blue, on purpose

The first light build was neutral-cool: two to eight points of blue across the
whole ladder. Measured, that is a colour; *read*, it was white. The brief that
followed was "very white and clean — add something premium". The answer was not
a second accent (the system has one, and a second hue would have been the
template's move) but the same ladder re-tinted: every step now carries **8–26
points of blue** against only **1–8** before, and the value steps are unchanged.
The paper reads as a chosen stock rather than as the default one.

Two sections take that further and become plates rather than tint:
`--bg-hero` on the opening and on every inner-page head, `--bg-closing` on the
last section. They carry **34 and 35** points of blue, which is where the
chroma actually becomes visible — at similar lightness, a six-point tint is a
colour nobody sees. Same move as the covers of a book being a different stock
from the pages: flat fills, no gradient, no wash.

### Light, and the three washes that are no longer there

This section used to hold three broad washes: a dark page needs a light source
or it reads as an unlit room, and the first attempt measured as unlit anyway.

Paper has the opposite failure mode. The ground sits at 0.97 relative
luminance, so a wash over it is a tint rather than a light — and a pale gradient
behind a pale page is the other half of the same tell that a background was
generated rather than designed. The three tokens are gone rather than inverted.
Two things now carry "there is light here" in their place: the accent, which has
a fill and a letter to spend instead of a glow; and the two bookend plates
(`--bg-hero`, `--bg-closing`), which are flat and placed rather than painted.

**Film grain** remains — an inline SVG turbulence tile at 3.5% opacity,
`position: fixed`, `pointer-events: none`. On paper it does something different
from what it did on the void: it is not dithering a gradient's 8-bit steps away,
it is giving a flat fill a fibre.

### The macrostructure stamp

The top of `tokens.css` carries it, and `npm run gates` checks for it:

```
/* Hallmark · macrostructure: Split-Diptych with Masthead · light · newsreader/plex · accent: acid */
```

Not decoration — gate 8 fails the build if this build silently reuses the
previous build's structure, and gate 32 fails if the stamp records no archetype
variation. Writing down the structural choice is what makes drift visible.

The accent has one hue and two jobs, and the split is forced by the ground.
Acid against paper measures **1.22:1** — it is a colour you *fill* with, not one
you write with. So `--accent` takes buttons, bars, chips, rules and the pointer
edge, where it is read as a surface; every green **letter** — links, section
indices, labels, badges, focus rings — takes `--accent-deep`, the same 80° hue
taken down to 5.5:1. Two tints of one hue is a palette decision; two greens
would not have been.

Measured coverage of both together is 0.2–0.4% of a viewport, against a 5% ceiling
(gate 23). The temptation is always to spend more of it, and the page looks
cheaper every time that is done.

**`--ink-body` is not a muted grey.** Body copy sits at 12.8:1, which is
comfortably accessible and visibly intentional; sites that push body text down
toward the 4.5:1 floor read as machine-generated even when they pass.

### What is not here, and why

- **No gradient text.** The display face does the work; `background-clip: text`
  is the single fastest way to make a headline look like a template.
- **No glassmorphism.** A `backdrop-filter` was written, tested, and removed: it
  breaks `position: fixed` descendants of the sticky header, and blur as a
  surface treatment contradicts the hairline system.
- **No `box-shadow`.** Depth comes from the ground colour and hairlines.
- **No radius above 2px.** `--radius` is 2px and exists for form controls, where
  a square input reads as unstyled rather than as a decision. Cards are square.
- **No coloured glow, no accent stripes, no animated mesh.** The one gradient
  that exists is the accent-to-hairline rule carrying the eye from an eyebrow to
  its heading — it answers a question rather than filling a rectangle because it
  looked bare. Everything else that might have been a wash was removed when the
  ground went light (see *Light, and the three washes that are no longer there*).

---

## Type

Two voices, three files, 69 KB total.

| Role | Family | Files | Notes |
|---|---|---|---|
| Display | **Newsreader** (variable serif) | 1 | Optical sizing axis intact, 6–72 |
| Text + UI | **IBM Plex Sans** (variable) | 1 | Weight axis 100–700 |
| Meta, tags, indices | **IBM Plex Mono** 500 | 1 | Plex Sans' sibling superfamily |

Plex Sans and Plex Mono are one designed superfamily, so this reads as two
voices rather than three. It also mirrors the pattern that worked at both studios
studied most closely: mono for the UI, serif for display.

**Why a serif display on a developer site.** Every dark developer site uses a
sans. A serif over a mono/sans UI is the deliberate counter-move, and it is what
signals "we have taste and do not need to shout".

**Deliberately excluded** — each of these is now a signature of machine-
generated design, and several were the "premium" choice two years ago: Space
Grotesk, Instrument Serif, Geist, Syne, Fraunces, Inter as body text,
`system-ui` as body text.

### Weights

The raw Google Fonts builds totalled **420 KB**. They were cut with `pyftsubset`
over a 185-codepoint charset covering every glyph the site can render, giving
**69 KB**:

```
newsreader-400.woff2    40 KB
plexsans-var.woff2      23 KB
plexmono-500.woff2       6 KB
```

### Font loading

`font-display: swap` with **metric-matched fallbacks**. Each fallback `@font-face`
carries `ascent-override`, `descent-override` and `size-adjust` derived from its
webfont's own metrics, so the fallback box is the same size as the webfont box
and the swap moves nothing. This is the difference between CLS 0.14 and CLS 0
on a slow phone.

The two text faces are preloaded. The mono is not: it appears only in small
labels, and 6 KB is not worth a render-blocking request.

---

## Scale and rhythm

One fluid root size, and every spacing value is a `rem` multiple of it, so the
type scale and the spacing scale move together:

```css
html { font-size: clamp(0.95rem, 0.88rem + 0.3vw, 1.19rem); }
```

~15.2px at 360px, ~19px at 1600px. Steps run `--step--1` through `--step-6`.

One value is deliberately **not** fluid:

```css
--tap: 44px;   /* touch target minimum, in px */
```

The root font-size is fluid, so a `rem`-based `min-height: 2.75rem` resolves to
42px on a phone — just under the guideline. This was caught by the mobile
end-to-end suite, not by eye. Interactive controls reference `--tap`.

Section rhythm was tightened once after a full-page screenshot read as sparse
rather than composed. Generosity belongs in the type scale, not in empty
vertical space.

**Contact is the one page that fits a screen.** At 1440x900 the section runs
heading → submit inside the viewport (measured: ~825px, submit at ~873px), so
the one task the visitor came for needs no scroll. The knobs are scoped to
`#contact` only — section padding, the head's internal margins (the eyebrow's
own bottom margin is dead space inside the kicker), the lede at body size, a
12px row rhythm, empty error slots collapsed, and the privacy note on the
submit line as its caption. A 1448px form was, in the visitor's words, too
much space between lines.

---

## Grid

A 12-column grid where **rows justify but never tile**:

```
7 / 5      wide + companion
8 / 4      statement + narrow
12         full bleed, landscape only
1 column   below 640px
7 / 5      tablet
```

A uniform 2x2 is the template default and it reads cheap.

**The spans are ratio-aware**, which matters more than it sounds. A full-bleed
slot holding a 4:5 portrait would render 1440x1800 — taller than the viewport,
a single card of nothing. So portrait content is promoted into a paired slot, and
only landscape is eligible for the statement position.

Every card additionally carries `max-height: min(58vh, 520px)` with
`object-fit: cover`. Any future content, at any aspect ratio, is now guaranteed
to stay within a sane band.

Ratios are selected with a `data-ar` attribute rather than an inline custom
property, because the CSP does not permit style attributes and hashing every
possible ratio would cost more than the rules are worth.

**The product row is not this grid.** Products do not tile into 12 columns;
they are equal cards in their own track — three across from 1152px, two from
768px, stacked below. The first card used to be promoted to a full-bleed
diptych so the flagship could have a stage, and with two products in the
catalogue that made both cards read as *large* rather than as a row.

A row that would end short — two cards in a three-column grid — is closed by
`ProductsMore`: an empty registration frame carrying that section's outbound
link. Corner ticks are already this system's vocabulary for a plate with no
capture on it, so an unfilled cell wearing them reads as *set aside* rather
than as *missing*, and the frame fills itself the day a third product ships.

**The stack grid is explicit for the same reason.** Five groups under
`auto-fit` gave five columns at 1440, four plus an orphan at 1280 and a hole
at 834 — the row reflowed with the viewport instead of holding a shape. The
counts are chosen to tile (1 / 2 / 4 / 5 across), a short last row is closed
by the final group spanning it, and `grid-auto-rows: 1fr` with a box on every
group aligns the tops *and* the bottoms. A chip never wraps: a two-line token
beside single-line neighbours is the uncentred flex row gate 36 catches, and
a wrapped token is wrong even when nothing catches it.

---

## Motion

Transform and opacity only, never layout properties. Two speeds: 120–240ms for
anything the visitor caused, 520–800ms for anything that arrives on its own.

Two bundled modules, each with one job:

`src/scripts/motion.ts` runs two things:

- **The hero entrance** — the headline splits into words and they settle in
  sequence, once, on first paint.
- **Scroll reveals** — 14px and fade, staggered 55ms, triggered by an
  IntersectionObserver and then unobserved. The observer decides *when*; GSAP
  (core only, 28 KB gzip, no ScrollTrigger) does the interpolation.

`src/scripts/hero-driver.ts` owns the one thing that has to be **shared**:
pointer position and hero scroll progress, published as `--hero-x`, `--hero-y`
and `--hero-scroll`. The hero type used to drift on them too; it is anchored
now, because headline text that floats on the cursor is harder to read and
reads as a party trick. The delivery folio answers the pointer on its own — a
few pixels of parallax and a lift as the hero scrolls out, from the same numbers
the driver publishes — and its build loop runs on CSS alone, so it lives on
touch and reduced-motion without any script. When the pointer rests the driver
eases into a slow sine drift, so the drawing keeps breathing.

Hover and focus states stay on CSS transitions, because they are reactions
rather than choreography.

Three safety nets, in the order they fire: a `.no-motion` class when
`prefers-reduced-motion: reduce` is set, a three-second CSS failsafe that
reveals everything if the module never runs, and a `<noscript>` link to
`public/no-js.css` for the case where there is no JavaScript at all. All three
exist because the first version of this build had a reveal system with no
observer behind it — 84 elements at `opacity: 0`, on every page, and the one
test that would have caught it ran under reduced motion where the CSS forces
them visible.

No parallax, no scroll-jacking, no marquee, no custom cursor, no animated
counters. The page is fully readable with motion off.

The test applied throughout: **if the page still feels premium with motion
disabled, the design is working.**

---

## Patterns chosen against the obvious option

| The obvious thing | What is here instead, and why |
|---|---|
| Numbered process steps (1-2-3) | A schematic track with hairline rules. Numbered steps are a current AI tell and read as a marketing funnel rather than how work runs |
| FAQ accordion | Every answer open on arrival. The documented tell is a *withheld* answer — a question you still have to ask for. `<details>` is only there so someone scanning six questions can fold the four they do not need |
| Circular-avatar team cards | An editorial spread with a hairline between the two people. It reinforces that this is a studio, not a marketplace |
| Stat banner ("10K+ users, 99.9% uptime") | Nothing. There are no measured numbers, so there is no banner. Credits naming real people are the honest substitute for social proof |
| Uniform card grid | A fractional, ratio-aware composition |
| Hero headline | Positioning, one primary action, and a status line |
| "Welcome to our website" | "Software, built and shown." |
| Gradient placeholder art | A measurement plate: registration ticks, a hairline grid, the product's initial set in the display face behind its own mark, and the kind of thing it is noted in the corner |
| A screenshot of every product on the index | The product's own mark, a one-line tagline and the link out. A capture is evidence, and evidence belongs on the case study, where there is room to read it |

### Content over decoration

Between a beautiful effect and a clearer explanation of what was built, the
explanation wins. Between a complex animation and a faster page, the faster
page wins. Between a feature and a better project presentation, the
presentation wins. That is not a caveat about the design; it is the design.

---

## Empty states

An empty portfolio has a specific failure mode: the page apologises, and the
apology is worse than the gap. A visitor cannot tell whether there is no work or
no work *published yet*, and "coming soon" implies something is behind it.

So `/work` states the situation, explains why the page is short, and points at
`/products` — where the studio's own software is, and which needs nobody's
permission to publish. The panel is a composed section with a border-block, not a
dashed placeholder box.

The same rule covers zero testimonials, zero Instagram posts and zero services:
the section does not render. A heading over nothing is always a bug.

The one place a slot *is* labelled is the product plate, and it carries a fact
rather than an apology — the kind of thing the product is (`Mobile app`,
`Web app`, `AI tool`), set in the corner of the measurement field. The
lifecycle state sits under it in the card body, published as a fact about the
software rather than as a badge. Nothing on the card says the studio failed to
take a screenshot: there was never a screenshot on the index to fail.

The outbound link is named from the host rather than assumed. A product listed
on Google's store is labelled **Play Store**, one on Apple's says **App
Store**, and everything else says **Website** — a mobile product with an
unlisted target still says Play Store, because that is where a mobile app is
distributed, and a claim has to be true rather than merely plausible. A
placeholder domain (`example.com`) is not published at all: the link
suppresses rather than shipping a broken destination.

---

## Accessibility notes

- Every interactive control is at least 44x44, asserted in the E2E suite.
- Focus is styled, never removed: a 2px accent outline at 3px offset.
- Exactly one `<h1>` per page, asserted in the E2E suite.
- Body text is roughly 11:1; `--ink-muted` is reserved for non-essential text.
- The mobile menu is a full-height sheet with large targets, closes on Escape,
  and locks body scroll while open.
- Card previews never depend on hover: on touch, the still image is the preview
  and video is not offered at all.


---

## What the rebuild changed

The rebuild replaced the previous shell rather than decorating it. Each entry
names the arrangement that was removed, because a list of what is *not* there is
more useful to the next person than a list of what is.

| Before | After | Gate |
|---|---|---|
| Nav: wordmark-left, inline link row, button-right, hairline | Masthead: wordmark set in the display face, destinations in mono, primary distinguished by colour with no button-right | 42 |
| Footer: three link columns over a hairline | Statement footer: a closing line, an email, destinations, a base row | 43 |
| Hero: symmetric padding, display at `--step-6` on any viewport | Hero that fits the fold at 1280x800 — measured, not asserted | 44 |
| Section heads with an eyebrow and a note on one row | Single column by construction, in the `Section` component, so a caller cannot produce the multi-column version | 54 |
| Feature grid of icon-above-heading tiles | A spec sheet: label left, body right, hairline between rows | 3 |
| Product card unnamed and uncategorised | Product card as identity: mark, name, one-line tagline, link out, published lifecycle state | — |
| "Two people" in metadata, hero copy, the team page and `Person` JSON-LD | No people anywhere; `/about` carries practices instead | — |

### Components

| Component | Arrangement |
|---|---|
| `SiteNav.astro` | Masthead. No button-right; the primary destination is the last link in accent. The mark is a hand-spun spark: three uneven strokes crossing off-centre in accent-deep plus one acid swipe, which keeps the accent a fill; the whole mark sits a few degrees off-axis. |
| `SiteFooter.astro` | Statement footer. Leads with a closing line. |
| `Section.astro` | Single-column head. `headingLevel` is explicit because exactly one `<h1>` per page is a hard requirement. |
| `HeroFigure.astro` | The hero's right column and the site's signature moment: the **studio delivery folio** — a ruled project sheet being worked through the five stages the studio actually runs: *Brief* writes three entries, *Spec* two more, *Build* assembles a small interface (frame, sidebar, two lines, one filled block), *Verify* draws a check over it, *Ship* lands a stamp as the delivery rule runs out to the sheet edge. A stage rail down the right edge names all five at once, so the sheet says where it is even to a visitor who never sees it move; the two people are two marks riding the ledger margin. Plain SVG and one twelve-second CSS loop with per-element keyframes, so it needs no pointer, works on touch and costs no JavaScript of its own — measured with scripting disabled, the timeline advances on the identical phase clock. The pointer-driven layer is the figure's parallax lift only; the hero type is anchored on purpose. Reduced motion gets the same composition frozen complete — 60 of 60 drawing elements at full opacity, the poster frame, not a placeholder — and the box is reserved in CSS, so nothing shifts. Decorative by contract; the hero's words carry the meaning. |
| `ProductCard.astro` | An identity card: the product's own mark over a monogram ghost, the name, a one-line tagline that is always visible, and the link out — *Play Store* for a mobile app, *Website* otherwise, named from the host when the product lists a specific store. The lifecycle state is published as a fact. A capture is evidence and evidence lives on the case study, not on the index. |
| `WorkGrid.astro` | Irregular fractional rows on a 12-column grid, ratio-aware. |
| `NotFound.astro` | Shared 404 content for the framework route and for a slug that resolves to nothing (a product, a commission or a service). Offers real onward links — the products on a project 404, the services on a service 404 — because a 404 that suggests somewhere useful beats one that apologises. |
| `SpecSheet.astro`, `Metrics.astro` | **Removed.** No page imported either one; the CSS budget went to the hero instead. |

### Typography

`font-display: optional` on all three faces, not `swap`.

`swap` left a window in which the fallback and the webfont were both live, and
the `ch`-based `max-width` on the display headings re-wrapped during that window
— an intermittent **CLS of 0.037** on `/work`, on about one run in three under a
4x CPU throttle. `optional` removes the window entirely: the browser either has
the webfont inside its block period or renders a metric-matched fallback for that
page view.

That trades a possible one-view fallback for guaranteed zero CLS, and it is the
right trade *here* specifically because all three faces are self-hosted,
preloaded from the same origin on a ~5 ms TTFB, so the real font wins the block
period in practice. `typography > the webfonts actually load and render` asserts
that, because the failure mode of `optional` — the fallback silently winning
forever and the design quietly stopping being itself — would be invisible in
every other number on the page.
