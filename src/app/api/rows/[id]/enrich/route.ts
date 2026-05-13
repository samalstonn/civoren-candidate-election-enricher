import { NextResponse } from "next/server";
import { runEnrichmentPipeline, type PipelineMode } from "@/lib/enrichment/pipeline";

const VALID_MODES: PipelineMode[] = ["search", "search_general", "search_contact", "gemini", "save", "full"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rowId = parseInt(id, 10);
  if (isNaN(rowId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let mode: PipelineMode = "full";
  try {
    const body = await req.json();
    if (body?.mode && VALID_MODES.includes(body.mode)) {
      mode = body.mode;
    }
  } catch {
    // no body or invalid JSON — use default
  }

  try {
    await runEnrichmentPipeline(rowId, mode);
    return NextResponse.json({ success: true, rowId, mode });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
