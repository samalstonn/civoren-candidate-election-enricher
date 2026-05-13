import { prisma } from "@/lib/prisma";
import { buildSearchQuery, buildContactSearchQuery } from "./buildSearchQuery";
import { runSearch } from "./runSearch";
import { buildGeminiPrompt } from "./buildGeminiPrompt";
import { callGemini } from "./callGemini";
import { parseGeminiResult } from "./parseGeminiResult";
import { saveEnrichmentResult } from "./saveEnrichmentResult";
import { updateMatchAudit } from "./updateMatchAudit";
import { enrichWithTranscripts } from "./fetchYouTubeTranscript";
import { injectContactPages } from "./fetchContactPage";
import { enrichThinSources } from "./fetchThinSources";
import type { MatchAuditJson, TavilyResult, ParsedEnrichmentResult } from "@/types/enrichment";

export type PipelineMode = "search" | "search_general" | "search_contact" | "gemini" | "save" | "full";

const BLOCKED_DOMAINS = [
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

function prioritizeSources(
  results: TavilyResult[],
  row: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null }
): { sorted: TavilyResult[]; ranked: { url: string; title: string; sourceQuery?: "general" | "contact"; score: number; content: string }[] } {
  const firstName = (row.firstName ?? "").toLowerCase().replace(/\s+/g, "");
  const lastName = (row.lastName ?? "").toLowerCase().replace(/\s+/g, "");
  const fullName = (row.fullNameRaw ?? "").toLowerCase().replace(/\s+/g, "");

  function computeScore(s: TavilyResult): number {
    const url = s.url.toLowerCase();
    const content = s.content.toLowerCase();

    let points = s.score ?? 0;

    if (
      (lastName.length > 2 && url.includes(lastName)) ||
      (firstName.length > 2 && url.includes(firstName)) ||
      (fullName.length > 2 && url.includes(fullName))
    ) {
      points += 1;
    }

    const emails = content.match(EMAIL_RE) ?? [];
    for (const email of emails) {
      if (lastName.length > 2 && email.includes(lastName)) { points += 3; break; }
      if (firstName.length > 2 && email.includes(firstName)) { points += 1; break; }
    }

    return points;
  }

  const scored = results.map((s) => ({ source: s, score: computeScore(s) }));
  scored.sort((a, b) => b.score - a.score);

  return {
    sorted: scored.map((s) => s.source),
    ranked: scored.map((s) => ({
      url: s.source.url,
      title: s.source.title,
      sourceQuery: s.source.sourceQuery,
      score: Math.round(s.score * 1000) / 1000,
      content: s.source.content,
    })),
  };
}

function filterSources(results: TavilyResult[]): TavilyResult[] {
  return results.filter((r) => {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      return !BLOCKED_DOMAINS.includes(host);
    } catch {
      return true;
    }
  });
}

function loadAudit(raw: unknown): MatchAuditJson | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as unknown as MatchAuditJson;
  }
  return null;
}

async function getAudit(rowId: number): Promise<MatchAuditJson | null> {
  const record = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    select: { matchAuditJson: true },
  });
  return loadAudit(record?.matchAuditJson);
}

async function runSearch_stage(
  rowId: number,
  runId: string,
  startedAt: string
): Promise<{ searchQuery: string; selectedSources: TavilyResult[]; searchRawResponse: unknown }> {
  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    include: { submission: true },
  });
  if (!row) throw new Error(`Row ${rowId} not found`);

  await updateMatchAudit(rowId, {
    runId,
    startedAt,
    searchQuery: "",
    status: "search_queued",
    errors: [],
  });

  const searchQuery = buildSearchQuery(row, row.submission);
  const contactSearchQuery = buildContactSearchQuery(row, row.submission);
  await updateMatchAudit(rowId, { searchQuery, contactSearchQuery, status: "search_running", errors: [] });

  let searchRawResponse;
  let contactSearchRawResponse;
  let selectedSources: TavilyResult[] = [];
  try {
    const ctx = { rowId, submissionId: row.submissionId };
    [searchRawResponse, contactSearchRawResponse] = await Promise.all([
      runSearch(searchQuery, ctx),
      runSearch(contactSearchQuery, ctx),
    ]);

    const generalResults = (searchRawResponse.results ?? []).map(
      (r: TavilyResult) => ({ ...r, sourceQuery: "general" as const })
    );
    const contactResults = (contactSearchRawResponse.results ?? []).map(
      (r: TavilyResult) => ({ ...r, sourceQuery: "contact" as const })
    );

    const seen = new Set<string>();
    const merged: TavilyResult[] = [];
    for (const r of [...generalResults, ...contactResults]) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        merged.push(r);
      }
    }

    const filtered = filterSources(merged);
    const withContactPages = await injectContactPages(filtered, row);
    const withTranscripts = await enrichWithTranscripts(withContactPages);
    const withFetched = await enrichThinSources(withTranscripts);
    const { sorted, ranked } = prioritizeSources(withFetched, row);
    selectedSources = sorted.slice(0, 5);
    await updateMatchAudit(rowId, { rankedSources: ranked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatchAudit(rowId, {
      searchQuery,
      contactSearchQuery,
      searchRawResponse: { error: msg },
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await updateMatchAudit(rowId, {
    searchQuery,
    contactSearchQuery,
    searchRawResponse,
    contactSearchRawResponse,
    selectedSources,
    status: "search_complete",
  });

  // Build and store a prompt preview so the user can inspect it before calling Gemini
  const geminiPrompt = buildGeminiPrompt(row, row.submission, selectedSources);
  await updateMatchAudit(rowId, { geminiPrompt });

  return { searchQuery, selectedSources, searchRawResponse };
}

async function runSingleSearch_stage(
  rowId: number,
  which: "general" | "contact"
): Promise<void> {
  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    include: { submission: true },
  });
  if (!row) throw new Error(`Row ${rowId} not found`);

  const existingAudit = await getAudit(rowId);

  const searchQuery = buildSearchQuery(row, row.submission);
  const contactSearchQuery = buildContactSearchQuery(row, row.submission);

  await updateMatchAudit(rowId, { searchQuery, contactSearchQuery, status: "search_running", errors: [] });

  let newRawResponse;
  try {
    newRawResponse = await runSearch(
      which === "general" ? searchQuery : contactSearchQuery,
      { rowId, submissionId: row.submissionId }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatchAudit(rowId, { status: "failed", errors: [{ message: msg, timestamp: new Date().toISOString() }] });
    throw err;
  }

  const newTagged = (newRawResponse.results ?? []).map((r: TavilyResult) => ({
    ...r,
    sourceQuery: which,
  }));

  const otherSources = (existingAudit?.selectedSources ?? []).filter(
    (s) => s.sourceQuery !== which
  );

  const seen = new Set<string>(otherSources.map((s) => s.url));
  const merged: TavilyResult[] = [...otherSources];
  for (const r of newTagged) {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      merged.push(r);
    }
  }

  const filtered = filterSources(merged);
  const withContactPages = await injectContactPages(filtered, row);
  const withTranscripts = await enrichWithTranscripts(withContactPages);
  const withFetched = await enrichThinSources(withTranscripts);
  const { sorted, ranked } = prioritizeSources(withFetched, row);
  const selectedSources = sorted.slice(0, 5);
  await updateMatchAudit(rowId, { rankedSources: ranked });

  const update =
    which === "general"
      ? { searchQuery, contactSearchQuery, searchRawResponse: newRawResponse, selectedSources, status: "search_complete" as const }
      : { searchQuery, contactSearchQuery, contactSearchRawResponse: newRawResponse, selectedSources, status: "search_complete" as const };

  await updateMatchAudit(rowId, update);

  const geminiPrompt = buildGeminiPrompt(row, row.submission, selectedSources);
  await updateMatchAudit(rowId, { geminiPrompt });
}

async function runGemini_stage(
  rowId: number,
  selectedSources: TavilyResult[]
): Promise<ParsedEnrichmentResult> {
  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    include: { submission: true },
  });
  if (!row) throw new Error(`Row ${rowId} not found`);

  await updateMatchAudit(rowId, { status: "gemini_queued", errors: [] });

  const geminiPrompt = buildGeminiPrompt(row, row.submission, selectedSources);
  await updateMatchAudit(rowId, { geminiPrompt, status: "gemini_running" });

  let geminiRawResponse: string;
  try {
    const result = await callGemini(geminiPrompt, { rowId, submissionId: row.submissionId });
    geminiRawResponse = result.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatchAudit(rowId, {
      geminiPrompt,
      geminiRawResponse: msg,
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await updateMatchAudit(rowId, { geminiRawResponse, status: "gemini_complete" });

  let parsedResult: ParsedEnrichmentResult;
  try {
    parsedResult = parseGeminiResult(geminiRawResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatchAudit(rowId, {
      geminiRawResponse,
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await updateMatchAudit(rowId, { parsedResult, status: "gemini_complete" });
  return parsedResult;
}

async function runSave_stage(
  rowId: number,
  parsedResult: ParsedEnrichmentResult
): Promise<void> {
  const audit = await getAudit(rowId);
  const fallback: MatchAuditJson = {
    runId: crypto.randomUUID(),
    status: "gemini_complete",
    startedAt: new Date().toISOString(),
    searchQuery: "",
  };
  await saveEnrichmentResult(rowId, parsedResult, audit ?? fallback);
}

export async function runEnrichmentPipeline(
  rowId: number,
  mode: PipelineMode = "full"
): Promise<void> {
  try {
    if (mode === "search") {
      const runId = crypto.randomUUID();
      await runSearch_stage(rowId, runId, new Date().toISOString());
      return;
    }

    if (mode === "search_general") {
      await runSingleSearch_stage(rowId, "general");
      return;
    }

    if (mode === "search_contact") {
      await runSingleSearch_stage(rowId, "contact");
      return;
    }

    if (mode === "gemini") {
      const audit = await getAudit(rowId);
      const selectedSources = audit?.selectedSources;
      if (!selectedSources || selectedSources.length === 0) {
        throw new Error("No search results found in audit. Run Search first.");
      }
      await runGemini_stage(rowId, selectedSources);
      return;
    }

    if (mode === "save") {
      const audit = await getAudit(rowId);
      const parsedResult = audit?.parsedResult;
      if (!parsedResult) {
        throw new Error("No parsed result found in audit. Run Gemini first.");
      }
      await runSave_stage(rowId, parsedResult);
      return;
    }

    // "full" — fresh run of all three stages
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const { selectedSources } = await runSearch_stage(rowId, runId, startedAt);
    const parsedResult = await runGemini_stage(rowId, selectedSources);
    await runSave_stage(rowId, parsedResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateMatchAudit(rowId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    }).catch(() => { });
    throw err;
  }
}
