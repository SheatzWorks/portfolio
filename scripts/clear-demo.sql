-- =============================================================================
-- Remove all demo content. Run against the REMOTE database before launch:
--
--     npx wrangler d1 execute studio --remote --file=./scripts/clear-demo.sql
--
-- The projects table is cleared entirely, including anything real you may have
-- added by hand. Take a backup first if that matters:
--
--     npx wrangler d1 export studio --remote --output backup.sql
-- =============================================================================

DELETE FROM jobs;
DELETE FROM instagram_posts;
DELETE FROM testimonials;
DELETE FROM services;
DELETE FROM team;
DELETE FROM site_content;
DELETE FROM projects;
DELETE FROM rate_limits;
