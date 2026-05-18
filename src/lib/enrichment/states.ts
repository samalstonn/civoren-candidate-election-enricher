/**
 * US state-name lookup table and expansion helper.
 * Both adapters use this when building search queries / context lines so
 * "CA" expands to "California" in prompts and queries.
 */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

export function expandState(s: string): string {
  return STATE_NAMES[s.trim().toUpperCase()] ?? s;
}

/** Reverse lookup: "California" → "CA". Case-insensitive. */
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

/**
 * Normalize Gemini's `currentState` output to a valid 2-letter US postal code.
 * Accepts either a postal code ("CA", "ca") or a full state name ("California",
 * "california"). Returns null for anything not in the official 50-states + DC list.
 *
 * Defensive against Gemini ignoring the "two-letter postal code" instruction.
 */
export function normalizeStateCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (STATE_NAMES[upper]) return upper;
  return NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}
