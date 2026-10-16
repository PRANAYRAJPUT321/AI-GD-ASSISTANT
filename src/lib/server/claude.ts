// Claude calls for participant lines and for scoring.
//
// - Model ids come only from env (GD_MODEL, GD_SCORING_MODEL), defaulting to claude-opus-5-5.
// - Always the beta namespace with server-side refusal fallback ("default" routing).
// - No thinking/temperature/budget_tokens/prefill: Opus 5.5 thinks adaptively and rejects
//   those. Depth is steered with output_config.effort only.
// - The client is created lazily so `next build` works without an API key.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AssessmentSchema, type Assessment, type GDMetrics } from "../scoring";
import type { GDRecord } from "../types";
import { ConfigError, type Env } from "./http";
import { buildScoringPrompt, buildTurnPrompt, cleanLine, cleanLineOptions, type TurnPromptInput } from "./prompts";

export const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Turn calls: per-attempt timeout, and an overall deadline inside the route's 30 s maxDuration. */
const TURN_ATTEMPT_TIMEOUT_MS = 20_000;
const TURN_DEADLINE_MS = 27_000;
const TURN_MAX_TOKENS = 2000;
/** Scoring: inside the route's 120 s maxDuration. */
const SCORE_ATTEMPT_TIMEOUT_MS = 100_000;
const SCORE_DEADLINE_MS = 112_000;
const SCORE_MAX_TOKENS = 16_000;

export function turnModel(env: Env = process.env): string {
  return env.GD_MODEL?.trim() || DEFAULT_MODEL;
}

export function scoringModel(env: Env = process.env): string {
  return env.GD_SCORING_MODEL?.trim() || DEFAULT_MODEL;
}

export function turnEffort(env: Env = process.env): Effort {
  const value = env.GD_TURN_EFFORT?.trim().toLowerCase();
  return EFFORTS.find((e) => e === value) ?? "low";
}

/** Throws ConfigError when the API key is missing (checked at request time, not build time). */
export function assertApiKey(env: Env = process.env): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new ConfigError("ANTHROPIC_API_KEY is not set.");
  return key;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = assertApiKey();
  client ??= new Anthropic({ apiKey });
  return client;
}

/** Aborts when the browser goes away or when our own deadline passes, whichever is first. */
function withDeadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * Generates one participant line. Resolves to null when the model declined or produced
 * nothing speakable; SDK errors propagate to the route for status mapping.
 */
export async function generateLine(input: TurnPromptInput, signal?: AbortSignal): Promise<string | null> {
  const prompt = buildTurnPrompt(input);
  const message = await getClient().beta.messages.create(
    {
      model: turnModel(),
      max_tokens: TURN_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: turnEffort() },
      system: prompt.system,
      messages: prompt.messages,
    },
    { signal: withDeadline(signal, TURN_DEADLINE_MS), timeout: TURN_ATTEMPT_TIMEOUT_MS },
  );
  if (message.stop_reason === "refusal") return null;
  const raw = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return cleanLine(raw, cleanLineOptions(input.speaker, input.userName, prompt.maxWords));
}

const MAX_LIST_ITEMS = 8;
const MAX_ADVICE_ITEMS = 3;

const clampInt = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

const tidyList = (items: string[], max: number) =>
  items.map((s) => s.trim()).filter(Boolean).slice(0, max);

/**
 * Enforces the scorecard's numeric ranges and list sizes, and two rules the metrics
 * settle exactly: no summary caps the summary rating at 2, and no drift means there
 * was nothing to pull back.
 */
export function normaliseAssessment(raw: Assessment, metrics: GDMetrics): Assessment {
  const section = <T extends { rating: number; comment: string }>(s: T, maxRating = 10): T => ({
    ...s,
    rating: clampInt(s.rating, 0, maxRating),
    comment: s.comment.trim(),
  });
  return {
    overall: {
      score: clampInt(raw.overall.score, 0, 100),
      headline: raw.overall.headline.trim(),
      verdict: raw.overall.verdict.trim(),
    },
    opening: section(raw.opening),
    participation: section(raw.participation),
    content: {
      ...section(raw.content),
      newPoints: tidyList(raw.content.newPoints, MAX_LIST_ITEMS),
      repeatedPoints: tidyList(raw.content.repeatedPoints, MAX_LIST_ITEMS),
    },
    evidence: {
      ...section(raw.evidence),
      examples: tidyList(raw.evidence.examples, MAX_LIST_ITEMS),
      references: tidyList(raw.evidence.references, MAX_LIST_ITEMS),
    },
    interruptions: section(raw.interruptions),
    drift: {
      ...section(raw.drift),
      pulledBack: metrics.driftTurns === 0 ? null : raw.drift.pulledBack,
    },
    summary: section(raw.summary, metrics.summaryGiven ? 10 : 2),
    delivery: section(raw.delivery),
    strengths: tidyList(raw.strengths, MAX_ADVICE_ITEMS),
    improvements: tidyList(raw.improvements, MAX_ADVICE_ITEMS),
  };
}

/**
 * Scores a finished GD with structured output. Resolves to null when the model
 * declined or returned no parsable assessment.
 */
export async function assessGD(
  record: GDRecord,
  metrics: GDMetrics,
  signal?: AbortSignal,
): Promise<Assessment | null> {
  const prompt = buildScoringPrompt(record, metrics);
  const message = await getClient().beta.messages.parse(
    {
      model: scoringModel(),
      max_tokens: SCORE_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AssessmentSchema) },
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    },
    { signal: withDeadline(signal, SCORE_DEADLINE_MS), timeout: SCORE_ATTEMPT_TIMEOUT_MS },
  );
  if (message.stop_reason === "refusal" || !message.parsed_output) return null;
  return normaliseAssessment(message.parsed_output, metrics);
}
