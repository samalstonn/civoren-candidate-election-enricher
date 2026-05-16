import type {
  GeneralParsedResult,
  ContactParsedResult,
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

export function parseTrackResult(track: TrackKind, rawText: string) {
  return track === "general" ? parseGeneralResult(rawText) : parseContactResult(rawText);
}
