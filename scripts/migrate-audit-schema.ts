/**
 * One-time migration: rewrite legacy flat-shape `matchAuditJson` blobs to the
 * new track-split shape on both `EnrichmentRecord` and `CrmIntakeDraftRow`.
 *
 * Idempotent — already-new-shape rows (have a `general` key) are skipped.
 *
 *   npm run migrate:audit            # do it
 *   npm run migrate:audit:dry        # report only
 *   npm run migrate:audit -- --table=enrichment
 *   npm run migrate:audit -- --table=intake
 *
 * Logic mirrors `migrateLegacyAudit` + `deriveOverallStatus` from
 * `src/lib/enrichment/auditMigration.ts` — inlined here so the script keeps
 * working after Phase 2 deletes those exports.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");
const TABLE_ARG = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1] ?? "all";
if (!["all", "enrichment", "intake"].includes(TABLE_ARG)) {
  console.error(`Invalid --table value: ${TABLE_ARG}`);
  process.exit(1);
}
const BATCH_SIZE = 500;

type EnrichmentStatus =
  | "not_started"
  | "search_queued"
  | "search_running"
  | "search_complete"
  | "gemini_queued"
  | "gemini_running"
  | "gemini_complete"
  | "result_saved"
  | "failed"
  | "needs_review";

type TrackKind = "general" | "contact";

interface TrackAudit {
  status: EnrichmentStatus;
  searchQuery?: string;
  searchRawResponse?: unknown;
  rankedSources?: { url: string; title: string; score: number; content: string }[];
  selectedSources?: unknown[];
  geminiPrompt?: string;
  geminiRawResponse?: string;
  parsedResult?: unknown;
  finalSavedFields?: Record<string, unknown>;
}

interface MatchAuditJson {
  runId: string;
  startedAt: string;
  completedAt?: string;
  general: TrackAudit;
  contact: TrackAudit;
  errors?: { message: string; timestamp: string; track?: TrackKind }[];
}

const STAGE_ORDER: EnrichmentStatus[] = [
  "not_started",
  "search_queued",
  "search_running",
  "search_complete",
  "gemini_queued",
  "gemini_running",
  "gemini_complete",
  "result_saved",
];

function deriveOverallStatus(audit: MatchAuditJson): EnrichmentStatus {
  const g = audit.general.status;
  const c = audit.contact.status;
  if (g === "failed" || c === "failed") return "failed";
  if (g === "needs_review" || c === "needs_review") return "needs_review";
  if (g === "result_saved" && c === "result_saved") return "result_saved";
  const gi = STAGE_ORDER.indexOf(g);
  const ci = STAGE_ORDER.indexOf(c);
  const lower = Math.min(gi >= 0 ? gi : 0, ci >= 0 ? ci : 0);
  return STAGE_ORDER[lower] ?? "not_started";
}

function emptyTrack(): TrackAudit {
  return { status: "not_started" };
}

type LegacyAudit = {
  runId?: string;
  status?: EnrichmentStatus;
  startedAt?: string;
  completedAt?: string;
  searchQuery?: string;
  contactSearchQuery?: string;
  searchRawResponse?: unknown;
  contactSearchRawResponse?: unknown;
  rankedSources?: {
    url: string;
    title: string;
    sourceQuery?: TrackKind;
    score: number;
    content: string;
  }[];
  selectedSources?: { url?: string; title?: string; content?: string; sourceQuery?: TrackKind }[];
  geminiPrompt?: string;
  geminiRawResponse?: string;
  parsedResult?: Record<string, unknown>;
  finalSavedFields?: Record<string, unknown>;
  errors?: { message: string; timestamp: string }[];
};

/**
 * Returns:
 *   { migrated: MatchAuditJson }  — legacy shape, projected; writer should persist it
 *   { skip: "already_new" }       — has a `general` or `contact` key already
 *   { skip: "null" }              — input was null/non-object
 */
function projectLegacyAudit(
  raw: unknown
):
  | { migrated: MatchAuditJson }
  | { skip: "already_new" | "null" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { skip: "null" };
  }
  const obj = raw as Record<string, unknown>;
  if ("general" in obj || "contact" in obj) {
    return { skip: "already_new" };
  }

  const legacy = obj as LegacyAudit;
  const generalSelected = (legacy.selectedSources ?? []).filter(
    (s) => !s.sourceQuery || s.sourceQuery === "general"
  );
  const contactSelected = (legacy.selectedSources ?? []).filter(
    (s) => s.sourceQuery === "contact"
  );
  const generalRanked = (legacy.rankedSources ?? [])
    .filter((s) => !s.sourceQuery || s.sourceQuery === "general")
    .map(({ url, title, score, content }) => ({ url, title, score, content }));
  const contactRanked = (legacy.rankedSources ?? [])
    .filter((s) => s.sourceQuery === "contact")
    .map(({ url, title, score, content }) => ({ url, title, score, content }));

  const general: TrackAudit = {
    status: legacy.status ?? "not_started",
    searchQuery: legacy.searchQuery,
    searchRawResponse: legacy.searchRawResponse,
    rankedSources: generalRanked.length ? generalRanked : undefined,
    selectedSources: generalSelected.length ? generalSelected : undefined,
    geminiPrompt: legacy.geminiPrompt,
    geminiRawResponse: legacy.geminiRawResponse,
    parsedResult: legacy.parsedResult,
    finalSavedFields: legacy.finalSavedFields,
  };
  const contact: TrackAudit = {
    status: "not_started",
    searchQuery: legacy.contactSearchQuery,
    searchRawResponse: legacy.contactSearchRawResponse,
    rankedSources: contactRanked.length ? contactRanked : undefined,
    selectedSources: contactSelected.length ? contactSelected : undefined,
  };

  const migrated: MatchAuditJson = {
    runId: legacy.runId ?? crypto.randomUUID(),
    startedAt: legacy.startedAt ?? new Date().toISOString(),
    completedAt: legacy.completedAt,
    general,
    contact,
    errors: legacy.errors ?? [],
  };
  return { migrated };
}

interface TableStats {
  total: number;
  migrated: number;
  already_new: number;
  null_audit: number;
  errors: number;
}

function newStats(): TableStats {
  return { total: 0, migrated: 0, already_new: 0, null_audit: 0, errors: 0 };
}

function printProgress(label: string, stats: TableStats) {
  console.log(
    `[${label}] processed=${stats.total} migrated=${stats.migrated} already_new=${stats.already_new} null=${stats.null_audit} errors=${stats.errors}`
  );
}

async function migrateEnrichmentRecord(): Promise<TableStats> {
  const stats = newStats();
  const total = await prisma.enrichmentRecord.count();
  console.log(`[EnrichmentRecord] starting — ${total} rows total`);

  let cursor: { entityType: string; entityId: number } | undefined;

  while (true) {
    const batch = await prisma.enrichmentRecord.findMany({
      take: BATCH_SIZE,
      ...(cursor
        ? {
            skip: 1,
            cursor: { entityType_entityId: cursor },
          }
        : {}),
      orderBy: [{ entityType: "asc" }, { entityId: "asc" }],
      select: { entityType: true, entityId: true, matchAuditJson: true },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      stats.total++;
      try {
        const result = projectLegacyAudit(row.matchAuditJson);
        if ("skip" in result) {
          if (result.skip === "already_new") stats.already_new++;
          else stats.null_audit++;
          continue;
        }
        if (!DRY_RUN) {
          await prisma.enrichmentRecord.update({
            where: {
              entityType_entityId: {
                entityType: row.entityType,
                entityId: row.entityId,
              },
            },
            data: {
              matchAuditJson: result.migrated as unknown as Prisma.InputJsonValue,
              enrichmentStatus: deriveOverallStatus(result.migrated),
            },
          });
        }
        stats.migrated++;
      } catch (err) {
        stats.errors++;
        console.error(
          `[EnrichmentRecord] failed entityType=${row.entityType} entityId=${row.entityId}:`,
          err
        );
      }
    }

    printProgress("EnrichmentRecord", stats);

    const last = batch[batch.length - 1];
    cursor = { entityType: last.entityType, entityId: last.entityId };
    if (batch.length < BATCH_SIZE) break;
  }

  return stats;
}

async function migrateIntakeRows(): Promise<TableStats> {
  const stats = newStats();
  const total = await prisma.crmIntakeDraftRow.count();
  console.log(`[CrmIntakeDraftRow] starting — ${total} rows total`);

  let cursor: number | undefined;

  while (true) {
    const batch = await prisma.crmIntakeDraftRow.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, matchAuditJson: true },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      stats.total++;
      try {
        const result = projectLegacyAudit(row.matchAuditJson);
        if ("skip" in result) {
          if (result.skip === "already_new") stats.already_new++;
          else stats.null_audit++;
          continue;
        }
        if (!DRY_RUN) {
          await prisma.crmIntakeDraftRow.update({
            where: { id: row.id },
            data: {
              matchAuditJson: result.migrated as unknown as Prisma.InputJsonValue,
              enrichmentStatus: deriveOverallStatus(result.migrated),
            },
          });
        }
        stats.migrated++;
      } catch (err) {
        stats.errors++;
        console.error(`[CrmIntakeDraftRow] failed id=${row.id}:`, err);
      }
    }

    printProgress("CrmIntakeDraftRow", stats);

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  return stats;
}

async function main() {
  console.log(
    `Audit schema migration — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"} — table=${TABLE_ARG}`
  );
  console.log("");

  let enrichStats: TableStats | null = null;
  let intakeStats: TableStats | null = null;

  if (TABLE_ARG === "all" || TABLE_ARG === "enrichment") {
    enrichStats = await migrateEnrichmentRecord();
    console.log("");
  }
  if (TABLE_ARG === "all" || TABLE_ARG === "intake") {
    intakeStats = await migrateIntakeRows();
    console.log("");
  }

  console.log("=== Summary ===");
  if (enrichStats) printProgress("EnrichmentRecord", enrichStats);
  if (intakeStats) printProgress("CrmIntakeDraftRow", intakeStats);
  if (DRY_RUN) console.log("(dry-run — no writes were issued)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
