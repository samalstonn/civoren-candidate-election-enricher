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

export interface ParsedEnrichmentResult {
  biography?: string;
  email?: string | null;
  phone?: string | null;
  sourceUrls?: string[];
  confidence?: number;
  notes?: string;
}

export interface MatchAuditJson {
  runId: string;
  status: EnrichmentStatus;
  startedAt: string;
  completedAt?: string;
  searchQuery: string;
  contactSearchQuery?: string;
  searchRawResponse?: unknown;
  contactSearchRawResponse?: unknown;
  rankedSources?: { url: string; title: string; sourceQuery?: "general" | "contact"; score: number; content: string }[];
  selectedSources?: TavilyResult[];
  geminiPrompt?: string;
  geminiRawResponse?: string;
  parsedResult?: ParsedEnrichmentResult;
  finalSavedFields?: Record<string, unknown>;
  errors?: { message: string; timestamp: string }[];
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  sourceQuery?: "general" | "contact";
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyResult[];
  answer?: string;
}
