import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ParsedEnrichmentResult, MatchAuditJson } from "@/types/enrichment";

export async function saveEnrichmentResult(
  rowId: number,
  parsed: ParsedEnrichmentResult,
  auditJson: MatchAuditJson
): Promise<void> {
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
      enrichmentStatus: "result_saved",
      matchAuditJson: completedAudit as unknown as Prisma.InputJsonValue,
    },
  });
}
