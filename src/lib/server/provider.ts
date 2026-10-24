// Which AI service runs the participants and the scoring.
//
// - "claude": the Anthropic API (see claude.ts). Best quality; needs a funded account.
// - "gemini" / "groq": services with a free tier, reached through their OpenAI-compatible
//   chat completions endpoints (see chat.ts).
// - "openai": any other OpenAI-compatible endpoint (LLM_BASE_URL + LLM_API_KEY).
//
// GD_PROVIDER picks one explicitly; otherwise the first service with a key set wins,
// in the order above. A chat service has a list of models, tried in order (see chat.ts).

import { API_KEY_ENV_NAMES, ConfigError, type Env } from "./http";

export type ProviderId = "claude" | "gemini" | "groq" | "openai";

/** A service reached through an OpenAI-compatible `POST {baseUrl}/chat/completions`. */
export interface ChatProvider {
  id: Exclude<ProviderId, "claude">;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** Models for participant lines, in order: a later one is used when an earlier one is missing or out of quota. */
  turnModels: readonly string[];
  /** Models for scoring, in the same way. */
  scoringModels: readonly string[];
  /** Extra request fields for participant lines (e.g. a low reasoning effort for speed). */
  turnExtra: Readonly<Record<string, unknown>>;
  /** Extra request fields for scoring. */
  scoringExtra: Readonly<Record<string, unknown>>;
}

export type Provider = { id: "claude"; label: string; apiKey: string } | ChatProvider;

interface ChatPreset {
  label: string;
  keys: readonly string[];
  baseUrl?: string;
  turnModels?: readonly string[];
  scoringModels?: readonly string[];
  turnExtra: Record<string, unknown>;
  scoringExtra: Record<string, unknown>;
}

const CHAT_PRESETS: Record<ChatProvider["id"], ChatPreset> = {
  gemini: {
    label: "Google Gemini",
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    // The "-latest" aliases follow Google's current Flash-Lite and Flash releases, so a model
    // retirement doesn't stop the app; the pinned 2.5 names cover keys that still have them.
    // Flash-Lite comes first for lines: a GD makes dozens of short calls, and it has the
    // largest free-tier quota. Scoring is one call per GD, so it starts with full Flash.
    turnModels: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
    scoringModels: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    turnExtra: { reasoning_effort: "low" },
    // Medium reasoning made full Flash take over the 112 s scoring deadline on a 10-minute GD.
    scoringExtra: { reasoning_effort: "low" },
  },
  groq: {
    label: "Groq",
    keys: ["GROQ_API_KEY"],
    baseUrl: "https://api.groq.com/openai/v1",
    turnModels: ["openai/gpt-oss-120b"],
    turnExtra: { reasoning_effort: "low" },
    scoringExtra: { reasoning_effort: "medium" },
  },
  openai: {
    label: "OpenAI-compatible API",
    keys: ["LLM_API_KEY"],
    turnExtra: {},
    scoringExtra: {},
  },
};

const AUTO_ORDER: readonly ProviderId[] = ["claude", "gemini", "groq", "openai"];

function firstSet(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** A comma-separated model list from the environment, or undefined when unset or blank. */
function modelList(value: string | undefined): string[] | undefined {
  const models = (value ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? models : undefined;
}

function keyNames(id: ProviderId): readonly string[] {
  return id === "claude" ? API_KEY_ENV_NAMES : CHAT_PRESETS[id].keys;
}

function build(id: ProviderId, apiKey: string, env: Env): Provider {
  if (id === "claude") return { id, label: "Claude", apiKey };
  const preset = CHAT_PRESETS[id];
  // LLM_BASE_URL overrides any preset (a proxy, a regional endpoint, tests).
  const baseUrl = (env.LLM_BASE_URL?.trim() || preset.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new ConfigError("GD_PROVIDER=openai needs LLM_BASE_URL.");
  // GD_MODEL and GD_SCORING_MODEL (one model, or several separated by commas) override it too.
  const turnModels = modelList(env.GD_MODEL) ?? preset.turnModels;
  if (!turnModels) throw new ConfigError("GD_PROVIDER=openai needs GD_MODEL.");
  return {
    id,
    label: preset.label,
    baseUrl,
    apiKey,
    turnModels,
    scoringModels: modelList(env.GD_SCORING_MODEL) ?? modelList(env.GD_MODEL) ?? preset.scoringModels ?? turnModels,
    turnExtra: preset.turnExtra,
    scoringExtra: preset.scoringExtra,
  };
}

/** The configured provider, or null when no AI key is set at all. Throws ConfigError on a bad GD_PROVIDER. */
export function findProvider(env: Env = process.env): Provider | null {
  const wanted = env.GD_PROVIDER?.trim().toLowerCase();
  if (wanted) {
    const id = AUTO_ORDER.find((p) => p === wanted);
    if (!id) throw new ConfigError(`GD_PROVIDER must be one of ${AUTO_ORDER.join(", ")}.`);
    const key = firstSet(env, keyNames(id));
    if (!key) throw new ConfigError(`GD_PROVIDER=${id} but ${keyNames(id)[0]} is not set.`);
    return build(id, key, env);
  }
  for (const id of AUTO_ORDER) {
    const key = firstSet(env, keyNames(id));
    if (key) return build(id, key, env);
  }
  return null;
}

/** The configured provider; throws ConfigError when none is set up. */
export function requireProvider(env: Env = process.env): Provider {
  const provider = findProvider(env);
  if (!provider) {
    throw new ConfigError("No AI key is set (ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY).");
  }
  return provider;
}

/** Whichever AI key is configured, for deriving the session-token secret. */
export function anyProviderKey(env: Env = process.env): string | undefined {
  for (const id of AUTO_ORDER) {
    const key = firstSet(env, keyNames(id));
    if (key) return key;
  }
  return undefined;
}
