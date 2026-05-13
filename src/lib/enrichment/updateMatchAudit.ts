import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { MatchAuditJson } from "@/types/enrichment";

export async function updateMatchAudit(
  rowId: number,
  patch: Partial<MatchAuditJson>
): Promise<void> {
  const existing = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    select: { matchAuditJson: true },
  });

  const current =
    existing?.matchAuditJson &&
    typeof existing.matchAuditJson === "object" &&
    !Array.isArray(existing.matchAuditJson)
      ? (existing.matchAuditJson as Partial<MatchAuditJson>)
      : {};

  const updated: Partial<MatchAuditJson> = { ...current, ...patch };

  await prisma.crmIntakeDraftRow.update({
    where: { id: rowId },
    data: {
      matchAuditJson: updated as unknown as Prisma.InputJsonValue,
      ...(patch.status ? { enrichmentStatus: patch.status } : {}),
    },
  });
}
