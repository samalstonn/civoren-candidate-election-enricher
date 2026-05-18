import { CANDIDATE_TRACKS } from "./candidate";

export interface TrackDefinition {
  id: string;
  label: string;
  /** UI accent color hint. */
  accent: "gray" | "blue" | "amber" | "green" | "purple";
  /** Parses Gemini's raw JSON response into a typed object. */
  parseResult: (rawText: string) => Record<string, unknown>;
  /** Default extraction instructions shown to Gemini. */
  instructions: readonly string[];
  /** JSON output schema literal appended to the prompt. */
  jsonSchema: string;
  /** Pipeline-stage hint: inject candidate contact pages into search results. */
  injectContactPages?: boolean;
}

export interface EntityKindDefinition {
  id: string;
  /** Human-readable label used in prompts and UI. */
  label: string;
  /** Ordered list of tracks for this entity kind. UI renders in this order. */
  tracks: readonly TrackDefinition[];
}

/**
 * The single registry of every enrichable entity kind and its tracks.
 * Add a new entity kind by adding a key here pointing at its track manifest.
 */
export const ENTITIES = {
  candidate: {
    id: "candidate",
    label: "political candidate",
    tracks: CANDIDATE_TRACKS,
  },
  // Future:
  // election: { id: "election", label: "election", tracks: ELECTION_TRACKS },
} as const satisfies Record<string, EntityKindDefinition>;

export type EntityKind = keyof typeof ENTITIES;

/** Union of track ids for a specific entity kind. */
export type TrackIdFor<K extends EntityKind> =
  (typeof ENTITIES)[K]["tracks"][number]["id"];

/** Union of every track id across every entity kind. */
export type AnyTrackId = { [K in EntityKind]: TrackIdFor<K> }[EntityKind];

export function getEntity<K extends EntityKind>(kind: K): EntityKindDefinition {
  return ENTITIES[kind] as unknown as EntityKindDefinition;
}

export function getTrack<K extends EntityKind>(
  kind: K,
  trackId: TrackIdFor<K>
): TrackDefinition {
  const entity = ENTITIES[kind];
  const t = entity.tracks.find((tr) => tr.id === trackId);
  if (!t) throw new Error(`Unknown track ${String(trackId)} for entity ${String(kind)}`);
  return t as unknown as TrackDefinition;
}

export function trackIds<K extends EntityKind>(kind: K): TrackIdFor<K>[] {
  return ENTITIES[kind].tracks.map((t) => t.id) as TrackIdFor<K>[];
}

/** Every track id across every entity kind. Useful for status rollups. */
export function allTrackIds(): AnyTrackId[] {
  return Object.values(ENTITIES).flatMap((e) =>
    e.tracks.map((t) => t.id as AnyTrackId)
  );
}
