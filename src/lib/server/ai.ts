// The entry points the API routes use. Each call goes to the configured provider (Claude in
// claude.ts, or an OpenAI-compatible chat service such as Gemini or Groq in chat.ts). When no
// provider is configured, or the call fails for an AI-side reason (no credits, a rejected key,
// a rate limit, a timeout), the GD carries on in practice mode with built-in lines and a
// metrics-only scorecard (offline.ts) instead of failing. Responses say which one they are.

import Anthropic from "@anthropic-ai/sdk";
import type { Assessment, GDMetrics } from "../scoring";
import type { GDRecord } from "../types";
import { assessGDViaChat, ChatHttpError, ChatTimeoutError, generateLineViaChat } from "./chat";
import { assessGD as assessWithClaude, generateLine as lineFromClaude, normaliseAssessment } from "./claude";
import { ConfigError, upstreamMessage } from "./http";
import { offlineAssessment, offlineLine } from "./offline";
import type { TurnPromptInput } from "./prompts";
import { findProvider, type Provider } from "./provider";

/** After an AI failure that won't fix itself, skip the AI for this long (per server instance). */
const UNAVAILABLE_COOL_DOWN_MS = 10 * 60 * 1000;
let unavailableUntil = 0;

/** Test hook: forget an earlier "AI unavailable" verdict. */
export function resetAiAvailability(): void {
  unavailableUntil = 0;
}

type Failure = "abort" | "unavailable" | "transient";

/**
 * How an error from an AI call should be handled: "abort" (the browser went away), "unavailable"
 * (won't fix itself: no or bad key, no credits, a request the service rejects), "transient"
 * (rate limit, overload, timeout, network), or null when it isn't an AI error at all.
 */
function classify(err: unknown, clientSignal?: AbortSignal): Failure | null {
  if (err instanceof ConfigError) return "unavailable";
  if (err instanceof Anthropic.APIUserAbortError) return clientSignal?.aborted ? "abort" : "transient";
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 0 || status === 408 || status === 409 || status === 429 || status >= 500) return "transient";
    return "unavailable";
  }
  if (err instanceof ChatHttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500 ? "transient" : "unavailable";
  }
  if (err instanceof ChatTimeoutError) return "transient";
  if (err instanceof DOMException && err.name === "AbortError") return clientSignal?.aborted ? "abort" : "transient";
  if (err instanceof Anthropic.AnthropicError) return "transient"; // e.g. output the SDK couldn't parse
  return null;
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `claude ${err.type ?? "error"} status=${err.status ?? "none"} message=${JSON.stringify(upstreamMessage(err).slice(0, 300))}`;
  }
  if (err instanceof ChatHttpError) return `chat status=${err.status} message=${JSON.stringify(err.detail.slice(0, 300))}`;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** The provider to try now, or null to go straight to practice mode. */
function activeProvider(route: string): Provider | null {
  if (Date.now() < unavailableUntil) return null;
  try {
    return findProvider();
  } catch (err) {
    // A bad GD_PROVIDER setting: log it and keep the GD running in practice mode.
    console.error(`[gd-arena] ${route}: ${describe(err)}; using practice mode`);
    return null;
  }
}

/** Rethrows errors that aren't AI failures; otherwise logs and records the failure. */
function absorb(err: unknown, route: string, clientSignal?: AbortSignal): void {
  const kind = classify(err, clientSignal);
  if (kind === null || kind === "abort") throw err;
  if (kind === "unavailable") unavailableUntil = Date.now() + UNAVAILABLE_COOL_DOWN_MS;
  console.error(`[gd-arena] ${route}: AI ${kind} (${describe(err)}); using practice mode`);
}

/** One participant line from the AI, or a built-in practice line when the AI can't be used. */
export async function lineOrPractice(
  input: TurnPromptInput,
  signal?: AbortSignal,
): Promise<{ text: string | null; offline: boolean }> {
  const provider = activeProvider("/api/turn");
  if (provider) {
    try {
      const text =
        provider.id === "claude" ? await lineFromClaude(input, signal) : await generateLineViaChat(provider, input, signal);
      return { text, offline: false };
    } catch (err) {
      absorb(err, "/api/turn", signal);
    }
  }
  return { text: offlineLine(input), offline: true };
}

/** The AI's structured assessment, or a metrics-only one when the AI can't be used. */
export async function assessOrPractice(
  record: GDRecord,
  metrics: GDMetrics,
  signal?: AbortSignal,
): Promise<{ assessment: Assessment; offline: boolean }> {
  const provider = activeProvider("/api/score");
  if (provider) {
    try {
      const assessment =
        provider.id === "claude"
          ? await assessWithClaude(record, metrics, signal)
          : await assessGDViaChat(provider, record, metrics, signal).then((raw) =>
              raw ? normaliseAssessment(raw, metrics) : null,
            );
      if (assessment) return { assessment, offline: false };
      console.error("[gd-arena] /api/score: the AI returned no usable assessment; using practice mode");
    } catch (err) {
      absorb(err, "/api/score", signal);
    }
  }
  return { assessment: offlineAssessment(record, metrics), offline: true };
}
