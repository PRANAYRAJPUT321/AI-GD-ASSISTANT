// Small HTTP helpers shared by the API route handlers: JSON responses shaped as
// ApiError, body reading with a size cap, client IP, and mapping thrown errors
// (configuration, counter store, Anthropic SDK) to safe responses.

import Anthropic from "@anthropic-ai/sdk";
import type { ApiError } from "../types";
import { ChatHttpError, ChatTimeoutError } from "./chat";
import { StoreError } from "./store";

/** Environment variables (process.env, or a plain object in tests). */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Environment variable names the Anthropic API key is read from, in order.
 * ANTHROPIC_API_KEY is the documented name; `pranay_api_key` is the name the key was
 * saved under in this project's Vercel settings (a Sensitive variable can't be renamed).
 */
export const API_KEY_ENV_NAMES = ["ANTHROPIC_API_KEY", "pranay_api_key"] as const;

/** The Anthropic API key from the first non-empty name in API_KEY_ENV_NAMES, else undefined. */
export function readApiKey(env: Env = process.env): string | undefined {
  for (const name of API_KEY_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** The server is missing configuration it needs (API key, session secret). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const NO_STORE = { "cache-control": "no-store" } as const;

/** A JSON success response that is never cached. */
export function jsonOk<T>(body: T, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

/** A JSON error response shaped as ApiError. */
export function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code } satisfies ApiError, { status, headers: NO_STORE });
}

/**
 * Rejects anything that is not a JSON POST. Besides catching mistakes, this blocks
 * cross-site form posts: a browser cannot send `application/json` to another origin
 * without a CORS preflight, which these routes never grant.
 */
export function requireJson(request: Request): Response | null {
  const type = request.headers.get("content-type") ?? "";
  return type.toLowerCase().includes("application/json")
    ? null
    : jsonError(415, "Send the request as JSON.", "bad_request");
}

export type BodyResult = { ok: true; body: unknown } | { ok: false; response: Response };

/** Reads and parses a JSON body, refusing anything larger than `maxBytes`. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const notJson = requireJson(request);
  if (notJson) return { ok: false, response: notJson };
  const tooLarge = (): BodyResult => ({
    ok: false,
    response: jsonError(413, "Request is too large.", "too_large"),
  });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonError(400, "Could not read the request body.", "bad_request") };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return tooLarge();
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "Request body is not valid JSON.", "bad_request") };
  }
}

/** The caller's IP: first x-forwarded-for entry, else x-real-ip. Sanitised for use in keys. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.replace(/[^\w.:-]/g, "_").slice(0, 64);
}

/** The API's own error message (e.g. "Your credit balance is too low…"), else the SDK's message. */
function upstreamMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const inner = body?.error?.message;
  return typeof inner === "string" ? inner : (err.message ?? "");
}

/**
 * Maps a thrown error to a response without leaking upstream details or secrets.
 * `clientSignal` is the incoming request's signal: an SDK abort caused by it means the
 * browser went away (e.g. a dropped prefetch); any other abort is our own deadline.
 */
export function errorResponse(err: unknown, route: string, clientSignal?: AbortSignal): Response {
  if (err instanceof ConfigError) {
    console.error(`[gd-arena] ${route}: configuration error: ${err.message}`);
    return jsonError(500, "GD Arena isn't configured correctly on the server yet.", "config");
  }
  if (err instanceof StoreError) {
    console.error(`[gd-arena] ${route}: counter store error: ${err.message}`);
    return jsonError(503, "The server is busy right now. Try again in a moment.", "unavailable");
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    if (clientSignal?.aborted) return jsonError(499, "Request cancelled.", "aborted");
    console.error(`[gd-arena] ${route}: upstream call hit the deadline`);
    return jsonError(504, "The AI took too long to respond. Try again.", "timeout");
  }
  if (err instanceof Anthropic.APIError) {
    // Log the API's error type, status, request id and message server-side, but never echo
    // the upstream message to the client. (Not the class name: production builds minify it.)
    const kind = err.type ?? (err instanceof Anthropic.APIConnectionError ? "connection_error" : "unknown_error");
    const detail = upstreamMessage(err);
    console.error(
      `[gd-arena] ${route}: upstream ${kind} status=${err.status ?? "none"} request_id=${err.requestID ?? "none"}` +
        (detail ? ` message=${JSON.stringify(detail.slice(0, 300))}` : ""),
    );
    if (err.status === 400 && /credit balance/i.test(detail)) {
      // The API reports an unfunded account as a 400 invalid_request_error.
      return jsonError(
        402,
        "GD Arena's Claude API account is out of credits. The site owner needs to add credits in the Claude Console (Billing).",
        "billing",
      );
    }
    if (err instanceof Anthropic.RateLimitError || err.status === 529) {
      return jsonError(503, "The AI is busy right now. Try again in a moment.", "busy");
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return jsonError(500, "GD Arena isn't configured correctly on the server yet.", "config");
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return jsonError(504, "The AI took too long to respond. Try again.", "timeout");
    }
    return jsonError(502, "The AI service had a problem. Try again.", "upstream");
  }
  if (err instanceof Anthropic.AnthropicError) {
    // e.g. structured output that failed to parse.
    console.error(`[gd-arena] ${route}: the SDK could not use the upstream response`);
    return jsonError(502, "The AI returned something unusable. Try again.", "upstream");
  }
  if (err instanceof ChatTimeoutError) {
    console.error(`[gd-arena] ${route}: chat API hit the deadline`);
    return jsonError(504, "The AI took too long to respond. Try again.", "timeout");
  }
  if (err instanceof ChatHttpError) {
    console.error(`[gd-arena] ${route}: chat API status=${err.status} message=${JSON.stringify(err.detail.slice(0, 300))}`);
    if (err.status === 429) {
      return jsonError(503, "The AI is busy right now (free-tier limit). Try again in a moment.", "busy");
    }
    if (err.status === 401 || err.status === 403) {
      return jsonError(500, "GD Arena isn't configured correctly on the server yet.", "config");
    }
    if (err.status === 402) {
      return jsonError(
        402,
        "GD Arena's AI account needs billing set up. The site owner needs to check the AI provider's console.",
        "billing",
      );
    }
    return jsonError(502, "The AI service had a problem. Try again.", "upstream");
  }
  if (err instanceof DOMException && err.name === "AbortError" && clientSignal?.aborted) {
    return jsonError(499, "Request cancelled.", "aborted");
  }
  console.error(`[gd-arena] ${route}: unexpected error`, err);
  return jsonError(500, "Something went wrong on the server.", "internal");
}
