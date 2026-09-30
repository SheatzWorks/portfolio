# Design system

## The direction

**Near-black ground, hairline separators, one acid accent, two type voices.**

It was chosen after reading the CSS of four current premium studios (Studio
Freight, Mouthwash Studio, Studio Naam, and a fourth mid-tier agency) and
six gallery taxonomies. The finding that shaped everything:

> Expensive-looking sites have **fewer** named colours, **fewer** type cuts,
> **more** irregular structure, and **fewer** claims. Cheap-looking sites have
> the most colours, the most type, uniform card grids, stat banners, and an FAQ
> about themselves.

So the system is deliberately subtractive. Every addition had to justify itself
against a rule that a template would have followed automatically.

---

## Colour

Four named surfaces, three levels of ink, one accent. That is the whole palette.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0b` | Page. Cool-neutral near-black, not pure, not navy |
| `--bg-raised` | `#101012` | Cards, the admin shell |
| `--bg-inset` | `#0d0d0f` | Form fields |
| `--line` | `#1f1f23` | Hairlines. The **only** separator mechanism |
| `--line-strong` | `#2a2a30` | Interactive borders |
| `--ink` | `#ededf0` | Headings |
| `--ink-body` | `#d4d4da` | Body copy, ~11:1 on bg |
| `--ink-muted` | `#9a9aa4` | Supporting text |
| `--accent` | `#b8f14a` | **One job:** interactive and selected |

The accent has one job. It marks what is clickable and what is selected, and it
appears nowhere else. Using it as decoration is the fastest way to make this
palette look like every other dark site.

**`--ink-body` is not a muted grey.** Dark-background sites that push body text
to grey-500 read as machine-generated and as low-contrast. Body copy here sits
at roughly 11:1, which is comfortably accessible and visibly intentional.

### What is not here, and why

- **No gradients.** They are the default of a model that has chosen nothing.
- **No glassmorphism.** A `backdrop-filter` was written, tested, and removed: it
  breaks `position: fixed` descendants of the sticky header, and blur as a
  surface treatment contradicts the hairline system.
- **No `box-shadow`.** Depth comes from the ground colour and hairlines.
- **No radius above 2px.** `--radius` is 2px and exists for form controls, where
  a square input reads as unstyled rather than as a decision. Cards are square.
- **No coloured glow, no accent stripes, no gradient text.**

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

---

## Motion

Transform and opacity only. 120–240ms, `cubic-bezier(0.2, 0, 0, 1)`.

- One 8px translate-and-fade per section, triggered once by an
  IntersectionObserver, then unobserved.
- A 2px image scale on card hover.
- Nothing else.

No parallax, no scroll-jacking, no marquee, no custom cursor, no animated
counters. `prefers-reduced-motion` reduces every duration to 1ms and disables
the reveal offset entirely, and the page is fully readable with motion off.

The test applied throughout: **if the page still feels premium with motion
disabled, the design is working.**

---

## Patterns chosen against the obvious option

| The obvious thing | What is here instead, and why |
|---|---|
| Numbered process steps (1-2-3) | A schematic track with hairline rules. Numbered steps are a current AI tell and read as a marketing funnel rather than how work runs |
| FAQ accordion | An editorial definition list. A collapsible "Frequently asked questions" block is a documented tell, and there is nothing here to conceal |
| Circular-avatar team cards | An editorial spread with a hairline between the two people. It reinforces that this is a studio, not a marketplace |
| Stat banner ("10K+ users, 99.9% uptime") | Nothing. There are no measured numbers, so there is no banner. Credits naming real people are the honest substitute for social proof |
| Uniform card grid | A fractional, ratio-aware composition |
| Hero headline | Positioning, one primary action, and a status line |
| "Welcome to our website" | "Software, built and shown." |
| Gradient placeholder art | A typeset plate in the mono face |

### Content over decoration

Between a beautiful effect and a clearer explanation of what was built, the
explanation wins. Between a complex animation and a faster page, the faster
page wins. Between a feature and a better project presentation, the
presentation wins. That is not a caveat about the design; it is the design.

---

## Empty states

The site ships empty, so the empty state is what a visitor actually sees. It is
a full-width hairline band, not a dashed box:

```
awaiting first entry          The work goes here
                              This section is the centre of the site, so it is
                              left deliberately empty rather than filled with
                              placeholder projects. Published creations appear
                              here automatically, each with a captured
                              screenshot of the live site.
                              ─────────────────────────────────────
                              Add one from /admin — a URL is all that is required.
```

It states what belongs there, how it gets there, and uses a hollow ring rather
than the solid accent dot — because this is an empty slot, not a live status.

The same treatment covers zero testimonials, zero services, zero process phases,
and zero Instagram posts. No section renders a heading over nothing.

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
