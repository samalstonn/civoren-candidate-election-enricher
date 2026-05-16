# Split Enrichment Pipeline (general + contact)

The enrichment pipeline runs two independent tracks per entity — `general` and `contact` — each with its own `search → gemini → save` state machine. The tracks run in parallel under `"full"` mode and can also be invoked individually. This doc covers the moving parts that aren't obvious from reading one file in isolation.

## Why split

The contact data (email/phone/linkedin/website) lives in different sources than the biographical data (bio/role/city/state/party). Co-mingling them in one Gemini call was throwing away signal — a single prompt that has to extract everything reads the merged source list less carefully than two prompts each focused on their own evidence. Splitting also lets the user re-run just the contact half when an email is wrong, without re-running the (more expensive, slower) general half.

## Field ownership

| Field | Track | Persisted to |
|---|---|---|
| `biography` → `Candidate.bio` | general | `Candidate` |
| `currentRole` | general | `Candidate` |
| `currentCity` | general | `Candidate` |
| `currentState` | general | `Candidate` |
| `party` | general | `ElectionLink.party` (most-recent non-archived link) |
| `email` | contact | `Candidate` (skipped if existing value present) |
| `phone` | contact | `Candidate` (skipped if existing; min 10 digits) |
| `linkedin` | contact | `Candidate` (URL format check) |
| `website` | contact | `Candidate` (URL format check) |

If a candidate has no current `ElectionLink`, the general save logs `partySkipped: "no current election link"` instead of failing.

## Audit blob shape

```ts
{
  runId, startedAt, completedAt?,
  general: TrackAudit,
  contact: TrackAudit,
  errors?: { message, timestamp, track? }[]
}
```

Each `TrackAudit` carries that track's `status`, `searchQuery`, `searchRawResponse`, `rankedSources`, `selectedSources`, `geminiPrompt`, `geminiRawResponse`, `parsedResult`, and `finalSavedFields`.

All legacy flat-shape audits (the pre-split single-track blob with top-level `searchQuery`, `contactSearchQuery`, `selectedSources`, `parsedResult`, etc.) were migrated to the new shape in one shot by `scripts/migrate-audit-schema.ts` (run via `npm run migrate:audit`). Reads now parse the JSON directly with no projection shim. The script is idempotent — re-running it skips already-new rows.

## Status field on `EnrichmentRecord` / `CrmIntakeDraftRow`

The single `enrichmentStatus` column stays a single string, but it's now **derived** from the two track statuses by `deriveOverallStatus`:

- `failed` if either track failed
- `needs_review` if either is in review
- `result_saved` only when both saved
- otherwise the less-advanced of the two

This is what the `/candidates` list table and the chip filters key on.

## Modes (`PipelineMode`)

```
"full"
"general_full"   "contact_full"
"general_search" "contact_search"
"general_gemini" "contact_gemini"
"general_save"   "contact_save"
```

Legacy modes (`"search"`, `"search_general"`, `"search_contact"`, `"gemini"`, `"save"`, `"full"`) are normalized by `normalizePipelineMode` (also in `pipeline.ts`) — `"search"` becomes `["general_search", "contact_search"]`, `"gemini"` becomes both `_gemini` modes, etc. Both API routes (`/api/candidates/[id]/enrich` and `/api/rows/[id]/enrich`) accept either old or new mode strings.

## Adapter contract

`EntityAdapter` (in `src/types/enrichment.ts`):

- `buildSearchQuery(track)` — one method, branches internally.
- `buildGeminiPrompt(track, sources)` — track-specific prompt; `parseGeneralResult` vs `parseContactResult` consumes the response.
- `saveTrackResult(track, parsed, audit)` — writes that track's fields and stamps `track.status = "result_saved"`.
- `updateTrack(track, patch)` — deep-merge a partial `TrackAudit` into one track.
- `updateAudit(patch)` — top-level fields only (`runId`, `startedAt`, `completedAt`, `errors`).
- `appendError({ message, timestamp, track? })` — read-merge-write append onto `audit.errors[]`. The pipeline calls this from a single outer `try/catch` around each `runTrack` so any failure (network, Gemini, parse, save) lands in the user-visible Errors section under `/candidates/[id]` with a track pill.

Implementations: `LiveCandidateAdapter`, `CandidateIntakeAdapter`. The intake adapter saves bio/role/city to its draft row's existing columns and ignores party/linkedin/website (no columns).

## UI

`/candidates/[id]` shows two pipeline strips, two columns of buttons (Run Search / Run Gemini / Save / Run All for each track), and a two-column artifacts grid. `/rows/[id]` (intake) still uses the single-pipeline layout but reads from the new audit shape (general track is shown primarily; contact artifacts surface in their own labeled sections).

## Failure isolation

`runEnrichmentPipeline` uses `Promise.allSettled([general, contact])` for `"full"`. A failure in one track flips only that track's status to `failed`; the other continues. The route surfaces the first rejection so the HTTP response reports an error, but the partial progress (e.g. contact saved, general failed) is preserved in the audit blob and visible in the UI.
