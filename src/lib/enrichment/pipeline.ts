import { runSearch } from "./runSearch";
import { callGemini } from "./callGemini";
import { parseGeminiResult } from "./parseGeminiResult";
import { enrichWithTranscripts } from "./fetchYouTubeTranscript";
import { injectContactPages } from "./fetchContactPage";
import { enrichThinSources } from "./fetchThinSources";
import type { EntityAdapter } from "@/types/enrichment";
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
  nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null }
): { sorted: TavilyResult[]; ranked: { url: string; title: string; sourceQuery?: "general" | "contact"; score: number; content: string }[] } {
  const firstName = (nameParts.firstName ?? "").toLowerCase().replace(/\s+/g, "");
  const lastName = (nameParts.lastName ?? "").toLowerCase().replace(/\s+/g, "");
  const fullName = (nameParts.fullNameRaw ?? "").toLowerCase().replace(/\s+/g, "");

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

async function runSearch_stage(
  adapter: EntityAdapter,
  runId: string,
  startedAt: string
): Promise<{ searchQuery: string; selectedSources: TavilyResult[]; searchRawResponse: unknown }> {
  await adapter.updateAudit({
    runId,
    startedAt,
    searchQuery: "",
    status: "search_queued",
    errors: [],
  });

  const searchQuery = adapter.buildSearchQuery();
  const contactSearchQuery = adapter.buildContactSearchQuery();
  await adapter.updateAudit({ searchQuery, contactSearchQuery, status: "search_running", errors: [] });

  let searchRawResponse;
  let contactSearchRawResponse;
  let selectedSources: TavilyResult[] = [];
  try {
    const ctx = adapter.logContext;
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
    const withContactPages = await injectContactPages(filtered, adapter.nameParts);
    const withTranscripts = await enrichWithTranscripts(withContactPages);
    const withFetched = await enrichThinSources(withTranscripts);
    const { sorted, ranked } = prioritizeSources(withFetched, adapter.nameParts);
    selectedSources = sorted.slice(0, 5);
    await adapter.updateAudit({ rankedSources: ranked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateAudit({
      searchQuery,
      contactSearchQuery,
      searchRawResponse: { error: msg },
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await adapter.updateAudit({
    searchQuery,
    contactSearchQuery,
    searchRawResponse,
    contactSearchRawResponse,
    selectedSources,
    status: "search_complete",
  });

  const geminiPrompt = await adapter.buildGeminiPrompt(selectedSources);
  await adapter.updateAudit({ geminiPrompt });

  return { searchQuery, selectedSources, searchRawResponse };
}

async function runSingleSearch_stage(
  adapter: EntityAdapter,
  which: "general" | "contact"
): Promise<void> {
  const existingAudit = await adapter.getAudit();

  const searchQuery = adapter.buildSearchQuery();
  const contactSearchQuery = adapter.buildContactSearchQuery();

  await adapter.updateAudit({ searchQuery, contactSearchQuery, status: "search_running", errors: [] });

  let newRawResponse;
  try {
    newRawResponse = await runSearch(
      which === "general" ? searchQuery : contactSearchQuery,
      adapter.logContext
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateAudit({ status: "failed", errors: [{ message: msg, timestamp: new Date().toISOString() }] });
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
  const withContactPages = await injectContactPages(filtered, adapter.nameParts);
  const withTranscripts = await enrichWithTranscripts(withContactPages);
  const withFetched = await enrichThinSources(withTranscripts);
  const { sorted, ranked } = prioritizeSources(withFetched, adapter.nameParts);
  const selectedSources = sorted.slice(0, 5);
  await adapter.updateAudit({ rankedSources: ranked });

  const update =
    which === "general"
      ? { searchQuery, contactSearchQuery, searchRawResponse: newRawResponse, selectedSources, status: "search_complete" as const }
      : { searchQuery, contactSearchQuery, contactSearchRawResponse: newRawResponse, selectedSources, status: "search_complete" as const };

  await adapter.updateAudit(update);

  const geminiPrompt = await adapter.buildGeminiPrompt(selectedSources);
  await adapter.updateAudit({ geminiPrompt });
}

async function runGemini_stage(
  adapter: EntityAdapter,
  selectedSources: TavilyResult[]
): Promise<ParsedEnrichmentResult> {
  await adapter.updateAudit({ status: "gemini_queued", errors: [] });

  const geminiPrompt = await adapter.buildGeminiPrompt(selectedSources);
  await adapter.updateAudit({ geminiPrompt, status: "gemini_running" });

  let geminiRawResponse: string;
  try {
    const result = await callGemini(geminiPrompt, adapter.logContext);
    geminiRawResponse = result.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateAudit({
      geminiPrompt,
      geminiRawResponse: msg,
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await adapter.updateAudit({ geminiRawResponse, status: "gemini_complete" });

  let parsedResult: ParsedEnrichmentResult;
  try {
    parsedResult = parseGeminiResult(geminiRawResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateAudit({
      geminiRawResponse,
      status: "failed",
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    });
    throw err;
  }

  await adapter.updateAudit({ parsedResult, status: "gemini_complete" });
  return parsedResult;
}

async function runSave_stage(
  adapter: EntityAdapter,
  parsedResult: ParsedEnrichmentResult
): Promise<void> {
  const audit = await adapter.getAudit();
  const fallback: MatchAuditJson = {
    runId: crypto.randomUUID(),
    status: "gemini_complete",
    startedAt: new Date().toISOString(),
    searchQuery: "",
  };
  await adapter.saveResult(parsedResult, audit ?? fallback);
}

export async function runEnrichmentPipeline(
  adapter: EntityAdapter,
  mode: PipelineMode = "full"
): Promise<void> {
  try {
    if (mode === "search") {
      const runId = crypto.randomUUID();
      await runSearch_stage(adapter, runId, new Date().toISOString());
      return;
    }

    if (mode === "search_general") {
      await runSingleSearch_stage(adapter, "general");
      return;
    }

    if (mode === "search_contact") {
      await runSingleSearch_stage(adapter, "contact");
      return;
    }

    if (mode === "gemini") {
      const audit = await adapter.getAudit();
      const selectedSources = audit?.selectedSources;
      if (!selectedSources || selectedSources.length === 0) {
        throw new Error("No search results found in audit. Run Search first.");
      }
      await runGemini_stage(adapter, selectedSources);
      return;
    }

    if (mode === "save") {
      const audit = await adapter.getAudit();
      const parsedResult = audit?.parsedResult;
      if (!parsedResult) {
        throw new Error("No parsed result found in audit. Run Gemini first.");
      }
      await runSave_stage(adapter, parsedResult);
      return;
    }

    // "full" — fresh run of all three stages
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const { selectedSources } = await runSearch_stage(adapter, runId, startedAt);
    const parsedResult = await runGemini_stage(adapter, selectedSources);
    await runSave_stage(adapter, parsedResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateAudit({
      status: "failed",
      completedAt: new Date().toISOString(),
      errors: [{ message: msg, timestamp: new Date().toISOString() }],
    }).catch(() => { });
    throw err;
  }
}
