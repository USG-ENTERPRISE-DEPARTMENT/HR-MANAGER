-- Access log for the mobile-authenticated payroll lookup
-- (GET /v1/api/hr/payroll/runs/by-reference/:reference).
--
-- That endpoint uses the shared-key + x-employee-id model (see middleware/mobileAuth.js), where
-- identity is NOT cryptographically bound to the caller. This table is the per-endpoint record of
-- who asked for what: without it, a leaked key reading whole payroll runs leaves no specific trail.
--
-- `employee` is the caller (the x-employee-id they presented), NOT the employees contained in the
-- returned run. `outcome` records what actually happened so denied attempts are logged too — a
-- burst of 'not_found' rows is what probing for valid references looks like.

CREATE TABLE IF NOT EXISTS payroll_api_access_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  employee BIGINT NULL,                       -- caller's numeric employee id (NULL if unresolved)
  employee_code VARCHAR(20) NULL,             -- staff-facing code as resolved at call time
  employee_name VARCHAR(200) NULL,            -- denormalised: survives later renames
  reference VARCHAR(100) NULL,                -- the GL reference that was requested
  payroll_run BIGINT NULL,                    -- resolved run id, NULL when the lookup missed
  outcome VARCHAR(20) NOT NULL,               -- ok | not_found | bad_request
  employee_count INT NULL,                    -- rows returned, so payload size is visible
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX payroll_api_access_log_employee_idx (employee, created_at),
  INDEX payroll_api_access_log_reference_idx (reference),
  INDEX payroll_api_access_log_created_at_idx (created_at)
);
