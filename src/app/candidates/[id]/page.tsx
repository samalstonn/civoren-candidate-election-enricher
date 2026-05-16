"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { MatchAuditJson } from "@/types/enrichment";

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
  source: { url: string; title: string; sourceQuery?: "general" | "contact"; score: number; content: string };
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
        {source.sourceQuery && (
          <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${source.sourceQuery === "contact" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
            }`}>
            {source.sourceQuery}
          </span>
        )}
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

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<"search" | "search_general" | "search_contact" | "gemini" | "save" | "full" | null>(null);
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

  async function runMode(mode: "search" | "search_general" | "search_contact" | "gemini" | "save" | "full") {
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
  const currentStatus = candidate.enrichmentRecord?.enrichmentStatus ?? "not_started";
  const isFailed = currentStatus === "failed";
  const isRunning = running !== null;
  const stageIndex = STAGES.indexOf(currentStatus as (typeof STAGES)[number]);

  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">
        <Link href="/candidates" className="hover:text-gray-600">Candidates</Link>
        {" / "}
        {candidate.name}
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{candidate.name}</h1>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            {candidate.election && (
              <div>{candidate.election.position} · {candidate.election.city}, {candidate.election.state}</div>
            )}
            {(candidate.email || candidate.phone) && (
              <div>
                {candidate.email && <span>{candidate.email}</span>}
                {candidate.email && candidate.phone && " · "}
                {candidate.phone && <span>{candidate.phone}</span>}
              </div>
            )}
            <div>
              ID #{candidate.id} · <a href={`https://civoren.com/candidates/${candidate.slug}`} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">{candidate.slug} ↗</a>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1">
              <button
                onClick={() => runMode("search")}
                disabled={isRunning}
                className="text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 font-medium rounded border border-gray-200 transition-colors"
              >
                {running === "search" ? "Running..." : "Run Search (Both)"}
              </button>
              <div className="flex gap-1">
                <button
                  onClick={() => runMode("search_general")}
                  disabled={isRunning}
                  className="text-xs px-2 py-1 bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-500 font-medium rounded border border-gray-200 transition-colors flex-1"
                >
                  {running === "search_general" ? "Running..." : "General"}
                </button>
                <button
                  onClick={() => runMode("search_contact")}
                  disabled={isRunning}
                  className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-600 font-medium rounded border border-blue-200 transition-colors flex-1"
                >
                  {running === "search_contact" ? "Running..." : "Contact"}
                </button>
              </div>
            </div>
            <button
              onClick={() => runMode("gemini")}
              disabled={isRunning || !audit?.selectedSources?.length}
              title={!audit?.selectedSources?.length ? "Run Search first" : undefined}
              className="text-xs px-3 py-2 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed text-purple-700 font-medium rounded border border-purple-200 transition-colors"
            >
              {running === "gemini" ? "Running..." : "Run Gemini"}
            </button>
            <button
              onClick={() => runMode("save")}
              disabled={isRunning || !audit?.parsedResult}
              title={!audit?.parsedResult ? "Run Gemini first" : undefined}
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
        <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">Pipeline</div>
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
        {audit && (
          <div className="mt-2 text-xs text-gray-400 flex gap-4">
            {audit.startedAt && <span>Started: {new Date(audit.startedAt).toLocaleString()}</span>}
            {audit.completedAt && <span>Completed: {new Date(audit.completedAt).toLocaleString()}</span>}
            {audit.runId && <span>Run: {audit.runId}</span>}
          </div>
        )}
      </div>

      {/* Saved Data */}
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

      {/* Pipeline Artifacts */}
      <div className="mt-6">
        <div className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">Pipeline Artifacts</div>

        {audit?.searchQuery && (
          <Section title="Search Queries">
            <div className="space-y-2">
              <div>
                <div className="text-xs text-gray-400 mb-1">General</div>
                <TextBlock value={audit.searchQuery} />
              </div>
              {audit.contactSearchQuery && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">Contact</div>
                  <TextBlock value={audit.contactSearchQuery} />
                </div>
              )}
            </div>
          </Section>
        )}

        {audit?.searchRawResponse !== undefined && (
          <Section title="Search Raw Response — General (Tavily)">
            <JsonBlock value={audit.searchRawResponse} />
          </Section>
        )}

        {audit?.contactSearchRawResponse !== undefined && (
          <Section title="Search Raw Response — Contact (Tavily)">
            <JsonBlock value={audit.contactSearchRawResponse} />
          </Section>
        )}

        {audit?.rankedSources && audit.rankedSources.length > 0 && (
          <Section title={`All Ranked Sources (${audit.rankedSources.length})`}>
            <div className="space-y-0.5">
              {audit.rankedSources.map((s, i) => (
                <RankedSourceRow key={i} source={s} rank={i + 1} selected={i < 5} />
              ))}
            </div>
          </Section>
        )}

        {audit?.selectedSources && audit.selectedSources.length > 0 && (
          <Section title={`Selected Sources (${audit.selectedSources.length})`}>
            <div className="space-y-3">
              {audit.selectedSources.map((s, i) => (
                <div key={i} className="bg-gray-50 border border-gray-100 rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-amber-700 font-medium">{s.title}</span>
                    {s.sourceQuery && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${s.sourceQuery === "contact" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
                        }`}>
                        {s.sourceQuery}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-blue-600 mb-2 break-all">{s.url}</div>
                  <div className="text-xs text-gray-500 line-clamp-4">{s.content}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {audit?.geminiPrompt && (
          <Section title="Gemini Prompt (Input)">
            <TextBlock value={audit.geminiPrompt} />
          </Section>
        )}

        {audit?.geminiRawResponse && (
          <Section title="Gemini Raw Response">
            <TextBlock value={audit.geminiRawResponse} />
          </Section>
        )}

        {audit?.parsedResult && (
          <Section title="Parsed Result">
            <JsonBlock value={audit.parsedResult} />
          </Section>
        )}

        {audit?.finalSavedFields && (
          <Section title="Saved Fields">
            <JsonBlock value={audit.finalSavedFields} />
          </Section>
        )}

        {audit?.errors && audit.errors.length > 0 && (
          <Section title={`Errors (${audit.errors.length})`}>
            <div className="space-y-1">
              {audit.errors.map((e, i) => {
                const isLegacy = typeof e === "string";
                const message = isLegacy ? e : e.message;
                const timestamp = isLegacy ? null : e.timestamp;
                return (
                  <div key={i} className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                    {timestamp && <div className="text-red-400 mb-0.5">{new Date(timestamp).toLocaleString()}</div>}
                    {message}
                  </div>
                );
              })}
            </div>
          </Section>
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
