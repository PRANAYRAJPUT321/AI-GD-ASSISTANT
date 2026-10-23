// Participant lines and scoring through an OpenAI-compatible chat completions API
// (Gemini, Groq, or another service; see provider.ts). Uses plain fetch, so no extra SDK.
// The prompts are the same ones the Claude path uses, flattened to two plain messages.

import { z } from "zod";
import { AssessmentSchema, type Assessment, type GDMetrics } from "../scoring";
import type { GDRecord } from "../types";
import { buildScoringPrompt, buildTurnPrompt, cleanLine, cleanLineOptions, type TurnPromptInput } from "./prompts";
import type { ChatProvider } from "./provider";

/** Per-route budgets inside each route's maxDuration (30 s turn, 120 s score). */
const TURN_DEADLINE_MS = 27_000;
const TURN_MAX_TOKENS = 4000; // some services count hidden reasoning against this
const SCORE_DEADLINE_MS = 112_000;
const SCORE_MAX_TOKENS = 16_000;
/** On a 429, wait this long (or the server's Retry-After, if shorter) and try once more. */
const RATE_LIMIT_RETRY_MS = 3_000;

/** A non-2xx answer from the chat service. The message is for server logs only. */
export class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`chat API returned ${status}`);
    this.name = "ChatHttpError";
  }
}

/** Our own deadline passed before the chat service answered. */
export class ChatTimeoutError extends Error {
  constructor() {
    super("chat API timed out");
    this.name = "ChatTimeoutError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  extra: Readonly<Record<string, unknown>>;
  json?: boolean;
}

interface ChatResult {
  text: string;
  finishReason: string | null;
}

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = (first as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === "string") return message;
  } catch {
    // not JSON; fall through to the raw text
  }
  return body.slice(0, 300);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function complete(
  provider: ChatProvider,
  req: ChatRequest,
  deadlineMs: number,
  clientSignal?: AbortSignal,
): Promise<ChatResult> {
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = clientSignal ? AbortSignal.any([clientSignal, deadline]) : deadline;
  const body = JSON.stringify({
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    ...req.extra,
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
  });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
        body,
        signal,
      });
    } catch (err) {
      if (deadline.aborted) throw new ChatTimeoutError();
      throw err; // the browser went away (AbortError) or a network failure
    }
    if (res.status === 429 && attempt === 0) {
      // Free tiers have tight per-minute limits; one short wait usually clears them.
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await res.body?.cancel();
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, RATE_LIMIT_RETRY_MS) : RATE_LIMIT_RETRY_MS, signal);
      if (signal.aborted) {
        if (deadline.aborted) throw new ChatTimeoutError();
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new ChatHttpError(res.status, errorDetail(text));
    const parsed = ChatResponseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new ChatHttpError(502, "unexpected response shape");
    const choice = parsed.data.choices[0];
    return { text: choice.message?.content ?? "", finishReason: choice.finish_reason ?? null };
  }
}

/** One participant line, or null when nothing speakable came back. */
export async function generateLineViaChat(
  provider: ChatProvider,
  input: TurnPromptInput,
  signal?: AbortSignal,
): Promise<string | null> {
  const prompt = buildTurnPrompt(input);
  const content = prompt.messages[0]?.content;
  const user = Array.isArray(content)
    ? content.map((block) => (block.type === "text" ? block.text : "")).join("\n")
    : String(content ?? "");
  const result = await complete(
    provider,
    {
      model: provider.turnModel,
      messages: [
        { role: "system", content: prompt.system.map((block) => block.text).join("\n\n") },
        { role: "user", content: user },
      ],
      maxTokens: TURN_MAX_TOKENS,
      extra: provider.turnExtra,
    },
    TURN_DEADLINE_MS,
    signal,
  );
  // A line cut off by the token limit would end mid-sentence when spoken.
  if (result.finishReason === "length" || result.finishReason === "content_filter") return null;
  return cleanLine(result.text, cleanLineOptions(input.speaker, input.userName, prompt.maxWords));
}

/** The JSON Schema the evaluator must follow, written into the prompt (JSON mode doesn't take a schema everywhere). */
const ASSESSMENT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(AssessmentSchema));

/** Pulls the JSON object out of a reply that may be wrapped in a code fence or prose. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** The structured assessment, or null when the reply wasn't a valid assessment. */
export async function assessGDViaChat(
  provider: ChatProvider,
  record: GDRecord,
  metrics: GDMetrics,
  signal?: AbortSignal,
): Promise<Assessment | null> {
  const prompt = buildScoringPrompt(record, metrics);
  const result = await complete(
    provider,
    {
      model: provider.scoringModel,
      messages: [
        { role: "system", content: prompt.system },
        {
          role: "user",
          content:
            `${prompt.user}\n\nReply with ONLY a JSON object (no prose, no code fence) that matches this JSON Schema exactly:\n` +
            ASSESSMENT_JSON_SCHEMA,
        },
      ],
      maxTokens: SCORE_MAX_TOKENS,
      extra: provider.scoringExtra,
      json: true,
    },
    SCORE_DEADLINE_MS,
    signal,
  );
  const parsed = AssessmentSchema.safeParse(extractJson(result.text));
  return parsed.success ? parsed.data : null;
}
