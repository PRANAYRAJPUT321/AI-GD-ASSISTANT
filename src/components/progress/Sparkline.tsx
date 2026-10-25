import { useId } from "react";

const WIDTH = 132;
const HEIGHT = 44;
const PAD = 5;

/** Scores closer together than this still get a window this tall, so a wobble stays a wobble. */
const MIN_WINDOW = 30;

/** The score range to draw: the scores' own range with some room, at least MIN_WINDOW, inside 0–100. */
function scoreWindow(scores: readonly number[]): { low: number; high: number } {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = Math.min(100, Math.max(MIN_WINDOW, max - min + 10));
  const low = Math.max(0, Math.min(100 - span, (min + max) / 2 - span / 2));
  return { low, high: low + span };
}

/** Recent scores as a small line, zoomed to their range, with the latest score marked. */
export function Sparkline({ scores, className }: { scores: readonly number[]; className?: string }) {
  // useId can contain characters that break a url(#…) reference.
  const gradient = `spark${useId().replace(/[^\w-]/g, "")}`;
  if (scores.length === 0) return null;
  const step = scores.length > 1 ? (WIDTH - PAD * 2) / (scores.length - 1) : 0;
  const { low, high } = scoreWindow(scores);
  const points = scores.map((score, index) => ({
    x: scores.length > 1 ? PAD + index * step : WIDTH / 2,
    y: PAD + (1 - (score - low) / (high - low)) * (HEIGHT - PAD * 2),
  }));
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = `M${points[0].x.toFixed(1)},${HEIGHT} L${line.replaceAll(" ", " L")} L${last.x.toFixed(1)},${HEIGHT} Z`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Recent scores, oldest first: ${scores.join(", ")}`}
      className={className}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - 1} y2={HEIGHT - 1} stroke="var(--line)" strokeDasharray="3 4" />
      {points.length > 1 && <path d={area} fill={`url(#${gradient})`} />}
      {points.length > 1 && (
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle cx={last.x} cy={last.y} r={6} fill="var(--accent)" opacity={0.18} />
      <circle cx={last.x} cy={last.y} r={3.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.5} />
    </svg>
  );
}
