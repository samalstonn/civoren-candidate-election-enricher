"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  boolFilter,
  numberFilter,
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
    filterFn: "includesString",
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

export default function ElectionsPage() {
  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState(0);

  useEffect(() => {
    fetch("/api/elections")
      .then((r) => r.json())
      .then((data: ElectionRow[]) => {
        setElections(data);
        setFilteredCount(data.length);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 113px)" }}>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-gray-900">Elections</h1>
        <p className="text-gray-400 text-xs mt-1">
          {filteredCount.toLocaleString()} shown ·{" "}
          {elections.length.toLocaleString()} total
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <DataTable
          data={elections}
          columns={columns}
          emptyMessage="No elections match the current filters."
          virtualizeRows
          estimatedRowHeight={36}
          maxHeight="100%"
          onFilteredRowsChange={(rows) => setFilteredCount(rows.length)}
        />
      </div>
    </div>
  );
}
