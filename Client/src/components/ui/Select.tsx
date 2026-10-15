import {
  Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * Searchable drop-in replacement for a native `<select>`.
 *
 * Takes the SAME children (`<option value=…>label</option>`, including ones produced by `.map()`
 * and wrapped in fragments) and the same `value` / `name` / `onChange(e)` contract, so swapping
 * `<select>` for `<Select>` changes nothing else in a form: handlers still read `e.target.value`
 * and `e.target.name`. What changes is the popup — every list gets a search box, which the native
 * control cannot offer.
 *
 * Keyboard: Enter/Space/↓ opens; typing filters; ↑/↓ move; Enter picks; Esc closes.
 */
type Opt = { value: string; label: string; disabled: boolean };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as any).children);
  return '';
}

// Flatten <option> children — through fragments, arrays and conditionals — into a plain list.
function collectOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as any;
    if (child.type === Fragment) { collectOptions(props.children, out); return; }
    if (child.type === 'option') {
      const label = textOf(props.children).trim();
      out.push({ value: props.value != null ? String(props.value) : label, label, disabled: !!props.disabled });
    }
  });
  return out;
}

export function Select({
  value, defaultValue, onChange, name, id, children, className = '', style, disabled, required, title,
}: {
  value?: string | number | null;
  defaultValue?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  id?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  title?: string;
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  // Uncontrolled use (defaultValue only) keeps its own state, like a native select.
  const [inner, setInner] = useState(defaultValue != null ? String(defaultValue) : (options[0]?.value ?? ''));
  const current = value !== undefined && value !== null ? String(value) : value === null ? '' : inner;
  const selected = options.find(o => o.value === current);
  // An empty-value option is the "Select …" placeholder: shown muted and used as the trigger text.
  const placeholder = options.find(o => o.value === '')?.label || 'Select…';

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const filtered = useMemo(
    () => options.filter(o => !q || o.label.toLowerCase().includes(q.trim().toLowerCase())),
    [options, q]);

  // Position the popup (portal, so it never clips inside cards / modals with overflow hidden).
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const H = 300;
    const width = Math.max(r.width, 200);
    if (window.innerHeight - r.bottom < H + 8) setPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width });
    else setPos({ top: r.bottom + 4, left: r.left, width });
  }, [open]);

  // Close on outside click / page scroll.
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

  // Start the highlight on the current value; keep the highlighted row in view.
  useEffect(() => {
    if (open) setHi(Math.max(0, filtered.findIndex(o => o.value === current)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHi(h => Math.min(h, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false); setQ('');
    btnRef.current?.focus();
    if (o.value === current) return;
    if (value === undefined) setInner(o.value);
    const target = { name: name ?? '', value: o.value } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); if (filtered[hi]) pick(filtered[hi]); }
  };

  const empty = !selected || selected.value === '';
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required || undefined}
        onClick={() => { setOpen(o => !o); setQ(''); }}
        onKeyDown={onKey}
        style={style}
        className={`select-trigger flex items-center justify-between gap-2 ${className}`}
      >
        <span className={`truncate ${empty ? 'text-[var(--text-muted)]' : ''}`}>{selected?.label || placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Keeps `name` in the form for any native form submission / required check. */}
      {name && <input type="hidden" name={name} value={current} />}

      {open && pos && createPortal(
        <div
          ref={dropRef}
          role="listbox"
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--border)] flex items-center gap-2">
            <Search size={13} className="text-[var(--text-muted)] shrink-0" />
            <input
              ref={(el) => el?.focus({ preventScroll: true })}
              value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={onKey}
              placeholder="Search…"
              className="!w-full !bg-transparent !border-0 !p-0 !shadow-none text-[12.5px] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[var(--text-muted)]">No results</p>
            ) : filtered.map((o, i) => {
              const sel = o.value === current;
              return (
                <button
                  key={`${o.value}-${i}`}
                  type="button"
                  data-idx={i}
                  role="option"
                  aria-selected={sel}
                  disabled={o.disabled}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o)}
                  className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center justify-between gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    sel ? 'text-[var(--accent)] font-semibold' : o.value === '' ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
                  } ${i === hi ? 'bg-[var(--surface-hover)]' : ''}`}
                >
                  <span className="truncate">{o.label || '—'}</span>
                  {sel && <Check size={13} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
