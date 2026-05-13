"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
  matchAuditJson: { status?: string } | null;
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

export default function SubmissionDetailPage() {
  const params = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichingRows, setEnrichingRows] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [logSummary, setLogSummary] = useState<{ apiType: string; calls: number; totalTokens: number | null; totalCostUsd: number | null }[]>([]);

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

  async function enrichRow(rowId: number) {
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
  }

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

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;
  if (!submission) return null;

  const rows = submission.draftRows;
  const notStarted = rows.filter((r) => !r.enrichmentStatus || r.enrichmentStatus === "not_started").length;
  const allFailed = rows.filter((r) => r.enrichmentStatus === "failed").length;
  const searchFailed = rows.filter((r) => r.enrichmentStatus === "failed" && r.matchAuditJson?.status !== "search_complete" && r.matchAuditJson?.status !== "gemini_complete").length;
  const geminiFailed = rows.filter((r) => r.enrichmentStatus === "failed" && r.matchAuditJson?.status === "search_complete").length;
  const saveFailed = rows.filter((r) => r.enrichmentStatus === "failed" && r.matchAuditJson?.status === "gemini_complete").length;

  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/submissions" className="hover:text-gray-600">
          Submissions
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
            <div key={s.apiType} className="bg-white border border-gray-200 rounded p-3 flex-1">
              <div className="text-xs text-gray-400 mb-1 capitalize">{s.apiType}</div>
              <div className="text-sm text-gray-900 font-medium">{s.calls} call{s.calls !== 1 ? "s" : ""}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {s.totalTokens != null && <span>{s.totalTokens.toLocaleString()} tokens · </span>}
                {s.totalCostUsd != null && <span>${s.totalCostUsd.toFixed(4)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-400 text-left">
              <th className="pb-2 pr-3 font-medium">ID</th>
              <th className="pb-2 pr-3 font-medium">Candidate</th>
              <th className="pb-2 pr-3 font-medium">Position / Location</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium text-center">Email</th>
              <th className="pb-2 pr-3 font-medium text-center">Phone</th>
              <th className="pb-2 pr-3 font-medium text-center">Conf.</th>
              <th className="pb-2 pr-3 font-medium">Last Run</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name =
                [row.firstName, row.lastName].filter(Boolean).join(" ") ||
                row.fullNameRaw ||
                "—";
              const location = [row.municipality, row.county, row.state]
                .filter(Boolean)
                .join(", ");
              const isEnriching = enrichingRows.has(row.id);

              return (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 hover:bg-white transition-colors"
                >
                  <td className="py-2 pr-3 text-gray-400">#{row.id}</td>
                  <td className="py-2 pr-3 text-gray-900 font-medium">{name}</td>
                  <td className="py-2 pr-3 text-gray-500 max-w-xs truncate">
                    {[row.position, location].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-2 pr-3">{statusBadge(row.enrichmentStatus)}</td>
                  <td className="py-2 pr-3 text-center">
                    {row.email ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {row.phone ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-center text-gray-500">
                    {row.confidence != null
                      ? (row.confidence * 100).toFixed(0) + "%"
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-gray-400">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="py-2 flex gap-2">
                    <button
                      onClick={() => enrichRow(row.id)}
                      disabled={isEnriching}
                      className="px-2 py-1 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 disabled:opacity-40 rounded transition-colors"
                    >
                      {isEnriching ? "Running…" : "Enrich"}
                    </button>
                    <Link
                      href={`/rows/${row.id}`}
                      className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                    >
                      Details
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="text-center text-gray-400 py-12 text-sm">
            No draft rows for this submission.
          </div>
        )}
      </div>
    </div>
  );
}
