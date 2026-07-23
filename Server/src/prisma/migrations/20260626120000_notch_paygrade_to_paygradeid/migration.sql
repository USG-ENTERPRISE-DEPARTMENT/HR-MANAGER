-- Convert notches.paygrade (a soft string reference to a paygrade) into notches.paygradeId
-- (a proper BIGINT foreign id). Data-preserving: backfill the id BEFORE dropping the old column.
-- The legacy `paygrade` string may hold either the paygrade id (as text, e.g. "1") or the paygrade
-- name (e.g. "Band 1") depending on the data source, so the backfill resolves both. Notches whose
-- value matches no paygrade are left with paygradeId = NULL.

ALTER TABLE `notches` ADD COLUMN `paygradeId` BIGINT NULL;

UPDATE `notches` n
  JOIN `paygrades` p
    ON ( (n.paygrade REGEXP '^[0-9]+$' AND p.id = CAST(n.paygrade AS UNSIGNED))
      OR (NOT n.paygrade REGEXP '^[0-9]+$' AND p.name = n.paygrade) )
  SET n.paygradeId = p.id;

ALTER TABLE `notches` DROP COLUMN `paygrade`;
