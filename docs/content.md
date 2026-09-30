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

`media.framableHosts` is the live-iframe allowlist. **Empty by default**, which
means no project is ever iframed. Add hosts to opt in — see
[security.md](security.md).

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

## Team

`team` table. Takes precedence over `studio.people` when rows exist, so you can
edit bios without a rebuild. Columns: `slug`, `name`, `role`, `bio`, `focus`
(JSON), `links` (JSON), `sort_order`, `published`.

The section is an editorial spread with a hairline between the two people, not
circular-avatar profile cards. Bios should say what they do and what a client can
expect, not what they are proud of.

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

**Never invent these.** The section is hidden when the table is empty, and it
stays hidden until there is a real quote from a real person. When one arrives, it
appears automatically on the home page.

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

Editing a *prerendered* page's source (`site.ts`, and therefore `/`, `/studio`,
`/contact`) requires a rebuild and redeploy. Editing a project does not:
`/creations` and case studies read D1 per request.
