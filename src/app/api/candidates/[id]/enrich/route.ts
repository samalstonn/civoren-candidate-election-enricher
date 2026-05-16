import { NextResponse } from "next/server";
import { runEnrichmentPipeline, type PipelineMode } from "@/lib/enrichment/pipeline";
import { LiveCandidateAdapter } from "@/lib/enrichment/adapters/live-candidate";

const VALID_MODES: PipelineMode[] = ["search", "search_general", "search_contact", "gemini", "save", "full"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const candidateId = parseInt(id, 10);
  if (isNaN(candidateId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let mode: PipelineMode = "full";
  try {
    const body = await req.json();
    if (body?.mode && VALID_MODES.includes(body.mode)) mode = body.mode;
  } catch {
    // no body or invalid JSON — use default
  }

  try {
    const adapter = await LiveCandidateAdapter.create(candidateId);
    await runEnrichmentPipeline(adapter, mode);
    return NextResponse.json({ success: true, candidateId, mode });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
