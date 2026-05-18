import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateIntakeAdapter } from "@/lib/enrichment/adapters/candidate-intake";
import { trackIds } from "@/lib/enrichment/registry";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rowId = parseInt(id, 10);
  if (isNaN(rowId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = await prisma.crmIntakeDraftRow.findUnique({
    where: { id: rowId },
    include: { submission: true },
  });

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Pre-compute search-query previews so the UI can show them in the
  // artifacts section before any pipeline run.
  let previewQueries: Record<string, string> = {};
  try {
    const adapter = await CandidateIntakeAdapter.create(rowId);
    for (const id of trackIds("candidate")) {
      previewQueries[id] = adapter.tracks[id].buildSearchQuery();
    }
  } catch {
    previewQueries = {};
  }

  return NextResponse.json({ ...row, previewQueries });
}
