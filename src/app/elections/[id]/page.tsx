"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DataTable, boolFilter, cells } from "@/components/DataTable";
import type { MatchAuditJson, TrackAudit } from "@/types/enrichment";
import { ENTITIES, type TrackIdFor } from "@/lib/enrichment/registry";
import type { PipelineModeFor } from "@/lib/enrichment/pipeline";

const ELECTION_TRACKS = ENTITIES.election.tracks;
type ElectionTrackId = TrackIdFor<"election">;
type Mode = PipelineModeFor<"election">;

const ACCENT_CLASSES: Record<string, { button: string; pill: string }> = {
  gray: {
    button: "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200",
    pill: "bg-gray-100 text-gray-500",
  },
  blue: {
    button: "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200",
    pill: "bg-blue-50 text-blue-600",
  },
  amber: {
    button: "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200",
    pill: "bg-amber-50 text-amber-700",
  },
  green: {
    button: "bg-green-50 hover:bg-green-100 text-green-700 border-green-200",
    pill: "bg-green-50 text-green-700",
  },
  purple: {
    button: "bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200",
    pill: "bg-purple-50 text-purple-600",
  },
};

function accentFor(trackId: string): { button: string; pill: string } {
  const t = ELECTION_TRACKS.find((tr) => tr.id === trackId);
  return ACCENT_CLASSES[t?.accent ?? "gray"] ?? ACCENT_CLASSES.gray;
}

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
  enrichmentRecord: {
    enrichmentStatus: string | null;
    matchAuditJson: MatchAuditJson | null;
    updatedAt: string;
  } | null;
  previewQueries?: Record<string, string>;
}

const STAGES = [
  "not_started",
  "search_queued",
  "search_running",
  "search_complete",
  "gemini_queued",
  "gemini_running",
  "gemini_complete",
  "result_saved",
] as const;

const STAGE_COLORS: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-500",
  search_queued: "bg-blue-50 text-blue-600",
  search_running: "bg-blue-200 text-blue-800 animate-pulse",
  search_complete: "bg-cyan-50 text-cyan-700",
  gemini_queued: "bg-purple-50 text-purple-600",
  gemini_running: "bg-purple-200 text-purple-800 animate-pulse",
  gemini_complete: "bg-indigo-50 text-indigo-700",
  result_saved: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  needs_review: "bg-amber-100 text-amber-700",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded mb-2 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-900 flex justify-between items-center"
      >
        <span>{title}</span>
        <span className="text-gray-300">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">{children}</div>
      )}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TextBlock({ value }: { value: string }) {
  return (
    <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap break-all">
      {value}
    </pre>
  );
}

function RankedSourceRow({
  source,
  rank,
  selected,
}: {
  source: { url: string; title: string; score: number; content: string };
  rank: number;
  selected: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-100 rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-xs px-2 py-1.5 hover:bg-gray-50 text-left"
      >
        <span className="text-gray-300 w-5 text-right shrink-0">{rank}</span>
        <span className="font-mono text-gray-500 w-10 shrink-0">{source.score.toFixed(2)}</span>
        <span className="text-gray-600 truncate flex-1">{source.url}</span>
        {selected && <span className="text-green-500 shrink-0 font-medium">✓</span>}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-400 hover:text-blue-600 shrink-0 px-1"
        >
          ↗
        </a>
        <span className="text-gray-300 shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100">
          <div className="text-xs text-amber-700 mb-1">{source.title}</div>
          <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {source.content || "(no content)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function PipelineStrip({ label, status }: { label: string; status: string }) {
  const isFailed = status === "failed";
  const stageIndex = STAGES.indexOf(status as (typeof STAGES)[number]);
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-1 flex-wrap">
        {STAGES.map((stage, i) => {
          const isActive = stage === status;
          const isPast = !isFailed && stageIndex > i;
          const cls = isActive
            ? STAGE_COLORS[stage] ?? "bg-gray-100 text-gray-500"
            : isPast
              ? "bg-gray-200 text-gray-600"
              : "bg-gray-100 text-gray-300";
          return (
            <div key={stage} className="flex items-center gap-1">
              <span className={`px-2 py-1 rounded text-xs ${cls} ${isActive ? "font-bold ring-1 ring-inset ring-current" : ""}`}>
                {stage.replace(/_/g, " ")}
              </span>
              {i < STAGES.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </div>
          );
        })}
        {isFailed && (
          <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-700 font-bold ring-1 ring-inset ring-red-300 ml-1">
            failed
          </span>
        )}
      </div>
    </div>
  );
}

function TrackArtifacts({
  audit,
  previewQuery,
}: {
  audit: TrackAudit;
  previewQuery?: string;
}) {
  const displayedQuery = audit.searchQuery ?? previewQuery;
  const isPreview = !audit.searchQuery && !!previewQuery;
  return (
    <div>
      {displayedQuery && (
        <Section title={isPreview ? "Search Query (preview)" : "Search Query"}>
          <TextBlock value={displayedQuery} />
        </Section>
      )}
      {audit.searchRawResponse !== undefined && (
        <Section title="Search Raw Response (Tavily)">
          <JsonBlock value={audit.searchRawResponse} />
        </Section>
      )}
      {audit.rankedSources && audit.rankedSources.length > 0 && (
        <Section title={`All Ranked Sources (${audit.rankedSources.length})`}>
          <div className="space-y-0.5">
            {audit.rankedSources.map((s, i) => (
              <RankedSourceRow key={i} source={s} rank={i + 1} selected={i < 5} />
            ))}
          </div>
        </Section>
      )}
      {audit.selectedSources && audit.selectedSources.length > 0 && (
        <Section title={`Selected Sources (${audit.selectedSources.length})`}>
          <div className="space-y-3">
            {audit.selectedSources.map((s, i) => (
              <div key={i} className="bg-gray-50 border border-gray-100 rounded p-3">
                <div className="text-xs text-amber-700 font-medium mb-1">{s.title}</div>
                <div className="text-xs text-blue-600 mb-2 break-all">{s.url}</div>
                <div className="text-xs text-gray-500 line-clamp-4">{s.content}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {audit.geminiPrompt && (
        <Section title="Gemini Prompt (Input)">
          <TextBlock value={audit.geminiPrompt} />
        </Section>
      )}
      {audit.geminiRawResponse && (
        <Section title="Gemini Raw Response">
          <TextBlock value={audit.geminiRawResponse} />
        </Section>
      )}
      {audit.parsedResult && (
        <Section title="Parsed Result">
          <JsonBlock value={audit.parsedResult} />
        </Section>
      )}
      {audit.finalSavedFields && (
        <Section title="Saved Fields">
          <JsonBlock value={audit.finalSavedFields} />
        </Section>
      )}
    </div>
  );
}

function TrackButtons({
  trackId,
  label,
  disabled,
  running,
  onRun,
  audit,
}: {
  trackId: ElectionTrackId;
  label: string;
  disabled: boolean;
  running: Mode | null;
  onRun: (mode: Mode) => void;
  audit: TrackAudit;
}) {
  const accent = accentFor(trackId).button;
  const hasSources = !!audit.selectedSources?.length;
  const hasParsed = !!audit.parsedResult;

  const searchKey = `${trackId}_search` as Mode;
  const geminiKey = `${trackId}_gemini` as Mode;
  const saveKey = `${trackId}_save` as Mode;
  const fullKey = `${trackId}_full` as Mode;

  return (
    <div className="flex flex-col gap-1 min-w-[8rem]">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium px-1">{label}</div>
      <button
        onClick={() => onRun(searchKey)}
        disabled={disabled}
        className={`text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed font-medium rounded border transition-colors ${accent}`}
      >
        {running === searchKey ? "Running..." : "Run Search"}
      </button>
      <button
        onClick={() => onRun(geminiKey)}
        disabled={disabled || !hasSources}
        title={!hasSources ? "Run Search first" : undefined}
        className="text-xs px-3 py-1.5 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed text-purple-700 font-medium rounded border border-purple-200 transition-colors"
      >
        {running === geminiKey ? "Running..." : "Run Gemini"}
      </button>
      <button
        onClick={() => onRun(saveKey)}
        disabled={disabled || !hasParsed}
        title={!hasParsed ? "Run Gemini first" : undefined}
        className="text-xs px-3 py-1.5 bg-green-50 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed text-green-700 font-medium rounded border border-green-200 transition-colors"
      >
        {running === saveKey ? "Saving..." : "Save"}
      </button>
      <button
        onClick={() => onRun(fullKey)}
        disabled={disabled}
        className="text-xs px-3 py-1.5 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed text-amber-700 font-medium rounded border border-amber-200 transition-colors"
      >
        {running === fullKey ? "Running..." : `Run All (${label})`}
      </button>
    </div>
  );
}

function emptyTrack(): TrackAudit {
  return { status: "not_started" };
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
  const [running, setRunning] = useState<Mode | null>(null);
  const [logSummary, setLogSummary] = useState<
    { apiType: string; calls: number; totalTokens: number | null; totalCostUsd: number | null }[]
  >([]);

  const load = useCallback(() => {
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
    fetch(`/api/logs/summary?rowId=${params.id}`)
      .then((r) => r.json())
      .then((data) => setLogSummary(data.summary ?? []))
      .catch(() => {});
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const runMode = useCallback(
    async (mode: Mode) => {
      setRunning(mode);
      try {
        await fetch(`/api/elections/${params.id}/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        load();
      } finally {
        setRunning(null);
      }
    },
    [params.id, load]
  );

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

  const audit = election.enrichmentRecord?.matchAuditJson ?? null;
  const trackAuditFor = (id: ElectionTrackId): TrackAudit =>
    (audit?.[id] as TrackAudit | undefined) ?? emptyTrack();
  const isRunning = running !== null;

  const regionLabel = election.mapRegionLink?.region.label ?? election.city;
  const hasFilingAuthority =
    election.filingAuthorityId ||
    election.filingAuthorityName ||
    election.filingAuthorityKey ||
    election.filingAuthorityLevel ||
    election.filingAuthorityType;

  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/elections" className="hover:text-gray-600">Elections</Link>
        {" / "}
        {election.position}
      </div>

      <div className="mb-6 flex items-start justify-between gap-6">
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
          <div className="text-[10px] text-gray-400 font-mono mt-2">#{election.id}</div>
        </div>

        <div className="flex gap-3 items-stretch">
          {ELECTION_TRACKS.map((t) => (
            <TrackButtons
              key={t.id}
              trackId={t.id as ElectionTrackId}
              label={t.label}
              disabled={isRunning}
              running={running}
              onRun={runMode}
              audit={trackAuditFor(t.id as ElectionTrackId)}
            />
          ))}
          <button
            onClick={() => runMode("full")}
            disabled={isRunning}
            className="text-xs px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
          >
            {running === "full" ? "Running..." : "Run Full"}
          </button>
        </div>
      </div>

      <div className="mb-6 space-y-3">
        {ELECTION_TRACKS.map((t) => (
          <PipelineStrip
            key={t.id}
            label={`Pipeline — ${t.label}`}
            status={trackAuditFor(t.id as ElectionTrackId).status}
          />
        ))}
        {audit && (audit.startedAt || audit.completedAt || audit.runId) && (
          <div className="text-xs text-gray-400 flex gap-4">
            {audit.startedAt && <span>Started: {new Date(audit.startedAt).toLocaleString()}</span>}
            {audit.completedAt && <span>Completed: {new Date(audit.completedAt).toLocaleString()}</span>}
            {audit.runId && <span>Run: {audit.runId}</span>}
          </div>
        )}
      </div>

      {logSummary.length > 0 && (
        <div className="mb-4 flex gap-3">
          {logSummary.map((s) => (
            <div key={s.apiType} className="bg-white border border-gray-200 rounded p-3 flex-1">
              <div className="text-xs text-gray-400 mb-1 capitalize">{s.apiType}</div>
              <div className="text-sm text-gray-900 font-medium">
                {s.calls} call{s.calls !== 1 ? "s" : ""}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {s.totalTokens != null && <span>{s.totalTokens.toLocaleString()} tokens · </span>}
                {s.totalCostUsd != null && <span>${s.totalCostUsd.toFixed(4)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

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
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{election.description}</p>
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

      <div className="mt-6">
        <div className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">
          Pipeline Artifacts
        </div>
        <div
          className={`grid gap-4 ${
            ELECTION_TRACKS.length >= 3
              ? "grid-cols-1 lg:grid-cols-3"
              : ELECTION_TRACKS.length >= 2
                ? "grid-cols-1 lg:grid-cols-2"
                : "grid-cols-1"
          }`}
        >
          {ELECTION_TRACKS.map((t) => (
            <div key={t.id}>
              <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">
                {t.label}
              </div>
              <TrackArtifacts
                audit={trackAuditFor(t.id as ElectionTrackId)}
                previewQuery={election.previewQueries?.[t.id]}
              />
            </div>
          ))}
        </div>

        {audit?.errors && audit.errors.length > 0 && (
          <div className="mt-4">
            <Section title={`Errors (${audit.errors.length})`}>
              <div className="space-y-1">
                {audit.errors.map((e, i) => (
                  <div
                    key={i}
                    className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2"
                  >
                    {e.timestamp && (
                      <div className="text-red-400 mb-0.5 flex items-center gap-2">
                        <span>{new Date(e.timestamp).toLocaleString()}</span>
                        {e.track && (
                          <span
                            className={`px-1.5 py-0.5 rounded font-medium ${accentFor(e.track).pill}`}
                          >
                            {e.track}
                          </span>
                        )}
                      </div>
                    )}
                    {e.message}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {!audit && !Object.keys(election.previewQueries ?? {}).length && (
          <div className="text-xs text-gray-400 py-8 text-center">
            No pipeline run yet. Click Run Full to start.
          </div>
        )}
      </div>
    </div>
  );
}
