-- Separate payslip presentation from the payroll report, and let a column print on the opposite
-- side of the payslip from the side it calculates on.
--
-- WHY
--
-- 1. payslip_settings.payslip_columns
--    One field, payslip_settings.visible_columns, drove BOTH surfaces: payslipController builds the
--    printed column list from it, and Payroll.tsx builds the payroll grid + Excel export from the
--    same value. So hiding "NASSIT (10% Payment)" from the payslip also deleted it from the payroll
--    report, which is not what anyone wants. payslip_columns is the payslip's own list;
--    visible_columns keeps its existing meaning for the grid.
--
--    NULL means "fall back to visible_columns", so every existing template renders exactly as it
--    does today until someone edits it. That is deliberate: the change must be invisible until
--    opted into.
--
-- 2. payrollcolumns.payslip_section
--    The payslip splits Earnings from Deductions strictly on payment_deduction. Employer NASSIT is
--    stored as a matched pair — a Payment and a Deduction of the same amount, both posting to the
--    GL — so it nets to zero for the employee, but payslips conventionally list the employer half
--    under Deductions for transparency. This overrides the printed side only. It never affects the
--    calculation, and never affects the GL (posting_column is the only GL gate).
--
--    NULL = use payment_deduction. 'earnings' | 'deductions' = force that side.
--    'info' = print in a separate information block, outside both subtotals.
--
-- 3. payrollcolumns.payslip_in_total
--    Consulted ONLY when payslip_section moves a column off its natural side. Defaults to FALSE so
--    a moved employer contribution is shown but not counted — which keeps the printed Net Salary
--    equal to what the employee is actually paid. Set it TRUE per column when a moved amount really
--    should count toward the subtotal it now sits under.
--
-- All three are additive and nullable/defaulted, so this is safe to run BEFORE the code deploys —
-- and it must be, or writing the new fields fails with 42703 (column does not exist).

ALTER TABLE payslip_settings ADD COLUMN IF NOT EXISTS payslip_columns TEXT NULL;

ALTER TABLE payrollcolumns   ADD COLUMN IF NOT EXISTS payslip_section  VARCHAR(20) NULL;
ALTER TABLE payrollcolumns   ADD COLUMN IF NOT EXISTS payslip_in_total BOOLEAN NOT NULL DEFAULT FALSE;
