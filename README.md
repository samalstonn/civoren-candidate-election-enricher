# Candidate Enrichment Console

Private internal tool for enriching CRM intake candidate records. Connects to the parent app's PostgreSQL database and runs a search → Gemini pipeline on `CrmIntakeDraftRow` records, with full pipeline visibility at every stage.

## What it does

1. Select a `CrmIntakeSubmission` (intake batch)
2. View its draft rows (candidates)
3. Run enrichment on one row or all not-started rows
4. For each row: build a search query → call Tavily → build a Gemini prompt → call Gemini 1.5 Flash → parse and save the result
5. Inspect every intermediate artifact on the row detail page

## Pages

| Route | Description |
|---|---|
| `/submissions` | List all submissions with per-status row counts |
| `/submissions/:id` | Submission detail — all draft rows, status badges, batch enrich |
| `/rows/:id` | Row debug page — pipeline timeline, expandable sections for every artifact |

## Pipeline stages

`not_started` → `search_queued` → `search_running` → `search_complete` → `gemini_queued` → `gemini_running` → `gemini_complete` → `result_saved`

Error states: `failed`, `needs_review`

All stage transitions and artifacts (search query, raw Tavily response, selected sources, Gemini prompt, raw Gemini response, parsed result, saved fields, errors) are stored in `matchAuditJson` on the draft row.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.local` and fill in the values:

```
DATABASE_URL=          # parent app's Postgres connection string (pooled)
DATABASE_URL_UNPOOLED= # unpooled connection string (for Prisma migrations)
TAVILY_API_KEY=        # from app.tavily.com
GEMINI_API_KEY=        # from Google AI Studio
GEMINI_MODEL=          # required — e.g. gemini-1.5-flash or gemini-2.0-flash
```

### 3. Apply schema migration

Adds `enrichmentStatus` column to `CrmIntakeDraftRow`:

```bash
npm run db:push
```

### 4. Run locally

```bash
npm run dev
```

Visit `http://localhost:3000`.

## Deployment (Railway)

1. Create a new Railway project and connect this repo
2. Set the four environment variables in Railway's dashboard
3. Railway will run `npm run build && npm start` automatically

## Tech stack

- **Next.js 15** (App Router, TypeScript)
- **Prisma 5** — client only; schema is the parent app's schema
- **Tailwind CSS**
- **Tavily** — web search API (called via native fetch)
- **Gemini 1.5 Flash** — via `@google/generative-ai`

## Enrichment logic

All pipeline functions are isolated in `src/lib/enrichment/`:

| File | Purpose |
|---|---|
| `buildSearchQuery.ts` | Constructs the Tavily query from row + submission context |
| `runSearch.ts` | POST to Tavily `/search`, returns raw response |
| `buildGeminiPrompt.ts` | Builds structured prompt; instructs Gemini not to invent contact details |
| `callGemini.ts` | Calls Gemini 1.5 Flash, returns raw text |
| `parseGeminiResult.ts` | Parses and validates the JSON response |
| `saveEnrichmentResult.ts` | Writes email, phone, confidence, notes back to the draft row |
| `updateMatchAudit.ts` | Patches `matchAuditJson` incrementally at each stage |
| `pipeline.ts` | Orchestrates all steps for a single row |

## What Gemini is asked to return

- Short biography (2–4 sentences)
- Email — **only if explicitly present in search results**
- Phone — **only if explicitly present in search results**
- Source URLs
- Confidence score (0.0–1.0)
- Notes on ambiguity or alternative candidates

Final data is written to `email`, `phone`, `confidence`, `reviewerNotes`, `enrichmentStatus`, and `matchAuditJson` on the `CrmIntakeDraftRow`.
