import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { inputClass } from './FormField';

// ── Portal dropdown positioner ────────────────────────────────────────────────

const DROPDOWN_H = 260; // max expected height — used to decide flip direction

function useDropdownPos(open: boolean, triggerRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{
    top?: number; bottom?: number; left: number; width: number;
  } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceBelow < DROPDOWN_H + 8) {
      setPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width });
    } else {
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, [open, triggerRef]);

  return pos;
}

// ── Single-select ─────────────────────────────────────────────────────────────

export function SearchSelect({ value, onChange, options, placeholder = 'Select…', disabled }: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [q, setQ]         = useState('');
  const triggerRef        = useRef<HTMLButtonElement>(null);
  const dropRef           = useRef<HTMLDivElement>(null);
  const pos               = useDropdownPos(open, triggerRef);
  const selected          = options.find(o => o.id === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const filtered = options.filter(o => !q || o.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setQ(''); } }}
        className={`${inputClass} flex items-center justify-between text-left ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={selected ? '' : 'text-slate-400 font-normal'}>{selected?.label ?? placeholder}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 opacity-50">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--border)]">
            <input
              ref={el => { el?.focus({ preventScroll: true }); }}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              className={`${inputClass} py-1.5 text-[12px]`}
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-[12px] text-[var(--text-muted)] px-3 py-2">No results</p>
              : filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setQ(''); }}
                  className={`w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--bg)] transition-colors ${o.id === value ? 'font-bold text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}
                >
                  {o.label}
                </button>
              ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Multi-select ──────────────────────────────────────────────────────────────

export function MultiSearchSelect({ value, onChange, options, placeholder = 'Select…', disabled }: {
  value: string[];
  onChange: (v: string[]) => void;
  options: { id: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState('');
  const triggerRef      = useRef<HTMLDivElement>(null);
  const dropRef         = useRef<HTMLDivElement>(null);
  const pos             = useDropdownPos(open, triggerRef);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false); setQ('');
    };
    const handleScroll = (e: Event) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const toggle     = (id: string) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  const allSelected = options.length > 0 && options.every(o => value.includes(o.id));
  const selectAll  = () => onChange(options.map(o => o.id));
  const clearAll   = () => onChange([]);
  const filtered   = options.filter(o => (!q || o.label.toLowerCase().includes(q.toLowerCase())) && !value.includes(o.id));
  const selectedOptions = value.map(v => options.find(o => o.id === v)).filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="relative">
      <div
        ref={triggerRef}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`${inputClass} flex flex-wrap gap-1.5 items-center min-h-[42px] py-1.5 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {selectedOptions.length === 0 && (
          <span className="text-slate-400 font-normal py-0.5">{placeholder}</span>
        )}
        {selectedOptions.map(o => (
          <span key={o.id} className="inline-flex items-center gap-1 bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] text-[11px] font-semibold px-2 py-0.5 rounded-full">
            {o.label}
            <button type="button" onMouseDown={e => { e.stopPropagation(); toggle(o.id); }} className="hover:text-[var(--danger)] transition-colors">
              <X size={10} />
            </button>
          </span>
        ))}
        <svg width="12" height="12" viewBox="0 0 12 12" className="ml-auto shrink-0 opacity-50">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>

      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--border)]">
            <input
              ref={el => { el?.focus({ preventScroll: true }); }}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              className={`${inputClass} py-1.5 text-[12px]`}
            />
          </div>
          {options.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-hover)]">
              <span className="text-[11px] text-[var(--text-muted)]">{value.length} of {options.length} selected</span>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); allSelected ? clearAll() : selectAll(); }}
                className="text-[11px] font-semibold text-[var(--accent)] hover:underline"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
          )}
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-[12px] text-[var(--text-muted)] px-3 py-2">{q ? 'No results' : 'All options selected'}</p>
              : filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); toggle(o.id); setQ(''); }}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--bg)] transition-colors text-[var(--text-primary)]"
                >
                  {o.label}
                </button>
              ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
