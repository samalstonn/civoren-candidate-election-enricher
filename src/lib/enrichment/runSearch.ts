import { prisma } from "@/lib/prisma";
import type { TavilySearchResponse } from "@/types/enrichment";

function stripNullBytes(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\x00/g, "");
  if (Array.isArray(value)) return value.map(stripNullBytes);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripNullBytes(v)])
    );
  }
  return value;
}

function getTavilyCost(): number {
  const cost = process.env.TAVILY_COST_PER_CALL;
  if (!cost) throw new Error("TAVILY_COST_PER_CALL is not set");
  return parseFloat(cost);
}

export async function runSearch(
  query: string,
  context?: { rowId?: number; submissionId?: number }
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

  const costPerCall = getTavilyCost();
  const searchDepth = "advanced";
  const startedAt = Date.now();
  let status = "success";
  let error: string | null = null;
  let resultCount: number | null = null;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 20,
        include_answer: false,
        search_depth: searchDepth,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tavily search failed: ${response.status} ${text}`);
    }

    const data = stripNullBytes(await response.json()) as TavilySearchResponse;
    resultCount = data.results?.length ?? 0;
    return data;
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latencyMs = Date.now() - startedAt;

    await prisma.apiCallLog.create({
      data: {
        apiType: "tavily",
        rowId: context?.rowId ?? null,
        submissionId: context?.submissionId ?? null,
        latencyMs,
        status,
        error,
        query,
        resultCount,
        searchDepth,
        costUsd: costPerCall,
      },
    }).catch(() => {});
  }
}
