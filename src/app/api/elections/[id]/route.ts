import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({
    ...election,
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
  });
}
