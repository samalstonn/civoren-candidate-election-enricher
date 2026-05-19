"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  flexRender,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type FilterFn,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

// Boolean tri-state filtering uses TanStack's built-in "equals" — strict ===,
// autoRemove ignores undefined but keeps `false` as a valid filter value.
// The `as const` preserves the literal type so the header can sentinel-check it.
export const boolFilter = "equals" as const;

// Sentinel for "exact-match dropdown" columns. The header renders a <select>
// populated from the column's distinct values; matching uses strict equality
// against the chosen option (or no filter when blank).
export const selectFilter: FilterFn<any> = (row, columnId, value) => {
  if (value === undefined || value === null || value === "") return true;
  return row.getValue(columnId) === value;
};

// TanStack has no built-in for `>N` / `<=N` comparator parsing
// (only `inNumberRange`, which takes a `[min, max]` tuple), so this stays custom.
export const numberFilter: FilterFn<any> = (row, columnId, value) => {
  if (value === undefined || value === null || value === "") return true;
  const v = row.getValue<number | null>(columnId);
  if (v == null) return false;
  const raw = String(value).trim();
  const m = raw.match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return String(v).includes(raw);
  const op = m[1] ?? "=";
  const n = Number(m[2]);
  switch (op) {
    case ">":  return v > n;
    case "<":  return v < n;
    case ">=": return v >= n;
    case "<=": return v <= n;
    default:   return v === n;
  }
};

export function DebouncedInput({
  value,
  onChange,
  placeholder,
  className,
  delay = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
}) {
  const [local, setLocal] = useState(value);
  const lastExternal = useRef(value);

  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setLocal(value);
    }
  }, [value]);

  useEffect(() => {
    if (local === lastExternal.current) return;
    const t = setTimeout(() => {
      lastExternal.current = local;
      onChange(local);
    }, delay);
    return () => clearTimeout(t);
  }, [local, delay, onChange]);

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

export function SelectFilter({
  column,
  value,
  onChange,
}: {
  column: { getFacetedRowModel: () => { rows: { getValue: (id: string) => unknown }[] }; id: string };
  value: string;
  onChange: (v: string) => void;
}) {
  const rows = column.getFacetedRowModel().rows;
  const distinct = new Set<string>();
  for (const r of rows) {
    const v = r.getValue(column.id);
    if (v == null || v === "") continue;
    distinct.add(String(v));
  }
  const options = Array.from(distinct).sort((a, b) => a.localeCompare(b));
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-1 py-0.5 text-[10px] border border-gray-200 rounded w-full font-normal focus:outline-none focus:border-gray-400 bg-white"
    >
      <option value="">all</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

export function BoolFilterPill({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  const opt = (label: string, v: boolean | undefined, active: boolean) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`px-1.5 py-0.5 text-[10px] border ${
        active
          ? "bg-gray-800 text-white border-gray-800"
          : "bg-white text-gray-400 border-gray-200 hover:border-gray-400"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded overflow-hidden">
      {opt("•", undefined, value === undefined)}
      {opt("✓", true, value === true)}
      {opt("✗", false, value === false)}
    </div>
  );
}

export const cells = {
  bool: (v: boolean | null | undefined) =>
    v ? (
      <span className="text-green-600">✓</span>
    ) : (
      <span className="text-gray-300">✗</span>
    ),
  presence: (v: unknown) =>
    v != null && v !== "" ? (
      <span className="text-green-600">✓</span>
    ) : (
      <span className="text-gray-300">—</span>
    ),
  nullable: (v: string | null | undefined) =>
    v && v.length > 0 ? v : <span className="text-gray-300">—</span>,
  link: (url: string | null | undefined, maxWidth = 180) => {
    if (!url) return <span className="text-gray-300">—</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-amber-600 hover:underline truncate inline-block align-bottom"
        style={{ maxWidth }}
        title={url}
        onClick={(e) => e.stopPropagation()}
      >
        {url.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
    );
  },
};

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  emptyMessage?: ReactNode;
  toolbar?: ReactNode;
  initialVisibility?: VisibilityState;
  showGlobalSearch?: boolean;
  showColumnsToggle?: boolean;
  showReset?: boolean;
  rowClassName?: (row: T) => string;
  tdClassName?: string;
  thClassName?: string;
  searchPlaceholder?: string;
  /** Opt in to row virtualization. Wraps the table in a fixed-height scroll
   *  container and renders only the visible window of rows. */
  virtualizeRows?: boolean;
  /** Estimated row height in px (used by the virtualizer). Default 36. */
  estimatedRowHeight?: number;
  /** CSS max-height for the scroll container when virtualization is on. */
  maxHeight?: string;
  /** Fires whenever the filtered+sorted row set changes. Use it to derive
   *  counts or batch actions based on what the user currently sees. */
  onFilteredRowsChange?: (rows: T[]) => void;
}

export function DataTable<T>({
  data,
  columns,
  emptyMessage = "No rows.",
  toolbar,
  initialVisibility,
  showGlobalSearch = true,
  showColumnsToggle = true,
  showReset = true,
  rowClassName,
  tdClassName = "py-2 px-3 text-gray-500",
  thClassName = "pb-2 px-3 font-medium text-gray-400 bg-white align-top relative",
  searchPlaceholder = "Search all columns…",
  virtualizeRows = false,
  estimatedRowHeight = 36,
  maxHeight = "70vh",
  onFilteredRowsChange,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialVisibility ?? {}
  );
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const rows = table.getRowModel().rows;
  const rowCount = rows.length;
  const hasActiveState =
    columnFilters.length > 0 || globalFilter !== "" || sorting.length > 0;

  useEffect(() => {
    if (!onFilteredRowsChange) return;
    onFilteredRowsChange(rows.map((r) => r.original));
  }, [rows, onFilteredRowsChange]);

  return (
    <div className={virtualizeRows ? "flex flex-col h-full min-h-0" : undefined}>
      {(toolbar || showGlobalSearch || showColumnsToggle) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {toolbar}
          {showGlobalSearch && (
            <DebouncedInput
              value={globalFilter}
              onChange={setGlobalFilter}
              placeholder={searchPlaceholder}
              className="px-2 py-1 text-xs border border-gray-200 rounded w-64 focus:outline-none focus:border-gray-400"
            />
          )}
          {showColumnsToggle && (
            <details className="relative">
              <summary className="px-2.5 py-1 text-xs border border-gray-200 rounded cursor-pointer text-gray-500 hover:border-gray-400 list-none">
                Columns ({table.getVisibleLeafColumns().length}/{columns.length})
              </summary>
              <div className="absolute z-10 mt-1 bg-white border border-gray-200 rounded shadow-md p-2 min-w-[180px] max-h-80 overflow-y-auto">
                {table.getAllLeafColumns().map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-2 px-1 py-1 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
              </div>
            </details>
          )}
          {showReset && hasActiveState && (
            <button
              onClick={() => {
                setColumnFilters([]);
                setGlobalFilter("");
                setSorting([]);
              }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <TableBody
        table={table}
        scrollRef={scrollRef}
        virtualizeRows={virtualizeRows}
        estimatedRowHeight={estimatedRowHeight}
        maxHeight={maxHeight}
        rowClassName={rowClassName}
        tdClassName={tdClassName}
        thClassName={thClassName}
        emptyMessage={emptyMessage}
        rowCount={rowCount}
      />
    </div>
  );
}

function TableBody<T>({
  table,
  scrollRef,
  virtualizeRows,
  estimatedRowHeight,
  maxHeight,
  rowClassName,
  tdClassName,
  thClassName,
  emptyMessage,
  rowCount,
}: {
  table: ReturnType<typeof useReactTable<T>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  virtualizeRows: boolean;
  estimatedRowHeight: number;
  maxHeight: string;
  rowClassName?: (row: T) => string;
  tdClassName: string;
  thClassName: string;
  emptyMessage: ReactNode;
  rowCount: number;
}) {
  const rows = table.getRowModel().rows;
  const visibleColCount = table.getVisibleLeafColumns().length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
    enabled: virtualizeRows,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  const header = (
    <thead className={virtualizeRows ? "sticky top-0 z-10" : undefined}>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr
          key={headerGroup.id}
          className="border-b border-gray-200 text-left whitespace-nowrap align-top"
        >
          {headerGroup.headers.map((header) => {
            const canSort = header.column.getCanSort();
            const canFilter = header.column.getCanFilter();
            const sortDir = header.column.getIsSorted();
            const filterVal = header.column.getFilterValue();
            const filterFn = header.column.columnDef.filterFn;
            return (
              <th
                key={header.id}
                className={thClassName}
                style={{ width: header.getSize() }}
              >
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={
                      canSort
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    className={`text-left ${
                      canSort ? "cursor-pointer hover:text-gray-700" : ""
                    }`}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {sortDir === "asc" && " ↑"}
                    {sortDir === "desc" && " ↓"}
                  </button>
                  {canFilter &&
                    (filterFn === boolFilter ? (
                      <BoolFilterPill
                        value={filterVal as boolean | undefined}
                        onChange={(v) => header.column.setFilterValue(v)}
                      />
                    ) : filterFn === selectFilter ? (
                      <SelectFilter
                        column={header.column}
                        value={(filterVal as string) ?? ""}
                        onChange={(v) =>
                          header.column.setFilterValue(v || undefined)
                        }
                      />
                    ) : (
                      <DebouncedInput
                        value={(filterVal as string) ?? ""}
                        onChange={(v) =>
                          header.column.setFilterValue(v || undefined)
                        }
                        placeholder={
                          filterFn === numberFilter ? ">0" : "filter"
                        }
                        className="px-1 py-0.5 text-[10px] border border-gray-200 rounded w-full font-normal focus:outline-none focus:border-gray-400"
                      />
                    ))}
                </div>
                {header.column.getCanResize() && (
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => header.column.resetSize()}
                    className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-amber-400 ${
                      header.column.getIsResizing() ? "bg-amber-500" : ""
                    }`}
                    title="Drag to resize · double-click to reset"
                  />
                )}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );

  const body = (
    <tbody>
      {virtualizeRows && paddingTop > 0 && (
        <tr style={{ height: paddingTop }}>
          <td colSpan={visibleColCount} />
        </tr>
      )}
      {(virtualizeRows ? virtualItems.map((vi) => rows[vi.index]) : rows).map(
        (row) => (
          <tr
            key={row.id}
            className={`border-b border-gray-100 hover:bg-white transition-colors whitespace-nowrap ${
              rowClassName ? rowClassName(row.original) : ""
            }`}
          >
            {row.getVisibleCells().map((cell) => (
              <td
                key={cell.id}
                className={tdClassName}
                style={{ width: cell.column.getSize() }}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        )
      )}
      {virtualizeRows && paddingBottom > 0 && (
        <tr style={{ height: paddingBottom }}>
          <td colSpan={visibleColCount} />
        </tr>
      )}
    </tbody>
  );

  return (
    <div
      ref={scrollRef}
      className={
        virtualizeRows
          ? "overflow-auto border border-gray-100 rounded flex-1 min-h-0"
          : "overflow-x-auto"
      }
      style={virtualizeRows && maxHeight !== "100%" ? { maxHeight } : undefined}
    >
      <table
        className="text-xs border-collapse"
        style={{
          tableLayout: "fixed",
          width: table.getTotalSize(),
        }}
      >
        {header}
        {body}
      </table>

      {rowCount === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
