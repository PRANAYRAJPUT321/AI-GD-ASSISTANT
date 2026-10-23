// POST /api/session: starts a GD. Counts it against the daily limits (device, IP,
// global) and returns a signed session token for the GD's turn and score calls.

import { NextResponse, type NextRequest } from "next/server";
import type { ApiError, SessionResponse } from "@/lib/types";
import { assertAiConfigured } from "@/lib/server/ai";
import { clientIp, errorResponse, requireJson } from "@/lib/server/http";
import { consumeDailyGD } from "@/lib/server/limits";
import {
  createSessionToken,
  DEVICE_COOKIE,
  deviceCookieOptions,
  deviceIdFrom,
  sessionSecret,
} from "@/lib/server/session";
import { getStore } from "@/lib/server/store";

export async function POST(request: NextRequest): Promise<Response> {
  const notJson = requireJson(request);
  if (notJson) return notJson;
  try {
    // Fail before counting anything if the server cannot run a GD at all.
    assertAiConfigured();
    const secret = sessionSecret();

    const device = deviceIdFrom(request.cookies.get(DEVICE_COOKIE)?.value);
    const result = await consumeDailyGD(getStore(), {
      deviceId: device.id,
      ip: clientIp(request.headers),
    });

    let response: NextResponse;
    if (result.ok) {
      const { token } = createSessionToken({ secret });
      response = NextResponse.json<SessionResponse>(
        { token, remainingToday: result.remainingToday },
        { headers: { "cache-control": "no-store" } },
      );
    } else {
      response = NextResponse.json<ApiError>(
        { error: result.message, code: "daily_limit" },
        { status: 429, headers: { "cache-control": "no-store" } },
      );
    }
    // Refresh the device cookie on every call so it keeps its one-year lifetime.
    response.cookies.set(DEVICE_COOKIE, device.id, deviceCookieOptions());
    return response;
  } catch (err) {
    return errorResponse(err, "/api/session", request.signal);
  }
}
