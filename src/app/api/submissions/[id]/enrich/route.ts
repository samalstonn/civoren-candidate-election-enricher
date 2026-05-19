import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { PipelineModeFor } from "@/lib/enrichment/pipeline";
import { CandidateIntakeAdapter } from "@/lib/enrichment/adapters/candidate-intake";
import { runWithConcurrency } from "@/lib/concurrency";
import { cancelRegistry } from "@/lib/cancelRegistry";

const _concurrencyEnv = process.env.ENRICHMENT_CONCURRENCY;
if (!_concurrencyEnv) throw new Error("ENRICHMENT_CONCURRENCY is not set");
const CONCURRENCY = parseInt(_concurrencyEnv, 10);
if (isNaN(CONCURRENCY) || CONCURRENCY < 1) throw new Error("ENRICHMENT_CONCURRENCY must be a positive integer");

type Target = "not_started" | "all_failed" | "search_failed" | "gemini_failed" | "save_failed" | "all_eligible";

function auditStatus(matchAuditJson: unknown): string | null {
  if (matchAuditJson && typeof matchAuditJson === "object" && !Array.isArray(matchAuditJson)) {
    const obj = matchAuditJson as Record<string, unknown>;
    // New shape: pick the less-advanced of the two track statuses; legacy: top-level status.
    const general = obj.general && typeof obj.general === "object"
      ? ((obj.general as Record<string, unknown>).status as string | undefined)
      : undefined;
    const contact = obj.contact && typeof obj.contact === "object"
      ? ((obj.contact as Record<string, unknown>).status as string | undefined)
      : undefined;
    if (general || contact) return general ?? contact ?? null;
    const s = obj.status;
    return typeof s === "string" ? s : null;
  }
  return null;
}

// The legacy stage-resume optimization (re-run only `gemini` or `save` on a failed row)
// doesn't translate cleanly to two parallel tracks. For v1, always retry `full`.
function resumeMode(_enrichmentStatus: string | null, _lastAuditStatus: string | null): PipelineModeFor<"candidate"> {
  return "full";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const submissionId = parseInt(id, 10);
  if (isNaN(submissionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let target: Target = "all_eligible";
  try {
    const body = await req.json();
    if (body?.target) target = body.target as Target;
  } catch {
    // no body — use default
  }

  const allEligible = await prisma.crmIntakeDraftRow.findMany({
    where: {
      submissionId,
      OR: [
        { enrichmentStatus: "not_started" },
        { enrichmentStatus: null },
        { enrichmentStatus: "failed" },
      ],
    },
    select: { id: true, enrichmentStatus: true, matchAuditJson: true },
  });

  const rows = allEligible.filter((row: (typeof allEligible)[number]) => {
    const lastStatus = auditStatus(row.matchAuditJson);
    switch (target) {
      case "not_started":
        return !row.enrichmentStatus || row.enrichmentStatus === "not_started";
      case "all_failed":
        return row.enrichmentStatus === "failed";
      case "search_failed":
        return row.enrichmentStatus === "failed" && lastStatus !== "search_complete" && lastStatus !== "gemini_complete";
      case "gemini_failed":
        return row.enrichmentStatus === "failed" && lastStatus === "search_complete";
      case "save_failed":
        return row.enrichmentStatus === "failed" && lastStatus === "gemini_complete";
      default:
        return true;
    }
  });

  if (rows.length === 0) {
    return NextResponse.json({ message: "No eligible rows to enrich", count: 0 });
  }

  cancelRegistry.delete(`submission:${submissionId}`);

  let settled: Awaited<ReturnType<typeof runWithConcurrency>>;
  try {
    settled = await runWithConcurrency(
      rows.map((row: (typeof rows)[number]) => async () => {
        if (cancelRegistry.has(`submission:${submissionId}`)) return row.id;
        const mode = resumeMode(row.enrichmentStatus, auditStatus(row.matchAuditJson));
        const adapter = await CandidateIntakeAdapter.create(row.id);
        await runEnrichmentPipeline(adapter, mode);
        return row.id;
      }),
      CONCURRENCY
    );
  } finally {
    cancelRegistry.delete(`submission:${submissionId}`);
  }

  const results = settled!.map((r, i) => ({
    rowId: rows[i].id,
    ...(r.status === "rejected" ? { error: String(r.reason) } : {}),
  }));

  return NextResponse.json({ count: rows.length, results });
}
