import { getSettings } from './settings';

/** The system default currency code, set in Settings → Controls → General. */
export const currencyCode = (): string => getSettings().general.currency || '';

/**
 * Format an amount with the system default currency, e.g. "SLE 1,250.00".
 * Use for table amount columns that don't carry their own per-row currency.
 */
export function money(amount: any, decimals = 2): string {
  const n = parseFloat(String(amount ?? 0));
  const v = Number.isFinite(n) ? n : 0;
  const code = currencyCode();
  return `${code ? code + ' ' : ''}${v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
