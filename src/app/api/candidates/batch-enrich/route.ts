import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import { LiveCandidateAdapter } from "@/lib/enrichment/adapters/live-candidate";
import { runWithConcurrency } from "@/lib/concurrency";
import { cancelRegistry, activeBatches } from "@/lib/cancelRegistry";
import { CANDIDATES_BATCH_KEY } from "@/lib/batchKeys";

const _concurrencyEnv = process.env.ENRICHMENT_CONCURRENCY;
if (!_concurrencyEnv) throw new Error("ENRICHMENT_CONCURRENCY is not set");
const CONCURRENCY = parseInt(_concurrencyEnv, 10);
if (isNaN(CONCURRENCY) || CONCURRENCY < 1)
  throw new Error("ENRICHMENT_CONCURRENCY must be a positive integer");

export async function POST(req: Request) {
  let candidateIds: number[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.candidateIds)) {
      candidateIds = body.candidateIds
        .map((v: unknown) => (typeof v === "number" ? v : parseInt(String(v), 10)))
        .filter((n: number) => Number.isInteger(n));
    }
  } catch {
    // no body
  }

  if (candidateIds.length === 0) {
    return NextResponse.json({ error: "candidateIds is required" }, { status: 400 });
  }

  // Refuse to start a second batch on top of an existing one — keeps activeBatches
  // bookkeeping (and cancel button visibility) consistent.
  if (activeBatches.has(CANDIDATES_BATCH_KEY)) {
    return NextResponse.json(
      { error: "A candidates batch is already running" },
      { status: 409 }
    );
  }

  // Reserve the slot immediately so the status endpoint reports running from
  // the moment this request begins, before eligibility queries finish.
  const processing = new Set<number>();
  activeBatches.set(CANDIDATES_BATCH_KEY, {
    total: candidateIds.length,
    startedAt: Date.now(),
    processing,
  });
  cancelRegistry.delete(CANDIDATES_BATCH_KEY);

  try {
    const existing = await prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true },
    });
    const records = await prisma.enrichmentRecord.findMany({
      where: { entityType: "candidate", entityId: { in: existing.map((c) => c.id) } },
      select: { entityId: true, enrichmentStatus: true },
    });
    const statusByCandidate = new Map(records.map((r) => [r.entityId, r.enrichmentStatus]));
    // Anything not already complete is fair game. Pending statuses from prior
    // runs (e.g. after a server restart) become eligible again here.
    const eligible = existing.filter((c) => {
      const s = statusByCandidate.get(c.id) ?? null;
      return s !== "result_saved";
    });

    if (eligible.length === 0) {
      return NextResponse.json({ message: "No eligible candidates to enrich", count: 0 });
    }

    // Update total with the post-filter count.
    const entry = activeBatches.get(CANDIDATES_BATCH_KEY);
    if (entry) entry.total = eligible.length;

    const settled = await runWithConcurrency(
      eligible.map((row) => async () => {
        if (cancelRegistry.has(CANDIDATES_BATCH_KEY)) return row.id;
        processing.add(row.id);
        try {
          const adapter = await LiveCandidateAdapter.create(row.id);
          await runEnrichmentPipeline(adapter, "full");
        } finally {
          processing.delete(row.id);
        }
        return row.id;
      }),
      CONCURRENCY
    );

    const results = settled.map((r, i) => ({
      candidateId: eligible[i].id,
      ...(r.status === "rejected" ? { error: String(r.reason) } : {}),
    }));

    return NextResponse.json({ count: eligible.length, results });
  } finally {
    cancelRegistry.delete(CANDIDATES_BATCH_KEY);
    activeBatches.delete(CANDIDATES_BATCH_KEY);
  }
}
