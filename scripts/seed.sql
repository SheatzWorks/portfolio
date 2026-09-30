-- =============================================================================
-- DEMO SEED — LOCAL DEVELOPMENT ONLY
--
-- These rows are fictional and exist purely so the creations grid, the filter
-- bar, the case-study layout and the preview fallback chain can be exercised
-- and screenshotted during development.
--
-- They are marked `published = 1` so they render, and every one is prefixed
-- with "Demo" so it is impossible to mistake for real work. They must never be
-- applied to the remote database:
--
--     npm run db:seed:local     <- safe
--     wrangler d1 execute studio --remote --file=./scripts/seed.sql   <- DO NOT
--
-- Before launch: delete every row below (see scripts/clear-demo.sql).
-- =============================================================================

DELETE FROM projects;
DELETE FROM services;
DELETE FROM team;
DELETE FROM instagram_posts;
DELETE FROM site_content;

-- --- Projects ---------------------------------------------------------------
-- Aspect ratios are deliberately varied (16:9, 4:3, 1:1, 4:5) so the grid is
-- verified against mixed content rather than a uniform block.
INSERT INTO projects
  (slug, title, url, blurb, summary, category, technologies, year, status, kind,
   featured, sort_order, published, has_case_study, body_md, challenge_md,
   approach_md, outcome_md, credits, links, metrics, gallery, aspect_ratio,
   preview, preview_state)
VALUES
(
  'demo-shelf', 'Demo Shelf',
  'https://example.com/demo-shelf',
  'A product catalogue that stays fast when the catalogue does not.',
  'A catalogue rebuilt around a single query path, so a slow page is now a bug rather than the norm. Built to demonstrate a case study with a real body.',
  'e-commerce', '["TypeScript","Astro","D1","Redis"]', 2025, 'live', 'webapp',
  1, 10, 1, 1,
  '## What it does

Demo Shelf is a small catalogue application. It exists here as a **layout fixture** so the case-study template can be reviewed with realistic content.

### Why it was built

To exercise the prose, list and code-block rendering paths with copy that is obviously placeholder but structurally real.

- Rendered from the database, not a file
- Escaped before any markup is produced
- Links checked against a scheme allowlist

```
// This block verifies the fenced-code path.
export const example = 1;
```

> A blockquote, to check that path too.

Read more at [the source](https://example.com/demo-shelf).',
  'The existing catalogue ran six queries per product page. Under real traffic that did not scale, and the fix was not another cache.',
  'One denormalised read path, with the write side kept boring. The interesting decision was what *not* to cache.',
  'Catalogue pages now render in a single query. Numbers are omitted because this is a fixture, not a claim.',
  '[{"role":"Engineering","name":"First Name"},{"role":"Design","name":"Second Name"},{"role":"Client","name":"Demo Client Ltd"}]',
  '{"github":"https://github.com/PLACEHOLDER/demo-shelf"}',
  NULL,
  '[]',
  1.7778,
  '{"dominant":"#1b2430","note":"Demo: no capture has run against this row","source":"placeholder"}',
  'queued'
),
(
  'demo-ledger', 'Demo Ledger',
  'https://example.com/demo-ledger',
  'Double-entry bookkeeping, minus the double-entry confusion.',
  'An accounting tool built around one immutable ledger and an append-only journal.',
  'fintech', '["React","PostgreSQL","tRPC"]', 2024, 'live', 'saas',
  1, 20, 1, 1,
  '## Overview

Demo Ledger keeps a single source of truth for every balance and derives every view from it.

## What we built

- An append-only journal
- Idempotent writes, so a retried request cannot double-post
- A read model rebuilt from the journal on demand',
  'Every screen had its own idea of the current balance, and they disagreed.',
  'Collapse them into one ledger and derive the views. Reconciliation stops being a feature.',
  'The disagreement is gone by construction. Metrics are omitted: this is a fixture.',
  '[{"role":"Engineering","name":"First Name"},{"role":"Client","name":"Demo Client Ltd"}]',
  '{}',
  NULL, '[]', 1.3333,
  '{"og":"https://example.com/og-demo.png","note":"Demo: exercises the OG fallback tier","source":"og"}',
  'partial'
),
(
  'demo-atlas', 'Demo Atlas',
  'https://example.com/demo-atlas',
  'A map of a city, drawn from open data.',
  'An open-data map experiment. No private data, no tracking, no third-party tiles.',
  'maps', '["WebGL","TypeScript","PMTiles"]', 2024, 'live', 'experiment',
  1, 30, 1, 1,
  '## Overview

Demo Atlas renders vector tiles straight from the browser with no tile server of our own.

## Why it is here

It is the clearest example on this site of a technical constraint producing a product decision rather than the other way round.',
  'Tile hosting costs scale with usage, and usage scales with popularity.',
  'Ship the tiles to the client and let the CDN do the work.',
  NULL,
  '[{"role":"Engineering","name":"First Name"}]',
  '{"github":"https://github.com/PLACEHOLDER/demo-atlas"}',
  NULL, '[]', 1.0,
  '{"favicon":"https://example.com/favicon.ico","note":"Demo: exercises the favicon fallback tier","source":"favicon"}',
  'partial'
),
(
  'demo-relay', 'Demo Relay',
  'https://example.com/demo-relay',
  'Notifications that arrive, and only when they matter.',
  'A delivery service with per-channel preferences and a real unsubscribe path.',
  'tooling', '["Go","Redis","WebSockets"]', 2023, 'archived', 'internal',
  0, 40, 1, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Engineering","name":"First Name"}]',
  '{}', NULL, '[]', 1.3333, '{}', 'queued'
),
(
  'demo-vellum', 'Demo Vellum',
  'https://example.com/demo-vellum',
  'Long-form writing, set properly.',
  'A minimal publishing system focused entirely on typography and reading.',
  'publishing', '["Astro","Markdown"]', 2023, 'live', 'web',
  0, 50, 1, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Design","name":"Second Name"}]',
  '{}', NULL, '[]', 0.8, '{}', 'queued'
),
(
  'demo-quarry', 'Demo Quarry',
  'https://example.com/demo-quarry',
  'Search that does not need a cluster.',
  'Full-text search over a single Postgres instance, sized honestly for what it is.',
  'infrastructure', '["Postgres","TypeScript"]', 2022, 'live', 'webapp',
  0, 60, 1, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Engineering","name":"First Name"}]',
  '{}', NULL, '[]', 1.3333, '{}', 'queued'
),
(
  'demo-sable', 'Demo Sable',
  'https://example.com/demo-sable',
  'A design system with fewer decisions in it.',
  'Thirty components instead of three hundred, and a documented reason for each removal.',
  'design-system', '["TypeScript","Web Components"]', 2022, 'live', 'internal',
  0, 70, 1, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Design","name":"Second Name"}]',
  '{"github":"https://github.com/PLACEHOLDER/demo-sable"}',
  NULL, '[]', 1.0, '{}', 'queued'
),
(
  'demo-harbor', 'Demo Harbor',
  'https://example.com/demo-harbor',
  'Deployment previews for a monorepo.',
  'One command, one isolated preview, one URL, deleted when the branch is.',
  'devops', '["Docker","GitHub Actions"]', 2022, 'live', 'internal',
  0, 80, 1, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Engineering","name":"First Name"}]',
  '{}', NULL, '[]', 1.7778, '{}', 'queued'
),
(
  'demo-lantern', 'Demo Lantern',
  'https://example.com/demo-lantern',
  'A tiny model, running in a browser, on purpose.',
  'An experiment in running a small language model entirely client-side.',
  'machine-learning', '["WebGPU","ONNX"]', 2026, 'in-progress', 'ai',
  0, 90, 0, 0,
  NULL, NULL, NULL, NULL,
  '[{"role":"Engineering","name":"First Name"}]',
  '{}', NULL, '[]', 1.0, '{}', 'queued'
);

-- --- Team (PLACEHOLDER bios, matching the config file) ---------------------
INSERT INTO team (slug, name, role, bio, focus, links, sort_order, published) VALUES
('first-name', 'First Name', 'Engineering & backend',
 'PLACEHOLDER bio — one short paragraph. What they do, what they are good at, what a client can expect from working with them.',
 '["Application architecture","APIs & data","Performance","Infrastructure"]', '[]', 1, 1),
('second-name', 'Second Name', 'Design & frontend',
 'PLACEHOLDER bio — one short paragraph. What they do, what they are good at, what a client can expect from working with them.',
 '["Interface design","Frontend engineering","Accessibility","Motion"]', '[]', 2, 1);

-- --- Services --------------------------------------------------------------
INSERT INTO services (slug, name, outcome, deliverables, sort_order, published) VALUES
('websites','Websites',
 'A site that loads fast on a mid-range phone, ranks, and is yours to edit without a developer.',
 '["Design and build","Responsive layout","CMS setup","Analytics"]', 1, 1),
('web-applications','Web applications',
 'A working application with a real data model, real auth, and no demo data left behind.',
 '["Architecture","Database design","Auth","API","Admin surface"]', 2, 1),
('product','Product & SaaS',
 'From prototype to paid users, with the parts that are boring and the parts that are hard both done.',
 '["Product scoping","Design system","Build","Billing","Monitoring"]', 3, 1),
('ai','AI integration',
 'AI added where it earns its cost, and measurably better than the obvious alternative.',
 '["Use-case review","Prompt and retrieval design","Evaluation","Cost control"]', 4, 1);

-- --- Editorial singleton ----------------------------------------------------
INSERT INTO site_content (id, faq, capabilities, process, services_intro, contact_blurb) VALUES (1,
'[
 {"question":"What do you build?","answer":"Websites, web applications and the product software behind them. The creations section shows real, running things rather than a portfolio of mockups."},
 {"question":"Do you work with clients remotely?","answer":"Yes. We work with people in other time zones and have never needed to be in the same room."},
 {"question":"How does a project start?","answer":"You send a description. We reply with questions, then a written scope and a fixed price. Nothing begins until that is signed."},
 {"question":"How long does a project take?","answer":"It depends entirely on scope, and we will say so rather than guess. A focused site is weeks; an application is months. We will give you a real range before you commit."},
 {"question":"Do you maintain projects after launch?","answer":"Yes, as an ongoing arrangement. We would rather fix something while it is small than be called in after it is not."},
 {"question":"Can you work with an existing codebase?","answer":"Often, yes. We will read it first and tell you honestly whether it is worth continuing or whether a rebuild would be cheaper."},
 {"question":"Can you build an MVP?","answer":"Yes, though we will push back if the scope is larger than an MVP. A smaller thing that ships beats a larger thing that does not."},
 {"question":"Can you integrate AI?","answer":"Where it genuinely improves the product. We will also tell you when a rule-based system would be cheaper, faster and more predictable."}
]',
'[
 {"group":"Frontend","items":["TypeScript","Astro","React","CSS architecture","Accessibility","Motion"]},
 {"group":"Backend","items":["APIs","Node","Go","PostgreSQL","SQLite","Auth"]},
 {"group":"Infrastructure","items":["Cloudflare","Docker","CI/CD","Observability","Cost control"]},
 {"group":"AI","items":["Retrieval","Evaluation","Client-side models","Prompt design"]}
]',
'[
 {"phase":"Scope","detail":"A written description of what is being built and, more importantly, what is not. Most disagreements are settled here."},
 {"phase":"Shape","detail":"Architecture and design agreed before anything is written, so the expensive decisions are made while they are still cheap."},
 {"phase":"Build","detail":"Working software on a real URL throughout, not a staging mockup at the end."},
 {"phase":"Check","detail":"Performance, accessibility and the awkward cases, on real devices rather than a developer laptop."},
 {"phase":"Launch","detail":"Deployed, monitored, and documented well enough that you could hand it to another developer."},
 {"phase":"Keep","detail":"Fixes and iteration after launch, as an arrangement rather than a favour."}
]',
'Each service is described by what you end up holding, not by a list of technologies.',
'Send a short description of the project, the timeline and the budget range. We reply to everything, usually within a couple of days, with a straight answer about whether it is a fit.');
