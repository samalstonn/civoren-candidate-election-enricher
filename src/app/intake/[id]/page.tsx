"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable, numberFilter, cells } from "@/components/DataTable";

interface DraftRow {
  id: number;
  fullNameRaw: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  municipality: string | null;
  county: string | null;
  state: string | null;
  year: string | null;
  email: string | null;
  phone: string | null;
  confidence: number | null;
  enrichmentStatus: string | null;
  matchAuditJson: {
    status?: string;
    parsedResult?: {
      currentRole?: string | null;
      currentCity?: string | null;
      biography?: string | null;
    } | null;
  } | null;
  updatedAt: string;
}

interface Submission {
  id: number;
  sourceType: string;
  status: string;
  targetState: string | null;
  targetCounty: string | null;
  targetAuthorityName: string | null;
  defaultYear: string | null;
  sheetDescription: string | null;
  receivedAt: string;
  draftRows: DraftRow[];
}

function statusBadge(status: string | null) {
  const s = status ?? "not_started";
  const map: Record<string, string> = {
    not_started: "bg-gray-100 text-gray-500",
    search_queued: "bg-blue-50 text-blue-600",
    search_running: "bg-blue-100 text-blue-700 animate-pulse",
    search_complete: "bg-cyan-50 text-cyan-700",
    gemini_queued: "bg-purple-50 text-purple-600",
    gemini_running: "bg-purple-100 text-purple-700 animate-pulse",
    gemini_complete: "bg-indigo-50 text-indigo-700",
    result_saved: "bg-green-50 text-green-700",
    failed: "bg-red-50 text-red-600",
    needs_review: "bg-amber-50 text-amber-700",
  };
  const cls = map[s] ?? "bg-gray-100 text-gray-500";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

interface TableRow {
  id: number;
  name: string;
  positionLocation: string;
  enrichmentStatus: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  hasRole: boolean;
  hasCity: boolean;
  bioLength: number;
  confidence: number | null;
  updatedAt: string;
}

export default function IntakeDetailPage() {
  const params = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichingRows, setEnrichingRows] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [logSummary, setLogSummary] = useState<
    { apiType: string; calls: number; totalTokens: number | null; totalCostUsd: number | null }[]
  >([]);

  const load = useCallback(() => {
    fetch(`/api/submissions/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setSubmission(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    fetch(`/api/logs/summary?submissionId=${params.id}`)
      .then((r) => r.json())
      .then((data) => setLogSummary(data.summary ?? []));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const enrichRow = useCallback(
    async (rowId: number) => {
      setEnrichingRows((prev) => new Set(prev).add(rowId));
      try {
        await fetch(`/api/rows/${rowId}/enrich`, { method: "POST" });
        load();
      } finally {
        setEnrichingRows((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
      }
    },
    [load]
  );

  async function enrichTarget(target: string) {
    setBatchRunning(true);
    try {
      await fetch(`/api/submissions/${params.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      load();
    } finally {
      setBatchRunning(false);
    }
  }

  async function cancelEnrich() {
    await fetch(`/api/submissions/${params.id}/cancel`, { method: "POST" });
  }

  const columns = useMemo<ColumnDef<TableRow, any>[]>(() => {
    const h = createColumnHelper<TableRow>();
    return [
      h.accessor("id", {
        header: "ID",
        cell: (info) => (
          <span className="text-gray-400">#{info.getValue()}</span>
        ),
        filterFn: numberFilter,
      }),
      h.accessor("name", {
        header: "Candidate",
        cell: (info) => (
          <span className="text-gray-900 font-medium">{info.getValue()}</span>
        ),
        filterFn: "includesString",
      }),
      h.accessor("positionLocation", {
        header: "Position / Location",
        cell: (info) => (
          <span className="text-gray-500 max-w-xs truncate inline-block align-bottom">
            {info.getValue() || <span className="text-gray-300">—</span>}
          </span>
        ),
        filterFn: "includesString",
      }),
      h.accessor("enrichmentStatus", {
        header: "Status",
        cell: (info) => statusBadge(info.getValue()),
        filterFn: "includesString",
      }),
      h.accessor("hasEmail", {
        header: "Email",
        cell: (info) => cells.presence(info.getValue() || null),
        filterFn: (row, columnId, value) => {
          if (value === undefined || value === null || value === "") return true;
          return row.getValue(columnId) === value;
        },
      }),
      h.accessor("hasPhone", {
        header: "Phone",
        cell: (info) => cells.presence(info.getValue() || null),
      }),
      h.accessor("hasRole", {
        header: "Role",
        cell: (info) => cells.presence(info.getValue() || null),
      }),
      h.accessor("hasCity", {
        header: "City",
        cell: (info) => cells.presence(info.getValue() || null),
      }),
      h.accessor("bioLength", {
        header: "Bio",
        cell: (info) =>
          info.getValue() > 0 ? (
            <span className="text-gray-500 tabular-nums">{info.getValue()}</span>
          ) : (
            <span className="text-gray-300">—</span>
          ),
        filterFn: numberFilter,
      }),
      h.accessor("confidence", {
        header: "Conf.",
        cell: (info) => {
          const v = info.getValue();
          return v != null ? (
            <span className="text-gray-500 tabular-nums">
              {(v * 100).toFixed(0)}%
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          );
        },
        filterFn: numberFilter,
      }),
      h.accessor("updatedAt", {
        header: "Last Run",
        cell: (info) => (
          <span className="text-gray-400">
            {new Date(info.getValue()).toLocaleString()}
          </span>
        ),
        enableColumnFilter: false,
        sortingFn: "datetime",
      }),
      h.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const isEnriching = enrichingRows.has(row.original.id);
          return (
            <div className="flex gap-2">
              <button
                onClick={() => enrichRow(row.original.id)}
                disabled={isEnriching}
                className="px-2 py-1 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 disabled:opacity-40 rounded transition-colors"
              >
                {isEnriching ? "Running…" : "Enrich"}
              </button>
              <Link
                href={`/rows/${row.original.id}`}
                className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
              >
                Details
              </Link>
            </div>
          );
        },
      }),
    ];
  }, [enrichRow, enrichingRows]);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;
  if (!submission) return null;

  const rows = submission.draftRows;

  const statusCounts = rows.reduce<Record<string, number>>((acc, r) => {
    const s = r.enrichmentStatus ?? "not_started";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const statusOrder = [
    "not_started",
    "search_queued",
    "search_running",
    "search_complete",
    "gemini_queued",
    "gemini_running",
    "gemini_complete",
    "result_saved",
    "needs_review",
    "failed",
  ];
  const presentStatuses = statusOrder.filter((s) => statusCounts[s]);

  const visibleRows = statusFilter
    ? rows.filter((r) => (r.enrichmentStatus ?? "not_started") === statusFilter)
    : rows;

  const tableRows: TableRow[] = visibleRows.map((row) => {
    const name =
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      row.fullNameRaw ||
      "—";
    const location = [row.municipality, row.county, row.state]
      .filter(Boolean)
      .join(", ");
    const positionLocation =
      [row.position, location].filter(Boolean).join(" · ") || "";
    return {
      id: row.id,
      name,
      positionLocation,
      enrichmentStatus: row.enrichmentStatus,
      hasEmail: Boolean(row.email),
      hasPhone: Boolean(row.phone),
      hasRole: Boolean(row.matchAuditJson?.parsedResult?.currentRole),
      hasCity: Boolean(row.matchAuditJson?.parsedResult?.currentCity),
      bioLength: row.matchAuditJson?.parsedResult?.biography?.length ?? 0,
      confidence: row.confidence,
      updatedAt: row.updatedAt,
    };
  });

  const notStarted = rows.filter(
    (r) => !r.enrichmentStatus || r.enrichmentStatus === "not_started"
  ).length;
  const allFailed = rows.filter((r) => r.enrichmentStatus === "failed").length;
  const searchFailed = rows.filter(
    (r) =>
      r.enrichmentStatus === "failed" &&
      r.matchAuditJson?.status !== "search_complete" &&
      r.matchAuditJson?.status !== "gemini_complete"
  ).length;
  const geminiFailed = rows.filter(
    (r) =>
      r.enrichmentStatus === "failed" &&
      r.matchAuditJson?.status === "search_complete"
  ).length;
  const saveFailed = rows.filter(
    (r) =>
      r.enrichmentStatus === "failed" &&
      r.matchAuditJson?.status === "gemini_complete"
  ).length;

  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/intake" className="hover:text-gray-600">
          Pending Candidates
        </Link>{" "}
        / #{submission.id}
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            Submission #{submission.id}
          </h1>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            <div>
              {submission.targetState ?? "—"}{" "}
              {submission.targetCounty ? `· ${submission.targetCounty} County` : ""}
              {submission.targetAuthorityName
                ? ` · ${submission.targetAuthorityName}`
                : ""}
              {submission.defaultYear ? ` · ${submission.defaultYear}` : ""}
            </div>
            <div>
              Source: {submission.sourceType} · Status: {submission.status} ·
              Received: {new Date(submission.receivedAt).toLocaleDateString()}
            </div>
            {submission.sheetDescription && (
              <div className="text-gray-400 italic">{submission.sheetDescription}</div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2 flex-wrap justify-end">
            {batchRunning && (
              <button
                onClick={cancelEnrich}
                className="text-xs px-3 py-2 bg-white hover:bg-red-50 text-red-600 font-bold border border-red-300 rounded transition-colors"
              >
                Cancel
              </button>
            )}
            {notStarted > 0 && (
              <button
                onClick={() => enrichTarget("not_started")}
                disabled={batchRunning}
                className="text-xs px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
              >
                {batchRunning ? "Running..." : `Enrich Not Started (${notStarted})`}
              </button>
            )}
            {allFailed > 0 && (
              <button
                onClick={() => enrichTarget("all_failed")}
                disabled={batchRunning}
                className="text-xs px-3 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
              >
                {batchRunning ? "Running..." : `Retry All Failed (${allFailed})`}
              </button>
            )}
          </div>
          {allFailed > 0 && (
            <div className="flex gap-1.5">
              {searchFailed > 0 && (
                <button
                  onClick={() => enrichTarget("search_failed")}
                  disabled={batchRunning}
                  className="text-xs px-2 py-1 bg-white hover:bg-gray-50 disabled:opacity-40 text-gray-600 border border-gray-300 rounded transition-colors"
                >
                  Search ({searchFailed})
                </button>
              )}
              {geminiFailed > 0 && (
                <button
                  onClick={() => enrichTarget("gemini_failed")}
                  disabled={batchRunning}
                  className="text-xs px-2 py-1 bg-white hover:bg-purple-50 disabled:opacity-40 text-purple-600 border border-purple-300 rounded transition-colors"
                >
                  Gemini ({geminiFailed})
                </button>
              )}
              {saveFailed > 0 && (
                <button
                  onClick={() => enrichTarget("save_failed")}
                  disabled={batchRunning}
                  className="text-xs px-2 py-1 bg-white hover:bg-green-50 disabled:opacity-40 text-green-600 border border-green-300 rounded transition-colors"
                >
                  Save ({saveFailed})
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {logSummary.length > 0 && (
        <div className="mb-4 flex gap-3">
          {logSummary.map((s) => (
            <div
              key={s.apiType}
              className="bg-white border border-gray-200 rounded p-3 flex-1"
            >
              <div className="text-xs text-gray-400 mb-1 capitalize">{s.apiType}</div>
              <div className="text-sm text-gray-900 font-medium">
                {s.calls} call{s.calls !== 1 ? "s" : ""}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {s.totalTokens != null && (
                  <span>{s.totalTokens.toLocaleString()} tokens · </span>
                )}
                {s.totalCostUsd != null && <span>${s.totalCostUsd.toFixed(4)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setStatusFilter(null)}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${statusFilter === null
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
            }`}
        >
          All ({rows.length})
        </button>
        {presentStatuses.map((s) => {
          const colorMap: Record<string, string> = {
            not_started: "bg-gray-100 text-gray-500 border-gray-200",
            search_queued: "bg-blue-50 text-blue-600 border-blue-200",
            search_running: "bg-blue-100 text-blue-700 border-blue-300",
            search_complete: "bg-cyan-50 text-cyan-700 border-cyan-200",
            gemini_queued: "bg-purple-50 text-purple-600 border-purple-200",
            gemini_running: "bg-purple-100 text-purple-700 border-purple-300",
            gemini_complete: "bg-indigo-50 text-indigo-700 border-indigo-200",
            result_saved: "bg-green-50 text-green-700 border-green-200",
            failed: "bg-red-50 text-red-600 border-red-200",
            needs_review: "bg-amber-50 text-amber-700 border-amber-200",
          };
          const activeMap: Record<string, string> = {
            not_started: "bg-gray-500 text-white border-gray-500",
            search_queued: "bg-blue-500 text-white border-blue-500",
            search_running: "bg-blue-600 text-white border-blue-600",
            search_complete: "bg-cyan-500 text-white border-cyan-500",
            gemini_queued: "bg-purple-500 text-white border-purple-500",
            gemini_running: "bg-purple-600 text-white border-purple-600",
            gemini_complete: "bg-indigo-500 text-white border-indigo-500",
            result_saved: "bg-green-500 text-white border-green-500",
            failed: "bg-red-500 text-white border-red-500",
            needs_review: "bg-amber-500 text-white border-amber-500",
          };
          const cls =
            statusFilter === s
              ? activeMap[s] ?? "bg-gray-800 text-white border-gray-800"
              : colorMap[s] ?? "bg-gray-100 text-gray-500 border-gray-200";
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cls}`}
            >
              {s.replace(/_/g, " ")} ({statusCounts[s]})
            </button>
          );
        })}
      </div>

      <DataTable
        data={tableRows}
        columns={columns}
        emptyMessage={
          statusFilter
            ? `No rows with status "${statusFilter.replace(/_/g, " ")}".`
            : "No draft rows for this submission."
        }
      />
    </div>
  );
}
