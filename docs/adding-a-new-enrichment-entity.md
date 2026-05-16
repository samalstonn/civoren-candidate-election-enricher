# Adding a New Enrichment Entity Type

The enrichment pipeline is entity-agnostic. To enrich a new type (e.g. live site candidates, vendors), you implement the `EntityAdapter` interface and add an API route. The pipeline itself is untouched.

The pipeline runs **two parallel tracks** — `general` and `contact` — each with its own independent state machine (`search → gemini → save`). Your adapter implements both tracks via track-aware methods.

---

## 1. Implement `EntityAdapter`

Create `src/lib/enrichment/adapters/<your-entity>.ts`.

```ts
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  EntityAdapter,
  MatchAuditJson,
  TrackAudit,
  TrackKind,
  GeneralParsedResult,
  ContactParsedResult,
  TavilyResult,
} from "@/types/enrichment";
import { deriveOverallStatus } from "../auditMigration";

export class MyEntityAdapter implements EntityAdapter {
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: { firstName?: string | null; lastName?: string | null; fullNameRaw?: string | null };

  private constructor(/* loaded record */) {
    // populate entityId, logContext, nameParts from the record
  }

  static async create(id: number): Promise<MyEntityAdapter> {
    const record = await prisma.myModel.findUnique({ where: { id } });
    if (!record) throw new Error(`MyModel ${id} not found`);
    return new MyEntityAdapter(record);
  }

  // --- Search queries (one per track) ---

  buildSearchQuery(track: TrackKind): string {
    if (track === "contact") {
      return `${this.nameParts.fullNameRaw} contact email phone`;
    }
    return `${this.nameParts.fullNameRaw} vendor California`;
  }

  // --- Gemini prompts (one per track, with track-specific JSON shape) ---

  buildGeminiPrompt(track: TrackKind, sources: TavilyResult[]): string {
    // General prompt must return JSON matching GeneralParsedResult:
    //   { biography, currentRole, currentCity, currentState, party, sourceUrls, confidence, notes }
    // Contact prompt must return JSON matching ContactParsedResult:
    //   { email, phone, linkedin, website, sourceUrls, confidence, notes }
    return track === "general" ? `...general prompt...` : `...contact prompt...`;
  }

  // --- Audit trail ---

  async getAudit(): Promise<MatchAuditJson | null> {
    const record = await prisma.myModel.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const raw = record?.matchAuditJson;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as unknown as MatchAuditJson;
  }

  private async readCurrent(): Promise<MatchAuditJson> {
    return (
      (await this.getAudit()) ?? {
        runId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        general: { status: "not_started" },
        contact: { status: "not_started" },
        errors: [],
      }
    );
  }

  private async persist(audit: MatchAuditJson): Promise<void> {
    await prisma.myModel.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: audit as unknown as Prisma.InputJsonValue,
        enrichmentStatus: deriveOverallStatus(audit),
      },
    });
  }

  async updateAudit(patch: Partial<Omit<MatchAuditJson, "general" | "contact">>): Promise<void> {
    const current = await this.readCurrent();
    await this.persist({
      ...current,
      ...patch,
      errors: patch.errors !== undefined ? patch.errors : current.errors,
    });
  }

  async updateTrack(track: TrackKind, patch: Partial<TrackAudit>): Promise<void> {
    const current = await this.readCurrent();
    await this.persist({
      ...current,
      [track]: { ...current[track], ...patch },
    });
  }

  async appendError(error: { message: string; timestamp: string; track?: TrackKind }): Promise<void> {
    const current = await this.readCurrent();
    await this.persist({
      ...current,
      errors: [...(current.errors ?? []), error],
    });
  }

  // --- Save per-track result ---

  async saveTrackResult(
    track: TrackKind,
    parsed: GeneralParsedResult | ContactParsedResult,
    audit: MatchAuditJson
  ): Promise<void> {
    // Persist the Gemini output for this track to your entity's columns.
    // Then commit the per-track audit with status: "result_saved".
    if (track === "general") {
      const p = parsed as GeneralParsedResult;
      await prisma.myModel.update({
        where: { id: this.entityId },
        data: { bio: p.biography ?? undefined /* ...etc */ },
      });
    } else {
      const p = parsed as ContactParsedResult;
      await prisma.myModel.update({
        where: { id: this.entityId },
        data: { email: p.email ?? undefined, phone: p.phone ?? undefined },
      });
    }

    const fresh = await this.readCurrent();
    const updated: MatchAuditJson = {
      ...fresh,
      [track]: {
        ...fresh[track],
        status: "result_saved",
        parsedResult: parsed,
        finalSavedFields: { /* track what you actually wrote */ },
      },
    };
    if (updated.general.status === "result_saved" && updated.contact.status === "result_saved") {
      updated.completedAt = new Date().toISOString();
    }
    await this.persist(updated);
  }
}
```

**`logContext.rowId`** is used for `ApiCallLog` entries (Tavily + Gemini). Use your record's primary key.

**`nameParts`** drives source scoring and contact-page injection. If your entity has a person name, populate `firstName`/`lastName`. For an org, put the org name in `fullNameRaw` and leave the others null.

**`buildGeminiPrompt`** can be `async` if you need to fetch additional context. The returned string must instruct Gemini to respond with JSON matching the *track-specific* shape (`GeneralParsedResult` or `ContactParsedResult` — see `src/types/enrichment.ts`). Copy the prompt format from `LiveCandidateAdapter.buildGeminiPrompt` and adapt the entity description and field list.

**`appendError`** is called by the pipeline whenever any stage on either track throws. Implement it as a read-merge-write of `audit.errors[]` so failures from both tracks accumulate on the same audit blob (the `/candidates/[id]` UI renders them in a full-width Errors section below the per-track artifact columns).

**Audit shape is enforced.** Reads parse the JSON directly and trust the shape. The one-time migration (`scripts/migrate-audit-schema.ts`, run via `npm run migrate:audit`) rewrote all legacy flat-shape rows on `EnrichmentRecord.matchAuditJson` and `CrmIntakeDraftRow.matchAuditJson`; new entity types should never write the old shape.

---

## 2. Add an API route

Create `src/app/api/<your-entity>/[id]/enrich/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  runEnrichmentPipeline,
  normalizePipelineMode,
} from "@/lib/enrichment/pipeline";
import { MyEntityAdapter } from "@/lib/enrichment/adapters/my-entity";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entityId = parseInt(id, 10);
  if (isNaN(entityId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let rawMode = "full";
  try {
    const body = await req.json();
    if (typeof body?.mode === "string") rawMode = body.mode;
  } catch { /* no body */ }

  const modes = normalizePipelineMode(rawMode);
  if (modes.length === 0) {
    return NextResponse.json({ error: `Unknown mode: ${rawMode}` }, { status: 400 });
  }

  try {
    const adapter = await MyEntityAdapter.create(entityId);
    for (const mode of modes) await runEnrichmentPipeline(adapter, mode);
    return NextResponse.json({ success: true, entityId, modes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
```

`normalizePipelineMode` accepts both the new modes and legacy strings (`search`, `search_general`, `search_contact`, `gemini`, `save`) and maps them onto the new track-aware set.

For batch enrichment of many records, look at `src/app/api/submissions/[id]/enrich/route.ts` as a reference — it uses `runWithConcurrency` and `cancelRegistry` from `src/lib/`.

---

## 3. Ensure your Prisma model has the right columns

The audit trail needs a JSON column and a status column:

```prisma
model MyModel {
  id               Int      @id @default(autoincrement())
  matchAuditJson   Json?
  enrichmentStatus String?
  // ...your other fields
}
```

`enrichmentStatus` is a **derived overall status** computed from both tracks (`deriveOverallStatus` in `auditMigration.ts`): `result_saved` only when both tracks saved; `failed` if either failed; otherwise the less-advanced of the two.

After updating the schema, follow this repo's migration workflow (`prisma migrate deploy` after copying SQL from the parent app).

---

## Pipeline modes (for reference)

| Mode | What it does |
|---|---|
| `full` | Runs both tracks end-to-end in parallel (default) |
| `general_full` / `contact_full` | Runs one track end-to-end |
| `general_search` / `contact_search` | Runs only that track's search stage |
| `general_gemini` / `contact_gemini` | Runs only that track's Gemini stage (requires existing selected sources) |
| `general_save` / `contact_save` | Persists that track's parsed result without re-running upstream stages |

Legacy modes (`search`, `search_general`, `search_contact`, `gemini`, `save`) still work — they're normalized to combinations of the new modes by `normalizePipelineMode`.
