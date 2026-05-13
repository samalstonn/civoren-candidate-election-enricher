import type { TavilyResult } from "@/types/enrichment";

const THIN_CONTENT_THRESHOLD = 400;
const MAX_FETCHED_CHARS = 4000;

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

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; candidate-enricher/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    if (text.length < 60) return null;
    return text.length > MAX_FETCHED_CHARS ? text.slice(0, MAX_FETCHED_CHARS) + "…" : text;
  } catch {
    return null;
  }
}

export async function enrichThinSources(
  sources: TavilyResult[]
): Promise<TavilyResult[]> {
  return Promise.all(
    sources.map(async (source) => {
      if (source.content.length >= THIN_CONTENT_THRESHOLD) return source;
      const fetched = await fetchPageText(source.url);
      if (!fetched || fetched.length <= source.content.length) return source;
      return { ...source, content: `[Direct fetch] ${fetched}` };
    })
  );
}
