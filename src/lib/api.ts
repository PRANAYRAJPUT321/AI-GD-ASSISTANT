import type { ScoreRequest, ScoreResponse } from "./scoring";
import type { ApiError, SessionResponse, TurnRequest, TurnResponse } from "./types";

export class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiCallError("Network error. Check your connection.", 0, "network");
  }
  if (!res.ok) {
    let payload: ApiError | null = null;
    try {
      payload = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
    throw new ApiCallError(payload?.error ?? `Request failed (${res.status})`, res.status, payload?.code);
  }
  return (await res.json()) as T;
}

/** Starts a GD: counts against the daily limit and returns a signed session token. */
export function startSession(): Promise<SessionResponse> {
  return post<SessionResponse>("/api/session", {});
}

/** Generates one AI participant line. */
export function requestTurn(req: TurnRequest, signal?: AbortSignal): Promise<TurnResponse> {
  return post<TurnResponse>("/api/turn", req, signal);
}

/** Scores a finished GD. */
export function requestScore(req: ScoreRequest): Promise<ScoreResponse> {
  return post<ScoreResponse>("/api/score", req);
}
