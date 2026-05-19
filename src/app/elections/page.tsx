"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  boolFilter,
  numberFilter,
  selectFilter,
  cells,
} from "@/components/DataTable";

interface ElectionRow {
  id: number;
  position: string;
  cycle: string;
  date: string;
  active: boolean;
  candidatesCount: number;
  verifiedCandidatesCount: number;
  descriptionLength: number;
  positions: number;
  city: string;
  state: string;
  type: string;
  regionLabel: string | null;
  enrichmentStatus: string | null;
}

const columnHelper = createColumnHelper<ElectionRow>();

const columns: ColumnDef<ElectionRow, any>[] = [
  columnHelper.accessor("id", {
    header: "ID",
    size: 70,
    cell: (info) => (
      <Link
        href={`/elections/${info.getValue()}`}
        className="text-amber-600 hover:underline"
      >
        #{info.getValue()}
      </Link>
    ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("position", {
    header: "Position",
    size: 240,
    cell: (info) => {
      const v = info.getValue();
      return (
        <Link
          href={`/elections/${info.row.original.id}`}
          className="text-gray-900 font-medium hover:text-amber-600 block overflow-hidden text-ellipsis whitespace-nowrap"
          title={v}
        >
          {v}
        </Link>
      );
    },
    filterFn: "includesString",
  }),
  columnHelper.accessor("cycle", {
    header: "Cycle",
    size: 120,
    cell: (info) => <span className="text-gray-700">{info.getValue()}</span>,
    filterFn: "includesString",
  }),
  columnHelper.accessor("date", {
    header: "Date",
    size: 110,
    cell: (info) => (
      <span className="tabular-nums text-gray-700">
        {info.getValue().slice(0, 10)}
      </span>
    ),
    filterFn: "includesString",
  }),
  columnHelper.accessor("active", {
    header: "Active",
    size: 80,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("candidatesCount", {
    header: "Candidates",
    size: 110,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("verifiedCandidatesCount", {
    header: "Verified",
    size: 100,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("descriptionLength", {
    header: "Description",
    size: 110,
    cell: (info) =>
      info.getValue() > 0 ? (
        <span className="tabular-nums">{info.getValue()}</span>
      ) : (
        <span className="text-gray-300">0</span>
      ),
    filterFn: numberFilter,
  }),
  columnHelper.accessor("positions", {
    header: "Positions",
    size: 100,
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
    filterFn: numberFilter,
  }),
  columnHelper.accessor("city", {
    header: "City",
    size: 140,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("state", {
    header: "State",
    size: 90,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: selectFilter,
  }),
  columnHelper.accessor("type", {
    header: "Type",
    size: 140,
    cell: (info) => <span className="text-gray-700">{info.getValue()}</span>,
    filterFn: "includesString",
  }),
  columnHelper.accessor("regionLabel", {
    header: "Region",
    size: 200,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
];

const ENRICH_CONCURRENCY = 3;

export default function ElectionsPage() {
  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [filteredRows, setFilteredRows] = useState<ElectionRow[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<{
    running: boolean;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });

  useEffect(() => {
    fetch("/api/elections")
      .then((r) => r.json())
      .then((data: ElectionRow[]) => {
        setElections(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const visible = useMemo(() => {
    if (statusFilter === "null") return elections.filter((e) => !e.enrichmentStatus);
    if (statusFilter) return elections.filter((e) => e.enrichmentStatus === statusFilter);
    return elections;
  }, [elections, statusFilter]);

  const handleFilteredRowsChange = useCallback((rows: ElectionRow[]) => {
    setFilteredRows(rows);
  }, []);

  const enrichFiltered = useCallback(async () => {
    if (enrichProgress.running) return;
    const targets = filteredRows.filter((e) => !e.enrichmentStatus);
    if (targets.length === 0) return;
    setEnrichProgress({ running: true, done: 0, total: targets.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const idx = cursor++;
        const e = targets[idx];
        try {
          await fetch(`/api/elections/${e.id}/enrich`, { method: "POST" });
        } catch {
          // swallow per-election failure; status reflects failure on next load
        }
        done++;
        setEnrichProgress({ running: true, done, total: targets.length });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, worker)
    );
    setEnrichProgress({ running: false, done: 0, total: 0 });
    const res = await fetch("/api/elections");
    if (res.ok) setElections(await res.json());
  }, [filteredRows, enrichProgress.running]);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  const filteredNotEnriched = filteredRows.filter((e) => !e.enrichmentStatus).length;
  const filteredComplete = filteredRows.filter(
    (e) => e.enrichmentStatus === "result_saved"
  ).length;
  const filteredFailed = filteredRows.filter(
    (e) => e.enrichmentStatus === "failed"
  ).length;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 113px)" }}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Elections</h1>
          <p className="text-gray-400 text-xs mt-1">
            {filteredRows.length.toLocaleString()} shown ·{" "}
            {elections.length.toLocaleString()} total
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
          emptyMessage="No elections match the current filters."
          virtualizeRows
          estimatedRowHeight={36}
          maxHeight="100%"
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      </div>
    </div>
  );
}
