import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LiveElectionAdapter } from "@/lib/enrichment/adapters/live-election";
import { trackIds } from "@/lib/enrichment/registry";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const electionId = parseInt(id, 10);
  if (isNaN(electionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const election = await prisma.election.findUnique({
    where: { id: electionId },
    select: {
      id: true,
      position: true,
      date: true,
      active: true,
      hidden: true,
      called: true,
      city: true,
      state: true,
      type: true,
      cycle: true,
      positions: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      uploadedBy: true,
      filingAuthorityId: true,
      filingAuthorityKey: true,
      filingAuthorityLevel: true,
      filingAuthorityType: true,
      filingAuthorityName: true,
      canonicalOfficeKey: true,
      canonicalStateRoute: true,
      canonicalCategory: true,
      canonicalBranch: true,
      officeSlug: true,
      sourceType: true,
      sourceConfidence: true,
      sourceCapturedAt: true,
      lastNormalizedAt: true,
      matchAuditJson: true,
      enrichmentStatus: true,
      mapRegionLink: {
        select: {
          region: {
            select: {
              id: true,
              label: true,
              stateCode: true,
              regionType: true,
              regionCode: true,
            },
          },
        },
      },
      candidates: {
        where: { archived: false },
        orderBy: { joinedAt: "desc" },
        select: {
          joinedAt: true,
          party: true,
          votinglink: true,
          candidate: {
            select: {
              id: true,
              name: true,
              slug: true,
              verified: true,
              email: true,
              phone: true,
              currentCity: true,
              currentState: true,
              linkedin: true,
              website: true,
            },
          },
        },
      },
    },
  });

  if (!election) {
    return NextResponse.json({ error: "Election not found" }, { status: 404 });
  }

  // Search-query preview per track so the UI can show queries before any run.
  let previewQueries: Record<string, string> = {};
  try {
    const adapter = await LiveElectionAdapter.create(electionId);
    for (const id of trackIds("election")) {
      previewQueries[id] = adapter.tracks[id].buildSearchQuery();
    }
  } catch {
    previewQueries = {};
  }

  const { matchAuditJson, enrichmentStatus, ...rest } = election;

  return NextResponse.json({
    ...rest,
    date: election.date.toISOString(),
    createdAt: election.createdAt.toISOString(),
    updatedAt: election.updatedAt.toISOString(),
    sourceCapturedAt: election.sourceCapturedAt?.toISOString() ?? null,
    lastNormalizedAt: election.lastNormalizedAt?.toISOString() ?? null,
    candidates: election.candidates.map((l) => ({
      joinedAt: l.joinedAt.toISOString(),
      party: l.party,
      votinglink: l.votinglink,
      candidate: l.candidate,
    })),
    enrichmentRecord: {
      enrichmentStatus: enrichmentStatus ?? null,
      matchAuditJson: matchAuditJson ?? null,
      updatedAt: election.updatedAt.toISOString(),
    },
    previewQueries,
  });
}
