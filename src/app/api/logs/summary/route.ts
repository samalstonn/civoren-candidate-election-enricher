import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rowId = searchParams.get("rowId") ? parseInt(searchParams.get("rowId")!, 10) : undefined;
  const submissionId = searchParams.get("submissionId") ? parseInt(searchParams.get("submissionId")!, 10) : undefined;

  const where = {
    ...(rowId ? { rowId } : {}),
    ...(submissionId ? { submissionId } : {}),
  };

  const rows = await prisma.apiCallLog.groupBy({
    by: ["apiType"],
    where,
    _count: { id: true },
    _sum: { totalTokens: true, promptTokens: true, outputTokens: true, costUsd: true, latencyMs: true },
  });

  const summary = rows.map((r) => ({
    apiType: r.apiType,
    calls: r._count.id,
    totalTokens: r._sum.totalTokens,
    promptTokens: r._sum.promptTokens,
    outputTokens: r._sum.outputTokens,
    totalCostUsd: r._sum.costUsd,
    avgLatencyMs: r._sum.latencyMs != null && r._count.id > 0
      ? Math.round(r._sum.latencyMs / r._count.id)
      : null,
  }));

  return NextResponse.json({ summary });
}
