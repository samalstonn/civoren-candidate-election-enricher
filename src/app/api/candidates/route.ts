import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  const candidates = await prisma.candidate.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      clerkUserId: true,
      verified: true,
      hidden: true,
      inInstantly: true,
      linkedin: true,
      photo: true,
      photoUrl: true,
      hasPhoto: true,
      bio: true,
      currentRole: true,
      currentCity: true,
      currentState: true,
      elections: {
        where: { archived: false },
        include: {
          election: {
            select: { position: true, state: true, city: true, date: true },
          },
        },
        orderBy: { joinedAt: "desc" },
        take: 1,
      },
      _count: {
        select: { followers: true, endorsements: true, profileViews: true },
      },
    },
    orderBy: { id: "desc" },
  });

  const enrichmentRecords = await prisma.enrichmentRecord.findMany({
    where: { entityType: "candidate" },
    select: { entityId: true, enrichmentStatus: true, updatedAt: true },
  });

  const recordMap = new Map(
    enrichmentRecords.map((r) => [r.entityId, r])
  );

  const results = candidates.map((c) => {
    const record = recordMap.get(c.id) ?? null;
    const electionLink = c.elections[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      linkedin: c.linkedin,
      hasPhoto: c.hasPhoto || Boolean(c.photoUrl || c.photo),
      bioLength: c.bio?.length ?? 0,
      clerkUserId: c.clerkUserId,
      verified: c.verified,
      hidden: c.hidden,
      slug: c.slug,
      email: c.email,
      phone: c.phone,
      currentRole: c.currentRole,
      currentCity: c.currentCity,
      currentState: c.currentState,
      inInstantly: c.inInstantly,
      profileViewsCount: c._count.profileViews,
      electionPosition: electionLink?.election.position ?? null,
      followersCount: c._count.followers,
      endorsementsCount: c._count.endorsements,
      enrichmentStatus: record?.enrichmentStatus ?? null,
    };
  });

  const filtered = statusFilter
    ? results.filter((r) => r.enrichmentStatus === statusFilter)
    : results;

  return NextResponse.json(filtered);
}
