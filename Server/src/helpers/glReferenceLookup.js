/**
 * Resolve a GL document reference to the NON-payroll record that produced it.
 *
 * Payroll runs are looked up by payrollRunController itself (they carry per-column detail). Every
 * other module that posts through postToGL stores the reference the GL returned on its own row:
 *
 *   leave allowance    employeeleaves.documentref        (no underscore — legacy column)
 *   out of station     outofstation_requests.document_ref
 *   end of service     eos_settlements.document_ref
 *   staff medical      staffmedical.document_ref
 *   dependent medical  dependentmedical.document_ref
 *   hospital claim     hospitalclaims.document_ref
 *
 * Each resolver returns the same envelope — module, record identity, status, amount, the employees
 * involved — plus a module-specific `details` object. Only what is STORED on the record is reported:
 * GL accounts that were read from settings at posting time (and may have changed since) are left out
 * rather than re-derived, so the response never claims an account the journal may not have used.
 *
 * Raw SQL rules (Postgres is the live provider): every selected column is aliased in lower snake_case
 * so the result key is identical on both providers, and the employee is loaded in a second query
 * rather than joined, because staffmedical/dependentmedical hold the employee id as VARCHAR and
 * `bigint = varchar` is an error on Postgres.
 */
const { Prisma }           = require('@prisma/client');
const { prisma }           = require('./dbQueryHelper');
const { toBigInt }         = require('./controllerHelpers');
const { getSystemCurrency } = require('./settingsHelper');
const { getApiConfig }     = require('../controllers/apiIntegrationController');

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

/** The employee block for a single-employee record, falling back to the bare id if the row is gone. */
function employeeOf(map, id, extra = {}) {
  const e = map.get(String(id)) || { employeeId: str(id), employeeCode: '', name: '', bankAccount: null };
  return { ...e, ...extra };
}

// ── Resolvers ────────────────────────────────────────────────────────────────
// Each takes the reference and returns the envelope, or null when the reference is not theirs.

async function leave(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT el.id AS rec_id, el.employee AS emp, el.leave_name AS leave_name, el.date_start AS date_start,
           el.date_end AS date_end, el.status AS leave_status, el.allowance_status AS allowance_status,
           el.amount AS net_amount, el.leave_tax AS tax_amount, el.emp_acc_no AS emp_acc_no,
           el.documentref AS doc_ref, el.api_response AS api_response
      FROM employeeleaves el
     WHERE el.documentref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const log  = parse(r.api_response, {});
  const net  = round2(r.net_amount);
  const tax  = round2(r.tax_amount);
  const emps = await loadEmployees([r.emp]);
  // The account actually credited is in the posting log; the profile account may have changed since.
  const credited = log.credit_acct || r.emp_acc_no || null;
  return {
    module: 'leave', moduleLabel: 'Leave Allowance',
    id: str(r.rec_id), number: null,
    status: r.allowance_status || null,
    document_ref: r.doc_ref, postedAt: log.posted_at || null,
    description: ['Leave allowance', r.leave_name].filter(Boolean).join(' - '),
    amount: round2(net + tax),
    employees: [employeeOf(emps, r.emp, { creditedAccount: credited, amount: net })],
    details: {
      leaveName:  r.leave_name || null,
      leaveStatus: r.leave_status || null,
      dateStart:  iso(r.date_start), dateEnd: iso(r.date_end),
      gross: round2(net + tax), tax, net,
      // Stored with the posting, so these are the accounts the journal used.
      debitGl: log.debit_gl || null, taxGl: log.tax_gl || null,
    },
  };
}

async function outOfStation(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT o.id AS rec_id, o.request_number AS req_no, o.employee AS emp, o.purpose AS purpose,
           o.location AS location, o.date_start AS date_start, o.date_end AS date_end, o.days AS days,
           o.daily_rate AS daily_rate, o.amount AS amount, o.account_no AS account_no, o.status AS status,
           o.document_ref AS doc_ref, o.posted_at AS posted_at
      FROM outofstation_requests o
     WHERE o.document_ref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const emps = await loadEmployees([r.emp]);
  const amount = round2(r.amount);
  return {
    module: 'out_of_station', moduleLabel: 'Out of Station',
    id: str(r.rec_id), number: r.req_no,
    status: r.status, document_ref: r.doc_ref, postedAt: iso(r.posted_at),
    description: ['Out of station allowance', r.location].filter(Boolean).join(' - '),
    amount,
    employees: [employeeOf(emps, r.emp, { creditedAccount: r.account_no || null, amount })],
    details: {
      purpose: r.purpose, location: r.location,
      dateStart: iso(r.date_start), dateEnd: iso(r.date_end),
      days: Number(r.days), dailyRate: round2(r.daily_rate),
    },
  };
}

async function endOfService(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT st.id AS rec_id, st.settlement_number AS settle_no, st.employee AS emp,
           st.exit_reason AS exit_reason, st.effective_date AS effective_date,
           st.eosb_amount AS eosb_amount, st.total_additions AS total_additions,
           st.total_deductions AS total_deductions, st.net_amount AS net_amount,
           st.account_no AS account_no, st.status AS status, st.document_ref AS doc_ref,
           st.posted_at AS posted_at
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
  const net  = round2(r.net_amount);
  return {
    module: 'end_of_service', moduleLabel: 'End of Service',
    id: str(r.rec_id), number: r.settle_no,
    status: r.status, document_ref: r.doc_ref, postedAt: iso(r.posted_at),
    description: ['End of service settlement', r.exit_reason].filter(Boolean).join(' - '),
    amount: net,
    employees: [employeeOf(emps, r.emp, { creditedAccount: r.account_no || null, amount: net })],
    details: {
      exitReason: r.exit_reason, effectiveDate: iso(r.effective_date),
      eosb: round2(r.eosb_amount),
      totalAdditions: round2(r.total_additions), totalDeductions: round2(r.total_deductions),
      net,
      // A line with no gl_account posted against the module's default GL from settings.
      lines: lines.map(l => ({
        type: l.line_type, itemCode: l.item_code, description: l.line_desc,
        amount: round2(l.amount), glAccount: l.gl_account || null,
      })),
    },
  };
}

/** staffmedical and dependentmedical share a shape; `dependent` adds the dependant's fields. */
async function medical(reference, dependent) {
  const rows = dependent
    ? await prisma.$queryRaw`
        SELECT m.id AS rec_id, m.employee AS emp, m.type_of_illness AS illness, m.hospital AS hospital,
               m.admission_type AS admission_type, m.from_date AS from_date, m.to_date AS to_date,
               m.cost AS cost, m.status AS status, m.approved_date AS approved_date,
               m.document_ref AS doc_ref, m.dependant_name AS dependant_name,
               m.relation_to_dependent AS relation
          FROM dependentmedical m
         WHERE m.document_ref = ${reference}
         LIMIT 1`.catch(logMiss)
    : await prisma.$queryRaw`
        SELECT m.id AS rec_id, m.employee AS emp, m.type_of_illness AS illness, m.hospital AS hospital,
               m.admission_type AS admission_type, m.from_date AS from_date, m.to_date AS to_date,
               m.cost AS cost, m.status AS status, m.approved_date AS approved_date,
               m.document_ref AS doc_ref
          FROM staffmedical m
         WHERE m.document_ref = ${reference}
         LIMIT 1`.catch(logMiss);
  const [r] = rows;
  if (!r) return null;

  const emps   = await loadEmployees([r.emp]);
  const amount = round2(r.cost);
  return {
    module: dependent ? 'dependent_medical' : 'staff_medical',
    moduleLabel: dependent ? 'Dependent Medical' : 'Staff Medical',
    id: str(r.rec_id), number: null,
    status: str(r.status), document_ref: r.doc_ref, postedAt: iso(r.approved_date),
    description: ['Medical claim', r.illness].filter(Boolean).join(' - '),
    amount,
    // The credit went to the employee's bank account as it stood at approval; not stored on the row.
    employees: [employeeOf(emps, r.emp, { amount })],
    details: {
      illness: r.illness, hospital: r.hospital, admissionType: r.admission_type,
      fromDate: iso(r.from_date), toDate: iso(r.to_date),
      ...(dependent ? { dependantName: r.dependant_name, relation: r.relation || null } : {}),
    },
  };
}

async function hospitalClaim(reference) {
  const [r] = await prisma.$queryRaw`
    SELECT hc.id AS rec_id, hc.reference_no AS ref_no, hc.invoice_no AS invoice_no, hc.items AS items,
           hc.total_amount AS total_amount, hc.withholding_tax AS wht, hc.total_credit_amount AS credit_amt,
           hc.status AS status, hc.approved_date AS approved_date, hc.document_ref AS doc_ref,
           rh.name AS hospital_name, rh.account AS hospital_account
      FROM hospitalclaims hc
      LEFT JOIN registeredhospitals rh ON rh.id = hc.hospital
     WHERE hc.document_ref = ${reference}
     LIMIT 1`.catch(logMiss);
  if (!r) return null;

  const items = parse(r.items, []);
  const list  = Array.isArray(items) ? items : [];
  const emps  = await loadEmployees(list.map(i => i.employee_id));
  // One entry per claim item, mirroring the posting's one debit line per item (zero items skipped).
  const employees = list
    .filter(i => parseFloat(i.amount ?? 0) > 0)
    .map(i => employeeOf(emps, i.employee_id, {
      amount:        round2(i.amount),
      claimType:     i.type === 'dependent' ? 'dependent' : 'staff',
      dependantName: i.type === 'dependent' ? (i.dependent_name || null) : null,
      narration:     i.narration || null,
    }));

  return {
    module: 'hospital_claim', moduleLabel: 'Hospital Claim',
    id: str(r.rec_id), number: r.ref_no || null,
    status: r.status, document_ref: r.doc_ref, postedAt: iso(r.approved_date),
    description: ['Medical claim', r.hospital_name].filter(Boolean).join(' - '),
    amount: round2(r.total_amount),
    employees,
    details: {
      hospital: r.hospital_name || null, hospitalAccount: r.hospital_account || null,
      invoiceNo: r.invoice_no || null,
      totalAmount: round2(r.total_amount),
      withholdingTax: round2(r.wht),
      hospitalCredit: round2(r.credit_amt),
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

/**
 * Find the non-payroll record posted under `reference`. Returns the envelope (with `reference`,
 * `currency` and `employeeCount` filled in) or null when no module holds it.
 */
async function findGLReference(reference) {
  for (const resolve of RESOLVERS) {
    const hit = await resolve(reference);
    if (!hit) continue;
    let extra = {};
    try { extra = JSON.parse((await getApiConfig()).gl_extra || '{}'); } catch { /* ignore */ }
    // One system currency for every posting — the same source postToGL's callers use.
    const currency = await getSystemCurrency(extra.currency);
    return { ...hit, reference, currency, employeeCount: hit.employees.length };
  }
  return null;
}

module.exports = { findGLReference };
