import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState, useMemo } from "react";
import { ChevronRight, ChevronLeft, Search } from "lucide-react";

interface Props<T> {
  columns: ColumnDef<T>[];
  data: T[];
  searchPlaceholder?: string;
  searchColumn?: string;
  pageSize?: number;
  compact?: boolean;
  className?: string;
  onResetCompact?: () => void;
}

export default function DataTable<T extends object>({
  columns,
  data,
  searchPlaceholder = "Search...",
  searchColumn,
  pageSize = 20,
  compact = false,
  className = "",
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageIndex = table.getState().pagination.pageIndex;
  const totalPages = table.getPageCount();

  return (
    <div className={className}>
      {(searchPlaceholder || searchColumn) && (
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-60">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => {
                setGlobalFilter(e.target.value);
                table.setPageIndex(0);
              }}
              className="input w-full pl-8 py-1.5 text-xs"
            />
          </div>
          {table.getFilteredRowModel().rows.length > 0 && (
            <span className="text-xs text-slate-500">
              {table.getFilteredRowModel().rows.length} result
              {table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-slate-700 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    className={
                      "pb-2 pr-4 last:pr-0 " +
                      (header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-slate-200"
                        : "")
                    }
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-800">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="text-slate-300 transition-colors hover:bg-slate-800/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={(compact ? "py-1 pr-4" : "py-2 pr-4") + " last:pr-0"}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">
          {globalFilter ? "No matches. Try a different search." : "No data available."}
        </p>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
          <span>
            Page {pageIndex + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-30"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <button
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs disabled:opacity-30"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
