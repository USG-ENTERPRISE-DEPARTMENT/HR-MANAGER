import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';

// A themed dropdown for table filter bars — matches the pagination rows-per-page picker
// (compact pill trigger, themed popup) instead of an unstyled native <select>. Portal-rendered
// so it never clips inside cards with overflow-hidden; auto-shows a search box for long lists.

type Opt = { value: string; label: string };

export function FilterSelect({
  value, onChange, options, label, placeholder = 'All', className = '', minWidth = 150,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (Opt | string)[];
  label?: string;
  placeholder?: string;
  className?: string;
  minWidth?: number;
}) {
  const opts: Opt[] = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const selected = opts.find((o) => o.value === value);
  const searchable = opts.length > 7;
  const active = selected != null && value !== '' && value !== 'all';

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const H = 300;
    const width = Math.max(r.width, 180);
    if (window.innerHeight - r.bottom < H + 8) setPos({ bottom: window.innerHeight - r.top + 6, left: r.left, width });
    else setPos({ top: r.bottom + 6, left: r.left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || dropRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => { if (!dropRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);

  const filtered = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };

  return (
    <div className={`flex flex-col gap-1 ${className}`} style={{ minWidth }}>
      {label && (
        <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{label}</label>
      )}
      <button
        type="button"
        ref={btnRef}
        onClick={() => { setOpen((o) => !o); setQ(''); }}
        className={`flex items-center justify-between gap-1.5 h-[34px] pl-3 pr-2 rounded-[8px] border text-[12.5px] font-semibold transition-colors w-full ${
          active
            ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
        }`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden"
        >
          {searchable && (
            <div className="p-2 border-b border-[var(--border)] flex items-center gap-2">
              <Search size={13} className="text-[var(--text-muted)] shrink-0" />
              <input
                ref={(el) => el?.focus({ preventScroll: true })}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-[12.5px] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[var(--text-muted)]">No results</p>
            ) : (
              filtered.map((o) => {
                const sel = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center justify-between gap-2 transition-colors ${
                      sel ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-semibold' : 'text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {sel && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
