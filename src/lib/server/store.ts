// Counter store for usage limits: Upstash Redis over REST when configured
// (works across serverless instances), otherwise an in-memory Map.
//
// The in-memory store lives per server process. That is exact for `next dev` and a
// single `next start`, but only approximate on Vercel, where every warm function
// instance keeps its own counts. Configure Upstash (or Vercel KV) in production.

import type { Env } from "./http";

/** Prefix for every key, so the app can share a Redis database. */
const KEY_PREFIX = "gd-arena:";
const UPSTASH_TIMEOUT_MS = 4000;

export interface CounterStore {
  readonly kind: "upstash" | "memory";
  /** Increments `key` and (re)sets its expiry; resolves to the new value. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Undoes one increment. */
  decr(key: string): Promise<void>;
}

/** The counter store could not be reached; requests fail closed (cost control). */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

// ---------- In-memory ----------

interface MemoryEntry {
  value: number;
  expiresAt: number;
}

/** Sweep expired keys once the map grows past this, so long-lived processes stay small. */
const SWEEP_THRESHOLD = 5000;

export function createMemoryStore(now: () => number = Date.now): CounterStore {
  const entries = new Map<string, MemoryEntry>();

  const live = (key: string): MemoryEntry | undefined => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  const sweep = () => {
    if (entries.size < SWEEP_THRESHOLD) return;
    const t = now();
    for (const [key, entry] of entries) if (entry.expiresAt <= t) entries.delete(key);
  };

  return {
    kind: "memory",
    async incr(key, ttlSec) {
      sweep();
      const value = (live(key)?.value ?? 0) + 1;
      entries.set(key, { value, expiresAt: now() + ttlSec * 1000 });
      return value;
    },
    async decr(key) {
      const entry = live(key);
      if (entry) entry.value -= 1;
    },
  };
}

// ---------- Upstash Redis (REST pipeline) ----------

type PipelineCommand = (string | number)[];
type PipelineResult = { result?: unknown; error?: string };

export function createUpstashStore(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): CounterStore {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/pipeline`;

  async function pipeline(commands: PipelineCommand[]): Promise<PipelineResult[]> {
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(commands),
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
      });
    } catch {
      throw new StoreError("Counter store unreachable");
    }
    if (!res.ok) throw new StoreError(`Counter store responded ${res.status}`);
    const results = (await res.json().catch(() => null)) as PipelineResult[] | null;
    if (!Array.isArray(results) || results.length !== commands.length) {
      throw new StoreError("Counter store returned an unexpected response");
    }
    const failed = results.find((r) => r.error);
    if (failed) throw new StoreError(`Counter store command failed: ${failed.error}`);
    return results;
  }

  return {
    kind: "upstash",
    async incr(key, ttlSec) {
      const k = KEY_PREFIX + key;
      const [incr] = await pipeline([
        ["INCR", k],
        ["EXPIRE", k, ttlSec],
      ]);
      const value = Number(incr.result);
      if (!Number.isFinite(value)) throw new StoreError("Counter store returned a non-numeric count");
      return value;
    },
    async decr(key) {
      await pipeline([["DECR", KEY_PREFIX + key]]);
    },
  };
}

// ---------- Selection ----------

/** Upstash credentials from either the Upstash or the Vercel KV variable names. */
function upstashConfig(env: Env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

// Kept on globalThis so dev hot reloads do not reset in-memory counts.
const globalStore = globalThis as typeof globalThis & { __gdArenaStore?: CounterStore };

/** The process-wide counter store, chosen from the environment on first use. */
export function getStore(): CounterStore {
  if (!globalStore.__gdArenaStore) {
    const upstash = upstashConfig(process.env);
    globalStore.__gdArenaStore = upstash
      ? createUpstashStore(upstash.url, upstash.token)
      : createMemoryStore();
  }
  return globalStore.__gdArenaStore;
}
