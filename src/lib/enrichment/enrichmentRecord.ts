import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { MatchAuditJson } from "@/types/enrichment";

export async function getEnrichmentAudit(
  entityType: string,
  entityId: number
): Promise<MatchAuditJson | null> {
  const record = await prisma.enrichmentRecord.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { matchAuditJson: true },
  });
  const raw = record?.matchAuditJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as unknown as MatchAuditJson;
  }
  return null;
}

export async function updateEnrichmentAudit(
  entityType: string,
  entityId: number,
  patch: Partial<MatchAuditJson>
): Promise<void> {
  const existing = await prisma.enrichmentRecord.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { matchAuditJson: true },
  });

  const current =
    existing?.matchAuditJson &&
    typeof existing.matchAuditJson === "object" &&
    !Array.isArray(existing.matchAuditJson)
      ? (existing.matchAuditJson as Partial<MatchAuditJson>)
      : {};

  const updated: Partial<MatchAuditJson> = { ...current, ...patch };

  await prisma.enrichmentRecord.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    create: {
      entityType,
      entityId,
      matchAuditJson: updated as unknown as Prisma.InputJsonValue,
      ...(patch.status ? { enrichmentStatus: patch.status } : {}),
    },
    update: {
      matchAuditJson: updated as unknown as Prisma.InputJsonValue,
      ...(patch.status ? { enrichmentStatus: patch.status } : {}),
    },
  });
}
