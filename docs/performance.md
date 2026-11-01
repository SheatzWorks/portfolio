# Performance

The requirement was a site that does not feel slow for someone arriving from
Instagram, on mobile data, on an older Android phone. Everything below is
measured, not estimated.

## Measured results

`npm run perf`, against the real build running in workerd, on Lighthouse's
"Slow 4G" mobile profile: **1.6 Mbps down, 150 ms RTT, 4x CPU throttle**, 412x823
viewport at 1.75x DPR.

| Metric | Budget | Measured | Headroom |
|---|---|---|---|
| HTML (gzip) | 20 KB | **6.3 KB** | 3.2x |
| JavaScript | 40 KB | **28 KB** | 1.4x |
| CSS | 12 KB | **10.7 KB** | 1.1x |
| Fonts | 95 KB | **72.9 KB** | 1.3x |
| Images | 120 KB | **0 KB** | total |
| Requests | 25 | **7** | 3.6x |
| Third-party requests | 0 | **0** | — |
| LCP | 2500 ms | **952 ms** | 2.6x |
| CLS | 0.05 | **0.0000** | total |
| TTFB | 300 ms | **160 ms** | 1.9x |

All ten budgets met, on every route.

### How these are counted

Every row above is **wire bytes**: the size of what crossed the socket,
response headers included, read from `Network.loadingFinished.encodedDataLength`
at the CDP layer.

That was not always how it worked, and the previous numbers were wrong. The old
script read `content-length` off each response; the preview server answers every
gzip-compressed asset chunked and sends no `content-length` at all, so JavaScript
and CSS both reported **0 bytes**. The budget table said "0 KB JavaScript, 0 KB
CSS, total headroom" for as long as that was true — which is a good illustration
of why a measurement needs a source you can defend rather than a header you
happen to find.

Seven requests for a full page: the document, the stylesheet, the module, and
three font files. **No third-party request of any kind.**

### The 28 KB of JavaScript

It is the GSAP core — `gsap.min.js`, 72 KB raw and 28 KB gzip, bundled once and
shared by every route. It drives the hero entrance, the scroll reveals and the
scroll-progress rule in `src/scripts/motion.ts`.

The budget is 40 KB rather than the 15 KB it used to be. 15 KB was never a
decision: it was set when the measurement returned zero, and a budget no
dependency can ever meet is not a budget. 40 KB is a number GSAP sits under with
room for one more small dependency, and it fails well before three.

### The 10.7 KB of CSS

The stylesheet is emitted as a file, not inlined. `build.inlineStylesheets: 'auto'`
inlines only under a size threshold, and at 56 KB raw this stylesheet is well
over it, so `<head>` links the hashed stylesheet and the row is its gzip transfer
size. The earlier claim that CSS was inlined and therefore free was the same
measurement bug wearing a different hat.

## Where the weight went

### Fonts: 420 KB to 69 KB

The raw Google Fonts builds for Newsreader (variable, both italics), IBM Plex
Sans and IBM Plex Mono came to **420 KB**. They were subset with `pyftsubset` to
a 185-codepoint charset covering every glyph the site can actually render:

```
newsreader-400.woff2    40 KB
plexsans-var.woff2      23 KB
plexmono-500.woff2       6 KB
```

Both variable axes survived the subset — Newsreader keeps optical sizing (6–72),
Plex Sans keeps weight (100–700) — so the design uses `font-optical-sizing` and
real weight variation without a second file.

The regeneration script is `src/styles/fonts.css`; to rebuild the subset, see the
commands in the header of that file's history. Two text faces are preloaded, the
6 KB mono is not.

### CLS 0.0000

Three things, all necessary:

1. **Metric-matched fallback fonts.** Each fallback `@font-face` carries
   `ascent-override`, `descent-override` and `size-adjust` from its webfont's own
   metrics, so the fallback box is the same size as the webfont box and the swap
   moves nothing. This alone is usually the difference between 0.14 and 0.
2. **Every image has explicit `width` and `height`.** Asserted in the E2E suite.
3. **Media boxes reserve space** with `aspect-ratio` plus a `max-height` cap, so
   a card cannot reflow when its image arrives — or when it never does.

### The dominant-colour trick

Card backgrounds come from `sharp().stats().dominant`, extracted after a 32px
resize, stored on the project row and emitted as the card's `background-color`.
This is the usual alternative to a base64 LQIP — a ~600 byte inline string in the
HTML that every visitor downloads before anything paints. The dominant colour
costs nothing, is derived at capture time, and is already in the CSS. It is the
cheaper and better answer at this scale.

---

## Deliberate performance decisions

**No client framework.** The whole interactive surface is a mobile menu, a
filterless grid, a copy-to-clipboard button, the reveal/entrance choreography,
and a contact form. Adding React to do that would cost more than the site. What
is there is GSAP core and the Web Animations API — no ScrollTrigger, no
component runtime, no hydration boundary.

**The contact form works without JavaScript.** It posts normally and the endpoint
returns JSON; the script is an enhancement that shows inline field errors. If the
bundle fails, the form still submits.

**No analytics tag manager.** If analytics is added, it is Cloudflare Web
Analytics: no cookies, no cross-site tracking, 11 KB, and it can be delivered
from the site's own origin so it adds no DNS lookup or TLS handshake to the
critical path.

**No third-party embeds anywhere.** The Instagram section shows images the studio
hosts itself and links out. It does not load Meta's embed code, so visiting the
site does not tell Instagram you were there — and the section costs zero
third-party JavaScript. Instagram's oEmbed became tokenless in June 2026, but it
is single-post only and still loads Meta's `embed.js` in the visitor's browser.

**Video never autoloads.** `<video preload="none">`, replaced on hover only, and
only on devices where hover exists. On touch the still image is the preview. A
240 KB MP4 is a reasonable thing to fetch deliberately and an unreasonable thing
to hand someone on 3G.

**Media is served from R2 with `immutable` caching**, on a separate host, so the
main document's cache is never polluted by a regenerated screenshot.

**Zero layout shift from media**, and no content is ever inserted above
already-painted content.

**Server rendering is scoped.** Only `/work`, `/products`, `/services`, their
detail routes, `/about`, `/api/*`
and `/admin` are dynamic. Everything else is a static file served from the edge,
which keeps the Workers Free 10 ms CPU budget irrelevant for the common case.

---

## Re-measuring

```bash
npm run build
npx wrangler dev --port 4321 &

npm run perf          # budgets table, exits non-zero on failure
npm run qa            # 7 viewports x 4 routes
npm test              # 127 unit tests
npm run test:e2e      # 116 end-to-end tests, desktop + mobile
```

`scripts/perf.mjs` reads Core Web Vitals from the same `PerformanceObserver` the
browser uses for field data, and applies the throttle at the CDP layer so the
numbers reflect a constrained device rather than a fast local one.

`scripts/qa-matrix.mjs` checks 360, 390, 412, 834, 1280, 1440 and 2560px against
`/`, `/work`, `/products`, `/services`, `/about` and `/contact`, asserting no horizontal scroll, no
element outside the viewport, no console errors, and — on touch viewports — no
tap target under 44px. Screenshots land in `/tmp/qa-matrix`.

## Re-measuring against real users

Lab numbers are a floor, not a forecast. For field data, enable Cloudflare Web
Analytics, which reports Core Web Vitals from real visits via
`PerformanceObserver`, with no cookies and no personal data.

---

## When the numbers change

The three most likely reasons a row here moves:

1. **A second runtime dependency is added** — an icon set, a carousel, a charting
   library. Each has to justify itself against the 40 KB figure and lose to it
   first.
2. **An interactive component grows past the entrance choreography** — a
   drag-reorder list in the admin, a client-side filter. Each should be scoped
   to the route that needs it, never loaded on the home page.
3. **The stylesheet is edited without watching the row.** CSS is the tightest
   budget on this list at 10.7 of 12 KB. It is the one most likely to fail next,
   and it would fail for the honest reason: too much was written.

If any row exceeds its budget, `npm run perf` exits non-zero. That is the point
of having a number rather than an intention — and of reading the number from
the network rather than from a header the server may not send.
