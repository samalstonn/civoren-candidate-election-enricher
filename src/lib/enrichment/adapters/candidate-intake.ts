import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CrmIntakeDraftRow, CrmIntakeSubmission } from "@prisma/client";
import { deriveOverallStatus } from "../auditMigration";
import {
  setTrackAtomic,
  setAuditFieldAtomic,
  appendErrorAtomic,
  refreshStatusMirror,
  type AuditStore,
} from "../atomicAudit";
import { buildPrompt } from "../prompt";
import { expandState } from "../states";
import { isValidEmail, isValidPhone } from "../validate";
import { getTrack, trackIds, type TrackIdFor, type AnyTrackId } from "../registry";
import type {
  AdapterTrack,
  EntityAdapter,
  MatchAuditJson,
  GeneralParsedResult,
  ContactParsedResult,
  NameParts,
  TrackAudit,
} from "@/types/enrichment";

const ENTITY_TYPE = "candidate" as const;

type CandidateTrackId = TrackIdFor<"candidate">;

export class CandidateIntakeAdapter implements EntityAdapter<"candidate"> {
  readonly entityKind = ENTITY_TYPE;
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: NameParts;
  readonly tracks: Record<CandidateTrackId, AdapterTrack>;

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

    this.tracks = {
      general: {
        buildSearchQuery: () => this.buildGeneralQuery(),
        buildGeminiPrompt: (sources) =>
          buildPrompt({
            entityKind: "political candidate",
            contextHeader: "CANDIDATE",
            context: `Name: ${this.displayName()}\n${this.contextLines()}`,
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
            context: `Name: ${this.displayName()}\n${this.contextLines()}`,
            sources,
            nameParts: this.nameParts,
            instructions: [...getTrack("candidate", "contact").instructions],
            jsonSchema: getTrack("candidate", "contact").jsonSchema,
          }),
        save: (parsed, audit) => this.saveContact(parsed as ContactParsedResult, audit),
      },
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

  // ---- Per-track query / context builders ----

  private displayName(): string {
    return (
      [this.row.firstName, this.row.lastName].filter(Boolean).join(" ") ||
      this.row.fullNameRaw ||
      "Unknown"
    );
  }

  private buildGeneralQuery(): string {
    const { row, submission } = this;
    const name = this.displayName();
    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";
    const municipality = row.municipality || submission.defaultMunicipality || "";
    const county = row.county || submission.targetCounty || "";
    const year = row.year || submission.defaultYear || "";

    const parts: string[] = [];
    if (name && name !== "Unknown") parts.push(name);
    if (municipality) parts.push(municipality);
    else if (county) parts.push(`${county} County`);
    if (state) parts.push(state);
    if (row.position) parts.push(row.position);
    if (year) parts.push(year);
    return parts.join(" ").trim();
  }

  private buildContactQuery(): string {
    const { row, submission } = this;
    const name = this.displayName();
    const rawState = row.state || submission.targetState || "";
    const state = rawState ? expandState(rawState) : "";
    const parts: string[] = [];
    if (name && name !== "Unknown") parts.push(name);
    if (state) parts.push(state);
    if (row.position) parts.push(row.position);
    parts.push("contact email phone");
    return parts.join(" ").trim();
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

  // ---- Audit helpers (intake stores audit inline on the row) ----

  async getAudit(): Promise<MatchAuditJson | null> {
    const record = await prisma.crmIntakeDraftRow.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const raw = record?.matchAuditJson;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as unknown as MatchAuditJson;
  }

  private get store(): AuditStore {
    return {
      table: "CrmIntakeDraftRow",
      jsonCol: "matchAuditJson",
      statusCol: "enrichmentStatus",
      where: [{ col: "id", value: this.entityId }],
    };
  }

  /** Ensure the row has a seeded audit blob before tracks run in parallel. */
  private async ensureSeeded(): Promise<void> {
    const current = await this.getAudit();
    if (current) return;
    await prisma.crmIntakeDraftRow.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: this.seededAudit() as unknown as Prisma.InputJsonValue,
        enrichmentStatus: "not_started",
      },
    });
  }

  private seededAudit(): MatchAuditJson {
    const seeded: Partial<Record<AnyTrackId, TrackAudit>> = {};
    for (const id of trackIds("candidate")) {
      seeded[id as AnyTrackId] = { status: "not_started" };
    }
    return {
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      errors: [],
      ...seeded,
    };
  }

  private async refreshStatus(): Promise<void> {
    await refreshStatusMirror(this.store, async () => {
      const a = await this.getAudit();
      return a ? deriveOverallStatus(a) : null;
    });
  }

  async updateAudit(
    patch: Partial<Pick<MatchAuditJson, "runId" | "startedAt" | "completedAt" | "errors">>
  ): Promise<void> {
    await this.ensureSeeded();
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await setAuditFieldAtomic(this.store, field, value);
    }
    await this.refreshStatus();
  }

  async updateTrack(track: CandidateTrackId, patch: Partial<TrackAudit>): Promise<void> {
    await this.ensureSeeded();
    await setTrackAtomic(this.store, track, patch);
    await this.refreshStatus();
  }

  async appendError(error: { message: string; timestamp: string; track?: CandidateTrackId }): Promise<void> {
    await this.ensureSeeded();
    await appendErrorAtomic(this.store, error);
    await this.refreshStatus();
  }

  // ---- Track-specific saves ----

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

    await this.commitTrack("general", audit, finalSavedFields, parsed as unknown as Record<string, unknown>);
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

    await this.commitTrack("contact", audit, finalSavedFields, parsed as unknown as Record<string, unknown>);
  }

  private async commitTrack(
    track: CandidateTrackId,
    _audit: MatchAuditJson,
    finalSavedFields: Record<string, unknown>,
    parsed: Record<string, unknown>
  ): Promise<void> {
    // Atomic per-track write — the racing other-track's writes are untouched.
    await this.ensureSeeded();
    await setTrackAtomic(this.store, track, {
      status: "result_saved",
      parsedResult: parsed,
      finalSavedFields,
    });
    // Re-read after the atomic patch to check whether both tracks are saved.
    const fresh = await this.getAudit();
    if (
      fresh &&
      fresh.general?.status === "result_saved" &&
      fresh.contact?.status === "result_saved"
    ) {
      await setAuditFieldAtomic(this.store, "completedAt", new Date().toISOString());
    }
    await this.refreshStatus();
  }
}
