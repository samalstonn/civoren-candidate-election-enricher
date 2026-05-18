import { parseGeneralResult, parseContactResult } from "../parseGeminiResult";

// Parsers are typed at their definition; the registry erases types because
// downstream consumers (UI, pipeline) work with `Record<string, unknown>` and
// each adapter's `save` casts to its expected interface.
const generalParser = parseGeneralResult as unknown as (rawText: string) => Record<string, unknown>;
const contactParser = parseContactResult as unknown as (rawText: string) => Record<string, unknown>;

/**
 * Track manifest for the `candidate` entity kind.
 * Add a new track by appending an entry here. Order = render order in the UI.
 */
export const CANDIDATE_TRACKS = [
  {
    id: "general",
    label: "General",
    accent: "gray",
    parseResult: generalParser,
    instructions: [
      "Write a biography of approximately 600 characters summarizing who this candidate is based on the search results. Cover their background, policy positions if known, and why they are running. The biography is public-facing — do NOT reference, cite, or mention any sources, URLs, or websites. Write in third person as if it were an editorial profile.",
      'Extract their current professional role or occupation (e.g. "Attorney", "Small business owner", "Retired teacher"). This should be their professional identity, NOT the election they are running in. If sources indicate they currently hold this office (i.e. they are an incumbent), use "Incumbent [position title]". If no professional role is found at all, use "Candidate for [position title]".',
      "Extract the city where they currently live or work. Null if not found.",
      'Extract the US state where they currently live or work, as a two-letter postal code (e.g. "CA", "TX"). Null if not found.',
      'Extract the political party they are running under for the position above. Use the canonical party name when possible (e.g. "Democratic", "Republican", "Independent", "Libertarian", "Green"). Null if not found.',
      "List the URLs from search results that were most relevant.",
      "Rate your confidence from 0.0 to 1.0 that this is the correct candidate (not a different person with the same name).",
      "Add brief notes about ambiguity, alternative candidates found, or anything unusual.",
    ],
    jsonSchema: `{
  "biography": "string or null",
  "currentRole": "string or null",
  "currentCity": "string or null",
  "currentState": "string or null",
  "party": "string or null",
  "sourceUrls": ["url1", "url2"],
  "confidence": 0.0,
  "notes": "string or null"
}`,
  },
  {
    id: "contact",
    label: "Contact",
    accent: "blue",
    parseResult: contactParser,
    injectContactPages: true,
    instructions: [
      "Extract an email address ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer email addresses. Prefer the candidate's personal/campaign contact over a generic office address when both appear.",
      "Extract a phone number ONLY if one is explicitly present in the search results. Do NOT invent, guess, or infer phone numbers.",
      'Extract a LinkedIn profile URL if one is present. Must be a full URL starting with "https://www.linkedin.com/in/" or similar; null otherwise.',
      "Extract a campaign or personal website URL if one is present (not a news article or social profile). Null if not found.",
      "List the URLs from search results where you found contact information.",
      "Rate your confidence from 0.0 to 1.0 that this is the correct candidate (not a different person with the same name).",
      "Add brief notes about ambiguity or anything unusual.",
    ],
    jsonSchema: `{
  "email": "string or null",
  "phone": "string or null",
  "linkedin": "string or null",
  "website": "string or null",
  "sourceUrls": ["url1", "url2"],
  "confidence": 0.0,
  "notes": "string or null"
}`,
  },
] as const;
