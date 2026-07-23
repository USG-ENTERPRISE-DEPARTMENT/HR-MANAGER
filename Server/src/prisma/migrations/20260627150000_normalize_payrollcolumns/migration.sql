-- Normalize payrollcolumns: replace name-based CSV references with id-based junction tables, drop
-- dead columns, and tokenize the formula. The DATA backfill (CSV name -> id) and formula
-- tokenization are performed by the accompanying Node apply script (they need name matching that is
-- impractical in pure SQL); this file records the structural change. Order: create tables, backfill
-- (script), tokenize calculation_function (script), then drop the old columns below.

CREATE TABLE IF NOT EXISTS `payrollcolumn_components` (
  `id`               BIGINT NOT NULL AUTO_INCREMENT,
  `payrollcolumn_id` INT    NOT NULL,
  `component_id`     BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pcc_col_comp` (`payrollcolumn_id`, `component_id`),
  KEY `idx_pcc_component` (`component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payrollcolumn_links` (
  `id`               BIGINT NOT NULL AUTO_INCREMENT,
  `payrollcolumn_id` INT    NOT NULL,
  `target_column_id` INT    NOT NULL,
  `operation`        VARCHAR(10) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pcl_col_target_op` (`payrollcolumn_id`, `target_column_id`, `operation`),
  KEY `idx_pcl_target` (`target_column_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- (script backfills payrollcolumn_components / payrollcolumn_links and tokenizes calculation_function here)

ALTER TABLE `payrollcolumns` DROP COLUMN `salary_components`;
ALTER TABLE `payrollcolumns` DROP COLUMN `add_columns`;
ALTER TABLE `payrollcolumns` DROP COLUMN `sub_columns`;
ALTER TABLE `payrollcolumns` DROP COLUMN `deductions`;
ALTER TABLE `payrollcolumns` DROP COLUMN `calculation_columns`;
ALTER TABLE `payrollcolumns` DROP COLUMN `calculation_hook`;
ALTER TABLE `payrollcolumns` DROP COLUMN `pay_frequency`;
