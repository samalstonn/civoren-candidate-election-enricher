import type { CrmIntakeDraftRow, CrmIntakeSubmission } from "@prisma/client";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

function expandState(s: string): string {
  const upper = s.trim().toUpperCase();
  return STATE_NAMES[upper] ?? s;
}


export function buildSearchQuery(
  row: CrmIntakeDraftRow,
  submission: CrmIntakeSubmission
): string {
  const name =
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    row.fullNameRaw ||
    "";

  const rawState = row.state || submission.targetState || "";
  const state = rawState ? expandState(rawState) : "";

  const position = row.position || "";

  const municipality = row.municipality || submission.defaultMunicipality || "";
  const county = row.county || submission.targetCounty || "";
  const year = row.year || submission.defaultYear || "";

  const parts: string[] = [];

  if (name) parts.push(name);

  // Location context: prefer municipality, fall back to county, then state
  if (municipality) parts.push(municipality);
  else if (county) parts.push(`${county} County`);
  if (state) parts.push(state);

  if (position) parts.push(position);

  // Year
  if (year) parts.push(year);

  return parts.join(" ").trim();
}

export function buildContactSearchQuery(
  row: CrmIntakeDraftRow,
  submission: CrmIntakeSubmission
): string {
  const name =
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    row.fullNameRaw ||
    "";

  const rawState = row.state || submission.targetState || "";
  const state = rawState ? expandState(rawState) : "";

  const position = row.position || "";

  const parts: string[] = [];

  if (name) parts.push(name);
  if (state) parts.push(state);
  if (position) parts.push(position);
  parts.push("contact email phone");

  return parts.join(" ").trim();
}
