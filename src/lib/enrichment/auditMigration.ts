import type { MatchAuditJson, EnrichmentStatus } from "@/types/enrichment";
import { allTrackIds } from "./registry";

/** Stage ordering for the "least-advanced" rollup. */
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

function indexOf(s: EnrichmentStatus): number {
  const i = STAGE_ORDER.indexOf(s);
  return i >= 0 ? i : 0;
}

/**
 * Derive the single `enrichmentStatus` column value from every present track
 * in the audit. A row only contains track keys for its own entity kind; absent
 * keys are ignored by the rollup.
 */
export function deriveOverallStatus(audit: MatchAuditJson): EnrichmentStatus {
  const present = allTrackIds()
    .map((id) => audit[id]?.status)
    .filter((s): s is EnrichmentStatus => Boolean(s));

  if (present.length === 0) return "not_started";
  if (present.some((s) => s === "failed")) return "failed";
  if (present.some((s) => s === "needs_review")) return "needs_review";
  if (present.every((s) => s === "result_saved")) return "result_saved";

  // Least-advanced of the present tracks.
  const minIdx = present.reduce((m, s) => Math.min(m, indexOf(s)), STAGE_ORDER.length - 1);
  return STAGE_ORDER[minIdx];
}
