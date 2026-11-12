-- Hospital claims carry the hospital's invoice number, so the same invoice can't be claimed twice. Idempotent.
--
-- hospitalclaims.invoice_no: the invoice number as typed. The app refuses a claim whose invoice number
--   (compared ignoring case, spaces and punctuation, so "INV-0012" = "inv 0012") is already on another
--   claim from the SAME hospital that wasn't rejected. Older claims keep NULL; an old Draft must be given
--   an invoice number before it can be submitted.

ALTER TABLE hospitalclaims ADD COLUMN IF NOT EXISTS invoice_no VARCHAR(50) NULL;
CREATE INDEX IF NOT EXISTS hospitalclaims_hospital_invoice_idx ON hospitalclaims (hospital, invoice_no);
