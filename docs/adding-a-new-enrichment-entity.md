# Adding a New Enrichment Entity Type

The enrichment pipeline is entity-agnostic. To enrich a new type (e.g. live site candidates, vendors), you implement the `EntityAdapter` interface and add an API route. The pipeline itself is untouched.

---

## 1. Implement `EntityAdapter`

Create `src/lib/enrichment/adapters/<your-entity>.ts`.

```ts
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { EntityAdapter, MatchAuditJson, ParsedEnrichmentResult, TavilyResult } from "@/types/enrichment";

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

  // --- Search ---

  buildSearchQuery(): string {
    // Return a Tavily search query string for this entity
    return `${this.nameParts.fullNameRaw} vendor California`;
  }

  buildContactSearchQuery(): string {
    // Return a contact-focused variant (name + "contact email phone")
    return `${this.nameParts.fullNameRaw} contact email phone`;
  }

  // --- Gemini prompt ---

  buildGeminiPrompt(sources: TavilyResult[]): string {
    // Build the full prompt string passed to Gemini.
    // sources are the top-ranked search results.
    // The response must be JSON matching ParsedEnrichmentResult.
    return `...`;
  }

  // --- Audit trail ---

  async getAudit(): Promise<MatchAuditJson | null> {
    const record = await prisma.myModel.findUnique({
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
    const existing = await prisma.myModel.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const current =
      existing?.matchAuditJson &&
      typeof existing.matchAuditJson === "object" &&
      !Array.isArray(existing.matchAuditJson)
        ? (existing.matchAuditJson as Partial<MatchAuditJson>)
        : {};

    await prisma.myModel.update({
      where: { id: this.entityId },
      data: {
        matchAuditJson: { ...current, ...patch } as unknown as Prisma.InputJsonValue,
        // Mirror status to a dedicated column if your model has one:
        ...(patch.status ? { enrichmentStatus: patch.status } : {}),
      },
    });
  }

  // --- Save result ---

  async saveResult(parsed: ParsedEnrichmentResult, audit: MatchAuditJson): Promise<void> {
    // Persist the Gemini output however makes sense for your model.
    // The completedAudit below closes out the audit trail.
    const completedAudit: MatchAuditJson = {
      ...audit,
      status: "result_saved",
      completedAt: new Date().toISOString(),
    };

    await prisma.myModel.update({
      where: { id: this.entityId },
      data: {
        email: parsed.email ?? undefined,
        bio: parsed.biography ?? undefined,
        enrichmentStatus: "result_saved",
        matchAuditJson: completedAudit as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
```

**`logContext.rowId`** is used for `ApiCallLog` entries (Tavily + Gemini). Use your record's primary key. `submissionId` is optional and only needed if you want logs grouped by a parent batch.

**`nameParts`** drives source scoring and contact-page injection. If your entity has a person name, populate `firstName`/`lastName`. For an org, put the org name in `fullNameRaw` and leave the others null.

**`buildGeminiPrompt`** can be `async` if you need to fetch additional context. The returned string must instruct Gemini to respond with JSON matching `ParsedEnrichmentResult` (see `src/types/enrichment.ts`). Copy the prompt format from `CandidateIntakeAdapter.buildGeminiPrompt` and adapt the entity description and instructions.

---

## 2. Add an API route

Create `src/app/api/<your-entity>/[id]/enrich/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runEnrichmentPipeline, type PipelineMode } from "@/lib/enrichment/pipeline";
import { MyEntityAdapter } from "@/lib/enrichment/adapters/my-entity";

const VALID_MODES: PipelineMode[] = ["search", "search_general", "search_contact", "gemini", "save", "full"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entityId = parseInt(id, 10);
  if (isNaN(entityId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let mode: PipelineMode = "full";
  try {
    const body = await req.json();
    if (body?.mode && VALID_MODES.includes(body.mode)) mode = body.mode;
  } catch { /* no body */ }

  try {
    const adapter = await MyEntityAdapter.create(entityId);
    await runEnrichmentPipeline(adapter, mode);
    return NextResponse.json({ success: true, entityId, mode });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
```

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

Run `prisma migrate dev` after updating the schema.

---

## Pipeline modes (for reference)

| Mode | What it does |
|---|---|
| `full` | Runs search → Gemini → save end-to-end (default) |
| `search` | Runs both search queries, stores ranked sources |
| `search_general` | Re-runs only the general search query |
| `search_contact` | Re-runs only the contact search query |
| `gemini` | Re-runs Gemini using stored search results |
| `save` | Persists a stored Gemini result without re-running anything |

Partial modes are useful for inspecting intermediate results or resuming after a failure.
