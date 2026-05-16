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

const ENRICH_CONCURRENCY = 3;

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filteredRows, setFilteredRows] = useState<CandidateRow[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<{
    running: boolean;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });

  useEffect(() => {
    fetch("/api/candidates")
      .then((r) => r.json())
      .then((data) => {
        setCandidates(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const visible = useMemo(() => {
    if (statusFilter === "null") return candidates.filter((c) => !c.enrichmentStatus);
    if (statusFilter)
      return candidates.filter((c) => c.enrichmentStatus === statusFilter);
    return candidates;
  }, [candidates, statusFilter]);

  const handleFilteredRowsChange = useCallback((rows: CandidateRow[]) => {
    setFilteredRows(rows);
  }, []);

  const enrichFiltered = useCallback(async () => {
    if (enrichProgress.running) return;
    const targets = filteredRows.filter((c) => !c.enrichmentStatus);
    if (targets.length === 0) return;
    setEnrichProgress({ running: true, done: 0, total: targets.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const idx = cursor++;
        const c = targets[idx];
        try {
          await fetch(`/api/candidates/${c.id}/enrich`, { method: "POST" });
        } catch {
          // swallow per-candidate failure; status will reflect failure on next load
        }
        done++;
        setEnrichProgress({ running: true, done, total: targets.length });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, worker)
    );
    setEnrichProgress({ running: false, done: 0, total: 0 });
    const res = await fetch("/api/candidates");
    if (res.ok) setCandidates(await res.json());
  }, [filteredRows, enrichProgress.running]);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  // Counts within the post-table-filter set so chips reflect what the user sees.
  const filteredNotEnriched = filteredRows.filter((c) => !c.enrichmentStatus).length;
  const filteredComplete = filteredRows.filter(
    (c) => c.enrichmentStatus === "result_saved"
  ).length;
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
        <button
          onClick={enrichFiltered}
          disabled={enrichProgress.running || filteredNotEnriched === 0}
          className="text-xs px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
        >
          {enrichProgress.running
            ? `Enriching ${enrichProgress.done}/${enrichProgress.total}…`
            : `Enrich filtered (${filteredNotEnriched.toLocaleString()})`}
        </button>
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
