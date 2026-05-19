import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  CrmFilingAuthorityLevel,
  CrmFilingAuthorityType,
} from "@prisma/client";
import { buildPrompt } from "../prompt";
import { expandState, normalizeStateCode } from "../states";
import { formatDatesForPrompt, resolveElectionDate } from "../electionDates2026";
import { getTrack, trackIds, type TrackIdFor, type AnyTrackId } from "../registry";
import { deriveOverallStatus } from "../auditMigration";
import {
  setTrackAtomic,
  setAuditFieldAtomic,
  appendErrorAtomic,
  refreshStatusMirror,
  type AuditStore,
} from "../atomicAudit";
import type {
  AdapterTrack,
  EntityAdapter,
  MatchAuditJson,
  NameParts,
  OverviewParsedResult,
  TrackAudit,
} from "@/types/enrichment";

const ENTITY_TYPE = "election" as const;
type ElectionTrackId = TrackIdFor<"election">;

/** Confidence threshold above which Gemini may overwrite an existing value. */
const OVERWRITE_CONFIDENCE = 0.8;

const LEVEL_VALUES = new Set<string>(Object.values(CrmFilingAuthorityLevel));
const TYPE_VALUES = new Set<string>(Object.values(CrmFilingAuthorityType));

type ElectionRecord = {
  id: number;
  position: string;
  date: Date;
  city: string;
  state: string;
  type: string;
  cycle: string;
  positions: number;
  filingAuthorityName: string | null;
  filingAuthorityLevel: CrmFilingAuthorityLevel | null;
  filingAuthorityType: CrmFilingAuthorityType | null;
  mapRegionLink: { region: { label: string } } | null;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class LiveElectionAdapter implements EntityAdapter<"election"> {
  readonly entityKind = ENTITY_TYPE;
  readonly entityId: number;
  readonly logContext: { rowId: number };
  readonly nameParts: NameParts;
  readonly tracks: Record<ElectionTrackId, AdapterTrack>;

  private readonly election: ElectionRecord;

  private constructor(election: ElectionRecord) {
    this.election = election;
    this.entityId = election.id;
    this.logContext = { rowId: election.id };
    this.nameParts = {
      fullNameRaw: `${election.position} (${election.city}, ${election.state})`,
    };

    this.tracks = {
      overview: {
        buildSearchQuery: () => this.buildOverviewQuery(),
        buildGeminiPrompt: (sources) =>
          buildPrompt({
            entityKind: "election",
            contextHeader: "ELECTION",
            context: this.contextLines(),
            sources,
            nameParts: this.nameParts,
            instructions: [...getTrack("election", "overview").instructions],
            jsonSchema: getTrack("election", "overview").jsonSchema,
          }),
        save: (parsed, audit) =>
          this.saveOverview(parsed as OverviewParsedResult, audit),
      },
    };
  }

  static async create(electionId: number): Promise<LiveElectionAdapter> {
    const election = await prisma.election.findUnique({
      where: { id: electionId },
      select: {
        id: true,
        position: true,
        date: true,
        city: true,
        state: true,
        type: true,
        cycle: true,
        positions: true,
        filingAuthorityName: true,
        filingAuthorityLevel: true,
        filingAuthorityType: true,
        mapRegionLink: { select: { region: { select: { label: true } } } },
      },
    });
    if (!election) throw new Error(`Election ${electionId} not found`);
    return new LiveElectionAdapter(election);
  }

  // ---- Query + context ----

  private buildOverviewQuery(): string {
    const { position, city, state, date } = this.election;
    const stateExpanded = expandState(state);
    const year = date.getFullYear();
    return `${position} ${city} ${stateExpanded} ${year} election`.trim();
  }

  private contextLines(): string {
    const e = this.election;
    return [
      `Position: ${e.position}`,
      `City: ${e.city}`,
      `State: ${expandState(e.state)} (postal: ${normalizeStateCode(e.state) ?? e.state.toUpperCase()})`,
      `Election Date (currently recorded): ${ymd(e.date)}`,
      `Type: ${e.type}`,
      `Cycle: ${e.cycle}`,
      `Seats currently recorded: ${e.positions}`,
      e.mapRegionLink && `Region: ${e.mapRegionLink.region.label}`,
      "",
      "Standard 2026 election dates (use for classification, not lookup — the system resolves the final date):",
      formatDatesForPrompt(e.state),
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ---- Audit (inline on Election row) ----

  async getAudit(): Promise<MatchAuditJson | null> {
    const r = await prisma.election.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const raw = r?.matchAuditJson;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as unknown as MatchAuditJson;
  }

  private get store(): AuditStore {
    return {
      table: "Election",
      jsonCol: "matchAuditJson",
      statusCol: "enrichmentStatus",
      where: [{ col: "id", value: this.entityId }],
    };
  }

  private async ensureSeeded(): Promise<void> {
    const current = await this.getAudit();
    if (current) return;
    await prisma.election.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: this.seededAudit() as unknown as Prisma.InputJsonValue,
        enrichmentStatus: "not_started",
      },
    });
  }

  private seededAudit(): MatchAuditJson {
    const seeded: Partial<Record<AnyTrackId, TrackAudit>> = {};
    for (const id of trackIds("election")) {
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

  async updateTrack(track: ElectionTrackId, patch: Partial<TrackAudit>): Promise<void> {
    await this.ensureSeeded();
    await setTrackAtomic(this.store, track, patch);
    await this.refreshStatus();
  }

  async appendError(error: {
    message: string;
    timestamp: string;
    track?: ElectionTrackId;
  }): Promise<void> {
    await this.ensureSeeded();
    await appendErrorAtomic(this.store, error);
    await this.refreshStatus();
  }

  // ---- Save ----

  private async saveOverview(
    parsed: OverviewParsedResult,
    _audit: MatchAuditJson
  ): Promise<void> {
    const e = this.election;
    const confidence = parsed.confidence ?? 0;
    const canOverwrite = confidence >= OVERWRITE_CONFIDENCE;
    const finalSavedFields: Record<string, unknown> = {};

    const data: Prisma.ElectionUpdateInput = {};

    // description: NOT NULL String; always overwrite when Gemini returns non-empty.
    if (parsed.description && parsed.description.trim()) {
      data.description = parsed.description.trim();
      finalSavedFields.description = data.description;
    }

    // date: resolved from electionClassification + state via the 2026 dict.
    // primary -> dict lookup, general -> Nov 3, special/runoff -> Gemini-inferred date.
    // Apply only when the resolved date differs from existing AND confidence >= 0.8.
    if (parsed.electionClassification) {
      finalSavedFields.electionClassification = parsed.electionClassification;
      const resolved = resolveElectionDate(
        parsed.electionClassification,
        e.state,
        parsed.date ?? null
      );
      if (!resolved) {
        finalSavedFields.dateSkipped = `could not resolve date for classification ${parsed.electionClassification} (state ${e.state}${parsed.date ? `, inferred ${parsed.date}` : ""})`;
      } else {
        const resolvedDate = new Date(resolved);
        if (isNaN(resolvedDate.getTime())) {
          finalSavedFields.dateSkipped = `resolved date unparseable: ${resolved}`;
        } else if (ymd(resolvedDate) !== ymd(e.date)) {
          if (canOverwrite) {
            data.date = resolvedDate;
            finalSavedFields.date = ymd(resolvedDate);
            finalSavedFields.dateResolutionSource =
              parsed.electionClassification === "primary"
                ? "dict:PRIMARY_DATES_2026"
                : parsed.electionClassification === "general"
                  ? "const:GENERAL_DATE_2026"
                  : "gemini:inferred";
          } else {
            finalSavedFields.dateSkipped = `confidence ${confidence.toFixed(2)} below overwrite threshold`;
          }
        }
      }
    }

    // positions: NOT NULL Int; update only when Gemini's value differs AND high confidence.
    if (parsed.positions != null) {
      if (parsed.positions !== e.positions) {
        if (canOverwrite) {
          data.positions = parsed.positions;
          finalSavedFields.positions = parsed.positions;
        } else {
          finalSavedFields.positionsSkipped = `confidence ${confidence.toFixed(2)} below overwrite threshold`;
        }
      }
    }

    // filingAuthorityName: stored values are untrusted, so any high-confidence
    // value from Gemini wins. Same shape as `date` / `positions`.
    if (parsed.filingAuthorityName && parsed.filingAuthorityName.trim()) {
      const v = parsed.filingAuthorityName.trim();
      if (canOverwrite) {
        data.filingAuthorityName = v;
        finalSavedFields.filingAuthorityName = v;
      } else {
        finalSavedFields.filingAuthorityNameSkipped = `confidence ${confidence.toFixed(2)} below overwrite threshold`;
      }
    }

    // filingAuthorityLevel: enum-validated; high-confidence overwrite or nothing.
    if (parsed.filingAuthorityLevel) {
      const v = parsed.filingAuthorityLevel.trim().toUpperCase();
      if (!LEVEL_VALUES.has(v)) {
        finalSavedFields.filingAuthorityLevelSkipped = `not a valid enum value: ${parsed.filingAuthorityLevel}`;
      } else if (canOverwrite) {
        data.filingAuthorityLevel = v as CrmFilingAuthorityLevel;
        finalSavedFields.filingAuthorityLevel = v;
      } else {
        finalSavedFields.filingAuthorityLevelSkipped = `confidence ${confidence.toFixed(2)} below overwrite threshold`;
      }
    }

    // filingAuthorityType: enum-validated; high-confidence overwrite or nothing.
    if (parsed.filingAuthorityType) {
      const v = parsed.filingAuthorityType.trim().toUpperCase();
      if (!TYPE_VALUES.has(v)) {
        finalSavedFields.filingAuthorityTypeSkipped = `not a valid enum value: ${parsed.filingAuthorityType}`;
      } else if (canOverwrite) {
        data.filingAuthorityType = v as CrmFilingAuthorityType;
        finalSavedFields.filingAuthorityType = v;
      } else {
        finalSavedFields.filingAuthorityTypeSkipped = `confidence ${confidence.toFixed(2)} below overwrite threshold`;
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.election.update({ where: { id: this.entityId }, data });
    }
    if (parsed.confidence !== undefined) finalSavedFields.confidence = parsed.confidence;

    await setTrackAtomic(this.store, "overview", {
      status: "result_saved",
      parsedResult: parsed as unknown as Record<string, unknown>,
      finalSavedFields,
    });
    // Single-track entity — stamp completedAt now.
    await setAuditFieldAtomic(this.store, "completedAt", new Date().toISOString());
    await this.refreshStatus();
  }
}
