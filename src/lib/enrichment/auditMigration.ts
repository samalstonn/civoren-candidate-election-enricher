import type { MatchAuditJson, EnrichmentStatus } from "@/types/enrichment";

/** Compute the overall enrichmentStatus from per-track statuses. */
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

export function deriveOverallStatus(audit: MatchAuditJson): EnrichmentStatus {
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
