import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CrmIntakeDraftRow, CrmIntakeSubmission } from "@prisma/client";
import type {
  EntityAdapter,
  MatchAuditJson,
  ParsedEnrichmentResult,
  TavilyResult,
} from "@/types/enrichment";

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

export class CandidateIntakeAdapter implements EntityAdapter {
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null };

  private readonly row: CrmIntakeDraftRow;
  private readonly submission: CrmIntakeSubmission;

  private constructor(row: CrmIntakeDraftRow & { submission: CrmIntakeSubmission }) {
    this.row = row;
    this.submission = row.submission;
    this.entityId = row.id;
    this.logContext = { rowId: row.id, submissionId: row.submissionId ?? undefined };
    this.nameParts = {
      firstName: row.firstName,
      lastName: row.lastName,
      fullNameRaw: row.fullNameRaw,
    };
  }

  static async create(rowId: number): Promise<CandidateIntakeAdapter> {
    const row = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: rowId },
      include: { submission: true },
    });
    if (!row) throw new Error(`Row ${rowId} not found`);
    return new CandidateIntakeAdapter(row);
  }

  buildSearchQuery(): string {
    const { row, submission } = this;
    const name =
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      row.fullNameRaw ||
      "";

    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";
    const municipality = row.municipality || submission.defaultMunicipality || "";
    const county = row.county || submission.targetCounty || "";
    const year = row.year || submission.defaultYear || "";

    const parts: string[] = [];
    if (name) parts.push(name);
    if (municipality) parts.push(municipality);
    else if (county) parts.push(`${county} County`);
    if (state) parts.push(state);
    if (row.position) parts.push(row.position);
    if (year) parts.push(year);

    return parts.join(" ").trim();
  }

  buildContactSearchQuery(): string {
    const { row, submission } = this;
    const name =
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      row.fullNameRaw ||
      "";

    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";

    const parts: string[] = [];
    if (name) parts.push(name);
    if (state) parts.push(state);
    if (row.position) parts.push(row.position);
    parts.push("contact email phone");

    return parts.join(" ").trim();
  }

  buildGeminiPrompt(sources: TavilyResult[]): string {
    const { row, submission } = this;
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
    const record = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const raw = record?.matchAuditJson;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as unknown as MatchAuditJson;
    }
    return null;
  }

  async updateAudit(patch: Partial<MatchAuditJson>): Promise<void> {
    const existing = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });

    const current =
      existing?.matchAuditJson &&
      typeof existing.matchAuditJson === "object" &&
      !Array.isArray(existing.matchAuditJson)
        ? (existing.matchAuditJson as Partial<MatchAuditJson>)
        : {};

    const updated: Partial<MatchAuditJson> = { ...current, ...patch };

    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: updated as unknown as Prisma.InputJsonValue,
        ...(patch.status ? { enrichmentStatus: patch.status } : {}),
      },
    });
  }

  async saveResult(parsed: ParsedEnrichmentResult, auditJson: MatchAuditJson): Promise<void> {
    const row = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { state: true, rawData: true, position: true, email: true, phone: true },
    });

    const finalSavedFields: Record<string, unknown> = {};

    let emailToSave: string | null = null;
    if (parsed.email) {
      if (row?.email) {
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
      if (row?.phone) {
        finalSavedFields.phoneSkipped = "existing value preserved";
      } else if (!isValidPhone(parsed.phone)) {
        finalSavedFields.phoneSkipped = `invalid format: ${parsed.phone}`;
      } else {
        phoneToSave = parsed.phone.trim();
        finalSavedFields.phone = phoneToSave;
      }
    }

    if (parsed.confidence !== undefined)
      finalSavedFields.confidence = parsed.confidence;
    if (parsed.biography || parsed.notes) {
      finalSavedFields.reviewerNotes = [parsed.biography, parsed.notes]
        .filter(Boolean)
        .join("\n\n");
    }

    const currentRoleFallback = row?.position ? `Candidate for ${row.position}` : null;
    const currentRole = parsed.currentRole || currentRoleFallback;

    const profileEnrichment = {
      bio: parsed.biography || null,
      currentRole,
      currentCity: parsed.currentCity || null,
      currentState: row?.state || null,
      confidence: parsed.confidence ?? null,
      sources: parsed.sourceUrls || [],
      model: "gemini",
      enrichedAt: new Date().toISOString(),
    };

    const existingRaw =
      row?.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)
        ? (row.rawData as Record<string, unknown>)
        : {};
    const newRawData = { ...existingRaw, _profileEnrichment: profileEnrichment };

    const completedAudit: MatchAuditJson = {
      ...auditJson,
      status: "result_saved",
      completedAt: new Date().toISOString(),
      finalSavedFields,
    };

    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        ...(emailToSave ? { email: emailToSave } : {}),
        ...(phoneToSave ? { phone: phoneToSave } : {}),
        ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
        ...(finalSavedFields.reviewerNotes
          ? { reviewerNotes: finalSavedFields.reviewerNotes as string }
          : {}),
        rawData: newRawData as unknown as Prisma.InputJsonValue,
        enrichmentStatus: "result_saved",
        matchAuditJson: completedAudit as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
