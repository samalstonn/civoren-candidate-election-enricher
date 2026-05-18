# Split Enrichment Pipeline & Track Registry

The pipeline runs one independent `search → gemini → save` state machine per **track**. Tracks are defined in a registry — adding a new one is mostly a single-file change. Different entity kinds (today: `candidate`; future: `election`, etc.) define their own track sets.

This doc covers the moving parts that aren't obvious from one file in isolation. For the step-by-step recipe to add a new entity kind, see `docs/adding-a-new-enrichment-entity.md`.

## Why splits

The contact data (email/phone/linkedin/website) lives in different sources than the biographical data (bio/role/city/state/party). Co-mingling them in one Gemini call throws away signal — a single prompt that has to extract everything reads the merged source list less carefully than two prompts each focused on their own evidence. Splitting also lets a user re-run just the contact half when an email is wrong, without re-running the (more expensive, slower) general half.

Generalizing this from two tracks to **N registered tracks per entity kind** means future entity types (e.g. elections) can declare their own track decomposition without changing the pipeline.

## Registry

The two-file registry under `src/lib/enrichment/registry/`:

- `registry/index.ts` — the `ENTITIES` manifest, plus the type plumbing (`EntityKind`, `TrackIdFor<K>`, `AnyTrackId`) and helpers (`getEntity`, `getTrack`, `trackIds`, `allTrackIds`).
- `registry/candidate.ts` — `CANDIDATE_TRACKS`: an `as const` array of track definitions for the candidate entity kind.

Each `TrackDefinition` carries:

| Field | Purpose |
|---|---|
| `id` | Stable identifier (e.g. `"general"`, `"contact"`). Used in `PipelineMode` strings, audit blob keys, UI iteration. |
| `label` | Human-readable; rendered in pipeline strips, button rows, and prompts. |
| `accent` | UI hint — `gray`, `blue`, `amber`, `green`, `purple`. Picks the button/pill color. |
| `parseResult(rawText)` | Parses Gemini's JSON response into a typed result. Lives next to the prompt instructions so they stay consistent. |
| `instructions: string[]` | The bullet list rendered into the Gemini prompt's INSTRUCTIONS block. |
| `jsonSchema: string` | The JSON schema literal appended after "Respond with ONLY valid JSON in this exact format:". |
| `injectContactPages?: boolean` | Pipeline hint — true for tracks that benefit from scraping contact/about pages during the search stage. |

## Adding a new track

For candidates, e.g. an `endorsements` track:

1. Add a parser to `src/lib/enrichment/parseGeminiResult.ts` returning your typed shape.
2. Append a new entry to `CANDIDATE_TRACKS` in `registry/candidate.ts` with `id: "endorsements"`, the parser, instructions, and json schema.
3. Add an entry to each candidate adapter's `tracks` map with `buildSearchQuery`, `buildGeminiPrompt` (calling `buildPrompt(...)` from the shared scaffold), and `save`. TypeScript's exhaustive `Record<TrackIdFor<"candidate">, AdapterTrack>` will reject the adapter until you do.

That's it. The pipeline picks up the new track automatically. `PipelineModeFor<"candidate">` auto-expands. `/candidates/[id]` renders the new pipeline strip, action-button column, and artifacts column from the registry. No DB migration (the audit type is a mapped intersection over `AnyTrackId`).

## Shared prompt scaffold

All Gemini prompts are assembled by `buildPrompt(...)` in `src/lib/enrichment/prompt.ts`:

```ts
buildPrompt({
  entityKind,        // "political candidate"
  context,           // entity-specific multi-line context (adapter assembles)
  sources,           // raw TavilyResult[]; helper filters + truncates
  nameParts,
  instructions,      // from registry's TrackDefinition
  jsonSchema,        // from registry's TrackDefinition
  contextHeader?,    // override of section header (defaults to entityKind.toUpperCase())
});
```

Tweaks to the intro line, section headers, source filter, or the JSON-only footer happen here exclusively. Per-track variation comes from the registry; per-adapter variation comes from the adapter's `context` string.

## Field ownership (candidate)

| Field | Track | Persisted to |
|---|---|---|
| `biography` → `Candidate.bio` | general | `Candidate` |
| `currentRole` | general | `Candidate` |
| `currentCity` | general | `Candidate` |
| `currentState` | general | `Candidate` (normalized via `normalizeStateCode`; rejects non-US codes) |
| `party` | general | `ElectionLink.party` (most-recent non-archived link) |
| `email` | contact | `Candidate` (skipped if existing value present) |
| `phone` | contact | `Candidate` (skipped if existing; min 10 digits) |
| `linkedin` | contact | `Candidate` (URL format check) |
| `website` | contact | `Candidate` (URL format check) |

If a candidate has no current `ElectionLink`, the general save logs `partySkipped: "no current election link"` instead of failing.

## Audit blob shape

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
  parsedResult?,
  finalSavedFields?,
};
```

The mapped type means **adding a new track in the registry automatically expands the audit type**. Existing rows are unaffected; absent track keys default to `not_started` at read time.

The original migration from the legacy flat shape to track-split was run once via `scripts/migrate-audit-schema.ts`. The shim has been removed; reads parse JSON directly.

## Concurrent writes

`runEnrichmentPipeline` runs tracks via `Promise.allSettled` so failures are isolated. Two tracks both writing to the same audit row used to lose updates (read-modify-write races in JS). It's now safe because every per-track / per-error write uses `src/lib/enrichment/atomicAudit.ts` — `setTrackAtomic` and `appendErrorAtomic` issue one Postgres `jsonb_set` + `||` statement per call, so two concurrent calls writing different paths never collide.

## Status field on `EnrichmentRecord` / `CrmIntakeDraftRow`

The single `enrichmentStatus` mirror column is **derived** by `deriveOverallStatus`:

- `failed` if any present track failed.
- `needs_review` if any is in review.
- `result_saved` only when every present track has saved.
- Otherwise the least-advanced status among present tracks.

It's recomputed after every atomic patch (a second SQL statement; eventual consistency, converges within one write).

## Modes

`PipelineModeFor<K>` is a template literal derived from the registry:

```ts
export type PipelineModeFor<K extends EntityKind> =
  | "full"
  | `${TrackIdFor<K>}_full`
  | `${TrackIdFor<K>}_search`
  | `${TrackIdFor<K>}_gemini`
  | `${TrackIdFor<K>}_save`;
```

For candidates today: `"full"`, `"general_full"`, `"contact_full"`, `"{general,contact}_{search,gemini,save}"`. Adding a track to the registry auto-expands this union.

Legacy modes (`"search"`, `"search_general"`, `"search_contact"`, `"gemini"`, `"save"`) are still accepted — `normalizePipelineMode(adapter, raw)` in `pipeline.ts` validates them against the adapter's kind and fans them out (e.g. `"search"` → `[..._search]` for every track).

## Adapter contract

`EntityAdapter<K extends EntityKind>` in `src/types/enrichment.ts`:

- `entityKind: K` — which kind this adapter handles. Constrains the rest of the interface.
- `tracks: Record<TrackIdFor<K>, AdapterTrack>` — exhaustive per-track logic map. Each `AdapterTrack` exposes `buildSearchQuery`, `buildGeminiPrompt(sources)`, `save(parsed, audit)`.
- `getAudit / updateAudit / updateTrack / appendError` — audit persistence (live-candidate goes through `enrichmentRecord.ts`; intake stores audit inline on its draft row).

Implementations:
- `LiveCandidateAdapter` (entityKind: `"candidate"`).
- `CandidateIntakeAdapter` (entityKind: `"candidate"`).

## UI

`/candidates/[id]` and `/rows/[id]` both iterate the registry — pipeline strips, action-button columns, and the artifacts grid are all rendered by `CANDIDATE_TRACKS.map(...)`. No UI changes needed when a new track is added.

The artifacts section also shows a **search-query preview** (computed server-side by calling each adapter track's `buildSearchQuery()`) even before any pipeline run, so reviewers can sanity-check the query that would be sent to Tavily. The persisted value overrides the preview once the pipeline writes its own.

## Failure isolation

`Promise.allSettled` per `"full"` run. A failure in one track flips only that track's status to `failed`; the other continues. The outer `try/catch` in `runTrack` calls `adapter.appendError` so failures land in the user-visible Errors section with the offending track pill.
