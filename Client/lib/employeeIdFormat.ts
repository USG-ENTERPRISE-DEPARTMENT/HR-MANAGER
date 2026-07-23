/**
 * Employee-ID format helper — shared by the Controls preview and the employee form placeholder.
 *
 * Admins configure a template string mixing literal text with tokens (see EMPLOYEE_ID_TOKENS).
 * The sequence number is the employee row's auto-increment primary key (continuous, never reset),
 * so generation only ever *formats* that id — uniqueness is guaranteed by the DB.
 */

export const DEFAULT_EMPLOYEE_ID_PATTERN = 'EP-{YY}-{SEQ4}';

/** Hard cap on staff ID length — applies to both auto-generated and manually-entered IDs.
 *  (The employee_id column is VARCHAR(20); the business rule caps usage at 10.) */
export const EMPLOYEE_ID_MAX_LENGTH = 10;

export const EMPLOYEE_ID_TOKENS: { token: string; label: string }[] = [
  { token: '{YYYY}', label: '4-digit year (2026)' },
  { token: '{YY}',   label: '2-digit year (26)' },
  { token: '{MM}',   label: '2-digit month (06)' },
  { token: '{DD}',   label: '2-digit day (26)' },
  { token: '{SEQ}',  label: 'sequence number' },
  { token: '{SEQ4}', label: 'sequence zero-padded to N digits (3–6)' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Substitute the supported tokens in `pattern` with values for `seq` / `date`. Case-insensitive. */
export function formatEmployeeId(
  pattern: string,
  seq: number | string,
  date: Date = new Date(),
): string {
  const seqStr = String(seq);
  return (pattern || DEFAULT_EMPLOYEE_ID_PATTERN)
    .replace(/\{SEQ(\d+)\}/gi, (_m, n) => seqStr.padStart(Number(n), '0'))
    .replace(/\{SEQ\}/gi, seqStr)
    .replace(/\{YYYY\}/gi, String(date.getFullYear()))
    .replace(/\{YY\}/gi, String(date.getFullYear()).slice(-2))
    .replace(/\{MM\}/gi, pad(date.getMonth() + 1))
    .replace(/\{DD\}/gi, pad(date.getDate()));
}

/** A pattern is valid only when it contains a {SEQ} / {SEQn} token, so generated IDs stay unique. */
export function patternIsValid(pattern: string): boolean {
  return /\{SEQ\d*\}/i.test(pattern || '');
}
