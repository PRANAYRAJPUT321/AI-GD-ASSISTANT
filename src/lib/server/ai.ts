// The entry points the API routes use. Each call goes to the configured provider:
// Claude (claude.ts) or an OpenAI-compatible chat service such as Gemini or Groq (chat.ts).

import type { Assessment, GDMetrics } from "../scoring";
import type { GDRecord } from "../types";
import { assessGDViaChat, generateLineViaChat } from "./chat";
import { assessGD as assessWithClaude, generateLine as lineFromClaude, normaliseAssessment } from "./claude";
import type { TurnPromptInput } from "./prompts";
import { requireProvider } from "./provider";

/** Throws ConfigError when no AI service is configured (checked at request time, not build time). */
export function assertAiConfigured(): void {
  requireProvider();
}

/** One participant line; null when the model declined or produced nothing speakable. */
export async function generateLine(input: TurnPromptInput, signal?: AbortSignal): Promise<string | null> {
  const provider = requireProvider();
  return provider.id === "claude" ? lineFromClaude(input, signal) : generateLineViaChat(provider, input, signal);
}

/** The structured, normalised assessment; null when none could be produced. */
export async function assessGD(
  record: GDRecord,
  metrics: GDMetrics,
  signal?: AbortSignal,
): Promise<Assessment | null> {
  const provider = requireProvider();
  if (provider.id === "claude") return assessWithClaude(record, metrics, signal);
  const raw = await assessGDViaChat(provider, record, metrics, signal);
  return raw ? normaliseAssessment(raw, metrics) : null;
}
