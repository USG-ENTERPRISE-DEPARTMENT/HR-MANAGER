import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

interface TableToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  searchWidth?: string;
  actions?: ReactNode;
  filterBar?: ReactNode;
  showFilters?: boolean;
}

export function TableToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  searchWidth = 'sm:min-w-[240px]',
  actions,
  filterBar,
  showFilters,
}: TableToolbarProps) {
  return (
    <div className="flex flex-col border-b border-[var(--border)]">
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row lg:items-center justify-between gap-4">
        {actions && (
          <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
            {actions}
          </div>
        )}
        <div className={`search-wrap w-full sm:w-auto ${searchWidth}`}>
          <Search size={14} />
          <input
            type="search"
            autoComplete="off"
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
      {filterBar && (
        <div className="px-5 py-3 bg-[var(--surface-hover)] border-t border-[var(--border)] flex items-center gap-4">
          {filterBar}
        </div>
      )}
    </div>
  );
}
