# Security

## The real risk, stated plainly

This site fetches URLs a human typed into an admin form. That is a
server-side request forgery surface, and it is the part of this project where a
casual implementation would be dangerous.

There are two operations:

1. **Fetch the page** for its metadata. Runs in the Cloudflare Worker.
2. **Render the page in a browser** for a screenshot. Runs in the capture worker.

The second is by far the more dangerous, and it is safe here **by architecture**:
a hosted capture provider's browser runs inside the *provider's* network, not
ours. It cannot reach Cloudflare D1, R2, or any internal service, whatever
instructions the page gives it. The exposure reduces to operation one, which is
an ordinary `fetch` and is filtered accordingly.

## `safeFetch`

`src/lib/safe-fetch.ts`. Every rule below is covered by a test in
`tests/unit/safe-fetch.test.ts`.

### What it rejects

| Vector | Example | Result |
|---|---|---|
| Non-HTTP schemes | `file:///etc/passwd`, `javascript:`, `data:` | rejected |
| Embedded credentials | `https://user:pass@host` | rejected |
| Loopback | `http://localhost`, `http://127.0.0.1`, `http://[::1]` | rejected |
| Cloud metadata | `http://169.254.169.254`, `metadata.google.internal`, `instance-data` | rejected |
| RFC1918 | `10/8`, `172.16/12`, `192.168/16` | rejected |
| Link-local | `169.254/16` | rejected |
| CGNAT | `100.64/10` | rejected |
| IPv6 equivalents | `::1`, `fe80::/10`, `fc00::/7` | rejected |
| Internal DNS suffixes | `.local`, `.internal`, `.corp`, `.home.arpa` | rejected |
| Bare intranet names | `http://router/` | rejected |
| Raw IP literals | `http://10.0.0.1/`, `http://2130706433/`, `http://0177.0.0.1/`, `http://127.1/`, `http://[::ffff:127.0.0.1]/` | rejected |
| Non-allowlisted hosts | anything, when an allowlist is configured | rejected |

The encodings in that table are the point. Decimal, octal, short-form and
IPv4-mapped IPv4 are exactly what a hand-rolled regex misses. `ipaddr.js` is used
rather than a regex because its `range() === 'unicast'` check covers all of them
at once, and it unwraps `::ffff:` addresses before checking.

### Redirects

Followed manually, capped at three, and **each hop is fully re-validated** with
`redirect: 'manual'`. A public host cannot bounce us to `169.254.169.254` and
slip past the check, because the `Location` header goes through the same
validator as the original URL.

### Response limits

- Body capped at 2 MB, aborted mid-stream rather than buffered.
- Total elapsed time capped at 10s.
- Redirects capped at 3.

### The DNS rebinding caveat, stated honestly

The common pattern `assertPublic(url) → dns.lookup → fetch(url)` is **broken**.
`fetch` resolves DNS again independently at socket-open time, so a hostname
with a ~0s TTL can return a public address to the check and
`169.254.169.254` to the connection. This is a documented, practically-exploited
class of bug.

It cannot be fully closed from inside a Cloudflare Worker: there is no
custom-connector hook in the runtime's `fetch` to pin a validated address, and
undici's DNS-filter proposal is still open upstream. Three things compensate:

1. **Egress control.** Worker egress cannot reach a tenant's private network,
   and Cloudflare's own metadata endpoints are not routable from it.
2. **The browser runs elsewhere** (above).
3. **The capture script resolves and checks every address before launching a
   browser**, using `dns.promises.lookup(host, { all: true })` and rejecting if
   *any* returned address is non-public.

### Use the allowlist

`ALLOWED_CAPTURE_HOSTS` in `wrangler.jsonc`, comma separated:

```jsonc
"ALLOWED_CAPTURE_HOSTS": "my-project.com,another.netlify.app"
```

With this set, SSRF is not "mitigated" — it is impossible, because the set of
hostnames a caller can choose from is finite and yours. For a studio capturing
its own work this is a short list, and it is the strongest setting available.
The same reasoning applies to `media.framableHosts` in `src/config/site.ts`,
which is empty by default: **live iframes are off until you opt in by host.**

`ALLOW_LOCAL_CAPTURE=1` disables the guard for local testing. It is read only by
`scripts/capture.mjs`, is not a Wrangler variable, prints a warning, and is not
set in any deployment configuration.

### Not used

`ssrf-req-filter` (last published 2024, single version, unmaintained) and
`metascraper` / `open-graph-scraper` (20–40 transitive dependencies for about
thirty lines of `meta[property^="og:"]` reading).

---

## Content Security Policy

Astro generates a **hash-based CSP per page**. Prerendered routes emit it in
`<meta>`; server-rendered routes deliver the same generated policy as an HTTP
response header — Astro picks the destination per route, so `/` (server-rendered
since the admin gained product editing) is header-delivered while `/contact`
stays in the page. It is not hand-written, because hand-written policies drift
from the content they protect.

```
script-src 'self' https://challenges.cloudflare.com 'sha256-…' × 11
style-src  'self' 'sha256-…' × 2
default-src 'self'
img-src    'self' data: https:
media-src  'self' https:
frame-src  'self' https: https://challenges.cloudflare.com
connect-src 'self' https://challenges.cloudflare.com
font-src   'self'
object-src 'none'
base-uri   'self'
form-action 'self'
upgrade-insecure-requests
```

`script-src` contains no `'unsafe-inline'` and no `'unsafe-eval'`, and no
`'strict-dynamic'`. That last one was removed deliberately: with
`strict-dynamic` in the directive, Astro drops `'self'` along with it, and the
bundled module loaded from `/_astro/…` was then blocked by its own policy. The
violation was visible in the console during this rebuild and the reveal
choreography silently fell back to its three-second failsafe — the page looked
fine, just inert. The hashes alone are the enforcement now, and a test asserts
both `unsafe-*` absences.

### Two things this forced, worth knowing

**1. `frame-ancestors` cannot live in a `<meta>` element.** Browsers ignore it
there. It is sent as its own single-directive header from `src/middleware.ts`.
A policy containing no `script-src` places no restriction on scripts, so the two
policies intersect without either weakening the other.

**2. There must be exactly one script policy.** An earlier version also set a
full CSP as an HTTP header. Browsers enforce *all* policies, and a header cannot
know the per-page hashes — so it would have blocked Astro's own inline scripts.
The browser console caught this immediately; it would have shipped broken.

### Consequences for the code

- **No inline `style` attributes.** The CSP does not permit them. This is why
  the aspect ratio is a `data-ar` attribute and the dominant colour is a scoped
  `<style>` block.
- **No Shiki syntax highlighting.** It emits inline styles. `syntaxHighlight:
  false` is set in `astro.config.mjs`; if code highlighting is ever wanted, use
  Prism rather than weakening the policy.
- **No `is:inline` scripts.** Astro cannot hash them, so everything that has to
  run goes through the bundler — `src/scripts/motion.ts` included.
- **No inline `<style>` for the no-JS case, either.** The fallback that keeps
  content visible when JavaScript is off would have needed one, and it cannot be
  hashed. It ships as a real file instead: `public/no-js.css`, linked from a
  `<noscript>` in `Base.astro`. A file the browser can request beats a policy it
  has to be excused from.

---

## Headers, and the gap that was nearly shipped

The prerendered pages (`/contact`, `/privacy`, `/terms`,
`/404`) are static files served by the Workers Static Assets binding. **The
Worker never runs for them, so `src/middleware.ts` never applies to them.**

Without `public/_headers` they would have shipped with no hardening at all. The
end-to-end suite asserts the headers on every route, which is how it was caught.

That file uses `#` for comments. A leading `/*` is a **path pattern** to this
parser, not a comment — an earlier version used C-style comments and produced 16
"invalid header rules" warnings per build while its headers happened to still
apply, purely by accident.

One header set, two delivery paths:

- `public/_headers` — static assets, including every prerendered page
- `src/middleware.ts` — Worker-handled routes

The CSP is in neither, because it is per-page and ships in the HTML.

The header set is applied by a `harden()` helper on **every** path, including
the 401, 403, 404 and 503 responses. An earlier version returned early from the
auth check, so the most common error responses shipped with no hardening at
all. Asserted in the E2E suite.

Also sent: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, `Strict-Transport-Security`.

---

## Admin access

`/admin` and `/api/admin/*` are gated in `src/middleware.ts` by path pattern,
not per page, so a new admin page cannot ship unprotected.

- **Constant-time comparison.** A naive `===` leaks the token a byte at a time
  through response timing. `timingSafeEqualStr` hashes first so the comparison
  does not depend on length either.
- **Disabled, not open, when unset.** If `ADMIN_TOKEN` is missing or under 16
  characters, the surface returns 503. An unset secret must never mean "open to
  the world".
- **HMAC-signed session cookie** — `<token>.<expiry>.<hmac>`, HttpOnly,
  SameSite=Strict, Path=/admin, 12 hours. The signature covers the token *and*
  the expiry, so the expiry cannot be edited to extend a session, and rotating
  `ADMIN_TOKEN` invalidates every issued cookie. An earlier version used the raw
  token, which made any cookie leak a permanent compromise of the token itself.
  The token is never exposed to page JavaScript.
- **Failed sign-in sleeps 500ms** before responding, so a guess cannot run at
  line speed.
- **No open redirect.** The `next` parameter must be a single-slash relative
  path with no backslash or whitespace. `//evil.com` *and* `/\evil.com` are both
  rejected — the second matters because WHATWG URL parsing normalises it to
  `//evil.com`.
- **Sign-out actually signs out.** The dashboard's sign-out issues a `DELETE`,
  not a `POST`; a `POST` hits the login handler and returns the operator to the
  login page still holding a valid session.
- **`noindex, nofollow`** on every admin page, plus a `Disallow: /admin` in
  robots.txt.

**Put Cloudflare Access in front of `/admin` as well.** That is one click, it is
free, and it handles MFA, which this does not. The token layer is defence in
depth.

### CSRF

Astro's `security.checkOrigin` is left **enabled**. It rejects state-changing
requests whose `Origin` header does not match the request URL, which covers the
contact form and every admin mutation.

---

## Contact form

Four layers, cheapest first, so obvious bots never cost an API call:

1. **Honeypot** — an off-screen `company_website` field. Not `display: none`,
   because naive bots skip hidden inputs; off-screen, so it still submits.
2. **Minimum fill time** — a build-time timestamp; a submission under 2s is
   dropped. A human cannot do that.
3. **Rate limit** — a D1 token bucket, 5 submissions per hour per identifier.
4. **Turnstile** — server-verified against `siteverify`, with the response
   `hostname` checked against the expected host so a token minted for another
   site is refused. Only reached by a submission that passed 1–3.

### Privacy

**No raw IP address is stored anywhere.** The rate limiter keeps a truncated,
salted, one-way SHA-256 hash — 32 hex characters, irreversible, and stable
enough to rate-limit. Enquiries store the name, email, message and context, and
nothing else.

### Leads are never lost

The enquiry is written to D1 **before** email is attempted. If Resend is down,
the lead is still in the database and the user still gets a confirmation. The
reverse order would lose enquiries.

Email delivery uses an idempotency key, so a double-submit cannot produce two
emails. Every failure mode returns a generic message; the specific reason goes
to the structured server log, because a distinct error per condition tells a
prober which check they tripped.

---

## Untrusted input

### Remote page metadata

Everything extracted from a fetched page is untrusted. `extractMeta` strips tags,
removes control characters, collapses whitespace, caps lengths (160 title, 320
description) and only accepts `http`/`https` image URLs. A hostile `og:title`
cannot inject markup, break a meta tag, or blow up a page.

### Database-sourced markdown

Case-study copy is injected with `set:html`, so the renderer in
`src/lib/markdown.ts` is an XSS boundary.

It escapes **per block, at render time** — not the whole document up front.
Escaping first destroys the block markers, which turns a blockquote into literal
text; that bug was caught by a test. The supported grammar is small on purpose:
headings, paragraphs, lists, blockquotes, fenced code, bold/italic, and links.
Link hrefs are checked against an `http`/`https`/`mailto` allowlist, and
control characters used to smuggle a scheme past a naive check are rejected. A
`javascript:` link degrades to plain text rather than emitting a dead href.

The renderer never emits a string it did not write itself, so raw-HTML
passthrough is structurally impossible.

### JSON-LD

Page metadata reaches the page title and description, which are text-escaped by
Astro's default behaviour. The JSON-LD block additionally replaces `<` with
`\u003c`, so a description containing `</script>` cannot terminate the block
early.

---

## Secrets

`.dev.vars` is gitignored. Nothing secret is in `wrangler.jsonc`; production
secrets are set with `wrangler secret put <NAME>` and are never committed.
