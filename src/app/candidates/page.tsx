"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  boolFilter,
  numberFilter,
  cells,
} from "@/components/DataTable";

interface CandidateRow {
  id: number;
  name: string;
  linkedin: string | null;
  hasPhoto: boolean;
  bioLength: number;
  clerkUserId: string | null;
  verified: boolean;
  hidden: boolean;
  slug: string;
  email: string | null;
  phone: string | null;
  currentRole: string | null;
  currentCity: string | null;
  currentState: string | null;
  inInstantly: boolean;
  profileViewsCount: number;
  electionPosition: string | null;
  followersCount: number;
  endorsementsCount: number;
  enrichmentStatus: string | null;
}

const columnHelper = createColumnHelper<CandidateRow>();

const columns: ColumnDef<CandidateRow, any>[] = [
  columnHelper.accessor("id", {
    header: "ID",
    size: 60,
    cell: (info) => (
      <Link
        href={`/candidates/${info.getValue()}`}
        className="text-amber-600 hover:underline"
      >
        #{info.getValue()}
      </Link>
    ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("name", {
    header: "Name",
    size: 180,
    cell: (info) => (
      <Link
        href={`/candidates/${info.row.original.id}`}
        className="text-gray-900 font-medium hover:text-amber-600"
      >
        {info.getValue()}
      </Link>
    ),
    filterFn: "includesString",
  }),
  columnHelper.accessor("linkedin", {
    header: "LinkedIn",
    size: 220,
    cell: (info) => cells.link(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("hasPhoto", {
    header: "Photo",
    size: 90,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("bioLength", {
    header: "Bio",
    size: 90,
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">0</span>
      ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("clerkUserId", {
    header: "Clerk ID",
    size: 140,
    cell: (info) => {
      const v = info.getValue();
      if (!v) return <span className="text-gray-300">—</span>;
      return (
        <span className="text-gray-400 font-mono text-[10px]" title={v}>
          {v.slice(0, 12)}…
        </span>
      );
    },
    filterFn: "includesString",
  }),
  columnHelper.accessor("verified", {
    header: "Verified",
    size: 90,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("hidden", {
    header: "Hidden",
    size: 90,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("slug", {
    header: "Slug",
    size: 160,
    cell: (info) => (
      <span className="text-gray-500 font-mono text-[10px]">{info.getValue()}</span>
    ),
    filterFn: "includesString",
  }),
  columnHelper.accessor("email", {
    header: "Email",
    size: 220,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("phone", {
    header: "Phone",
    size: 140,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("currentRole", {
    header: "Role",
    size: 200,
    cell: (info) => {
      const v = info.getValue();
      if (!v) return <span className="text-gray-300">—</span>;
      return (
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={v}>
          {v}
        </span>
      );
    },
    filterFn: "includesString",
  }),
  columnHelper.accessor("currentCity", {
    header: "City",
    size: 140,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("currentState", {
    header: "State",
    size: 110,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("inInstantly", {
    header: "Instantly",
    size: 110,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("profileViewsCount", {
    header: "Views",
    size: 100,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("electionPosition", {
    header: "Election",
    size: 240,
    cell: (info) => {
      const v = info.getValue();
      if (!v) return <span className="text-gray-300">—</span>;
      return (
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={v}>
          {v}
        </span>
      );
    },
    filterFn: "includesString",
  }),
  columnHelper.accessor("followersCount", {
    header: "Followers",
    size: 110,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("endorsementsCount", {
    header: "Endorsements",
    size: 130,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
];

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filteredRows, setFilteredRows] = useState<CandidateRow[]>([]);
  const [serverBatch, setServerBatch] = useState<{ running: boolean; total: number }>({
    running: false,
    total: 0,
  });
  const [localFetchInFlight, setLocalFetchInFlight] = useState(false);
  const isRunning = serverBatch.running || localFetchInFlight;
  const runningTotal = serverBatch.total;

  useEffect(() => {
    Promise.all([
      fetch("/api/candidates").then((r) => r.json()),
      fetch("/api/candidates/batch-enrich/status").then((r) => r.json()),
    ])
      .then(([data, status]) => {
        setCandidates(data);
        if (status?.running) {
          setServerBatch({ running: true, total: status.total ?? 0 });
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Poll while a batch is active so the table updates live and the cancel
  // button stays visible across reloads. Polls whenever the client thinks a
  // request is in flight OR the server reports an active batch.
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      try {
        const [data, status] = await Promise.all([
          fetch("/api/candidates").then((r) => r.json()),
          fetch("/api/candidates/batch-enrich/status").then((r) => r.json()),
        ]);
        setCandidates(data);
        setServerBatch({
          running: Boolean(status?.running),
          total: status?.total ?? 0,
        });
      } catch {
        // ignore transient errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const isPending = (c: CandidateRow) =>
    Boolean(c.enrichmentStatus) &&
    c.enrichmentStatus !== "result_saved" &&
    c.enrichmentStatus !== "failed";

  const visible = useMemo(() => {
    const filtered =
      statusFilter === "null"
        ? candidates.filter((c) => !c.enrichmentStatus)
        : statusFilter === "pending"
          ? candidates.filter(isPending)
          : statusFilter
            ? candidates.filter((c) => c.enrichmentStatus === statusFilter)
            : candidates;
    // Not-yet-enriched first, then pending, then completed/failed (id desc preserved within group).
    const rank = (c: CandidateRow) => {
      if (!c.enrichmentStatus) return 0;
      if (isPending(c)) return 1;
      return 2;
    };
    return [...filtered].sort((a, b) => rank(a) - rank(b));
  }, [candidates, statusFilter]);

  const handleFilteredRowsChange = useCallback((rows: CandidateRow[]) => {
    setFilteredRows(rows);
  }, []);

  const enrichFiltered = useCallback(async () => {
    if (isRunning) return;
    const targets = filteredRows.filter(
      (c) => c.enrichmentStatus !== "result_saved"
    );
    if (targets.length === 0) return;
    setLocalFetchInFlight(true);
    setServerBatch({ running: true, total: targets.length });
    try {
      await fetch("/api/candidates/batch-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: targets.map((c) => c.id) }),
      });
    } finally {
      setLocalFetchInFlight(false);
      const [data, status] = await Promise.all([
        fetch("/api/candidates").then((r) => r.json()),
        fetch("/api/candidates/batch-enrich/status").then((r) => r.json()),
      ]);
      setCandidates(data);
      setServerBatch({
        running: Boolean(status?.running),
        total: status?.total ?? 0,
      });
    }
  }, [filteredRows, isRunning]);

  const cancelEnrich = useCallback(async () => {
    await fetch("/api/candidates/batch-enrich/cancel", { method: "POST" });
  }, []);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  // Counts within the post-table-filter set so chips reflect what the user sees.
  const filteredNotEnriched = filteredRows.filter((c) => !c.enrichmentStatus).length;
  const filteredEligible = filteredRows.filter(
    (c) => c.enrichmentStatus !== "result_saved"
  ).length;
  const filteredComplete = filteredRows.filter(
    (c) => c.enrichmentStatus === "result_saved"
  ).length;
  const filteredPending = filteredRows.filter(isPending).length;
  const filteredFailed = filteredRows.filter(
    (c) => c.enrichmentStatus === "failed"
  ).length;

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100vh - 113px)" }}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Candidates</h1>
          <p className="text-gray-400 text-xs mt-1">
            {filteredRows.length.toLocaleString()} shown · {candidates.length.toLocaleString()} total
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={enrichFiltered}
            disabled={isRunning || filteredEligible === 0}
            className="text-xs px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
          >
            {isRunning
              ? `Enriching ${runningTotal || ""}…`
              : `Enrich filtered (${filteredEligible.toLocaleString()})`}
          </button>
          {isRunning && (
            <button
              onClick={cancelEnrich}
              className="text-xs px-3 py-2 bg-red-500 hover:bg-red-400 text-white font-bold rounded transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setStatusFilter(null)}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            statusFilter === null
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
          }`}
        >
          All ({filteredRows.length.toLocaleString()})
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "null" ? null : "null")}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            statusFilter === "null"
              ? "bg-gray-500 text-white border-gray-500"
              : "bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-400"
          }`}
        >
          Not Enriched ({filteredNotEnriched.toLocaleString()})
        </button>
        <button
          onClick={() =>
            setStatusFilter(statusFilter === "result_saved" ? null : "result_saved")
          }
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            statusFilter === "result_saved"
              ? "bg-green-500 text-white border-green-500"
              : "bg-green-50 text-green-700 border-green-200 hover:border-green-400"
          }`}
        >
          Complete ({filteredComplete.toLocaleString()})
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "pending" ? null : "pending")}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            statusFilter === "pending"
              ? "bg-blue-500 text-white border-blue-500"
              : "bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400"
          }`}
        >
          Pending ({filteredPending.toLocaleString()})
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === "failed" ? null : "failed")}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            statusFilter === "failed"
              ? "bg-red-500 text-white border-red-500"
              : "bg-red-50 text-red-600 border-red-200 hover:border-red-400"
          }`}
        >
          Failed ({filteredFailed.toLocaleString()})
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <DataTable
          data={visible}
          columns={columns}
          emptyMessage="No candidates match the current filters."
          virtualizeRows
          estimatedRowHeight={36}
          maxHeight="100%"
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      </div>
    </div>
  );
}
