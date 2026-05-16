import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CrmIntakeDraftRow, CrmIntakeSubmission } from "@prisma/client";
import { deriveOverallStatus } from "../auditMigration";
import type {
  EntityAdapter,
  MatchAuditJson,
  GeneralParsedResult,
  ContactParsedResult,
  TavilyResult,
  TrackAudit,
  TrackKind,
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
  return STATE_NAMES[s.trim().toUpperCase()] ?? s;
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

  buildSearchQuery(track: TrackKind): string {
    const { row, submission } = this;
    const name =
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      row.fullNameRaw ||
      "";

    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";

    if (track === "contact") {
      const parts: string[] = [];
      if (name) parts.push(name);
      if (state) parts.push(state);
      if (row.position) parts.push(row.position);
      parts.push("contact email phone");
      return parts.join(" ").trim();
    }

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

  buildGeminiPrompt(track: TrackKind, sources: TavilyResult[]): string {
    return track === "general"
      ? this.buildGeneralPrompt(sources)
      : this.buildContactPrompt(sources);
  }

  private contextLines(): string {
    const { row, submission } = this;
    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";
    const municipality = row.municipality || submission.defaultMunicipality || "";
    const county = row.county || submission.targetCounty || "";
    const year = row.year || submission.defaultYear || "";
    const electionTerm = row.electionTerm || submission.uploadElectionTerm || "";

    return [
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
  }

  private usefulSources(sources: TavilyResult[]): string {
    const firstName = (this.row.firstName ?? "").toLowerCase();
    const lastName = (this.row.lastName ?? "").toLowerCase();
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
    const useful = relevantSources.length > 0 ? relevantSources : thickSources;

    return useful
      .map((s) => {
        const content = s.content.length > 4000 ? s.content.slice(0, 4000) + "…" : s.content;
        let domain = s.url;
        try {
          domain = new URL(s.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep url */
        }
        return `[${domain}] ${s.title}\nURL: ${s.url}\n${content}`;
      })
      .join("\n\n---\n\n");
  }

  private buildGeneralPrompt(sources: TavilyResult[]): string {
    const name =
      [this.row.firstName, this.row.lastName].filter(Boolean).join(" ") ||
      this.row.fullNameRaw ||
      "Unknown";
    const context = this.contextLines();
    const sourcesText = this.usefulSources(sources);

    return `You are a candidate research assistant. Based ONLY on the search results provided below, extract general biographical information about this political candidate.

CANDIDATE:
Name: ${name}
${context}

SEARCH RESULTS:
${sourcesText || "No search results available."}

INSTRUCTIONS:
- Write a biography of approximately 600 characters summarizing who this candidate is based on the search results. Cover their background, policy positions if known, and why they are running. The biography is public-facing — do NOT reference, cite, or mention any sources, URLs, or websites. Write in third person as if it were an editorial profile.
- Extract their current professional role or occupation. This should be their professional identity, NOT the election they are running in. If sources indicate they are an incumbent, use "Incumbent [position title]". If no professional role is found, use "Candidate for [position title]".
- Extract the city where they currently live or work. Null if not found.
- List the URLs from search results that were most relevant.
- Rate your confidence from 0.0 to 1.0 that this is the correct candidate.
- Add brief notes about ambiguity or anything unusual.

Respond with ONLY valid JSON in this exact format:
{
  "biography": "string or null",
  "currentRole": "string or null",
  "currentCity": "string or null",
  "sourceUrls": ["url1", "url2"],
  "confidence": 0.0,
  "notes": "string or null"
}`;
  }

  private buildContactPrompt(sources: TavilyResult[]): string {
    const name =
      [this.row.firstName, this.row.lastName].filter(Boolean).join(" ") ||
      this.row.fullNameRaw ||
      "Unknown";
    const context = this.contextLines();
    const sourcesText = this.usefulSources(sources);

    return `You are a candidate research assistant. Based ONLY on the search results provided below, extract contact information for this political candidate.

CANDIDATE:
Name: ${name}
${context}

SEARCH RESULTS:
${sourcesText || "No search results available."}

INSTRUCTIONS:
- Extract an email address ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer email addresses.
- Extract a phone number ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer phone numbers.
- List the URLs from search results where you found contact information.
- Rate your confidence from 0.0 to 1.0.
- Add brief notes about ambiguity or anything unusual.

Respond with ONLY valid JSON in this exact format:
{
  "email": "string or null",
  "phone": "string or null",
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as unknown as MatchAuditJson;
  }

  private async readCurrent(): Promise<MatchAuditJson> {
    const existing = await this.getAudit();
    return (
      existing ?? {
        runId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        general: { status: "not_started" },
        contact: { status: "not_started" },
        errors: [],
      }
    );
  }

  private async persist(audit: MatchAuditJson): Promise<void> {
    const overall = deriveOverallStatus(audit);
    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: audit as unknown as Prisma.InputJsonValue,
        enrichmentStatus: overall,
      },
    });
  }

  async updateAudit(patch: Partial<Omit<MatchAuditJson, "general" | "contact">>): Promise<void> {
    const current = await this.readCurrent();
    const merged: MatchAuditJson = {
      ...current,
      ...patch,
      errors: patch.errors !== undefined ? patch.errors : current.errors,
    };
    await this.persist(merged);
  }

  async updateTrack(track: TrackKind, patch: Partial<TrackAudit>): Promise<void> {
    const current = await this.readCurrent();
    const merged: MatchAuditJson = {
      ...current,
      [track]: { ...current[track], ...patch },
    };
    await this.persist(merged);
  }

  async appendError(error: { message: string; timestamp: string; track?: TrackKind }): Promise<void> {
    const current = await this.readCurrent();
    const merged: MatchAuditJson = {
      ...current,
      errors: [...(current.errors ?? []), error],
    };
    await this.persist(merged);
  }

  async saveTrackResult(
    track: TrackKind,
    parsed: GeneralParsedResult | ContactParsedResult,
    audit: MatchAuditJson
  ): Promise<void> {
    if (track === "general") {
      await this.saveGeneral(parsed as GeneralParsedResult, audit);
    } else {
      await this.saveContact(parsed as ContactParsedResult, audit);
    }
  }

  private async saveGeneral(parsed: GeneralParsedResult, audit: MatchAuditJson): Promise<void> {
    const row = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { state: true, rawData: true, position: true },
    });

    const finalSavedFields: Record<string, unknown> = {};
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
    finalSavedFields.profileEnrichment = profileEnrichment;
    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    const reviewerNotes = [parsed.biography, parsed.notes].filter(Boolean).join("\n\n");
    if (reviewerNotes) finalSavedFields.reviewerNotes = reviewerNotes;

    const existingRaw =
      row?.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)
        ? (row.rawData as Record<string, unknown>)
        : {};
    const newRawData = { ...existingRaw, _profileEnrichment: profileEnrichment };

    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
        ...(reviewerNotes ? { reviewerNotes } : {}),
        rawData: newRawData as unknown as Prisma.InputJsonValue,
      },
    });

    await this.commitTrack("general", audit, finalSavedFields, parsed);
  }

  private async saveContact(parsed: ContactParsedResult, audit: MatchAuditJson): Promise<void> {
    const row = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { email: true, phone: true },
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

    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        ...(emailToSave ? { email: emailToSave } : {}),
        ...(phoneToSave ? { phone: phoneToSave } : {}),
      },
    });

    await this.commitTrack("contact", audit, finalSavedFields, parsed);
  }

  private async commitTrack(
    track: TrackKind,
    audit: MatchAuditJson,
    finalSavedFields: Record<string, unknown>,
    parsed: GeneralParsedResult | ContactParsedResult
  ): Promise<void> {
    const fresh = await this.readCurrent();
    const base: MatchAuditJson = fresh ?? audit;
    const updated: MatchAuditJson = {
      ...base,
      [track]: {
        ...base[track],
        status: "result_saved",
        parsedResult: parsed,
        finalSavedFields,
      },
    };
    if (updated.general.status === "result_saved" && updated.contact.status === "result_saved") {
      updated.completedAt = new Date().toISOString();
    }
    await this.persist(updated);
  }
}
