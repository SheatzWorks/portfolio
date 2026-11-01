# sheatz

A digital studio site for `sheatz`, a small studio with no sales team.

The centre of the site is a distinction it keeps making everywhere: **software it
built and runs itself** (`/products`) versus **software it was commissioned to
build** (`/work`). They are one `projects` table discriminated by an `ownership`
column, exposed as two routes, with the split enforced in SQL rather than in a
template.

Anything added by pasting a URL has its preview generated automatically —
screenshot, social image, favicon or a designed plate.

Astro 7 on Cloudflare Workers. D1 for content, R2 for media, a Node capture
worker for screenshots and video. Client-side behavior is a single bundled
GSAP module (`src/scripts/motion.ts`) for reveals, plus one tiny driver
(`src/scripts/hero-driver.ts`) that owns the hero's pointer and scroll numbers;
everything else — scroll, navigation, form submission — is native.

---

## What this site will not do

These are enforced by tests, not by convention. The failure mode being guarded
against is an LLM filling a stat-shaped layout with a number it invented.

- No invented metrics, clients, testimonials, awards or years of experience.
  `the site makes no claims it cannot support` fails the build if any public page
  contains "trusted by", "clients include", "award-winning", "10+ clients",
  "years of experience" or an unsourced percentage claim.
- No PLACEHOLDER text in the public output. `scripts/build.mjs` scans the built
  HTML, JSON-LD and sitemap and fails the build if one reaches a page body.
- No personal identities. There is no team section, no founder copy and no
  `Person` node in the structured data.
- Unfinished work is labelled, not hidden and not over-claimed. `product_status`
  is published, and the products listed here are honestly `In development`.
- Every internal link resolves, and no link points at a removed route.

---

## Quick start

```bash
npm install

# Local database with the schema applied
npm run db:migrate:local

# Optional: demo content so the grid, filters and case studies can be seen.
# Local only. Never run this against the remote database — see scripts/seed.sql.
npm run db:seed:local

npm run dev
```

`npm run dev` runs the Vite dev server. For anything that tests the real build
output, the real CSP, or the real headers, use the preview:

```bash
npm run build
npx wrangler dev --port 4321
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Generates the OG image, then builds |
| `npx wrangler dev` | Runs the real build in workerd, with D1/R2 bindings |
| `npm run db:migrate:local` | Applies migrations to the local D1 |
| `npm run db:migrate:remote` | Applies migrations to the remote D1 |
| `npm run db:seed:local` | Loads demo content locally |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run test:e2e` | End-to-end tests (Playwright, desktop + mobile) |
| `npm run perf` | Performance budget check against a running server |
| `npm run qa` | Responsive matrix: 7 viewports x 6 routes |
| `npm run gates` | 58 Hallmark anti-slop gates (see below) |
| `npm run verify` | Everything above, in order |
| `./restart-server.sh` | Restarts `wrangler dev` against the current `dist/` |
| `npm run capture:one` | Capture one URL and upload its previews |
| `npm run capture:drain` | Process queued capture jobs |
| `npm run capture:serve` | Long-running capture poller |

---

## First things to change

Everything that says PLACEHOLDER is deliberately obviously fake. Nothing here
invents a client, a metric, a testimonial or a claim.

1. **`src/config/site.ts`** — name, tagline, hero, closing line, email, social
   links, the price currency and the site URL. One file, one swap.
2. **`wrangler.jsonc`** — set `PUBLIC_SITE_URL` to the real domain.
3. **Cloudflare** — set `ADMIN_TOKEN` (see [docs/deployment.md](docs/deployment.md)).
4. **Contact form delivery** — create a Resend account with the Gmail address
   enquiries should land in, then set `RESEND_API_KEY`, `CONTACT_TO_EMAIL` and
   `CONTACT_FROM_EMAIL` with `wrangler secret put`. The Gmail-only path needs
   no domain: [docs/deployment.md](docs/deployment.md) → Contact form.
5. **Confirm `studio.priceCurrency`.** It is set to `GBP` as an assumption and is
   the one substantive value on this site that was not supplied. A bare
   `30,000 – 75,000` cannot be compared between two services, so it is rendered
   with its currency attached; change the one value and every range and every
   JSON-LD `Offer` follows.
6. **Unresolved social links are simply absent.** `publishableSocial()` filters
   placeholders out at the point of rendering, so an unresolved link is missing
   rather than being a link to nowhere. Fill them in and they appear.

Nothing needs deleting before launch: `scripts/seed.sql` is local-only demo
content and the remote database is untouched.

---

## Adding a project or a product

**The short way:** open `/admin`, paste a URL, press Add. Title, description and
social image are read from the page automatically and the item appears on
`/work` or `/products` immediately, depending on the ownership you pick. The
screenshot is generated in the background.

**By hand**, if you would rather not use the admin:

```sql
-- A commission
INSERT INTO projects (slug, title, url, blurb, kind, ownership, published, preview_state)
VALUES ('my-project', 'My Project', 'https://my-project.com',
        'One line for the card', 'web', 'client', 1, 'queued');

-- An own product, honestly labelled as unfinished
INSERT INTO projects (slug, title, url, tagline, ownership, product_status, published, preview_state)
VALUES ('my-product', 'my-product', 'https://my-product.com',
        'One line: what it is and what state it is in.',
        'own', 'in-development', 1, 'queued');
```

Then trigger the metadata fetch and queue the capture:

```bash
node scripts/capture.mjs --url https://my-project.com --slug my-project
```

---

## Adding a project

### Preview fallback chain

A card can never render broken. The tiers, in order:

1. **Screenshot** — our own 1440x810 capture, served from R2 as AVIF/WebP.
2. **og:image** — hot-linked from the project, only when genuinely reachable.
3. **Favicon** — shown as a logo treatment, not stretched into a photo strip.
4. **Designed plate** — a typeset placeholder, not a broken image.

Nothing is ever framed inside the site: there is no live iframe tier, no
framing probe and no allowlist to opt into.

Every tier is recorded on the project row, so a degraded preview is diagnosable
in the admin rather than being a mystery.

Full detail: [docs/preview-pipeline.md](docs/preview-pipeline.md).

---

## Documentation

| Document | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Why Astro, why Workers, why D1 jobs instead of Queues, the static/SSR split |
| [docs/design-system.md](docs/design-system.md) | Type, colour, grid, motion, and the slop patterns this design avoids |
| [docs/preview-pipeline.md](docs/preview-pipeline.md) | The four preview tiers and how to regenerate them |
| [docs/security.md](docs/security.md) | SSRF defence, CSP, admin auth, contact-form spam defence |
| [docs/performance.md](docs/performance.md) | Budgets, measured numbers, and how to re-measure |
| [docs/deployment.md](docs/deployment.md) | Cloudflare setup, environment variables, R2, the capture worker, contact-form delivery (including the Gmail-only path) |
| [docs/content.md](docs/content.md) | Every editable content field, and what to put in it |

---

## The anti-slop gates

`npm run gates` runs 58 gates from
[hallmark](https://github.com/)'s slop test against the real build and a running
server. It reports three states:

- **ok** — decided mechanically, with the evidence in the note.
- **FAIL** — a real problem, with the selector or route that caused it.
- **manual** — a question only a person can answer, stated rather than hidden.

Gates that need a human are not padding and are not silently counted as passes.
Answer them before calling the test done.

It has already caught real defects during the build: a `min-height` transition
(dead legacy header CSS), a literal `#c8ff5e` and a `color-mix` escaping the
token block, a hero whose CTA sat 30px below the fold at 1280x800, and
`.price__foot` mixing heights in a column flex.

The [Impeccable](https://github.com/) detector is also clean against `src/`:

```bash
node /home/arka/promo/skills/impeccable/cli/bin/cli.js detect ./src
```

---

## Verified state

Measured on this machine against the real build in workerd:

- **134 unit tests** — SSRF vectors, metadata extraction, markdown XSS, preview
  fallbacks, admin auth, admin sign-in lockout, rate limiting, contact delivery
- **110 end-to-end tests** — desktop and mobile, against the production build
- **42/42** viewport x route combinations clean (360px to 2560px)
- **40/40 automated design gates** pass, plus 21 that need a human eye
- **All 10 performance budgets met** on throttled Slow 4G with 4x CPU throttle:
  LCP 952ms, CLS 0.0000, 28 KB JavaScript, 0 third-party requests, 72.9 KB fonts
- **Typecheck clean** (`tsc --noEmit`), and a build guard that fails rather than
  leaving a stale `dist/` in place

---

## Requirements

- Node >= 22.12
- A Cloudflare account (Workers Free tier is sufficient for everything here)
- Optional: a machine to run the capture worker on (see
  [docs/deployment.md](docs/deployment.md))

### Disk note

`playwright` is pinned to an exact version. The Chromium revision must match, or
installing a different Playwright anywhere on the machine will re-download
~270 MB and delete the existing one:

```bash
export PLAYWRIGHT_SKIP_BROWSER_GC=1
npx playwright install chromium --only-shell
```

Never run a bare `npx playwright install` — it pulls Chromium, Firefox and
WebKit (~1.1 GB).
