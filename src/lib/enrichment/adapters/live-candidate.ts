import { prisma } from "@/lib/prisma";
import { getEnrichmentAudit, updateEnrichmentAudit } from "@/lib/enrichment/enrichmentRecord";
import type {
  EntityAdapter,
  MatchAuditJson,
  ParsedEnrichmentResult,
  TavilyResult,
} from "@/types/enrichment";

const ENTITY_TYPE = "candidate";

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

const EMAIL_RE_VALIDATE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MIN_USEFUL_CONTENT_LENGTH = 60;

function isValidEmail(v: string): boolean {
  return EMAIL_RE_VALIDATE.test(v.trim());
}

function isValidPhone(v: string): boolean {
  return v.replace(/\D/g, "").length >= 10;
}

type CandidateWithElection = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  currentState: string | null;
  elections: {
    election: {
      position: string;
      state: string;
      city: string;
      date: Date;
      filingAuthorityName: string | null;
      filingAuthorityLevel: string | null;
    };
  }[];
};

export class LiveCandidateAdapter implements EntityAdapter {
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null };

  private readonly candidate: CandidateWithElection;
  private readonly election: CandidateWithElection["elections"][number]["election"] | null;

  private constructor(candidate: CandidateWithElection) {
    this.candidate = candidate;
    this.election = candidate.elections[0]?.election ?? null;
    this.entityId = candidate.id;
    this.logContext = { rowId: candidate.id };

    const parts = candidate.name.trim().split(/\s+/);
    this.nameParts = {
      fullNameRaw: candidate.name,
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts[parts.length - 1] : null,
    };
  }

  static async create(candidateId: number): Promise<LiveCandidateAdapter> {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
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
    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);
    return new LiveCandidateAdapter(candidate);
  }

  buildSearchQuery(): string {
    const { nameParts, election } = this;
    const name = nameParts.fullNameRaw ?? "";
    const state = election ? expandState(election.state) : "";
    const city = election?.city ?? "";
    const position = election?.position ?? "";
    const year = election ? String(election.date.getFullYear()) : "";

    const parts: string[] = [];
    if (name) parts.push(name);
    if (city) parts.push(city);
    if (state) parts.push(state);
    if (position) parts.push(position);
    if (year) parts.push(year);

    return parts.join(" ").trim();
  }

  buildContactSearchQuery(): string {
    const { nameParts, election } = this;
    const name = nameParts.fullNameRaw ?? "";
    const state = election ? expandState(election.state) : "";
    const position = election?.position ?? "";

    const parts: string[] = [];
    if (name) parts.push(name);
    if (state) parts.push(state);
    if (position) parts.push(position);
    parts.push("contact email phone");

    return parts.join(" ").trim();
  }

  buildGeminiPrompt(sources: TavilyResult[]): string {
    const { nameParts, election } = this;
    const name = nameParts.fullNameRaw ?? "Unknown";
    const state = election ? expandState(election.state) : "";
    const city = election?.city ?? "";
    const position = election?.position ?? "";
    const year = election ? String(election.date.getFullYear()) : "";

    const context = [
      position && `Position: ${position}`,
      city && `City: ${city}`,
      state && `State: ${state}`,
      year && `Election Year: ${year}`,
      election?.filingAuthorityName && `Filing Authority: ${election.filingAuthorityName}`,
      election?.filingAuthorityLevel && `Authority Level: ${election.filingAuthorityLevel}`,
    ]
      .filter(Boolean)
      .join("\n");

    const firstName = (nameParts.firstName ?? "").toLowerCase();
    const lastName = (nameParts.lastName ?? "").toLowerCase();
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

    const thickSources = sources.filter(
      (s) => s.content && s.content.trim().length >= MIN_USEFUL_CONTENT_LENGTH
    );
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

  async getAudit(): Promise<MatchAuditJson | null> {
    return getEnrichmentAudit(ENTITY_TYPE, this.entityId);
  }

  async updateAudit(patch: Partial<MatchAuditJson>): Promise<void> {
    return updateEnrichmentAudit(ENTITY_TYPE, this.entityId, patch);
  }

  async saveResult(parsed: ParsedEnrichmentResult, audit: MatchAuditJson): Promise<void> {
    const { candidate, election } = this;
    const finalSavedFields: Record<string, unknown> = {};

    let emailToSave: string | null = null;
    if (parsed.email) {
      if (candidate.email) {
        finalSavedFields.emailSkipped = "existing value preserved";
      } else if (!isValidEmail(parsed.email)) {
        finalSavedFields.emailSkipped = `invalid format: ${parsed.email}`;
      } else {
        emailToSave = parsed.email.trim().toLowerCase();
        finalSavedFields.email = emailToSave;
      }
    }

    let phoneToSave: string | null = null;
    if (parsed.phone) {
      if (candidate.phone) {
        finalSavedFields.phoneSkipped = "existing value preserved";
      } else if (!isValidPhone(parsed.phone)) {
        finalSavedFields.phoneSkipped = `invalid format: ${parsed.phone}`;
      } else {
        phoneToSave = parsed.phone.trim();
        finalSavedFields.phone = phoneToSave;
      }
    }

    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    const stateToSave = !candidate.currentState && election?.state ? election.state : undefined;

    await prisma.candidate.update({
      where: { id: this.entityId },
      data: {
        ...(parsed.biography ? { bio: parsed.biography } : {}),
        ...(emailToSave ? { email: emailToSave } : {}),
        ...(phoneToSave ? { phone: phoneToSave } : {}),
        ...(parsed.currentRole ? { currentRole: parsed.currentRole } : {}),
        ...(parsed.currentCity ? { currentCity: parsed.currentCity } : {}),
        ...(stateToSave ? { currentState: stateToSave } : {}),
      },
    });

    const completedAudit: MatchAuditJson = {
      ...audit,
      status: "result_saved",
      completedAt: new Date().toISOString(),
      finalSavedFields,
    };
    await updateEnrichmentAudit(ENTITY_TYPE, this.entityId, completedAudit);
  }
}
