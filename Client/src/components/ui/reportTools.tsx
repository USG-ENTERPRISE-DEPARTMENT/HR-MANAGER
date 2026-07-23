import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';

export const fmtAmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const uniqOpts = (vals: (string | undefined | null)[]) =>
  [...new Set(vals.filter(Boolean) as string[])].sort().map(v => ({ id: v, label: v }));

// Excel export with a title / timestamp / filter-summary header block
export function exportReportExcel(title: string, summary: string, headers: string[], rows: (string | number)[][]) {
  const aoa = [[title], [`Generated ${new Date().toLocaleString()}`], [summary], [], headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h, c) => ({
    wch: Math.max(h.length, ...rows.slice(0, 100).map(r => String(r[c] ?? '').length)) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function blobErrMessage(e: any): Promise<string> {
  const data = e.response?.data;
  if (data instanceof Blob) {
    try { const j = JSON.parse(await data.text()); return j.message || 'Download failed'; } catch { /* ignore */ }
  }
  return data?.message || e.message || 'Download failed';
}

// Branded PDF via the generic server-side tabular renderer
export async function reportPdf(
  title: string, summary: string, headers: string[], rows: (string | number)[][],
  setBusy: (b: boolean) => void, landscape = true,
) {
  setBusy(true);
  try {
    const res = await api.post('/reports/table.pdf', { title, subtitle: summary, headers, rows, landscape }, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf` });
    a.click();
    URL.revokeObjectURL(url);
    toast.success('PDF downloaded');
  } catch (e: any) {
    toast.error(await blobErrMessage(e));
  } finally { setBusy(false); }
}

// Result count + Excel/PDF buttons + capped preview table (+ optional bold totals row)
export function ReportPreview({ headers, rows, total, emptyMessage, pdfBusy, onExcel, onPdf, boldCol = 0, footRow, canExport = true }: {
  headers: string[];
  rows: (string | number)[][];
  total: number;
  emptyMessage: string;
  pdfBusy: boolean;
  onExcel: () => void;
  onPdf: () => void;
  boldCol?: number;
  footRow?: (string | number)[];
  canExport?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text-primary)]">{rows.length}</span> of {total} records match
        </p>
        {canExport && (
        <div className="flex gap-2">
          <button onClick={onExcel} disabled={!rows.length}
            className="secondary-btn !py-1.5 !px-3 !text-[12px] disabled:opacity-50">
            <FileSpreadsheet size={13} /> Export Excel
          </button>
          <button onClick={onPdf} disabled={!rows.length || pdfBusy}
            className="secondary-btn !py-1.5 !px-3 !text-[12px] disabled:opacity-50">
            <Download size={13} /> {pdfBusy ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] max-h-[45vh] overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr>{headers.map(h => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} className="td text-center py-10 text-[var(--text-muted)]">{emptyMessage}</td></tr>
            ) : (
              <>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="tr">
                    {r.map((c, ci) => (
                      <td key={ci} className={`td ${ci === boldCol ? 'font-medium text-[var(--text-primary)]' : ''}`}>{c === '' || c == null ? '—' : c}</td>
                    ))}
                  </tr>
                ))}
                {footRow && (
                  <tr className="tr">
                    {footRow.map((c, ci) => <td key={ci} className="td font-bold text-[var(--text-primary)]">{c}</td>)}
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && (
        <p className="text-[11.5px] text-[var(--text-muted)]">
          Preview shows the first 200 rows — exports include all {rows.length} matching records.
        </p>
      )}
    </>
  );
}
