# Adding a New Enrichment Entity Kind

The enrichment system is registry-driven. To enrich a new entity kind (e.g. `election`, `vendor`), you:

1. **Register the entity kind and its tracks** in `src/lib/enrichment/registry/`.
2. **Write an adapter** implementing `EntityAdapter<K>` with a `tracks` map.
3. **Wire up an API route** + a detail page.
4. **Ensure the backing Prisma model has the right columns**.

The pipeline, prompt scaffold, audit storage, mode-string parsing, and UI iteration all read from the registry — they don't change when you add an entity kind.

---

## 1. Register the entity kind

### `src/lib/enrichment/registry/<kind>.ts` — track manifest

Define an `as const` array of track definitions for the new entity kind:

```ts
// src/lib/enrichment/registry/election.ts
import { parseMetadataResult, parseBallotResult } from "../parseGeminiResult";

const metadataParser = parseMetadataResult as unknown as (raw: string) => Record<string, unknown>;
const ballotParser = parseBallotResult as unknown as (raw: string) => Record<string, unknown>;

export const ELECTION_TRACKS = [
  {
    id: "metadata",
    label: "Metadata",
    accent: "gray",
    parseResult: metadataParser,
    instructions: [
      "Extract the filing deadline as YYYY-MM-DD …",
      "Extract the polling-place URL …",
      // …
    ],
    jsonSchema: `{ "filingDeadline": "...", "pollingPlaceUrl": "...", ... }`,
  },
  // …additional tracks
] as const;
```

Each `TrackDefinition` carries: `id`, `label`, `accent` (`gray|blue|amber|green|purple`), `parseResult`, `instructions`, `jsonSchema`, and optional `injectContactPages`. See `src/lib/enrichment/registry/candidate.ts` for the candidate example.

The `parseResult` returns `Record<string, unknown>` — your adapter's `save` function casts to its typed interface. Define those typed interfaces alongside the parsers (see `GeneralParsedResult` / `ContactParsedResult` in `src/types/enrichment.ts`).

### `src/lib/enrichment/registry/index.ts` — entity kind map

Add the new kind to `ENTITIES`:

```ts
import { CANDIDATE_TRACKS } from "./candidate";
import { ELECTION_TRACKS } from "./election";

export const ENTITIES = {
  candidate: { id: "candidate", label: "political candidate", tracks: CANDIDATE_TRACKS },
  election:  { id: "election",  label: "election",            tracks: ELECTION_TRACKS },
} as const satisfies Record<string, EntityKindDefinition>;
```

The `label` is what gets injected into prompt intros ("You are a {label} research assistant…"). `TrackIdFor<"election">` and `PipelineModeFor<"election">` auto-derive from the manifest.

---

## 2. Implement the adapter

Create `src/lib/enrichment/adapters/<kind>.ts`. The adapter implements `EntityAdapter<K>` and exposes a `tracks: Record<TrackIdFor<K>, AdapterTrack>` map — one entry per track id from the registry. TypeScript's exhaustive-record constraint means you can't ship the file with a missing track.

```ts
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { buildPrompt } from "../prompt";
import { getTrack, type TrackIdFor } from "../registry";
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
  TrackAudit,
} from "@/types/enrichment";

const ENTITY_TYPE = "election" as const;
type ElectionTrackId = TrackIdFor<"election">;

export class LiveElectionAdapter implements EntityAdapter<"election"> {
  readonly entityKind = ENTITY_TYPE;
  readonly entityId: number;
  readonly logContext: { rowId: number; submissionId?: number };
  readonly nameParts: NameParts;
  readonly tracks: Record<ElectionTrackId, AdapterTrack>;

  private constructor(/* loaded record */) {
    this.entityId = /* … */;
    this.logContext = { rowId: this.entityId };
    this.nameParts = { fullNameRaw: /* election name or position title */ };

    this.tracks = {
      metadata: {
        buildSearchQuery: () => `${/* election context */} filing deadline polling place`,
        buildGeminiPrompt: (sources) =>
          buildPrompt({
            entityKind: "election",
            contextHeader: "ELECTION",
            context: this.contextLines(),
            sources,
            nameParts: this.nameParts,
            instructions: [...getTrack("election", "metadata").instructions],
            jsonSchema: getTrack("election", "metadata").jsonSchema,
          }),
        save: (parsed, audit) => this.saveMetadata(parsed, audit),
      },
      // …one entry per track id
    };
  }

  static async create(id: number): Promise<LiveElectionAdapter> {
    const record = await prisma.election.findUnique({ where: { id } });
    if (!record) throw new Error(`Election ${id} not found`);
    return new LiveElectionAdapter(/* record */);
  }

  private contextLines(): string { /* entity-specific context */ return ""; }

  // ---- Audit persistence ----

  private get store(): AuditStore {
    return {
      table: "Election",                 // or "EnrichmentRecord" if using the shared table
      jsonCol: "matchAuditJson",
      statusCol: "enrichmentStatus",
      where: [{ col: "id", value: this.entityId }],
    };
  }

  async getAudit(): Promise<MatchAuditJson | null> {
    const r = await prisma.election.findUnique({
      where: { id: this.entityId },
      select: { matchAuditJson: true },
    });
    const raw = r?.matchAuditJson;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as unknown as MatchAuditJson;
  }

  private async refreshStatus(): Promise<void> {
    await refreshStatusMirror(this.store, async () => {
      const a = await this.getAudit();
      return a ? deriveOverallStatus(a) : null;
    });
  }

  async updateAudit(patch): Promise<void> {
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await setAuditFieldAtomic(this.store, field, value);
    }
    await this.refreshStatus();
  }

  async updateTrack(track: ElectionTrackId, patch: Partial<TrackAudit>): Promise<void> {
    await setTrackAtomic(this.store, track, patch);
    await this.refreshStatus();
  }

  async appendError(error): Promise<void> {
    await appendErrorAtomic(this.store, error);
    await this.refreshStatus();
  }

  // ---- Track-specific save ----

  private async saveMetadata(parsed: Record<string, unknown>, audit: MatchAuditJson): Promise<void> {
    // 1. Persist parsed fields to your Prisma columns.
    await prisma.election.update({ where: { id: this.entityId }, data: { /* … */ } });

    // 2. Commit the per-track audit atomically.
    await setTrackAtomic(this.store, "metadata", {
      status: "result_saved",
      parsedResult: parsed,
      finalSavedFields: { /* what you actually wrote */ },
    });
    await this.refreshStatus();
  }
}
```

### Key contract details

- **`logContext.rowId`** is used for `ApiCallLog` entries (Tavily + Gemini billing/observability). Use your record's primary key.
- **`nameParts`** drives source scoring and the relevance filter in the shared prompt scaffold. If your entity has a person name, populate `firstName`/`lastName`. For an org/location/election, put the most distinctive name in `fullNameRaw` and leave the others null.
- **`buildGeminiPrompt`** must call `buildPrompt(...)` from `src/lib/enrichment/prompt.ts` so wording stays consistent everywhere. Per-track variations come from `getTrack(kind, trackId).instructions` and `.jsonSchema`. Per-adapter variations (entity-specific context lines) come from your `context` string. The function may be `async` if you need to fetch extra context.
- **Audit writes**: all per-track and per-error writes must go through the atomic helpers in `src/lib/enrichment/atomicAudit.ts`. Doing read-modify-write in JS is unsafe because tracks run in parallel — see `docs/split-pipeline.md` for the concurrent-writes section.
- **Audit storage**: you can either use the shared `EnrichmentRecord` table (keyed by `entityType + entityId`) like `LiveCandidateAdapter`, or store JSON inline on your own model like `CandidateIntakeAdapter`. Pick whichever fits your data.

---

## 3. Add an API route

Create `src/app/api/<kind>s/[id]/enrich/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runEnrichmentPipeline, normalizePipelineMode } from "@/lib/enrichment/pipeline";
import { LiveElectionAdapter } from "@/lib/enrichment/adapters/live-election";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const adapter = await LiveElectionAdapter.create(entityId);
    const modes = normalizePipelineMode(adapter, rawMode);
    if (modes.length === 0) {
      return NextResponse.json({ error: `Unknown mode: ${rawMode}` }, { status: 400 });
    }
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

`normalizePipelineMode(adapter, raw)` validates against the adapter's entity-kind tracks and accepts the legacy mode strings (`search`, `gemini`, `save`, etc.) which fan out to every track for that kind.

For a GET route that powers the detail page, also compute a **search-query preview** per track so the UI can show the queries before any run (see `src/app/api/candidates/[id]/route.ts` for the pattern).

For batch enrichment of many records, see `src/app/api/submissions/[id]/enrich/route.ts` — it uses `runWithConcurrency` and `cancelRegistry` from `src/lib/`.

---

## 4. Prisma model

The audit trail needs two columns; everything else is your entity's data:

```prisma
model MyModel {
  id               Int      @id @default(autoincrement())
  matchAuditJson   Json?
  enrichmentStatus String?
  // ...your other fields
}
```

`enrichmentStatus` is the **derived overall status** computed by `deriveOverallStatus(audit)` in `auditMigration.ts`: it iterates every present track in the audit blob, returns `result_saved` only when each one has saved, `failed` if any failed, otherwise the least-advanced status across present tracks.

Follow this repo's migration workflow (`prisma migrate deploy` after copying SQL from the parent app — never `migrate dev` or `db push`).

---

## 5. Detail UI

Copy `src/app/candidates/[id]/page.tsx` as a starting point. The page renders entirely from the registry: pipeline strips, action-button columns, and the artifacts grid are all `CANDIDATE_TRACKS.map(...)`. To target your new entity kind, change one constant near the top:

```ts
const TRACKS = ENTITIES.election.tracks;
type TrackId = TrackIdFor<"election">;
type Mode = PipelineModeFor<"election">;
```

— and update the data-fetching to call your `/api/elections/[id]` route. No other UI changes are needed; adding a track to your entity later auto-renders.

---

## Pipeline modes (auto-derived per entity kind)

For any entity kind `K`, the valid modes are:

| Mode | What it does |
|---|---|
| `"full"` | Runs every track end-to-end in parallel (default) |
| `` `${TrackId}_full` `` | Runs one track end-to-end |
| `` `${TrackId}_search` `` | Runs only that track's search stage |
| `` `${TrackId}_gemini` `` | Runs only that track's Gemini stage (requires existing selected sources) |
| `` `${TrackId}_save` `` | Persists that track's parsed result without re-running upstream stages |

Legacy modes (`search`, `search_general`, `search_contact`, `gemini`, `save`) still work — `normalizePipelineMode` fans them out across all of the adapter kind's tracks.

---

## Where to read next

- `docs/split-pipeline.md` — deeper coverage of the registry, the shared prompt scaffold, audit shape, and the atomic-write pattern.
- `src/lib/enrichment/adapters/live-candidate.ts` — the most complete reference adapter.
- `src/lib/enrichment/atomicAudit.ts` — the four primitives every adapter's audit writes must go through.
