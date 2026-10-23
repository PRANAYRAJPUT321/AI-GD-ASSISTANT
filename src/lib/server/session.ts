// Signed session tokens and the device cookie.
//
// Token format: base64url(JSON {sid, exp}) + "." + base64url(HMAC-SHA256(secret, payload)).
// One token is issued per GD by POST /api/session and authorises that GD's turn and
// score calls. Stateless: verification needs only the secret.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Env } from "./http";
import { anyProviderKey } from "./provider";

export const TOKEN_TTL_MS = 45 * 60 * 1000;

export const DEVICE_COOKIE = "gd_device";
export const DEVICE_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export interface SessionClaims {
  /** Session id: one per GD. Keys the per-session call counters. */
  sid: string;
  /** Expiry, ms since the epoch. */
  exp: number;
}

export interface TokenOptions {
  /** Override the clock (tests). */
  now?: number;
  /** Override the secret (tests); defaults to sessionSecret(). */
  secret?: Buffer;
}

/**
 * HMAC key: SESSION_SECRET, else derived from the configured AI key so a deployment
 * with only an AI key set still gets a stable, private secret. With no key at all the
 * app runs in practice mode, where tokens only unlock free built-in lines, so a fixed
 * per-project secret is enough; adding any AI key changes the secret.
 */
export function sessionSecret(env: Env = process.env): Buffer {
  const explicit = env.SESSION_SECRET?.trim();
  if (explicit) return Buffer.from(explicit, "utf8");
  const apiKey = anyProviderKey(env);
  const seed = apiKey ?? `practice:${env.VERCEL_PROJECT_ID ?? "local"}`;
  return createHash("sha256").update(`gd-arena:${seed}`).digest();
}

const sign = (payload: string, secret: Buffer) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function createSessionToken(options: TokenOptions = {}): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = {
    sid: randomUUID(),
    exp: (options.now ?? Date.now()) + TOKEN_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const secret = options.secret ?? sessionSecret();
  return { token: `${payload}.${sign(payload, secret)}`, claims };
}

/** The token's claims if the signature is valid and it has not expired; otherwise null. */
export function verifySessionToken(token: string, options: TokenOptions = {}): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const secret = options.secret ?? sessionSecret();

  const expected = Buffer.from(sign(payload, secret), "utf8");
  const given = Buffer.from(signature, "utf8");
  // timingSafeEqual needs equal lengths; a length mismatch is already a failure.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof claims !== "object" ||
    claims === null ||
    typeof (claims as SessionClaims).sid !== "string" ||
    typeof (claims as SessionClaims).exp !== "number"
  ) {
    return null;
  }
  const { sid, exp } = claims as SessionClaims;
  return exp > (options.now ?? Date.now()) ? { sid, exp } : null;
}

// ---------- Device id (cookie) ----------

const DEVICE_ID = /^[A-Za-z0-9-]{16,64}$/;

/** A device id from the cookie if well formed, else a fresh one. */
export function deviceIdFrom(cookieValue: string | undefined): { id: string; isNew: boolean } {
  return cookieValue && DEVICE_ID.test(cookieValue)
    ? { id: cookieValue, isNew: false }
    : { id: randomUUID(), isNew: true };
}

export function deviceCookieOptions(production = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_SEC,
  };
}
