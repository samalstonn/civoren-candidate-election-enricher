import { runSearch } from "./runSearch";
import { callGemini } from "./callGemini";
import { enrichWithTranscripts } from "./fetchYouTubeTranscript";
import { injectContactPages } from "./fetchContactPage";
import { enrichThinSources } from "./fetchThinSources";
import type {
  EntityAdapter,
  TavilyResult,
} from "@/types/enrichment";
import {
  getTrack,
  trackIds,
  type EntityKind,
  type TrackIdFor,
} from "./registry";

type Stage = "search" | "gemini" | "save";
type StageFlags = { search: boolean; gemini: boolean; save: boolean };

/**
 * PipelineMode is generic over entity kind: a candidate-adapter pipeline call
 * accepts `"full" | "general_full" | "general_search" | ...` while a future
 * election-adapter pipeline accepts `"full" | "metadata_full" | ...`.
 *
 * `"full"` always means "all tracks for this adapter's kind, end-to-end".
 */
export type PipelineModeFor<K extends EntityKind> =
  | "full"
  | `${TrackIdFor<K>}_full`
  | `${TrackIdFor<K>}_search`
  | `${TrackIdFor<K>}_gemini`
  | `${TrackIdFor<K>}_save`;

/** Convenience alias when the caller doesn't have the kind narrowed. */
export type PipelineMode = PipelineModeFor<EntityKind>;

/**
 * Map legacy mode strings (or new ones) into the canonical list of modes the
 * pipeline runs. The legacy strings `"search" | "gemini" | "save"` fan out to
 * one mode per track for the adapter's kind.
 */
export function normalizePipelineMode<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  raw: string
): PipelineModeFor<K>[] {
  const kind = adapter.entityKind;
  const ids = trackIds(kind);
  const allFull: PipelineModeFor<K>[] = ["full"];
  const allSearch = ids.map((id) => `${id}_search` as PipelineModeFor<K>);
  const allGemini = ids.map((id) => `${id}_gemini` as PipelineModeFor<K>);
  const allSave = ids.map((id) => `${id}_save` as PipelineModeFor<K>);

  // Legacy mappings:
  switch (raw) {
    case "search":
      return allSearch;
    case "gemini":
      return allGemini;
    case "save":
      return allSave;
    case "search_general":
      return ids.includes("general" as TrackIdFor<K>)
        ? [`general_search` as PipelineModeFor<K>]
        : [];
    case "search_contact":
      return ids.includes("contact" as TrackIdFor<K>)
        ? [`contact_search` as PipelineModeFor<K>]
        : [];
    case "full":
      return allFull;
  }

  // New shape: validate against the registry.
  if (raw.endsWith("_full") || raw.endsWith("_search") || raw.endsWith("_gemini") || raw.endsWith("_save")) {
    const lastUnderscore = raw.lastIndexOf("_");
    const trackId = raw.slice(0, lastUnderscore);
    if (ids.includes(trackId as TrackIdFor<K>)) {
      return [raw as PipelineModeFor<K>];
    }
  }
  return [];
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

async function runTrackSearch<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  trackId: TrackIdFor<K>
): Promise<TavilyResult[]> {
  const trackDef = getTrack(adapter.entityKind, trackId);
  const adapterTrack = adapter.tracks[trackId];

  await adapter.updateTrack(trackId, { status: "search_queued" });
  const searchQuery = adapterTrack.buildSearchQuery();
  await adapter.updateTrack(trackId, { status: "search_running", searchQuery });

  let raw;
  try {
    raw = await runSearch(searchQuery, adapter.logContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(trackId, {
      searchRawResponse: { error: msg },
      status: "failed",
    });
    throw err;
  }

  const results = raw.results ?? [];
  const filtered = filterSources(results);
  const withContactPages = trackDef.injectContactPages
    ? await injectContactPages(filtered, adapter.nameParts)
    : filtered;
  const withTranscripts = await enrichWithTranscripts(withContactPages);
  const withFetched = await enrichThinSources(withTranscripts);
  const { sorted, ranked } = prioritizeSources(withFetched, adapter.nameParts);
  const selectedSources = sorted.slice(0, 5);

  await adapter.updateTrack(trackId, {
    status: "search_complete",
    searchRawResponse: raw,
    rankedSources: ranked,
    selectedSources,
  });

  // Pre-bake the prompt so the UI can show it before Gemini runs.
  const geminiPrompt = await adapterTrack.buildGeminiPrompt(selectedSources);
  await adapter.updateTrack(trackId, { geminiPrompt });

  return selectedSources;
}

async function runTrackGemini<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  trackId: TrackIdFor<K>,
  selectedSources: TavilyResult[]
): Promise<Record<string, unknown>> {
  const trackDef = getTrack(adapter.entityKind, trackId);
  const adapterTrack = adapter.tracks[trackId];

  await adapter.updateTrack(trackId, { status: "gemini_queued" });
  const geminiPrompt = await adapterTrack.buildGeminiPrompt(selectedSources);
  await adapter.updateTrack(trackId, { status: "gemini_running", geminiPrompt });

  let rawText: string;
  try {
    const result = await callGemini(geminiPrompt, adapter.logContext);
    rawText = result.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(trackId, {
      geminiPrompt,
      geminiRawResponse: msg,
      status: "failed",
    });
    throw err;
  }
  await adapter.updateTrack(trackId, { geminiRawResponse: rawText });

  let parsed: Record<string, unknown>;
  try {
    parsed = trackDef.parseResult(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await adapter.updateTrack(trackId, {
      geminiRawResponse: rawText,
      status: "failed",
    });
    throw new Error(msg);
  }

  await adapter.updateTrack(trackId, { parsedResult: parsed, status: "gemini_complete" });
  return parsed;
}

async function runTrackSave<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  trackId: TrackIdFor<K>,
  parsed: Record<string, unknown>
): Promise<void> {
  const audit = await adapter.getAudit();
  if (!audit) throw new Error("No audit found before save — run search/gemini first.");
  await adapter.tracks[trackId].save(parsed, audit);
}

async function runTrack<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  trackId: TrackIdFor<K>,
  stages: StageFlags
): Promise<void> {
  try {
    let selectedSources: TavilyResult[] | undefined;
    let parsed: Record<string, unknown> | undefined;

    if (stages.search) {
      selectedSources = await runTrackSearch(adapter, trackId);
    } else if (stages.gemini || stages.save) {
      const audit = await adapter.getAudit();
      selectedSources = audit?.[trackId as keyof typeof audit] && typeof audit[trackId as keyof typeof audit] === "object"
        ? (audit[trackId as keyof typeof audit] as { selectedSources?: TavilyResult[] })?.selectedSources
        : undefined;
    }

    if (stages.gemini) {
      if (!selectedSources || selectedSources.length === 0) {
        throw new Error(`No ${String(trackId)} search results — run search first.`);
      }
      parsed = await runTrackGemini(adapter, trackId, selectedSources);
    } else if (stages.save) {
      const audit = await adapter.getAudit();
      const trackAudit = audit?.[trackId as keyof typeof audit];
      parsed =
        trackAudit && typeof trackAudit === "object" && "parsedResult" in trackAudit
          ? (trackAudit as { parsedResult?: Record<string, unknown> }).parsedResult
          : undefined;
    }

    if (stages.save) {
      if (!parsed) {
        throw new Error(`No ${String(trackId)} parsed result — run gemini first.`);
      }
      await runTrackSave(adapter, trackId, parsed);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await adapter
      .appendError({ message, timestamp: new Date().toISOString(), track: trackId })
      .catch(() => {});
    await adapter.updateTrack(trackId, { status: "failed" }).catch(() => {});
    throw err;
  }
}

function stagesForMode<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  mode: PipelineModeFor<K>
): Array<{ trackId: TrackIdFor<K>; stages: StageFlags }> {
  const ids = trackIds(adapter.entityKind);
  if (mode === "full") {
    return ids.map((trackId) => ({
      trackId,
      stages: { search: true, gemini: true, save: true },
    }));
  }
  const raw = mode as string;
  const lastUnderscore = raw.lastIndexOf("_");
  const trackId = raw.slice(0, lastUnderscore) as TrackIdFor<K>;
  const stage = raw.slice(lastUnderscore + 1) as Stage | "full";

  const allStages: StageFlags = { search: true, gemini: true, save: true };
  const single: Record<Stage, StageFlags> = {
    search: { search: true, gemini: false, save: false },
    gemini: { search: false, gemini: true, save: false },
    save: { search: false, gemini: false, save: true },
  };

  return [
    {
      trackId,
      stages: stage === "full" ? allStages : single[stage as Stage],
    },
  ];
}

export async function runEnrichmentPipeline<K extends EntityKind>(
  adapter: EntityAdapter<K>,
  mode: PipelineModeFor<K> = "full"
): Promise<void> {
  // Seed top-level fields so an empty entity still produces a readable audit.
  const existing = await adapter.getAudit();
  if (!existing) {
    await adapter.updateAudit({
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      errors: [],
    });
  } else if (mode === "full" || (mode as string).endsWith("_full")) {
    await adapter.updateAudit({
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      errors: [],
    });
  }

  const plan = stagesForMode(adapter, mode);
  const tasks = plan.map(({ trackId, stages }) => runTrack(adapter, trackId, stages));
  const results = await Promise.allSettled(tasks);

  // Stamp completedAt if every scheduled track reached a terminal state.
  const after = await adapter.getAudit();
  if (after) {
    const terminal = (s: string | undefined) => s === "result_saved" || s === "failed";
    const allTerminal = plan.every(({ trackId }) => {
      const t = after[trackId as keyof typeof after];
      const status =
        t && typeof t === "object" && "status" in t
          ? (t as { status?: string }).status
          : undefined;
      return terminal(status);
    });
    if (allTerminal) {
      await adapter.updateAudit({ completedAt: new Date().toISOString() });
    }
  }

  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
}
