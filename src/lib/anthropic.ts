import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  // Generous retries so bulk scoring rides through 429 rate-limit bursts
  // (the SDK backs off and respects retry-after headers).
  cached = new Anthropic({ maxRetries: 8 });
  return cached;
}

export const CLAUDE_MODEL = "claude-opus-4-7";
