"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable, numberFilter } from "@/components/DataTable";

interface LogEntry {
  id: number;
  createdAt: string;
  apiType: string;
  rowId: number | null;
  submissionId: number | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  query: string | null;
  resultCount: number | null;
  costUsd: number | null;
}

const PAGE_SIZE = 50;

const columnHelper = createColumnHelper<LogEntry>();

const columns: ColumnDef<LogEntry, any>[] = [
  columnHelper.accessor("createdAt", {
    header: "Time",
    cell: (info) => (
      <span className="text-gray-400 whitespace-nowrap">
        {new Date(info.getValue()).toLocaleString()}
      </span>
    ),
    enableColumnFilter: false,
    sortingFn: "datetime",
  }),
  columnHelper.accessor("apiType", {
    header: "Type",
    cell: (info) => {
      const v = info.getValue();
      return (
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${
            v === "gemini"
              ? "bg-purple-50 text-purple-700"
              : "bg-blue-50 text-blue-700"
          }`}
        >
          {v}
        </span>
      );
    },
    filterFn: "includesString",
  }),
  columnHelper.display({
    id: "rowOrSub",
    header: "Row / Sub",
    cell: ({ row }) => {
      const log = row.original;
      if (!log.rowId && !log.submissionId)
        return <span className="text-gray-300">—</span>;
      return (
        <span className="text-gray-500">
          {log.rowId && (
            <Link
              href={`/rows/${log.rowId}`}
              className="text-blue-500 hover:underline"
            >
              row {log.rowId}
            </Link>
          )}
          {log.rowId && log.submissionId && " · "}
          {log.submissionId && (
            <Link
              href={`/intake/${log.submissionId}`}
              className="text-blue-500 hover:underline"
            >
              sub {log.submissionId}
            </Link>
          )}
        </span>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.accessor(
    (log) => (log.apiType === "gemini" ? log.model : log.query) ?? "",
    {
      id: "detail",
      header: "Detail",
      cell: (info) => {
        const v = info.getValue();
        return (
          <span className="text-gray-600 max-w-xs truncate inline-block align-bottom">
            {v ? v : <span className="text-gray-300">—</span>}
          </span>
        );
      },
      filterFn: "includesString",
    }
  ),
  columnHelper.accessor("totalTokens", {
    header: "Tokens",
    cell: ({ row }) => {
      const log = row.original;
      if (log.totalTokens == null) return <span className="text-gray-300">—</span>;
      return (
        <span
          className="text-gray-500 tabular-nums"
          title={`${log.promptTokens ?? 0} in / ${log.outputTokens ?? 0} out`}
        >
          {log.totalTokens.toLocaleString()}
        </span>
      );
    },
    filterFn: numberFilter,
  }),
  columnHelper.accessor("latencyMs", {
    header: "Latency",
    cell: (info) => {
      const v = info.getValue();
      return v != null ? (
        <span className="text-gray-500 tabular-nums">{(v / 1000).toFixed(1)}s</span>
      ) : (
        <span className="text-gray-300">—</span>
      );
    },
    filterFn: numberFilter,
  }),
  columnHelper.accessor("costUsd", {
    header: "Cost",
    cell: (info) => {
      const v = info.getValue();
      return v != null ? (
        <span className="text-gray-700 font-medium tabular-nums">
          ${v.toFixed(4)}
        </span>
      ) : (
        <span className="text-gray-300">—</span>
      );
    },
    filterFn: numberFilter,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ row }) => {
      const log = row.original;
      return log.status === "success" ? (
        <span className="text-green-500">✓</span>
      ) : (
        <span className="text-red-500" title={log.error ?? ""}>
          ✗
        </span>
      );
    },
    filterFn: "includesString",
  }),
];

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [apiType, setApiType] = useState<"" | "gemini" | "tavily">("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
      ...(apiType ? { apiType } : {}),
    });
    fetch(`/api/logs?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [page, apiType]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const totalCost = logs.reduce((sum, l) => sum + (l.costUsd ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">API Call Logs</h1>
        <div className="text-xs text-gray-400">
          {total.toLocaleString()} total entries
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(["", "gemini", "tavily"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setApiType(t);
              setPage(1);
            }}
            className={`text-xs px-3 py-1.5 rounded border font-medium transition-colors ${
              apiType === t
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {t === "" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <div className="ml-auto text-xs text-gray-400 flex items-center">
          Page cost:{" "}
          <span className="text-gray-700 font-medium ml-1">
            ${totalCost.toFixed(4)}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
      ) : (
        <DataTable
          data={logs}
          columns={columns}
          emptyMessage="No logs yet."
          searchPlaceholder="Search this page…"
        />
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4 text-xs text-gray-500">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
