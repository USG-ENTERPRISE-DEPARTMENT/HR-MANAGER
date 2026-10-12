import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { Calendar } from 'lucide-react';
import { dmyToIso, isoToDmy } from '@/lib/dateFormat';

/**
 * Drop-in replacement for `<input type="date">` that always DISPLAYS dd/mm/yyyy.
 *
 * The native date input renders in the browser's/OS's locale (mm/dd/yyyy on a US-configured machine)
 * and cannot be overridden, so this shows a dd/mm/yyyy text field instead — typed (slashes are added
 * automatically) or picked from the calendar button, which opens the browser's own picker.
 *
 * The VALUE is unchanged: `value` is yyyy-mm-dd and `onChange` receives an event whose
 * `target.value` is yyyy-mm-dd (or '' when cleared) and `target.name` is the field's name — exactly
 * what the native input produced, so existing handlers (`e.target.value`, `handleChange(e)`) work as-is.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value?: string | null;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Classes for the wrapper — use for an explicit width (the input itself fills the wrapper). */
  wrapperClassName?: string;
};

// Keep only digits and re-insert the slashes: "12102026" → "12/10/2026".
function mask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function DateInput({
  value, onChange, name, min, max, disabled, readOnly, className, wrapperClassName,
  placeholder = 'dd/mm/yyyy', onBlur, onFocus, ...rest
}: Props) {
  const iso = typeof value === 'string' ? value.slice(0, 10) : '';
  const [text, setText] = useState(() => isoToDmy(iso));
  const [focused, setFocused] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Follow outside changes (form reset, picker, edit-mode load) — but not mid-typing.
  useEffect(() => { if (!focused) setText(isoToDmy(iso)); }, [iso, focused]);

  const emit = (v: string) => {
    if (v === iso) return;
    const target = { name: name ?? '', value: v } as HTMLInputElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
  };

  // A typed date must honour min/max just as the calendar does (ISO strings compare correctly).
  const inRange = (v: string) => (!min || v >= String(min)) && (!max || v <= String(max));
  const parse = (dmy: string) => { const v = dmyToIso(dmy); return v && inRange(v) ? v : null; };

  const handleType = (e: ChangeEvent<HTMLInputElement>) => {
    const next = mask(e.target.value);
    setText(next);
    if (next === '') emit('');
    else if (next.length === 10) { const v = parse(next); if (v) emit(v); }
  };

  const openPicker = () => {
    if (disabled || readOnly) return;
    const el = pickerRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };

  const locked = disabled || readOnly;
  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        name={name}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={10}
        className={`${className ?? ''} w-full !pr-9`}
        onChange={handleType}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => {
          setFocused(false);
          // An incomplete, impossible (31/02/2026) or out-of-range date is discarded rather than saved.
          const v = text === '' ? '' : parse(text);
          if (v === null) setText(isoToDmy(iso));
          onBlur?.(e);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        disabled={locked}
        aria-label="Open calendar"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Calendar size={14} />
      </button>
      {/* The browser's own picker, used only for its calendar popup; never visible itself. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        min={min}
        max={max}
        disabled={locked}
        onChange={(e) => { setText(isoToDmy(e.target.value)); emit(e.target.value); }}
        className="absolute right-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  );
}
