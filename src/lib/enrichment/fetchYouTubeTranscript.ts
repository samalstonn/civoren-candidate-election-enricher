import { YoutubeTranscript } from "youtube-transcript";
import type { TavilyResult } from "@/types/enrichment";

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be"];
const MAX_TRANSCRIPT_CHARS = 3000;

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return YOUTUBE_HOSTS.includes(host);
  } catch {
    return false;
  }
}

async function getTranscript(url: string): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(url);
    const full = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    return full.length > MAX_TRANSCRIPT_CHARS
      ? full.slice(0, MAX_TRANSCRIPT_CHARS) + "…"
      : full;
  } catch {
    return null;
  }
}

export async function enrichWithTranscripts(
  sources: TavilyResult[]
): Promise<TavilyResult[]> {
  const enriched = await Promise.all(
    sources.map(async (source) => {
      if (!isYouTubeUrl(source.url)) return source;
      const transcript = await getTranscript(source.url);
      if (transcript) {
        return { ...source, content: `[YouTube transcript] ${transcript}` };
      }
      return null;
    })
  );
  return enriched.filter((s): s is TavilyResult => s !== null);
}
