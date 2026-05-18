import type { TavilyResult } from "@/types/enrichment";

export interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
  fullNameRaw?: string | null;
}

const MIN_USEFUL_CONTENT_LENGTH = 60;
const MAX_SOURCE_CONTENT_LENGTH = 4000;

/**
 * Drop sources whose content is too short OR whose title/content don't mention
 * the entity name (last name, first name, or first-name prefix). Falls back to
 * the thick-content set if no source mentions the name (better to send Gemini
 * possibly-irrelevant context than nothing).
 */
export function filterRelevantSources(
  sources: TavilyResult[],
  nameParts: NameParts
): TavilyResult[] {
  const firstName = (nameParts.firstName ?? "").toLowerCase();
  const lastName = (nameParts.lastName ?? "").toLowerCase();
  const firstNamePrefix = firstName.slice(0, 4);

  function mentionsEntity(s: { title: string; content: string }): boolean {
    const hay = (s.title + " " + s.content).toLowerCase();
    const lastNameMatch = !lastName || hay.includes(lastName);
    const firstNameMatch =
      !firstName ||
      hay.includes(firstName) ||
      (firstNamePrefix.length >= 3 && hay.includes(firstNamePrefix));
    return lastNameMatch && firstNameMatch;
  }

  const thickSources = sources.filter(
    (s) => s.content && s.content.trim().length >= MIN_USEFUL_CONTENT_LENGTH
  );
  const relevantSources = thickSources.filter(mentionsEntity);
  return relevantSources.length > 0 ? relevantSources : thickSources;
}

export function formatSources(sources: TavilyResult[]): string {
  return sources
    .map((s) => {
      const content =
        s.content.length > MAX_SOURCE_CONTENT_LENGTH
          ? s.content.slice(0, MAX_SOURCE_CONTENT_LENGTH) + "…"
          : s.content;
      let domain = s.url;
      try {
        domain = new URL(s.url).hostname.replace(/^www\./, "");
      } catch {
        // keep url as-is
      }
      return `[${domain}] ${s.title}\nURL: ${s.url}\n${content}`;
    })
    .join("\n\n---\n\n");
}

export interface BuildPromptArgs {
  /** Human-readable entity description used in the prompt intro.
   *  e.g. "political candidate", "election". */
  entityKind: string;
  /** Entity-specific context block, multi-line. Adapter assembles this. */
  context: string;
  sources: TavilyResult[];
  nameParts: NameParts;
  /** Instructions to render as a bullet list. Typically the track's defaults,
   *  optionally with adapter-specific lines appended. */
  instructions: string[];
  /** JSON schema literal shown to Gemini. Comes from the track manifest. */
  jsonSchema: string;
  /** Override the default uppercase-entityKind section header. */
  contextHeader?: string;
}

/**
 * The single, shared Gemini prompt scaffold. All adapters/tracks compose
 * against this. Tweaking phrasing of intro, section headers, or the JSON-only
 * footer happens here exclusively.
 */
export function buildPrompt(a: BuildPromptArgs): string {
  const useful = filterRelevantSources(a.sources, a.nameParts);
  const sourcesText = formatSources(useful);
  const instructionsBlock = a.instructions.map((line) => `- ${line}`).join("\n");
  const header = a.contextHeader ?? a.entityKind.toUpperCase();

  return `You are a ${a.entityKind} research assistant. Based ONLY on the search results provided below, extract information about this ${a.entityKind}.

${header}:
${a.context}

SEARCH RESULTS:
${sourcesText || "No search results available."}

INSTRUCTIONS:
${instructionsBlock}

Respond with ONLY valid JSON in this exact format:
${a.jsonSchema}`;
}
