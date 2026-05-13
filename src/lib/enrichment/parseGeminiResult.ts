import type { ParsedEnrichmentResult } from "@/types/enrichment";

export function parseGeminiResult(rawText: string): ParsedEnrichmentResult {
  // Strip markdown code fences if Gemini wrapped the JSON
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

  const obj = parsed as Record<string, unknown>;

  return {
    biography: typeof obj.biography === "string" ? obj.biography : undefined,
    email: typeof obj.email === "string" ? obj.email : null,
    phone: typeof obj.phone === "string" ? obj.phone : null,
    sourceUrls: Array.isArray(obj.sourceUrls)
      ? (obj.sourceUrls as string[]).filter((u) => typeof u === "string")
      : [],
    confidence:
      typeof obj.confidence === "number"
        ? Math.min(1, Math.max(0, obj.confidence))
        : undefined,
    notes: typeof obj.notes === "string" ? obj.notes : undefined,
  };
}
