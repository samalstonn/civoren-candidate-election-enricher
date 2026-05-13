import type { TavilyResult } from "@/types/enrichment";

const MAX_CONTENT_CHARS = 3000;

function nameInHost(url: string, firstName: string, lastName: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return (
      (lastName.length > 2 && host.includes(lastName)) ||
      (firstName.length > 2 && host.includes(firstName))
    );
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/\x00/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchContactPageContent(origin: string): Promise<string | null> {
  const contactUrl = `${origin}/contact`;
  try {
    const res = await fetch(contactUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; candidate-enricher/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    if (text.length < 60) return null;
    return text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) + "…" : text;
  } catch {
    return null;
  }
}

export async function injectContactPages(
  sources: TavilyResult[],
  row: { firstName?: string | null; lastName?: string | null }
): Promise<TavilyResult[]> {
  const firstName = (row.firstName ?? "").toLowerCase().replace(/\s+/g, "");
  const lastName = (row.lastName ?? "").toLowerCase().replace(/\s+/g, "");

  const existingUrls = new Set(sources.map((s) => s.url.replace(/\/$/, "")));

  const injected = await Promise.all(
    sources.map(async (source) => {
      if (!nameInHost(source.url, firstName, lastName)) return null;

      let origin: string;
      try {
        origin = new URL(source.url).origin;
      } catch {
        return null;
      }

      const contactUrl = `${origin}/contact`;
      if (existingUrls.has(contactUrl) || existingUrls.has(contactUrl + "/")) return null;

      const content = await fetchContactPageContent(origin);
      if (!content) return null;

      const result: TavilyResult = {
        title: `${new URL(origin).hostname} — Contact`,
        url: contactUrl,
        content: `[Contact page] ${content}`,
        sourceQuery: source.sourceQuery,
      };
      return result;
    })
  );

  const newSources = injected.filter((s): s is TavilyResult => s !== null);
  return [...newSources, ...sources];
}
