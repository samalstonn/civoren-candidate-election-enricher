import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ParsedEnrichmentResult, MatchAuditJson } from "@/types/enrichment";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

function isValidPhone(v: string): boolean {
  return v.replace(/\D/g, "").length >= 10;
}

export async function saveEnrichmentResult(
  rowId: number,
  parsed: ParsedEnrichmentResult,
  auditJson: MatchAuditJson
): Promise<void> {
  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    select: { state: true, rawData: true, position: true, email: true, phone: true },
  });

  const finalSavedFields: Record<string, unknown> = {};

  let emailToSave: string | null = null;
  if (parsed.email) {
    if (row?.email) {
      finalSavedFields.emailSkipped = "existing value preserved";
    } else if (!isValidEmail(parsed.email)) {
      finalSavedFields.emailSkipped = `invalid format: ${parsed.email}`;
    } else {
      emailToSave = parsed.email.trim().toLowerCase();
      finalSavedFields.email = emailToSave;
    }
  }

  let phoneToSave: string | null = null;
  if (parsed.phone) {
    if (row?.phone) {
      finalSavedFields.phoneSkipped = "existing value preserved";
    } else if (!isValidPhone(parsed.phone)) {
      finalSavedFields.phoneSkipped = `invalid format: ${parsed.phone}`;
    } else {
      phoneToSave = parsed.phone.trim();
      finalSavedFields.phone = phoneToSave;
    }
  }

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
      ...(emailToSave ? { email: emailToSave } : {}),
      ...(phoneToSave ? { phone: phoneToSave } : {}),
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
