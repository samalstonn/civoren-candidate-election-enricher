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

Accepts an adapter and a `mode`, then runs the appropriate stages:

| Stage | What it does |
|---|---|
| `search` | Builds two Tavily queries (general + contact) via the adapter, runs them in parallel, merges/dedupes, enriches thin sources and contact pages, picks top 5 by score |
| `gemini` | Builds structured prompt via adapter, calls Gemini, parses JSON response |
| `save` | Validates email/phone, writes parsed fields to entity (never overwrites existing email/phone) |

Modes: `"full"` runs all three; individual modes (`"search"`, `"search_general"`, `"search_contact"`, `"gemini"`, `"save"`) allow re-running a single stage.

Every stage patches `matchAuditJson` incrementally so intermediate artifacts persist on failure.

### Audit Structure (`matchAuditJson`)

All enrichment state is a single JSON blob per entity, holding: `runId`, `status`, `searchQuery`, `contactSearchQuery`, raw Tavily responses, `rankedSources`, `selectedSources`, `geminiPrompt`, `geminiRawResponse`, `parsedResult`, `finalSavedFields`, and `errors[]`.

Status progression: `not_started` → `search_queued` → `search_running` → `search_complete` → `gemini_queued` → `gemini_running` → `gemini_complete` → `result_saved`. Failure states: `failed`, `needs_review`.

### Key Files

```
src/lib/enrichment/
├── pipeline.ts               # Main orchestrator
├── enrichmentRecord.ts       # getEnrichmentAudit / updateEnrichmentAudit (for live candidates)
├── callGemini.ts             # Gemini call + token/cost logging to ApiCallLog
├── runSearch.ts              # Tavily call wrapper
├── parseGeminiResult.ts      # JSON validation and type coercion
├── fetchContactPage.ts       # Detect and fetch contact/about pages
├── fetchYouTubeTranscript.ts # Fetch transcripts from YouTube URLs
├── fetchThinSources.ts       # Full-page fetch for low-content sources
└── adapters/
    ├── candidate-intake.ts   # CandidateIntakeAdapter
    └── live-candidate.ts     # LiveCandidateAdapter

src/types/enrichment.ts       # EntityAdapter interface, MatchAuditJson, ParsedEnrichmentResult
src/lib/concurrency.ts        # Semaphore for batch enrichment
src/lib/cancelRegistry.ts     # AbortSignal tracking for submission-level cancellation
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

### UI Structure

All list views use the shared `DataTable` component (`src/components/DataTable.tsx`) — see `docs/data-table.md`. It provides sortable columns, global search + per-column filters, and toggleable column visibility. Page-level filter chips (e.g. enrichmentStatus on `/candidates` and `/intake/[id]`) live above the table and pre-filter the row array.

```
/             Dashboard with count cards per entity type
/intake       CRM intake submission list (DataTable)
/intake/[id]  Submission detail (DataTable + per-row enrich/details actions + status chips)
/rows/[id]    Row detail: pipeline timeline, enrich buttons, collapsible audit sections
/candidates   Candidate list (DataTable + enrichmentStatus filter chips)
/candidates/[id]  Candidate detail: same layout as /rows/[id]
/logs         API call log with cost breakdown (DataTable + apiType chips + server pagination)
```
