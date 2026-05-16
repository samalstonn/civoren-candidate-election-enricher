# DataTable Component

`src/components/DataTable.tsx` is the shared table for every list view in the app. It wraps TanStack Table v8 with the styling, filter inputs, column visibility dropdown, and global search box used across `/candidates`, `/intake`, `/intake/[id]`, and `/logs`.

All state (sort, per-column filters, global filter, column visibility) is local to the component instance and resets on unmount. No persistence.

## Minimum usage

```tsx
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";

const h = createColumnHelper<MyRow>();
const columns: ColumnDef<MyRow, any>[] = [
  h.accessor("id", { header: "ID", cell: (i) => i.getValue() }),
  // ...
];

<DataTable data={rows} columns={columns} emptyMessage="Nothing here." />
```

## Exported helpers

| Export | Purpose |
|---|---|
| `boolFilter` | Alias for TanStack's built-in `"equals"`. Pair with `cells.bool` and the header auto-renders a tri-state ✓/✗/• pill. Strict `===`; `autoRemove` treats `undefined` as "no filter" but keeps `false` as a valid match. |
| `numberFilter` | Custom `FilterFn` for numeric columns — accepts `>5`, `<=10`, `=3`, or a substring. TanStack's built-in `"inNumberRange"` only handles `[min, max]` tuples, so this is hand-rolled. |
| `"includesString"` (built-in) | TanStack's default string filter. Use as the literal string `"includesString"`. |
| `DebouncedInput` | 200ms-debounced text input. Used internally by header filter cells and global search; export available for custom toolbars. |
| `BoolFilterPill` | Tri-state pill component. Used internally for boolean filter UI. |
| `cells.bool(v)` | Renders `✓` / `✗`. |
| `cells.presence(v)` | Renders `✓` if truthy, `—` otherwise. Use when you only care about "has value vs. doesn't". |
| `cells.nullable(v)` | Renders the string, or `—` placeholder if null/empty. |
| `cells.link(url)` | Renders an external `<a target="_blank">` with truncation and a stripped protocol prefix; `—` if null. |

## Column widths and resizing

The table renders with `table-layout: fixed` driven by TanStack's column sizing API. Every `<th>` and `<td>` gets an explicit `width` from `column.getSize()`; the `<table>` is sized to `table.getTotalSize()`. The browser respects those widths verbatim — no auto-shrink, no overflow surprises.

Set `size` (px) on each column when the default 150 is wrong:

```tsx
columnHelper.accessor("id", { header: "ID", size: 60, ... }),
columnHelper.accessor("name", { header: "Name", size: 180, ... }),
```

`minSize` (default 20) and `maxSize` (default 500) cap the resize range.

**Resizing.** Every column header has a 1px drag handle on its right edge (turns amber on hover). Drag to resize live (`columnResizeMode: "onChange"`). Double-click the handle to reset the column to its declared `size`. Resizing is enabled globally via `enableColumnResizing: true` on the `useReactTable` call inside `DataTable`.

**Truncation.** By default, body cell content is NOT truncated — columns hold their declared widths and content overflows visibly if too long. To clip a specific column, render its `cell` with `className="block overflow-hidden text-ellipsis whitespace-nowrap"` and a `title={v}` for the full value on hover (see `currentRole` and `electionPosition` on `/candidates`).

Do **not** try to fix layout issues with `min-w-*` Tailwind classes on cells — let TanStack drive widths.

## Full-viewport layout

For pages where the table should fill the viewport (only the body scrolls, no page-level scroll), wrap the page in a fixed-height flex column and pass `maxHeight="100%"` to DataTable:

```tsx
<div className="flex flex-col" style={{ height: "calc(100vh - 113px)" }}>
  {/* header + chips */}
  <div className="flex-1 min-h-0">
    <DataTable virtualizeRows maxHeight="100%" ... />
  </div>
</div>
```

When `maxHeight="100%"`, DataTable switches its scroll container to `flex-1 min-h-0` so it claims remaining height after the toolbar. The `113px` accounts for the app header (49px) plus `<main>` `py-8` (64px) from `src/app/layout.tsx`; adjust if the chrome changes. See `/candidates/page.tsx`.

## Picking a filter for a column

- **String content** → `filterFn: "includesString"` → text input.
- **Numeric with comparators** → `filterFn: numberFilter` → text input that accepts `>N`, `<N`, `>=N`, `<=N`, `=N`, or substring fallback.
- **Boolean** → `filterFn: boolFilter` + `cells.bool` for the cell → tri-state pill.
- **Don't filter this column** → `enableColumnFilter: false`.

The header inspects the `filterFn` identity to decide between the text input and the boolean pill. If you introduce a new filter kind, update that conditional inside `DataTable.tsx`.

## Reacting to filter state from the page

Pass `onFilteredRowsChange={(rows) => ...}` to receive the post-filter, post-sort row array whenever the user types in search, sets a column filter, or sorts. Used for filter-aware counts and batch actions (e.g. the "Enrich filtered (N)" button on `/candidates`).

```tsx
const [filteredRows, setFilteredRows] = useState<MyRow[]>([]);
<DataTable
  data={data}
  columns={columns}
  onFilteredRowsChange={setFilteredRows}
/>
```

Caveat: rows passed to DataTable as `data` are what TanStack filters. If you pre-filter `data` (e.g. with a status chip applied above the table), `filteredRows` reflects the intersection. Chip counts derived from `filteredRows` collapse when a chip is active — that's expected, since the chip already narrows the view.

## Layering page-level filters

`DataTable` operates on whatever array you pass as `data`. If a page has additional pre-table filters (e.g. status chips on `/candidates` and `/intake/[id]`), keep them outside the component and pass the filtered array in. Compositional, no special API needed.

For toolbar items that should live *inside* the table's controls strip (left of the search box), pass a `toolbar` ReactNode prop. Hide the built-in search or columns dropdown via `showGlobalSearch={false}` / `showColumnsToggle={false}` when needed.

## Display columns and computed accessors

For columns that don't map cleanly to a single field, use either:

- `columnHelper.display({ id, header, cell })` — no value, can't filter or sort by it (set `enableSorting: false` to suppress the sort affordance).
- `columnHelper.accessor((row) => derived, { id, header, cell, filterFn })` — synthetic accessor that *can* be filtered and sorted. Used on `/logs` for the "Detail" column that picks `model` or `query` depending on `apiType`.

## Per-row actions

Define an `id: "actions"` display column whose `cell` renders buttons or links. Closure-capture the page-level handlers; wrap the column definitions in `useMemo` with the handler in the deps array so cell renderers always see the latest state (see `src/app/intake/[id]/page.tsx`).

## Server pagination

The component does client-side sort/filter only — there's no built-in pagination. If a list is server-paginated (`/logs`), keep the pagination controls outside the component; the table will sort/filter/global-search within the current page's rows.

## Row virtualization

For large datasets (hundreds+ of rows with many columns), rendering every `<tr>` becomes the bottleneck. Opt in by passing `virtualizeRows`:

```tsx
<DataTable
  data={rows}
  columns={columns}
  virtualizeRows
  estimatedRowHeight={36}   // px; default 36
  maxHeight="75vh"          // CSS for the scroll container; default "70vh"
/>
```

Under the hood: powered by `@tanstack/react-virtual`. The table wraps in a fixed-height scroll container with a sticky header; only rows in the viewport (plus an `overscan: 10` buffer) render. Off-window rows are represented as a single top/bottom spacer `<tr>` whose height preserves scrollbar position.

When to enable:
- ✅ `/candidates` — many candidates × 19 columns.
- ❌ `/logs` — server-paginated at 50 rows; not worth it.
- ❌ `/intake` — small list of submissions.
- 🤔 `/intake/[id]` — depends on draft-row count; enable if a submission has hundreds of rows.

The header is `position: sticky` only when virtualization is on (otherwise the page-level scroll suffices). If your row content has variable height taller than `estimatedRowHeight`, bump `estimatedRowHeight` accordingly — small over-estimates are fine; large under-estimates cause scroll jitter.
