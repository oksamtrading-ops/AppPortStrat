import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Platform-level narrative engine (v1 decision): one Anthropic API key for
 * the whole platform, via ANTHROPIC_API_KEY. Engagements opt in individually
 * (Engagement.aiEnabled) — callers enforce that gate before reaching here.
 */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MAX_OUTPUT_TOKENS = 1500;

export async function generateNarrative(
  prompt: { system: string; user: string },
  maxTokens: number = MAX_OUTPUT_TOKENS,
): Promise<string> {
  if (!aiConfigured()) {
    throw new Error("AI is not configured on this platform — set ANTHROPIC_API_KEY");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.APS_AI_MODEL ?? "claude-sonnet-5",
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
