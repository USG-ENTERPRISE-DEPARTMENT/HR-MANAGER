-- dependentmedical: widen free-text columns that were too short. Safe to re-run.
-- See 20261119_dependentmedical_widen_text.postgres.sql — dependant_name VARCHAR(20) rejected any
-- dependant name over 20 characters on POST /medical/dependents.

ALTER TABLE dependentmedical
  MODIFY COLUMN dependant_name   VARCHAR(150) NOT NULL,
  MODIFY COLUMN type_of_illness  VARCHAR(255) NOT NULL,
  MODIFY COLUMN medication_given VARCHAR(500) NOT NULL,
  MODIFY COLUMN hospital         VARCHAR(150) NOT NULL,
  MODIFY COLUMN physician        VARCHAR(150) NULL;
