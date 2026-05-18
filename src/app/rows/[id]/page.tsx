"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { MatchAuditJson, TrackAudit } from "@/types/enrichment";
import { ENTITIES, type TrackIdFor } from "@/lib/enrichment/registry";
import type { PipelineModeFor } from "@/lib/enrichment/pipeline";

type CandidateTrackId = TrackIdFor<"candidate">;
type Mode = PipelineModeFor<"candidate"> | "search" | "search_general" | "search_contact" | "gemini" | "save";
const CANDIDATE_TRACKS = ENTITIES.candidate.tracks;

const ACCENT_CLASSES: Record<string, { button: string; pill: string }> = {
  gray: {
    button: "bg-gray-50 hover:bg-gray-100 text-gray-500 border-gray-200",
    pill: "bg-gray-100 text-gray-500",
  },
  blue: {
    button: "bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200",
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
  const t = CANDIDATE_TRACKS.find((tr) => tr.id === trackId);
  return ACCENT_CLASSES[t?.accent ?? "gray"] ?? ACCENT_CLASSES.gray;
}

interface Row {
  id: number;
  submissionId: number;
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
  matchAuditJson: MatchAuditJson | null;
  reviewerNotes: string | null;
  updatedAt: string;
  previewQueries?: Record<string, string>;
  submission: {
    id: number;
    targetState: string | null;
    targetCounty: string | null;
    targetAuthorityName: string | null;
    defaultYear: string | null;
  };
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
          title="Open in new tab"
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

function TextBlock({ value }: { value: string }) {
  return (
    <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap break-all">
      {value}
    </pre>
  );
}

export default function RowDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Mode | null>(null);
  const [logSummary, setLogSummary] = useState<{ apiType: string; calls: number; totalTokens: number | null; totalCostUsd: number | null }[]>([]);

  const load = useCallback(() => {
    fetch(`/api/rows/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setRow(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    fetch(`/api/logs/summary?rowId=${params.id}`)
      .then((r) => r.json())
      .then((data) => setLogSummary(data.summary ?? []));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function runMode(mode: Mode) {
    setRunning(mode);
    try {
      await fetch(`/api/rows/${params.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      load();
    } finally {
      setRunning(null);
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-500 text-sm">Error: {error}</div>;
  if (!row) return null;

  const audit = row.matchAuditJson;
  const trackAuditFor = (id: CandidateTrackId): TrackAudit | undefined =>
    audit?.[id] as TrackAudit | undefined;
  const anyHasSources = CANDIDATE_TRACKS.some(
    (t) => (trackAuditFor(t.id as CandidateTrackId)?.selectedSources?.length ?? 0) > 0
  );
  const anyHasParsed = CANDIDATE_TRACKS.some(
    (t) => !!trackAuditFor(t.id as CandidateTrackId)?.parsedResult
  );
  // Intake page surfaces "general" fields as the primary saved values.
  const generalParsed = trackAuditFor("general" as CandidateTrackId)?.parsedResult as
    | {
        biography?: string;
        currentRole?: string | null;
        currentCity?: string | null;
      }
    | undefined;
  const name =
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    row.fullNameRaw ||
    "Unknown";
  const currentStatus = row.enrichmentStatus ?? "not_started";
  const isFailed = currentStatus === "failed";
  const isRunning = running !== null;

  const stageIndex = STAGES.indexOf(currentStatus as (typeof STAGES)[number]);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/intake" className="hover:text-gray-600">Pending Candidates</Link>
        {" / "}
        <Link href={`/intake/${row.submissionId}`} className="hover:text-gray-600">
          #{row.submissionId}
        </Link>
        {" / "}
        Row #{row.id}
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{name}</h1>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            {row.position && <div>{row.position}</div>}
            <div>
              {[row.municipality, row.county, row.state].filter(Boolean).join(", ") || "—"}
              {row.year ? ` · ${row.year}` : ""}
            </div>
            <div>
              Row #{row.id} · Submission #{row.submissionId} ·
              Updated {new Date(row.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2 flex-wrap justify-end">
            {/* Per-track "Run Search" buttons, generated from the registry */}
            <div className="flex flex-col gap-1">
              <button
                onClick={() => runMode("search")}
                disabled={isRunning}
                className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 font-medium rounded border border-gray-200 transition-colors"
              >
                {running === "search" ? "Running..." : "Run Search (All)"}
              </button>
              <div className="flex gap-1">
                {CANDIDATE_TRACKS.map((t) => {
                  const modeKey = `${t.id}_search` as Mode;
                  return (
                    <button
                      key={t.id}
                      onClick={() => runMode(modeKey)}
                      disabled={isRunning}
                      className={`text-xs px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed font-medium rounded border transition-colors flex-1 ${accentFor(t.id).button}`}
                    >
                      {running === modeKey ? "Running..." : t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => runMode("gemini")}
              disabled={isRunning || !anyHasSources}
              title={!anyHasSources ? "Run Search first" : undefined}
              className="text-xs px-3 py-2 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed text-purple-700 font-medium rounded border border-purple-200 transition-colors"
            >
              {running === "gemini" ? "Running..." : "Run Gemini"}
            </button>
            <button
              onClick={() => runMode("save")}
              disabled={isRunning || !anyHasParsed}
              title={!anyHasParsed ? "Run Gemini first" : undefined}
              className="text-xs px-3 py-2 bg-green-50 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed text-green-700 font-medium rounded border border-green-200 transition-colors"
            >
              {running === "save" ? "Saving..." : "Save Result"}
            </button>
            <button
              onClick={() => runMode("full")}
              disabled={isRunning}
              className="text-xs px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
            >
              {running === "full" ? "Running..." : "Run Full"}
            </button>
          </div>
        </div>
      </div>

      {/* Pipeline Timeline */}
      <div className="mb-6">
        <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">
          Pipeline
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {STAGES.map((stage, i) => {
            const isActive = stage === currentStatus;
            const isPast = !isFailed && stageIndex > i;
            const cls = isActive
              ? STAGE_COLORS[stage] ?? "bg-gray-100 text-gray-500"
              : isPast
                ? "bg-gray-200 text-gray-600"
                : "bg-gray-100 text-gray-300";
            return (
              <div key={stage} className="flex items-center gap-1">
                <span
                  className={`px-2 py-1 rounded text-xs ${cls} ${isActive ? "font-bold ring-1 ring-inset ring-current" : ""
                    }`}
                >
                  {stage.replace(/_/g, " ")}
                </span>
                {i < STAGES.length - 1 && (
                  <span className="text-gray-300 text-xs">→</span>
                )}
              </div>
            );
          })}
          {isFailed && (
            <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-700 font-bold ring-1 ring-inset ring-red-300 ml-1">
              failed
            </span>
          )}
        </div>

        {/* Timestamps */}
        {audit && (
          <div className="mt-2 text-xs text-gray-400 flex gap-4">
            {audit.startedAt && (
              <span>Started: {new Date(audit.startedAt).toLocaleString()}</span>
            )}
            {audit.completedAt && (
              <span>Completed: {new Date(audit.completedAt).toLocaleString()}</span>
            )}
            {audit.runId && <span>Run: {audit.runId}</span>}
          </div>
        )}
      </div>

      {/* Saved Data */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Email", value: row.email },
          { label: "Phone", value: row.phone },
          {
            label: "Confidence",
            value:
              row.confidence != null
                ? (row.confidence * 100).toFixed(0) + "%"
                : null,
          },
          { label: "Status", value: row.enrichmentStatus },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className="text-sm text-gray-900">{value ?? "—"}</div>
          </div>
        ))}
      </div>

      {row.reviewerNotes && (
        <div className="mb-4 bg-white border border-gray-200 rounded p-3">
          <div className="text-xs text-gray-400 mb-1">Notes / Biography</div>
          <div className="text-xs text-gray-700 whitespace-pre-wrap">
            {row.reviewerNotes}
          </div>
        </div>
      )}

      {(generalParsed?.currentRole || row.position || generalParsed?.currentCity || row.state) && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {(generalParsed?.currentRole || row.position) && (
            <div className="bg-white border border-gray-200 rounded p-3">
              <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
                Current Role
                {!generalParsed?.currentRole && row.position && (
                  <span className="text-gray-300 font-normal">(position fallback)</span>
                )}
              </div>
              <div className="text-sm text-gray-900">
                {generalParsed?.currentRole ?? `Candidate for ${row.position}`}
              </div>
            </div>
          )}
          {(generalParsed?.currentCity || row.state) && (
            <div className="bg-white border border-gray-200 rounded p-3">
              <div className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
                Location
                {!generalParsed?.currentCity && row.state && (
                  <span className="text-gray-300 font-normal">(state fallback)</span>
                )}
              </div>
              <div className="text-sm text-gray-900">
                {generalParsed?.currentCity ?? row.state}
              </div>
            </div>
          )}
        </div>
      )}

      {/* API Usage Summary */}
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

      {/* Debug Sections */}
      <div className="mt-6">
        <div className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">
          Pipeline Artifacts
        </div>

        {/* Combined "Search Queries" section — shows the persisted value when
            the pipeline has run, otherwise the deterministic preview from the
            adapter (computed server-side). */}
        {CANDIDATE_TRACKS.some(
          (t) =>
            trackAuditFor(t.id as CandidateTrackId)?.searchQuery ||
            row.previewQueries?.[t.id]
        ) && (
          <Section title="Search Queries">
            <div className="space-y-2">
              {CANDIDATE_TRACKS.map((t) => {
                const persisted = trackAuditFor(t.id as CandidateTrackId)?.searchQuery;
                const preview = row.previewQueries?.[t.id];
                const value = persisted ?? preview;
                if (!value) return null;
                const isPreview = !persisted && !!preview;
                return (
                  <div key={t.id}>
                    <div className="text-xs text-gray-400 mb-1">
                      {t.label}
                      {isPreview && <span className="ml-1 text-gray-300">(preview)</span>}
                    </div>
                    <TextBlock value={value} />
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Per-track artifact sections, generated from the registry */}
        {CANDIDATE_TRACKS.map((t) => {
          const ta = trackAuditFor(t.id as CandidateTrackId);
          if (!ta) return null;
          return (
            <div key={t.id}>
              {ta.searchRawResponse !== undefined && (
                <Section title={`${t.label} — Search Raw Response (Tavily)`}>
                  <JsonBlock value={ta.searchRawResponse} />
                </Section>
              )}
              {ta.rankedSources && ta.rankedSources.length > 0 && (
                <Section title={`${t.label} — Ranked Sources (${ta.rankedSources.length})`}>
                  <div className="space-y-0.5">
                    {ta.rankedSources.map((s, i) => (
                      <RankedSourceRow key={i} source={s} rank={i + 1} selected={i < 5} />
                    ))}
                  </div>
                </Section>
              )}
              {ta.selectedSources && ta.selectedSources.length > 0 && (
                <Section title={`${t.label} — Selected Sources (${ta.selectedSources.length})`}>
                  <div className="space-y-3">
                    {ta.selectedSources.map((s, i) => (
                      <div key={i} className="bg-gray-50 border border-gray-100 rounded p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-amber-700 font-medium">{s.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${accentFor(t.id).pill}`}>
                            {t.label.toLowerCase()}
                          </span>
                        </div>
                        <div className="text-xs text-blue-600 mb-2 break-all">{s.url}</div>
                        <div className="text-xs text-gray-500 line-clamp-4">{s.content}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              {ta.geminiPrompt && (
                <Section title={`${t.label} — Gemini Prompt`}>
                  <TextBlock value={ta.geminiPrompt} />
                </Section>
              )}
              {ta.geminiRawResponse && (
                <Section title={`${t.label} — Gemini Raw Response`}>
                  <TextBlock value={ta.geminiRawResponse} />
                </Section>
              )}
              {ta.parsedResult && (
                <Section title={`${t.label} — Parsed Result`}>
                  <JsonBlock value={ta.parsedResult} />
                </Section>
              )}
              {ta.finalSavedFields && (
                <Section title={`${t.label} — Saved Fields`}>
                  <JsonBlock value={ta.finalSavedFields} />
                </Section>
              )}
            </div>
          );
        })}

        {audit?.errors && audit.errors.length > 0 && (
          <Section title={`Errors (${audit.errors.length})`}>
            <div className="space-y-1">
              {audit.errors.map((e, i) => {
                const isLegacy = typeof e === "string";
                const message = isLegacy ? e : e.message;
                const timestamp = isLegacy ? null : e.timestamp;
                return (
                  <div key={i} className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                    {timestamp && (
                      <div className="text-red-400 mb-0.5">
                        {new Date(timestamp).toLocaleString()}
                      </div>
                    )}
                    {message}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {!audit && !Object.keys(row.previewQueries ?? {}).length && (
          <div className="text-xs text-gray-400 py-8 text-center">
            No pipeline run yet. Click Re-run Enrichment to start.
          </div>
        )}
      </div>
    </div>
  );
}
