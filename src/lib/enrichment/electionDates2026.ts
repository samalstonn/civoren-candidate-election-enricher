/**
 * 2026 U.S. election dates. Source: NCSL 2026 state primary dates page.
 * Gemini classifies primary/general/special/runoff; the adapter resolves the
 * final date from this dict (primary, general) or Gemini's inferred date
 * (special, runoff).
 */
import { normalizeStateCode } from "./states";
export const GENERAL_DATE_2026 = "2026-11-03";

export const PRIMARY_DATES_2026: Record<string, string> = {
  AL: "2026-05-19", AK: "2026-08-18", AZ: "2026-07-21", AR: "2026-03-03", CA: "2026-06-02",
  CO: "2026-06-30", CT: "2026-08-11", DE: "2026-09-15", FL: "2026-08-18", GA: "2026-05-19",
  HI: "2026-08-08", ID: "2026-05-19", IL: "2026-03-17", IN: "2026-05-05", IA: "2026-06-02",
  KS: "2026-08-04", KY: "2026-05-19", LA: "2026-05-16", ME: "2026-06-09", MD: "2026-06-23",
  MA: "2026-09-01", MI: "2026-08-04", MN: "2026-08-11", MS: "2026-03-10", MO: "2026-08-04",
  MT: "2026-06-02", NE: "2026-05-12", NV: "2026-06-09", NH: "2026-09-08", NJ: "2026-06-02",
  NM: "2026-06-02", NY: "2026-06-23", NC: "2026-03-03", ND: "2026-06-09", OH: "2026-05-05",
  OK: "2026-06-16", OR: "2026-05-19", PA: "2026-05-19", RI: "2026-09-09", SC: "2026-06-09",
  SD: "2026-06-02", TN: "2026-08-06", TX: "2026-03-03", UT: "2026-06-23", VT: "2026-08-11",
  VA: "2026-08-04", WA: "2026-08-04", WV: "2026-05-12", WI: "2026-08-11", WY: "2026-08-18",
};

export const RUNOFF_DATES_2026: Record<string, string> = {
  AR: "2026-03-31", GA: "2026-06-16", LA: "2026-06-27", MS: "2026-04-07", NC: "2026-05-12",
  OK: "2026-08-25", SC: "2026-06-23", SD: "2026-07-28", TX: "2026-05-26",
};

export type ElectionClassification = "primary" | "general" | "special" | "runoff";

/** Multi-line prompt block listing the standard 2026 dates relevant to one state. */
export function formatDatesForPrompt(stateInput: string): string {
  const code = normalizeStateCode(stateInput) ?? stateInput.trim().toUpperCase();
  const primary = PRIMARY_DATES_2026[code];
  const runoff = RUNOFF_DATES_2026[code];
  return [
    `Standard 2026 General election date (all states): ${GENERAL_DATE_2026}`,
    primary && `Standard 2026 ${code} Primary date: ${primary}`,
    runoff && `Standard 2026 ${code} Primary runoff date (if applicable): ${runoff}`,
  ].filter(Boolean).join("\n");
}

/**
 * primary → PRIMARY_DATES_2026[state], general → GENERAL_DATE_2026,
 * special/runoff → inferredDate. Null when no resolution is possible.
 */
export function resolveElectionDate(
  classification: ElectionClassification | null | undefined,
  stateInput: string,
  inferredDate: string | null | undefined
): string | null {
  if (!classification) return null;
  if (classification === "general") return GENERAL_DATE_2026;
  if (classification === "primary") {
    const code = normalizeStateCode(stateInput);
    return code ? PRIMARY_DATES_2026[code] ?? null : null;
  }
  return inferredDate ?? null;
}
