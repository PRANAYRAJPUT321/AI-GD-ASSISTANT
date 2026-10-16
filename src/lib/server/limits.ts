// Usage limits (cost control). Each GD costs real Claude usage, so:
//  - a daily GD allowance per device, per IP and (optionally) globally;
//  - per-session caps on turn and score calls, so one token cannot be replayed forever.
// Every limit is configurable by env; 0 switches a daily limit off.

import type { Env } from "./http";
import type { CounterStore } from "./store";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Max /api/turn calls per GD session (a 12-minute GD needs well under 100). */
export const TURN_CALLS_PER_SESSION = 150;
/** Max /api/score calls per GD session (first try plus retries). */
export const SCORE_CALLS_PER_SESSION = 3;

/** Day counters outlive their day comfortably, whatever the timezone. */
const DAY_KEY_TTL_SEC = 2 * 24 * 60 * 60;
/** Session counters outlive the 45-minute token. */
const SESSION_KEY_TTL_SEC = 2 * 60 * 60;

export interface DailyLimits {
  /** GDs per device per day; 0 = unlimited. */
  perDevice: number;
  /** GDs per IP per day; 0 = off. */
  perIp: number;
  /** GDs across everyone per day; 0 = off. */
  global: number;
  /** IANA timezone in which the day rolls over. */
  timeZone: string;
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function validTimeZone(tz: string | undefined): string {
  if (!tz?.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function readDailyLimits(env: Env = process.env): DailyLimits {
  return {
    perDevice: parseLimit(env.DAILY_GD_LIMIT, 3),
    perIp: parseLimit(env.DAILY_GD_LIMIT_PER_IP, 30),
    global: parseLimit(env.DAILY_GD_LIMIT_GLOBAL, 0),
    timeZone: validTimeZone(env.LIMIT_TIMEZONE),
  };
}

/** Calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type LimitScope = "device" | "ip" | "global";

export type ConsumeResult =
  | { ok: true; remainingToday: number | null }
  | { ok: false; scope: LimitScope; message: string };

function limitMessage(scope: LimitScope, limit: number): string {
  switch (scope) {
    case "device":
      return `You've used today's ${limit} free GD${limit === 1 ? "" : "s"}. Come back tomorrow.`;
    case "ip":
      return "Your network has used today's GD allowance. Come back tomorrow.";
    case "global":
      return "GD Arena has reached today's practice limit for everyone. Please come back tomorrow.";
  }
}

/**
 * Counts one GD against the device, IP and global daily limits, in that order.
 * If any limit is exceeded, every increment already made is undone so a refused
 * request costs the caller nothing.
 */
export async function consumeDailyGD(
  store: CounterStore,
  who: { deviceId: string; ip: string },
  now: Date = new Date(),
  limits: DailyLimits = readDailyLimits(),
): Promise<ConsumeResult> {
  const day = dayKey(now, limits.timeZone);
  const checks: { scope: LimitScope; key: string; limit: number }[] = [
    { scope: "device" as const, key: `day:${day}:device:${who.deviceId}`, limit: limits.perDevice },
    { scope: "ip" as const, key: `day:${day}:ip:${who.ip}`, limit: limits.perIp },
    { scope: "global" as const, key: `day:${day}:global`, limit: limits.global },
  ].filter((c) => c.limit > 0);

  const incremented: string[] = [];
  let deviceCount: number | null = null;
  for (const check of checks) {
    let count: number;
    try {
      count = await store.incr(check.key, DAY_KEY_TTL_SEC);
    } catch (err) {
      // The GD will not start, so it must not stay counted either.
      await undo(store, incremented);
      throw err;
    }
    incremented.push(check.key);
    if (check.scope === "device") deviceCount = count;
    if (count > check.limit) {
      await undo(store, incremented);
      return { ok: false, scope: check.scope, message: limitMessage(check.scope, check.limit) };
    }
  }
  return {
    ok: true,
    remainingToday: deviceCount === null ? null : Math.max(0, limits.perDevice - deviceCount),
  };
}

async function undo(store: CounterStore, keys: string[]): Promise<void> {
  // Best effort: a failed undo only over-counts, which is the safe direction.
  const results = await Promise.allSettled(keys.map((key) => store.decr(key)));
  if (results.some((r) => r.status === "rejected")) {
    console.error("[gd-arena] limits: could not undo a refused GD's counter increments");
  }
}

/** Counts one call of `kind` for a session; false once the session's cap is exceeded. */
export async function consumeSessionCall(
  store: CounterStore,
  sid: string,
  kind: "turn" | "score",
): Promise<boolean> {
  const cap = kind === "turn" ? TURN_CALLS_PER_SESSION : SCORE_CALLS_PER_SESSION;
  const count = await store.incr(`session:${sid}:${kind}`, SESSION_KEY_TTL_SEC);
  return count <= cap;
}
