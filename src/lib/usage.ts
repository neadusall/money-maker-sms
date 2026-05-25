import { db } from "@/db/client";
import { usageEvents } from "@/db/schema";

type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// USD per 1M tokens: [input, output]. Update if Anthropic pricing changes.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-4-7": [15, 75],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5-20251001": [1, 5],
};

function priceFor(model: string): [number, number] {
  if (PRICES[model]) return PRICES[model];
  if (model.includes("opus")) return [15, 75];
  if (model.includes("haiku")) return [1, 5];
  return [3, 15]; // sonnet-class default
}

/** Cost in USD for one Anthropic call, accounting for cache read/write rates. */
export function llmCost(model: string, u: AnthropicUsage): number {
  const [inRate, outRate] = priceFor(model);
  const inTok =
    (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (inTok / 1e6) * inRate + ((u.output_tokens ?? 0) / 1e6) * outRate;
}

/** Best-effort: log one LLM call's token usage + cost. Never throws. */
export async function recordLlmUsage(args: {
  model: string;
  usage: AnthropicUsage | undefined | null;
  purpose: string;
  campaignId?: string | null;
}): Promise<void> {
  try {
    const u = args.usage ?? {};
    await db.insert(usageEvents).values({
      kind: "llm",
      model: args.model,
      purpose: args.purpose,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      costUsd: llmCost(args.model, u),
      campaignId: args.campaignId ?? null,
    });
  } catch (e) {
    console.warn("[usage] record failed:", e instanceof Error ? e.message : e);
  }
}
