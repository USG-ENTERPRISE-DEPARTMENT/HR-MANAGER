-- The settings.category column was VARCHAR(15), which silently truncated any
-- category longer than 15 chars on write, e.g.:
--   'leave_approval_flow'      (19) -> 'leave_approval_'
--   'document_settings'        (17) -> 'document_settin'
--   'leave_threshold_approval' (24) -> 'leave_threshold'
-- Readers query the full category string, so the truncated rows never matched and
-- those settings appeared to "not save" (always read as their default). The broken
-- upsert also re-inserted instead of updating, piling up duplicate rows.
-- Widen the column so full category names are stored intact.
ALTER TABLE settings MODIFY category VARCHAR(64) NOT NULL;

-- Leave approval flow: drop the truncated rows; the app re-creates this on demand
-- (defaults to supervisor approval = No). Safe to re-run / no-op on a clean DB.
DELETE FROM settings WHERE category = 'leave_approval_';

-- Document settings & leave threshold approval: preserve the configured value by
-- restoring the full category name. First collapse duplicates (keep the latest row
-- per name), then rename the truncated category back to its full form.
DELETE s1 FROM settings s1
  JOIN settings s2 ON s1.name = s2.name AND s1.category = s2.category AND s1.id < s2.id
  WHERE s1.category = 'document_settin';
UPDATE settings SET category = 'document_settings' WHERE category = 'document_settin';

DELETE s1 FROM settings s1
  JOIN settings s2 ON s1.name = s2.name AND s1.category = s2.category AND s1.id < s2.id
  WHERE s1.category = 'leave_threshold';
UPDATE settings SET category = 'leave_threshold_approval' WHERE category = 'leave_threshold';
