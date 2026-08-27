const PDFDocument = require('pdfkit');
const { prisma }  = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const axios        = require('axios');
const fs           = require('fs');
const path         = require('path');
const { UPLOAD_DIR } = require('../middleware/upload');

const { serialize } = require('../helpers/controllerHelpers');

// Tagged-template query helper — portable (Prisma emits the right placeholders per provider).
async function query(strings, ...values) {
  return serialize(await prisma.$queryRaw(strings, ...values));
}

function fmt(val) {
  const n = parseFloat(val || '0');
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hexToRgb(hex) {
  const h = (hex || '#3B82F6').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 59;
  const g = parseInt(h.slice(2, 4), 16) || 130;
  const b = parseInt(h.slice(4, 6), 16) || 246;
  return [r, g, b];
}

function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Resolve a configured logo to an image buffer, or null when it cannot be loaded.
 *
 * Every failure is logged rather than swallowed. A payslip that silently prints without the
 * company logo looks like a rendering bug, when the cause is almost always configuration: the
 * stored filename no longer exists under UPLOAD_DIR (uploads are not in version control, so a
 * value saved on one machine is dangling on another), or a URL is unreachable. Without a log
 * line there is nothing to point at.
 */
async function loadLogoBuffer(src, label = 'logo') {
  if (!src || !String(src).trim()) return null;
  const short = String(src).trim().length > 60
    ? String(src).trim().slice(0, 57) + '...'
    : String(src).trim();
  const value = String(src).trim();

  try {
    const dataUri = value.match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i);
    if (dataUri) return Buffer.from(dataUri[1], 'base64');

    if (/^https?:\/\//i.test(value)) {
      const res = await axios.get(value, { responseType: 'arraybuffer', timeout: 5000 });
      return Buffer.from(res.data);
    }

    if (fs.existsSync(value)) return fs.readFileSync(value);

    // Stored value is usually just an uploaded filename — resolve it under the documents dir.
    const docPath = path.join(UPLOAD_DIR, path.basename(value));
    if (fs.existsSync(docPath)) return fs.readFileSync(docPath);
    console.warn(`[payslip] ${label} not found: "${short}" - looked under ${UPLOAD_DIR}.`
      + ' The payslip renders without it; re-upload the logo in Settings.');
    return null;
  } catch (e) {
    console.warn(`[payslip] ${label} could not be loaded from "${short}": ${e.message}`);
    return null;
  }
}

// ── Download payslip PDF ──────────────────────────────────────────────────────
const downloadPayslip = asyncHandler(async (req, res) => {
  const { id: runId, empId } = req.params;

  // Auth guard: employees can only fetch their own payslip
  const roles = req.user?.roles || [];
  const permissions = req.user?.permissions || [];
  const canDownloadForOthers =
    roles.includes('admin') ||
    roles.includes('super-admin') ||
    permissions.includes('export_payroll_reports') ||
    permissions.includes('export_reports');

  if (!canDownloadForOthers) {
    // Prefer the exact employee id (mobileAuth sets req.self/req.user.employeeId); the email/username
    // match is the web fallback and fails outright when the user row carries no matching address.
    let selfId = req.self?.id ?? (req.user?.employeeId ? String(req.user.employeeId) : null);
    if (!selfId) {
      const [self] = await query`SELECT id FROM employee WHERE email = ${req.user?.email || ''} OR work_email = ${req.user?.email || ''} OR employee_id = ${req.user?.username || ''} LIMIT 1`;
      selfId = self ? String(self.id) : null;
    }
    if (!selfId || String(selfId) !== String(empId)) {
      return respond.badReq(res, 'You can only download your own payslip');
    }
  }

  // ── Fetch run, settings, employee ──────────────────────────────────────────
  const [run] = await query`
    SELECT pr.id, pr.name, pr.date_start, pr.date_end, pr.status, pr.payment_type_id,
           pr.template_snapshot, pr.pay_frequency,
           pf.name AS freq_name
    FROM payrollruns pr
    LEFT JOIN payfrequencies pf ON pf.id = pr.pay_frequency
    WHERE pr.id = ${BigInt(runId)} LIMIT 1`;
  if (!run) return respond.notFound(res, 'Payroll run not found');

  if (run.payment_type_id) {
    const [pt] = await query`SELECT generate_payslip FROM paymenttype WHERE id = ${BigInt(run.payment_type_id)} LIMIT 1`.catch(() => [null]);
    if (pt && !pt.generate_payslip) {
      return res.status(403).json({ success: false, message: 'Payslips are not generated for this payment type.' });
    }
  }

  const [emp] = await query`
    SELECT e.id, e.employee_id, e.firstName, e.lastName, e.email,
           e.bankAccount,
           COALESCE(jt.label, CONCAT(e.jobTitleId, '')) AS designation,
           COALESCE(dept.title, CONCAT(e.departmentId, '')) AS department
    FROM employee e
    LEFT JOIN codelistvalue jt ON jt.id = e.jobTitleId
    LEFT JOIN companystructures dept ON dept.id = e.departmentId
    WHERE e.id = ${BigInt(empId)} LIMIT 1`;
  if (!emp) return respond.notFound(res, 'Employee not found');

  const payrollData = await query`
    SELECT pc.id AS payroll_item_id,
           COALESCE(NULLIF(pc.payslip_label,''), pc.name) AS name,
           pc.payment_deduction, pc.visible, pc.include_in_net,
           pc.payslip_section, pc.payslip_in_total,
           CONCAT(pd.amount, '') AS amount
    FROM payrolldata pd
    JOIN payrollcolumns pc ON pc.id = pd.payroll_item
    WHERE pd.payroll = ${BigInt(runId)} AND pd.employee = ${BigInt(empId)}
    ORDER BY COALESCE(pc.colorder, 99999)`;

  // Which columns are running aggregates rather than real components?
  //
  // Derived at render time from payrollcolumn_links instead of a stored flag: a column that is
  // composed from other columns (Gross = Salary Basic + Total Allowance) IS the subtotal of those
  // columns, so adding it to a total alongside its own parts counts the same money twice. Reading
  // the link table means there is no classification to keep in step with the formulas.
  const linkRows = await query`
    SELECT DISTINCT payrollcolumn_id FROM payrollcolumn_links`.catch(() => []);
  const aggregateIds = new Set(linkRows.map(r => String(r.payrollcolumn_id)));

  // A run whose journal reached the bank carries the template as it stood at that moment. Its
  // payslips are evidence of what was paid, so they must not change because someone later edited
  // the template. Runs finalised before snapshots existed have none and resolve live, as before.
  let snapshot = null;
  if (run.template_snapshot) {
    try {
      const parsed = JSON.parse(run.template_snapshot);
      if (parsed && typeof parsed === 'object') snapshot = parsed;
    } catch {
      console.warn(`[payslip] run ${runId} has an unreadable template_snapshot — resolving live instead`);
    }
  }

  // Find the best-matching template: payment type + group, then payment type,
  // then group, then the default template.
  const allTemplates = snapshot ? [] : await query`
    SELECT * FROM payslip_settings
    ORDER BY payment_type_id IS NULL ASC, deduction_group_id IS NULL ASC, id ASC`.catch(() => []);
  // An employee may hold a payroll record on several frequencies (Monthly and Mid-Month, say), so
  // match the one belonging to THIS run's frequency. Picking any record would choose the wrong
  // deduction group — and therefore the wrong payslip template — whenever the two differ.
  // Falls back to any record for runs with no frequency set.
  const [empPe] = run.pay_frequency != null
    ? await query`
        SELECT deduction_group FROM payrollemployees
         WHERE employee = ${BigInt(empId)} AND pay_frequency = ${parseInt(run.pay_frequency)} LIMIT 1`.catch(() => [null])
    : await query`SELECT deduction_group FROM payrollemployees WHERE employee = ${BigInt(empId)} LIMIT 1`.catch(() => [null]);
  const empGroup = empPe?.deduction_group ? String(empPe.deduction_group) : null;
  const runPaymentType = run.payment_type_id ? String(run.payment_type_id) : null;
  const [matched] = allTemplates
    .filter(t => runPaymentType && empGroup && String(t.payment_type_id) === runPaymentType && String(t.deduction_group_id) === empGroup)
    .concat(allTemplates.filter(t => runPaymentType && String(t.payment_type_id) === runPaymentType && !t.deduction_group_id))
    .concat(allTemplates.filter(t => empGroup && !t.payment_type_id && String(t.deduction_group_id) === empGroup))
    .concat(allTemplates.filter(t => !t.payment_type_id && !t.deduction_group_id));
  const settings = snapshot ?? matched;
  const hasTemplate = !!settings;
  const s = settings || {};

  // ── Categorise columns ──────────────────────────────────────────────────────
  // `payslip_columns` is the PAYSLIP's own column list. `visible_columns` belongs to the payroll
  // GRID and the Excel export (Client/src/components/Payroll.tsx `hiddenColIds`) — the two were one
  // field, so hiding a column from the payslip also deleted it from the payroll report. Keep them
  // separate. A null or empty payslip list falls back to visible_columns, so a template nobody has
  // edited prints exactly as it did before.
  const parseIds = (json) => {
    if (!json) return null;
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) && arr.length ? new Set(arr.map(String)) : null;
    } catch { return null; }
  };
  const visibleIds = parseIds(s.visible_columns);
  const slipIds    = parseIds(s.payslip_columns);
  const printIds   = slipIds ?? visibleIds;
  const netIds     = parseIds(s.net_columns);

  const colVisible = (r) => hasTemplate
    ? (printIds ? printIds.has(String(r.payroll_item_id)) : true)
    : r.visible != 0;

  // Which side a row prints on. `payslip_section` overrides `payment_deduction` for display only —
  // an employer contribution is stored as a Payment (and posts to the GL as one) but is
  // conventionally listed under Deductions on a payslip.
  const sideOf = (r) => {
    const forced = String(r.payslip_section || '').toLowerCase();
    if (forced === 'earnings' || forced === 'deductions' || forced === 'info') return forced;
    return r.payment_deduction === 'Deduction' ? 'deductions' : 'earnings';
  };
  const isMoved    = (r) => sideOf(r) !== (r.payment_deduction === 'Deduction' ? 'deductions' : 'earnings');
  const isAggregate = (r) => aggregateIds.has(String(r.payroll_item_id));

  const printed = payrollData.filter(colVisible);
  // Itemised rows exclude aggregates; the aggregates themselves print as bold total rows in place,
  // which is what produces "…allowances… / Total Allowances / Gross Salary".
  const earnings   = printed.filter(r => sideOf(r) === 'earnings'   && !isAggregate(r));
  const deductions = printed.filter(r => sideOf(r) === 'deductions' && !isAggregate(r));
  const infoRows   = printed.filter(r => sideOf(r) === 'info');
  const earningTotals   = printed.filter(r => sideOf(r) === 'earnings'   && isAggregate(r));
  const deductionTotals = printed.filter(r => sideOf(r) === 'deductions' && isAggregate(r));

  const netRow = payrollData.find(r => (r.name || '').toLowerCase().startsWith('net'));

  // A row moved off its natural side counts only when explicitly told to. Default is not to count,
  // so showing an employer contribution under Deductions does not shrink the printed net below what
  // the employee is actually paid.
  const countsInTotal = (r) => !isMoved(r) || !!r.payslip_in_total;
  const sumOf = rows => rows.filter(countsInTotal)
    .reduce((acc, r) => acc + (parseFloat(r.amount || '0') || 0), 0);
  const totalEarnings   = sumOf(earnings);
  const totalDeductions = sumOf(deductions);
  // ── Net pay ─────────────────────────────────────────────────────────────────
  // Resolution order, most specific first:
  //   1. The template's own net_columns, when the template defines them.
  //   2. Columns flagged `include_in_net` in Payroll Setup. This is the flag's whole purpose:
  //      payrollcolumns holds both real components (Salary Basic, Paye) AND running aggregates
  //      (Gross, Gross After NASSIT, Taxable Income, Total Deduction), and only the columns that
  //      together make up net pay carry the flag.
  //   3. An explicit column whose name starts with 'Net'.
  //   4. Visible earnings minus visible deductions.
  //
  // Falling through to (4) is what produced a wrong figure: summing every visible Payment column
  // adds Gross on top of the Salary Basic it already totals, and adds Total Deduction on top of the
  // Paye and NASSIT lines it already totals — counting the same money twice on each side. For one
  // run that showed 163,545.00 on the payslip against a true net of 81,472.50.
  const netFlagged = payrollData.filter(r => r.include_in_net);
  const signedSum = rows => rows.reduce(
    (sum, r) => sum + (parseFloat(r.amount || '0') || 0) * (r.payment_deduction === 'Deduction' ? -1 : 1), 0);
  const netPay = netIds
    ? signedSum(payrollData.filter(r => netIds.has(String(r.payroll_item_id))))
    : netFlagged.length ? signedSum(netFlagged)
    : netRow ? parseFloat(netRow.amount || '0')
    : (totalEarnings - totalDeductions);

  // Company branding: template first, then global App Setup (Settings → System → App Setup).
  const setupRows = await prisma.settings.findMany({ where: { category: 'app_setup' }, select: { name: true, value: true } }).catch(() => []);
  const setup = {};
  setupRows.forEach(r => { setup[r.name] = r.value; });
  const companyName = s.company_name || setup.company_name || 'Payslip';
  // The logo always comes from App Setup, never from the template. Per-template logos were
  // confusing rather than useful: which template renders a payslip depends on payment type and
  // deduction group, so the logo shown while editing one template was often not the one printed.
  const logoBuf = await loadLogoBuffer(setup.company_logo, 'company logo (Settings > System > App Setup)');

  const [acR, acG, acB] = hexToRgb(s.accent_color);
  const empName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  const period  = run.date_start
    ? `${run.date_start.slice(0, 10)} → ${(run.date_end || '').slice(0, 10)}`
    : run.name;

  // ── Build PDF ───────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Payslip — ${empName}` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${runId}-${empId}.pdf"`);
  doc.pipe(res);

  const pageW = doc.page.width - 100; // usable width (margin 50 each side)

  // Header banner
  doc.rect(50, 50, pageW, 60).fill([acR, acG, acB]);

  // Company logo (left of the name) — drawn only if it decoded to a usable image.
  let textX = 70;
  if (logoBuf) {
    try { doc.image(logoBuf, 62, 62, { fit: [36, 36] }); textX = 108; } catch { /* unsupported image — skip */ }
  }

  doc.fillColor('white').font('Helvetica-Bold').fontSize(16)
    .text(companyName, textX, 65, { width: doc.page.width - 130 - textX });
  if (s.company_address) {
    doc.fillColor('white').font('Helvetica').fontSize(8).text(s.company_address, textX, 85, { width: doc.page.width - 130 - textX });
  }
  doc.fillColor('white').font('Helvetica').fontSize(9)
    .text('PAYSLIP', doc.page.width - 130, 72, { align: 'right', width: 80 })
    .text(period, doc.page.width - 130, 84, { align: 'right', width: 80 });

  let y = 125;

  // Header note
  if (s.header_note) {
    doc.fillColor('#6b7280').font('Helvetica-Oblique').fontSize(8).text(s.header_note, 50, y, { width: pageW });
    y += 20;
  }

  // Employee details grid
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text('Employee Details', 50, y);
  y += 14;
  doc.rect(50, y, pageW, 1).fill('#e5e7eb'); y += 6;

  const infoItems = [['Name', empName]];
  if (s.show_emp_id && emp.employee_id)  infoItems.push(['Employee ID', emp.employee_id]);
  if (s.show_department && emp.department) infoItems.push(['Department', emp.department]);
  if (s.show_position && emp.designation) infoItems.push(['Position', emp.designation]);
  if (s.show_bank_account && emp.bankAccount) infoItems.push(['Bank Account', emp.bankAccount]);
  if (run.freq_name) infoItems.push(['Pay Frequency', run.freq_name]);

  const colW = pageW / 2;
  infoItems.forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 50 + col * colW;
    const iy = y + row * 18;
    doc.fillColor('#9ca3af').font('Helvetica').fontSize(8).text(label, x, iy);
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8).text(value, x, iy + 8);
  });
  y += (Math.ceil(infoItems.length / 2)) * 18 + 14;

  // Earnings & Deductions
  const halfW = (pageW - 8) / 2;

  // Section headers
  doc.fillColor([acR, acG, acB]).font('Helvetica-Bold').fontSize(9).text('Earnings', 50, y);
  doc.fillColor([acR, acG, acB]).font('Helvetica-Bold').fontSize(9).text('Deductions', 50 + halfW + 8, y);
  y += 14;
  doc.rect(50, y, halfW, 1).fill([acR, acG, acB]);
  doc.rect(50 + halfW + 8, y, halfW, 1).fill([acR, acG, acB]);
  y += 5;

  // Each side prints its itemised rows first, then any aggregate columns the template includes as
  // bold subtotal rows — "…allowances… / Total Allowances / Gross Salary". The two sides are laid
  // out in parallel, so the row count is the longer of the two.
  const leftRows  = [...earnings.map(r => ({ r, bold: false })),   ...earningTotals.map(r => ({ r, bold: true }))];
  const rightRows = [...deductions.map(r => ({ r, bold: false })), ...deductionTotals.map(r => ({ r, bold: true }))];

  const cell = (row, x, labelW, amountX) => {
    const font = row.bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.fillColor(row.bold ? '#111827' : '#4b5563').font(font).fontSize(8)
      .text(row.r.name, x, y, { width: labelW });
    doc.fillColor('#111827').font(font).fontSize(8)
      .text(fmt(row.r.amount), amountX, y, { width: 55, align: 'right' });
  };

  const maxRows = Math.max(leftRows.length, rightRows.length, 1);
  for (let i = 0; i < maxRows; i++) {
    if (leftRows[i])  cell(leftRows[i],  50,          halfW - 60, 50 + halfW - 55);
    if (rightRows[i]) cell(rightRows[i], 58 + halfW,  halfW - 60, 58 + halfW + halfW - 55);
    y += 14;
  }

  // Totals row
  y += 4;
  doc.rect(50, y, halfW, 1).fill('#d1d5db');
  doc.rect(50 + halfW + 8, y, halfW, 1).fill('#d1d5db');
  y += 5;
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8).text('Total Earnings', 50, y, { width: halfW - 60 });
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8).text(fmt(totalEarnings), 50 + halfW - 55, y, { width: 55, align: 'right' });
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8).text('Total Deductions', 58 + halfW, y, { width: halfW - 60 });
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8).text(fmt(totalDeductions), 58 + halfW + halfW - 55, y, { width: 55, align: 'right' });
  y += 22;

  // Information-only rows: amounts shown for transparency that belong to neither subtotal (employer
  // contributions, year-to-date figures). Printed full width below the totals so they cannot be
  // mistaken for part of the net calculation.
  if (infoRows.length) {
    doc.fillColor('#6b7280').font('Helvetica-Bold').fontSize(8).text('For information', 50, y);
    y += 12;
    doc.rect(50, y, pageW, 1).fill('#e5e7eb');
    y += 5;
    infoRows.forEach(r => {
      doc.fillColor('#6b7280').font('Helvetica').fontSize(8).text(r.name, 50, y, { width: pageW - 70 });
      doc.fillColor('#6b7280').font('Helvetica').fontSize(8).text(fmt(r.amount), doc.page.width - 130, y, { width: 80, align: 'right' });
      y += 13;
    });
    y += 8;
  }

  // Net Pay banner
  doc.rect(50, y, pageW, 32).fill([Math.min(acR + 220, 255), Math.min(acG + 220, 255), Math.min(acB + 220, 255)]);
  doc.fillColor([acR, acG, acB]).font('Helvetica-Bold').fontSize(12).text('NET PAY', 65, y + 9);
  doc.fillColor([acR, acG, acB]).font('Helvetica-Bold').fontSize(12).text(fmt(netPay), doc.page.width - 130, y + 9, { align: 'right', width: 80 });
  y += 48;

  // Footer note
  if (s.footer_note) {
    doc.rect(50, y, pageW, 1).fill('#e5e7eb'); y += 6;
    doc.fillColor('#9ca3af').font('Helvetica-Oblique').fontSize(8).text(s.footer_note, 50, y, { width: pageW });
  }

  doc.end();
});

// ── My payslips list (for employee self-service) ──────────────────────────────
const getMyPayslips = asyncHandler(async (req, res) => {
  // Prefer the exact employee id (mobileAuth sets req.self/req.user.employeeId). The email/username
  // match is the web fallback and is ambiguous if two employees ever share an address — payslips are
  // the most sensitive data here, so an exact link is used whenever one is available.
  let selfId = req.self?.id ?? (req.user?.employeeId ? String(req.user.employeeId) : null);
  if (!selfId) {
    const [self] = await query`SELECT id FROM employee WHERE email = ${req.user?.email || ''} OR work_email = ${req.user?.email || ''} OR employee_id = ${req.user?.username || ''} LIMIT 1`;
    selfId = self ? String(self.id) : null;
  }
  if (!selfId) return respond.notFound(res, 'Employee record not found for this user');
  const self = { id: selfId };
  const rows = await query`
    SELECT pr.id AS run_id, pr.name, pr.date_start, pr.date_end, pr.status,
           pf.name AS freq_name
    FROM payrollruns pr
    LEFT JOIN payfrequencies pf ON pf.id = pr.pay_frequency
    LEFT JOIN paymenttype pt ON pt.id = pr.payment_type_id
    WHERE pr.status IN ('Completed','Approved')
      AND COALESCE(pt.generate_payslip, TRUE)
      AND EXISTS (
        SELECT 1 FROM payrolldata pd WHERE pd.payroll = pr.id AND pd.employee = ${BigInt(self.id)}
      )
    ORDER BY pr.date_start DESC, pr.created_at DESC`;
  respond.ok(res, 'My payslips retrieved', { employeeId: String(self.id), runs: rows });
});

// ── My annual earnings & tax summary (employee self-service) ─────────────────
const getMyTaxSummary = asyncHandler(async (req, res) => {
  // Resolve own employee — prefer the users.employeeId link, fall back to email match
  let empId = req.user?.employeeId ? String(req.user.employeeId) : null;
  if (!empId) {
    const [self] = await query`SELECT id FROM employee WHERE email = ${req.user?.email || ''} OR work_email = ${req.user?.email || ''} OR employee_id = ${req.user?.username || ''} LIMIT 1`;
    empId = self ? String(self.id) : null;
  }
  if (!empId) return respond.notFound(res, 'Employee record not found for this user');

  const years = await query`
    SELECT DISTINCT EXTRACT(YEAR FROM pr.date_start) AS y
    FROM payrolldata pd JOIN payrollruns pr ON pr.id = pd.payroll
    WHERE pd.employee = ${BigInt(empId)} AND pr.status IN ('Completed','Approved') AND pr.date_start IS NOT NULL
    ORDER BY y DESC`;
  const yearList = years.map(r => String(r.y)).filter(y => y && y !== 'null');

  const year = String(req.query.year ?? '').match(/^\d{4}$/)
    ? String(req.query.year)
    : (yearList[0] ?? String(new Date().getFullYear()));

  const rows = await query`
    SELECT pr.id AS run_id, pr.name AS run_name, pr.date_start, pr.date_end,
           COALESCE(NULLIF(pc.payslip_label,''), pc.name) AS item,
           pc.payment_deduction,
           CONCAT(pd.amount, '') AS amount
    FROM payrolldata pd
    JOIN payrollruns pr ON pr.id = pd.payroll
    JOIN payrollcolumns pc ON pc.id = pd.payroll_item
    WHERE pd.employee = ${BigInt(empId)} AND pr.status IN ('Completed','Approved') AND EXTRACT(YEAR FROM pr.date_start) = ${Number(year)}
    ORDER BY pr.date_start ASC`;

  const isTax = name => /tax|paye/i.test(String(name ?? ''));
  const byRun = new Map();
  rows.forEach(r => {
    const k = String(r.run_id);
    if (!byRun.has(k)) {
      byRun.set(k, {
        run: r.run_name,
        period: r.date_start ? `${String(r.date_start).slice(0, 10)} → ${String(r.date_end ?? '').slice(0, 10)}` : r.run_name,
        gross: 0, tax: 0, other_deductions: 0,
      });
    }
    const a = byRun.get(k);
    const amt = parseFloat(r.amount || '0') || 0;
    if (r.payment_deduction === 'Deduction') {
      if (isTax(r.item)) a.tax += amt; else a.other_deductions += amt;
    } else {
      a.gross += amt;
    }
  });

  respond.ok(res, 'Tax summary', {
    year,
    years: yearList,
    runs: [...byRun.values()].map(a => ({ ...a, net: a.gross - a.tax - a.other_deductions })),
  });
});

module.exports = { downloadPayslip, getMyPayslips, getMyTaxSummary };
