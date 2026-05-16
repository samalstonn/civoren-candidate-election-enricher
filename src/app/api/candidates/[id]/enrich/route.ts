import { NextResponse } from "next/server";
import {
  runEnrichmentPipeline,
  normalizePipelineMode,
} from "@/lib/enrichment/pipeline";
import { LiveCandidateAdapter } from "@/lib/enrichment/adapters/live-candidate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const candidateId = parseInt(id, 10);
  if (isNaN(candidateId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let rawMode = "full";
  try {
    const body = await req.json();
    if (typeof body?.mode === "string") rawMode = body.mode;
  } catch {
    // no body or invalid JSON — use default
  }

  const modes = normalizePipelineMode(rawMode);
  if (modes.length === 0) {
    return NextResponse.json({ error: `Unknown mode: ${rawMode}` }, { status: 400 });
  }

  try {
    const adapter = await LiveCandidateAdapter.create(candidateId);
    for (const mode of modes) {
      await runEnrichmentPipeline(adapter, mode);
    }
    return NextResponse.json({ success: true, candidateId, modes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
