-- Hospital claims carry the hospital's invoice number. See 20261111_hospitalclaim_invoice.postgres.sql.
-- Re-running fails with "Duplicate column" / "Duplicate key name" — harmless.

ALTER TABLE hospitalclaims ADD COLUMN invoice_no VARCHAR(50) NULL;
CREATE INDEX hospitalclaims_hospital_invoice_idx ON hospitalclaims (hospital, invoice_no);
