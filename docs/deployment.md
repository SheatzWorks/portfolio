# Deployment

Target: **Cloudflare Workers** (not Pages) with static assets, D1, R2 and cron.
Everything in the free tier is sufficient for a two-person studio.

> **Note on Pages vs Workers.** `@astrojs/cloudflare` v13 and later removed
> Cloudflare **Pages** support. The adapter deploys to Workers with a static
> assets binding. Same dashboard, same billing, same free tier — the UI is just
> "Workers" rather than "Pages".

## 1. Cloudflare setup

```bash
npm install -g wrangler
wrangler login
```

### D1

```bash
wrangler d1 create studio
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing
`REPLACE_WITH_D1_DATABASE_ID`.

```bash
npm run db:migrate:remote
```

### R2

```bash
wrangler r2 bucket create studio-media
```

The bucket name is already set in `wrangler.jsonc`. For custom-domain access,
attach `media.yourdomain.com` in the R2 dashboard, then set `MEDIA_BASE_URL` to
it. Without a custom domain the site still works through the R2 dev URL.

### Config

In `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "PUBLIC_SITE_URL": "https://yourdomain.com",
    "MEDIA_BASE_URL": "https://media.yourdomain.com",
    "CAPTURE_PROVIDER": "none",
    "PREVIEW_FETCH_MODE": "egress",
    "ALLOWED_CAPTURE_HOSTS": ""
  }
}
```

- `ALLOWED_CAPTURE_HOSTS` — comma separated. **Strongly recommended.** With this
  set, SSRF is impossible rather than mitigated. See
  [security.md](security.md).
- `PREVIEW_FETCH_MODE: "disabled"` makes the Worker refuse all outbound fetches
  and rely only on stored metadata. A valid option for a deployment that must
  make no external requests at all.

### Secrets

Never in `wrangler.jsonc`, never committed:

```bash
wrangler secret put ADMIN_TOKEN          # required: gates /admin
wrangler secret put RATE_LIMIT_SALT      # required: salting the rate-limit hash
wrangler secret put RESEND_API_KEY       # contact form delivery
wrangler secret put CONTACT_TO_EMAIL     # where enquiries go
wrangler secret put CONTACT_FROM_EMAIL   # verified sender on Resend
wrangler secret put TURNSTILE_SECRET_KEY # spam defence, after the domain exists
```

`ADMIN_TOKEN` must be at least 16 characters. If it is missing or shorter, the
admin surface returns 503 — disabled, not open.

### Deploy

```bash
npm run build
wrangler deploy
```

---

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `ADMIN_TOKEN` | secret | **yes** | Gates `/admin` and `/api/admin` |
| `RATE_LIMIT_SALT` | secret | **yes** | Salts the rate-limit IP hash |
| `PUBLIC_SITE_URL` | var | **yes** | Canonical URLs, sitemap, robots, OG |
| `MEDIA_BASE_URL` | var | yes | Where R2 is served from |
| `ALLOWED_CAPTURE_HOSTS` | var | recommended | Turns SSRF from mitigated into impossible |
| `PREVIEW_FETCH_MODE` | var | no | `egress` (default) or `disabled` |
| `CAPTURE_PROVIDER` | var | no | `none` (default), `browserless`. Wired to `src/lib/capture.ts`; the Worker calls the provider over HTTP when set |
| `BROWSERLESS_URL` | var | no | Hosted capture endpoint |
| `BROWSERLESS_TOKEN` | secret | no | Only for a self-hosted Browserless |
| `RESEND_API_KEY` | secret | no | Without it, enquiries are stored but not emailed |
| `CONTACT_TO_EMAIL` | secret | no | Enquiry destination |
| `CONTACT_FROM_EMAIL` | secret | no | Verified sender |
| `TURNSTILE_SITE_KEY` | var | no | Without it, Turnstile is skipped |
| `TURNSTILE_SECRET_KEY` | secret | no | Server verification |
| `R2_ENDPOINT` etc. | local only | for the capture script | R2 over the S3 API |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_D1_DATABASE_ID` | local only | for `--drain`/`--serve` | D1 via the REST API |

---

## The capture worker

The capture worker needs a machine with Node and Chromium. Three options, in
increasing order of capability.

### 1. Run it locally (recommended to start)

Nothing to deploy. Run the CLI when you add a project:

```bash
node scripts/capture.mjs --url https://example.com --slug my-project
```

With no R2 credentials it writes to `./captures/` instead of uploading, which is
enough to verify the pipeline.

### 2. Hosted capture over HTTP

`CAPTURE_PROVIDER=browserless` lets the Worker call a hosted capture service
directly. No VM, no Chromium to maintain, and the free tier is ample for this
volume. It also means the rendering happens inside the provider's network, which
is strictly safer for you.

Set `BROWSERLESS_URL` (and `BROWSERLESS_TOKEN` if the endpoint needs one).

The capture is attempted only when the project has no usable image yet, so a
project is not re-shot on every dispatch. **Re-capture** in the admin forces one.

**Limitation:** a Worker has no `sharp`, so it cannot derive a responsive set.
The provider is asked for a single 1200px WebP and that is what is stored.
`npm run capture:one` replaces it with a full AVIF/WebP srcset later, and the
site needs no change to pick it up — the key stays
`projects/<slug>/card-1200.webp`.

**Assessed and rejected: Cloudflare Containers** for the browser. GA, but
Workers-Paid only: roughly $26-35/month for a 4 GiB container held 24/7, with
ephemeral disk and no guarantee the container keeps running.

**Limitation:** no video. A hosted capture has a session cap and no persistent
browser to screencast from. Option 1 or 3 for video.

### 3. Self-hosted

For video, and for control. Any small Linux box works.

```bash
# On the box
git clone <repo> && cd portfolio
npm install
npx playwright install chromium --only-shell
```

Put `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`CF_ACCOUNT_ID`, `CF_API_TOKEN` and `CF_D1_DATABASE_ID` in `.env` or the process
environment, then:

```bash
npm run capture:serve
```

It polls the D1 job table every 60 seconds. Run it under systemd or Docker with
`restart: always`.

**On the free-tier options for this box**, briefly, because the obvious answer is
usually wrong:

- **Oracle Always Free Ampere A1** is the only permanent free compute that can
  hold a Chromium. Stay at **2 OCPU / 12 GB** — the allowance was reduced in
  2026 and accounts above it risk instance deletion, not just throttling. Expect
  signup capacity problems, and expect idle reclamation.
- **Every surviving PaaS free tier sleeps on idle**, which kills a resident
  browser.
- **Google e2-micro and the AWS credits** are not workable: 1 GB of RAM, or a
  six-month auto-close.
- **Playwright does ship official `linux-arm64` Chromium** since about 1.57, so
  an ARM box is fine. Do not use `channel: 'chrome'` — branded Chrome is
  x86-only on Linux.

If none of that is worth the operational attention, option 1 or 2 is the better
trade for a portfolio that changes a few times a month.

---

## Turnstile

Requires a real hostname, so do this after the domain exists.

1. Turnstile → Add site → the production hostname.
2. `wrangler secret put TURNSTILE_SECRET_KEY`
3. Set `TURNSTILE_SITE_KEY` in `wrangler.jsonc` vars.

Until then the contact form still works — honeypot, fill-time and rate limiting
are always on. Turnstile is added on top, and is verified server-side with a
`hostname` check.

---

## Contact form

Without a `RESEND_API_KEY` the form still validates, rate-limits, **stores the
enquiry in D1**, and confirms to the user. Email is simply not sent. A lead is
never lost to a mail provider outage.

### Storing enquiries in your own Gmail

`CONTACT_TO_EMAIL` can be any address, a personal Gmail included. With no
secret set, enquiries go to the address the site publishes — `studio.email` in
`src/config/site.ts` — which is the same mailbox the `mailto:` links open, so
there is one inbox and one place to change it.

**Path B — send from a domain you own. This is the one to do.**

1. Resend → Domains → Add domain. Use a sending subdomain — `send.yourdomain.com`.
   A dedicated subdomain keeps mail reputation separate from the website's, and
   it is what Resend's own setup screen generates.
2. Resend shows the records with the exact values filled in. Their shapes:

   | Type | Name                     | Value                                                |
   | ---- | ------------------------ | ---------------------------------------------------- |
   | MX   | `send`                   | `10 feedback-smtp.<region>.amazonses.com`            |
   | TXT  | `send`                   | `v=spf1 include:amazonses.com ~all`                  |
   | TXT  | `resend._domainkey.send` | `p=<the DKIM public key on your screen>`             |
   | TXT  | `_dmarc`                 | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`  |

   Two ways this goes wrong and mail still looks "delivered": the MX region must
   be the region the dashboard chose (a `us-east-1` record for a `eu-west-1`
   domain passes nothing), and DMARC must be on the **root** `_dmarc`, not
   `_dmarc.send`. Start at `p=none` — it reports, it does not block. Raise the
   policy only after a few weeks of clean reports.
3. Wait until Resend marks the domain **Verified** (green). Sending before that
   returns an API error, which the endpoint swallows into `stored` rather than
   losing the lead.
4. Set the secrets. `CONTACT_FROM_EMAIL` takes a display name, and it should use
   one:

   ```bash
   wrangler secret put RESEND_API_KEY
   wrangler secret put CONTACT_FROM_EMAIL  # "sheatz" <enquiries@send.yourdomain.com>
   wrangler secret put CONTACT_TO_EMAIL    # the inbox the enquiries should land in
   ```

   The address inside `< >` must be on the verified domain. Putting a Gmail
   address in `From:` is the single most reliable way to be filed under Spam:
   the mail did not come from Gmail, so it fails SPF and DMARC alignment by
   definition. The visitor's address belongs in `replyTo`, which the endpoint
   already does — that is why "Reply" in Gmail answers them and not yourself.
5. If you move the studio mailbox to the domain, change `studio.email` in
   `src/config/site.ts` as well. That one value drives the published `mailto:`
   links, the admin page and the fallback recipient, so the form and the direct
   link keep arriving in the same place.

**Path A — no domain yet.** Resend's shared testing sender `onboarding@resend.dev`
delivers to exactly one address: the email the Resend account is registered
with. Register that account with the Gmail you want enquiries in, set
`CONTACT_FROM_EMAIL=onboarding@resend.dev`, and one test enquiry arrives. It is
a way to see the pipeline work in five minutes; it is not a way to run a studio,
because `resend.dev` carries thousands of senders' reputation, including the
spammy ones.

### Reading the result instead of guessing it

Submit one real enquiry from the deployed site, open it in Gmail → **Show
original**, and look for three lines:

```
spf=pass    (client-connect ...; identity=mailfrom)
dkim=pass   (2048-bit rsasha ...; header d=send.yourdomain.com)
dmarc=pass  (alignment=relaxed, ... )
```

- Any `softfail` / `temperror` / `none` → the DNS is not finished, or the region
  is wrong. Nothing else matters until those three say `pass`.
- All three `pass` and Gmail still files it in Spam → that is sender reputation,
  which is built by volume and consistency over weeks, not by configuration.
  The practical fix in the meantime is a Gmail filter for the sending address
  with "Never send it to Spam" ticked. It is one manual step on your own inbox,
  and it does not paper over a broken DNS check.
- Watch for it landing in **Social/Promotions** rather than Spam: that is Gmail
  categorising, it is harmless for delivery, and the same filter pins it to Primary.

For both paths the delivery chain is unchanged: the enquiry is stored in D1
first, emailed second, every send carries an idempotency key so a double-submit
cannot send twice, and a failure to email is logged and never loses the lead —
it remains visible in `/admin`, in the Recent enquiries panel, where each row
is badged `emailed` or `stored`.

---

## Before launch checklist

- [ ] `src/config/site.ts` — real name, people, email, social, domain
- [ ] `wrangler.jsonc` — `PUBLIC_SITE_URL`, `MEDIA_BASE_URL`
- [ ] `ALLOWED_CAPTURE_HOSTS` set, or accepted as unset
- [ ] `ADMIN_TOKEN` and `RATE_LIMIT_SALT` set via `wrangler secret put`
- [ ] **Cloudflare Access** in front of `/admin` (one click, free, adds MFA)
- [ ] Demo rows deleted:
      ```bash
      wrangler d1 execute studio --remote --file=./scripts/clear-demo.sql
      ```
- [ ] Turnstile keys added (optional but recommended)
- [ ] Resend delivery configured — see [Contact form](#contact-form):
      Path A (no domain) or Path B (verified domain)
- [ ] `/privacy` — the "Before launch" list on that page, with wording reviewed
      for your jurisdiction
- [ ] `/terms` — same
- [ ] `npm test && npm run test:e2e && npm run perf && npm run qa` all green
      against the deployed URL
- [ ] `studio.priceCurrency` confirmed (currently `GBP`, an assumption)
- [ ] `studio.email`, `studio.siteUrl` and the social links replaced with real values
- [ ] A real commission added, or `/work`'s empty state left as-is deliberately
- [ ] `npm run gates` — answer the `manual` gates, not just the automated ones

---

## Operational notes

**The cron trigger runs every 7 minutes** and drains up to 3 preview jobs per
invocation. Cloudflare Free allows 5 cron triggers and 10 ms of CPU per cron
invocation; the work that costs time is outbound fetch and browser capture,
neither of which counts as CPU. Tighten `*/7` to `0 * * * *` if you want faster
turnaround.

**Failures are visible, not silent.** A job that exhausts its retries is marked
`failed` with the reason, and shows in the admin table with a red badge. Wrangler
logs are on (`observability.enabled`), and the dispatcher logs a structured
summary per run.

**Nothing sensitive is logged.** Enquiry logs carry an event name and a code, not
names, emails or IPs. The rate limiter never stores a raw address.
