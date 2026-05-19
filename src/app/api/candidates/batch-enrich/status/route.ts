import { NextResponse } from "next/server";
import { activeBatches } from "@/lib/cancelRegistry";
import { CANDIDATES_BATCH_KEY } from "@/lib/batchKeys";

export async function GET() {
  const entry = activeBatches.get(CANDIDATES_BATCH_KEY);
  return NextResponse.json({
    running: Boolean(entry),
    total: entry?.total ?? 0,
    startedAt: entry?.startedAt ?? null,
  });
}
