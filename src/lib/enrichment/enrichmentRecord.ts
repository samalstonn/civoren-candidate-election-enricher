import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { MatchAuditJson, TrackAudit } from "@/types/enrichment";
import {
  trackIds,
  type EntityKind,
  type TrackIdFor,
  type AnyTrackId,
} from "./registry";
import { deriveOverallStatus } from "./auditMigration";
import {
  setTrackAtomic,
  setAuditFieldAtomic,
  appendErrorAtomic,
  refreshStatusMirror,
  type AuditStore,
} from "./atomicAudit";

function storeFor(entityType: string, entityId: number): AuditStore {
  return {
    table: "EnrichmentRecord",
    jsonCol: "matchAuditJson",
    statusCol: "enrichmentStatus",
    where: [
      { col: "entityType", value: entityType },
      { col: "entityId", value: entityId },
    ],
  };
}

function emptyAudit<K extends EntityKind>(entityKind: K): MatchAuditJson {
  const seeded: Partial<Record<AnyTrackId, TrackAudit>> = {};
  for (const id of trackIds(entityKind)) {
    seeded[id as AnyTrackId] = { status: "not_started" };
  }
  return {
    runId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    errors: [],
    ...seeded,
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

/**
 * Ensure an `EnrichmentRecord` row exists for this entity, seeded with a
 * fresh audit skeleton. Idempotent — won't clobber an existing row. Call
 * this once at the start of any pipeline run before the parallel tracks
 * begin issuing atomic patches.
 */
async function ensureRow<K extends EntityKind>(
  entityType: K,
  entityId: number
): Promise<void> {
  const seed = emptyAudit(entityType);
  await prisma.enrichmentRecord.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    create: {
      entityType,
      entityId,
      matchAuditJson: seed as unknown as Prisma.InputJsonValue,
      enrichmentStatus: "not_started",
    },
    update: {}, // existing rows untouched
  });
}

async function refreshStatus<K extends EntityKind>(
  entityType: K,
  entityId: number
): Promise<void> {
  await refreshStatusMirror(storeFor(entityType, entityId), async () => {
    const a = await getEnrichmentAudit(entityType, entityId);
    return a ? deriveOverallStatus(a) : null;
  });
}

/**
 * Update top-level audit fields. Used by the pipeline once at start (to stamp
 * a fresh runId/startedAt) and at end (to stamp completedAt) — both serial,
 * no race. For mid-flight error accumulation, use {@link appendEnrichmentError}.
 */
export async function updateEnrichmentAudit<K extends EntityKind>(
  entityType: K,
  entityId: number,
  patch: Partial<Pick<MatchAuditJson, "runId" | "startedAt" | "completedAt" | "errors">>
): Promise<void> {
  await ensureRow(entityType, entityId);
  const store = storeFor(entityType, entityId);
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await setAuditFieldAtomic(store, field, value);
  }
  await refreshStatus(entityType, entityId);
}

/**
 * Atomically merge `patch` into `audit[track]`. Safe under concurrent calls
 * for different tracks (the whole point of this refactor).
 */
export async function updateEnrichmentTrack<K extends EntityKind>(
  entityType: K,
  entityId: number,
  track: TrackIdFor<K>,
  patch: Partial<TrackAudit>
): Promise<void> {
  await ensureRow(entityType, entityId);
  await setTrackAtomic(storeFor(entityType, entityId), track, patch);
  await refreshStatus(entityType, entityId);
}

/**
 * Full-doc overwrite. Used by the migration script. Adapters should NOT call
 * this from concurrent code paths — use updateEnrichmentTrack instead.
 */
export async function replaceEnrichmentAudit(
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

/**
 * Append a single error entry. Safe under concurrent calls — both racing
 * failures land via Postgres `||` jsonb concat.
 */
export async function appendEnrichmentError<K extends EntityKind>(
  entityType: K,
  entityId: number,
  error: { message: string; timestamp: string; track?: TrackIdFor<K> }
): Promise<void> {
  await ensureRow(entityType, entityId);
  await appendErrorAtomic(storeFor(entityType, entityId), error);
  await refreshStatus(entityType, entityId);
}
