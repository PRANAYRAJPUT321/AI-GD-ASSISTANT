"use client";

import { useId, useState } from "react";
import type { Cast } from "@/lib/personas";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { AIRTIME_ORDER, FAIR_SHARE, formatAirtime, seatInfo, totalOf, type ByParticipant, type Participant } from "./model";

/** Within this many percentage points of a fair share counts as "about fair". */
const FAIR_BAND = 3;

function percent(share: number): number {
  return Math.round(share * 100);
}

function fairShareVerdict(userShare: number): string {
  const gap = percent(userShare) - percent(FAIR_SHARE);
  if (Math.abs(gap) <= FAIR_BAND) return "about a fair share";
  return gap < 0 ? "below a fair share" : "above a fair share";
}

/**
 * Live stacked airtime bar for the discussion. Persona colours mark the segments, but the
 * legend always names each speaker with their time and share, so colour is never the only
 * cue. The candidate's segment comes first, so it reads directly against the fair-share
 * marker at 1/6. Segments are separated by 2px surface gaps and grow as people talk.
 */
interface AirtimeBarProps {
  airtime: ByParticipant;
  cast: Cast;
  /** Who is speaking now (named for screen readers in the legend). */
  live: Participant | null;
  className?: string;
}

export function AirtimeBar({ airtime, cast, live, className }: AirtimeBarProps) {
  const titleId = useId();
  const [hovered, setHovered] = useState<Participant | null>(null);
  const total = totalOf(airtime);
  const share = (id: Participant) => (total > 0 ? airtime[id] / total : 0);
  const visible = AIRTIME_ORDER.filter((id) => airtime[id] > 0);
  const fairPercent = percent(FAIR_SHARE);

  // The hovered segment (legend rows hover too, but someone silent has no segment) and the
  // centre of that segment along the bar, for its tooltip.
  const marked = hovered !== null && airtime[hovered] > 0 ? hovered : null;
  let tooltipAt = 0;
  if (marked) {
    const before = visible.slice(0, visible.indexOf(marked)).reduce((sum, id) => sum + airtime[id], 0);
    tooltipAt = (before + airtime[marked] / 2) / total;
  }

  return (
    <Card as="section" aria-labelledby={titleId} className={cn("p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          Airtime
        </h2>
        <p className="text-xs text-ink-2">
          {total > 0
            ? `You: ${percent(share("user"))}%, ${fairShareVerdict(share("user"))} (${fairPercent}%)`
            : "Fills in as the discussion goes"}
        </p>
      </div>

      <div className="relative mt-2 pt-5" onPointerLeave={() => setHovered(null)}>
        {/* Fair-share marker: a hairline with a surface ring so it reads over any segment. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-1 top-0 z-10 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${FAIR_SHARE * 100}%` }}
        >
          <span className="whitespace-nowrap text-[10px] font-semibold leading-4 text-ink-2">Fair share</span>
          <span className="w-0.5 flex-1 rounded-full bg-ink shadow-[0_0_0_2px_var(--panel)]" />
        </div>

        <div aria-hidden className="flex h-3.5 gap-[2px]">
          {total === 0 ? (
            <span className="h-full w-full rounded-[4px] bg-panel-2" />
          ) : (
            visible.map((id, index) => (
              <span
                key={id}
                onPointerEnter={() => setHovered(id)}
                className={cn(
                  "relative h-full min-w-[3px] basis-0 transition-[flex-grow,opacity] duration-300 ease-linear motion-reduce:transition-none",
                  // A taller invisible hit area than the 14px mark.
                  "before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
                  index === 0 && "rounded-l-[4px]",
                  index === visible.length - 1 && "rounded-r-[4px]",
                  hovered && hovered !== id && "opacity-35",
                )}
                style={{ flexGrow: airtime[id], background: seatInfo(id, cast).color }}
              />
            ))
          )}
        </div>

        {marked && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: `clamp(4.5rem, ${tooltipAt * 100}%, calc(100% - 4.5rem))` }}
          >
            <span className="font-semibold tabular-nums text-ink">
              {formatAirtime(airtime[marked])} · {percent(share(marked))}%
            </span>
            <span className="ml-1.5 inline-flex items-center gap-1 text-ink-2">
              <span
                aria-hidden
                className="inline-block h-0.5 w-2.5 rounded-full"
                style={{ background: seatInfo(marked, cast).color }}
              />
              {seatInfo(marked, cast).name}
            </span>
          </div>
        )}
      </div>

      <ul aria-label="Airtime by speaker" className="mt-3 grid grid-cols-2 gap-x-2 gap-y-0.5 sm:grid-cols-3">
        {AIRTIME_ORDER.map((id) => {
          const seat = seatInfo(id, cast);
          const you = id === "user";
          return (
            <li
              key={id}
              onPointerEnter={() => setHovered(id)}
              onPointerLeave={() => setHovered(null)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors",
                you ? "bg-accent-soft" : hovered === id && "bg-panel-2",
              )}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: seat.color }} />
              <span className={cn("min-w-0 truncate text-ink", you && "font-semibold")}>
                {seat.name}
                {live === id && <span className="sr-only"> (speaking now)</span>}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-ink-2">
                {formatAirtime(airtime[id])} · {total > 0 ? `${percent(share(id))}%` : "–"}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
