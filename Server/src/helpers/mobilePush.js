// Mobile in-app notifications — pushed to the external notification service, which delivers to the
// mobile app by topic. The topic is the employee's staff number (employee.employee_id, e.g. P2000002).
//
// Every export is fire-and-forget: it never throws and never blocks the request that triggered it.
// When NOTIFICATION_API_URL is unset, nothing is sent.
//
//   NOTIFICATION_API_URL        e.g. https://host/api/notifications/send-topic
//   NOTIFICATION_API_KEY        sent in the header named below
//   NOTIFICATION_API_KEY_HEADER optional, default 'x-api-key'
//
// Payload ids (leaveId, requestId, nominationId, runId…) are the HR database ids, so the app can pass
// them straight back to the /me API. Every `data` value is a string — push transports require it.

const { prisma } = require('./dbQueryHelper');
const { getSystemCurrency } = require('./settingsHelper');

const TIMEOUT_MS = 10000;

const big = (v) => {
  try { return v === null || v === undefined || v === '' ? null : BigInt(v); }
  catch { return null; }
};
const ymd   = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (v) => (v == null || v === '' ? '' : (parseFloat(v) || 0).toFixed(2));
const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// HR status → the app's status + severity vocabulary.
function mapStatus(status) {
  const s = String(status || '').toLowerCase();
  // 'GL Failed' / 'GL Scheduled' are payment-side states of an approved claim — approved to the employee.
  if (s === 'approved' || s === 'completed' || s.startsWith('gl ')) return { status: 'APPROVED', severity: 'LOW' };
  if (s === 'rejected')  return { status: 'REJECTED',  severity: 'HIGH' };
  if (s === 'cancelled') return { status: 'CANCELLED', severity: 'MEDIUM' };
  if (s.startsWith('pending')) return { status: 'PENDING', severity: 'MEDIUM' };
  return { status: s.toUpperCase().replace(/\s+/g, '_'), severity: 'LOW' };
}

const stringify = (data) => Object.fromEntries(
  Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)]));

async function sendTopic(topic, title, body, data) {
  const url = process.env.NOTIFICATION_API_URL;
  if (!url || !topic) return;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.NOTIFICATION_API_KEY) {
    headers[process.env.NOTIFICATION_API_KEY_HEADER || 'x-api-key'] = process.env.NOTIFICATION_API_KEY;
  }
  try {
    const res = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ topic: String(topic), title, body, data: stringify(data) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[mobile-push] ${data.type} to ${topic} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`[mobile-push] ${data.type} to ${topic} failed:`, err.message);
  }
}

async function staffNumber(employeeId) {
  const id = big(employeeId);
  if (!id) return null;
  const [row] = await prisma.$queryRaw`SELECT employee_id AS code FROM employee WHERE id = ${id} LIMIT 1`.catch(() => []);
  return row?.code ? String(row.code).trim() : null;
}

// Run `fn` detached so callers can call without awaiting and without try/catch.
const detached = (label, fn) => (...args) => {
  Promise.resolve().then(() => fn(...args))
    .catch((err) => console.error(`[mobile-push] ${label} failed:`, err.message));
};

// ── Leave ─────────────────────────────────────────────────────────────────────

async function leave(leaveId) {
  const id = big(leaveId);
  if (!id) return;
  const [r] = await prisma.$queryRaw`
    SELECT el.id, el.employee, el.date_start, el.date_end, el.status,
           COALESCE(lt.name, el.leave_name, 'Leave') AS leave_type,
           (SELECT COUNT(*) FROM employeeleavedays d WHERE d.employee_leave = el.id) AS days
      FROM employeeleaves el
      LEFT JOIN leavetypes lt ON lt.id = el.leave_type
     WHERE el.id = ${id}`;
  if (!r) return;
  const topic = await staffNumber(r.employee);
  if (!topic) return;
  const { status, severity } = mapStatus(r.status);
  const word  = status.toLowerCase();
  const range = r.date_start && r.date_end
    ? `${fmtDay(r.date_start)} - ${fmtDay(r.date_end)}, ${new Date(r.date_end).getUTCFullYear()}` : '';
  await sendTopic(topic,
    `Leave ${word.charAt(0).toUpperCase() + word.slice(1)}: ${r.leave_type}`,
    `Your ${r.leave_type.toLowerCase()} request${range ? ` for ${range}` : ''} has been ${word}.`,
    {
      type: 'leave', leaveId: r.id, leaveType: r.leave_type,
      dateFrom: ymd(r.date_start), dateTo: ymd(r.date_end), days: Number(r.days),
      status, severity, link: `/leave-status?leaveId=${r.id}`,
    });
}

// ── Medical (kind: 'staff' | 'dependent') ─────────────────────────────────────

async function medical(kind, recordId) {
  const id = big(recordId);
  if (!id) return;
  const isStaff = kind === 'staff';
  const [r] = isStaff
    ? await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id = ${id}`
    : await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id = ${id}`;
  if (!r) return;
  const topic = await staffNumber(r.employee);
  if (!topic) return;
  const { status, severity } = mapStatus(r.status);
  const word = status === 'PENDING' ? 'submitted' : status.toLowerCase();
  const admission = r.admission_type || '';
  const title = isStaff
    ? `Medical Claim ${word.charAt(0).toUpperCase() + word.slice(1)}`
    : 'Dependent Medical Update';
  const body = isStaff
    ? `Your ${admission.toLowerCase()} claim${r.type_of_illness ? ` for ${r.type_of_illness} treatment` : ''} has been ${word}.`
    : `Dependent medical claim for ${r.dependant_name || 'your dependant'} has been ${word}.`;
  await sendTopic(topic, title, body, {
    type: 'medical', requestId: r.id, claimType: isStaff ? 'employee' : 'dependent',
    ...(isStaff ? { illness: r.type_of_illness }
                : { dependentName: r.dependant_name, relationship: r.relation_to_dependent, illness: r.type_of_illness }),
    admissionType: admission, hospital: r.hospital,
    cost: money(r.cost), currency: await getSystemCurrency(),
    status, severity, link: `/medical-status?isStaff=${isStaff}`,
  });
}

// ── Training nomination ───────────────────────────────────────────────────────

async function training(nominationId) {
  const id = big(nominationId);
  if (!id) return;
  const r = await prisma.trainingnomination.findUnique({ where: { id } });
  if (!r) return;
  const topic = await staffNumber(r.employee);
  if (!topic) return;
  const { status, severity } = mapStatus(r.status);
  const word = status.toLowerCase();
  const trainingId = r.training_catalog_id ?? r.id;
  await sendTopic(topic,
    `Training Nomination ${word.charAt(0).toUpperCase() + word.slice(1)}`,
    `Your nomination for ${r.training_name} is ${word}.`,
    {
      type: 'training', trainingId, nominationId: r.id,
      courseName: r.training_name, provider: r.provider, venue: r.venue,
      dateFrom: ymd(r.start_date), dateTo: ymd(r.end_date),
      cost: money(r.cost), currency: r.currency || await getSystemCurrency(),
      status, severity, link: `/training-status?trainingId=${trainingId}`,
    });
}

// ── Payslips for a completed payroll run — one push per employee ─────────────

async function payslips(runId) {
  const id = big(runId);
  if (!id || !process.env.NOTIFICATION_API_URL) return;
  const [run] = await prisma.$queryRaw`
    SELECT pr.id, pr.name, pr.date_start, pr.date_end, pr.status, pt.generate_payslip
      FROM payrollruns pr LEFT JOIN paymenttype pt ON pt.id = pr.payment_type_id
     WHERE pr.id = ${id} LIMIT 1`;
  if (!run || run.status !== 'Completed') return;
  if (run.generate_payslip === false || run.generate_payslip === 0) return;

  const period = run.date_end
    ? new Date(run.date_end).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : run.name;
  const currency = await getSystemCurrency();
  const emps = await prisma.$queryRaw`
    SELECT DISTINCT pd.employee, e.employee_id AS code
      FROM payrolldata pd JOIN employee e ON e.id = pd.employee
     WHERE pd.payroll = ${id}`;

  // Net pay comes from renderPayslip so the push shows exactly what the payslip prints.
  const { renderPayslip } = require('../controllers/payslipController');
  for (const emp of emps) {
    const topic = emp.code ? String(emp.code).trim() : null;
    if (!topic) continue;
    let netPay = '';
    try { netPay = money((await renderPayslip(String(id), String(emp.employee))).netPay); }
    catch { /* still announce the payslip, just without the amount */ }
    await sendTopic(topic, `Payslip Ready: ${period}`, `Your payslip for ${period} is ready.`, {
      type: 'payslip', payslipId: run.id, runId: run.id, period,
      dateFrom: ymd(run.date_start), dateTo: ymd(run.date_end), netPay, currency,
      status: 'READY', severity: 'LOW', link: `/payslip-detail?payslipId=${run.id}`,
    });
  }
}

module.exports = {
  pushLeave:     detached('leave', leave),
  pushMedical:   detached('medical', medical),
  pushTraining:  detached('training', training),
  pushPayslips:  detached('payslips', payslips),
  sendTopic,
};
