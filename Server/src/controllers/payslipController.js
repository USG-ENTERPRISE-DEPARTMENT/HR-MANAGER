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

async function loadLogoBuffer(src) {
  if (!src || !String(src).trim()) return null;
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
  } catch {
    return null;
  }

  return null;
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
    const [self] = await query`SELECT id FROM employee WHERE email = ${req.user?.email || ''} OR work_email = ${req.user?.email || ''} OR employee_id = ${req.user?.username || ''} LIMIT 1`;
    if (!self || String(self.id) !== String(empId)) {
      return respond.badReq(res, 'You can only download your own payslip');
    }
  }

  // ── Fetch run, settings, employee ──────────────────────────────────────────
  const [run] = await query`
    SELECT pr.id, pr.name, pr.date_start, pr.date_end, pr.status, pr.payment_type_id,
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
           COALESCE(jt.label, e.jobTitleId) AS designation,
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
           CONCAT(pd.amount, '') AS amount
    FROM payrolldata pd
    JOIN payrollcolumns pc ON pc.id = pd.payroll_item
    WHERE pd.payroll = ${BigInt(runId)} AND pd.employee = ${BigInt(empId)}
    ORDER BY COALESCE(pc.colorder, 99999)`;

  // Find the best-matching template: payment type + group, then payment type,
  // then group, then the default template.
  const allTemplates = await query`
    SELECT * FROM payslip_settings
    ORDER BY payment_type_id IS NULL ASC, deduction_group_id IS NULL ASC, id ASC`.catch(() => []);
  const [empPe] = await query`SELECT deduction_group FROM payrollemployees WHERE employee = ${BigInt(empId)} LIMIT 1`.catch(() => [null]);
  const empGroup = empPe?.deduction_group ? String(empPe.deduction_group) : null;
  const runPaymentType = run.payment_type_id ? String(run.payment_type_id) : null;
  const [settings] = allTemplates
    .filter(t => runPaymentType && empGroup && String(t.payment_type_id) === runPaymentType && String(t.deduction_group_id) === empGroup)
    .concat(allTemplates.filter(t => runPaymentType && String(t.payment_type_id) === runPaymentType && !t.deduction_group_id))
    .concat(allTemplates.filter(t => empGroup && !t.payment_type_id && String(t.deduction_group_id) === empGroup))
    .concat(allTemplates.filter(t => !t.payment_type_id && !t.deduction_group_id));
  const hasTemplate = !!settings;
  const s = settings || {};

  // ── Categorise columns ──────────────────────────────────────────────────────
  let visibleIds = null;
  if (s.visible_columns) {
    try { visibleIds = new Set(JSON.parse(s.visible_columns).map(String)); } catch { /* ignore */ }
  }
  let netIds = null;
  if (s.net_columns) {
    try { netIds = new Set(JSON.parse(s.net_columns).map(String)); } catch { /* ignore */ }
  }
  const colVisible = (r) => hasTemplate
    ? (visibleIds ? visibleIds.has(String(r.payroll_item_id)) : true)
    : r.visible != 0;
  const earnings   = payrollData.filter(r => r.payment_deduction === 'Payment'   && colVisible(r));
  const deductions = payrollData.filter(r => r.payment_deduction === 'Deduction' && colVisible(r));
  const netRow     = payrollData.find(r => (r.name || '').toLowerCase().startsWith('net'));
  const totalEarnings  = earnings.reduce((s, r) => s + parseFloat(r.amount || '0'), 0);
  const totalDeductions = deductions.reduce((s, r) => s + parseFloat(r.amount || '0'), 0);
  const netPay = netIds
    ? payrollData
        .filter(r => netIds.has(String(r.payroll_item_id)))
        .reduce((sum, r) => sum + (parseFloat(r.amount || '0') || 0) * (r.payment_deduction === 'Deduction' ? -1 : 1), 0)
    : (netRow ? parseFloat(netRow.amount || '0') : (totalEarnings - totalDeductions));

  // Company branding: template first, then global App Setup (Settings → System → App Setup).
  const setupRows = await prisma.settings.findMany({ where: { category: 'app_setup' }, select: { name: true, value: true } }).catch(() => []);
  const setup = {};
  setupRows.forEach(r => { setup[r.name] = r.value; });
  const companyName = s.company_name || setup.company_name || 'Payslip';
  const logoBuf = await loadLogoBuffer(s.company_logo_url || setup.company_logo || '');

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

  const maxRows = Math.max(earnings.length, deductions.length, 1);
  for (let i = 0; i < maxRows; i++) {
    const e = earnings[i];
    const d = deductions[i];
    if (e) {
      doc.fillColor('#4b5563').font('Helvetica').fontSize(8).text(e.name, 50, y, { width: halfW - 60 });
      doc.fillColor('#111827').font('Helvetica').fontSize(8).text(fmt(e.amount), 50 + halfW - 55, y, { width: 55, align: 'right' });
    }
    if (d) {
      doc.fillColor('#4b5563').font('Helvetica').fontSize(8).text(d.name, 58 + halfW, y, { width: halfW - 60 });
      doc.fillColor('#111827').font('Helvetica').fontSize(8).text(fmt(d.amount), 58 + halfW + halfW - 55, y, { width: 55, align: 'right' });
    }
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
  const [self] = await query`SELECT id FROM employee WHERE email = ${req.user?.email || ''} OR work_email = ${req.user?.email || ''} OR employee_id = ${req.user?.username || ''} LIMIT 1`;
  if (!self) return respond.notFound(res, 'Employee record not found for this user');
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
