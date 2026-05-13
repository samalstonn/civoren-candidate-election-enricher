import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const submissions = await prisma.crmIntakeSubmission.findMany({
    orderBy: { receivedAt: "desc" },
    take: 100,
    include: {
      draftRows: {
        select: { id: true, enrichmentStatus: true },
      },
    },
  });

  const data = submissions.map((s: (typeof submissions)[number]) => {
    const rows: Array<{ id: number; enrichmentStatus: string | null }> = s.draftRows;
    const counts = {
      total: rows.length,
      not_started: rows.filter((r) => !r.enrichmentStatus || r.enrichmentStatus === "not_started").length,
      running: rows.filter((r) =>
        ["search_queued", "search_running", "search_complete", "gemini_queued", "gemini_running"].includes(r.enrichmentStatus ?? "")
      ).length,
      complete: rows.filter((r) =>
        ["gemini_complete", "result_saved"].includes(r.enrichmentStatus ?? "")
      ).length,
      failed: rows.filter((r) => r.enrichmentStatus === "failed").length,
      needs_review: rows.filter((r) => r.enrichmentStatus === "needs_review").length,
    };

    return {
      id: s.id,
      sourceType: s.sourceType,
      status: s.status,
      targetState: s.targetState,
      targetCounty: s.targetCounty,
      targetScope: s.targetScope,
      targetAuthorityName: s.targetAuthorityName,
      defaultYear: s.defaultYear,
      receivedAt: s.receivedAt,
      sheetDescription: s.sheetDescription,
      counts,
    };
  });

  return NextResponse.json(data);
}
