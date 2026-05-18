import { prisma } from "@/lib/prisma";
import {
  getEnrichmentAudit,
  updateEnrichmentAudit,
  updateEnrichmentTrack,
  appendEnrichmentError,
} from "@/lib/enrichment/enrichmentRecord";
import { buildPrompt } from "@/lib/enrichment/prompt";
import { expandState } from "@/lib/enrichment/states";
import { isValidEmail, isValidPhone, isValidUrl } from "@/lib/enrichment/validate";
import { getTrack, type TrackIdFor } from "@/lib/enrichment/registry";
import type {
  AdapterTrack,
  EntityAdapter,
  MatchAuditJson,
  GeneralParsedResult,
  ContactParsedResult,
  NameParts,
  TavilyResult,
  TrackAudit,
} from "@/types/enrichment";

const ENTITY_TYPE = "candidate" as const;

type CandidateWithElection = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  currentState: string | null;
  linkedin: string | null;
  website: string | null;
  elections: {
    candidateId: number;
    electionId: number;
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

type CandidateTrackId = TrackIdFor<"candidate">;

export class LiveCandidateAdapter implements EntityAdapter<"candidate"> {
  readonly entityKind = ENTITY_TYPE;
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: NameParts;
  readonly tracks: Record<CandidateTrackId, AdapterTrack>;

  private readonly candidate: CandidateWithElection;
  private readonly electionLink: CandidateWithElection["elections"][number] | null;
  private readonly election: CandidateWithElection["elections"][number]["election"] | null;

  private constructor(candidate: CandidateWithElection) {
    this.candidate = candidate;
    this.electionLink = candidate.elections[0] ?? null;
    this.election = this.electionLink?.election ?? null;
    this.entityId = candidate.id;
    this.logContext = { rowId: candidate.id };

    const parts = candidate.name.trim().split(/\s+/);
    this.nameParts = {
      fullNameRaw: candidate.name,
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts[parts.length - 1] : null,
    };

    // The per-track map. All entity-kind branching lives here; private helpers
    // below do the entity-specific work for each track.
    this.tracks = {
      general: {
        buildSearchQuery: () => this.buildGeneralQuery(),
        buildGeminiPrompt: (sources) =>
          buildPrompt({
            entityKind: "political candidate",
            contextHeader: "CANDIDATE",
            context: `Name: ${this.nameParts.fullNameRaw ?? "Unknown"}\n${this.contextLines()}`,
            sources,
            nameParts: this.nameParts,
            instructions: [...getTrack("candidate", "general").instructions],
            jsonSchema: getTrack("candidate", "general").jsonSchema,
          }),
        save: (parsed, audit) => this.saveGeneral(parsed as GeneralParsedResult, audit),
      },
      contact: {
        buildSearchQuery: () => this.buildContactQuery(),
        buildGeminiPrompt: (sources) =>
          buildPrompt({
            entityKind: "political candidate",
            contextHeader: "CANDIDATE",
            context: `Name: ${this.nameParts.fullNameRaw ?? "Unknown"}\n${this.contextLines()}`,
            sources,
            nameParts: this.nameParts,
            instructions: [...getTrack("candidate", "contact").instructions],
            jsonSchema: getTrack("candidate", "contact").jsonSchema,
          }),
        save: (parsed, audit) => this.saveContact(parsed as ContactParsedResult, audit),
      },
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
        linkedin: true,
        website: true,
        elections: {
          where: { archived: false },
          select: {
            candidateId: true,
            electionId: true,
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

  // ---- Search-query builders (entity-specific) ----

  private buildGeneralQuery(): string {
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

  private buildContactQuery(): string {
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

  private contextLines(): string {
    const { election } = this;
    return [
      election?.position && `Position: ${election.position}`,
      election?.city && `City: ${election.city}`,
      election?.state && `State: ${expandState(election.state)}`,
      election && `Election Year: ${election.date.getFullYear()}`,
      election?.filingAuthorityName && `Filing Authority: ${election.filingAuthorityName}`,
      election?.filingAuthorityLevel && `Authority Level: ${election.filingAuthorityLevel}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ---- Audit helpers ----

  async getAudit(): Promise<MatchAuditJson | null> {
    return getEnrichmentAudit(ENTITY_TYPE, this.entityId);
  }

  async updateAudit(
    patch: Partial<Pick<MatchAuditJson, "runId" | "startedAt" | "completedAt" | "errors">>
  ): Promise<void> {
    return updateEnrichmentAudit(ENTITY_TYPE, this.entityId, patch);
  }

  async updateTrack(track: CandidateTrackId, patch: Partial<TrackAudit>): Promise<void> {
    return updateEnrichmentTrack(ENTITY_TYPE, this.entityId, track, patch);
  }

  async appendError(error: { message: string; timestamp: string; track?: CandidateTrackId }): Promise<void> {
    return appendEnrichmentError(ENTITY_TYPE, this.entityId, error);
  }

  // ---- Track-specific saves ----

  private async saveGeneral(parsed: GeneralParsedResult, audit: MatchAuditJson): Promise<void> {
    const { candidate, electionLink } = this;
    const finalSavedFields: Record<string, unknown> = {};

    const stateToSave =
      parsed.currentState && parsed.currentState.length === 2
        ? parsed.currentState.toUpperCase()
        : !candidate.currentState && this.election?.state
        ? this.election.state
        : undefined;

    await prisma.candidate.update({
      where: { id: this.entityId },
      data: {
        ...(parsed.biography ? { bio: parsed.biography } : {}),
        ...(parsed.currentRole ? { currentRole: parsed.currentRole } : {}),
        ...(parsed.currentCity ? { currentCity: parsed.currentCity } : {}),
        ...(stateToSave ? { currentState: stateToSave } : {}),
      },
    });
    if (parsed.biography) finalSavedFields.bio = parsed.biography;
    if (parsed.currentRole) finalSavedFields.currentRole = parsed.currentRole;
    if (parsed.currentCity) finalSavedFields.currentCity = parsed.currentCity;
    if (stateToSave) finalSavedFields.currentState = stateToSave;

    if (parsed.party && parsed.party.trim()) {
      if (electionLink) {
        await prisma.electionLink.update({
          where: {
            candidateId_electionId: {
              candidateId: electionLink.candidateId,
              electionId: electionLink.electionId,
            },
          },
          data: { party: parsed.party.trim() },
        });
        finalSavedFields.party = parsed.party.trim();
      } else {
        finalSavedFields.partySkipped = "no current election link";
      }
    }

    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    await this.commitTrack("general", audit, finalSavedFields, parsed as unknown as Record<string, unknown>);
  }

  private async saveContact(parsed: ContactParsedResult, audit: MatchAuditJson): Promise<void> {
    const { candidate } = this;
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

    let linkedinToSave: string | null = null;
    if (parsed.linkedin) {
      if (!isValidUrl(parsed.linkedin)) {
        finalSavedFields.linkedinSkipped = `invalid url: ${parsed.linkedin}`;
      } else {
        linkedinToSave = parsed.linkedin.trim();
        finalSavedFields.linkedin = linkedinToSave;
      }
    }

    let websiteToSave: string | null = null;
    if (parsed.website) {
      if (!isValidUrl(parsed.website)) {
        finalSavedFields.websiteSkipped = `invalid url: ${parsed.website}`;
      } else {
        websiteToSave = parsed.website.trim();
        finalSavedFields.website = websiteToSave;
      }
    }

    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    await prisma.candidate.update({
      where: { id: this.entityId },
      data: {
        ...(emailToSave ? { email: emailToSave } : {}),
        ...(phoneToSave ? { phone: phoneToSave } : {}),
        ...(linkedinToSave ? { linkedin: linkedinToSave } : {}),
        ...(websiteToSave ? { website: websiteToSave } : {}),
      },
    });

    await this.commitTrack("contact", audit, finalSavedFields, parsed as unknown as Record<string, unknown>);
  }

  private async commitTrack(
    track: CandidateTrackId,
    _audit: MatchAuditJson,
    finalSavedFields: Record<string, unknown>,
    parsed: Record<string, unknown>
  ): Promise<void> {
    // Atomic per-track write — the racing other-track's writes are untouched.
    await updateEnrichmentTrack(ENTITY_TYPE, this.entityId, track, {
      status: "result_saved",
      parsedResult: parsed,
      finalSavedFields,
    });
    // Stamp completedAt only when every track has saved. Re-read after the
    // atomic patch so we observe the other track's current status.
    const fresh = await getEnrichmentAudit(ENTITY_TYPE, this.entityId);
    if (
      fresh &&
      fresh.general?.status === "result_saved" &&
      fresh.contact?.status === "result_saved"
    ) {
      await updateEnrichmentAudit(ENTITY_TYPE, this.entityId, {
        completedAt: new Date().toISOString(),
      });
    }
  }
}
