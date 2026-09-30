-- =============================================================================
-- Studio site content model
--
-- Design notes:
--  * Every table has a `published` flag so content can be staged before it is
--    visible, and so removing a project never requires a schema change.
--  * JSON columns hold small, read-only structured blobs (link sets, credits,
--    the preview descriptor). D1 has no JSON type; storing TEXT keeps the
--    schema honest about what it is and the app layer validates on write.
--  * There are NO seeded rows. The site ships with real designed empty states
--    rather than fabricated projects, clients, testimonials or metrics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL,
  -- Canonical live URL of the thing itself. The only required field besides a
  -- slug: adding a project should mean pasting a URL.
  url            TEXT    NOT NULL,
  blurb          TEXT,                       -- one line, shown on the card
  summary        TEXT,                       -- opening paragraph for the case study
  category       TEXT    NOT NULL DEFAULT 'web',
  technologies   TEXT    NOT NULL DEFAULT '[]',  -- JSON string[]
  year           INTEGER,
  status         TEXT    NOT NULL DEFAULT 'live'
                 CHECK (status IN ('live','in-progress','archived','private','experiment')),
  kind           TEXT    NOT NULL DEFAULT 'web'
                 CHECK (kind IN ('web','webapp','mobile','saas','ai','experiment','client','internal')),
  featured       INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  published      INTEGER NOT NULL DEFAULT 0,
  has_case_study INTEGER NOT NULL DEFAULT 0,

  -- Case study body. Markdown, rendered at request time.
  body_md        TEXT,
  challenge_md   TEXT,
  approach_md    TEXT,
  outcome_md     TEXT,
  -- JSON: [{ role, name, href? }] — credits name real people, clients included.
  credits        TEXT    NOT NULL DEFAULT '[]',
  -- JSON: { github?, instagram?, caseStudy?, store?, demo? }
  links          TEXT    NOT NULL DEFAULT '{}',
  -- JSON: { label, value, note? } — only when genuinely measured.
  metrics        TEXT,
  -- JSON: [{ src, alt, width, height, caption? }]
  gallery        TEXT    NOT NULL DEFAULT '[]',
  -- Per-card media ratio, e.g. 1.6 or 0.88. Content-driven, not one global size.
  aspect_ratio   REAL    NOT NULL DEFAULT 1.6,

  -- Preview descriptor, written by the capture pipeline.
  -- JSON: {
  --   thumb?, thumbSrcset?, poster?, video?, videoPoster?, og?, favicon?,
  --   dominant? (hex), width?, height?, frameable?, checkedAt?, source?
  -- }
  preview        TEXT    NOT NULL DEFAULT '{}',
  -- queued | metadata | capturing | ready | partial | failed
  preview_state  TEXT    NOT NULL DEFAULT 'queued'
                 CHECK (preview_state IN ('queued','metadata','capturing','ready','partial','failed')),

  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_published  ON projects (published, sort_order);
CREATE INDEX IF NOT EXISTS idx_projects_featured   ON projects (published, featured);
CREATE INDEX IF NOT EXISTS idx_projects_kind       ON projects (kind);
CREATE INDEX IF NOT EXISTS idx_projects_preview    ON projects (preview_state);

-- Trigger keeps updated_at honest without every writer remembering to set it.
CREATE TRIGGER IF NOT EXISTS trg_projects_updated
AFTER UPDATE ON projects
FOR EACH ROW
BEGIN
  UPDATE projects SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT    NOT NULL UNIQUE,
  name      TEXT    NOT NULL,
  role      TEXT    NOT NULL,
  bio       TEXT,
  -- JSON: { order: string[] }
  focus     TEXT    NOT NULL DEFAULT '[]',
  -- JSON: { label, href }[]
  links     TEXT    NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 1
);

-- -----------------------------------------------------------------------------

-- Ships empty by design. No invented quotes, names, companies or ratings.
CREATE TABLE IF NOT EXISTS testimonials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote      TEXT    NOT NULL,
  author     TEXT    NOT NULL,
  role       TEXT,
  company    TEXT,
  -- Optional: a link to a real published mention.
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS instagram_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  permalink   TEXT    NOT NULL,
  -- Studio-owned screenshot. We host it; no Meta embed, no third-party JS.
  image_key   TEXT,
  caption     TEXT,
  -- JSON: { width, height }
  image       TEXT,
  posted_at   TEXT,
  -- Links the post back to the project it announced, when it did.
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  -- What the client ends up with, in outcome terms. Not a technology list.
  outcome    TEXT    NOT NULL,
  deliverables TEXT  NOT NULL DEFAULT '[]',  -- JSON string[]
  sort_order INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 1
);

-- -----------------------------------------------------------------------------

-- Singleton row (id = 1). Single place for the FAQ, capabilities, and the
-- social/contact details that the admin surface edits.
CREATE TABLE IF NOT EXISTS site_content (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  -- JSON: { question, answer }[]  — an editorial list, not an accordion.
  faq          TEXT NOT NULL DEFAULT '[]',
  -- JSON: { group, items: string[] }[]
  capabilities TEXT NOT NULL DEFAULT '[]',
  -- JSON: { phase, detail }[]  — a schematic track, not numbered steps.
  process      TEXT NOT NULL DEFAULT '[]',
  services_intro TEXT,
  contact_blurb  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------

-- Capture jobs. A D1 table rather than Cloudflare Queues: at the rate a
-- two-person studio publishes, a queue product buys nothing this does not, and
-- this keeps retries, backoff and observability in the same database we
-- already query. See docs/architecture.md for the upgrade trigger.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL DEFAULT 'preview'
              CHECK (kind IN ('preview','metadata','video')),
  state       TEXT    NOT NULL DEFAULT 'pending'
              CHECK (state IN ('pending','running','done','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  -- Earliest time the dispatcher may pick this up (exponential backoff).
  run_after   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_error  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_dispatch ON jobs (state, run_after);

CREATE TRIGGER IF NOT EXISTS trg_jobs_updated
AFTER UPDATE ON jobs
FOR EACH ROW
BEGIN
  UPDATE jobs SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- -----------------------------------------------------------------------------

-- Contact submissions. Stored so a lead is never lost if email delivery fails.
CREATE TABLE IF NOT EXISTS enquiries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL,
  company      TEXT,
  project_type TEXT,
  budget       TEXT,
  timeline     TEXT,
  message      TEXT    NOT NULL,
  -- JSON: { userAgent?, referer? }  — no IP stored, no third-party data.
  context      TEXT,
  delivered    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------

-- Per-IP submission accounting for the token bucket. Deliberately not the raw
-- IP: we store a truncated one-way hash so the rate limit works without
-- retaining a personal identifier.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT    NOT NULL,
  identifier  TEXT    NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT   NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bucket, identifier)
);
