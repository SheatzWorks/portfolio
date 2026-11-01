# Content

Everything editable, where it lives, and what to put in it.

The site ships with **no fabricated content**: no invented clients, metrics,
testimonials, awards or partnerships. Placeholders are marked PLACEHOLDER and are
obviously fake on purpose. Sections with no content render designed empty states
rather than disappearing or showing a heading over nothing.

---

## `src/config/site.ts` — edit this first

The one file that holds the studio's identity. Nothing here needs a build to
change if you edit D1 instead, but names, email and social links live here.

| Field | What it is |
|---|---|
| `name` | Studio name. Appears in the header, footer, `<title>`, and JSON-LD |
| `tagline` | One line, no adjectives you cannot demonstrate |
| `description` | Used for meta descriptions and structured data |
| `people[]` | The two of you: name, role, bio, `focus[]`, `links[]` |
| `email` | Shown as click-to-copy, never hidden behind a form |
| `location` | "Remote" is fine and honest |
| `social[]` | Label, href, optional handle |
| `siteUrl` | Absolute origin. Must match `PUBLIC_SITE_URL` |

Previews are a screenshot, the page's own `og:image`, or the site's own
favicon — in that order. Nothing is ever framed inside the site; see
[preview-pipeline.md](preview-pipeline.md) and [security.md](security.md).

### The Open Graph image

`public/og-default.png` is regenerated from `site.ts` on every build by
`scripts/generate-og.mjs`. Change the studio name and the share preview follows.
It cannot be a route handler: the Cloudflare adapter prerenders with workerd,
which cannot load sharp.

---

## Projects

`projects` table. Fields worth knowing:

| Field | Notes |
|---|---|
| `url` | The only required field besides a slug. Everything else is derived |
| `title`, `blurb` | Left empty are filled from the page's metadata, never overwritten once set |
| `summary` | Opening paragraph for the case study |
| `kind` | `web` `webapp` `mobile` `saas` `ai` `experiment` `client` `internal` — drives the filter bar |
| `status` | `live` `in-progress` `archived` `private` `experiment` |
| `technologies` | JSON array. Shown as tags, first four only |
| `aspect_ratio` | Snapped to a CSS bucket. A portrait is never given the full-bleed slot |
| `featured` | Featured projects lead the home page. Falls back to all published if none are featured |
| `sort_order` | **This is your layout control.** The fractional grid assigns spans by position, so ordering decides which project gets the full-bleed statement slot |
| `published` | `0` keeps it out of every public query |
| `has_case_study` | Set automatically when `body_md` is non-empty |
| `body_md` | Case study. Safe subset: `#`/`##` headings, paragraphs, lists, blockquotes, fenced code, `**bold**`, `*italic*`, `` `code` ``, `[links](url)` |
| `challenge_md`, `approach_md`, `outcome_md` | Optional extra case-study sections |
| `credits` | `[{"role","name","href"}]`. Name everyone, including the client's team |
| `links` | `{github, instagram, store, demo}` |
| `metrics` | `[{"label","value","note"}]` — **only when genuinely measured** |
| `gallery` | `[{"src","alt","width","height","caption"}]` |
| `preview` | Written by the pipeline. Do not hand-edit |
| `preview_state` | `queued` `metadata` `capturing` `ready` `partial` `failed` |

### Adding one

Use `/admin` — paste the URL, press Add. Or:

```sql
INSERT INTO projects (slug, title, url, blurb, kind, published, preview_state)
VALUES ('my-project', 'My Project', 'https://my-project.com',
        'One line for the card', 'web', 1, 'queued');
```

Then queue the metadata fetch and capture.

### Reordering

The grid's composition is a pure function of position, so reordering *is* layout
design. A 16:9 project placed fifth gets the full-bleed slot; a portrait placed
there is promoted to a paired slot instead.

---

## People

**There are no people on this site, and that is a decision rather than a gap.**

The `team` table and `studio.people` both still exist in the schema, and nothing
renders them. This was deliberate: a biography is the one thing a portfolio
cannot verify, a two-card "meet the team" strip is the single most templated
section on any studio site, and the studio asked not to publish personal
identity. `/about` carries what the studio *does* instead, and `/products` is the
evidence — software that exists and is openable.

If that ever changes, the section has to earn itself: an editorial spread with a
hairline, not circular-avatar profile cards, and bios that say what a client can
expect rather than what someone is proud of.

## Ownership and lifecycle

`projects.ownership` is the discriminator between `/work` and `/products`:

| `ownership` | Route | Meaning |
|---|---|---|
| `client` | `/work` | Commissioned. Published with the client's permission. |
| `own` | `/products` | Built and operated by the studio. |

`projects.product_status` is `NULL` for a commission, and one of `planning`,
`in-development`, `beta`, `live`, `paused`, `retired` for a product. The label is
rendered on the card and on the case study, so an unfinished product says so.

`availability_url` is where someone can try it — a waitlist, a store, a beta
invite. Leave it NULL until there is somewhere to send them.

## The narrative arc

Migration `0002` added six case-study columns. All six are writable from the
admin and all six render, and there is a test asserting that every column the
schema declares is writable through the API — because the previous migration
shipped case-study columns that no code path could ever write, which made the
strongest template in the repo unreachable.

| Column | Renders as |
|---|---|
| `objective_md` | What it had to do |
| `challenge_md` | The problem |
| `design_md` | Design decisions |
| `approach_md` | How it was built |
| `engineering_md` | Engineering notes |
| `outcome_md` | Where it landed |
| `challenges_md` | What was genuinely hard |
| `lessons_md` | What we would do differently |

Only the beats that are actually written render. A product with three of the
eight does not get five empty headings.

---

## Services

`services` table. `name`, `outcome`, `deliverables` (JSON array), `sort_order`,
`published`.

**Write the outcome, not the technology.** "A site that loads fast on a
mid-range phone, ranks, and is yours to edit without a developer" is a service.
"React, Next.js, Tailwind" is a résumé.

---

## Process

`site_content.process`: `[{"phase","detail"}]`.

Rendered as a **schematic track with hairline rules**, not numbered steps —
numbered steps are a current AI-slop tell and read as a marketing funnel rather
than how work actually runs. A typical set:

```
Scope    → What is being built, and more importantly what is not
Shape    → Architecture and design agreed before anything is written
Build    → Working software on a real URL throughout
Check    → Performance, accessibility, awkward cases, real devices
Launch   → Deployed, monitored, documented
Keep     → Fixes and iteration after launch
```

---

## Capabilities

`site_content.capabilities`: `[{"group","items":[...]}]`.

Shown as a compact spec table, not a skills list. Groups: Frontend, Backend,
Infrastructure, AI, and whatever fits. The presentation is meant to communicate
competence, not to fill a page.

---

## FAQ

`site_content.faq`: `[{"question","answer"}]`.

Rendered as an **editorial definition list, not an accordion** — a collapsible
"Frequently asked questions" block is a documented AI-slop tell, and there is
nothing here to conceal.

Worth answering: what you build, whether you work remotely, how a project
starts, roughly how long it takes, whether you maintain after launch, whether you
can work in an existing codebase, whether you do MVPs, and whether you do AI.

Skip anything you would have to hedge.

---

## Testimonials

`testimonials` table: `quote`, `author`, `role`, `company`, `source_url`,
`sort_order`, `published`.

**Never invent these.** The table is empty, the section renders nowhere, and it
stays that way until there is a real quote from a real person.

This is also asserted by a test, not just by convention:
`the site makes no claims it cannot support` walks every public page and fails if
it finds "trusted by", "clients include", "happy clients", "award-winning",
"testimonial", "10+ clients", "years of experience" or an unsourced percentage
claim. Those phrases are exactly the ones an LLM reaches for to fill a
stat-shaped layout, so the failure mode is automated rather than a matter of
remembering not to.

---

## Instagram

`instagram_posts` table: `permalink`, `image_key`, `caption`, `posted_at`,
`project_id`, `sort_order`, `published`.

`image_key` is a key in **your own** R2 bucket, not a Meta CDN URL. The section
loads zero third-party JavaScript and never tells Instagram that a visitor was
here. To add a post:

1. Screenshot the permalink at 1080x1350 with the capture script:
   ```bash
   node scripts/capture.mjs --url https://instagram.com/p/XXXX/ --slug ig-post
   ```
2. Insert the row, pointing `image_key` at the uploaded asset.
3. Publish.

Or simply set `image_key` to `null` and let the designed plate render.

---

## Editing D1 directly

```bash
# Read
npx wrangler d1 execute studio --remote \
  --command "SELECT slug, title, preview_state FROM projects"

# Write
npx wrangler d1 execute studio --remote \
  --command "UPDATE projects SET featured = 0 WHERE id = 42"
```

Editing a page's source (`site.ts`, and therefore `/`, `/contact`, `/about`)
requires a rebuild and redeploy — a source change ships with a deploy whether
the route is server-rendered or not. Editing a project, a service price or a
differentiator does not: `/`, `/work`, `/products`, `/services` and their case
studies read D1 per request.

## Price ranges

Services carry `price_from`, `price_to`, `price_note` and `engagement`. A range
with no note is a promise nobody can keep, so the qualifier travels with the
number.

The currency is **one value**, `studio.priceCurrency`, and it is currently set to
`GBP` as an assumption. A bare `30,000 – 75,000` cannot be compared between two
services, so it is rendered with its currency attached at every call site. Change
the one value and every range and every JSON-LD `Offer` follows.

`price_from` and `price_to` are strings, not numbers, because they are written
for humans — `"25,000"` rather than `25000`. An ongoing service leaves both NULL
and shows `engagement` instead; the tests assert it can never render as `£0`. 
