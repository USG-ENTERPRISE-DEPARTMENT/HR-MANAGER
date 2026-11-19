/**
 * Resolve a GL document reference to the NON-payroll record that produced it, returned in EXACTLY the
 * payroll run shape (getPayrollByReference), so the mobile app renders every module with one screen.
 *
 * Payroll runs are looked up by payrollRunController itself. Every other module that posts through
 * postToGL stores the reference the GL returned on its own row:
 *
 *   leave allowance    employeeleaves.documentref        (no underscore — legacy column)
 *   out of station     outofstation_requests.document_ref
 *   end of service     eos_settlements.document_ref
 *   staff medical      staffmedical.document_ref
 *   dependent medical  dependentmedical.document_ref
 *   hospital claim     hospitalclaims.document_ref
 *
 * How a record maps onto the payroll shape: each thing the journal paid becomes a "column" on the
 * employee — Payment for what the employee is owed (Dr expense), Deduction for what was withheld from
 * it (tax, EOS deductions) — so earnings - deductions = netPay is the amount credited to the employee,
 * exactly as in a payroll run. A column's glAccount is filled only where the account was STORED with
 * the record; otherwise it is null, which in the payroll shape already means "posted against the
 * configured default GL". Every payroll run field that has no counterpart is present and null, so no
 * key the app reads is ever missing. Module-specific extras go in `details`, which payroll omits.
 *
 * Raw SQL rules (Postgres is the live provider): every selected column is aliased in lower snake_case
 * so the result key is identical on both providers, and the employee is loaded in a second query
 * rather than joined, because staffmedical/dependentmedical hold the employee id as VARCHAR and
 * `bigint = varchar` is an error on Postgres.
 */
const { Prisma }            = require('@prisma/client');
const { prisma }            = require('./dbQueryHelper');
const { toBigInt }          = require('./controllerHelpers');
const { getSystemCurrency } = require('./settingsHelper');
const { getApiConfig }      = require('../controllers/apiIntegrationController');

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const str    = (v) => (v == null ? null : String(v));
const iso    = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const parse  = (txt, fallback) => { try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; } };
// A failed query is treated as "not in this module" so one missing table cannot break every lookup,
// but it is logged: silently empty raw SQL is how Postgres casing bugs hide as "not found".
const logMiss = (e) => { console.error('[gl reference lookup] query failed:', e.message); return []; };

/** id → { employeeId, employeeCode, name, bankAccount } for the given numeric employee ids. */
async function loadEmployees(ids) {
  const wanted = [...new Set(ids.map(toBigInt).filter(v => v != null).map(String))].map(BigInt);
  if (!wanted.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT e.id AS emp_id, e.employee_id AS emp_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS emp_name,
           e.bankAccount AS bank_account
      FROM employee e
     WHERE e.id IN (${Prisma.join(wanted)})`.catch(logMiss);
  return new Map(rows.map(r => [String(r.emp_id), {
    employeeId:   String(r.emp_id),
    employeeCode: r.emp_code || '',
    name:         r.emp_name || '',
    bankAccount:  r.bank_account || null,
  }]));
}

/** One setting value by name (the module GL branch settings), or '' when unset. */
async function settingValue(name) {
  const row = await prisma.settings
    .findFirst({ where: { name }, select: { value: true } })
    .catch(() => null);
  return row?.value ? String(row.value).trim() : '';
}

/**
 * An employee entry in payroll form. `columns` are { name, amount, type: 'Payment'|'Deduction',
 * glAccount }; zero amounts are dropped, as payroll drops zero cells. `bankAccount` overrides the
 * profile account when the record stored the account it actually credited.
 */
function employeeEntry(map, id, columns, bankAccount) {
  const e = map.get(String(id)) || { employeeId: str(id), employeeCode: '', name: '', bankAccount: null };
  return { ...e, bankAccount: bankAccount || e.bankAccount || null, columns: columns.filter(c => round2(c.amount) > 0) };
}

// End-of-service line item → the setting holding its GL (mirrors ITEM_GL_KEY in endOfServiceController).
const EOS_ITEM_GL_KEY = {
  leave_allowance: 'eos_leave_gl', rent_allowance: 'eos_rent_gl', clothing_allowance: 'eos_clothing_gl',
  final_salary: 'eos_salary_gl', notice_pay: 'eos_notice_gl', pf: 'eos_pf_gl',
};

// ── Resolvers ────────────────────────────────────────────────────────────────
// A column's glAccount is the account stored with the record when there is one; otherwise `glSetting`
// names the module setting the posting read it from, resolved at response time — the same way the
// payroll endpoint reports each column's GL from the current column configuration.
// Each returns { header, branchSetting, employees, netPayLine?, details } or null when the reference
// is not theirs. `header` carries the payroll run fields that have a counterpart on the record.

async function leave(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT el.id AS rec_id, el.employee AS emp, el.leave_name AS leave_name, el.date_start AS date_start,
           el.date_end AS date_end, el.status AS leave_status, el.allowance_status AS allowance_status,
           el.amount AS net_amount, el.leave_tax AS tax_amount, el.emp_acc_no AS emp_acc_no,
           el.documentref AS doc_ref, el.api_response AS api_response, el.posted_date AS created_at,
           el.approved_by AS approved_by
      FROM employeeleaves el
     WHERE el.documentref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const log  = parse(r.api_response, {});
  const net  = round2(r.net_amount);
  const tax  = round2(r.tax_amount);
  const emps = await loadEmployees([r.emp]);
  const emp  = emps.get(String(r.emp));
  return {
    module: 'leave', moduleLabel: 'Leave Allowance',
    header: {
      id: str(r.rec_id),
      name: ['Leave Allowance', emp?.name, r.leave_name].filter(Boolean).join(' - '),
      date_start: iso(r.date_start), date_end: iso(r.date_end),
      status: r.allowance_status || null, created_at: iso(r.created_at),
      approved_by: str(r.approved_by), finalized_at: log.posted_at || null,
      document_ref: r.doc_ref, payment_log: r.api_response || null,
    },
    branchSetting: null,
    employees: [employeeEntry(emps, r.emp, [
      // Stored with the posting, so these are the accounts the journal used.
      { name: r.leave_name ? `Leave Allowance - ${r.leave_name}` : 'Leave Allowance', amount: net + tax, type: 'Payment', glAccount: log.debit_gl || null, glSetting: 'leave_allow_debit_gl' },
      { name: 'Leave Allowance Tax', amount: tax, type: 'Deduction', glAccount: log.tax_gl || null, glSetting: 'leave_allow_tax_gl' },
    ], log.credit_acct || r.emp_acc_no)],
    details: { leaveName: r.leave_name || null, leaveStatus: r.leave_status || null },
  };
}

async function outOfStation(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT o.id AS rec_id, o.request_number AS req_no, o.employee AS emp, o.purpose AS purpose,
           o.location AS location, o.date_start AS date_start, o.date_end AS date_end, o.days AS days,
           o.daily_rate AS daily_rate, o.amount AS amount, o.account_no AS account_no, o.status AS status,
           o.document_ref AS doc_ref, o.payment_log AS payment_log, o.posted_at AS posted_at,
           o.created_at AS created_at, o.submitted_by AS submitted_by, o.approved_by AS approved_by,
           o.approved_at AS approved_at, o.rejection_reason AS rejection_reason
      FROM outofstation_requests o
     WHERE o.document_ref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const emps = await loadEmployees([r.emp]);
  return {
    module: 'out_of_station', moduleLabel: 'Out of Station',
    header: {
      id: str(r.rec_id),
      name: ['Out of Station', r.req_no, r.location].filter(Boolean).join(' - '),
      date_start: iso(r.date_start), date_end: iso(r.date_end),
      status: r.status, created_at: iso(r.created_at),
      submitted_by: str(r.submitted_by), approved_by: str(r.approved_by), approved_at: iso(r.approved_at),
      rejection_reason: r.rejection_reason || null, finalized_at: iso(r.posted_at),
      document_ref: r.doc_ref, payment_log: r.payment_log || null,
    },
    branchSetting: 'oos_gl_branch',
    employees: [employeeEntry(emps, r.emp, [
      { name: 'Out of Station Allowance', amount: r.amount, type: 'Payment', glAccount: null, glSetting: 'oos_expense_gl' },
    ], r.account_no)],
    details: {
      requestNumber: r.req_no, purpose: r.purpose, location: r.location,
      days: Number(r.days), dailyRate: round2(r.daily_rate),
    },
  };
}

async function endOfService(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT st.id AS rec_id, st.settlement_number AS settle_no, st.employee AS emp,
           st.exit_reason AS exit_reason, st.effective_date AS effective_date,
           st.eosb_amount AS eosb_amount, st.account_no AS account_no, st.status AS status,
           st.document_ref AS doc_ref, st.payment_log AS payment_log, st.posted_at AS posted_at,
           st.created_at AS created_at
      FROM eos_settlements st
     WHERE st.document_ref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const lines = await prisma.$queryRaw`
    SELECT l.line_type AS line_type, l.item_code AS item_code, l.description AS line_desc,
           l.amount AS amount, l.gl_account AS gl_account
      FROM eos_settlement_lines l
     WHERE l.settlement_id = ${toBigInt(r.rec_id)}
     ORDER BY l.sort_order, l.id`.catch(logMiss);

  const emps = await loadEmployees([r.emp]);
  const emp  = emps.get(String(r.emp));
  // Same legs as the posting: the EOSB, then each settlement line — additions pay the employee,
  // deductions are taken from them. A line with no gl_account posted to the module default.
  const columns = [
    { name: 'End of Service Benefit', amount: r.eosb_amount, type: 'Payment', glAccount: null, glSetting: 'eos_expense_gl' },
    ...lines.map(l => ({
      name: l.line_desc, amount: l.amount,
      type: l.line_type === 'addition' ? 'Payment' : 'Deduction',
      glAccount: l.gl_account || null, glSetting: EOS_ITEM_GL_KEY[l.item_code] || null,
    })),
  ];
  return {
    module: 'end_of_service', moduleLabel: 'End of Service',
    header: {
      id: str(r.rec_id),
      name: ['End of Service', r.settle_no, emp?.name].filter(Boolean).join(' - '),
      date_start: iso(r.effective_date), date_end: iso(r.effective_date),
      status: r.status, created_at: iso(r.created_at), finalized_at: iso(r.posted_at),
      document_ref: r.doc_ref, payment_log: r.payment_log || null,
    },
    branchSetting: 'eos_gl_branch',
    employees: [employeeEntry(emps, r.emp, columns, r.account_no)],
    details: { settlementNumber: r.settle_no, exitReason: r.exit_reason },
  };
}

/** staffmedical and dependentmedical share a shape; `dependent` adds the dependant's fields. */
async function medical(reference, dependent) {
  const rows = dependent
    ? await prisma.$queryRaw`
        SELECT m.id AS rec_id, m.employee AS emp, m.type_of_illness AS illness, m.hospital AS hospital,
               m.from_date AS from_date, m.to_date AS to_date, m.cost AS cost, m.status AS status,
               m.approved_date AS approved_date, m.approved_by AS approved_by, m.submitted_by AS submitted_by,
               m.rejection_reason AS rejection_reason, m.document_ref AS doc_ref, m.payment_log AS payment_log,
               m.dependant_name AS dependant_name, m.relation_to_dependent AS relation
          FROM dependentmedical m
         WHERE m.document_ref = ${reference}
         LIMIT 1`.catch(logMiss)
    : await prisma.$queryRaw`
        SELECT m.id AS rec_id, m.employee AS emp, m.type_of_illness AS illness, m.hospital AS hospital,
               m.from_date AS from_date, m.to_date AS to_date, m.cost AS cost, m.status AS status,
               m.approved_date AS approved_date, m.approved_by AS approved_by, m.submitted_by AS submitted_by,
               m.rejection_reason AS rejection_reason, m.document_ref AS doc_ref, m.payment_log AS payment_log,
               -- Unquoted on purpose: the Postgres columns are lower-case (createdat), MySQL's mixed-case;
               -- an unquoted name resolves on both. The alias makes the result key the same on both.
               m.createdAt AS created_at, m.updatedAt AS updated_at
          FROM staffmedical m
         WHERE m.document_ref = ${reference}
         LIMIT 1`.catch(logMiss);
  const [r] = rows;
  if (!r) return null;

  const emps = await loadEmployees([r.emp]);
  const emp  = emps.get(String(r.emp));
  const colName = dependent
    ? ['Dependent Medical', r.dependant_name].filter(Boolean).join(' - ')
    : 'Medical Claim';
  return {
    module: dependent ? 'dependent_medical' : 'staff_medical',
    moduleLabel: dependent ? 'Dependent Medical' : 'Staff Medical',
    header: {
      id: str(r.rec_id),
      name: [dependent ? 'Dependent Medical' : 'Staff Medical', emp?.name, r.illness].filter(Boolean).join(' - '),
      date_start: iso(r.from_date), date_end: iso(r.to_date ?? r.from_date),
      // approved_date is often blank on medical rows; the last update is when the approval (and the
      // posting with it) was written. dependentmedical has no timestamps, so it falls to the dates below.
      status: str(r.status), created_at: iso(r.created_at ?? null),
      submitted_by: str(r.submitted_by), approved_by: str(r.approved_by),
      approved_at: iso(r.approved_date ?? r.updated_at ?? null),
      rejection_reason: r.rejection_reason || null, finalized_at: iso(r.approved_date ?? r.updated_at ?? null),
      document_ref: r.doc_ref, payment_log: r.payment_log || null,
    },
    branchSetting: 'medical_gl_branch',
    // The credit went to the employee's profile bank account at approval; it is not stored on the row.
    employees: [employeeEntry(emps, r.emp, [{ name: colName, amount: r.cost, type: 'Payment', glAccount: null, glSetting: 'medical_expense_gl' }])],
    details: {
      illness: r.illness || null, hospital: r.hospital || null,
      ...(dependent ? { dependantName: r.dependant_name || null, relation: r.relation || null } : {}),
    },
  };
}

async function hospitalClaim(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT hc.id AS rec_id, hc.reference_no AS ref_no, hc.invoice_no AS invoice_no, hc.items AS items,
           hc.total_amount AS total_amount, hc.withholding_tax AS wht, hc.total_credit_amount AS credit_amt,
           hc.status AS status, hc.posted_date AS created_at, hc.posted_by AS posted_by,
           hc.approved_date AS approved_date, hc.approved_by AS approved_by,
           hc.document_ref AS doc_ref, hc.payment_log AS payment_log,
           rh.name AS hospital_name, rh.account AS hospital_account
      FROM hospitalclaims hc
      LEFT JOIN registeredhospitals rh ON rh.id = hc.hospital
     WHERE hc.document_ref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const items = parse(r.items, []);
  const list  = (Array.isArray(items) ? items : []).filter(i => parseFloat(i.amount ?? 0) > 0);
  const emps  = await loadEmployees(list.map(i => i.employee_id));
  // One column per claim item, grouped under the employee — the posting has one debit per item.
  const byEmp = new Map();
  for (const i of list) {
    const key = String(i.employee_id);
    if (!byEmp.has(key)) byEmp.set(key, []);
    byEmp.get(key).push({
      name: i.type === 'dependent' ? ['Dependent Medical', i.dependent_name].filter(Boolean).join(' - ') : 'Medical Claim',
      amount: i.amount, type: 'Payment', glAccount: null, glSetting: 'medical_expense_gl',
    });
  }
  const employees = [...byEmp.entries()].map(([id, cols]) => employeeEntry(emps, id, cols));

  return {
    module: 'hospital_claim', moduleLabel: 'Hospital Claim',
    header: {
      id: str(r.rec_id),
      name: ['Hospital Claim', r.hospital_name, r.invoice_no].filter(Boolean).join(' - '),
      date_start: iso(r.created_at), date_end: iso(r.approved_date ?? r.created_at),
      status: r.status, created_at: iso(r.created_at),
      submitted_by: str(r.posted_by), approved_by: str(r.approved_by), approved_at: iso(r.approved_date),
      finalized_at: iso(r.approved_date), document_ref: r.doc_ref, payment_log: r.payment_log || null,
    },
    branchSetting: 'medical_gl_branch',
    employees,
    // Unlike every other module the cash went to the HOSPITAL, less withholding tax — so the cash leg
    // reports the hospital's account and credited amount instead of summing employee net pay.
    netPayLine: {
      name: 'Hospital Payment', glAccount: r.hospital_account || null, amount: round2(r.credit_amt),
    },
    details: {
      hospital: r.hospital_name || null, hospitalAccount: r.hospital_account || null,
      invoiceNo: r.invoice_no || null, referenceNo: r.ref_no || null,
      withholdingTax: round2(r.wht), hospitalCredit: round2(r.credit_amt),
    },
  };
}

// Order is only a tie-break: the reference prefixes (LV, OS, EO, MS, MD, MC) differ per module, so a
// reference belongs to at most one of them in practice.
const RESOLVERS = [
  leave, outOfStation, endOfService,
  (ref) => medical(ref, false), (ref) => medical(ref, true),
  hospitalClaim,
];

// Every top-level field a payroll run response carries (RUNS_SELECT), null unless the module sets it.
const RUN_FIELDS = [
  'id', 'name', 'pay_frequency', 'freq_name', 'date_start', 'date_end', 'deduction_group', 'group_name',
  'payment_type_id', 'type_name', 'status', 'created_at', 'submitted_by', 'approved_by', 'approved_at',
  'rejection_reason', 'document_ref', 'payment_log', 'finalized_at', 'bank_confirmed_at',
  'bank_confirmed_by', 'columns', 'cur_approver_type', 'cur_approver_id', 'cur_approver_label', 'cur_stage_name',
];

/** Build the payroll-shaped body from a resolver hit — the same aggregation getPayrollByReference does. */
function toPayrollShape(hit, { reference, currency, branch, glBySetting }) {
  const employees = hit.employees.map(emp => {
    let earnings = 0, deductions = 0;
    const columns = emp.columns.map(c => {
      const amount = round2(c.amount);
      if (c.type === 'Deduction') deductions += amount; else earnings += amount;
      const glAccount = c.glAccount || (c.glSetting && glBySetting[c.glSetting]) || null;
      return { name: c.name, amount, type: c.type, glAccount, branch, currency };
    });
    return {
      employeeId: emp.employeeId, employeeCode: emp.employeeCode, name: emp.name,
      bankAccount: emp.bankAccount, currency, branch, columns,
      earnings: round2(earnings), deductions: round2(deductions), netPay: round2(earnings - deductions),
    };
  });

  const totals = employees.reduce((acc, e) => ({
    earnings:   round2(acc.earnings   + e.earnings),
    deductions: round2(acc.deductions + e.deductions),
    netPay:     round2(acc.netPay     + e.netPay),
  }), { earnings: 0, deductions: 0, netPay: 0 });

  // Per-column summary, keyed by column name — identical rules to the payroll endpoint.
  const byColumn = new Map();
  for (const emp of employees) {
    for (const col of emp.columns) {
      if (!byColumn.has(col.name)) {
        byColumn.set(col.name, {
          name: col.name, type: col.type, glAccount: col.glAccount, glAccounts: new Set(),
          currency, employeeCount: 0, amount: 0,
        });
      }
      const agg = byColumn.get(col.name);
      agg.glAccounts.add(col.glAccount ?? null);
      agg.employeeCount += 1;
      agg.amount        += col.amount;
    }
  }
  const columnSummary = [...byColumn.values()]
    .map(c => ({ ...c, amount: round2(c.amount), glAccounts: [...c.glAccounts] }))
    .sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === 'Payment' ? -1 : 1));

  const paid = employees.filter(e => e.netPay > 0);
  const netPay = {
    name:          hit.netPayLine?.name ?? 'Net Pay',
    type:          'Credit',
    glAccount:     hit.netPayLine?.glAccount ?? null,
    currency,
    employeeCount: paid.length,
    amount:        hit.netPayLine ? hit.netPayLine.amount : round2(paid.reduce((s, e) => s + e.netPay, 0)),
  };

  const run = Object.fromEntries(RUN_FIELDS.map(k => [k, hit.header[k] ?? null]));
  // A payroll run always has these timestamps, so the app may parse them unconditionally. Where the
  // record lacks one, use the nearest one it does have rather than return null.
  const anyDate = run.finalized_at ?? run.approved_at ?? run.created_at ?? run.date_end ?? run.date_start;
  for (const k of ['created_at', 'approved_at', 'finalized_at', 'date_start', 'date_end']) run[k] ??= anyDate;
  return {
    ...run,
    module: hit.module,
    moduleLabel: hit.moduleLabel,
    reference,
    employeeCount: employees.length,
    totals,
    columnSummary,
    netPay,
    employees,
    details: hit.details,
  };
}

/**
 * Find the non-payroll record posted under `reference`, in the payroll run response shape, or null
 * when no module holds it.
 */
async function findGLReference(reference) {
  for (const resolve of RESOLVERS) {
    const hit = await resolve(reference);
    if (!hit) continue;
    let extra = {};
    try { extra = JSON.parse((await getApiConfig()).gl_extra || '{}'); } catch { /* ignore */ }
    // One system currency for every posting — the same source postToGL's callers use.
    const currency = await getSystemCurrency(extra.currency);
    // The branch each module posts with: its own GL branch setting, else the GL default, else '000'.
    const branch = (hit.branchSetting && await settingValue(hit.branchSetting)) || extra.branch || '000';
    const glKeys = [...new Set(hit.employees.flatMap(e => e.columns.map(c => c.glSetting)).filter(Boolean))];
    const glBySetting = {};
    for (const k of glKeys) glBySetting[k] = await settingValue(k);
    return toPayrollShape(hit, { reference, currency, branch, glBySetting });
  }
  return null;
}

module.exports = { findGLReference };
