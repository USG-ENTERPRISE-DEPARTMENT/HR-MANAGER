import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The single row a table shows when it has no rows to render: a spinner while its data is still
 * loading, otherwise the empty message. Use it in place of a bare "No … found." row so a table never
 * claims to be empty while its request is in flight.
 *
 *   <tbody>{rows.length ? rows.map(...) : <TableStateRow cols={6} loading={loading} empty="No items found." />}</tbody>
 */
export function TableStateRow({ cols, loading, empty, loadingLabel = 'Loading…', className = 'py-10' }: {
  cols: number;
  loading: boolean;
  empty: ReactNode;
  loadingLabel?: string;
  className?: string;
}) {
  return (
    <tr>
      <td colSpan={cols} className={`td text-center text-[13px] text-[var(--text-muted)] ${className}`}>
        {loading
          ? <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin text-[var(--accent)]" />{loadingLabel}</span>
          : empty}
      </td>
    </tr>
  );
}
