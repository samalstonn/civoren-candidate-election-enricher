import { NextResponse } from "next/server";
import { cancelRegistry } from "@/lib/cancelRegistry";
import { CANDIDATES_BATCH_KEY } from "@/lib/batchKeys";

export async function POST() {
  cancelRegistry.add(CANDIDATES_BATCH_KEY);
  return NextResponse.json({ ok: true });
}
