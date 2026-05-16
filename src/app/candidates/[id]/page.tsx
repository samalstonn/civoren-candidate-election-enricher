"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { MatchAuditJson, TrackAudit, TrackKind } from "@/types/enrichment";

interface Election {
  position: string;
  state: string;
  city: string;
  date: string;
  filingAuthorityName: string | null;
  filingAuthorityLevel: string | null;
  party: string | null;
}

interface Candidate {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  currentRole: string | null;
  currentCity: string | null;
  currentState: string | null;
  linkedin: string | null;
  website: string | null;
  election: Election | null;
  enrichmentRecord: {
    enrichmentStatus: string | null;
    matchAuditJson: MatchAuditJson | null;
    updatedAt: string;
  } | null;
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

type Mode =
  | "general_search"
  | "contact_search"
  | "general_gemini"
  | "contact_gemini"
  | "general_save"
  | "contact_save"
  | "general_full"
  | "contact_full"
  | "full";

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

function TrackArtifacts({ audit }: { audit: TrackAudit }) {
  return (
    <div>
      {audit.searchQuery && (
        <Section title="Search Query">
          <TextBlock value={audit.searchQuery} />
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
  label,
  disabled,
  running,
  onSearch,
  onGemini,
  onSave,
  onAll,
  track,
  audit,
}: {
  label: string;
  disabled: boolean;
  running: Mode | null;
  onSearch: () => void;
  onGemini: () => void;
  onSave: () => void;
  onAll: () => void;
  track: TrackKind;
  audit: TrackAudit;
}) {
  const accent =
    track === "contact"
      ? "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
      : "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200";
  const hasSources = !!audit.selectedSources?.length;
  const hasParsed = !!audit.parsedResult;

  const searchKey: Mode = track === "general" ? "general_search" : "contact_search";
  const geminiKey: Mode = track === "general" ? "general_gemini" : "contact_gemini";
  const saveKey: Mode = track === "general" ? "general_save" : "contact_save";
  const fullKey: Mode = track === "general" ? "general_full" : "contact_full";

  return (
    <div className="flex flex-col gap-1 min-w-[8rem]">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium px-1">{label}</div>
      <button
        onClick={onSearch}
        disabled={disabled}
        className={`text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed font-medium rounded border transition-colors ${accent}`}
      >
        {running === searchKey ? "Running..." : "Run Search"}
      </button>
      <button
        onClick={onGemini}
        disabled={disabled || !hasSources}
        title={!hasSources ? "Run Search first" : undefined}
        className="text-xs px-3 py-1.5 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed text-purple-700 font-medium rounded border border-purple-200 transition-colors"
      >
        {running === geminiKey ? "Running..." : "Run Gemini"}
      </button>
      <button
        onClick={onSave}
        disabled={disabled || !hasParsed}
        title={!hasParsed ? "Run Gemini first" : undefined}
        className="text-xs px-3 py-1.5 bg-green-50 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed text-green-700 font-medium rounded border border-green-200 transition-colors"
      >
        {running === saveKey ? "Saving..." : "Save"}
      </button>
      <button
        onClick={onAll}
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

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Mode | null>(null);
  const [logSummary, setLogSummary] = useState<{ apiType: string; calls: number; totalTokens: number | null; totalCostUsd: number | null }[]>([]);

  const load = useCallback(() => {
    fetch(`/api/candidates/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setCandidate(data);
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
      await fetch(`/api/candidates/${params.id}/enrich`, {
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
  if (!candidate) return null;

  const audit = candidate.enrichmentRecord?.matchAuditJson ?? null;
  const general = audit?.general ?? emptyTrack();
  const contact = audit?.contact ?? emptyTrack();
  const isRunning = running !== null;

  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/candidates" className="hover:text-gray-600">Candidates</Link>
        {" / "}
        {candidate.name}
      </div>

      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{candidate.name}</h1>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            {candidate.election && (
              <div>
                {candidate.election.position} · {candidate.election.city}, {candidate.election.state}
              </div>
            )}
            {(candidate.email || candidate.phone) && (
              <div>
                {candidate.email && <span>{candidate.email}</span>}
                {candidate.email && candidate.phone && " · "}
                {candidate.phone && <span>{candidate.phone}</span>}
              </div>
            )}
            <div>
              ID #{candidate.id} ·{" "}
              <a
                href={`https://civoren.com/candidates/${candidate.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:underline"
              >
                {candidate.slug} ↗
              </a>
            </div>
          </div>
        </div>

        {/* Action buttons: General column | Contact column | Run Full */}
        <div className="flex gap-3 items-stretch">
          <TrackButtons
            label="General"
            disabled={isRunning}
            running={running}
            onSearch={() => runMode("general_search")}
            onGemini={() => runMode("general_gemini")}
            onSave={() => runMode("general_save")}
            onAll={() => runMode("general_full")}
            track="general"
            audit={general}
          />
          <TrackButtons
            label="Contact"
            disabled={isRunning}
            running={running}
            onSearch={() => runMode("contact_search")}
            onGemini={() => runMode("contact_gemini")}
            onSave={() => runMode("contact_save")}
            onAll={() => runMode("contact_full")}
            track="contact"
            audit={contact}
          />
          <button
            onClick={() => runMode("full")}
            disabled={isRunning}
            className="text-xs px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded transition-colors"
          >
            {running === "full" ? "Running..." : "Run Full"}
          </button>
        </div>
      </div>

      {/* Pipeline strips — one per track */}
      <div className="mb-6 space-y-3">
        <PipelineStrip label="Pipeline — General" status={general.status} />
        <PipelineStrip label="Pipeline — Contact" status={contact.status} />
        {audit && (audit.startedAt || audit.completedAt || audit.runId) && (
          <div className="text-xs text-gray-400 flex gap-4">
            {audit.startedAt && <span>Started: {new Date(audit.startedAt).toLocaleString()}</span>}
            {audit.completedAt && <span>Completed: {new Date(audit.completedAt).toLocaleString()}</span>}
            {audit.runId && <span>Run: {audit.runId}</span>}
          </div>
        )}
      </div>

      {/* Saved Data cards */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Email", value: candidate.email },
          { label: "Phone", value: candidate.phone },
          { label: "LinkedIn", value: candidate.linkedin, href: candidate.linkedin },
          { label: "Website", value: candidate.website, href: candidate.website },
          { label: "Current Role", value: candidate.currentRole },
          { label: "Current City", value: candidate.currentCity },
          { label: "Current State", value: candidate.currentState },
          { label: "Party", value: candidate.election?.party ?? null },
        ].map(({ label, value, href }) => (
          <div key={label} className="bg-white border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className="text-sm text-gray-900 truncate" title={value ?? undefined}>
              {value ? (
                href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-600 hover:underline"
                  >
                    {value.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : (
                  value
                )
              ) : (
                "—"
              )}
            </div>
          </div>
        ))}
      </div>

      {candidate.bio && (
        <div className="mb-4 bg-white border border-gray-200 rounded p-3">
          <div className="text-xs text-gray-400 mb-1">Bio</div>
          <div className="text-xs text-gray-700 whitespace-pre-wrap">{candidate.bio}</div>
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

      {/* Pipeline Artifacts — two columns */}
      <div className="mt-6">
        <div className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">Pipeline Artifacts</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">General</div>
            <TrackArtifacts audit={general} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Contact</div>
            <TrackArtifacts audit={contact} />
          </div>
        </div>

        {audit?.errors && audit.errors.length > 0 && (
          <div className="mt-4">
            <Section title={`Errors (${audit.errors.length})`}>
              <div className="space-y-1">
                {audit.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                    {e.timestamp && (
                      <div className="text-red-400 mb-0.5 flex items-center gap-2">
                        <span>{new Date(e.timestamp).toLocaleString()}</span>
                        {e.track && (
                          <span
                            className={`px-1.5 py-0.5 rounded font-medium ${
                              e.track === "contact"
                                ? "bg-blue-50 text-blue-600"
                                : "bg-gray-100 text-gray-500"
                            }`}
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

        {!audit && (
          <div className="text-xs text-gray-400 py-8 text-center">
            No pipeline run yet. Click Run Full to start.
          </div>
        )}
      </div>
    </div>
  );
}
