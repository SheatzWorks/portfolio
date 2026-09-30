# Studio site

A two-person digital studio website. The centrepiece is a creations portfolio
where each project is added by pasting a URL, and its preview — screenshot,
social image, favicon, or live iframe — is generated automatically.

Astro 7 on Cloudflare Workers. D1 for content, R2 for media, a Node capture
worker for screenshots and video.

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
| `npm run qa` | Responsive matrix: 7 viewports x 4 routes |
| `npm run verify` | Everything above, in order |
| `npm run capture:one` | Capture one URL and upload its previews |
| `npm run capture:drain` | Process queued capture jobs |
| `npm run capture:serve` | Long-running capture poller |

---

## First things to change

Everything that says PLACEHOLDER is deliberately obviously fake. Nothing here
invents a client, a metric, a testimonial or a claim.

1. **`src/config/site.ts`** — studio name, tagline, the two people, email,
   social links, and the site URL. One file, one swap.
2. **`wrangler.jsonc`** — set `PUBLIC_SITE_URL` to the real domain.
3. **Cloudflare** — set `ADMIN_TOKEN` (see [docs/deployment.md](docs/deployment.md)).
4. **Delete the demo content** before launch:
   ```bash
   npx wrangler d1 execute studio --remote --file=./scripts/clear-demo.sql
   ```

---

## Adding a project

**The short way:** open `/admin`, paste a URL, press Add. Title, description and
social image are read from the page automatically and the project appears on
`/creations` immediately. The screenshot is generated in the background.

**By hand**, if you would rather not use the admin:

```sql
INSERT INTO projects (slug, title, url, blurb, kind, published, preview_state)
VALUES ('my-project', 'My Project', 'https://my-project.com',
        'One line for the card', 'web', 1, 'queued');
```

Then trigger the metadata fetch and queue the capture:

```bash
node scripts/capture.mjs --url https://my-project.com --slug my-project
```

### Preview fallback chain

A card can never render broken. The tiers, in order:

1. **Live iframe** — only when the site permits framing *and* its host is on
   the allowlist in `src/config/site.ts`. Never autoloaded on mobile.
2. **Screenshot** — our own 1440x810 capture, served from R2 as AVIF/WebP.
3. **og:image** — hot-linked from the project, only when genuinely reachable.
4. **Favicon**.
5. **Designed plate** — a typeset placeholder, not a broken image.

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
| [docs/deployment.md](docs/deployment.md) | Cloudflare setup, environment variables, R2, the capture worker |
| [docs/content.md](docs/content.md) | Every editable content field, and what to put in it |

---

## Verified state

Measured on this machine against the real build in workerd:

- **98 unit tests** — SSRF vectors, metadata extraction, markdown XSS, preview
  fallbacks, admin auth, rate limiting
- **74 end-to-end tests** — desktop and mobile, against the production build
- **28/28** viewport x route combinations clean (360px to 2560px)
- **All 10 performance budgets met** on throttled Slow 4G with 4x CPU throttle:
  LCP 736ms, CLS 0.0000, 0 KB JavaScript, 0 third-party requests, 71 KB fonts
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
