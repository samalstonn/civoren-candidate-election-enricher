import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const elections = await prisma.election.findMany({
    select: {
      id: true,
      position: true,
      cycle: true,
      date: true,
      active: true,
      description: true,
      positions: true,
      city: true,
      state: true,
      type: true,
      _count: { select: { candidates: true } },
      candidates: { select: { candidate: { select: { verified: true } } } },
      mapRegionLink: { select: { region: { select: { label: true } } } },
    },
    orderBy: { date: "desc" },
  });

  const results = elections.map((e) => ({
    id: e.id,
    position: e.position,
    cycle: e.cycle,
    date: e.date.toISOString(),
    active: e.active,
    candidatesCount: e._count.candidates,
    verifiedCandidatesCount: e.candidates.filter((l) => l.candidate.verified).length,
    descriptionLength: e.description.length,
    positions: e.positions,
    city: e.city,
    state: e.state,
    type: e.type,
    regionLabel: e.mapRegionLink?.region.label ?? null,
  }));

  return NextResponse.json(results);
}
