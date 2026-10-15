// Single source of truth for how dates are SHOWN in the app: dd/mm/yyyy (and dd/mm/yyyy HH:mm for
// timestamps), regardless of the browser's locale. Values sent to / received from the API stay ISO
// (yyyy-mm-dd) — only presentation goes through here.

const pad = (n: number) => String(n).padStart(2, '0');

/** A bare calendar date ("2026-10-12", or a timestamp starting with one) → its y/m/d parts.
 *  Read straight from the string, NOT via `new Date()`, which would treat it as UTC midnight and
 *  shift it a day west of Greenwich. */
function isoDateParts(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as any);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/mm/yyyy, or `fallback` for an empty/invalid value. Accepts ISO strings, Dates or timestamps. */
export function fmtDate(v: unknown, fallback = '—'): string {
  if (typeof v === 'string') {
    // Date-only strings (and timestamps at UTC midnight, which is how date columns serialise) are
    // shown as written so the day never shifts with the viewer's timezone.
    const parts = isoDateParts(v);
    if (parts && (v.length === 10 || /T00:00:00(\.0+)?Z?$/.test(v))) {
      const [y, m, d] = parts;
      return `${pad(d)}/${pad(m)}/${y}`;
    }
  }
  const d = toDate(v);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : fallback;
}

/** dd/mm/yyyy HH:mm (24-hour, local time), or `fallback`. */
export function fmtDateTime(v: unknown, fallback = '—'): string {
  const d = toDate(v);
  if (!d) return fallback;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** dd/mm/yyyy HH:mm:ss — for audit trails where the second matters. */
export function fmtDateTimeSec(v: unknown, fallback = '—'): string {
  const d = toDate(v);
  return d ? `${fmtDateTime(d)}:${pad(d.getSeconds())}` : fallback;
}

/**
 * A stored date as yyyy-mm-dd — the VALUE format for date inputs and API payloads ('' if empty).
 * Use this, never fmtDate (which is for display), when pre-filling a form field.
 */
export function toIsoDate(v: unknown): string {
  if (v == null || v === '') return '';
  const parts = isoDateParts(typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v)));
  return parts ? `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}` : '';
}

/** yyyy-mm-dd → dd/mm/yyyy (empty string for anything else). Used by the date input. */
export function isoToDmy(iso: string | null | undefined): string {
  const parts = iso ? isoDateParts(String(iso)) : null;
  if (!parts) return '';
  const [y, m, d] = parts;
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** dd/mm/yyyy → yyyy-mm-dd, or null when it is not a real calendar date (e.g. 31/02/2026). */
export function dmyToIso(dmy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
