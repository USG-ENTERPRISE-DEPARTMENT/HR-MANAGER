-- Salary components move from per-employee to paygrade/notch assignment (inherited) + per-employee
-- exceptions. The data backup + clear of employeesalary is done by the accompanying Node apply
-- script (idempotent, guarded by the existence of employeesalary_backup); this file records the DDL.

CREATE TABLE IF NOT EXISTS `paygrade_components` (
  `id`           BIGINT NOT NULL AUTO_INCREMENT,
  `paygrade_id`  BIGINT NOT NULL,
  `component_id` BIGINT NOT NULL,
  `amount`       DECIMAL(30,2) NULL,
  `working_days` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pgc_grade_comp` (`paygrade_id`, `component_id`),
  KEY `idx_pgc_component` (`component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notch_components` (
  `id`           BIGINT NOT NULL AUTO_INCREMENT,
  `notch_id`     BIGINT NOT NULL,
  `component_id` BIGINT NOT NULL,
  `amount`       DECIMAL(30,2) NULL,
  `working_days` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ntc_notch_comp` (`notch_id`, `component_id`),
  KEY `idx_ntc_component` (`component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employeesalary` ADD COLUMN `excluded` TINYINT(1) NOT NULL DEFAULT 0;

-- (script) back up + clear existing per-employee rows:
--   CREATE TABLE employeesalary_backup AS SELECT * FROM employeesalary;
--   DELETE FROM employeesalary;
