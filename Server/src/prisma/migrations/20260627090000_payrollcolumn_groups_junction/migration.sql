-- Make a payroll column's "Calculation Group" a many-to-many relationship via a junction table,
-- replacing the single payrollcolumns.deduction_group BigInt. A column with no rows here is
-- universal (runs for all employees), preserving the old NULL = universal behaviour.

CREATE TABLE IF NOT EXISTS `payrollcolumn_groups` (
  `id`               BIGINT NOT NULL AUTO_INCREMENT,
  `payrollcolumn_id` INT    NOT NULL,
  `group_id`         BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pcg_col_group` (`payrollcolumn_id`, `group_id`),
  KEY `idx_pcg_group` (`group_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill one junction row per column that currently has a single calculation group.
INSERT IGNORE INTO `payrollcolumn_groups` (`payrollcolumn_id`, `group_id`)
SELECT `id`, `deduction_group` FROM `payrollcolumns` WHERE `deduction_group` IS NOT NULL;

ALTER TABLE `payrollcolumns` DROP COLUMN `deduction_group`;
