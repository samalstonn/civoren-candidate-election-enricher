import type {
  GeneralParsedResult,
  ContactParsedResult,
  OverviewParsedResult,
  TrackKind,
} from "@/types/enrichment";

function parseJson(rawText: string): Record<string, unknown> {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${rawText}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini response was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
}
function asConfidence(v: unknown): number | undefined {
  return typeof v === "number" ? Math.min(1, Math.max(0, v)) : undefined;
}
function asPositiveInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n >= 1 ? n : null;
}
function asClassification(
  v: unknown
): "primary" | "general" | "special" | "runoff" | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "primary" || s === "general" || s === "special" || s === "runoff") return s;
  return null;
}

export function parseGeneralResult(rawText: string): GeneralParsedResult {
  const obj = parseJson(rawText);
  return {
    biography: asString(obj.biography),
    currentRole: asStringOrNull(obj.currentRole),
    currentCity: asStringOrNull(obj.currentCity),
    currentState: asStringOrNull(obj.currentState),
    party: asStringOrNull(obj.party),
    sourceUrls: asStringArray(obj.sourceUrls),
    confidence: asConfidence(obj.confidence),
    notes: asString(obj.notes),
  };
}

export function parseContactResult(rawText: string): ContactParsedResult {
  const obj = parseJson(rawText);
  return {
    email: asStringOrNull(obj.email),
    phone: asStringOrNull(obj.phone),
    linkedin: asStringOrNull(obj.linkedin),
    website: asStringOrNull(obj.website),
    sourceUrls: asStringArray(obj.sourceUrls),
    confidence: asConfidence(obj.confidence),
    notes: asString(obj.notes),
  };
}

export function parseOverviewResult(rawText: string): OverviewParsedResult {
  const obj = parseJson(rawText);
  return {
    description: asString(obj.description),
    electionClassification: asClassification(obj.electionClassification),
    date: asStringOrNull(obj.date),
    positions: asPositiveInt(obj.positions),
    filingAuthorityName: asStringOrNull(obj.filingAuthorityName),
    filingAuthorityLevel: asStringOrNull(obj.filingAuthorityLevel),
    filingAuthorityType: asStringOrNull(obj.filingAuthorityType),
    sourceUrls: asStringArray(obj.sourceUrls),
    confidence: asConfidence(obj.confidence),
    notes: asString(obj.notes),
  };
}

export function parseTrackResult(track: TrackKind, rawText: string) {
  if (track === "general") return parseGeneralResult(rawText);
  if (track === "contact") return parseContactResult(rawText);
  return parseOverviewResult(rawText);
}
