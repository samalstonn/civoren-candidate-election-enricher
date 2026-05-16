# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Standing Instructions

After any change that affects architecture, pipeline behavior, API routes, adapter pattern, or DB schema: update the relevant section of this CLAUDE.md and any affected files in `docs/`. If no existing doc covers the changed area, create one. Follow `docs/documentation-guide.md` for what to write, how to name it, and where to put it. Keep docs current before considering a task complete.

**All list-style tables use the shared `DataTable` component at `src/components/DataTable.tsx`.** Do not hand-roll new `<table>` markup for tabular data — TanStack Table powers sort/filter/column-visibility everywhere. See `docs/data-table.md` for the column-definition pattern, exported helpers (`boolFilter`, `numberFilter`, `cells`, `DebouncedInput`), and how to layer page-level filter chips above it.

## What This Is

A Civoren Console internal Next.js 15 App Router console for enriching election candidate records with biographical data, contact info, and confidence scores. It connects to the parent Civoren app's PostgreSQL database (shared Prisma schema) and runs a Tavily search → Gemini AI pipeline with a full audit trail.

Two entity types are supported: **CRM intake draft rows** and **live election candidates**.

## Commands

```bash
npm run dev       # Dev server at http://localhost:3000
npm run build     # Production build
npm run lint      # ESLint
npx tsc --noEmit  # Type-check only (no test suite)

npx prisma generate          # Regenerate client after schema changes
npx prisma migrate deploy    # Apply pending migration files — always use this, never migrate dev

npm run migrate:audit:dry    # One-time audit-shape migration, dry-run
npm run migrate:audit        # One-time audit-shape migration, live (idempotent)
```

**Never use `prisma db push` or `prisma migrate dev`** in this repo. Migrations are authored in the Civoren parent app and copied here. `migrate dev` does drift detection against the parent app's schema and will always report false positives. `migrate deploy` just applies pending files with no comparison — that's correct behavior here.

## Environment Variables

```
DATABASE_URL=                    # Pooled Postgres (Neon)
DATABASE_URL_UNPOOLED=           # Unpooled for migrations
TAVILY_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=                    # e.g. gemini-2.5-flash
ENRICHMENT_CONCURRENCY=5         # Batch concurrency limit
GEMINI_INPUT_COST_PER_1M_TOKENS=
GEMINI_OUTPUT_COST_PER_1M_TOKENS=
TAVILY_COST_PER_CALL=
```

## Architecture

### EntityAdapter Pattern

The pipeline is entity-agnostic. All domain knowledge is encapsulated in adapter classes that implement `EntityAdapter` (`src/types/enrichment.ts`):

- `CandidateIntakeAdapter` — reads/writes `CrmIntakeDraftRow`; stores audit on the row's `matchAuditJson` column
- `LiveCandidateAdapter` — reads/writes `Candidate`; stores audit in the shared `EnrichmentRecord` table via `src/lib/enrichment/enrichmentRecord.ts`

To add a new enrichable entity type, implement `EntityAdapter` and wire up an API route + UI page. See `docs/adding-a-new-enrichment-entity.md`.

### Pipeline (`src/lib/enrichment/pipeline.ts`)

**The pipeline runs two parallel tracks — `general` and `contact` — each with its own independent state machine (`search → gemini → save`).** Each track has its own search query, its own Tavily results, its own Gemini prompt + raw response + parsed result, and its own save step. They run in parallel via `Promise.allSettled` so one track failing doesn't cancel the other.

Field ownership:
- **General track Gemini extracts**: `biography`, `currentRole`, `currentCity`, `currentState`, `party`. The general save writes those to `Candidate`, plus `party` to the candidate's current non-archived `ElectionLink`.
- **Contact track Gemini extracts**: `email`, `phone`, `linkedin`, `website`. The contact save writes those to `Candidate`. Existing email/phone are preserved; URLs are format-validated.

Modes (`PipelineMode`):
- `"full"` — both tracks, end-to-end.
- `"general_full"` / `"contact_full"` — one track, end-to-end.
- `"general_search"` / `"contact_search"` — one track, search stage only.
- `"general_gemini"` / `"contact_gemini"` — one track, gemini only (requires existing selected sources).
- `"general_save"` / `"contact_save"` — one track, save only (requires existing parsed result).

Legacy modes (`"search"`, `"search_general"`, `"search_contact"`, `"gemini"`, `"save"`) are normalized to the new modes at the API-route layer via `normalizePipelineMode` (`pipeline.ts`).

Every stage patches `matchAuditJson` incrementally (deep-merging into `general.*` or `contact.*`) so intermediate artifacts persist on failure.

### Audit Structure (`matchAuditJson`)

The audit blob is now per-track. Shape:

```ts
{
  runId, startedAt, completedAt?,
  general: TrackAudit,
  contact: TrackAudit,
  errors?: { message, timestamp, track? }[]
}

TrackAudit = {
  status: EnrichmentStatus,
  searchQuery?, searchRawResponse?,
  rankedSources?, selectedSources?,
  geminiPrompt?, geminiRawResponse?,
  parsedResult?,        // GeneralParsedResult or ContactParsedResult depending on track
  finalSavedFields?,
}
```

Each track's `status` progresses `not_started` → `search_queued` → `search_running` → `search_complete` → `gemini_queued` → `gemini_running` → `gemini_complete` → `result_saved`. Failure: `failed`. The DB is fully migrated to this shape via `scripts/migrate-audit-schema.ts` (run via `npm run migrate:audit`); reads no longer go through a runtime projection shim.

The single `enrichmentStatus` column on `EnrichmentRecord` (and on `CrmIntakeDraftRow`) is a **derived overall status** (`deriveOverallStatus` in `auditMigration.ts`): `result_saved` only when both tracks saved; `failed` if either failed; otherwise the less-advanced of the two.

### Key Files

```
src/lib/enrichment/
├── pipeline.ts               # Main orchestrator (split tracks: general + contact, parallel)
├── enrichmentRecord.ts       # getEnrichmentAudit / updateEnrichmentTrack / replaceEnrichmentAudit / appendEnrichmentError (live candidates)
├── auditMigration.ts         # deriveOverallStatus (per-track → single enrichmentStatus mirror)
├── callGemini.ts             # Gemini call + token/cost logging to ApiCallLog
├── runSearch.ts              # Tavily call wrapper
├── parseGeminiResult.ts      # parseGeneralResult / parseContactResult / parseTrackResult
├── fetchContactPage.ts       # Detect and fetch contact/about pages
├── fetchYouTubeTranscript.ts # Fetch transcripts from YouTube URLs
├── fetchThinSources.ts       # Full-page fetch for low-content sources
└── adapters/
    ├── candidate-intake.ts   # CandidateIntakeAdapter
    └── live-candidate.ts     # LiveCandidateAdapter

src/types/enrichment.ts       # EntityAdapter interface, MatchAuditJson, TrackAudit, GeneralParsedResult, ContactParsedResult
src/lib/concurrency.ts        # Semaphore for batch enrichment
src/lib/cancelRegistry.ts     # AbortSignal tracking for submission-level cancellation
scripts/migrate-audit-schema.ts  # One-time legacy → track-split audit migration (idempotent)
```

### API Routes

| Route | Purpose |
|---|---|
| `POST /api/rows/[id]/enrich` | Enrich a single CRM intake row |
| `POST /api/submissions/[id]/enrich` | Batch enrich all not-started rows in a submission |
| `POST /api/submissions/[id]/cancel` | Cancel in-flight batch enrichment |
| `POST /api/candidates/[id]/enrich` | Enrich a live candidate |
| `GET /api/candidates` | List candidates with derived fields for the list table (booleans, bio length, relation counts via `_count`) |
| `GET /api/candidates/[id]` | Fetch a single candidate with full audit + current election link |
| `GET /api/logs` | API call log (Tavily + Gemini) with cost/latency |
| `GET /api/logs/summary` | Aggregated cost/count summary |

### Database

Shares the Prisma schema with the parent Civoren app. The `EnrichmentRecord` model is the only model added exclusively for this repo — it's the shared audit table for live candidates keyed by `(entityType, entityId)`. CRM intake rows use a `matchAuditJson` column directly on `CrmIntakeDraftRow`.

Migrations live in `prisma/migrations/` and must stay in sync with the parent app's migration history. When creating a new migration, write the SQL manually and place it in a new timestamped folder, then run `prisma migrate deploy`.

When updating `schema.prisma` from the parent app, copy the file then re-add the `EnrichmentRecord` model block at the top (after the datasource block) — it's the only model that lives exclusively in this repo.

**Audit shape migration**: the `matchAuditJson` columns on both `EnrichmentRecord` and `CrmIntakeDraftRow` were migrated from a legacy flat shape to the new `{ general, contact }` track-split shape via `scripts/migrate-audit-schema.ts`. Existing dev DBs and any future clones of the parent app's data need to run `npm run migrate:audit` once; the script is idempotent so re-running is safe.

### UI Structure

All list views use the shared `DataTable` component (`src/components/DataTable.tsx`) — see `docs/data-table.md`. It provides sortable columns, global search + per-column filters, and toggleable column visibility. Page-level filter chips (e.g. enrichmentStatus on `/candidates` and `/intake/[id]`) live above the table and pre-filter the row array.

```
/             Dashboard with count cards per entity type
/intake       CRM intake submission list (DataTable)
/intake/[id]  Submission detail (DataTable + per-row enrich/details actions + status chips)
/rows/[id]    Row detail: pipeline timeline, enrich buttons, collapsible audit sections
/candidates   Candidate list (DataTable + enrichmentStatus filter chips)
/candidates/[id]  Candidate detail: two-column tracks layout — General + Contact pipeline strips, per-track action buttons (Run Search / Run Gemini / Save / Run All), Run Full, and a 2-column artifacts grid. Errors render full-width with a track pill.
/logs         API call log with cost breakdown (DataTable + apiType chips + server pagination)
```
