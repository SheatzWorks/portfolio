# Architecture

## The decision that drives everything else

The brief's hard constraint is **speed on a mid-range Android arriving from
Instagram on a metered connection**. That single requirement decided the
framework, and it is worth being explicit about why.

Next.js 16 was the obvious candidate. It was rejected on two measured grounds:

- It unpacks to **184.7 MB** of `node_modules`, on a machine with limited disk.
- It ships **~80 KB of framework JavaScript** before a single line of site code
  is written.

Astro 7 ships **0 KB of JavaScript by default** and is **3 MB** unpacked. The
pages here are static HTML with a handful of small, CSP-hashed inline scripts
for progressive enhancement. Measured result: **0 KB of JavaScript on every
route**.

A third factor, discovered during implementation: Astro's image service can run
at **build time** with sharp, which means there is no image-optimiser runtime
and no per-transform billing. The Cloudflare adapter's default is the
`cloudflare-binding` mode, which requires a paid Images binding; `astro.config.mjs`
sets `imageService: 'compile'` to avoid it.

## Where things run

| Concern | Runs on | Why |
|---|---|---|
| Static pages (`/`, `/contact`, `/privacy`, `/terms`, `/404`) | Prerendered to files | Zero runtime cost, served straight from the CDN |
| `/work`, `/work/[slug]`, `/products`, `/products/[slug]`, `/services`, `/services/[slug]`, `/about`, `/api/*`, `/admin` | Cloudflare Worker | Must reflect a newly added project or price change immediately |
| Metadata extraction, SSRF filtering, job dispatch | Worker | Cheap, and Workers' egress cannot reach a tenant's private network |
| Browser capture, video recording, image processing | A separate Node process | `sharp` is a native module and cannot load in a Worker isolate; there is no Chromium in one either |

That last row is the important architectural discovery. The preview system
cannot live entirely in the Worker, so it is split:

- `src/lib/metadata-pipeline.ts` — Worker-safe. URL validation, metadata
  extraction.
- `scripts/capture.mjs` — Node-only. Playwright, screencast-to-video, sharp
  variant generation, R2 upload.

They meet at the `preview` JSON column on each project row. See
[preview-pipeline.md](preview-pipeline.md).

## Static and dynamic routes

Every content route is server-rendered because the brief requires a project or
a price change to appear **immediately** after it is saved, and a static build
would need a rebuild — a published price range that only appears at the next
deploy is worse than no price at all.

The home page was the one exception, kept static because it is the
LCP-critical route. It moved to `export const prerender = false` when the admin
gained product editing: the index renders products and prices from D1, and copy
that only refreshes at the next build contradicts the rule above. The cost is
measured — TTFB against a 300 ms budget in `scripts/perf.mjs` on every verify
run — and each of its five reads carries its own `.catch`, so a failed query
degrades one section rather than the page.

Still prerendered to static HTML: `/contact`, `/privacy`, `/terms` and `/404`,
whose content changes only when their source does, so a build costs them
nothing.

## Products and work are one table, two routes

`projects` holds both commissions and the studio's own products, discriminated
by `ownership` (`'client'` | `'own'`). A separate products table would have
duplicated the entire preview pipeline, the admin surface and the case-study
machinery to store seven extra columns.

`/work` lists `ownership = 'client'`; `/products` lists `ownership = 'own'` and
orders by lifecycle. The split is enforced in the SQL, not in the template — a
product slug returns 404 on `/work/[slug]`, and there is an E2E test asserting
exactly that, because a route split enforced only in markup is cosmetic.

`product_status` (`planning` → `retired`) is published rather than hidden. An
unfinished product listed as *In development* with the reason written out is
more credible than either hiding it until launch or over-claiming it.

## Why D1 jobs and not Cloudflare Queues

A two-person studio adds a handful of projects a month. Cloudflare Queues would
mean a second product to provision, a consumer to deploy, a dead-letter queue to
reason about, and a binding in two places — in exchange for durable retries that
a three-column D1 table already provides.

The `jobs` table has `state`, `attempts`, `run_after` and `last_error`, which is
the whole of what the dispatcher needs. Claims are conditional
(`UPDATE ... WHERE state = 'pending'`) so two concurrent cron invocations cannot
double-process a row.

**Upgrade trigger:** move to Queues when capture jobs start arriving faster than
one cron invocation can drain, or when the retry semantics need a DLQ. The
dispatcher is the only module that would change.

## Data model

D1, because it is relational, free at this scale, and binds directly to the
Worker with no connection management.

Content is stored as JSON text in columns rather than normalised tables. The
reasoning: link sets, credits, preview descriptors and gallery arrays are
read-only once written, always fetched whole, and never joined. Normalising
them would buy nothing and cost a dozen tables. All JSON is parsed through
`parseJson()` in `src/lib/db.ts`, which fails soft to a safe default — one
malformed row can never take down the index.

Every table has a `published` flag and ships empty. The site renders designed
empty states rather than fabricated content.

## Admin

A path-gated surface at `/admin`, authenticated by a bearer token exchanged for
an HttpOnly cookie. It is deliberately plain: server-rendered, one small fetch
call per action, no client framework.

The strong recommendation is to put **Cloudflare Access** in front of `/admin`
as well. The token layer is defence in depth, not a replacement for it — see
[security.md](security.md).

## Dependency choices

Every dependency has a reason, and several are deliberate *non*-choices.

| Package | Why | Rejected alternative |
|---|---|---|
| `astro` 7.3.5 | 0 KB JS, build-time images | Next 16 (185 MB, 80 KB JS) |
| `@astrojs/cloudflare` 14.3.3 | D1 + R2 + cron in one runtime | Running Node on a VPS |
| `sharp` 0.35.5 | Build-time AVIF/WebP, dominant colour | Cloudflare Images (paid per transform) |
| `cheerio` 1.2.0 | ~30 lines of og: parsing, no advisories | `metascraper` / `open-graph-scraper` (20–40 transitive deps) |
| `ipaddr.js` 2.5.0 | Correct handling of decimal, octal and IPv4-mapped IP encodings | A hand-rolled IPv4 regex |
| `resend` 6.31.0 | 3,000 emails/month free, idempotency keys | SMTP, Postmark (100/month) |
| `playwright-core` 1.63.0 | Pinned to the cached browser revision | `playwright` (bundles the test runner) |
| `@aws-sdk/client-s3` | R2 over the S3 API from Node | A Cloudflare-specific SDK |

Explicitly **not** used: an SSRF-filter package (`ssrf-req-filter` has been
unmaintained since 2024), a client framework, a CSS framework, an animation
library, an icon library, and any analytics tag manager. The site needs none of
them, and each would have cost bytes on the one page that has to load fast.

## A note on the build

`npm run build` runs `scripts/build.mjs`, which deletes `dist/`, builds, and
fails if the output is missing or stale.

This is not ceremony. `astro build` can **exit 0 while refusing to start**: an
invalid value in `astro.config.mjs` makes the config fail to load, and the
previous `dist/` is left sitting there untouched. Every subsequent test,
screenshot and performance number then runs against stale output and reports
success.

It happened here. A `script-src-elem` entry inside `security.csp.directives` is
rejected by Astro — those directives belong in `scriptDirective`/`styleDirective`
— and the build silently stopped producing anything for several iterations
before a stale mtime gave it away. A build that did not really happen must not be
able to report that it did.

The Turnstile host now lives in `security.csp.scriptDirective.resources`, and a
test asserts that no directive appears twice in the emitted policy.

## Captions on the discarded paths

Recorded because the reasons are not obvious and someone will otherwise suggest
them again:

- **Cloudflare Containers for the browser.** GA, but Workers-Paid only: about
  $26–35/month for a 4 GiB container held 24/7, ephemeral disk, and no runtime
  guarantee.
- **Vercel.** Free bandwidth, but the Hobby image optimiser caps at 5,000
  transforms/month, which a screenshot-heavy portfolio exceeds in a day.
- **A self-hosted `next lint`.** Astro 7 removed `next lint`; there is no
  equivalent and none is needed.
- **Full-site SSR.** Would put every request through the Workers Free 10 ms CPU
  budget for pages that never change.
- **`Astro.rewrite('/404')` from a dynamic route.** Tried, and it 500s: a
  prerendered route cannot be rewritten to from an on-demand one. The project
  page sets `Astro.response.status` and renders a shared `<NotFound />` instead.
- **`sharp` in the Worker.** A native module; cannot load in a Worker isolate.
  This is the reason the preview system is split in two, and the reason image
  processing lives in `scripts/capture.mjs` rather than in `src/lib/`.

---

## Source layout

```
src/
  components/      Project card, grid, section shell, empty state, nav, footer
  config/site.ts   Every real value. The one file to edit on day one.
  layouts/Base.astro  Everything in <head>: meta, OG, JSON-LD, font preloads
  lib/
    types.ts           Domain types, mirroring the schema
    db.ts              D1 access; every row is converted in one place
    env.ts             Runtime bindings, resolved once
    safe-fetch.ts      SSRF guard — the security boundary
    metadata.ts        og:/twitter:/favicon extraction
    metadata-pipeline.ts  Worker-safe half of the preview system
    preview.ts         The fallback chain; guarantees a renderable card
    markdown.ts        Safe renderer for database-sourced case-study copy
    capture.ts         Capture provider abstraction (hosted + local)
    dispatcher.ts      Job claiming, retry, backoff
    rate-limit.ts      Honeypot, token bucket, Turnstile verification
    admin-auth.ts      Constant-time token comparison, session cookies
  pages/
    index.astro        Home (SSR)
    work/              Commissioned work: index + case studies (SSR)
    products/          Own products: index + case studies (SSR)
    services/          Services with published ranges + detail (SSR)
    about.astro        How the studio works, no team section (SSR)
    contact.astro      Lead form (prerendered shell, /api/contact handles POST).
                       ?product=<slug> selects the product it came from; the
                       slug is validated against D1, never trusted as text.
    admin/             Sign-in and dashboard
    api/               contact, admin, cron
  styles/
    tokens.css         The design system, as variables
    fonts.css          Self-hosted faces with metric-matched fallbacks
    global.css         Reset, type scale, utilities
    components.css     Component styles
scripts/
  capture.mjs      The Node capture worker: Playwright + sharp + ffmpeg.
                   The single owner of the Node-side image work — there is
                   deliberately no `src/lib` equivalent, because sharp cannot
                   load in a Worker and a second implementation would drift.
  build.mjs        Build guard: deletes dist, builds, fails if output is stale
  generate-og.mjs  Build-time OG image
  perf.mjs         Performance budget check
  qa-matrix.mjs    Responsive matrix
  seed.sql         Demo content, local only
```
