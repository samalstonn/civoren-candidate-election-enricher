"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable, numberFilter, cells } from "@/components/DataTable";

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

interface SubmissionRow {
  id: number;
  sourceType: string;
  targetState: string | null;
  countyOrAuthority: string;
  defaultYear: string | null;
  receivedAt: string;
  total: number;
  notStarted: number;
  running: number;
  complete: number;
  failed: number;
  needsReview: number;
}

const columnHelper = createColumnHelper<SubmissionRow>();

const columns: ColumnDef<SubmissionRow, any>[] = [
  columnHelper.accessor("id", {
    header: "ID",
    cell: (info) => (
      <Link href={`/intake/${info.getValue()}`} className="text-amber-600 hover:underline">
        #{info.getValue()}
      </Link>
    ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("sourceType", {
    header: "Source",
    cell: (info) => <span className="text-gray-700">{info.getValue()}</span>,
    filterFn: "includesString",
  }),
  columnHelper.accessor("targetState", {
    header: "State",
    cell: (info) => <span className="text-gray-700">{cells.nullable(info.getValue())}</span>,
    filterFn: "includesString",
  }),
  columnHelper.accessor("countyOrAuthority", {
    header: "County / Authority",
    cell: (info) => (
      <span className="max-w-xs truncate inline-block align-bottom">
        {info.getValue() || <span className="text-gray-300">—</span>}
      </span>
    ),
    filterFn: "includesString",
  }),
  columnHelper.accessor("defaultYear", {
    header: "Year",
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("receivedAt", {
    header: "Received",
    cell: (info) => (
      <span className="text-gray-400">
        {new Date(info.getValue()).toLocaleDateString()}
      </span>
    ),
    enableColumnFilter: false,
    sortingFn: "datetime",
  }),
  columnHelper.accessor("total", {
    header: "Total",
    cell: (info) => <span className="text-gray-700 tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("notStarted", {
    header: "Not Started",
    cell: (info) => <span className="text-gray-400 tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("running", {
    header: "Running",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="text-blue-600 tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("complete", {
    header: "Complete",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="text-green-600 tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("failed", {
    header: "Failed",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="text-red-500 tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("needsReview", {
    header: "Review",
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="text-amber-600 tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
    filterFn: numberFilter,
  }),
];

export default function IntakePage() {
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

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  const rows: SubmissionRow[] = submissions.map((s) => ({
    id: s.id,
    sourceType: s.sourceType,
    targetState: s.targetState,
    countyOrAuthority: s.targetCounty
      ? `${s.targetCounty} County`
      : s.targetAuthorityName ?? "",
    defaultYear: s.defaultYear,
    receivedAt: s.receivedAt,
    total: s.counts.total,
    notStarted: s.counts.not_started,
    running: s.counts.running,
    complete: s.counts.complete,
    failed: s.counts.failed,
    needsReview: s.counts.needs_review,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">CRM Intake</h1>
        <p className="text-gray-400 text-xs mt-1">{submissions.length} total</p>
      </div>

      <DataTable data={rows} columns={columns} emptyMessage="No submissions found." />
    </div>
  );
}
