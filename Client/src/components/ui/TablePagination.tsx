import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface TablePaginationProps {
  total: number;
  filtered: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function TablePagination({
  total,
  filtered,
  page = 1,
  pageSize = 10,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(filtered / pageSize));
  const from = filtered === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, filtered);

  const isInteractive = !!onPageChange;

  const go = (p: number) => {
    if (!onPageChange) return;
    const clamped = Math.max(1, Math.min(p, totalPages));
    if (clamped !== page) onPageChange(clamped);
  };

  return (
    <div className="px-4 py-3 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[var(--surface)]">

      {/* Left — entry count + page-size picker */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-[var(--text-muted)]">
          Showing{' '}
          <span className="font-bold text-[var(--text-secondary)]">{from}</span>
          {' '}–{' '}
          <span className="font-bold text-[var(--text-secondary)]">{to}</span>
          {' '}of{' '}
          <span className="font-bold text-[var(--text-secondary)]">{filtered}</span>
          {filtered !== total && (
            <span className="text-[var(--text-muted)]"> (filtered from {total})</span>
          )}
        </span>

        {isInteractive && onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)] hidden sm:inline">Rows:</span>
            <RowsMenu
              value={pageSize}
              options={PAGE_SIZE_OPTIONS}
              onChange={(s) => { onPageSizeChange(s); go(1); }}
            />
          </div>
        )}
      </div>

      {/* Right — page buttons */}
      {isInteractive ? (
        <div className="flex items-center gap-1">
          <PagBtn onClick={() => go(1)} disabled={page === 1} title="First page">
            <ChevronsLeft size={13} />
          </PagBtn>
          <PagBtn onClick={() => go(page - 1)} disabled={page === 1} title="Previous page">
            <ChevronLeft size={13} />
          </PagBtn>

          {/* Page number pills */}
          {pageNumbers(page, totalPages).map((n, i) =>
            n === '…' ? (
              <span key={`ellipsis-${i}`} className="px-2 text-[12px] text-[var(--text-muted)]">…</span>
            ) : (
              <PagBtn
                key={n}
                onClick={() => go(n as number)}
                active={n === page}
              >
                {n}
              </PagBtn>
            )
          )}

          <PagBtn onClick={() => go(page + 1)} disabled={page === totalPages} title="Next page">
            <ChevronRight size={13} />
          </PagBtn>
          <PagBtn onClick={() => go(totalPages)} disabled={page === totalPages} title="Last page">
            <ChevronsRight size={13} />
          </PagBtn>
        </div>
      ) : (
        /* Stub mode — used by components that haven't wired pagination yet */
        <div className="flex items-center gap-1.5">
          <PagBtn disabled>
            <ChevronsLeft size={13} />
          </PagBtn>
          <PagBtn active>{page}</PagBtn>
          <PagBtn disabled>
            <ChevronsRight size={13} />
          </PagBtn>
        </div>
      )}
    </div>
  );
}

/* ── rows-per-page dropdown — custom (no native <select>) so it matches the theme ── */
const RowsMenu: React.FC<{ value: number; options: number[]; onChange: (v: number) => void }> =
function RowsMenu({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 h-[30px] pl-2.5 pr-1.5 rounded-[7px] border text-[12px] font-semibold transition-colors border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer"
      >
        {value}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 bottom-full mb-1.5 left-0 min-w-[64px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] shadow-lg py-1 overflow-hidden">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              className={[
                'w-full text-left px-3 py-1.5 text-[12px] transition-colors',
                o === value
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]',
              ].join(' ')}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── helpers ───────────────────────────────────────────────────────────── */

const PagBtn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}> = function PagBtn({ children, onClick, disabled = false, active = false, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'min-w-[30px] h-[30px] px-2 flex items-center justify-center rounded-[7px] border text-[12px] font-semibold transition-colors',
        active
          ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
          : disabled
            ? 'border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface)] cursor-not-allowed opacity-50'
            : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** Returns an array of page numbers with ellipsis for long ranges */
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '…')[] = [1];

  if (current > 3) pages.push('…');

  const start = Math.max(2, current - 1);
  const end   = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('…');

  pages.push(total);
  return pages;
}
