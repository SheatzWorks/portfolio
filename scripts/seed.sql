-- =============================================================================
-- Content.
--
-- Everything here is a statement of how the studio actually works. Nothing is
-- invented: no client names, no testimonials, no metrics, no awards, no years
-- of experience, no user counts. Where a real figure is missing it is absent
-- rather than approximated, and the section it would have filled is hidden.
--
-- The two products are the studio's own work, honestly labelled as
-- in-development. Neither has a public URL yet, so neither has a capture and
-- neither shows a screenshot.
-- =============================================================================

DELETE FROM jobs;
DELETE FROM instagram_posts;
DELETE FROM testimonials;
DELETE FROM rate_limits;
DELETE FROM enquiries;
DELETE FROM differentiators;
DELETE FROM services;
DELETE FROM projects;
DELETE FROM site_content;

-- ---------------------------------------------------------------------------
-- Own products.
--
-- Read out of each project's own documentation rather than guessed.
-- ---------------------------------------------------------------------------

INSERT INTO projects
  (slug, title, url, tagline, blurb, summary, category, technologies, year,
   status, kind, ownership, product_status, featured, sort_order, published,
   has_case_study, body_md, objective_md, engineering_md, challenges_md,
   lessons_md, aspect_ratio, preview, preview_state)
VALUES
(
  'nut',
  'nut',
  'https://example.com/nut',
  'Nutrition tracking that never needs a network.',
  'An offline-first nutrition tracker that identifies food with on-device computer vision.',
  'nut records what you eat and works out the nutrition from it, with no account and no server. A photo, a sentence or a spoken word all resolve to the same entry.',
  'health', '["React Native","Expo","TypeScript","SQLite","TFLite","ML Kit"]',
  2026, 'in-progress', 'mobile', 'own', 'in-development',
  1, 10, 1, 1,
  '## What it is

nut is a nutrition tracker that identifies food from a photograph, a typed phrase or a spoken description, then works out the nutrition itself. Everything happens on the device: there is no account, no server and no network requirement, because the USDA food database ships inside the app.

## Why offline-first was not a preference

Sending a photograph of every meal to a server to ask what it is would work, and it would also mean the app is useless without a connection, costs money per query, and hands a complete record of what somebody eats to a third party on every meal.

Doing it on the device removes all three problems at once. The trade is real: a general-purpose vision model has to be small enough to run on a mid-range phone, which constrains accuracy, and that constraint shapes almost every other decision in the project.

## How it resolves a meal

Three input paths — camera, text search and voice — all converge on one resolution step. Whichever path is used, the result is the same structured entry, so a voice log and a photograph produce identical data.

Text search goes through FTS5 against a read-only bundled database. Voice is transcribed offline and then parsed locally rather than being sent to a speech API.',
  'To identify everyday food from a single photograph quickly enough that logging a meal takes less time than not logging it.',
  'The detector and the classifier are deliberately separate. A YOLOv8-head detector with INT8 quantisation finds and crops the food; an EfficientNetB0 classifier with fp16 weights names it. Running two small models beats one larger one because each can be optimised for its own job, and the pair fits comfortably in memory on a mid-range device where a single general model would not.

The two databases are separated by direction of travel: a read-only USDA reference that ships in the app, and a read-write store for the user''s own history. Nothing ever writes to the reference, which removes a whole class of migration and corruption problem.

Rendering is gated on fonts loading with an explicit timeout and a system fallback, so a slow font response degrades to readable text rather than a blank screen.',
  'Quantisation is where the accuracy goes. INT8 halves the detector''s footprint but costs real accuracy on visually similar foods, and there is no configuration that gets both. fp16 was kept for the classifier because it is the smaller model and the accuracy loss was not acceptable.

Offline speech recognition behaves differently across Android versions, which meant the voice path needed per-version handling rather than one code path with feature detection.

Offline-first also means every assumption that a network exists has to be audited. There are more of them than expected.',
  'The test suite is 247 cases with a 238-case golden dataset, and it is the reason the offline paths can be trusted. Pixel output from a quantised model is not deterministic across devices, so the tests assert on the resolution step rather than the raw inference.',
  1.7778, '{}', 'queued'
),
(
  'ember',
  'Ember',
  'https://example.com/ember',
  'A habit tracker that makes your consistency visible.',
  'A local-first habit tracker built around a contribution grid and a fair freemium model.',
  'Ember is a habit tracker for people who have stopped believing in streak counters. Completions light a cell in a contribution grid, so a missed week is visible without being punishing.',
  'productivity', '["Flutter","Riverpod","Drift","SQLite","RevenueCat"]',
  2026, 'in-progress', 'mobile', 'own', 'in-development',
  1, 20, 1, 1,
  '## What it is

Ember tracks habits without a streak. Every completed day lights a cell in a contribution grid, which shows a year of consistency at a glance and treats a gap as information rather than failure.

Nothing about it requires an account. The data lives on the device, the free tier is a complete product rather than a trial, and there are no ads.

## The contribution grid is the product

Streaks are a bad incentive: they make one missed day feel like total failure, which is exactly when people quit. A contribution grid removes the cliff. Missing a day costs one cell.

That single decision shaped the visual language — the glow is the reward, and there is no other reward layer to design.

## Getting out of the app

The habit data is exportable and importable as plain files. A local-first app that holds the only copy of your data has an obligation to let you take it with you, and that obligation shaped the storage layer rather than being bolted on at the end.',
  'To be a tracker that a lapsed user opens again rather than deletes, and to work with no account at all.',
  'Drift gives type-safe SQLite with migrations that run on launch, which is the only version of local-first that is safe to ship. Riverpod holds the derived state that the grid needs, so a change anywhere in the tree recomputes the grid without the widget knowing about it.

Home-screen widgets and notifications are platform integrations rather than in-app features, which means they had to be built as thin bridges over the same Drift queries the app uses. Duplicating that logic into the widget layer would have produced two sources of truth.',
  'Native home-screen widgets exist in two unrelated platform APIs — Android AppWidgets and the iOS WidgetKit bridge — with different refresh semantics and different permission models. Getting a single Dart query to behave correctly in both took more iteration than the rest of the app.

Subscription entitlements have to be correct offline. Purchases are restored on launch and cached locally, because a user who has paid should not be shown an ad or a paywall because their connection dropped.',
  'The paywall deliberately never appears at launch. It appears at the moment Premium becomes genuinely useful and not before, which is both fairer and simpler to reason about.

Monetisation would have been much easier to add late and is why it shaped the entitlement model early.',
  1.3333, '{}', 'queued'
);

-- ---------------------------------------------------------------------------
-- Client work: intentionally empty.
--
-- No client has approved publication, and inventing one would be worse than
-- an honest gap. /work renders a composed panel pointing at /products rather
-- than an apology.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Services, with published ranges.
--
-- Ranges are a filter. They sort out mismatched enquiries before either side
-- spends a call on them. The qualifier travels with the number so the figure
-- is never read as a ceiling.
-- ---------------------------------------------------------------------------

INSERT INTO services
  (slug, name, outcome, deliverables, price_from, price_to, price_note,
   engagement, is_signature, sort_order, published)
VALUES
('web-applications','Web applications',
 'A working application with a real data model, real authentication, and no demo data left behind at launch.',
 '["Architecture","Database design","Auth","API surface","Admin panel"]',
 '25,000','60,000','Fixed scope, agreed in writing before the build starts.',
 'Fixed scope',1,10,1),
('mobile-apps','Mobile apps',
 'An app that is fast on a mid-range Android, works offline where it should, and is in both stores.',
 '["React Native or Flutter","Offline-first storage","Store release","Crash reporting"]',
 '30,000','75,000','Cross-platform unless a single platform genuinely needs native code.',
 'Fixed scope',1,20,1),
('ai-products','AI products',
 'AI added where it earns its cost, and a measured evaluation showing whether it does.',
 '["Use-case review","Retrieval or on-device inference","Evaluation set","Cost ceiling"]',
 '20,000','80,000','We will tell you when a rule-based system would be cheaper and better.',
 'Fixed scope',1,30,1),
('websites','Websites',
 'A site that loads in under a second on a mid-range phone, ranks, and you can edit without a developer.',
 '["Design and build","Content you own","Analytics","Technical SEO"]',
 '8,000','20,000','Marketing sites. Content is supplied or written with you.',
 'Fixed scope',0,40,1),
('automation','Automation',
 'The repetitive process replaced with something that runs, logs, and tells you when it breaks.',
 '["Process mapping","Integration build","Monitoring","Runbook"]',
 '6,000','18,000','Scoped to one workflow. Larger automation is split first.',
 'Fixed scope',0,50,1),
('design-systems','Design systems',
 'A component library your team can build against, so the tenth screen costs a tenth of the first.',
 '["Token architecture","Component library","Documentation","Adoption plan"]',
 '12,000','30,000',
 NULL,'Fixed scope',0,60,1),
('performance','Performance work',
 'A measurable improvement in load time and interaction latency, with the numbers published.',
 '["Baseline measurement","Bottleneck analysis","Remediation","Verification"]',
 '5,000','15,000','Usually the highest return on the smallest invoice.',
 'Fixed scope',0,70,1),
('maintenance','Maintenance',
 'Monitoring, fixes and iteration after launch, as an arrangement rather than a favour.',
 '["Monitoring","Security patches","Iteration sprints","Monthly report"]',
 NULL,NULL,'Billed monthly. Cancel with 30 days notice.',
 'Monthly',0,80,1);

-- ---------------------------------------------------------------------------
-- Differentiators.
--
-- Every one is a statement of a practice, not a promise. Two of them are also
-- the funny lines — the humour is what lets the assurance land instead of
-- sounding like a disclaimer.
-- ---------------------------------------------------------------------------

INSERT INTO differentiators (label, body, sort_order, published) VALUES
('We are too small to afford a sales team',
 'So instead of a pitch you get the person who is actually building. There is no handover, no account manager and no translation layer between what you ask for and what gets written.',10,1),
('Your money goes into the build',
 'Not into a pitch deck about the build. Infrastructure is registered in your name from day one, and we hand over the repository, the accounts and the operational knowledge when it ships.',20,1),
('Scope and price in writing first',
 'Agreed before any code is written, as a fixed figure. If the work turns out to be larger than we thought, that is our problem to solve rather than an invoice to send you.',30,1),
('Working software every week',
 'Not a status report and not a monthly demo. There is a real URL with the real thing on it, and you use it while we keep building.',40,1),
('We run what we build',
 'Monitoring, fixes and iteration after launch are part of the job rather than an upsell. Software we have never operated is software we cannot tell you anything useful about.',50,1),
('We push back on the brief',
 'Sometimes the right answer is less software, or none. We would rather say so at the start than take the money and build the wrong thing properly.',60,1);

-- ---------------------------------------------------------------------------
-- Editorial singleton.
-- ---------------------------------------------------------------------------

INSERT INTO site_content (id, faq, capabilities, process, services_intro, contact_blurb) VALUES (1,
'[
 {"question":"What do you build?","answer":"Web applications, mobile apps and products that run AI on the device. The creations section shows real, running software; the products section shows what we build and operate ourselves."},
 {"question":"Do you work with clients remotely?","answer":"Yes, entirely. We have never needed to be in the same room as a client to ship their software."},
 {"question":"How does a project start?","answer":"You describe the problem. We reply with questions, then a written scope and a fixed price. Nothing is billed until that document is agreed."},
 {"question":"How long does a project take?","answer":"It depends entirely on scope, and we will say so rather than guess. A marketing site is weeks. An application is months. You get a real range before you commit to anything."},
 {"question":"What does a project cost?","answer":"Each service on this site carries a published range. Those are real, and they are the range rather than a floor — a scope that lands above it usually means the problem is bigger than the brief described."},
 {"question":"Do you maintain projects after launch?","answer":"Yes, as a monthly arrangement you can cancel with thirty days notice. We would rather fix something while it is still small than be called back in once it is not."},
 {"question":"Can you work with an existing codebase?","answer":"Often. We read it first and tell you honestly whether continuing is cheaper than rebuilding — sometimes it clearly is, and sometimes it clearly is not."},
 {"question":"Can you build an MVP?","answer":"Yes, although we will argue for a smaller scope than you asked for. Something small that ships is worth more than something large that does not."},
 {"question":"Can you integrate AI?","answer":"Where it genuinely improves the product. We will also tell you when a rule-based system would be cheaper, faster and more predictable — which is more often than the question implies."},
 {"question":"Who owns the code?","answer":"You do, entirely, from the first commit. Repository, infrastructure, domains and accounts are yours, and we hand over the operational knowledge as well as the files."}
]',
'[
 {"group":"Frontend","items":["TypeScript","Astro","React","CSS architecture","Accessibility","Motion"]},
 {"group":"Mobile","items":["React Native","Expo","Flutter","Offline-first storage","Native widgets"]},
 {"group":"Backend","items":["APIs","Node","Go","PostgreSQL","SQLite","Authentication"]},
 {"group":"AI","items":["On-device inference","Retrieval","Evaluation sets","Cost ceilings"]},
 {"group":"Infrastructure","items":["Cloudflare","Docker","CI/CD","Observability","Crash reporting"]}
]',
'[
 {"phase":"Scope","detail":"A written description of what is being built and, more usefully, what is not. Most disagreements are settled here rather than during the build."},
 {"phase":"Shape","detail":"Architecture and design agreed before anything is written, so the expensive decisions are made while they are still cheap to change."},
 {"phase":"Build","detail":"Working software on a real URL throughout. You are using the thing while we are still building it."},
 {"phase":"Check","detail":"Performance, accessibility and the awkward cases, measured on real hardware rather than a developer laptop."},
 {"phase":"Launch","detail":"Deployed, monitored, and documented well enough that another developer could take it over without us."},
 {"phase":"Keep","detail":"Fixes and iteration after launch, as an arrangement rather than a favour."}
]',
'You can see what each service produces and roughly what it costs before you write to us. Nothing here is a starting price designed to become an invoice.',
'Describe the problem, the timeline and the budget range. We reply to everything, usually within a couple of days, with a straight answer about whether it is a fit.');
