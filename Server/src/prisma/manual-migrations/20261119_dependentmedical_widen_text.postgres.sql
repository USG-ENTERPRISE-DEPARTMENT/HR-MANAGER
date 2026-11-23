-- dependentmedical: widen free-text columns that were too short. Idempotent, widen-only.
--
-- dependant_name was VARCHAR(20) and is filled from the dependants register, so any dependant whose
-- name is over 20 characters made POST /medical/dependents fail with Prisma's "The provided value for
-- the column is too long for the column's type". medication_given / type_of_illness / hospital /
-- physician (VARCHAR(50)) fail the same way on longer text typed in the mobile app.
--
-- Each column is altered only when it is currently shorter than the target, so re-running is a no-op
-- and a column someone already widened further is never shrunk.

BEGIN;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('dependant_name',   150),
    ('type_of_illness',  255),
    ('medication_given', 500),
    ('hospital',         150),
    ('physician',        150)
  ) AS v(col, len)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'dependentmedical'
                  AND column_name = t.col AND character_maximum_length < t.len) THEN
      EXECUTE format('ALTER TABLE dependentmedical ALTER COLUMN %I TYPE VARCHAR(%s)', t.col, t.len);
    END IF;
  END LOOP;
END $$;

COMMIT;
