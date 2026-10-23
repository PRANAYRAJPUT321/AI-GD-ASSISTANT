// GET /api/health: a quick deployment check that is safe to open in a browser.
// Reports whether the server can see a Claude API key (and under which variable name)
// and which commit is deployed. It never returns the key itself.

import { connection } from "next/server";
import { API_KEY_ENV_NAMES, jsonOk } from "@/lib/server/http";

export async function GET(): Promise<Response> {
  // Read the environment at request time, not when the page is prerendered at build.
  await connection();
  const keySource = API_KEY_ENV_NAMES.find((name) => process.env[name]?.trim()) ?? null;
  return jsonOk({
    ok: keySource !== null,
    apiKey: keySource ? `set (${keySource})` : "missing: add ANTHROPIC_API_KEY in the Vercel project settings",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? "local",
  });
}
