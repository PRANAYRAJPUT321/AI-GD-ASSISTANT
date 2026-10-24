// GET /api/health: a quick deployment check that is safe to open in a browser.
// Reports which AI service the server will use (and its models), or practice mode when
// none is set, and which commit is deployed. It never returns a key.
//
// GET /api/health?check=1 also asks a chat service (Gemini, Groq…) which of the configured
// models this key can use and generates one short test line (cached for a few minutes).

import type { NextRequest } from "next/server";
import { checkChatProvider, type ChatCheck } from "@/lib/server/chat";
import { jsonOk } from "@/lib/server/http";
import { findProvider, type Provider } from "@/lib/server/provider";
import { scoringModel, turnModel } from "@/lib/server/claude";

function describe(provider: Provider) {
  return provider.id === "claude"
    ? { provider: "claude", turnModels: [turnModel()], scoringModels: [scoringModel()] }
    : { provider: provider.id, turnModels: provider.turnModels, scoringModels: provider.scoringModels };
}

export async function GET(request: NextRequest): Promise<Response> {
  // Reading the request first makes this route dynamic, so the environment below is read
  // at request time rather than when the route is prerendered at build.
  const wantCheck = request.nextUrl.searchParams.get("check") === "1";
  let ai: ReturnType<typeof describe> | string;
  let check: ChatCheck | undefined;
  try {
    const provider = findProvider();
    ai = provider
      ? describe(provider)
      : "practice mode: no AI key set (add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY for AI participants)";
    if (provider && provider.id !== "claude" && wantCheck) {
      check = await checkChatProvider(provider);
    }
  } catch (err) {
    ai = `misconfigured: ${err instanceof Error ? err.message : "unknown"}`;
  }
  return jsonOk({
    ok: true,
    ai,
    ...(check ? { check } : {}),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? "local",
  });
}
