import type { CrmIntakeDraftRow, CrmIntakeSubmission } from "@prisma/client";
import type { TavilyResult } from "@/types/enrichment";

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

const MIN_USEFUL_CONTENT_LENGTH = 60;

export function buildGeminiPrompt(
  row: CrmIntakeDraftRow,
  submission: CrmIntakeSubmission,
  sources: TavilyResult[]
): string {
  const name =
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    row.fullNameRaw ||
    "Unknown";

  const rawState = row.state || submission.targetState || "";
  const state = rawState ? expandState(rawState) : "";
  const municipality = row.municipality || submission.defaultMunicipality || "";
  const county = row.county || submission.targetCounty || "";
  const year = row.year || submission.defaultYear || "";
  const electionTerm = row.electionTerm || submission.uploadElectionTerm || "";

  const context = [
    row.position && `Position: ${row.position}`,
    municipality && `Municipality: ${municipality}`,
    county && `County: ${county}`,
    state && `State: ${state}`,
    year && `Election Year: ${year}`,
    electionTerm && `Election Term: ${electionTerm}`,
    submission.targetAuthorityName && `Filing Authority: ${submission.targetAuthorityName}`,
    submission.targetAuthorityLevel && `Authority Level: ${submission.targetAuthorityLevel}`,
  ]
    .filter(Boolean)
    .join("\n");

  const firstName = (row.firstName ?? "").toLowerCase();
  const lastName = (row.lastName ?? "").toLowerCase();
  // Minimum prefix length to match nicknames: "josh" matches "joshua", "rob" matches "robert"
  const firstNamePrefix = firstName.slice(0, 4);

  function mentionsCandidate(s: { title: string; content: string }): boolean {
    const hay = (s.title + " " + s.content).toLowerCase();
    const lastNameMatch = !lastName || hay.includes(lastName);
    const firstNameMatch =
      !firstName ||
      hay.includes(firstName) ||
      (firstNamePrefix.length >= 3 && hay.includes(firstNamePrefix));
    return lastNameMatch && firstNameMatch;
  }

  // Filter out sources with content too thin to be useful
  const thickSources = sources.filter(
    (s) => s.content && s.content.trim().length >= MIN_USEFUL_CONTENT_LENGTH
  );

  // Keep only sources that mention the candidate by name; fall back to all if none match
  const relevantSources = thickSources.filter(mentionsCandidate);
  const usefulSources = relevantSources.length > 0 ? relevantSources : thickSources;

  const sourcesText = usefulSources
    .map((s) => {
      const content =
        s.content.length > 4000 ? s.content.slice(0, 4000) + "…" : s.content;
      let domain = s.url;
      try { domain = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep url */ }
      return `[${domain}] ${s.title}\nURL: ${s.url}\n${content}`;
    })
    .join("\n\n---\n\n");

  return `You are a candidate research assistant. Based ONLY on the search results provided below, extract information about this political candidate.

CANDIDATE:
Name: ${name}
${context}

SEARCH RESULTS:
${sourcesText || "No search results available."}

INSTRUCTIONS:
- Write a biography of approximately 600 characters summarizing who this candidate is based on the search results. Cover their background, policy positions if known, and why they are running. The biography is public-facing — do NOT reference, cite, or mention any sources, URLs, or websites. Write in third person as if it were an editorial profile.
- Extract an email address ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer email addresses.
- Extract a phone number ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer phone numbers.
- Extract their current professional role or occupation (e.g. "Attorney", "Small business owner", "Retired teacher"). This should be their professional identity, NOT the election they are running in. If sources indicate they currently hold this office (i.e. they are an incumbent), use "Incumbent [position title]". If no professional role is found at all, use "Candidate for [position title]".
- Extract the city where they currently live or work. Null if not found.
- List the URLs from search results that were most relevant.
- Rate your confidence from 0.0 to 1.0 that this is the correct candidate (not a different person with the same name).
- Add brief notes about ambiguity, alternative candidates found, or anything unusual.

Respond with ONLY valid JSON in this exact format:
{
  "biography": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "currentRole": "string or null",
  "currentCity": "string or null",
  "sourceUrls": ["url1", "url2"],
  "confidence": 0.0,
  "notes": "string or null"
}`;
}
