# Upgrade Plan — sheatz studio portfolio

**Status:** plan complete, implementation not started (0 files modified beyond the existing 69 dirty WIP files).
**Date:** 2026-10-27
**Purpose:** full hand-off document. Everything a fresh agent needs: objective, constraints,
decisions already made, audit findings with `file:line`, phase-by-phase task lists, and the
verification chain.

> **Superseded in part (2026-10-31).** The hairline library was never shipped. The hero figure
> is now a first-party SVG delivery folio (`src/components/HeroFigure.astro`) whose build loop is
> CSS, driven by `src/scripts/hero-driver.ts`; the live-preview tier was removed entirely. §3a and
> the dependency budget below describe the plan as it was written, not as it was built — read
> `DESIGN.md` §4 and `docs/design-system.md` for what exists.

---

## 1. Objective

Make the site **fully production-ready**, fix **all UI/UX issues**, replace the hero's
hand-drawn two-developer SVG (`HeroSketch.astro`) with a **hairline animation**, and elevate
the site to an **award-winning standard** (target: ≥8/10 in every Awwwards QA category).

## 2. Hard requirements & constraints

- **No invented content.** No fake legal copy (privacy/terms), no real contact details, no
  invented metrics/clients/testimonials. `scripts/build.mjs` enforces this: it fails the build
  on `PLACEHOLDER|lorem ipsum|TODO` and claim phrases like "trusted by", "award-winning".
  (Note: `example.com` and `hello@example.com` currently slip past this guard — they are
  placeholders awaiting user-supplied values, see §9.)
- **Stack stays Astro 7 + the existing CSS/token system.** No redesign from scratch. Per the
  awwwards skill's rule for existing projects: *keep the framework and styling, port only the
  engine pieces you need*.
- **Where the awwwards skill's generic-avoid list conflicts with this repo's own 58 anti-slop
  gates (`scripts/gates.mjs`), the project's gates win.** They are the site's law and they are
  testable. The deliberate editorial identity — eyebrows, mono labels, acid accent, light
  theme — is protected. Do not "simplify" it away.
- **CSP is hash-based** — no `unsafe-inline`, no `unsafe-eval`. New client behaviour must ship
  as bundled Astro modules (auto-hashed), never inline `<script>`.
- **JS budget is law:** `scripts/perf.mjs` → `BUDGETS.totalJsKb = 40`. Current usage ~28 KB
  with GSAP. Any new dependency (Lenis ~10 KB gz, hairline) must fit the measurement, or it
  doesn't ship.
- **No fake loader.** SSR pages arrive fast; a pretend loader would be dishonest and the
  gates would rightly call it slop. Continuity comes from the hero intro choreography and
  Astro `ClientRouter` page transitions instead.
- **e2e must stay green:** `tests/e2e/site.spec.ts` asserts CSP, SEO, a11y basics,
  internal-link crawl, mobile (Pixel 5).

## 3. Baseline (verified before planning)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm test` (unit) | ✅ 127/127 |
| `npm run build` | ✅ "Build verified: dist written 0s ago, no placeholders." |
| Working tree | **69 dirty files, uncommitted** — a prior-session restructure in flight (`creations/`→`work/`, `studio.astro` deleted, new `products/` + `services/` routes, `migrations/0002`, `scripts/gates.mjs`) |

## 4. Decisions already made (do not re-litigate)

| Decision | Choice | Reason |
|---|---|---|
| Hero animation style | **hairline** (`@lucasmarkes/hairline`, MIT, ESM, zero deps, per-figure modules) | user chose hairline over ASCII |
| Award-winning path | **awwwards skill**, ported as an elevation pass, not a redesign | existing identity already far from generic-AI slop |
| Continuity | hero intro choreography + Astro `ClientRouter` | no fake loader; no SPA rewrite |
| Lenis (smooth scroll) | **measure first** — keep only if `npm run perf` stays inside budget | 40 KB budget with ~28 KB used |
| Hairline mount | only on `pointer: fine` + non-reduced-motion; static composed frame otherwise | a11y + touch |
| Hero scope | `src/pages/index.astro`, `src/styles/components.css`, `src/components/HeroSketch.astro`, `docs/design-system.md:412` | no e2e/gate script pins `.hero-sketch` |
| Workflow | plan → **Build agent executes Phase 0 first** | untracked-but-imported files mean a fresh clone doesn't build |

---

## PHASE 0 — Checkpoint commit

**Why first:** `src/scripts/motion.ts`, `src/components/HeroSketch.astro`,
`src/components/ProductsMore.astro`, `public/no-js.css` are **untracked but imported** — a
staged-only or partial commit leaves the repo unbuildable from a fresh clone.

```bash
git add -A && git commit -m "wip: restructure routes (work/products/services), motion system, hero sketch"
```

---

## PHASE 1 — Production-readiness blockers (P0, design-independent — do first)

All backend/security/config. Complete and verify before touching any design work.

- [ ] **`src/pages/products/[slug].astro:54`** — null deref returns **500 instead of 404**.
      Guard like `src/pages/work/[slug].astro:85-120`. Add an e2e test.
- [ ] **`src/pages/api/admin/session.ts:86`** — sign-out sets `Path=/admin` (wrong path →
      cookie never clears). Use the helper `clearCookie()` in `src/lib/admin-auth.ts:131-135`.
- [ ] **`src/pages/api/cron/preview.ts`** — dispatch endpoint has **no authentication**.
      Add auth, and fix the **never-firing cron** (the Cloudflare adapter has no `scheduled`
      handler wired).
- [ ] **`scripts/build.mjs`** — **purge `dist/server/.dev.vars` secrets** from the build output.
- [ ] **Build-time env** — `/contact`, `/privacy`, `/terms`, `/404` are prerendered and
      currently ship `https://example.com` canonicals; Turnstile breaks all submissions once a
      real secret is set. Wire `PUBLIC_SITE_URL`/Turnstile env at build time.
- [ ] **`src/pages/sitemap.xml.ts:59`** — sitemap hole: published projects without a case
      study are missing. Add them.
- [ ] **Silent D1 failures** — add `console.error` to `.catch(() => [])` reads (6 sites) and to
      the **missing catch** at `src/pages/services/[slug].astro:22`.
- [ ] **`src/lib/dispatcher.ts:38-49`** — stale `running` jobs are never reclaimed. Add a
      reclaim/failover.
- [ ] **`scripts/generate-og.mjs:45`** — stale OG text says "creations" (route renamed to
      `work/`).

---

## PHASE 2 — Concept & art direction (awwwards skill Phases 0–2)

Read these skill references before writing (base dir
`/home/arka/.config/opencode/skills/awwwards/references/`): `concepts.md`, `art-direction.md`,
`typography.md`, `layout.md`, `engine.md`, `motion.md`, `patterns.md`, `astro.md`,
`quality-bar.md`.

Output: **`DESIGN.md`** at repo root.

1. **Brief** — two-person software studio; the site's job is to get commissioned. The concept
   anchor is already on the page: *the products-vs-commissions split, enforced in SQL*. Three
   concepts from **different territories**, scored on originality / fit / feasibility /
   portability; pick one with a one-line reason.
2. **Concept Card** — idea, metaphor, **signature moment** (the hairline hero is the candidate:
   pointer + scroll progress as the single driver), motion verb, emotion, screenshot frame.
3. **Art direction** — refine the existing token palette into 4–6 named roles; per-size display
   tracking; section rhythm variety (one rule for what repeats, one for what varies); one
   radius rule; ASCII wireframe per section; run the **genericness test**.
4. **Conflict rule** (repeat of §2): awwwards' generic-avoid list yields to the repo's gates.

---

## PHASE 3 — Signature build (awwwards Phase 3, scoped)

### 3a. Hairline hero (the concept's signature)

- [ ] `npm i @lucasmarkes/hairline`
- [ ] New component **replacing `src/components/HeroSketch.astro`**; mount via
      `src/pages/index.astro` (`<HeroSketch />` at :144).
- [ ] **Remove the `.hs-*` CSS family** from `src/styles/components.css:1910-2040`.
- [ ] **One driver module** — pointer position + scroll progress mapped to *both* the figure
      and the hero type, so everything on screen agrees.
- [ ] **Idle motion** so the concept breathes at rest.
- [ ] **Kill switches**: reduced-motion and `no-motion` fully stop the animation; touch/JS-off
      get the static composed frame.
- [ ] Fix the dead `.product-card` hero target in `src/scripts/motion.ts:157`.
- [ ] Update `docs/design-system.md:412` (HeroSketch entry).
- [ ] Check `npm run perf` — the JS budget decides Lenis (keep only if total stays ≤40 KB;
      otherwise native scroll).

### 3b. Continuity & transitions

- [ ] Hero intro choreography on first paint.
- [ ] Astro `ClientRouter` page transitions with **one quiet treatment** (no SPA rewrite).

---

## PHASE 4 — UI/UX fix sweep

Execute with `DESIGN.md` as the reference so fixes land on the new rhythm.

**Layout / missing CSS**
- [ ] Missing styles: `.hero__actions`, `.hero__meta-*`, `.lede-para`, `.pointer__note`,
      `.filters__chip`
- [ ] `/work?kind=` chips must **actually filter** (currently inert)
- [ ] Work-grid tablet collapse; case-study plate overlay <640px; mobile menu sheet vs the
      4.25rem header; `scroll-padding-top`; double seam
- [ ] `ProjectCard` `sizes`; 404 nested section

**Typography**
- [ ] Newsreader 300/500 declarations are no-ops — either load the weight file or drop them
- [ ] Inverted case-title hierarchy; contact `h1` cap; about prose size; contact aside `h2`s
- [ ] Section-head shape unification

**Components / consistency**
- [ ] `aria-labelledby` mismatches; skip-link z-index (100 vs 300)
- [ ] Turnstile `data-theme="dark"`; recursive callback at `src/pages/contact.astro:275`
- [ ] Copy-email aria + keyboard support; duplicated script
- [ ] Hover styles missing `@media (hover:hover)` guard
- [ ] Admin focus outlines; admin "View" link → 404
- [ ] Services 404 shape; price fallbacks; hardcoded `Platform="Mobile"`

**Dead code (remove)**
- [ ] `src/components/Metrics.astro` and `src/components/SpecSheet.astro` + their CSS families
- [ ] Dropped `ProjectCard` dynamic `<style>`

**Motion polish**
- [ ] First-paint flash; baked inline styles; `will-change` on `.word`; grain blend layer;
      reveal inconsistencies

---

## PHASE 5 — Double QA loop

Two independent loops; **neither substitutes for the other**.

### 5a. Awwwards QA on the production build

- [ ] `node $SKILL/scripts/shoot.mjs --crawl` (desktop / mobile / reduced-motion / keyboard /
      hover frames, vitals, axe, FPS, idle-motion)
- [ ] `node $SKILL/scripts/audit.mjs`
- [ ] **Read every screenshot.**
- [ ] **Fresh critic subagent** — never shown `DESIGN.md` or the code — scores Design /
      Usability / Creativity / Content from screenshots alone. Iterate its fix list until
      **≥8 in every category**.

### 5b. The repo's own chain

```bash
npm run verify   # typecheck → unit → build → e2e → perf → qa → 58 gates
```

Must be fully green.

---

## PHASE 6 — Ship pass (awwwards Phase 5)

- [ ] Final **"remove one accessory"** cut — drop the weakest decorative effect.
- [ ] Regenerate the OG image.
- [ ] Docs: fix README's **"No client-side JavaScript"** claim; cron/deploy doc drift;
      document `wrangler deploy -c dist/server/wrangler.json`.
- [ ] Hand over the placeholder / assumption list (§9) to the operator.

---

## 7. Verification quick reference

```bash
npm run typecheck   # TS
npm test            # unit (baseline 127/127)
npm run build       # SSR build + placeholder guard
npm run perf        # budgets: LCP 2500ms, CLS 0.05, JS 40KB, thirdPartyRequests 0
npm run verify      # full chain incl. e2e, qa-matrix, 58 gates
```

Note: `thirdPartyRequests: 0` **will break once Turnstile is enabled** — expected, adjust the
budget knowingly when that happens.

## 8. Key files

| File | Why it matters |
|---|---|
| `src/pages/index.astro` | hero mount point (`<HeroSketch />` :144) + nine home sections |
| `src/components/HeroSketch.astro` | the SVG being replaced (untracked) |
| `src/styles/components.css` | `.hero__grid` :1836, `.hero-sketch`/`.hs-*` :1910-2040, most UI defects |
| `src/styles/tokens.css`, `global.css`, `fonts.css` | palette / type system |
| `src/scripts/motion.ts` | reveal system, hero timeline (dead `.product-card` :157), scroll progress |
| `src/lib/admin-auth.ts` | `sessionCookie()` :122, `clearCookie()` :131-135 |
| `src/pages/api/admin/session.ts` | broken sign-out :86 |
| `src/pages/api/cron/preview.ts` | unauthenticated dispatch endpoint |
| `src/pages/products/[slug].astro` | null deref :54 |
| `src/lib/dispatcher.ts` | stale `running` job reclaim :38-49 |
| `src/pages/sitemap.xml.ts` | hole :59 |
| `src/pages/contact.astro` | recursive Turnstile callback :275 |
| `scripts/build.mjs`, `perf.mjs`, `gates.mjs`, `qa-matrix.mjs`, `generate-og.mjs` | build/budget/gates/OG |
| `tests/e2e/site.spec.ts`, `tests/unit/*.test.ts` | test surfaces |
| `/home/arka/.config/opencode/skills/awwwards/references/` | skill knowledge base |

## 9. Needs operator input (do not invent)

- [ ] **Privacy / terms policy text** — visible TODO Checklists ship on those pages today.
- [ ] **Identity placeholders** — `hello@example.com`, `example.com` (see `src/config/site.ts`).
- [ ] **GBP price currency** assumption — confirm the studio quotes in GBP.
- [ ] **D1 `database_id`** in the Cloudflare config.
- [ ] `PUBLIC_SITE_URL` for canonical URLs and Turnstile at build time (Phase 1).
