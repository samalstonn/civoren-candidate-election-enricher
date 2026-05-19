import { NextResponse } from "next/server";
import { cancelRegistry } from "@/lib/cancelRegistry";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const submissionId = parseInt(id, 10);
  if (isNaN(submissionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  cancelRegistry.add(`submission:${submissionId}`);
  return NextResponse.json({ ok: true });
}
