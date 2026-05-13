import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ParsedEnrichmentResult, MatchAuditJson } from "@/types/enrichment";

export async function saveEnrichmentResult(
  rowId: number,
  parsed: ParsedEnrichmentResult,
  auditJson: MatchAuditJson
): Promise<void> {
  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    select: { state: true, rawData: true, position: true },
  });

  const finalSavedFields: Record<string, unknown> = {};

  if (parsed.email) finalSavedFields.email = parsed.email;
  if (parsed.phone) finalSavedFields.phone = parsed.phone;
  if (parsed.confidence !== undefined)
    finalSavedFields.confidence = parsed.confidence;
  if (parsed.biography || parsed.notes) {
    finalSavedFields.reviewerNotes = [parsed.biography, parsed.notes]
      .filter(Boolean)
      .join("\n\n");
  }

  const currentRoleFallback = row?.position ? `Candidate for ${row.position}` : null;
  const currentRole = parsed.currentRole || currentRoleFallback;

  const profileEnrichment = {
    bio: parsed.biography || null,
    currentRole,
    currentCity: parsed.currentCity || null,
    currentState: row?.state || null,
    confidence: parsed.confidence ?? null,
    sources: parsed.sourceUrls || [],
    model: "gemini",
    enrichedAt: new Date().toISOString(),
  };

  const existingRaw =
    row?.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)
      ? (row.rawData as Record<string, unknown>)
      : {};
  const newRawData = { ...existingRaw, _profileEnrichment: profileEnrichment };

  const completedAudit: MatchAuditJson = {
    ...auditJson,
    status: "result_saved",
    completedAt: new Date().toISOString(),
    finalSavedFields,
  };

  await prisma.crmIntakeDraftRow.update({
    where: { id: rowId },
    data: {
      ...(parsed.email ? { email: parsed.email } : {}),
      ...(parsed.phone ? { phone: parsed.phone } : {}),
      ...(parsed.confidence !== undefined
        ? { confidence: parsed.confidence }
        : {}),
      ...(finalSavedFields.reviewerNotes
        ? { reviewerNotes: finalSavedFields.reviewerNotes as string }
        : {}),
      rawData: newRawData as unknown as Prisma.InputJsonValue,
      enrichmentStatus: "result_saved",
      matchAuditJson: completedAudit as unknown as Prisma.InputJsonValue,
    },
  });
}
