import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

function getCostConfig() {
  const inputCost = process.env.GEMINI_INPUT_COST_PER_1M_TOKENS;
  const outputCost = process.env.GEMINI_OUTPUT_COST_PER_1M_TOKENS;
  if (!inputCost) throw new Error("GEMINI_INPUT_COST_PER_1M_TOKENS is not set");
  if (!outputCost) throw new Error("GEMINI_OUTPUT_COST_PER_1M_TOKENS is not set");
  return { inputCost: parseFloat(inputCost), outputCost: parseFloat(outputCost) };
}

export interface GeminiResult {
  text: string;
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export async function callGemini(
  prompt: string,
  context?: { rowId?: number; submissionId?: number }
): Promise<GeminiResult> {
  const genAI = getClient();
  const geminiModel = process.env.GEMINI_MODEL;
  if (!geminiModel) throw new Error("GEMINI_MODEL is not set");
  const { inputCost, outputCost } = getCostConfig();

  const model = genAI.getGenerativeModel({ model: geminiModel });
  const startedAt = Date.now();
  let text = "";
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  let totalTokens: number | null = null;
  let status = "success";
  let error: string | null = null;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    text = response.text();
    promptTokens = response.usageMetadata?.promptTokenCount ?? null;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? null;
    totalTokens = response.usageMetadata?.totalTokenCount ?? null;
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const latencyMs = Date.now() - startedAt;
    const costUsd =
      promptTokens != null && outputTokens != null
        ? (promptTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost
        : null;

    await prisma.apiCallLog.create({
      data: {
        apiType: "gemini",
        rowId: context?.rowId ?? null,
        submissionId: context?.submissionId ?? null,
        latencyMs,
        status,
        error,
        model: geminiModel,
        promptTokens,
        outputTokens,
        totalTokens,
        costUsd,
      },
    }).catch(() => {});
  }

  return { text, promptTokens, outputTokens, totalTokens };
}
