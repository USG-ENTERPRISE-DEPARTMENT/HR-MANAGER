import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side paging for an already-filtered list. Returns the current page's rows and the props
 * TablePagination needs, so a table goes from "stub" to working pagination with two lines:
 *
 *   const pg = usePaged(filtered);
 *   ...pg.rows.map(...)
 *   <TablePagination total={all.length} filtered={filtered.length} {...pg.props} />
 *
 * Jumps back to page 1 whenever the number of rows changes (search / filter / tab change).
 */
export function usePaged<T>(rows: T[], initialPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => { setPage(1); }, [rows.length]);

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  return {
    rows: pageRows,
    props: {
      page,
      pageSize,
      onPageChange: setPage,
      onPageSizeChange: (s: number) => { setPageSize(s); setPage(1); },
    },
  };
}
