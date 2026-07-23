import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { Download, Upload, Loader2, X, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getSettings } from '../../lib/settings';
import { EMPLOYEE_ID_MAX_LENGTH } from '../../lib/employeeIdFormat';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type ColKind = 'text' | 'date' | 'enum' | 'codelist' | 'structure' | 'supervisor' | 'paygrade' | 'notch';

interface Col {
  header: string;
  key: string;
  kind: ColKind;
  code?: string;          // code-list code
  structure?: string[];   // structure typeLabels
  options?: string[];     // enum options
  required?: boolean;
  example: string;
}

// Full employee record — columns map 1:1 onto the keys POST /employees expects.
// `required` mirrors the Add Employee form's per-step validation exactly, so the
// sheet enforces the same mandatory fields as onboarding through the form.
const COLUMNS: Col[] = [
  // Personal
  { header: 'Title',              key: 'titleId',          kind: 'codelist', code: 'TIT',  example: 'Mr' },
  { header: 'First Name*',        key: 'firstName',        kind: 'text', required: true,   example: 'John' },
  { header: 'Middle Name',        key: 'middleName',       kind: 'text',                   example: '' },
  { header: 'Last Name*',         key: 'lastName',         kind: 'text', required: true,   example: 'Doe' },
  { header: 'Gender*',            key: 'genderId',         kind: 'codelist', code: 'GEN', required: true, example: 'Male' },
  { header: 'Date of Birth*',     key: 'dateOfBirth',      kind: 'date', required: true,   example: '1990-05-20' },
  { header: 'Place of Birth',     key: 'place_of_birth',   kind: 'text',                   example: 'Accra' },
  { header: 'Nationality',        key: 'nationalityId',    kind: 'codelist', code: 'NAT',  example: 'Ghanaian' },
  { header: 'Religion',           key: 'religionId',       kind: 'codelist', code: 'REG',  example: '' },
  { header: 'Marital Status*',    key: 'marital_status',   kind: 'enum', required: true, options: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'], example: 'Single' },
  { header: 'Spouse Name',        key: 'spouse_name',      kind: 'text',                   example: '' },
  { header: "Father's Name",      key: 'father_name',      kind: 'text',                   example: '' },
  { header: "Mother's Name",      key: 'mother_name',      kind: 'text',                   example: '' },
  // Contact & Address
  { header: 'Work Email*',        key: 'work_email',       kind: 'text', required: true,   example: 'john.doe@company.com' },
  { header: 'Personal Email',     key: 'personal_email',   kind: 'text',                   example: '' },
  { header: 'Mobile Phone*',      key: 'mobilePhone',      kind: 'text', required: true,   example: '0244000000' },
  { header: 'Address*',           key: 'address1',         kind: 'text', required: true,   example: '12 High Street' },
  { header: 'City',               key: 'city',             kind: 'text',                   example: 'Accra' },
  { header: 'Country',            key: 'country',          kind: 'codelist', code: 'CT',   example: 'Ghana' },
  // Employment
  { header: 'Employee ID',        key: 'employee_id',      kind: 'text',                   example: '' },
  { header: 'Job Title*',         key: 'jobTitleId',       kind: 'codelist', code: 'JOBT', required: true, example: 'Software Engineer' },
  { header: 'Employment Status*', key: 'employmentStatusId', kind: 'codelist', code: 'EMPS', required: true, example: 'Permanent' },
  { header: 'Staff Level*',       key: 'staff_level',      kind: 'codelist', code: 'STAFL', required: true, example: 'Level 1' },
  { header: 'Staff Role*',        key: 'staff_role',       kind: 'codelist', code: 'STAFR', required: true, example: 'Officer' },
  { header: 'Department',         key: 'departmentId',     kind: 'structure', structure: ['Department'], example: 'IT' },
  { header: 'Branch',             key: 'branchId',         kind: 'structure', structure: ['Branch', 'Head Office'], example: 'Head Office' },
  { header: 'Unit',               key: 'unitId',           kind: 'structure', structure: ['Unit'],   example: '' },
  { header: 'Outlet',             key: 'outletId',         kind: 'structure', structure: ['Outlet'], example: '' },
  { header: 'Supervisor*',        key: 'supervisorId',     kind: 'supervisor', required: true, example: '' },
  { header: 'SSN*',               key: 'ssn_num',          kind: 'text', required: true,   example: 'SSN123456' },
  { header: 'Hire Date*',         key: 'hireDate',         kind: 'date', required: true,   example: '2024-01-15' },
  { header: 'Confirmation Date*', key: 'confirmationDate', kind: 'date', required: true,   example: '2024-07-15' },
  // Next of Kin
  { header: 'Next of Kin Name*',   key: 'nxt_kin_fname',   kind: 'text', required: true,   example: 'Mary Doe' },
  { header: 'Next of Kin Phone*',  key: 'nxt_kin_phone',   kind: 'text', required: true,   example: '0244111111' },
  { header: 'Next of Kin Email',   key: 'nxt_kin_email',   kind: 'text',                   example: '' },
  { header: 'Next of Kin Address*',key: 'nxt_kin_address', kind: 'text', required: true,   example: '12 High Street' },
  // Financial
  { header: 'Bank Account*',      key: 'bankAccount',      kind: 'text', required: true,   example: '0123456789' },
  { header: 'Pay Grade*',         key: 'paygradeId',       kind: 'paygrade', required: true, example: '' },
  { header: 'Salary Notch*',      key: 'notcheId',         kind: 'notch', required: true,  example: '' },
  // Identity Documents (number ↔ expiry are required together, mirroring the form)
  { header: 'National ID Number', key: 'nationalIdNumber', kind: 'text',                   example: '' },
  { header: 'National ID Expiry', key: 'nationalIdExpiry', kind: 'date',                   example: '' },
  { header: 'Passport Number',    key: 'passportNumber',   kind: 'text',                   example: '' },
  { header: 'Passport Expiry',    key: 'passportExpiry',   kind: 'date',                   example: '' },
  { header: 'Driver License Number', key: 'driverLicenseNum', kind: 'text',                example: '' },
  { header: 'Driver License Expiry', key: 'driverLicenseExp', kind: 'date',                example: '' },
];

// Identity document pairs — if one side is filled the other becomes required (form rule).
const DOC_PAIRS: { a: string; b: string; label: string }[] = [
  { a: 'nationalIdNumber', b: 'nationalIdExpiry', label: 'National ID' },
  { a: 'passportNumber',   b: 'passportExpiry',   label: 'Passport' },
  { a: 'driverLicenseNum', b: 'driverLicenseExp', label: "Driver's License" },
];

// Section bands above the header row — counts must sum to COLUMNS.length and follow
// the same grouping/order as COLUMNS.
const SECTIONS: { name: string; count: number; color: string }[] = [
  { name: 'Personal',           count: 13, color: 'FF2563EB' },
  { name: 'Contact & Address',  count: 6,  color: 'FF0891B2' },
  { name: 'Employment',         count: 13, color: 'FF7C3AED' },
  { name: 'Next of Kin',        count: 4,  color: 'FFD97706' },
  { name: 'Financial',          count: 3,  color: 'FF059669' },
  { name: 'Identity Documents', count: 6,  color: 'FFDC2626' },
];

interface Lists {
  cl: Record<string, { id: string; label: string }[]>;
  structures: any[];
  supervisors: any[];
  paygrades: any[];
  notches: any[];
}

const norm = (v: any) => String(v ?? '').trim();
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function normalizeDate(v: any): string {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = norm(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

export function EmployeeImport({ onClose, onImported }: Props) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/system/code-lists/TIT/values'),
      api.get('/system/code-lists/GEN/values'),
      api.get('/system/code-lists/NAT/values'),
      api.get('/system/code-lists/REG/values'),
      api.get('/system/code-lists/EMPS/values'),
      api.get('/system/code-lists/JOBT/values'),
      api.get('/system/code-lists/STAFL/values'),
      api.get('/system/code-lists/STAFR/values'),
      api.get('/system/code-lists/CT/values'),
      api.get('/company/structures'),
      api.get('/employees/active'),
      api.get('/employees/paygrades'),
      api.get('/employees/notches'),
    ]).then(([tit, gen, nat, reg, emps, jobt, stafl, stafr, ct, struct, sup, pg, nc]) => {
      setLists({
        cl: {
          TIT: tit.data.data ?? [], GEN: gen.data.data ?? [], NAT: nat.data.data ?? [],
          REG: reg.data.data ?? [], EMPS: emps.data.data ?? [], JOBT: jobt.data.data ?? [],
          STAFL: stafl.data.data ?? [], STAFR: stafr.data.data ?? [], CT: ct.data.data ?? [],
        },
        structures:  struct.data.data ?? [],
        supervisors: sup.data.data ?? [],
        paygrades:   pg.data.data ?? [],
        notches:     nc.data.data ?? [],
      });
    }).catch(() => toast.error('Failed to load reference data'))
      .finally(() => setLoading(false));
  }, []);

  // Options shown in the dropdown for a given column, drawn from live reference data.
  function optionsFor(col: Col): string[] {
    let opts: string[] = [];
    switch (col.kind) {
      case 'enum':       opts = col.options ?? []; break;
      case 'codelist':   opts = (lists!.cl[col.code!] ?? []).map(o => String(o.label ?? '')); break;
      case 'structure':  opts = lists!.structures.filter((s: any) => col.structure!.includes(s.typeLabel)).map((s: any) => String(s.title ?? '')); break;
      case 'supervisor': opts = lists!.supervisors.map((e: any) => String(e.name ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim())); break;
      case 'paygrade':   opts = lists!.paygrades.map((p: any) => String(p.name ?? '')); break;
      case 'notch':      opts = lists!.notches.map((n: any) => String(n.name ?? '')); break;
      default: return [];
    }
    return [...new Set(opts.filter(Boolean))];
  }

  const DATA_ROWS = 200;     // empty entry rows pre-formatted with dropdowns
  const HEADER_ROW = 4;      // row holding the column headers (parser locates it dynamically)
  const FIRST_DATA = 5;      // first row a user fills

  async function downloadTemplate() {
    if (!lists) return;
    const ExcelJS = (await import('exceljs')).default;
    const ACCENT = 'FF1D4ED8';
    const HEADER_BG = 'FF1E293B';
    const n = COLUMNS.length;
    const border = (argb: string) => ({
      top: { style: 'thin' as const, color: { argb } }, left: { style: 'thin' as const, color: { argb } },
      bottom: { style: 'thin' as const, color: { argb } }, right: { style: 'thin' as const, color: { argb } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HR System';
    wb.created = new Date();

    // ── Instructions cover sheet ──────────────────────────────────────────────
    const info = wb.addWorksheet('Instructions', { properties: { tabColor: { argb: ACCENT } } });
    info.getColumn(1).width = 4;
    info.getColumn(2).width = 100;
    info.mergeCells(1, 1, 1, 2);
    const it = info.getCell(1, 1);
    it.value = 'Employee Onboarding — Instructions';
    it.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    it.alignment = { vertical: 'middle', indent: 1 };
    it.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    info.getRow(1).height = 34;

    const lines: [string, boolean][] = [
      ['How to complete this form', true],
      ['• Open the “Employees” tab and enter one employee per row, starting at the first empty row.', false],
      ['• Columns marked with * are required. The rest are optional.', false],
      ['• Coloured-band columns (Title, Gender, Job Title, Department, Supervisor, Pay Grade, etc.) have a built-in dropdown — click the cell and pick a value so it matches our records exactly.', false],
      ['• Enter dates as YYYY-MM-DD (e.g. 1990-05-20).', false],
      ['• Leave “Employee ID” blank to let the system generate it automatically.', false],
      ['• Please do not rename, reorder, or delete the column headers.', false],
      ['', false],
      ['Required fields', true],
      [COLUMNS.filter(c => c.required).map(c => c.header.replace('*', '')).join(', '), false],
      ['', false],
      ['If a number is entered for National ID, Passport, or Driver’s License, its expiry date is also required (and vice-versa).', false],
    ];
    let r = 3;
    for (const [text, heading] of lines) {
      info.mergeCells(r, 1, r, 2);
      const cell = info.getCell(r, 2);
      cell.value = text;
      cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      if (heading) cell.font = { bold: true, size: 12, color: { argb: ACCENT } };
      else cell.font = { size: 11, color: { argb: 'FF334155' } };
      info.getRow(r).height = heading ? 24 : (text.length > 90 ? 32 : 18);
      r++;
    }

    // ── Employees data-entry sheet ────────────────────────────────────────────
    const ws = wb.addWorksheet('Employees', {
      properties: { tabColor: { argb: ACCENT } },
      views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    });
    COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(c.header.length + 2, 16); });

    // Row 1 — title banner
    ws.mergeCells(1, 1, 1, n);
    const title = ws.getCell(1, 1);
    title.value = 'EMPLOYEE ONBOARDING FORM';
    title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.alignment = { vertical: 'middle', indent: 1 };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    ws.getRow(1).height = 30;

    // Row 2 — subtitle
    ws.mergeCells(2, 1, 2, n);
    const sub = ws.getCell(2, 1);
    sub.value = 'One employee per row  •  Columns marked * are required  •  Click a coloured-band column to pick from its dropdown';
    sub.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    sub.alignment = { vertical: 'middle', indent: 1 };
    sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getRow(2).height = 20;

    // Row 3 — section bands (only if counts line up with the columns)
    if (SECTIONS.reduce((s, x) => s + x.count, 0) === n) {
      let col = 1;
      for (const sec of SECTIONS) {
        const to = col + sec.count - 1;
        ws.mergeCells(3, col, 3, to);
        const cell = ws.getCell(3, col);
        cell.value = sec.name.toUpperCase();
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sec.color } };
        col = to + 1;
      }
      ws.getRow(3).height = 18;
    }

    // Row 4 — column headers
    COLUMNS.forEach((c, i) => {
      const cell = ws.getCell(HEADER_ROW, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      cell.border = border('FF334155');
    });
    ws.getRow(HEADER_ROW).height = 30;
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: n } };

    // Empty entry rows — light grid + dropdowns
    const listSheet = wb.addWorksheet('Lists');
    listSheet.state = 'hidden';
    for (let row = FIRST_DATA; row < FIRST_DATA + DATA_ROWS; row++) {
      for (let c = 1; c <= n; c++) ws.getCell(row, c).border = border('FFE2E8F0');
    }
    COLUMNS.forEach((col, i) => {
      const isDropdown = ['enum', 'codelist', 'structure', 'supervisor', 'paygrade', 'notch'].includes(col.kind);
      if (!isDropdown) return;
      const opts = optionsFor(col);
      if (!opts.length) return;
      const colNo = i + 1;
      const letter = listSheet.getColumn(colNo).letter;
      opts.forEach((opt, k) => { listSheet.getCell(`${letter}${k + 1}`).value = opt; });
      const ref = `Lists!$${letter}$1:$${letter}$${opts.length}`;
      for (let row = FIRST_DATA; row < FIRST_DATA + DATA_ROWS; row++) {
        ws.getCell(row, colNo).dataValidation = {
          type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: false,
        };
      }
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'employee-onboarding-template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  // Resolve one cell to the value the API expects, pushing a row error when invalid.
  function resolve(col: Col, raw: any, rowNum: number, errors: string[]): any {
    const value = norm(raw);
    if (!value) {
      if (col.required) errors.push(`Row ${rowNum}: "${col.header.replace('*', '')}" is required`);
      return col.kind === 'codelist' || col.kind === 'structure' || col.kind === 'supervisor' ||
             col.kind === 'paygrade' || col.kind === 'notch' ? null : '';
    }
    switch (col.kind) {
      case 'text': return value;
      case 'date': return normalizeDate(raw);
      case 'enum': {
        const match = col.options!.find(o => eq(o, value));
        if (!match) { errors.push(`Row ${rowNum}: ${col.header} must be one of ${col.options!.join(', ')}`); return null; }
        return match;
      }
      case 'codelist': {
        const found = (lists!.cl[col.code!] ?? []).find(o => eq(o.label, value));
        if (!found) { errors.push(`Row ${rowNum}: ${col.header.replace('*', '')} "${value}" not recognized`); return null; }
        return found.id;
      }
      case 'structure': {
        const found = lists!.structures.find((s: any) => col.structure!.includes(s.typeLabel) && eq(String(s.title ?? ''), value));
        if (!found) { errors.push(`Row ${rowNum}: ${col.header} "${value}" not found`); return null; }
        return String(found.id);
      }
      case 'supervisor': {
        const found = lists!.supervisors.find((e: any) =>
          eq(String(e.employee_id ?? ''), value) ||
          eq(String(e.name ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()), value));
        if (!found) { errors.push(`Row ${rowNum}: Supervisor "${value}" not found`); return null; }
        return String(found.id);
      }
      case 'paygrade': {
        const found = lists!.paygrades.find((p: any) => eq(String(p.name ?? ''), value));
        if (!found) { errors.push(`Row ${rowNum}: Pay Grade "${value}" not found`); return null; }
        return String(found.id);
      }
      case 'notch': {
        const found = lists!.notches.find((n: any) => eq(String(n.name ?? ''), value));
        if (!found) { errors.push(`Row ${rowNum}: Salary Notch "${value}" not found`); return null; }
        return String(found.id);
      }
      default: return value;
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !lists) return;
    setResult(null);

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws  = wb.Sheets['Employees'] ?? wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

    // Locate the header row — the styled template has banner rows above it.
    const known = new Set(COLUMNS.map(c => c.header.toLowerCase()));
    let hdrIdx = rows.findIndex(rw => (rw ?? []).filter((c: any) => known.has(norm(c).toLowerCase())).length >= 3);
    if (hdrIdx < 0) hdrIdx = 0;
    if (rows.length <= hdrIdx + 1) { toast.error('The file has no data rows'); return; }

    const headerRow = (rows[hdrIdx] ?? []).map((h: any) => norm(h).toLowerCase());
    const colIndex: Record<string, number> = {};
    for (const col of COLUMNS) colIndex[col.key] = headerRow.indexOf(col.header.toLowerCase());

    const autoGenEmpNum = getSettings().employees.autoGenerateNumber;
    const errors: string[] = [];
    const payloads: any[] = [];

    rows.slice(hdrIdx + 1).forEach((row, i) => {
      const rowNum = hdrIdx + 2 + i;  // 1-based spreadsheet row number
      if (row.every(c => norm(c) === '')) return; // skip blank lines
      const rowErrors: string[] = [];
      const payload: any = {};
      for (const col of COLUMNS) {
        const idx = colIndex[col.key];
        const cell = idx >= 0 ? row[idx] : '';
        payload[col.key] = resolve(col, cell, rowNum, rowErrors);
      }

      // Employee ID is required only when auto-generate is off (matches the form)
      if (!autoGenEmpNum && !norm(payload.employee_id)) {
        rowErrors.push(`Row ${rowNum}: Employee ID is required (auto-generate is off)`);
      }
      // Staff ID length cap applies to any provided value
      if (norm(payload.employee_id).length > EMPLOYEE_ID_MAX_LENGTH) {
        rowErrors.push(`Row ${rowNum}: Employee ID cannot exceed ${EMPLOYEE_ID_MAX_LENGTH} characters`);
      }
      // Identity document number ↔ expiry must be supplied together
      for (const p of DOC_PAIRS) {
        const hasA = !!norm(payload[p.a]);
        const hasB = !!norm(payload[p.b]);
        if (hasA && !hasB) rowErrors.push(`Row ${rowNum}: ${p.label} expiry is required when a number is provided`);
        if (hasB && !hasA) rowErrors.push(`Row ${rowNum}: ${p.label} number is required when an expiry is provided`);
      }

      if (rowErrors.length) { errors.push(...rowErrors); return; }
      payloads.push({ rowNum, payload });
    });

    if (!payloads.length) {
      setResult({ created: 0, errors });
      if (errors.length) toast.error(`${errors.length} issue(s) found — see details below`);
      return;
    }

    setBusy(true);
    setProgress({ done: 0, total: payloads.length });
    let created = 0;
    for (let i = 0; i < payloads.length; i++) {
      const { rowNum, payload } = payloads[i];
      try {
        await api.post('/employees', payload);
        created++;
      } catch (err: any) {
        errors.push(`Row ${rowNum}: ${err?.response?.data?.message ?? 'failed to create'}`);
      }
      setProgress({ done: i + 1, total: payloads.length });
    }
    setBusy(false);
    setProgress(null);
    setResult({ created, errors });
    if (created) { toast.success(`${created} employee${created !== 1 ? 's' : ''} imported`); onImported(); }
    if (errors.length) toast.error(`${errors.length} row(s) skipped`);
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative bg-[var(--surface)] border border-[var(--border)] rounded-[16px] w-full max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--accent-dim)]">
              <FileSpreadsheet size={18} className="text-[var(--accent)]" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-[var(--text-primary)] syne">Import Employees</h2>
              <p className="text-[12px] text-[var(--text-muted)]">Bulk-create employees from an Excel or CSV file.</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="action-btn disabled:opacity-40"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-16 text-center text-[var(--text-muted)]"><Loader2 className="animate-spin inline" size={18} /></div>
          ) : (
            <>
              <ol className="text-[13px] text-[var(--text-secondary)] leading-relaxed list-decimal pl-5 space-y-1">
                <li>Download the template and fill one employee per row.</li>
                <li>Dropdown columns (Gender, Job Title, Department, Supervisor, etc.) have a built-in picker — click the cell and choose an option.</li>
                <li>Columns marked <span className="font-semibold">*</span> are required. Leave Employee ID blank to auto-generate.</li>
                <li>Upload the completed file — imported employees follow your approval setting, exactly like the Add form.</li>
              </ol>

              <div className="flex flex-wrap items-center gap-2.5">
                <button onClick={() => downloadTemplate().catch(() => toast.error('Failed to generate template'))} className="secondary-btn">
                  <Download size={14} /> Download Template
                </button>
                <label className={`primary-btn cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
                  <Upload size={14} /> {busy ? 'Importing…' : 'Upload File'}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={handleFile} />
                </label>
              </div>

              {progress && (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-[var(--bg)] overflow-hidden">
                    <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                  <p className="text-[12px] text-[var(--text-muted)] text-center">Creating {progress.done} of {progress.total}…</p>
                </div>
              )}

              {result && (
                <div className="space-y-3">
                  {result.created > 0 && (
                    <div className="flex items-center gap-2 rounded-[10px] border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">{result.created} employee{result.created !== 1 ? 's' : ''} imported successfully.</span>
                    </div>
                  )}
                  {result.errors.length > 0 && (
                    <div className="rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger)]/5 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--danger)]/20">
                        <AlertTriangle size={14} className="text-[var(--danger)] shrink-0" />
                        <span className="text-[12px] font-semibold text-[var(--danger)]">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped</span>
                      </div>
                      <ul className="max-h-[200px] overflow-y-auto px-3 py-2 space-y-1">
                        {result.errors.map((err, i) => (
                          <li key={i} className="text-[12px] text-[var(--text-secondary)] leading-snug">• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--border)] flex justify-end">
          <button onClick={onClose} disabled={busy} className="secondary-btn disabled:opacity-40">
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
