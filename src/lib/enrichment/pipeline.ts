import { runSearch } from "./runSearch";
import { callGemini } from "./callGemini";
import { parseTrackResult } from "./parseGeminiResult";
import { enrichWithTranscripts } from "./fetchYouTubeTranscript";
import { injectContactPages } from "./fetchContactPage";
import { enrichThinSources } from "./fetchThinSources";
import type {
  EntityAdapter,
  MatchAuditJson,
  TavilyResult,
  TrackAudit,
  TrackKind,
  GeneralParsedResult,
  ContactParsedResult,
} from "@/types/enrichment";

export type PipelineMode =
  | "full"
  | "general_full"
  | "contact_full"
  | "general_search"
  | "contact_search"
  | "general_gemini"
  | "contact_gemini"
  | "general_save"
  | "contact_save";

/** Map legacy mode strings onto the new split-pipeline modes. */
export function normalizePipelineMode(raw: string): PipelineMode[] {
  switch (raw) {
    // New modes pass through.
    case "full":
    case "general_full":
    case "contact_full":
    case "general_search":
    case "contact_search":
    case "general_gemini":
    case "contact_gemini":
    case "general_save":
    case "contact_save":
      return [raw];
    // Legacy compatibility:
    case "search":
      return ["general_search", "contact_search"];
    case "search_general":
      return ["general_search"];
    case "search_contact":
      return ["contact_search"];
    case "gemini":
      return ["general_gemini", "contact_gemini"];
    case "save":
      return ["general_save", "contact_save"];
    default:
      return [];
  }
}

const BLOCKED_DOMAINS = ["instagram.com", "tiktok.com", "twitter.com", "x.com"];
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

function prioritizeSources(
  results: TavilyResult[],
  nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null }
): {
  sorted: TavilyResult[];
  ranked: { url: string; title: string; score: number; content: string }[];
} {
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
      if (lastName.length > 2 && email.includes(lastName)) {
        points += 3;
        break;
      }
      if (firstName.length > 2 && email.includes(firstName)) {
        points += 1;
        break;
      }
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

async function runTrackSearch(adapter: EntityAdapter, track: TrackKind): Promise<TavilyResult[]> {
  await adapter.updateTrack(track, { status: "search_queued" });
  const searchQuery = adapter.buildSearchQuery(track);
  await adapter.updateTrack(track, { status: "search_running", searchQuery });

  let raw;
  try {
    raw = await runSearch(searchQuery, adapter.logContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(track, {
      searchRawResponse: { error: msg },
      status: "failed",
    });
    throw err;
  }

  const results = raw.results ?? [];
  const filtered = filterSources(results);
  // Contact pages and thin-source fetches matter most for the contact track,
  // but transcripts/thin-source fill-in helps general too. Keep both enabled.
  const withContactPages =
    track === "contact"
      ? await injectContactPages(filtered, adapter.nameParts)
      : filtered;
  const withTranscripts = await enrichWithTranscripts(withContactPages);
  const withFetched = await enrichThinSources(withTranscripts);
  const { sorted, ranked } = prioritizeSources(withFetched, adapter.nameParts);
  const selectedSources = sorted.slice(0, 5);

  await adapter.updateTrack(track, {
    status: "search_complete",
    searchRawResponse: raw,
    rankedSources: ranked,
    selectedSources,
  });

  // Pre-bake the prompt so the UI can show it before the user clicks Run Gemini.
  const geminiPrompt = await adapter.buildGeminiPrompt(track, selectedSources);
  await adapter.updateTrack(track, { geminiPrompt });

  return selectedSources;
}

async function runTrackGemini(
  adapter: EntityAdapter,
  track: TrackKind,
  selectedSources: TavilyResult[]
): Promise<GeneralParsedResult | ContactParsedResult> {
  await adapter.updateTrack(track, { status: "gemini_queued" });
  const geminiPrompt = await adapter.buildGeminiPrompt(track, selectedSources);
  await adapter.updateTrack(track, { status: "gemini_running", geminiPrompt });

  let rawText: string;
  try {
    const result = await callGemini(geminiPrompt, adapter.logContext);
    rawText = result.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(track, {
      geminiPrompt,
      geminiRawResponse: msg,
      status: "failed",
    });
    throw err;
  }
  await adapter.updateTrack(track, { geminiRawResponse: rawText });

  let parsed: GeneralParsedResult | ContactParsedResult;
  try {
    parsed = parseTrackResult(track, rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(track, {
      geminiRawResponse: rawText,
      status: "failed",
    });
    throw new Error(msg);
  }

  await adapter.updateTrack(track, { parsedResult: parsed, status: "gemini_complete" });
  return parsed;
}

async function runTrackSave(
  adapter: EntityAdapter,
  track: TrackKind,
  parsed: GeneralParsedResult | ContactParsedResult
): Promise<void> {
  const audit = await adapter.getAudit();
  if (!audit) throw new Error("No audit found before save — run search/gemini first.");
  await adapter.saveTrackResult(track, parsed, audit);
}

async function runTrack(
  adapter: EntityAdapter,
  track: TrackKind,
  stages: { search: boolean; gemini: boolean; save: boolean }
): Promise<void> {
  try {
    let selectedSources: TavilyResult[] | undefined;
    let parsed: GeneralParsedResult | ContactParsedResult | undefined;

    if (stages.search) {
      selectedSources = await runTrackSearch(adapter, track);
    } else if (stages.gemini || stages.save) {
      const audit = await adapter.getAudit();
      selectedSources = audit?.[track].selectedSources;
    }

    if (stages.gemini) {
      if (!selectedSources || selectedSources.length === 0) {
        throw new Error(`No ${track} search results — run search first.`);
      }
      parsed = await runTrackGemini(adapter, track, selectedSources);
    } else if (stages.save) {
      const audit = await adapter.getAudit();
      parsed = audit?.[track].parsedResult;
    }

    if (stages.save) {
      if (!parsed) {
        throw new Error(`No ${track} parsed result — run gemini first.`);
      }
      await runTrackSave(adapter, track, parsed);
    }
  } catch (err) {
    // Inner stage helpers already flipped the track status to "failed" and
    // captured stage-specific raw context. We add the user-visible error to
    // the top-level errors[] log so the UI can render it.
    const message = err instanceof Error ? err.message : String(err);
    await adapter
      .appendError({ message, timestamp: new Date().toISOString(), track })
      .catch(() => {});
    // Ensure the track is marked failed even if the inner helper missed it
    // (e.g. for the "no search results" / "no parsed result" guards above).
    await adapter.updateTrack(track, { status: "failed" }).catch(() => {});
    throw err;
  }
}

function stagesForMode(mode: PipelineMode): {
  general: { search: boolean; gemini: boolean; save: boolean } | null;
  contact: { search: boolean; gemini: boolean; save: boolean } | null;
} {
  const all = { search: true, gemini: true, save: true };
  switch (mode) {
    case "full":
      return { general: all, contact: all };
    case "general_full":
      return { general: all, contact: null };
    case "contact_full":
      return { general: null, contact: all };
    case "general_search":
      return { general: { search: true, gemini: false, save: false }, contact: null };
    case "contact_search":
      return { general: null, contact: { search: true, gemini: false, save: false } };
    case "general_gemini":
      return { general: { search: false, gemini: true, save: false }, contact: null };
    case "contact_gemini":
      return { general: null, contact: { search: false, gemini: true, save: false } };
    case "general_save":
      return { general: { search: false, gemini: false, save: true }, contact: null };
    case "contact_save":
      return { general: null, contact: { search: false, gemini: false, save: true } };
  }
}

export async function runEnrichmentPipeline(
  adapter: EntityAdapter,
  mode: PipelineMode = "full"
): Promise<void> {
  // Ensure base audit fields are seeded so the migration shim doesn't return null
  // for a brand-new entity. We only touch top-level fields here — track statuses
  // start at "not_started" via the empty-audit default in enrichmentRecord.ts.
  const existing = await adapter.getAudit();
  if (!existing) {
    await adapter.updateAudit({
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      errors: [],
    });
  } else if (mode === "full" || mode === "general_full" || mode === "contact_full") {
    // Stamp a fresh runId on full runs so logs can correlate the new run.
    await adapter.updateAudit({
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      errors: [],
    });
  }

  const { general, contact } = stagesForMode(mode);

  const tasks: Promise<void>[] = [];
  if (general) tasks.push(runTrack(adapter, "general", general));
  if (contact) tasks.push(runTrack(adapter, "contact", contact));

  // Run tracks in parallel. We use allSettled so one track's failure doesn't
  // cancel the other; the failed track will already have its status flipped
  // to "failed" by the inner runTrackX helpers.
  const results = await Promise.allSettled(tasks);

  // Stamp completedAt when both tracks have terminal status (saved/failed).
  const after = await adapter.getAudit();
  if (after) {
    const g = after.general.status;
    const c = after.contact.status;
    const terminal = (s: string) => s === "result_saved" || s === "failed";
    if ((!general || terminal(g)) && (!contact || terminal(c))) {
      await adapter.updateAudit({ completedAt: new Date().toISOString() });
    }
  }

  // Surface the first failure to the caller (so the route returns 500).
  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
}

export type { MatchAuditJson, TrackAudit };
