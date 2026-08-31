'use client';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalItems,
  pageSize = 10,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, currentPage * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-secondary)] mt-4">
      <div>
        Showing <span className="font-mono font-medium text-[var(--text-primary)]">{startItem}</span>–
        <span className="font-mono font-medium text-[var(--text-primary)]">{endItem}</span> of{' '}
        <span className="font-mono font-medium text-[var(--text-primary)]">{totalItems}</span> entries
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="btn btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ‹ Previous
        </button>
        <span className="font-mono text-[var(--text-muted)]">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="btn btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
