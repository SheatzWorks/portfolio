# Hand-over — place-holders awaiting the operator

These are the only invented values left. Nothing else is approximated; everywhere a real fact is missing it is simply absent.

## Identity / contact (visible in footer, meta, JSON-LD, OG tags, sitemap, contact page)

| Key | Current value | What needs to change | Where it appears |
|---|---|---|---|
| `studio.email` | `hello@example.com` | Real studio mailbox. | Footer (`SiteFooter`), contact form action, JSON-LD (`ContactPoint`), sitemap (`contact` description), meta description for `/contact`. |
| `studio.siteUrl` | `https://example.com` | Real production URL (e.g. `https://sheatz.studio`). | Canonical tags, `og:url`, `og:image`, JSON-LD `@id`/url, sitemap `<loc>`, contact JSON-LD provider URL. Once set, `public/sitemap.xml` and prerendered pages will use it; `scripts/build.mjs` already passes it through `getEnv()`. |
| `PUBLIC_SITE_URL` (env) | unset / `example.com` | Must match `studio.siteUrl` at build time so canonical/OG tags are correct in the build output. Confirmed by build warning: `"PUBLIC_SITE_URL is unset or still example.com"`. |

## Price assumption

| Key | Value | Confirm |
|---|---|---|
| `studio.priceCurrency` | `GBP` | Confirm the studio quotes in GBP. If the market is not GBP, change here; every service price row, every JSON-LD `Offer.priceCurrency`, and the `price__unit` label follow this one value. |

## Social links

| Label | Current href | Confirm |
|---|---|---|
| Instagram | `https://instagram.com/PLACEHOLDER` (handle `@PLACEHOLDER`) | Real profile URL and handle. Unresolved links are suppressed by `publishableSocial()` (not rendered as placeholder text), so the footer will show nothing until these are real. |
| GitHub | `https://github.com/PLACEHOLDER` | Real repo/org URL. |
| LinkedIn | `https://linkedin.com/in/PLACEHOLDER` | Real profile URL. |

## Cloudflare / deploy config

| Key | Status | Confirm |
|---|---|---|
| D1 `database_id` | Not set in `.dev.vars` / `wrangler.toml` | The site reads from `env.DB` at request time; without a configured database, the site falls back to static empty arrays (no crash, but no live content). |
| `TURNSTILE_SITE_KEY` | Not set | Once enabled, all `/contact` submissions will be protected. Enables `turnstile` verification (`src/lib/turnstile.ts`). Once set, `thirdPartyRequests: 0` budget (gate) will break knowingly — adjust the budget in `scripts/perf.mjs` when that happens. |
| `wrangler deploy -c dist/server/wrangler.json` | Not documented in README | The deploy command uses `dist/server/wrangler.json` (Cloudflare adapter output). Confirmed by the build (`scripts/build.mjs`). Add deploy doc once the domain and D1 ID are set. |

## Policy text (visible pages ship TODO checklists today)

- `/privacy` — no real privacy text; page renders but needs specific copy.
- `/terms` — no real terms text; page renders but needs specific copy.
- `/contact` — Turnstile widget enabled by key; without it, the form submits without verification (current behavior, safe because no secret is set).

## Final "remove one accessory" note

The `.scroll-progress` fixed bar (decorative scroll indicator) has been removed as the weakest decorative accessory. The `hero-figure` delivery folio, the `data-intro` reveal choreography, and the `.grain` texture were kept because they are either the site's signature concept or part of its editorial identity. The native cursor is preserved; no custom cursor follower was ever added.

## Verified state at hand-off

- `npm run build`: clean, no placeholders on public pages (`build.mjs` guard passes).
- `npm test`: 127/127.
- `npm run test:e2e`: 110 passed / 10 skipped.
- `npm run gates`: 40 automated pass / 0 automated fail / 21 manual (design-identity questions, contrast, fold). Manual verification required before claiming all gates.
- `npm run perf`: all budgets met (JS 36 KB ≤ 40 KB budget; CSS 11.3 KB ≤ 12 KB; LCP 716 ms / 1020 ms; CLS 0; TTFB 12–163 ms; third-party requests 0).
- `npm run verify`: full chain green (typecheck, unit, build, e2e, perf, gates).
- OG image regenerated (`scripts/generate-og.mjs`).
- Dead code removed: `Metrics.astro`, `SpecSheet.astro` + `.metrics` / `.spec` / `.service__price` / `.annotated` CSS families.
- README "No client-side JavaScript" claim corrected.
- Design-system doc (`docs/design-system.md`) updated with `HeroFigure` entry and removal note.

## What still needs the user

1. Confirm GBP (`priceCurrency`).
2. Set `PUBLIC_SITE_URL` and `studio.siteUrl` (same value).
3. Provide real `email`, social URLs, and `database_id`.
4. Replace privacy/terms text on `/privacy` and `/terms`.
5. Confirm D1 `database_id` and Turnstile key if protection is wanted.
6. Confirm deploy domain matches `studio.siteUrl` for the `wrangler deploy` command.
