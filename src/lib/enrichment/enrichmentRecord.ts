import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  MatchAuditJson,
  TrackAudit,
  TrackKind,
} from "@/types/enrichment";
import { deriveOverallStatus } from "./auditMigration";

function emptyAudit(): MatchAuditJson {
  return {
    runId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    general: { status: "not_started" },
    contact: { status: "not_started" },
    errors: [],
  };
}

export async function getEnrichmentAudit(
  entityType: string,
  entityId: number
): Promise<MatchAuditJson | null> {
  const record = await prisma.enrichmentRecord.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { matchAuditJson: true },
  });
  const raw = record?.matchAuditJson;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as unknown as MatchAuditJson;
}

async function readCurrent(
  entityType: string,
  entityId: number
): Promise<MatchAuditJson> {
  const existing = await getEnrichmentAudit(entityType, entityId);
  return existing ?? emptyAudit();
}

async function persist(
  entityType: string,
  entityId: number,
  audit: MatchAuditJson
): Promise<void> {
  const overallStatus = deriveOverallStatus(audit);
  await prisma.enrichmentRecord.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    create: {
      entityType,
      entityId,
      matchAuditJson: audit as unknown as Prisma.InputJsonValue,
      enrichmentStatus: overallStatus,
    },
    update: {
      matchAuditJson: audit as unknown as Prisma.InputJsonValue,
      enrichmentStatus: overallStatus,
    },
  });
}

/** Patch top-level audit fields (runId, startedAt, completedAt, errors). */
export async function updateEnrichmentAudit(
  entityType: string,
  entityId: number,
  patch: Partial<Omit<MatchAuditJson, "general" | "contact">>
): Promise<void> {
  const current = await readCurrent(entityType, entityId);
  const merged: MatchAuditJson = {
    ...current,
    ...patch,
    // errors: append, don't replace, unless patch explicitly contains an array
    errors: patch.errors !== undefined ? patch.errors : current.errors,
  };
  await persist(entityType, entityId, merged);
}

/** Deep-merge a partial TrackAudit into one track. */
export async function updateEnrichmentTrack(
  entityType: string,
  entityId: number,
  track: TrackKind,
  patch: Partial<TrackAudit>
): Promise<void> {
  const current = await readCurrent(entityType, entityId);
  const mergedTrack: TrackAudit = { ...current[track], ...patch };
  const merged: MatchAuditJson = { ...current, [track]: mergedTrack };
  await persist(entityType, entityId, merged);
}

/** Replace the entire audit (used by saveTrackResult to commit final state). */
export async function replaceEnrichmentAudit(
  entityType: string,
  entityId: number,
  audit: MatchAuditJson
): Promise<void> {
  await persist(entityType, entityId, audit);
}

/** Append a single error entry, optionally tagged with the track that produced it. */
export async function appendEnrichmentError(
  entityType: string,
  entityId: number,
  error: { message: string; timestamp: string; track?: TrackKind }
): Promise<void> {
  const current = await readCurrent(entityType, entityId);
  const merged: MatchAuditJson = {
    ...current,
    errors: [...(current.errors ?? []), error],
  };
  await persist(entityType, entityId, merged);
}
