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

export type TrackKind = "general" | "contact";

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

export type ParsedTrackResult<T extends TrackKind = TrackKind> = T extends "general"
  ? GeneralParsedResult
  : ContactParsedResult;

export interface TrackAudit {
  status: EnrichmentStatus;
  searchQuery?: string;
  searchRawResponse?: unknown;
  rankedSources?: { url: string; title: string; score: number; content: string }[];
  selectedSources?: TavilyResult[];
  geminiPrompt?: string;
  geminiRawResponse?: string;
  parsedResult?: GeneralParsedResult | ContactParsedResult;
  finalSavedFields?: Record<string, unknown>;
}

export interface MatchAuditJson {
  runId: string;
  startedAt: string;
  completedAt?: string;
  general: TrackAudit;
  contact: TrackAudit;
  errors?: { message: string; timestamp: string; track?: TrackKind }[];
}

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

export interface EntityAdapter {
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null };

  buildSearchQuery(track: TrackKind): string;
  buildGeminiPrompt(track: TrackKind, sources: TavilyResult[]): Promise<string> | string;

  getAudit(): Promise<MatchAuditJson | null>;
  /** Patch top-level audit fields (errors, completedAt, runId, etc). */
  updateAudit(patch: Partial<Omit<MatchAuditJson, "general" | "contact">>): Promise<void>;
  /** Deep-merge a partial TrackAudit into the named track. */
  updateTrack(track: TrackKind, patch: Partial<TrackAudit>): Promise<void>;
  saveTrackResult(
    track: TrackKind,
    parsed: GeneralParsedResult | ContactParsedResult,
    audit: MatchAuditJson
  ): Promise<void>;
  /** Append a single error entry to the top-level audit error log. */
  appendError(error: { message: string; timestamp: string; track?: TrackKind }): Promise<void>;
}
