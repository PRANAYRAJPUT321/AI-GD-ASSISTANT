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
/** A rate limit that clears within this long is waited out and retried once. */
const RATE_LIMIT_RETRY_MS = 3_000;
/** How long to pass over a model the service says doesn't exist or isn't available to this key. */
const MISSING_MODEL_SKIP_MS = 60 * 60 * 1000;
/** How long to pass over a model that is out of quota, when the service doesn't say. */
const QUOTA_SKIP_MS = 60 * 1000;
/** How long to pass over a model whose daily quota is used up. */
const DAILY_QUOTA_SKIP_MS = 60 * 60 * 1000;

/** A non-2xx answer from the chat service. The message is for server logs only. */
export class ChatHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** For a 429: how long the service asks us to wait, when it says. */
    readonly retryAfterMs?: number,
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
  messages: ChatMessage[];
  maxTokens: number;
  extra: Readonly<Record<string, unknown>>;
  json?: boolean;
}

interface ChatResult {
  text: string;
  finishReason: string | null;
  /** The model that answered. */
  model: string;
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

// Per server instance: models to pass over until a given time, and models that rejected the
// preset's extra fields (e.g. a reasoning_effort level the model doesn't support).
const skipUntil = new Map<string, number>();
const plainModels = new Set<string>();

/** Test hook: forget which models were skipped or sent without extra fields. */
export function resetChatModelState(): void {
  skipUntil.clear();
  plainModels.clear();
}

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

/** How long a 429 asks us to wait: a used-up daily quota, the Retry-After header, or "retry in 37s" in the body. */
function retryAfter(res: Response, body: string): number | undefined {
  if (/PerDay|per day|daily/i.test(body)) return DAILY_QUOTA_SKIP_MS;
  const header = Number(res.headers.get("retry-after"));
  if (res.headers.has("retry-after") && Number.isFinite(header) && header >= 0) return header * 1000;
  const inBody = /retry (?:in|after) ([\d.]+)\s*s/i.exec(body);
  return inBody ? Math.ceil(Number(inBody[1]) * 1000) : undefined;
}

/** How long to pass over a model after this error, or null when another model wouldn't help. */
function skipFor(err: ChatHttpError): number | null {
  if (err.status === 404) return MISSING_MODEL_SKIP_MS;
  if (
    err.status === 400 &&
    /model/i.test(err.detail) &&
    /not (?:found|supported|available)|no longer|unavailable|does not exist|unknown/i.test(err.detail)
  ) {
    return MISSING_MODEL_SKIP_MS;
  }
  if (err.status === 429) return err.retryAfterMs || QUOTA_SKIP_MS;
  return null;
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

/** One request to one model. */
async function send(
  provider: ChatProvider,
  body: string,
  signal: AbortSignal,
  deadline: AbortSignal,
): Promise<Omit<ChatResult, "model">> {
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
  const text = await res.text();
  if (!res.ok) {
    throw new ChatHttpError(res.status, errorDetail(text), res.status === 429 ? retryAfter(res, text) : undefined);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ChatHttpError(502, "response is not JSON");
  }
  const parsed = ChatResponseSchema.safeParse(json);
  if (!parsed.success) throw new ChatHttpError(502, "unexpected response shape");
  const choice = parsed.data.choices[0];
  return { text: choice.message?.content ?? "", finishReason: choice.finish_reason ?? null };
}

/** `send`, waiting out and retrying once a rate limit that clears within a few seconds. */
async function sendWithRetry(
  provider: ChatProvider,
  body: string,
  signal: AbortSignal,
  deadline: AbortSignal,
): Promise<Omit<ChatResult, "model">> {
  try {
    return await send(provider, body, signal, deadline);
  } catch (err) {
    if (!(err instanceof ChatHttpError) || err.status !== 429) throw err;
    const wait = err.retryAfterMs ?? RATE_LIMIT_RETRY_MS;
    if (wait > RATE_LIMIT_RETRY_MS) throw err;
    await sleep(wait, signal);
    if (signal.aborted) {
      if (deadline.aborted) throw new ChatTimeoutError();
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return await send(provider, body, signal, deadline);
  }
}

/**
 * Sends the request to the first usable model in `models`. A model the service says is
 * missing or out of quota is passed over for a while and the next one tried at once; a
 * model that rejects the extra fields (an unsupported reasoning_effort) is retried without
 * them. The last model's error is thrown when none of them answer. One deadline covers all tries.
 */
async function complete(
  provider: ChatProvider,
  models: readonly string[],
  req: ChatRequest,
  deadlineMs: number,
  clientSignal?: AbortSignal,
): Promise<ChatResult> {
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = clientSignal ? AbortSignal.any([clientSignal, deadline]) : deadline;
  const now = Date.now();
  const ready = models.filter((model) => (skipUntil.get(model) ?? 0) <= now);
  // When every model is being passed over, try them all anyway rather than fail without asking.
  const order = ready.length > 0 ? ready : models;

  for (let i = 0; i < order.length; ) {
    const model = order[i];
    const last = i === order.length - 1;
    const extra = plainModels.has(model) ? {} : req.extra;
    const body = JSON.stringify({
      model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      ...extra,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    });
    try {
      // Only the last model waits out a short rate limit; the others hand over straight away.
      const result = last ? await sendWithRetry(provider, body, signal, deadline) : await send(provider, body, signal, deadline);
      return { ...result, model };
    } catch (err) {
      if (!(err instanceof ChatHttpError)) throw err;
      if (err.status === 400 && Object.keys(extra).length > 0 && /reasoning|thinking/i.test(err.detail)) {
        plainModels.add(model);
        console.warn(
          `[gd-arena] chat: ${model} rejected ${Object.keys(extra).join(", ")} (${JSON.stringify(err.detail.slice(0, 200))}); retrying without`,
        );
        continue;
      }
      const skipMs = skipFor(err);
      if (skipMs !== null) skipUntil.set(model, Date.now() + skipMs);
      if (skipMs === null || last) throw err;
      console.warn(
        `[gd-arena] chat: ${model} status=${err.status} (${JSON.stringify(err.detail.slice(0, 200))}); trying ${order[i + 1]}`,
      );
      i++;
    }
  }
  throw new Error("no model to try"); // unreachable: the provider always has at least one model
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
    provider.turnModels,
    {
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
    provider.scoringModels,
    {
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

export interface ChatCheck {
  /** Each configured model, and whether the service lists it for this key (null when listing failed). */
  models: Record<string, boolean | null>;
  /** Every model id the service lists for this key (aliases may work without being listed). */
  available: string[] | null;
  /** A short test line through the same path a GD uses. */
  line: { ok: true; model: string; ms: number } | { ok: false; status: number | null; detail: string };
}

const CHECK_CACHE_MS = 5 * 60 * 1000;
let lastCheck: { at: number; result: Promise<ChatCheck> } | null = null;

/** Model ids the service lists for this key, without Gemini's "models/" prefix, or null on failure. */
async function listModels(provider: ChatProvider): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map((m) => (typeof m.id === "string" ? m.id.replace(/^models\//, "") : ""));
    return new Set(ids.filter(Boolean));
  } catch {
    return null;
  }
}

async function runCheck(provider: ChatProvider): Promise<ChatCheck> {
  const listed = await listModels(provider);
  const models: Record<string, boolean | null> = {};
  for (const model of [...provider.turnModels, ...provider.scoringModels]) models[model] = listed ? listed.has(model) : null;
  const available = listed ? [...listed].sort().slice(0, 200) : null;
  const started = Date.now();
  try {
    const result = await complete(
      provider,
      provider.turnModels,
      {
        messages: [
          { role: "system", content: "You are a participant in a group discussion. Reply with one short sentence." },
          { role: "user", content: "Greet the group in under ten words." },
        ],
        maxTokens: TURN_MAX_TOKENS,
        extra: provider.turnExtra,
      },
      TURN_DEADLINE_MS,
    );
    return { models, available, line: { ok: true, model: result.model, ms: Date.now() - started } };
  } catch (err) {
    const status = err instanceof ChatHttpError ? err.status : null;
    const raw = err instanceof ChatHttpError ? err.detail : err instanceof Error ? err.name : "unknown error";
    // The service's message helps diagnose a key or model problem; never let it carry the key.
    const detail = raw.split(provider.apiKey).join("[key]").slice(0, 300);
    return { models, available, line: { ok: false, status, detail } };
  }
}

/**
 * For GET /api/health?check=1: which configured models the key can use, and one short test
 * line. Cached for a few minutes so the check can't be used to burn the free-tier quota.
 */
export function checkChatProvider(provider: ChatProvider): Promise<ChatCheck> {
  if (lastCheck && Date.now() - lastCheck.at < CHECK_CACHE_MS) return lastCheck.result;
  const result = runCheck(provider);
  lastCheck = { at: Date.now(), result };
  return result;
}

/** Test hook: forget the cached check. */
export function resetChatCheck(): void {
  lastCheck = null;
}
