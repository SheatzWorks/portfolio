-- =============================================================================
-- Studio site: own products vs client work, full case-study depth, pricing.
--
-- Design decisions
-- ---------------
--  * ONE `projects` table, not a second table for products. A separate table
--    would duplicate the entire preview pipeline, the admin surface and the
--    case-study machinery in order to store a handful of extra columns.
--  * `ownership` is the discriminator. 'own' means sheatz designed, built and
--    operates it. 'client' means it was commissioned. It drives /products vs
--    /work and it is the only honest way to present the difference.
--  * Every case-study field added here is a field the template can already
--    render. The previous migration shipped columns that no code path could
--    ever write, which made the strongest template in the repo unreachable.
--  * Added columns are nullable with sensible defaults, so existing rows keep
--    working and nothing needs a backfill.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Projects: ownership, product status, and the full narrative arc.
-- ---------------------------------------------------------------------------

-- Who owns it. DEFAULT 'client' so every pre-existing row keeps its meaning.
ALTER TABLE projects ADD COLUMN ownership TEXT NOT NULL DEFAULT 'client'
  CHECK (ownership IN ('client','own'));

-- Product lifecycle. NULL for client work, where it is meaningless.
-- 'planning' is deliberate: it lets a product be listed honestly before it is
-- shippable, which is better than either hiding it or over-claiming it.
ALTER TABLE projects ADD COLUMN product_status TEXT
  CHECK (product_status IN ('planning','in-development','beta','live','paused','retired'));

-- Where someone can try it. Only meaningful once product_status is live/beta.
ALTER TABLE projects ADD COLUMN availability_url TEXT;

-- One line for the product card. Distinct from `blurb`, which is tuned for a
-- project card: this is tuned for "what is this thing and what state is it in".
ALTER TABLE projects ADD COLUMN tagline TEXT;

-- The case-study arc. `body_md` remains the general narrative; these are the
-- structured beats that let a case study read as an argument rather than a wall.
ALTER TABLE projects ADD COLUMN objective_md  TEXT;  -- what success looked like
ALTER TABLE projects ADD COLUMN design_md     TEXT;  -- design decisions and why
ALTER TABLE projects ADD COLUMN engineering_md TEXT;  -- architecture, trade-offs
ALTER TABLE projects ADD COLUMN challenges_md TEXT;  -- what was genuinely hard
ALTER TABLE projects ADD COLUMN lessons_md    TEXT;  -- what we'd do differently

-- Index for the /work vs /products split.
CREATE INDEX IF NOT EXISTS idx_projects_ownership
  ON projects (ownership, published, sort_order);

-- ---------------------------------------------------------------------------
-- Services: published price ranges.
--
-- Publishing a range is a filter, not a risk. It sorts out mismatched
-- enquiries before they cost either side a call. `price_note` exists so the
-- qualifier can be stated honestly next to the number rather than hidden.
-- ---------------------------------------------------------------------------

ALTER TABLE services ADD COLUMN price_from   TEXT;
ALTER TABLE services ADD COLUMN price_to     TEXT;
ALTER TABLE services ADD COLUMN price_note   TEXT;
ALTER TABLE services ADD COLUMN engagement  TEXT;  -- e.g. "Fixed scope" / "Ongoing"
ALTER TABLE services ADD COLUMN is_signature INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Editorial: differentiators.
--
-- A separate table because they are ordered, individually editable, and
-- genuinely distinct from the process phases. Rendering them from a JSON blob
-- in site_content made them unorderable and unlinkable.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS differentiators (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,           -- short title, e.g. "You own the code"
  body       TEXT    NOT NULL,           -- one short paragraph, plain language
  sort_order INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Enquiries: which service they are about.
--
-- The contact form has never known what someone is asking about beyond a free
-- text project_type, so enquiries could not be sorted or answered in order.
-- ---------------------------------------------------------------------------

ALTER TABLE enquiries ADD COLUMN service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
