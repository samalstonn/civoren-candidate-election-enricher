"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SubmissionCounts {
  total: number;
  not_started: number;
  running: number;
  complete: number;
  failed: number;
  needs_review: number;
}

interface Submission {
  id: number;
  sourceType: string;
  status: string;
  targetState: string | null;
  targetCounty: string | null;
  targetScope: string | null;
  targetAuthorityName: string | null;
  defaultYear: string | null;
  receivedAt: string;
  sheetDescription: string | null;
  counts: SubmissionCounts;
}

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((data) => {
        setSubmissions(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-gray-400 text-sm">Loading submissions...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">Submissions</h1>
        <p className="text-gray-400 text-xs mt-1">{submissions.length} total</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-400 text-left">
              <th className="pb-2 pr-4 font-medium">ID</th>
              <th className="pb-2 pr-4 font-medium">Source</th>
              <th className="pb-2 pr-4 font-medium">State</th>
              <th className="pb-2 pr-4 font-medium">County / Authority</th>
              <th className="pb-2 pr-4 font-medium">Year</th>
              <th className="pb-2 pr-4 font-medium">Received</th>
              <th className="pb-2 pr-4 font-medium text-center">Total</th>
              <th className="pb-2 pr-4 font-medium text-center">Not Started</th>
              <th className="pb-2 pr-4 font-medium text-center">Running</th>
              <th className="pb-2 pr-4 font-medium text-center">Complete</th>
              <th className="pb-2 pr-4 font-medium text-center">Failed</th>
              <th className="pb-2 pr-4 font-medium text-center">Review</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr
                key={s.id}
                className="border-b border-gray-100 hover:bg-white transition-colors"
              >
                <td className="py-2 pr-4">
                  <Link
                    href={`/submissions/${s.id}`}
                    className="text-amber-600 hover:underline"
                  >
                    #{s.id}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-gray-700">{s.sourceType}</td>
                <td className="py-2 pr-4 text-gray-700">{s.targetState ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-500 max-w-xs truncate">
                  {s.targetCounty
                    ? `${s.targetCounty} County`
                    : s.targetAuthorityName ?? "—"}
                </td>
                <td className="py-2 pr-4 text-gray-500">{s.defaultYear ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-400">
                  {new Date(s.receivedAt).toLocaleDateString()}
                </td>
                <td className="py-2 pr-4 text-center text-gray-700">{s.counts.total}</td>
                <td className="py-2 pr-4 text-center text-gray-400">
                  {s.counts.not_started}
                </td>
                <td className="py-2 pr-4 text-center text-blue-600">
                  {s.counts.running > 0 ? s.counts.running : "—"}
                </td>
                <td className="py-2 pr-4 text-center text-green-600">
                  {s.counts.complete > 0 ? s.counts.complete : "—"}
                </td>
                <td className="py-2 pr-4 text-center text-red-500">
                  {s.counts.failed > 0 ? s.counts.failed : "—"}
                </td>
                <td className="py-2 pr-4 text-center text-amber-600">
                  {s.counts.needs_review > 0 ? s.counts.needs_review : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {submissions.length === 0 && (
          <div className="text-center text-gray-400 py-12 text-sm">
            No submissions found.
          </div>
        )}
      </div>
    </div>
  );
}
