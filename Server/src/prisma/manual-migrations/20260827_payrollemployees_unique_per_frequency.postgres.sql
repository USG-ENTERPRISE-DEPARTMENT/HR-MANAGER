-- Allow an employee to sit on more than one pay frequency, but never twice on the same one.
--
-- WHY
--
-- payrollemployees previously held one row per employee, enforced only in application code
-- (calculationController: "This employee already has a payroll record"). That blocked a legitimate
-- case: someone paid Monthly who is ALSO on a Mid-Month frequency — two genuinely separate
-- payments, not a duplicate.
--
-- What must stay impossible is two rows for the same employee on the SAME frequency, because
-- generatePayroll selects employees by frequency, so a duplicate there pays that person twice in a
-- single run. This constraint is the guarantee; the application checks are the friendly message.
--
-- Safe to add: verified zero (employee, pay_frequency) duplicates before applying.
--
-- Note the constraint does NOT cover rows where pay_frequency is NULL — Postgres treats NULLs as
-- distinct in a unique index, so several frequency-less rows for one employee would still be
-- possible. pay_frequency is required by the API on both create and update, so that is not a path
-- the application can produce.

CREATE UNIQUE INDEX IF NOT EXISTS payrollemployees_employee_frequency_key
  ON payrollemployees (employee, pay_frequency);
