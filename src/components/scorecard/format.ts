// Display formatting shared by the scorecard screens.

/** "16 Oct 2026, 3:42 pm" in the reader's locale. */
export function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** A speaking time: "42s", "2m 05s". */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** A 0..1 share as a whole percentage: "23%". */
export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** An ISO 8601 duration for <time dateTime>, e.g. "PT1M23S". */
export function isoDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `PT${Math.floor(total / 60)}M${total % 60}S`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
