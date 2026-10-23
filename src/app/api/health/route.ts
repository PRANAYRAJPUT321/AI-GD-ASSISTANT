// GET /api/health: a quick deployment check that is safe to open in a browser.
// Reports which AI service the server will use (and its models) and which commit is
// deployed. It never returns a key.

import { connection } from "next/server";
import { jsonOk } from "@/lib/server/http";
import { findProvider, type Provider } from "@/lib/server/provider";
import { scoringModel, turnModel } from "@/lib/server/claude";

function describe(provider: Provider) {
  return provider.id === "claude"
    ? { provider: "claude", turnModel: turnModel(), scoringModel: scoringModel() }
    : { provider: provider.id, turnModel: provider.turnModel, scoringModel: provider.scoringModel };
}

export async function GET(): Promise<Response> {
  // Read the environment at request time, not when the page is prerendered at build.
  await connection();
  let ai: Record<string, string> | string;
  try {
    const provider = findProvider();
    ai = provider ? describe(provider) : "missing: add ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY in Vercel";
  } catch (err) {
    ai = `misconfigured: ${err instanceof Error ? err.message : "unknown"}`;
  }
  return jsonOk({
    ok: typeof ai !== "string",
    ai,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? "local",
  });
}
