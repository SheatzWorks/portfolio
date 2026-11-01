# Preview pipeline

The requirement: **paste a URL, get a good-looking project card.** No manual
thumbnail, no manual description, no waiting.

## The tiers

A card can never render broken. `resolvePreview()` in `src/lib/preview.ts` walks
these in order and guarantees a non-empty image URL and a valid background
colour, whatever state the pipeline is in.

| # | Tier | When it wins | Cost |
|---|---|---|---|
| 1 | Screenshot | The normal case | One capture, cached forever |
| 2 | og:image | Capture unavailable, or unnecessary | Hot-linked from the project |
| 3 | Favicon | Nothing better | Hot-linked, and shown as a logo treatment |
| 4 | Designed plate | Everything failed | Nothing |

There is no live tier. A third-party page is never rendered inside this site:
there is no `<iframe>`, no framing probe, and no allowlist to opt into. A
preview that loads someone else's document inside yours costs a second document
load, inherits their scripts and their layout, and breaks the moment they set
`X-Frame-Options` — a card whose image is a screenshot is both cheaper and more
honest about what it is showing.

## The split

The system cannot run entirely in a Cloudflare Worker:

- `sharp` is a native Node module and cannot load in a Worker isolate.
- There is no Chromium in a Worker.

So it is split across two runtimes, meeting at the `preview` JSON column:

```
                      ┌─────────────────────────────┐
   paste URL ────────▶│  Cloudflare Worker          │
                      │  · validate URL (SSRF)      │
                      │  · fetch HTML, parse og:    │
                      │  · write preview descriptor │
                      └──────────────┬──────────────┘
                                     │  R2 keys
                      ┌──────────────▼──────────────┐
                      │  Capture worker (Node)      │
                      │  · Playwright Chromium      │
                      │  · sharp → AVIF/WebP       │
                      │  · screencast → ffmpeg MP4  │
                      │  · upload to R2             │
                      └──────────────────────────────┘
```

The Worker half is `src/lib/metadata-pipeline.ts`. The Node half is
`scripts/capture.mjs`.

## Why this ordering

Metadata is fetched first because it is cheap and it decides whether a capture is
worth attempting at all:

- A site behind a bot challenge returns `403` with `cf-mitigated: challenge`. A
  Worker cannot solve that, so the pipeline stops and records why.
- A site that already hands over a good `og:image` does not need a browser at
  all.

Metadata is also what fills in the title and description, so a project added with
nothing but a URL appears with real text immediately.

## Image pipeline

One capture at **1440x810, device scale 2** produces:

| Variant | Format | Quality | Why |
|---|---|---|---|
| 480w | WebP | 74 | Mobile first load |
| 768w | AVIF + WebP | 52 / 74 | The primary card image |
| 1200w | AVIF + WebP | 52 / 74 | Tablet and small desktop |
| 1600w | AVIF + WebP | 52 / 74 | Large desktop |
| poster | WebP 1200 | 70 | Video poster frame |

**AVIF only from 768w up.** libvips encodes AVIF 10–30x slower than WebP, and
below 768 the saving does not pay for the build time. Variants are never
upscaled.

Measured output for a real 1440x810 screenshot of this site:

```
card-480.webp     2.9 KB
card-768.avif     4.9 KB
card-768.webp     5.8 KB
card-1600.avif   10.3 KB
```

**The dominant colour** is extracted with `sharp().stats().dominant` after a
32px resize, stored on the project row, and emitted as the card's
`background-color`. It costs nothing on the wire and it kills the
placeholder-flash problem completely — cheaper and better than shipping a
base64 LQIP in the HTML, which is what a mobile connection would have to
download before painting anything.

Because it is a per-project value it cannot live in a utility class, so each card
emits a scoped `<style>` block, which Astro collects and hashes into the CSP.
Inline `style` attributes are blocked by the site's own policy.

## Video previews

Off by default, and only available on the self-hosted capture path. The free
hosted capture tier has a session cap and no persistent browser to screencast
from.

The recording is deliberately **a portfolio preview, not a screen recording**:
the initial viewport, then one slow scroll across roughly sixty percent of the
page over about nine seconds. No mouse movement, no clicking, no waiting.

Two implementation details that matter:

- **Screencast frames are piped to the system ffmpeg, never to Playwright's
  `recordVideo`.** Playwright's is hardcoded to VP8 in a libvpx-only build with
  no quality controls, and renders UI text as noise. The system ffmpeg has full
  encoder support and the output is real H.264.
- **Frames are numbered by wall clock.** CDP screencast is variable rate — an
  idle page emits nothing — so gaps are back-filled by repeating the previous
  frame, and `-fps_mode passthrough` stops ffmpeg discarding the duplicates.

Result: `h264, 1440x810, 8.8s, 211 frames, 240 KB`.

Intermediates are written to `/tmp` and removed on both the success and the
failure path.

## Running it

```bash
# One project, capture and upload, no database write
node scripts/capture.mjs --url https://example.com --slug my-project --no-db

# With video
node scripts/capture.mjs --url https://example.com --slug my-project --video

# Process queued jobs
npm run capture:drain

# Long-running poller, for a self-hosted box
npm run capture:serve
```

Both `--no-db` and the defaults are explained by `--help` output from running
the script with no arguments.

## Storage

R2, behind a custom domain (`MEDIA_BASE_URL`). Two reasons: the site never
depends on the media host's cookies, JS or uptime, and R2 egress is free.

Keys are stable and content-independent:

```
projects/<slug>/card-480.webp
projects/<slug>/card-768.avif
projects/<slug>/poster.webp
projects/<slug>/preview.mp4
```

Stability matters: because a key does not change when a screenshot is
regenerated, the page never needs rebuilding to pick up a refreshed preview. All
variant responses are `immutable` for a year.

## Retrying and failure

`preview_state` moves through `queued → metadata → capturing → ready | partial |
failed`, and the admin shows it with the reason underneath.

- A bot challenge or an unsafe URL is **not retried** — it will not fix itself.
- A network failure retries with exponential backoff: 5m, 20m, 80m, capped at
  24h, three attempts, then `failed` and visible in the admin.
- A capture that fails but which produced usable metadata is recorded as
  `partial`, not discarded.

## Regenerating from the admin

Every row has **Re-capture**, which runs immediately rather than queueing,
because a human pressed the button and is watching. **The preview is never
regenerated on a page visit** — cached metadata and media are the point.
