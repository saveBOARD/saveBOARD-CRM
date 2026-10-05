"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Download, Settings2, X } from "lucide-react";
import { TONE_CLASS } from "@/lib/labels";
import { columnTotal, compareCells, displayValue, matchesFilter } from "./logic";
import type { Row, TableColumn } from "./types";

// The standard list, as in the ERP (docs/erp-reference/Design.md §6): sortable headers, a filter in every
// column, a totals row, a count, Export to Excel and Choose columns (remembered per list in this browser).

type Props = {
  /** Stable id, used to remember column choices. */
  id: string;
  columns: TableColumn[];
  rows: Row[];
  /** Plural noun for the count and the Excel file name, e.g. "contacts". */
  noun: string;
  empty: string;
  initialSort?: { key: string; desc?: boolean };
  pageSize?: number;
};

const isNumeric = (c: TableColumn) => c.kind === "number" || c.kind === "money";

function storageKey(id: string) {
  return `crm.table.${id}.columns`;
}

export function DataTable({ id, columns, rows, noun, empty, initialSort, pageSize = 100 }: Props) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [{ id: initialSort.key, desc: !!initialSort.desc }] : []);
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.key, false])),
  );
  const [exporting, setExporting] = useState(false);

  // Remembered column choices (per browser). Storage can be unavailable: the defaults still work.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(id));
      if (saved) setVisibility(JSON.parse(saved) as VisibilityState);
    } catch {
      /* ignore */
    }
  }, [id]);
  function changeVisibility(next: VisibilityState) {
    setVisibility(next);
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((col) => ({
        id: col.key,
        accessorFn: (r) => r[col.key],
        header: col.header,
        filterFn: (row, _id, value: string) => matchesFilter(col, row.original, value),
        sortingFn: (a, b) => compareCells(col, a.original[col.key], b.original[col.key]),
        sortUndefined: "last",
        meta: col,
      })),
    [columns],
  );

  // TanStack Table is not React Compiler compatible; the compiler skips this component, which is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, columnFilters: filters, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    onColumnVisibilityChange: (u) => changeVisibility(typeof u === "function" ? u(visibility) : u),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize, pageIndex: 0 } },
    autoResetPageIndex: true,
  });

  const visibleCols = columns.filter((c) => visibility[c.key] !== false);
  const filteredRows = table.getFilteredRowModel().rows;
  const shown = table.getRowModel().rows;
  const total = rows.length;
  const hasTotals = visibleCols.some((c) => c.total);
  const { pageIndex } = table.getState().pagination;
  const from = filteredRows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(filteredRows.length, (pageIndex + 1) * pageSize);

  async function onExport() {
    setExporting(true);
    try {
      const { exportToExcel } = await import("./export-excel");
      await exportToExcel(noun, visibleCols, table.getPrePaginationRowModel().rows.map((r) => r.original));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
        <span>
          {filters.length > 0 ? (
            <>
              <b>{filteredRows.length.toLocaleString("en-NZ")}</b>/{total.toLocaleString("en-NZ")} {noun} filtered
            </>
          ) : (
            <>
              <b>{total.toLocaleString("en-NZ")}</b> {noun}
            </>
          )}
        </span>
        {filters.length > 0 && (
          <button type="button" className="btn-secondary py-0.5 text-xs" onClick={() => setFilters([])}>
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="icon-btn" onClick={onExport} disabled={exporting || filteredRows.length === 0} aria-label="Export to Excel" title={exporting ? "Exporting…" : "Export to Excel"}>
            <Download className="h-5 w-5" aria-hidden />
          </button>
          <details className="relative">
            <summary className="icon-btn cursor-pointer list-none" aria-label="Choose columns" title="Choose columns">
              <Settings2 className="h-5 w-5" aria-hidden />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
              {columns.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-page">
                  <input
                    type="checkbox"
                    checked={visibility[c.key] !== false}
                    onChange={(e) => changeVisibility({ ...visibility, [c.key]: e.target.checked })}
                  />
                  {c.header}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line">
                {hg.headers.map((h) => {
                  const col = h.column.columnDef.meta as TableColumn;
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" className={clsx("px-3 pt-2 pb-1 text-xs font-normal text-muted", isNumeric(col) ? "text-right" : "text-left")}>
                      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" && <ArrowUp className="h-3 w-3" aria-label="sorted ascending" />}
                        {dir === "desc" && <ArrowDown className="h-3 w-3" aria-label="sorted descending" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
            {/* Filter row */}
            <tr className="border-b border-line">
              {table.getVisibleLeafColumns().map((c) => {
                const col = c.columnDef.meta as TableColumn;
                return (
                  <th key={c.id} className="px-2 pb-2 font-normal">
                    <input
                      className={clsx("input w-full px-2 py-1 text-xs", isNumeric(col) && "text-right")}
                      placeholder="Filter"
                      aria-label={`Filter ${col.header}`}
                      value={(c.getFilterValue() as string) ?? ""}
                      onChange={(e) => c.setFilterValue(e.target.value || undefined)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {hasTotals && filteredRows.length > 0 && (
              <tr className="border-b border-line bg-[#eef3f8] font-bold">
                {visibleCols.map((c, i) => (
                  <td key={c.key} className={clsx("px-3 py-2 tabular-nums", isNumeric(c) && "text-right")}>
                    {i === 0 ? "Total:" : columnTotal(c, filteredRows.map((r) => r.original))}
                  </td>
                ))}
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-line hover:bg-[#f7f9fb]">
                {r.getVisibleCells().map((cell) => {
                  const col = cell.column.columnDef.meta as TableColumn;
                  const text = displayValue(col, r.original);
                  const tone = col.kind === "status" && text ? col.tones?.[text] : undefined;
                  return (
                    <td
                      key={cell.id}
                      className={clsx(
                        "px-3 py-2 whitespace-nowrap",
                        isNumeric(col) && "text-right tabular-nums",
                        col.mono && "font-mono text-xs",
                        tone && TONE_CLASS[tone],
                      )}
                    >
                      {col.link && text ? (
                        <Link href={`${col.link.base}/${r.original[col.link.idKey]}`} className="text-link hover:underline">
                          {text}
                        </Link>
                      ) : col.kind === "money" && text && col.currencyKey ? (
                        `${text} ${r.original[col.currencyKey] ?? ""}`.trim()
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="px-3 py-4 text-sm text-muted">
                  {total === 0 ? empty : `No ${noun} match these filters.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {filteredRows.length > pageSize && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-sm">
          <span className="text-muted">
            Showing {from.toLocaleString("en-NZ")}–{to.toLocaleString("en-NZ")} of {filteredRows.length.toLocaleString("en-NZ")}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </button>
            <button type="button" className="btn-secondary" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
