"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable, boolFilter, cells } from "@/components/DataTable";

interface Region {
  id: number;
  label: string;
  stateCode: string;
  regionType: string;
  regionCode: string;
}

interface ElectionCandidateRow {
  id: number;
  name: string;
  slug: string;
  party: string | null;
  verified: boolean;
  email: string | null;
  phone: string | null;
  currentCity: string | null;
  currentState: string | null;
  linkedin: string | null;
  website: string | null;
  joinedAt: string;
}

interface ElectionDetail {
  id: number;
  position: string;
  date: string;
  active: boolean;
  hidden: boolean;
  called: boolean;
  city: string;
  state: string;
  type: string;
  cycle: string;
  positions: number;
  description: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: string;
  filingAuthorityId: number | null;
  filingAuthorityKey: string | null;
  filingAuthorityLevel: string | null;
  filingAuthorityType: string | null;
  filingAuthorityName: string | null;
  canonicalOfficeKey: string | null;
  canonicalStateRoute: string | null;
  canonicalCategory: string | null;
  canonicalBranch: string | null;
  officeSlug: string | null;
  sourceType: string;
  sourceConfidence: string;
  sourceCapturedAt: string | null;
  lastNormalizedAt: string | null;
  mapRegionLink: { region: Region } | null;
  candidates: {
    joinedAt: string;
    party: string | null;
    votinglink: string | null;
    candidate: {
      id: number;
      name: string;
      slug: string;
      verified: boolean;
      email: string | null;
      phone: string | null;
      currentCity: string | null;
      currentState: string | null;
      linkedin: string | null;
      website: string | null;
    };
  }[];
}

const columnHelper = createColumnHelper<ElectionCandidateRow>();

const candidateColumns: ColumnDef<ElectionCandidateRow, any>[] = [
  columnHelper.accessor("id", {
    header: "ID",
    size: 70,
    cell: (info) => (
      <Link href={`/candidates/${info.getValue()}`} className="text-amber-600 hover:underline">
        #{info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("name", {
    header: "Name",
    size: 200,
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
  columnHelper.accessor("party", {
    header: "Party",
    size: 120,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("verified", {
    header: "Verified",
    size: 90,
    cell: (info) => cells.bool(info.getValue()),
    filterFn: boolFilter,
  }),
  columnHelper.accessor("email", {
    header: "Email",
    size: 200,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("phone", {
    header: "Phone",
    size: 130,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("currentCity", {
    header: "City",
    size: 130,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("currentState", {
    header: "State",
    size: 90,
    cell: (info) => cells.nullable(info.getValue()),
    filterFn: "includesString",
  }),
  columnHelper.accessor("joinedAt", {
    header: "Joined",
    size: 110,
    cell: (info) => (
      <span className="tabular-nums text-gray-500">{info.getValue().slice(0, 10)}</span>
    ),
  }),
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-0.5">
        {label}
      </div>
      <div className="text-sm text-gray-800">
        {value === null || value === undefined || value === "" ? (
          <span className="text-gray-300">—</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded p-4 mb-4">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ElectionDetailPage() {
  const params = useParams<{ id: string }>();
  const [election, setElection] = useState<ElectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/elections/${params.id}`)
      .then(async (r) => {
        if (r.status === 404) {
          setError("Not found");
          setLoading(false);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as ElectionDetail;
        setElection(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [params.id]);

  const candidateRows: ElectionCandidateRow[] = useMemo(() => {
    if (!election) return [];
    return election.candidates.map((l) => ({
      id: l.candidate.id,
      name: l.candidate.name,
      slug: l.candidate.slug,
      party: l.party,
      verified: l.candidate.verified,
      email: l.candidate.email,
      phone: l.candidate.phone,
      currentCity: l.candidate.currentCity,
      currentState: l.candidate.currentState,
      linkedin: l.candidate.linkedin,
      website: l.candidate.website,
      joinedAt: l.joinedAt,
    }));
  }, [election]);

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error === "Not found")
    return (
      <div>
        <Link href="/elections" className="text-xs text-amber-600 hover:underline">
          ← Elections
        </Link>
        <div className="mt-6 text-gray-500 text-sm">Election not found.</div>
      </div>
    );
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;
  if (!election) return null;

  const regionLabel = election.mapRegionLink?.region.label ?? election.city;
  const hasFilingAuthority =
    election.filingAuthorityId ||
    election.filingAuthorityName ||
    election.filingAuthorityKey ||
    election.filingAuthorityLevel ||
    election.filingAuthorityType;

  return (
    <div>
      <Link href="/elections" className="text-xs text-amber-600 hover:underline">
        ← Elections
      </Link>

      <div className="mt-3 mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{election.position}</h1>
          <p className="text-xs text-gray-500 mt-1">
            {regionLabel}, {election.state} · {election.date.slice(0, 10)}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
              {election.type}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
              {election.cycle}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                election.active
                  ? "bg-green-50 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {election.active ? "active" : "inactive"}
            </span>
            {election.hidden && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                hidden
              </span>
            )}
            {election.called && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                called
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-gray-400 font-mono">#{election.id}</div>
      </div>

      <Card title="Overview">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="ID" value={election.id} />
          <Field label="Positions (seats)" value={election.positions} />
          <Field label="Uploaded by" value={election.uploadedBy} />
          <Field label="Updated" value={election.updatedAt.slice(0, 10)} />
        </div>
      </Card>

      <Card title="Description">
        {election.description ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {election.description}
          </p>
        ) : (
          <span className="text-gray-300 text-sm">—</span>
        )}
      </Card>

      {election.mapRegionLink && (
        <Card title="Region">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Label" value={election.mapRegionLink.region.label} />
            <Field label="State" value={election.mapRegionLink.region.stateCode} />
            <Field label="Type" value={election.mapRegionLink.region.regionType} />
            <Field label="Code" value={election.mapRegionLink.region.regionCode} />
          </div>
        </Card>
      )}

      {hasFilingAuthority && (
        <Card title="Filing authority">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Name" value={election.filingAuthorityName} />
            <Field label="Level" value={election.filingAuthorityLevel} />
            <Field label="Type" value={election.filingAuthorityType} />
            <Field label="Key" value={election.filingAuthorityKey} />
            <Field label="ID" value={election.filingAuthorityId} />
          </div>
        </Card>
      )}

      <details className="bg-white border border-gray-200 rounded mb-4">
        <summary className="cursor-pointer px-4 py-3 text-xs text-gray-400 uppercase tracking-wider font-medium hover:text-gray-600">
          Canonical / source
        </summary>
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="canonicalOfficeKey" value={election.canonicalOfficeKey} />
          <Field label="canonicalStateRoute" value={election.canonicalStateRoute} />
          <Field label="canonicalCategory" value={election.canonicalCategory} />
          <Field label="canonicalBranch" value={election.canonicalBranch} />
          <Field label="officeSlug" value={election.officeSlug} />
          <Field label="sourceType" value={election.sourceType} />
          <Field label="sourceConfidence" value={election.sourceConfidence} />
          <Field
            label="sourceCapturedAt"
            value={election.sourceCapturedAt?.slice(0, 10) ?? null}
          />
          <Field
            label="lastNormalizedAt"
            value={election.lastNormalizedAt?.slice(0, 10) ?? null}
          />
        </div>
      </details>

      <Card title={`Candidates (${candidateRows.length})`}>
        {candidateRows.length === 0 ? (
          <div className="text-gray-400 text-sm">
            No candidates linked to this election yet.
          </div>
        ) : (
          <DataTable
            data={candidateRows}
            columns={candidateColumns}
            emptyMessage="No candidates match the current filters."
          />
        )}
      </Card>
    </div>
  );
}
