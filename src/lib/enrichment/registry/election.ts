import { parseOverviewResult } from "../parseGeminiResult";

const overviewParser = parseOverviewResult as unknown as (
  rawText: string
) => Record<string, unknown>;

/**
 * Track manifest for the `election` entity kind.
 * One combined "overview" track populates description, date, and filing authority.
 */
export const ELECTION_TRACKS = [
  {
    id: "overview",
    label: "Overview",
    accent: "amber",
    parseResult: overviewParser,
    instructions: [
      "Write a description of approximately 600 characters explaining what this election is, what the office does, the jurisdiction it covers, and any relevant context (term length, when the seat was last contested, partisan history if known). **Include the approximate population this seat governs** (e.g. \"represents approximately 250,000 residents\" or \"serves a district of about 45,000 voters\") — round to two significant figures and use the most recent census or official figure you can identify in the sources. The description is public-facing — do NOT reference, cite, or mention any sources, URLs, or websites. Write in third person as if it were an editorial summary.",
      'Classify this election as exactly one of: "primary", "general", "special", or "runoff". Use the CONTEXT block above for the state\'s standard 2026 primary and general dates — do NOT output a date for primary or general (the system fills those in from the dictionary). For "special" and "runoff", you MUST also infer the election date as YYYY-MM-DD from the search results. If you cannot confidently classify, return null.',
      'For classification = "special" or "runoff", extract the election date as YYYY-MM-DD inferred from the search results. For "primary" or "general", leave this null — the system supplies the date from the static 2026 dictionary keyed by the state.',
      "Extract the number of seats up for election in this race as an integer >= 1 (e.g. 1 for a single-seat office, 3 for an at-large council race electing three members at once). Null if not determinable from the sources.",
      "Extract the name of the agency that administers this election (e.g. \"Los Angeles County Registrar-Recorder/County Clerk\", \"California Secretary of State\"). Null if not found.",
      "Extract the filing authority level. MUST be one of exactly: STATE, COUNTY, MUNICIPAL, DISTRICT, COURT, SPECIAL_DISTRICT, REFERRED_CONTACT, UNKNOWN. Null if not determinable.",
      "Extract the filing authority type. MUST be one of exactly: STATE_ELECTIONS, COUNTY_CLERK, CITY_CLERK, DISTRICT_OFFICE, COURT_OFFICE, SPECIAL_DISTRICT_OFFICE, REFERRED_CONTACT, OTHER. Null if not determinable.",
      "List the URLs from search results that were most relevant.",
      "Rate your confidence from 0.0 to 1.0 that this is the correct election (not a different race with a similar position title).",
      "Add brief notes about ambiguity, alternative interpretations, or anything unusual.",
    ],
    jsonSchema: `{
  "description": "string or null",
  "electionClassification": "primary | general | special | runoff (or null if you cannot determine)",
  "date": "YYYY-MM-DD (REQUIRED for special/runoff; null for primary/general)",
  "positions": "integer >= 1 or null",
  "filingAuthorityName": "string or null",
  "filingAuthorityLevel": "STATE|COUNTY|MUNICIPAL|DISTRICT|COURT|SPECIAL_DISTRICT|REFERRED_CONTACT|UNKNOWN or null",
  "filingAuthorityType": "STATE_ELECTIONS|COUNTY_CLERK|CITY_CLERK|DISTRICT_OFFICE|COURT_OFFICE|SPECIAL_DISTRICT_OFFICE|REFERRED_CONTACT|OTHER or null",
  "sourceUrls": ["url1", "url2"],
  "confidence": 0.0,
  "notes": "string or null"
}`,
  },
] as const;
