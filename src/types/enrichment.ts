import type {
  EntityKind,
  TrackIdFor,
  AnyTrackId,
} from "@/lib/enrichment/registry";

export type EnrichmentStatus =
  | "not_started"
  | "search_queued"
  | "search_running"
  | "search_complete"
  | "gemini_queued"
  | "gemini_running"
  | "gemini_complete"
  | "result_saved"
  | "failed"
  | "needs_review";

/** Legacy alias — prefer `AnyTrackId` (cross-entity) or `TrackIdFor<K>` (entity-scoped). */
export type TrackKind = AnyTrackId;

export interface GeneralParsedResult {
  biography?: string;
  currentRole?: string | null;
  currentCity?: string | null;
  currentState?: string | null;
  party?: string | null;
  sourceUrls?: string[];
  confidence?: number;
  notes?: string;
}

export interface ContactParsedResult {
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  website?: string | null;
  sourceUrls?: string[];
  confidence?: number;
  notes?: string;
}

export interface TrackAudit {
  status: EnrichmentStatus;
  searchQuery?: string;
  searchRawResponse?: unknown;
  rankedSources?: { url: string; title: string; score: number; content: string }[];
  selectedSources?: TavilyResult[];
  geminiPrompt?: string;
  geminiRawResponse?: string;
  parsedResult?: Record<string, unknown>;
  finalSavedFields?: Record<string, unknown>;
}

/**
 * Mapped-type audit: top-level fixed fields + every `AnyTrackId` as a
 * top-level `TrackAudit` key. New entity kinds / tracks added to the registry
 * automatically expand this type without a DB migration — absent track keys
 * default to `not_started` at read time.
 */
export type MatchAuditJson = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  errors?: { message: string; timestamp: string; track?: AnyTrackId }[];
} & {
  [K in AnyTrackId]?: TrackAudit;
};

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyResult[];
  answer?: string;
}

export interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
  fullNameRaw?: string | null;
}

/**
 * Per-track adapter logic. Each adapter exposes one of these per track id its
 * entity kind supports, via `tracks: Record<TrackIdFor<K>, AdapterTrack>`.
 */
export interface AdapterTrack {
  buildSearchQuery: () => string;
  buildGeminiPrompt: (sources: TavilyResult[]) => string | Promise<string>;
  save: (parsed: Record<string, unknown>, audit: MatchAuditJson) => Promise<void>;
}

export interface EntityAdapter<K extends EntityKind = EntityKind> {
  readonly entityKind: K;
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: NameParts;
  /** Exhaustive map of this entity kind's tracks to their per-track logic. */
  readonly tracks: Record<TrackIdFor<K>, AdapterTrack>;

  getAudit(): Promise<MatchAuditJson | null>;
  /** Patch top-level audit fields only. */
  updateAudit(
    patch: Partial<Pick<MatchAuditJson, "runId" | "startedAt" | "completedAt" | "errors">>
  ): Promise<void>;
  /** Deep-merge a partial TrackAudit into the named track. */
  updateTrack(track: TrackIdFor<K>, patch: Partial<TrackAudit>): Promise<void>;
  /** Append a single error entry to the top-level error log. */
  appendError(error: { message: string; timestamp: string; track?: TrackIdFor<K> }): Promise<void>;
}
