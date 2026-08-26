import { toast } from 'sonner';

/** One figure in the summary strip above the table (e.g. Medical Limit / Utilised / Balance). */
export interface PrintSummary {
  label: string;
  value: string;
}

export interface PrintOptions {
  /** Document heading, e.g. "Medical Statement". */
  title: string;
  /** Line under the heading naming who the document is for. */
  subtitle?: string;
  /** Key figures rendered as cards above the table. */
  summary?: PrintSummary[];
  /** Indexes of columns holding numbers — right-aligned and tabular so decimals line up. */
  numericColumns?: number[];
  /** Index of the column rendered as a status pill rather than plain text. */
  statusColumn?: number;
  /** Organisation name shown top-left. Falls back to a neutral label. */
  orgName?: string;
  /** Organisation address, under the name. */
  orgAddress?: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Status pill markup.
 *
 * Colour carries the meaning, but each pill also keeps a visible border and dark text so it still
 * reads when printed in black and white — which is the default in most print dialogs.
 */
function statusPill(value: string): string {
  const t = value.toLowerCase();
  const [fg, bg, border] =
    t.includes('approved') ? ['#065f46', '#ecfdf5', '#a7f3d0'] :
    t.includes('reject') || t.includes('declin') ? ['#991b1b', '#fef2f2', '#fecaca'] :
    t.includes('pending') ? ['#92400e', '#fffbeb', '#fde68a'] :
    ['#374151', '#f3f4f6', '#e5e7eb'];
  return `<span class="pill" style="color:${fg};background:${bg};border-color:${border}">`
    + `${escapeHtml(value)}</span>`;
}

/**
 * Render a table as a printable A4 document and open the browser print dialog.
 *
 * The previous implementation emitted a bare `<h2>` above a grey-bordered table. It printed as
 * something closer to a debug dump than a company document: no branding, nothing identifying whose
 * statement it was, no record count, and figures left-aligned so decimal points did not line up.
 *
 * All styling is inlined because the popup has no access to the app stylesheet, and everything is
 * sized in millimetres and points so the result lays out predictably on paper rather than at
 * whatever size the browser window happens to be.
 */
export function printDocument(
  options: PrintOptions,
  headers: string[],
  rows: (string | number)[][],
): void {
  const numeric = new Set(options.numericColumns ?? []);
  const statusCol = options.statusColumn;
  const orgName = options.orgName?.trim() || 'HR Portal';

  const summaryCards = (options.summary ?? []).filter(s => s && s.label);
  const summaryHtml = summaryCards.length
    ? `<div class="summary">${summaryCards.map(s => `
        <div class="card">
          <p class="card-label">${escapeHtml(s.label)}</p>
          <p class="card-value">${escapeHtml(s.value)}</p>
        </div>`).join('')}</div>`
    : '';

  const bodyHtml = rows.length
    ? rows.map(row => `<tr>${row.map((cell, i) => {
        const cls = numeric.has(i) ? ' class="num"' : '';
        const content = i === statusCol ? statusPill(String(cell ?? '')) : escapeHtml(cell);
        return `<td${cls}>${content}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${headers.length}">No records to display.</td></tr>`;

  const printedOn = new Date().toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const countLabel = rows.length
    ? `${rows.length} record${rows.length === 1 ? '' : 's'}`
    : 'No records';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<style>
  /* Page margins live here so the browser's own running header/footer sits outside the content. */
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #111827;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.45;
    /* Without this Chrome drops every background colour when printing, which would leave the
       header row and status pills as invisible white-on-white. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding-bottom: 10px; border-bottom: 2px solid #1e3a8a;
  }
  .org { margin: 0; font-size: 13.5pt; font-weight: 700; letter-spacing: -0.2px; }
  .org-sub { margin: 2px 0 0; font-size: 8.5pt; color: #6b7280; }
  .doc { text-align: right; white-space: nowrap; }
  .doc-title { margin: 0; font-size: 11pt; font-weight: 700; color: #1e3a8a; }
  .doc-meta { margin: 2px 0 0; font-size: 8pt; color: #6b7280; }
  h1 { margin: 16px 0 2px; font-size: 15pt; letter-spacing: -0.3px; }
  .subtitle { margin: 0 0 14px; font-size: 9.5pt; color: #6b7280; }
  .summary { display: flex; gap: 10px; margin: 0 0 16px; }
  .card {
    flex: 1; padding: 8px 12px; background: #f9fafb;
    border: 1px solid #e5e7eb; border-left: 3px solid #1e3a8a; border-radius: 4px;
  }
  .card-label {
    margin: 0; font-size: 7pt; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: #6b7280;
  }
  .card-value { margin: 3px 0 0; font-size: 11.5pt; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  /* Repeat the header row when the table runs over more than one page. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th {
    padding: 8px 10px; text-align: left; background: #1e3a8a; color: #fff;
    font-size: 8pt; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  }
  td { padding: 7px 10px; font-size: 9.5pt; border-bottom: 1px solid #e5e7eb; }
  tbody tr:nth-child(even) td { background: #f9fafb; }
  /* tabular-nums keeps decimal points aligned down the column. */
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill {
    display: inline-block; padding: 2px 9px; border-radius: 999px;
    border: 1px solid; font-size: 8.5pt; font-weight: 600;
  }
  .empty { padding: 22px; text-align: center; color: #9ca3af; font-style: italic; }
  .foot {
    display: flex; justify-content: space-between; margin-top: 14px; padding-top: 8px;
    border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af;
  }
</style></head><body>
  <div class="head">
    <div>
      <p class="org">${escapeHtml(orgName)}</p>
      ${options.orgAddress ? `<p class="org-sub">${escapeHtml(options.orgAddress)}</p>` : ''}
    </div>
    <div class="doc">
      <p class="doc-title">${escapeHtml(options.title)}</p>
      <p class="doc-meta">Generated ${escapeHtml(printedOn)}</p>
    </div>
  </div>
  <h1>${escapeHtml(options.title)}</h1>
  ${options.subtitle ? `<p class="subtitle">${escapeHtml(options.subtitle)}</p>` : '<div style="height:10px"></div>'}
  ${summaryHtml}
  <table>
    <thead><tr>${headers.map((h, i) =>
      `<th${numeric.has(i) ? ' style="text-align:right"' : ''}>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <div class="foot">
    <span>${escapeHtml(options.title)} &middot; ${escapeHtml(countLabel)}</span>
    <span>This document is computer generated.</span>
  </div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) {
    toast.error('Allow pop-ups for this site to print the document');
    return;
  }
  win.document.write(html);
  win.document.close();
  // Print once layout has settled. Calling print() immediately can snapshot a half-styled page.
  win.onload = () => { win.focus(); win.print(); };
}
