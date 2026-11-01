# DESIGN.md — sheatz studio portfolio

The art direction this build is held to. Read this before changing layout, type, colour or
motion. It refines the existing system; it does not replace it.

**Conflict rule.** Where a generic-avoid rule from the awwwards skill disagrees with this repo's
58 anti-slop gates (`scripts/gates.mjs`), **the gates win**. The eyebrow labels, mono meta and
hairline rules are the studio's deliberate voice, not template chrome, and they are testable.

---

## 1. Brief

- **Who:** `sheatz`, a two-person studio. No sales team, no account manager. The person who
  answers the enquiry is the person who writes the code.
- **What they sell:** web applications, mobile apps and on-device AI — designed, built and
  operated in-house, then maintained after launch.
- **The site's one job:** get a qualified enquiry. Not "impress", not "list everything".
- **The honest constraint:** the studio's own products are the only proof that needs nobody's
  permission. Client work can only say what the client agreed to. The site must make that
  distinction structural, not rhetorical.
- **What is real:** the products/commissions split (enforced in SQL via `ownership`), the
  published price ranges, the process, the stack, the FAQ. No clients, metrics, testimonials or
  awards are invented.

## 2. Three concepts (different territories, scored)

Scores are originality / fit / feasibility / portability (portability: lower is better).

| | A. The ledger line (formal system) | B. Local-first instrument (material) | C. The sheet (name) |
|---|---|---|---|
| **Idea** | The site is one ledger with a single line through it: what we run above, what we build for you below. Every route hangs off that line. | The site behaves like the on-device software they build: it answers the pointer instantly, from data already present, with no round trip. | `sheatz` reads as *sheets*: a contact sheet of work, spec sheets for services, data sheets for products; pages are sheets in one stack. |
| **Anchor** | The products-vs-commissions split is the architecture, not a section order. | On-device AI is a real product claim; the site can demonstrate the same property. | The name and the actual artefacts (screenshots, specs, ranges). |
| **Layout rule** | Two vertical lines; every block starts on one of them. Split hero, split case pages. | Media and type sit on a single plane; nothing waits for a network state. | Full-bleed sheets, one per route; page transitions slide the stack. |
| **Motion verb** | *rule* — the line draws itself and things align to it. | *compute* — instant, local, idle drift. | *turn the sheet* — lift, slide, settle. |
| **Signature** | The working ledger: the hero figure draws the site's own tagline — the method on the upper line (*Build → Run → Ship*), the work being delivered on the lower line. | The hairline figure, drawn as one. | Sheet-to-sheet transition. |
| **Risk** | Can read as broadsheet (gates already keep it from becoming decoration). | Concept lives only in the hero — the skill says kill it if so. | Skeuomorphism; heaviest to build. |
| **Score** | **4 / 5 / 5 / 2** | 4 / 4 / 4 / 3 | 5 / 4 / 3 / 2 |

**Pick A.** It is the only concept that produces decisions for layout, navigation, routing, case
pages and the 404, and its signature moment is the hairline the build already needs. Steal two
details: from **B**, the interaction must feel local and must keep moving at rest; from **C**, the
404 is a sheet with nothing ruled on it.

### Concept Card

- **Idea:** the site is a ledger with one line through it — ours above, yours below.
- **Metaphor:** ruled paper / a register, not a gallery grid.
- **Signature moment:** one drawing in the hero — the **working ledger**: two lines, the method
  on the upper one (*Build → Run → Ship*), receipts landing on the lower one, two people as two
  dots riding the line, one delivered build riding out with a flag. It continues as the section
  rules and resolves into the footer rule.
- **Motion verb:** rule.
- **Emotion:** precise, calm, accountable. The opposite of a sales page.
- **Screenshot frame:** hero at 1440 px, the working ledger in the right column, mono labels
  pinned to its rules, the four studio facts in a strip along the bottom — readable as a
  poster with motion off.

## 3. Art direction

### 3.1 Palette roles (existing tokens, named)

| Role | Token | Value | Use |
|---|---|---|---|
| ground | `--bg` | `#f2f5fb` | the page |
| surface | `--lift-1` / `--lift-2` / `--lift-3` | `#fbfcfe` / `#eef1f9` / `#e2e7f2` | cards, rows, presses |
| band | `--bg-band` | `#e5eaf4` | alternating section ground |
| ink | `--ink` / `--ink-body` | `#141a26` / `#242c3d` | display / body |
| muted | `--ink-muted` / `--ink-faint` | `#4a5468` / `#576176` | secondary / captions (AA on every surface) |
| line | `--line` / `--line-strong` | `#d3d9e6` / `#737d95` | decoration / boundaries (≥3:1) |
| accent fill | `--accent` | `#b8f14a` | **fill only** — buttons, bars, chips, the pointer edge |
| accent letter | `--accent-deep` | `#4d6d0d` | every green word (≥4.5:1) |
| curtain | `--bg-hero` / `--bg-closing` | `#d9e5fb` / `#d6e1f9` | the two bookend surfaces |

Rules: the acid is never a letter; `--accent-deep` is never a large fill. One radius
(`--radius: 2px`), pills only where the control is genuinely a pill (`--radius-full`).
No gradients, glows or glass. Selection colour, focus ring and scrollbar use the accent.

### 3.2 Type

- **Display:** Newsreader (variable serif). **Text/UI:** IBM Plex Sans. **Meta:** IBM Plex Mono.
- Display tracking tightens with size: `-0.015em` at `--step-4`, `-0.03em` at `--step-5`,
  `-0.04em` at `--step-6`; leading `0.95–1.02` for display, `1.55–1.65` for body.
- Mono meta: 12–13 px, uppercase where it is a label, `+0.06em` tracking, `tabular-nums` for
  years, indices and prices.
- Body measure `--measure` (66ch); ledes at `--step-1`, prose at `--step-0`.
- **Known defect to fix:** `Newsreader` is loaded as a variable font but CSS asks for weights
  300/500 that the file may not carry. Either ship the weight file or drop the declarations —
  do not leave a silent no-op.
- Real characters: ’ “ ” × … and `&nbsp;` between numbers and units.

### 3.3 Grid and rhythm

- Desktop: 12 columns, fluid `--gutter`, `--max-w` 84rem. Phone: 4 columns.
- **Three vertical lines** carry the site: the outer gutter, the ledger line (≈62% on the hero,
  column 8 elsewhere), and the right gutter. Text blocks start on one of them.
- Section padding has moods, assigned per section: **tight** `--sp-7`, **normal** `--section-y`,
  **airy** `--section-y-lg`, **full** (closing only). No two adjacent sections share a mood.
- One section-layout family per page, at most once:
  hero = split frame · products = index list · work = gallery wall · services = data/facts ·
  process = sticky narrative · practices = index list · stack = index list · FAQ = statement ·
  footer/closing = finale.

### 3.4 Section wireframes (home)

```
HERO            [ eyebrow ......................... ]
                [ display headline .......... ]   [ working ledger ]
                [ lede ...................... ]   [ Fig. 01    ]
                [ primary → ] [ secondary ]       [ readout    ]
                [ meta strip: focus · engagement · status · reply ]  (full width)
PRODUCTS        [ eyebrow ] [ title ................ ] [ note ]
                [ card ] [ card ] [ card ]      (index rows, not a card grid)
WORK            [ eyebrow ] [ title ]  →  staggered pairs (gallery wall)
SERVICES        [ eyebrow ] [ title ]  →  ruled table, price ranges tabular
PROCESS         [ eyebrow ] [ title ]  →  sticky chapter list / numbered beats
PRACTICES       [ eyebrow ] [ title ]  →  six ruled rows, no icons
STACK           [ eyebrow ] [ title ]  →  mono index, grouped
FAQ             [ eyebrow ] [ title ]  →  statement + disclosure rows
CLOSING         [ big line ] [ email ] [ social ]   full-bleed curtain
```

The hero's four facts run across the **full width** of the hero, under both columns, not
stacked inside the left one: four across from 48rem, two-by-two below. The strip is the first
ruled line of the ledger, and pinning the studio's four facts along it made the hero fit an
800 px laptop screen that the stacked version overflowed by 77 px.

Case pages (`/work/[slug]`, `/products/[slug]`) keep the same ledger line: meta in the left
column, narrative in the right, media full-bleed only when it is the proof.

### 3.5 Genericness test

Present and deliberate (protected by gates): eyebrows above headings, mono labels, `→` on
primary actions, hairline rules, acid accent on paper, the four-corner masthead/footer.

Absent on purpose: warm-cream + serif + terracotta; near-black + acid as the whole identity;
identical rounded cards with soft shadows; purple-blue glow/glass; Inter/Fraunces/Instrument
Serif; italic-accented word as the only typographic idea; "A · B · C" meta strings.

A jury should be able to crop any section and still recognise the studio. If a new element
could be pasted into any other studio site unchanged, it is not finished.

## 4. Signature moment — the working ledger

**What it is**

One drawing in the hero's right column: the site's own idea, being worked. A hairline sheet
ruled with exactly **two lines** — the upper line is the method (*Build → Run → Ship*), the
lower line is what it leaves behind. Two people are two dots riding the upper line: they walk
in, take each station in turn, and every finished stage drops a hairline down to the lower
line — a receipt, landing where we build for you. Run draws a check. Ship delivers a crate
with a flag, which rides the lower line out of the sheet with both people following it off
the edge. The readout under the sheet names the stage. A twelve-second loop; then the sheet
rests, and the next build walks in from the left.

It replaces a read-head on a static sheet. That figure answered the pointer, but it answered
with nowhere to go; this one is the ledger itself, with entries being made and work being
delivered, drawn in the studio's own hairline hand.

**Contract**

- One driver module owns pointer position (normalised −1…1) and hero scroll progress (0…1),
  published as custom properties the drawing consumes.
  - **The type does not move.** The hero words are anchored: text that floats on the cursor is
    harder to read and says the page is reacting to the visitor rather than to their work. Only
    the drawing answers the pointer — a few pixels of parallax and a lift as the hero scrolls out.
- **The loop is SVG and CSS, and it runs without the driver.** Every animated property is
  `transform`, `opacity` or `stroke-dashoffset`, so the loop is compositor-only, works on touch
  and costs no JavaScript of its own.
- **The loop is one twelve-second timeline with per-element keyframes.** Every element's 0%
  keyframe is the loop's own first frame and every hold is pinned, so nothing drifts or
  half-undraws at the wrap. Short one-shot animations (`3` iterations of 1.33s) are the
  historical bug: they stop after the first build and the second one happens in silence.
- **Idle motion:** a slow sine drift so the concept breathes with the pointer still.
- **Mount only** when `(pointer: fine)` and `prefers-reduced-motion: no-preference` and JS is on.
  Otherwise render a static composed frame (same geometry, no driver).
- **Three states, never a fourth:** driven · animated loop · poster frame. Under reduced motion
  the same composition is frozen with the build already finished — all three stations on the
  sheet, receipts down, check drawn, both people at the edge, readout on Ship. The box is never
  empty, so the poster frame is the design and not a fallback.
- **No layout shift:** the figure's box is reserved in CSS before the module runs.
- **Budget:** the module and the figure package together must keep total JS under
  `BUDGETS.totalJsKb` (40 KB) in `scripts/perf.mjs`.
- **CSP:** bundled Astro module only. Never inline script.

**Does it survive the concept test?** Yes — it *is* the ledger line, and the same line is the
section rule, the case-page column edge and the footer rule. The two lines of the drawing are
the site's two lines: what we run above, what we build for you below. If the drawing only lived
in the hero it would be an effect, and it would be cut.

## 5. Motion system

- One easing family (`--ease`, `--ease-out`, `--ease-in-out`), durations from `--dur-1…5`.
- Reveals: IntersectionObserver, `--reveal-shift` 14 px, stagger `--reveal-stagger`; never
  replay on scroll-up; no first-paint flash (elements start hidden only when JS is present).
- Page transitions: Astro `ClientRouter`, one quiet treatment (opacity + 4 px rise). No loader.
- Hover: primary targets move (arrow travels, inner label rolls, fill floods); utility links may
  only change colour. All hover rules inside `@media (hover: hover)`.
- Reduced motion: everything settles instantly; the static hero frame remains.

## 6. Acceptance checks (Phase 5)

- Static hero frame is a poster at 1440 px and 390 px.
- Pointer still for five seconds: the hero still breathes.
- Reduced motion: nothing moves, nothing hidden, no missing content.
- Keyboard: skip link first, every focus stop visible, menu traps focus and Escape closes.
- No horizontal overflow at 390 px; tap targets ≥ 44 px for primary actions.
- LCP < 2.5 s throttled, CLS < 0.05, JS < 40 KB.
- A fresh critic, seeing only screenshots, states the idea as "a studio that runs its own
  software and builds yours the same way" and scores ≥ 8 in every category.

## 7. Phase 6 cut list (remove one accessory)

Candidates, weakest first: the grain overlay if it reads as noise at 0.035; the `--ticks`
corner marks if a section already has a rule; the duplicate arrow on quiet buttons; the
second hover effect on product rows.
