import { GDApp } from "@/components/GDApp";

const DEFAULT_DAILY_LIMIT = 3;

/**
 * GDs per device per day from DAILY_GD_LIMIT, parsed like the server's limiter (default 3;
 * "0" = unlimited → null). It only drives the "N free GDs a day" note: /api/session enforces
 * the real limit. The page is prerendered, so the value is read at build time (on Vercel an
 * env change needs a redeploy anyway).
 */
function readDailyLimit(): number | null {
  const raw = process.env.DAILY_GD_LIMIT?.trim();
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0) return DEFAULT_DAILY_LIMIT;
  return limit === 0 ? null : limit;
}

export default function Home() {
  return <GDApp dailyLimit={readDailyLimit()} />;
}
