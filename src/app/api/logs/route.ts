import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rowId = searchParams.get("rowId") ? parseInt(searchParams.get("rowId")!, 10) : undefined;
  const submissionId = searchParams.get("submissionId") ? parseInt(searchParams.get("submissionId")!, 10) : undefined;
  const apiType = searchParams.get("apiType") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10), 1);

  const where = {
    ...(rowId ? { rowId } : {}),
    ...(submissionId ? { submissionId } : {}),
    ...(apiType ? { apiType } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.apiCallLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.apiCallLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
