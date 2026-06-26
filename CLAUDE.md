# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Standing Instructions

After any change that affects architecture, pipeline behavior, API routes, adapter pattern, or DB schema: update the relevant section of this CLAUDE.md and any affected files in `docs/`. If no existing doc covers the changed area, create one. Follow `docs/documentation-guide.md` for what to write, how to name it, and where to put it. Keep docs current before considering a task complete.

**All list-style tables use the shared `DataTable` component at `src/components/DataTable.tsx`.** Do not hand-roll new `<table>` markup for tabular data — TanStack Table powers sort/filter/column-visibility everywhere. See `docs/data-table.md` for the column-definition pattern, exported helpers (`boolFilter`, `numberFilter`, `cells`, `DebouncedInput`), and how to layer page-level filter chips above it.

## What This Is

A Civoren Console internal Next.js 15 App Router console for enriching election candidate records with biographical data, contact info, and confidence scores. It connects to the parent Civoren app's PostgreSQL database (shared Prisma schema) and runs a Tavily search → Gemini AI pipeline with a full audit trail.

Three entity types are supported: **CRM intake draft rows**, **live election candidates**, and **elections**.

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

AUTH_SECRET=                     # Auth.js session signing key (openssl rand -base64 33)
AUTH_GOOGLE_ID=                  # Google OAuth client ID
AUTH_GOOGLE_SECRET=              # Google OAuth client secret
ALLOWED_AUTH_DOMAINS=civoren.com # Optional; comma-separated Workspace domains allowed to sign in
AUTH_URL=                        # Canonical app URL in prod (OAuth redirect base behind a proxy)
AUTH_TRUST_HOST=true             # Required on Railway / non-Vercel hosts
```

## Authentication

The entire console is gated behind Google Workspace SSO, restricted to the `civoren.com` domain, via Auth.js (NextAuth v5). `src/middleware.ts` exports `auth` as the middleware and protects every route except `api/auth/*` and static assets. The domain rule is enforced server-side in the `signIn` and `authorized` callbacks in `src/auth.ts` (the Google `hd` param is only a UX hint, not a security boundary). See `docs/authentication.md` for setup, env vars, and the Google Cloud OAuth client configuration.

## Architecture

The enrichment system is built around two registries — **entity kinds** and **tracks** — plus a shared prompt scaffold. Most of the system is driven by these registries; adding a new track or a new entity kind is a localized change.

### Registry (`src/lib/enrichment/registry/`)

The single source of truth for the set of enrichable entity kinds and the tracks each one runs.

- `registry/index.ts` — exports `ENTITIES`, the typed manifest. Also exports `EntityKind`, `TrackIdFor<K>`, `AnyTrackId`, and the helpers `getEntity`, `getTrack`, `trackIds`, `allTrackIds`.
- `registry/candidate.ts` — `CANDIDATE_TRACKS` array. Each entry: `{ id, label, accent, parseResult, instructions, jsonSchema, injectContactPages? }`. Add a track by appending one entry here.
- Future entity kinds go in their own `registry/<kind>.ts` (e.g. `election.ts`), and are added to `ENTITIES` in `registry/index.ts`.

`TrackKind` (legacy alias) === `AnyTrackId`. Use `TrackIdFor<"candidate">` when you want the track ids constrained to one entity kind.

### EntityAdapter Pattern (`src/types/enrichment.ts`)

The pipeline is entity-agnostic. Each adapter implements `EntityAdapter<K extends EntityKind>` and exposes:

- `entityKind: K` — which kind from the registry this adapter handles.
- `tracks: Record<TrackIdFor<K>, AdapterTrack>` — an exhaustive map keyed by track id. Each `AdapterTrack` has `buildSearchQuery()`, `buildGeminiPrompt(sources)`, and `save(parsed, audit)`. The TypeScript constraint means missing/misspelled track keys are compile errors.
- `getAudit / updateAudit / updateTrack / appendError` — audit persistence (see Audit Structure).

Implementations:
- `LiveCandidateAdapter` (entityKind: `"candidate"`) — reads/writes `Candidate`; stores audit in the shared `EnrichmentRecord` table.
- `CandidateIntakeAdapter` (entityKind: `"candidate"`) — reads/writes `CrmIntakeDraftRow`; stores audit inline on `matchAuditJson`.
- `LiveElectionAdapter` (entityKind: `"election"`) — reads/writes `Election`; stores audit inline on `Election.matchAuditJson`.

To add a new enrichable entity kind, register tracks + write an adapter + wire up an API route + UI page. See `docs/adding-a-new-enrichment-entity.md`.

### Shared prompt scaffold (`src/lib/enrichment/prompt.ts`)

All Gemini prompts are assembled by one function: `buildPrompt({ entityKind, context, sources, nameParts, instructions, jsonSchema, contextHeader? })`. The intro line, section headers, source-relevance filter, source formatting, and "respond with ONLY valid JSON" footer all live here. **To tweak global prompt phrasing, edit this one file.** Per-track variation comes from the `instructions` array and `jsonSchema` string in the registry; per-adapter variation (entity-specific context lines) comes from the adapter passing its own `context` string.

### Other shared modules

- `src/lib/enrichment/states.ts` — `STATE_NAMES`, `expandState`, `normalizeStateCode` (accepts code or full name, validates against canonical list).
- `src/lib/enrichment/validate.ts` — `isValidEmail`, `isValidPhone`, `isValidUrl`.
- `src/lib/enrichment/atomicAudit.ts` — `setTrackAtomic`, `setAuditFieldAtomic`, `appendErrorAtomic`, `refreshStatusMirror`. Postgres `jsonb_set` / jsonb-concat primitives that make per-track writes safe under concurrent parallel-track execution.

### Pipeline (`src/lib/enrichment/pipeline.ts`)

**The pipeline runs every track for an entity kind in parallel — each with its own independent state machine (`search → gemini → save`).** For candidates today that's `general` and `contact`; a future entity kind defines whatever tracks it needs in the registry. Tracks run in parallel via `Promise.allSettled` so one track failing doesn't cancel the others.

The pipeline reads everything it needs from the registry:
- `getTrack(adapter.entityKind, trackId).parseResult` — to parse Gemini's response.
- `getTrack(adapter.entityKind, trackId).injectContactPages` — pipeline hint that controls whether the search stage injects scraped contact pages.
- `trackIds(adapter.entityKind)` — to know which tracks to run on `"full"` mode.

It reads from the adapter:
- `adapter.tracks[trackId].buildSearchQuery()` — entity-specific Tavily query.
- `adapter.tracks[trackId].buildGeminiPrompt(sources)` — entity-specific prompt (typically calls `buildPrompt(...)` from the shared scaffold).
- `adapter.tracks[trackId].save(parsed, audit)` — entity-specific persistence.

#### Field ownership (candidate kind)

- **General track Gemini extracts**: `biography`, `currentRole`, `currentCity`, `currentState`, `party`. The general save writes those to `Candidate`, plus `party` to the candidate's current non-archived `ElectionLink`. `currentState` is normalized through `normalizeStateCode` (accepts "CA" or "California", rejects invalid 2-letter codes).
- **Contact track Gemini extracts**: `email`, `phone`, `linkedin`, `website`. The contact save writes those to `Candidate`. Existing email/phone are preserved; URLs are format-validated.

#### Field ownership (election kind)

- **Overview track Gemini extracts**: `description` (instructed to include the approximate population the seat governs), `electionClassification` (`primary | general | special | runoff`), `date` (only for special/runoff — Gemini infers), `positions` (seats up for election as an integer ≥ 1), `filingAuthorityName`, `filingAuthorityLevel`, `filingAuthorityType`. The overview save writes those to `Election`.
- **Date resolution** is dict-driven, not Gemini-driven: `src/lib/enrichment/electionDates2026.ts` holds the static 2026 primary date per state (`PRIMARY_DATES_2026`), the federal general date (`GENERAL_DATE_2026 = "2026-11-03"`), and known runoff dates. The adapter injects the state's row into the prompt as context, Gemini only classifies, and `resolveElectionDate(classification, state, inferredDate)` picks the final date: primary → dict, general → constant, special/runoff → Gemini-inferred. To update for a new cycle, edit that file.
- **Policy**: `description` is always overwritten when Gemini returns non-empty; `date`, `positions`, and `filingAuthority*` fields are all "high-confidence overwrite or nothing" — any non-empty value Gemini returns is written when `confidence >= 0.8` and ignored otherwise (no fill-if-null carve-out; stored filing-authority values are treated as untrustworthy). Enum fields (`filingAuthorityLevel`/`Type`) are validated against the Prisma enum values and silently skipped if invalid. The prompt deliberately does **not** surface the row's stored `filingAuthority*` values so Gemini researches the agency independently and isn't anchored by bad data.

#### Modes

`PipelineModeFor<K>` is derived from the entity kind's track ids via TypeScript template literals:

```ts
type PipelineModeFor<K> = "full" | `${TrackIdFor<K>}_full` | `${TrackIdFor<K>}_search` | `${TrackIdFor<K>}_gemini` | `${TrackIdFor<K>}_save`;
```

For candidates that expands to: `"full"`, `"general_full"`, `"contact_full"`, `"general_search"`, `"contact_search"`, `"general_gemini"`, `"contact_gemini"`, `"general_save"`, `"contact_save"`. Adding a new candidate track auto-expands this union.

Legacy modes (`"search"`, `"search_general"`, `"search_contact"`, `"gemini"`, `"save"`) are normalized at the API-route layer via `normalizePipelineMode(adapter, raw)` — they fan out to one mode per track for the adapter's kind.

Every stage patches `matchAuditJson` incrementally so intermediate artifacts persist on failure. Per-track writes use atomic Postgres `jsonb_set` to avoid lost-update races between parallel tracks.

### Audit Structure (`matchAuditJson`)

The audit blob is a top-level object with fixed bookkeeping fields plus one key per registered track. The type is a mapped type intersection:

```ts
type MatchAuditJson = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  errors?: { message: string; timestamp: string; track?: AnyTrackId }[];
} & { [K in AnyTrackId]?: TrackAudit };

type TrackAudit = {
  status: EnrichmentStatus;
  searchQuery?, searchRawResponse?,
  rankedSources?, selectedSources?,
  geminiPrompt?, geminiRawResponse?,
  parsedResult?,        // shape comes from the track's parser in the registry
  finalSavedFields?,
};
```

Registering a new track in `registry/<kind>.ts` automatically expands `AnyTrackId` and therefore the audit type — **no DB migration is needed**; absent track keys default to `not_started` at read time.

Each track's `status` progresses `not_started` → `search_queued` → `search_running` → `search_complete` → `gemini_queued` → `gemini_running` → `gemini_complete` → `result_saved`. Failure: `failed`. The DB is fully migrated to this shape via `scripts/migrate-audit-schema.ts` (run via `npm run migrate:audit`); reads no longer go through a runtime projection shim.

The single `enrichmentStatus` mirror column on `EnrichmentRecord` (and on `CrmIntakeDraftRow`) is a **derived overall status** computed by `deriveOverallStatus` in `auditMigration.ts`: it iterates every registered track id, ignores absent tracks, and returns `result_saved` only when every present track has saved; `failed` if any failed; otherwise the least-advanced status across present tracks.

#### Concurrent-write safety

Parallel-track writes go through `src/lib/enrichment/atomicAudit.ts` — `setTrackAtomic` uses Postgres `jsonb_set` + `||` to merge a patch into one named track key without read-modify-write in JS. `appendErrorAtomic` does the equivalent for the `errors[]` array. This is what keeps two concurrent tracks from clobbering each other's writes.

### Key Files

```
src/lib/enrichment/
├── registry/
│   ├── index.ts              # ENTITIES manifest, EntityKind, TrackIdFor<K>, AnyTrackId, getTrack, trackIds, allTrackIds
│   └── candidate.ts          # CANDIDATE_TRACKS — track defs for the candidate entity kind
├── prompt.ts                 # Shared buildPrompt() + filterRelevantSources + formatSources
├── states.ts                 # STATE_NAMES, expandState, normalizeStateCode
├── validate.ts               # isValidEmail, isValidPhone, isValidUrl
├── atomicAudit.ts            # Atomic jsonb_set primitives for race-safe audit writes
├── auditMigration.ts         # deriveOverallStatus (per-track → single enrichmentStatus mirror)
├── pipeline.ts               # Registry-driven generic pipeline; PipelineModeFor<K>; normalizePipelineMode
├── enrichmentRecord.ts       # Live-candidate audit persistence (uses atomicAudit)
├── parseGeminiResult.ts      # parseGeneralResult / parseContactResult (referenced by registry entries)
├── callGemini.ts             # Gemini call + token/cost logging to ApiCallLog
├── runSearch.ts              # Tavily call wrapper
├── fetchContactPage.ts       # Detect and fetch contact/about pages
├── fetchYouTubeTranscript.ts # Fetch transcripts from YouTube URLs
├── fetchThinSources.ts       # Full-page fetch for low-content sources
└── adapters/
    ├── candidate-intake.ts   # CandidateIntakeAdapter (entityKind: "candidate")
    └── live-candidate.ts     # LiveCandidateAdapter (entityKind: "candidate")

src/types/enrichment.ts       # EntityAdapter<K>, AdapterTrack, MatchAuditJson, TrackAudit, GeneralParsedResult, ContactParsedResult
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
| `POST /api/candidates/batch-enrich` | Server-side batch enrich a list of candidate ids (`runWithConcurrency` gated by `ENRICHMENT_CONCURRENCY`). Runs to completion even if client tab closes. |
| `GET /api/candidates` | List candidates with derived fields for the list table (booleans, bio length, relation counts via `_count`) |
| `GET /api/candidates/[id]` | Fetch a single candidate with full audit + current election link |
| `GET /api/elections` | List elections with derived fields for the list table (candidate counts, verified count, description length, region label, enrichmentStatus). |
| `GET /api/elections/[id]` | Fetch a single election with region link, non-archived candidate links, enrichmentRecord, and per-track search-query previews. |
| `POST /api/elections/[id]/enrich` | Enrich a single election (overview track). Accepts optional `{ "mode": "..." }` body; defaults to `"full"`. |
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
/elections    Election list (DataTable + enrichmentStatus filter chips + batch "Enrich filtered" button with concurrency 3). Columns: id, position, cycle, date, active, candidates count, verified candidates count, description length, positions, city, state, type, region label.
/elections/[id]  Election detail: header with region label preferred over city, per-track action buttons + Run Full, single Overview pipeline strip, overview/description/region/filing-authority cards (region + authority cards conditional on data), collapsible canonical/source debug block, embedded DataTable of non-archived linked candidates, and a pipeline-artifacts column for the Overview track (search query/sources/Gemini prompt+response/parsed result/saved fields).
/logs         API call log with cost breakdown (DataTable + apiType chips + server pagination)
```
