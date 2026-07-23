-- Migrate codelist / codelistvalue primary keys from cuid VARCHAR to INT (auto-increment),
-- preserving data and remapping every foreign-key reference. Postgres variant.
--
-- Run once against the Postgres DB. Idempotent-ish: guarded so a re-run after full success is a
-- no-op (checks the id column type first). Wrap in a transaction — Postgres DDL is transactional.

BEGIN;

DO $$
BEGIN
  -- Skip if already migrated (codelistvalue.id is already integer).
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'codelistvalue' AND column_name = 'id') = 'integer' THEN
    RAISE NOTICE 'codelistvalue.id already integer — nothing to do';
    RETURN;
  END IF;

  -- 1. Mapping tables: old cuid -> new sequential int.
  DROP TABLE IF EXISTS _clmap;
  CREATE TABLE _clmap AS
    SELECT id AS old_id, row_number() OVER (ORDER BY id)::int AS new_id FROM codelist;
  DROP TABLE IF EXISTS _cvmap;
  CREATE TABLE _cvmap AS
    SELECT id AS old_id, row_number() OVER (ORDER BY id)::int AS new_id FROM codelistvalue;

  -- 2. Drop the FK from codelistvalue -> codelist.
  ALTER TABLE codelistvalue DROP CONSTRAINT IF EXISTS codelistvalue_codelistid_fkey;
  ALTER TABLE codelistvalue DROP CONSTRAINT IF EXISTS "codelistvalue_codeListId_fkey";

  -- 3. Rewrite each FK column: add int, populate via the value map, drop old, rename.
  --    (Column names are lowercase in Postgres.)
  PERFORM 1;
END $$;

-- Helper: remap one FK column. Done inline (Postgres has no easy loop over identifiers in plain SQL),
-- so each column is handled explicitly below.

-- employee (8 columns)
ALTER TABLE employee ADD COLUMN titleid__int INT;
UPDATE employee e SET titleid__int = m.new_id FROM _cvmap m WHERE e.titleid = m.old_id;
ALTER TABLE employee DROP COLUMN titleid;
ALTER TABLE employee RENAME COLUMN titleid__int TO titleid;

ALTER TABLE employee ADD COLUMN genderid__int INT;
UPDATE employee e SET genderid__int = m.new_id FROM _cvmap m WHERE e.genderid = m.old_id;
ALTER TABLE employee DROP COLUMN genderid;
ALTER TABLE employee RENAME COLUMN genderid__int TO genderid;

ALTER TABLE employee ADD COLUMN jobtitleid__int INT;
UPDATE employee e SET jobtitleid__int = m.new_id FROM _cvmap m WHERE e.jobtitleid = m.old_id;
ALTER TABLE employee DROP COLUMN jobtitleid;
ALTER TABLE employee RENAME COLUMN jobtitleid__int TO jobtitleid;

ALTER TABLE employee ADD COLUMN nationalityid__int INT;
UPDATE employee e SET nationalityid__int = m.new_id FROM _cvmap m WHERE e.nationalityid = m.old_id;
ALTER TABLE employee DROP COLUMN nationalityid;
ALTER TABLE employee RENAME COLUMN nationalityid__int TO nationalityid;

ALTER TABLE employee ADD COLUMN religionid__int INT;
UPDATE employee e SET religionid__int = m.new_id FROM _cvmap m WHERE e.religionid = m.old_id;
ALTER TABLE employee DROP COLUMN religionid;
ALTER TABLE employee RENAME COLUMN religionid__int TO religionid;

ALTER TABLE employee ADD COLUMN employmentstatusid__int INT;
UPDATE employee e SET employmentstatusid__int = m.new_id FROM _cvmap m WHERE e.employmentstatusid = m.old_id;
ALTER TABLE employee DROP COLUMN employmentstatusid;
ALTER TABLE employee RENAME COLUMN employmentstatusid__int TO employmentstatusid;

ALTER TABLE employee ADD COLUMN staff_level__int INT;
UPDATE employee e SET staff_level__int = m.new_id FROM _cvmap m WHERE e.staff_level = m.old_id;
ALTER TABLE employee DROP COLUMN staff_level;
ALTER TABLE employee RENAME COLUMN staff_level__int TO staff_level;

ALTER TABLE employee ADD COLUMN staff_role__int INT;
UPDATE employee e SET staff_role__int = m.new_id FROM _cvmap m WHERE e.staff_role = m.old_id;
ALTER TABLE employee DROP COLUMN staff_role;
ALTER TABLE employee RENAME COLUMN staff_role__int TO staff_role;

-- relation tables
ALTER TABLE employeecertifications ADD COLUMN certification_id__int INT;
UPDATE employeecertifications t SET certification_id__int = m.new_id FROM _cvmap m WHERE t.certification_id = m.old_id;
ALTER TABLE employeecertifications DROP COLUMN certification_id;
ALTER TABLE employeecertifications RENAME COLUMN certification_id__int TO certification_id;

ALTER TABLE employeeeducations ADD COLUMN education_id__int INT;
UPDATE employeeeducations t SET education_id__int = m.new_id FROM _cvmap m WHERE t.education_id = m.old_id;
ALTER TABLE employeeeducations DROP COLUMN education_id;
ALTER TABLE employeeeducations RENAME COLUMN education_id__int TO education_id;

ALTER TABLE employeelanguages ADD COLUMN language_id__int INT;
UPDATE employeelanguages t SET language_id__int = m.new_id FROM _cvmap m WHERE t.language_id = m.old_id;
ALTER TABLE employeelanguages DROP COLUMN language_id;
ALTER TABLE employeelanguages RENAME COLUMN language_id__int TO language_id;

ALTER TABLE employeeskills ADD COLUMN skill_id__int INT;
UPDATE employeeskills t SET skill_id__int = m.new_id FROM _cvmap m WHERE t.skill_id = m.old_id;
ALTER TABLE employeeskills DROP COLUMN skill_id;
ALTER TABLE employeeskills RENAME COLUMN skill_id__int TO skill_id;

-- transfers (2 columns)
ALTER TABLE employeetransfers ADD COLUMN current_job_title__int INT;
UPDATE employeetransfers t SET current_job_title__int = m.new_id FROM _cvmap m WHERE t.current_job_title = m.old_id;
ALTER TABLE employeetransfers DROP COLUMN current_job_title;
ALTER TABLE employeetransfers RENAME COLUMN current_job_title__int TO current_job_title;

ALTER TABLE employeetransfers ADD COLUMN proposed_job_title__int INT;
UPDATE employeetransfers t SET proposed_job_title__int = m.new_id FROM _cvmap m WHERE t.proposed_job_title = m.old_id;
ALTER TABLE employeetransfers DROP COLUMN proposed_job_title;
ALTER TABLE employeetransfers RENAME COLUMN proposed_job_title__int TO proposed_job_title;

-- 4. codelistvalue.codelistid cuid -> int (drop composite uniques first).
ALTER TABLE codelistvalue DROP CONSTRAINT IF EXISTS "codelistvalue_codeListId_code_key";
ALTER TABLE codelistvalue DROP CONSTRAINT IF EXISTS "codelistvalue_codeListId_label_key";
ALTER TABLE codelistvalue ADD COLUMN codelistid__int INT;
UPDATE codelistvalue v SET codelistid__int = m.new_id FROM _clmap m WHERE v.codelistid = m.old_id;
ALTER TABLE codelistvalue DROP COLUMN codelistid;
ALTER TABLE codelistvalue RENAME COLUMN codelistid__int TO codelistid;
ALTER TABLE codelistvalue ALTER COLUMN codelistid SET NOT NULL;

-- 5. Swap PKs to int + attach identity sequences.
-- codelist
ALTER TABLE codelist ADD COLUMN id__int INT;
UPDATE codelist c SET id__int = m.new_id FROM _clmap m WHERE c.id = m.old_id;
ALTER TABLE codelist DROP CONSTRAINT codelist_pkey;
ALTER TABLE codelist DROP COLUMN id;
ALTER TABLE codelist RENAME COLUMN id__int TO id;
ALTER TABLE codelist ALTER COLUMN id SET NOT NULL;
ALTER TABLE codelist ADD PRIMARY KEY (id);

-- codelistvalue
ALTER TABLE codelistvalue ADD COLUMN id__int INT;
UPDATE codelistvalue v SET id__int = m.new_id FROM _cvmap m WHERE v.id = m.old_id;
ALTER TABLE codelistvalue DROP CONSTRAINT codelistvalue_pkey;
ALTER TABLE codelistvalue DROP COLUMN id;
ALTER TABLE codelistvalue RENAME COLUMN id__int TO id;
ALTER TABLE codelistvalue ALTER COLUMN id SET NOT NULL;
ALTER TABLE codelistvalue ADD PRIMARY KEY (id);

-- 6. Identity sequences so future inserts auto-increment past the current max.
CREATE SEQUENCE IF NOT EXISTS codelist_id_seq;
SELECT setval('codelist_id_seq', COALESCE((SELECT MAX(id) FROM codelist), 0) + 1, false);
ALTER TABLE codelist ALTER COLUMN id SET DEFAULT nextval('codelist_id_seq');
ALTER SEQUENCE codelist_id_seq OWNED BY codelist.id;

CREATE SEQUENCE IF NOT EXISTS codelistvalue_id_seq;
SELECT setval('codelistvalue_id_seq', COALESCE((SELECT MAX(id) FROM codelistvalue), 0) + 1, false);
ALTER TABLE codelistvalue ALTER COLUMN id SET DEFAULT nextval('codelistvalue_id_seq');
ALTER SEQUENCE codelistvalue_id_seq OWNED BY codelistvalue.id;

-- 7. Re-add composite uniques + the FK on the new int columns.
ALTER TABLE codelistvalue ADD CONSTRAINT "codelistvalue_codeListId_code_key"  UNIQUE (codelistid, code);
ALTER TABLE codelistvalue ADD CONSTRAINT "codelistvalue_codeListId_label_key" UNIQUE (codelistid, label);
ALTER TABLE codelistvalue ADD CONSTRAINT "codelistvalue_codeListId_fkey"
  FOREIGN KEY (codelistid) REFERENCES codelist(id) ON UPDATE CASCADE;

-- 8. Clean up mapping tables.
DROP TABLE IF EXISTS _clmap;
DROP TABLE IF EXISTS _cvmap;

COMMIT;
