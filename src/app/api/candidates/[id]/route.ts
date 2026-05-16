import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const candidateId = parseInt(id, 10);
  if (isNaN(candidateId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      bio: true,
      currentRole: true,
      currentCity: true,
      currentState: true,
      elections: {
        where: { archived: false },
        include: {
          election: {
            select: {
              position: true,
              state: true,
              city: true,
              date: true,
              filingAuthorityName: true,
              filingAuthorityLevel: true,
            },
          },
        },
        orderBy: { joinedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const enrichmentRecord = await prisma.enrichmentRecord.findUnique({
    where: { entityType_entityId: { entityType: "candidate", entityId: candidateId } },
    select: { enrichmentStatus: true, matchAuditJson: true, updatedAt: true },
  });

  const electionLink = candidate.elections[0] ?? null;

  return NextResponse.json({
    id: candidate.id,
    name: candidate.name,
    slug: candidate.slug,
    email: candidate.email,
    phone: candidate.phone,
    bio: candidate.bio,
    currentRole: candidate.currentRole,
    currentCity: candidate.currentCity,
    currentState: candidate.currentState,
    election: electionLink
      ? {
          position: electionLink.election.position,
          state: electionLink.election.state,
          city: electionLink.election.city,
          date: electionLink.election.date.toISOString(),
          filingAuthorityName: electionLink.election.filingAuthorityName,
          filingAuthorityLevel: electionLink.election.filingAuthorityLevel,
        }
      : null,
    enrichmentRecord: enrichmentRecord
      ? {
          enrichmentStatus: enrichmentRecord.enrichmentStatus,
          matchAuditJson: enrichmentRecord.matchAuditJson,
          updatedAt: enrichmentRecord.updatedAt.toISOString(),
        }
      : null,
  });
}
