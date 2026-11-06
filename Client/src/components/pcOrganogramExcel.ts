import type { PcNode } from './PcCodeOrganogram';

// Excel export of the PC code organogram. Three sheets:
//   Organogram    — the hierarchy as a staircase: one column per stage (level), each position in its
//                   stage's column, coloured like the chart, with Excel outline grouping so stages can
//                   be collapsed/expanded with the +/- buttons.
//   Stage Summary — positions, filled, vacant, RM/RO and no-supervisor counts per stage.
//   Positions     — flat, filterable table with each position's full chain of command.

// Same palette as the chart (PcCodeOrganogram nodeCfg), as ARGB.
const PALETTE = {
  RM:     { accent: 'FF0066B3', bg: 'FFEFF6FF', text: 'FF1D4ED8', label: 'RM — filled' },
  RO:     { accent: 'FF059669', bg: 'FFF0FDF4', text: 'FF065F46', label: 'RO — filled' },
  VACANT: { accent: 'FF64748B', bg: 'FFF8FAFC', text: 'FF334155', label: 'Vacant' },
  ORPHAN: { accent: 'FFB45309', bg: 'FFFFFBEB', text: 'FF92400E', label: 'No supervisor' },
};
type Kind = keyof typeof PALETTE;
const kindOf = (n: PcNode): Kind =>
  !n.current_employee_name ? 'VACANT' : n.is_ordinary_root ? 'ORPHAN' : n.rm_ro_type === 'RO' ? 'RO' : 'RM';

const HEADER_BG = 'FF1E293B';
const TITLE_BG  = 'FF0066B3';
const GRID      = 'FFE2E8F0';
// Faint tint per stage so the staircase columns read as bands.
const STAGE_TINTS = ['FFF1F5F9', 'FFF8FAFC'];

interface Row { node: PcNode; depth: number; parent: PcNode | null; path: PcNode[]; direct: number; total: number }

// Depth-first walk in chart order. `seen` guards against reporting cycles, as the chart does.
function flatten(roots: PcNode[], childrenMap: Map<string, PcNode[]>): Row[] {
  const rows: Row[] = [];
  const walk = (node: PcNode, depth: number, parent: PcNode | null, path: PcNode[], seen: Set<string>): number => {
    const kids = (childrenMap.get(node.id) ?? []).filter(c => !seen.has(c.id) && c.id !== node.id);
    const row: Row = { node, depth, parent, path: [...path, node], direct: kids.length, total: 0 };
    rows.push(row);
    const nextSeen = new Set(seen).add(node.id);
    for (const k of kids) row.total += 1 + walk(k, depth + 1, node, row.path, nextSeen);
    return row.total;
  };
  roots.forEach(r => walk(r, 0, null, [], new Set()));
  return rows;
}

// Cost center comes from the server (bank + branch + department codes). A filled seat without one is
// flagged, since a blank would read as "not applicable" rather than "branch/department code missing".
const MISSING = 'Missing';
const costCell = (n: PcNode) => (n.current_employee_name ? (n.cost_center ?? MISSING) : '');
const styleMissing = (c: any) => {
  c.value = MISSING;
  c.font = { size: 9, bold: true, color: { argb: PALETTE.ORPHAN.text } };
  c.fill = solid(PALETTE.ORPHAN.bg);
  c.note = 'No cost center: the employee has no branch, the branch/department has no code, or a Head Office employee has no department.';
};

const thin = (argb: string) => ({ style: 'thin' as const, color: { argb } });
const box = (argb: string) => ({ top: thin(argb), left: thin(argb), bottom: thin(argb), right: thin(argb) });
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

export async function exportPcOrganogramExcel(
  roots: PcNode[], childrenMap: Map<string, PcNode[]>, opts: { filter?: string } = {},
) {
  const ExcelJS = (await import('exceljs')).default;
  const rows = flatten(roots, childrenMap);
  const stages = Math.max(1, ...rows.map(r => r.depth + 1));
  const generated = new Date().toLocaleString();
  const subtitle = `Generated ${generated}` + (opts.filter ? `  ·  Filtered by "${opts.filter}" (matching positions and their reporting line)` : '');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR System';
  wb.created = new Date();

  // Title + subtitle band across `width` columns; returns the next free row.
  const titleBlock = (ws: any, width: number, title: string) => {
    ws.mergeCells(1, 1, 1, width);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    t.fill = solid(TITLE_BG);
    t.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 32;
    ws.mergeCells(2, 1, 2, width);
    const s = ws.getCell(2, 1);
    s.value = subtitle;
    s.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    s.alignment = { indent: 1 };
  };
  const headerRow = (ws: any, rowNo: number, headers: string[]) => {
    const r = ws.getRow(rowNo);
    headers.forEach((h, i) => {
      const c = r.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      c.fill = solid(HEADER_BG);
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = box(HEADER_BG);
    });
    r.height = 24;
  };

  // ── Sheet 1: Organogram (staircase) ────────────────────────────────────────
  const DETAIL = ['PC Code', 'Current Holder', 'Employee ID', 'Cost Center', 'Type', 'Reports To (Code)', 'Reports To', 'Direct Reports', 'Total Under', 'Status'];
  const STATUS_COL = DETAIL.length - 1;
  const width = stages + DETAIL.length;
  const org = wb.addWorksheet('Organogram', {
    properties: { tabColor: { argb: TITLE_BG }, outlineLevelRow: 1 },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 6 }],
  });
  // Summary rows above the detail they group, so "+" sits on the manager's own row.
  org.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  titleBlock(org, width, 'PC Code Organogram');

  // Legend (row 3) + headline counts (row 4)
  const legendRow = org.getRow(3);
  legendRow.getCell(1).value = 'Legend:';
  legendRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475569' } };
  (Object.keys(PALETTE) as Kind[]).forEach((k, i) => {
    const c = legendRow.getCell(i + 2);
    c.value = PALETTE[k].label;
    c.font = { bold: true, size: 9, color: { argb: PALETTE[k].text } };
    c.fill = solid(PALETTE[k].bg);
    c.border = { ...box(GRID), left: { style: 'thick', color: { argb: PALETTE[k].accent } } };
    c.alignment = { horizontal: 'center' };
  });
  const filled = rows.filter(r => r.node.current_employee_name).length;
  org.getCell(4, 1).value =
    `${rows.length} positions  ·  ${filled} filled  ·  ${rows.length - filled} vacant  ·  ${stages} stage${stages === 1 ? '' : 's'}  ·  ` +
    'Use the + / − buttons on the left (or Data › Group) to collapse and expand stages.';
  org.getCell(4, 1).font = { size: 9, color: { argb: 'FF475569' } };

  headerRow(org, 6, [...Array.from({ length: stages }, (_, i) => `Stage ${i + 1}`), ...DETAIL]);
  for (let i = 1; i <= stages; i++) org.getColumn(i).width = i === stages ? 36 : 6;
  // Every stage column must be wide enough for its own names; narrow lead-in columns form the staircase.
  // Names overflow rightwards into the empty cells after them, so only the deepest column needs width.
  [14, 28, 14, 13, 8, 16, 32, 10, 10, 15].forEach((w, i) => { org.getColumn(stages + i + 1).width = w; });

  rows.forEach((r, i) => {
    const k = kindOf(r.node);
    const p = PALETTE[k];
    const row = org.getRow(7 + i);
    // Outline level = depth, capped at Excel's maximum of 7.
    row.outlineLevel = Math.min(r.depth, 7);
    for (let s = 1; s <= stages; s++) {
      const c = row.getCell(s);
      if (s - 1 < r.depth) {
        // Lead-in: tree guide line down the left of each ancestor stage.
        c.fill = solid(STAGE_TINTS[(s - 1) % 2]);
        c.border = { left: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      } else if (s - 1 === r.depth) {
        c.value = r.depth === 0 ? r.node.name : `└ ${r.node.name}`;
        c.font = { bold: r.direct > 0, size: r.depth === 0 ? 11 : 10, color: { argb: p.text } };
        c.fill = solid(p.bg);
        c.border = { top: thin(GRID), bottom: thin(GRID), left: { style: 'thick', color: { argb: p.accent } } };
      }
    }
    const status = k === 'VACANT' ? 'Vacant' : k === 'ORPHAN' ? 'Filled — no supervisor' : 'Filled';
    const detail: (string | number)[] = [
      r.node.code, r.node.current_employee_name ?? '—', r.node.current_employee_id ?? '', costCell(r.node),
      r.node.rm_ro_type ?? '', r.parent?.code ?? '', r.parent?.name ?? '— Top level —', r.direct, r.total, status,
    ];
    detail.forEach((v, j) => {
      const c = row.getCell(stages + j + 1);
      c.value = v;
      c.border = box(GRID);
      c.font = { size: 10, color: { argb: j === STATUS_COL ? p.text : 'FF1F2937' }, bold: j === STATUS_COL };
      c.alignment = { vertical: 'middle', horizontal: j >= 7 || j === 3 ? 'center' : 'left' };
      if (j === 0 || j === 3 || j === 5) c.font = { size: 10, name: 'Consolas', color: { argb: 'FF475569' } };
      if (j === 3 && v === MISSING) styleMissing(c);
      if (j === STATUS_COL) c.fill = solid(p.bg);
    });
    row.height = r.depth === 0 ? 20 : 17;
  });
  org.autoFilter = { from: { row: 6, column: stages + 1 }, to: { row: 6 + rows.length, column: width } };
  org.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '6:6' };

  // ── Sheet 2: Stage Summary ─────────────────────────────────────────────────
  const sum = wb.addWorksheet('Stage Summary', { properties: { tabColor: { argb: 'FF059669' } } });
  const SUM_HEADERS = ['Stage', 'Positions', 'Filled', 'Vacant', 'Vacancy %', 'RM', 'RO', 'No Supervisor', 'Example Positions'];
  titleBlock(sum, SUM_HEADERS.length, 'PC Code Organogram — Stage Summary');
  headerRow(sum, 4, SUM_HEADERS);
  [10, 11, 10, 10, 11, 8, 8, 14, 70].forEach((w, i) => { sum.getColumn(i + 1).width = w; });
  const tot = { n: 0, filled: 0, vacant: 0, rm: 0, ro: 0, orphan: 0 };
  for (let s = 0; s < stages; s++) {
    const at = rows.filter(r => r.depth === s);
    const c = {
      n: at.length,
      filled: at.filter(r => r.node.current_employee_name).length,
      rm: at.filter(r => r.node.rm_ro_type === 'RM').length,
      ro: at.filter(r => r.node.rm_ro_type === 'RO').length,
      orphan: at.filter(r => r.node.is_ordinary_root).length,
    };
    const vacant = c.n - c.filled;
    (Object.keys(tot) as (keyof typeof tot)[]).forEach(k => { tot[k] += k === 'vacant' ? vacant : (c as any)[k]; });
    const examples = at.slice(0, 4).map(r => r.node.name).join(', ') + (at.length > 4 ? `, … (+${at.length - 4} more)` : '');
    const row = sum.addRow([`Stage ${s + 1}`, c.n, c.filled, vacant, c.n ? vacant / c.n : 0, c.rm, c.ro, c.orphan, examples]);
    row.eachCell((cell, col) => {
      cell.border = box(GRID);
      cell.alignment = { vertical: 'middle', horizontal: col === 9 ? 'left' : 'center', wrapText: col === 9 };
      cell.fill = solid(STAGE_TINTS[s % 2]);
    });
    row.getCell(1).font = { bold: true, color: { argb: TITLE_BG } };
    row.getCell(5).numFmt = '0%';
    if (vacant) row.getCell(4).font = { bold: true, color: { argb: 'FF475569' } };
    if (c.orphan) row.getCell(8).font = { bold: true, color: { argb: PALETTE.ORPHAN.text } };
  }
  const totRow = sum.addRow(['Total', tot.n, tot.filled, tot.vacant, tot.n ? tot.vacant / tot.n : 0, tot.rm, tot.ro, tot.orphan, '']);
  totRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(HEADER_BG);
    cell.alignment = { horizontal: 'center' };
  });
  totRow.getCell(5).numFmt = '0%';

  // ── Sheet 3: Positions (flat) ──────────────────────────────────────────────
  const flat = wb.addWorksheet('Positions', {
    properties: { tabColor: { argb: 'FF64748B' } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
  });
  const FLAT_HEADERS = ['Stage', 'PC Code', 'Position', 'Current Holder', 'Employee ID', 'Cost Center', 'Type', 'Reports To (Code)', 'Reports To', 'Direct Reports', 'Total Under', 'Status', 'Chain of Command'];
  titleBlock(flat, FLAT_HEADERS.length, 'PC Code Organogram — All Positions');
  headerRow(flat, 4, FLAT_HEADERS);
  [8, 14, 32, 28, 14, 13, 7, 16, 32, 10, 10, 20, 90].forEach((w, i) => { flat.getColumn(i + 1).width = w; });
  rows.forEach(r => {
    const k = kindOf(r.node);
    const row = flat.addRow([
      r.depth + 1, r.node.code, r.node.name, r.node.current_employee_name ?? '', r.node.current_employee_id ?? '',
      costCell(r.node), r.node.rm_ro_type ?? '', r.parent?.code ?? '', r.parent?.name ?? '', r.direct, r.total,
      k === 'VACANT' ? 'Vacant' : k === 'ORPHAN' ? 'Filled — no supervisor' : 'Filled',
      r.path.map(n => n.name).join('  ›  '),
    ]);
    row.eachCell((cell, col) => {
      cell.border = box(GRID);
      cell.alignment = { vertical: 'middle', horizontal: [1, 6, 7, 10, 11].includes(col) ? 'center' : 'left' };
    });
    row.getCell(6).font = { name: 'Consolas', color: { argb: 'FF475569' } };
    if (row.getCell(6).value === MISSING) styleMissing(row.getCell(6));
    row.getCell(12).font = { bold: true, color: { argb: PALETTE[k].text } };
    row.getCell(12).fill = solid(PALETTE[k].bg);
  });
  flat.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: FLAT_HEADERS.length } };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pc-code-organogram-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
