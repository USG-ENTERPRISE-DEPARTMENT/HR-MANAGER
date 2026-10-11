import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { FormModal } from '../ui/FormModal';
import { SearchSelect } from '../ui/SearchSelect';
import { inputClass } from '../ui/FormField';
import { exportReportExcel, reportPdf, ReportPreview } from '../ui/reportTools';

export type Cell = string | number;

export interface FilterDef {
  key: string;
  label: string;
  type: 'select' | 'date';
  options?: { id: string; label: string }[];
  allLabel?: string;            // label of the "no filter" option; omit for a select with no "all" choice
  width?: string;
}

// Shared shell for the tabular reports: filter bar, notices, then the standard preview with
// Excel/PDF export. Each report only supplies its data, columns and filter definitions.
export function ReportModal({
  title, subtitle, onClose, maxWidth = '5xl', loading = false, loadingText = 'Loading…',
  filters = [], values = {}, onFilterChange, onClear,
  headers, rows, total, footRow, exportRows, exportFoot, summary, emptyMessage, canExport,
  notice, actions, children, landscape = true,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  maxWidth?: '3xl' | '4xl' | '5xl';
  loading?: boolean;
  loadingText?: string;
  filters?: FilterDef[];
  values?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;
  onClear?: () => void;
  headers: string[];
  rows: Cell[][];
  total: number;
  footRow?: Cell[];
  exportRows?: Cell[][];        // raw (unformatted) rows for Excel; defaults to `rows`
  exportFoot?: Cell[];
  summary: string;
  emptyMessage: string;
  canExport: boolean;
  notice?: ReactNode;
  actions?: ReactNode;          // extra buttons beside the filters (e.g. a CSV/JSON download)
  children?: ReactNode;         // shown instead of the preview while a required choice is missing
  landscape?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const active = filters.filter(f => f.allLabel !== undefined && values[f.key]).length;
  const withFoot = (r: Cell[][], f?: Cell[]) => (f && r.length ? [...r, f] : r);

  return (
    <FormModal title={title} subtitle={subtitle} maxWidth={maxWidth} onClose={onClose} onSave={onClose} saveLabel="Close">
      {loading ? (
        <p className="text-center text-[var(--text-muted)] text-sm py-8">{loadingText}</p>
      ) : (
        <div className="space-y-4">
          {(filters.length > 0 || actions) && (
            <div className="flex flex-wrap items-end gap-3">
              {filters.map(f => (
                <div key={f.key} className={f.type === 'select' ? (f.width ?? 'w-48') : undefined}>
                  <label className="label">{f.label}</label>
                  {f.type === 'select' ? (
                    <SearchSelect
                      value={values[f.key] ?? ''}
                      onChange={v => onFilterChange?.(f.key, v)}
                      options={f.allLabel !== undefined ? [{ id: '', label: f.allLabel }, ...(f.options ?? [])] : (f.options ?? [])}
                      placeholder={f.allLabel ?? 'Select…'}
                    />
                  ) : (
                    <input type="date" className={inputClass} value={values[f.key] ?? ''}
                      onChange={e => onFilterChange?.(f.key, e.target.value)} />
                  )}
                </div>
              ))}
              {active > 0 && onClear && (
                <button onClick={onClear} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                  <X size={12} /> Clear all ({active})
                </button>
              )}
              {actions}
            </div>
          )}

          {notice}

          {children ?? (
            <ReportPreview
              canExport={canExport}
              headers={headers}
              rows={rows}
              total={total}
              emptyMessage={emptyMessage}
              pdfBusy={pdfBusy}
              footRow={footRow && rows.length ? footRow : undefined}
              onExcel={() => exportReportExcel(title, summary, headers, withFoot(exportRows ?? rows, exportFoot ?? footRow))}
              onPdf={() => reportPdf(title, summary, headers, withFoot(rows, footRow), setPdfBusy, landscape)}
            />
          )}
        </div>
      )}
    </FormModal>
  );
}

// "Department: X  ·  Hired: a → b" style summary line for the export header.
export function filterSummary(parts: [string, string | undefined][], none: string) {
  const p = parts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return p.length ? p.join('  ·  ') : none;
}

export const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');
export const fullName = (e: any) =>
  [e?.firstName, e?.middleName, e?.lastName].map(x => String(x ?? '').trim()).filter(Boolean).join(' ');
